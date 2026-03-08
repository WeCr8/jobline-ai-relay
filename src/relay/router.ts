/**
 * relay/router.ts — event fan-out
 *
 * Takes an inbound JobLineEvent from a publisher and delivers it to every
 * matching subscriber within the same tenant. Dead sockets are pruned inline.
 */

import type { WebSocket } from 'ws';
import type { JobLineEvent, RelayMessage, MachineStatusSnapshot } from '../types';
import { store } from './store';

const WS_OPEN = 1;

function frame(tenantId: string, event: JobLineEvent): string {
  return JSON.stringify({ v: 1, tenantId, event } satisfies RelayMessage);
}

function trySend(ws: WebSocket, payload: string): boolean {
  if (ws.readyState !== WS_OPEN) return false;
  try { ws.send(payload); return true; }
  catch { return false; }
}

/**
 * Route one event to all matching subscribers.
 * Returns delivery count.
 */
export function routeEvent(tenantId: string, event: JobLineEvent): number {
  // Keep machine status snapshots fresh so new subscribers get current state
  if (event.type === 'machine.status') {
    store.setSnapshot(tenantId, event.payload as MachineStatusSnapshot);
  }

  const subs = store.getSubscribers(tenantId);
  if (!subs.length) return 0;

  const payload = frame(tenantId, event);
  let count = 0;

  for (const sub of subs) {
    // Respect subscription filters
    if (sub.machineFilter.size > 0 && !sub.machineFilter.has(event.machineId)) continue;
    if (sub.typeFilter.size    > 0 && !sub.typeFilter.has(event.type))         continue;

    if (trySend(sub.ws, payload)) {
      sub.lastSeen = new Date();
      count++;
    } else {
      // Dead socket — prune it
      store.removeSubscriber(tenantId, sub.id);
    }
  }

  return count;
}

/**
 * Push current machine snapshots to a brand-new subscriber immediately
 * after they send their first `subscribe` message.
 */
export function bootstrapSubscriber(
  tenantId: string,
  subId: string,
  ws: WebSocket,
  machineFilter: string[]
): void {
  const snaps = store.getAllSnapshots(tenantId);
  const filtered = machineFilter.length > 0
    ? snaps.filter(s => machineFilter.includes(s.machineId))
    : snaps;

  for (const snap of filtered) {
    const evt: JobLineEvent = {
      seq: 0, sessionId: 'bootstrap',
      type: 'machine.status',
      machineId: snap.machineId,
      payload: snap,
      timestamp: new Date().toISOString(),
    };
    trySend(ws, frame(tenantId, evt));
  }
}

/** Broadcast a synthetic system event (machine connected/disconnected) */
export function systemEvent(
  tenantId: string,
  type: JobLineEvent['type'],
  machineId: string,
  payload: unknown
): void {
  routeEvent(tenantId, {
    seq: 0, sessionId: 'system',
    type, machineId,
    payload,
    timestamp: new Date().toISOString(),
  });
}
