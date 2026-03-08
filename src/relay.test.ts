/**
 * relay.test.ts — integration + unit tests for jobline-relay
 * Run: npm test
 */

import {
  issueSubscriberToken,
  verifySubscriberToken,
  verifyPublisherKey,
  extractBearer,
} from './auth';
import { parsePublisherKeys } from './config';
import { store } from './relay/store';
import type { MachineStatusSnapshot, MachineIdentity } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(machineId: string): MachineStatusSnapshot {
  return {
    machineId,
    connectionStatus: 'connected',
    machineState:     'idle',
    machineMode:      'auto',
    spindleRpm:       null,
    spindleOverride:  null,
    feedOverride:     null,
    activeTool:       null,
    activeProgram:    null,
    blockNumber:      null,
    position:         {},
    alarms:           [],
    timestamp:        new Date().toISOString(),
  };
}

// ── JWT ───────────────────────────────────────────────────────────────────────

describe('issueSubscriberToken / verifySubscriberToken', () => {
  it('issues a valid token and verifies it', () => {
    const token  = issueSubscriberToken('acme');
    const claims = verifySubscriberToken(token);
    expect(claims).not.toBeNull();
    expect(claims!.tenantId).toBe('acme');
    expect(claims!.role).toBe('subscriber');
    expect(typeof claims!.sub).toBe('string');
  });

  it('returns null for garbage input', () => {
    expect(verifySubscriberToken('not-a-jwt')).toBeNull();
    expect(verifySubscriberToken('')).toBeNull();
  });

  it('returns null for tampered signature', () => {
    const token = issueSubscriberToken('acme');
    const bad   = token.slice(0, -4) + 'XXXX';
    expect(verifySubscriberToken(bad)).toBeNull();
  });
});

// ── Publisher key ─────────────────────────────────────────────────────────────

describe('verifyPublisherKey / parsePublisherKeys', () => {
  it('parses multi-tenant key string', () => {
    const map = parsePublisherKeys('acme:key-abc,beta:key-def');
    expect(map.get('key-abc')).toBe('acme');
    expect(map.get('key-def')).toBe('beta');
    expect(map.size).toBe(2);
  });

  it('handles whitespace around entries', () => {
    const map = parsePublisherKeys('  acme : k1 , beta : k2 ');
    expect(map.get('k1')).toBe('acme');
    expect(map.get('k2')).toBe('beta');
  });

  it('ignores malformed entries', () => {
    const map = parsePublisherKeys('good:key1,nocoIon,another:key2');
    expect(map.size).toBe(2);
  });

  it('default dev key resolves to dev-tenant', () => {
    const tid = verifyPublisherKey('dev-publisher-key');
    expect(tid).toBe('dev-tenant');
  });

  it('unknown key returns null', () => {
    expect(verifyPublisherKey('unknown-xyz-789')).toBeNull();
  });
});

// ── Bearer extraction ─────────────────────────────────────────────────────────

describe('extractBearer', () => {
  it('extracts from Authorization header', () => {
    expect(extractBearer({ authorization: 'Bearer abc123' }, {})).toBe('abc123');
  });

  it('extracts from ?token= query param', () => {
    expect(extractBearer({}, { token: 'qtoken' })).toBe('qtoken');
  });

  it('header takes priority over query', () => {
    expect(extractBearer({ authorization: 'Bearer h' }, { token: 'q' })).toBe('h');
  });

  it('returns null when absent', () => {
    expect(extractBearer({}, {})).toBeNull();
    expect(extractBearer({ authorization: 'Basic xxx' }, {})).toBeNull();
  });
});

// ── Store ─────────────────────────────────────────────────────────────────────

describe('store — publishers', () => {
  const tid = 'store-test-pub-' + Date.now();

  it('adds publisher and retrieves it', () => {
    const pub = { id: 'p1', tenantId: tid, ws: {} as any, connectedAt: new Date(), lastSeen: new Date(), machineIds: new Set<string>() };
    expect(store.addPublisher(pub)).toBe(true);
    const pubs = store.getPublishers(tid);
    expect(pubs.some(p => p.id === 'p1')).toBe(true);
    store.removePublisher(tid, 'p1');
    expect(store.getPublishers(tid).some(p => p.id === 'p1')).toBe(false);
  });

  it('publisher does not leak to other tenant', () => {
    const pub = { id: 'leak-test', tenantId: tid, ws: {} as any, connectedAt: new Date(), lastSeen: new Date(), machineIds: new Set<string>() };
    store.addPublisher(pub);
    expect(store.getPublishers('other-tenant-xyz').some(p => p.id === 'leak-test')).toBe(false);
    store.removePublisher(tid, 'leak-test');
  });
});

describe('store — subscribers', () => {
  const tid = 'store-test-sub-' + Date.now();

  it('adds subscriber and updates filter', () => {
    const sub = { id: 's1', tenantId: tid, ws: {} as any, connectedAt: new Date(), lastSeen: new Date(), machineFilter: new Set<string>(), typeFilter: new Set<string>() };
    expect(store.addSubscriber(sub)).toBe(true);
    store.updateFilter(tid, 's1', ['m1', 'm2'], ['machine.status']);
    const subs = store.getSubscribers(tid);
    const found = subs.find(s => s.id === 's1')!;
    expect(found.machineFilter.has('m1')).toBe(true);
    expect(found.typeFilter.has('machine.status')).toBe(true);
    store.removeSubscriber(tid, 's1');
  });
});

describe('store — snapshots', () => {
  const tid = 'snap-test-' + Date.now();

  it('stores and retrieves a snapshot', () => {
    const snap = makeSnap('vmc-01');
    store.setSnapshot(tid, snap);
    const got = store.getSnapshot(tid, 'vmc-01');
    expect(got).not.toBeNull();
    expect(got!.machineId).toBe('vmc-01');
    expect(got!.machineState).toBe('idle');
  });

  it('tenant isolation on snapshots', () => {
    store.setSnapshot(tid, makeSnap('isolated-machine'));
    expect(store.getSnapshot('other-tenant-abc', 'isolated-machine')).toBeNull();
  });

  it('getAllSnapshots returns all stored snapshots for tenant', () => {
    store.setSnapshot(tid, makeSnap('m-a'));
    store.setSnapshot(tid, makeSnap('m-b'));
    const all = store.getAllSnapshots(tid);
    const ids  = all.map(s => s.machineId);
    expect(ids).toContain('m-a');
    expect(ids).toContain('m-b');
  });
});

describe('store — machines', () => {
  const tid = 'machine-test-' + Date.now();

  it('registers and retrieves machines', () => {
    const m: MachineIdentity = { id: 'mc1', label: 'VMC-01', controlType: 'fanuc', connectionType: 'serial' };
    store.registerMachine(tid, m);
    expect(store.getMachine(tid, 'mc1')?.label).toBe('VMC-01');
    expect(store.getMachines(tid).some(x => x.id === 'mc1')).toBe(true);
  });

  it('machine does not leak to other tenant', () => {
    store.registerMachine(tid, { id: 'leak2', label: 'Lathe', controlType: 'haas', connectionType: 'ethernet' });
    expect(store.getMachine('different-tenant', 'leak2')).toBeNull();
  });
});

describe('store — stats', () => {
  it('returns numeric stats', () => {
    const s = store.stats();
    expect(typeof s.tenants).toBe('number');
    expect(typeof s.publishers).toBe('number');
    expect(typeof s.subscribers).toBe('number');
    expect(typeof s.machines).toBe('number');
    expect(typeof s.uptime).toBe('number');
  });
});
