/**
 * relay/subscriber.ts
 *
 * Handles WebSocket connections from the React Native dashboard (any repo).
 * URL: ws://<host>/ws/subscriber
 * Auth: Bearer <JWT> in Authorization header or ?token= query
 *       JWT obtained from POST /api/v1/auth/token
 *
 * Subscriber protocol:
 *
 *   → { type:'subscribe', machineIds: string[], eventTypes: string[] }
 *      Set subscription filter. Empty array = all. Sends cached snapshots immediately.
 *      Can be sent multiple times to update the filter live.
 *
 *   → { type:'ping' }
 *      Keepalive — server replies { type:'pong', ts }.
 *
 *   ← RelayMessage  { v:1, tenantId, event: JobLineEvent }
 *      All live events. Dashboard parses event.type to dispatch correctly.
 *
 *   ← { type:'welcome',    subscriberId, tenantId, machines: MachineIdentity[] }
 *      Sent immediately on connect — full machine list for the tenant.
 *
 *   ← { type:'subscribed', machineIds, eventTypes }
 *      Ack after subscribe message.
 *
 *   ← { type:'pong', ts }
 *   ← { type:'error', code, message }
 */

import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { v4 as uuid } from 'uuid';
import { store } from './store';
import { bootstrapSubscriber } from './router';
import { verifySubscriberToken, extractBearer } from '../auth';
import { config } from '../config';

const log = (level: string, msg: string, meta?: object) =>
  console[level as 'info'](`[relay:sub] ${msg}`, meta ?? '');

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function handleSubscriber(ws: WebSocket, req: IncomingMessage): void {
  const url     = new URL(req.url ?? '/', `http://${req.headers.host ?? 'x'}`);
  const query   = Object.fromEntries(url.searchParams);
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const token   = extractBearer(headers, query);

  const claims = token ? verifySubscriberToken(token) : null;
  if (!claims) {
    send(ws, { type: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired JWT' });
    ws.close(4001, 'Unauthorized');
    return;
  }

  const { tenantId } = claims;

  const sub = {
    id: uuid(), tenantId, ws,
    connectedAt: new Date(), lastSeen: new Date(),
    machineFilter: new Set<string>(),
    typeFilter:    new Set<string>(),
  };

  if (!store.addSubscriber(sub)) {
    send(ws, { type: 'error', code: 'LIMIT', message: 'Max subscribers per tenant reached' });
    ws.close(4003, 'Limit exceeded');
    return;
  }

  // Welcome: send full machine list so the dashboard can render without waiting
  const machines = store.getMachines(tenantId);
  send(ws, { type: 'welcome', subscriberId: sub.id, tenantId, machines });
  log('info', `subscriber connected  tenant=${tenantId} id=${sub.id} machines=${machines.length}`);

  // ── Keepalive ──────────────────────────────────────────────────────────────
  let alive = true;
  const ping = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, config.pingIntervalMs);
  ws.on('pong', () => { alive = true; sub.lastSeen = new Date(); });

  // ── Messages ───────────────────────────────────────────────────────────────
  ws.on('message', (raw) => {
    sub.lastSeen = new Date();
    let msg: any;
    try { msg = JSON.parse(raw.toString()); }
    catch { send(ws, { type: 'error', code: 'BAD_JSON', message: 'Expected JSON' }); return; }

    switch (msg.type) {
      case 'subscribe': {
        const machineIds: string[] = Array.isArray(msg.machineIds) ? msg.machineIds : [];
        const eventTypes: string[] = Array.isArray(msg.eventTypes) ? msg.eventTypes : [];

        store.updateFilter(tenantId, sub.id, machineIds, eventTypes);
        sub.machineFilter = new Set(machineIds);
        sub.typeFilter    = new Set(eventTypes);

        // Push current snapshots for subscribed machines right away
        bootstrapSubscriber(tenantId, sub.id, ws, machineIds);
        send(ws, { type: 'subscribed', machineIds, eventTypes });
        log('info', `subscription updated  tenant=${tenantId} machines=${machineIds.length} types=${eventTypes.length}`);
        break;
      }

      case 'ping':
        send(ws, { type: 'pong', ts: new Date().toISOString() });
        break;

      default:
        send(ws, { type: 'error', code: 'UNKNOWN', message: `Unknown type: ${msg.type}` });
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  ws.on('close', () => {
    clearInterval(ping);
    store.removeSubscriber(tenantId, sub.id);
    log('info', `subscriber disconnected  tenant=${tenantId} id=${sub.id}`);
  });

  ws.on('error', (e) => {
    log('warn', `subscriber error  tenant=${tenantId}: ${e.message}`);
  });
}
