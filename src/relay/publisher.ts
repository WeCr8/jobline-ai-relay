/**
 * relay/publisher.ts
 *
 * Handles WebSocket connections from jobline-machine (VS Code extension).
 * URL: ws://<host>/ws/publisher
 * Auth: Bearer <publisher-api-key> in Authorization header or ?token= query
 *
 * Publisher protocol (newline-delimited JSON):
 *
 *   → { type:'identify',  machines: MachineIdentity[] }
 *      Must be first message. Registers machines and notifies subscribers.
 *
 *   → { type:'event',     event: JobLineEvent, ack?: boolean }
 *      Publish any event. Optionally request an ack with delivery count.
 *
 *   → { type:'ping' }
 *      Keepalive — server replies { type:'pong' }.
 *
 *   ← { type:'welcome',   publisherId, tenantId }
 *   ← { type:'identified',count }
 *   ← { type:'ack',       seq, deliveries }
 *   ← { type:'pong' }
 *   ← { type:'error',     code, message }
 */

import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { v4 as uuid } from 'uuid';
import type { JobLineEvent, MachineIdentity } from '../types';
import { store }       from './store';
import { routeEvent, systemEvent } from './router';
import { verifyPublisherKey, extractBearer } from '../auth';
import { config } from '../config';

const log = (level: string, msg: string, meta?: object) =>
  console[level as 'info'](`[relay:pub] ${msg}`, meta ?? '');

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function handlePublisher(ws: WebSocket, req: IncomingMessage): void {
  const url     = new URL(req.url ?? '/', `http://${req.headers.host ?? 'x'}`);
  const query   = Object.fromEntries(url.searchParams);
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const token   = extractBearer(headers, query);

  const tenantId = token ? verifyPublisherKey(token) : null;
  if (!tenantId) {
    send(ws, { type: 'error', code: 'UNAUTHORIZED', message: 'Invalid publisher API key' });
    ws.close(4001, 'Unauthorized');
    return;
  }

  const pub = {
    id: uuid(), tenantId, ws,
    connectedAt: new Date(), lastSeen: new Date(),
    machineIds: new Set<string>(),
  };

  if (!store.addPublisher(pub)) {
    send(ws, { type: 'error', code: 'LIMIT', message: 'Max publishers per tenant reached' });
    ws.close(4003, 'Limit exceeded');
    return;
  }

  send(ws, { type: 'welcome', publisherId: pub.id, tenantId });
  log('info', `publisher connected  tenant=${tenantId} id=${pub.id}`);

  // ── Keepalive ──────────────────────────────────────────────────────────────
  let alive = true;
  const ping = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, config.pingIntervalMs);
  ws.on('pong', () => { alive = true; pub.lastSeen = new Date(); });

  // ── Messages ───────────────────────────────────────────────────────────────
  ws.on('message', (raw) => {
    pub.lastSeen = new Date();
    const str = raw.toString();
    if (str.length > config.maxMessageBytes) {
      send(ws, { type: 'error', code: 'TOO_LARGE', message: 'Message exceeds limit' });
      return;
    }

    let msg: any;
    try { msg = JSON.parse(str); }
    catch { send(ws, { type: 'error', code: 'BAD_JSON', message: 'Expected JSON' }); return; }

    switch (msg.type) {
      case 'identify': {
        const machines: MachineIdentity[] = Array.isArray(msg.machines) ? msg.machines : [];
        for (const m of machines) {
          if (!m?.id || !m?.label) continue;
          store.registerMachine(tenantId, m);
          pub.machineIds.add(m.id);
          systemEvent(tenantId, 'machine.connected', m.id, m);
        }
        send(ws, { type: 'identified', count: machines.length });
        log('info', `identified ${machines.length} machine(s)  tenant=${tenantId}`);
        break;
      }

      case 'event': {
        const event = msg.event as JobLineEvent;
        if (!event?.type || !event?.machineId) {
          send(ws, { type: 'error', code: 'BAD_EVENT', message: 'event.type and event.machineId required' });
          return;
        }
        const deliveries = routeEvent(tenantId, event);
        if (msg.ack) send(ws, { type: 'ack', seq: event.seq ?? 0, deliveries });
        break;
      }

      case 'ping':
        send(ws, { type: 'pong' });
        break;

      default:
        send(ws, { type: 'error', code: 'UNKNOWN', message: `Unknown type: ${msg.type}` });
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  ws.on('close', () => {
    clearInterval(ping);
    store.removePublisher(tenantId, pub.id);
    for (const machineId of pub.machineIds) {
      systemEvent(tenantId, 'machine.disconnected', machineId, { machineId });
    }
    log('info', `publisher disconnected  tenant=${tenantId} id=${pub.id}`);
  });

  ws.on('error', (e) => {
    log('warn', `publisher error  tenant=${tenantId}: ${e.message}`);
  });
}
