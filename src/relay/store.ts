/**
 * relay/store.ts — multi-tenant in-memory state
 *
 * Tenant isolation is the primary security boundary.
 * No data can cross tenant lines anywhere in this module.
 */

import type { WebSocket } from 'ws';
import type { MachineStatusSnapshot, MachineIdentity } from '../types';
import { config } from '../config';

// ── Socket descriptors ────────────────────────────────────────────────────────

export interface PublisherSocket {
  id: string;
  tenantId: string;
  ws: WebSocket;
  connectedAt: Date;
  lastSeen: Date;
  /** machines this publisher has identified */
  machineIds: Set<string>;
}

export interface SubscriberSocket {
  id: string;
  tenantId: string;
  ws: WebSocket;
  connectedAt: Date;
  lastSeen: Date;
  /** empty = all machines */
  machineFilter: Set<string>;
  /** empty = all event types */
  typeFilter: Set<string>;
}

interface SnapshotEntry {
  snapshot: MachineStatusSnapshot;
  expiresAt: number; // ms timestamp
}

// ── Store ─────────────────────────────────────────────────────────────────────

class Store {
  // tenantId → id → socket
  private publishers  = new Map<string, Map<string, PublisherSocket>>();
  private subscribers = new Map<string, Map<string, SubscriberSocket>>();
  // tenantId → machineId → entry
  private snapshots   = new Map<string, Map<string, SnapshotEntry>>();
  // tenantId → machineId → identity
  private machines    = new Map<string, Map<string, MachineIdentity>>();

  private tenantPubs(t: string)  { return this.getOrCreate(this.publishers, t); }
  private tenantSubs(t: string)  { return this.getOrCreate(this.subscribers, t); }
  private tenantSnaps(t: string) { return this.getOrCreate(this.snapshots, t); }
  private tenantMachs(t: string) { return this.getOrCreate(this.machines, t); }

  private getOrCreate<K, V>(m: Map<K, Map<string, V>>, k: K): Map<string, V> {
    if (!m.has(k)) m.set(k, new Map());
    return m.get(k)!;
  }

  // ── Publishers ─────────────────────────────────────────────────────────────

  addPublisher(p: PublisherSocket): boolean {
    const m = this.tenantPubs(p.tenantId);
    if (m.size >= config.maxPublishersPerTenant) return false;
    m.set(p.id, p);
    return true;
  }

  removePublisher(tenantId: string, id: string): void {
    this.tenantPubs(tenantId).delete(id);
  }

  getPublishers(tenantId: string): PublisherSocket[] {
    return [...this.tenantPubs(tenantId).values()];
  }

  // ── Subscribers ────────────────────────────────────────────────────────────

  addSubscriber(s: SubscriberSocket): boolean {
    const m = this.tenantSubs(s.tenantId);
    if (m.size >= config.maxSubscribersPerTenant) return false;
    m.set(s.id, s);
    return true;
  }

  removeSubscriber(tenantId: string, id: string): void {
    this.tenantSubs(tenantId).delete(id);
  }

  updateFilter(tenantId: string, id: string, machines: string[], types: string[]): void {
    const sub = this.tenantSubs(tenantId).get(id);
    if (!sub) return;
    sub.machineFilter = new Set(machines);
    sub.typeFilter    = new Set(types);
  }

  getSubscribers(tenantId: string): SubscriberSocket[] {
    return [...this.tenantSubs(tenantId).values()];
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  setSnapshot(tenantId: string, snap: MachineStatusSnapshot): void {
    this.tenantSnaps(tenantId).set(snap.machineId, {
      snapshot: snap,
      expiresAt: Date.now() + config.snapshotTtlMs,
    });
  }

  getSnapshot(tenantId: string, machineId: string): MachineStatusSnapshot | null {
    const e = this.tenantSnaps(tenantId).get(machineId);
    if (!e || e.expiresAt < Date.now()) { this.tenantSnaps(tenantId).delete(machineId); return null; }
    return e.snapshot;
  }

  getAllSnapshots(tenantId: string): MachineStatusSnapshot[] {
    const now = Date.now();
    const out: MachineStatusSnapshot[] = [];
    for (const [id, e] of this.tenantSnaps(tenantId)) {
      if (e.expiresAt < now) { this.tenantSnaps(tenantId).delete(id); continue; }
      out.push(e.snapshot);
    }
    return out;
  }

  // ── Machines ──────────────────────────────────────────────────────────────

  registerMachine(tenantId: string, m: MachineIdentity): void {
    this.tenantMachs(tenantId).set(m.id, m);
  }

  unregisterMachine(tenantId: string, machineId: string): void {
    this.tenantMachs(tenantId).delete(machineId);
  }

  getMachines(tenantId: string): MachineIdentity[] {
    return [...this.tenantMachs(tenantId).values()];
  }

  getMachine(tenantId: string, machineId: string): MachineIdentity | null {
    return this.tenantMachs(tenantId).get(machineId) ?? null;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats() {
    let pubs = 0, subs = 0, machs = 0;
    for (const m of this.publishers.values())  pubs  += m.size;
    for (const m of this.subscribers.values()) subs  += m.size;
    for (const m of this.machines.values())    machs += m.size;
    return {
      tenants:     this.publishers.size,
      publishers:  pubs,
      subscribers: subs,
      machines:    machs,
      uptime:      process.uptime(),
    };
  }
}

export const store = new Store();
