/**
 * api/routes.ts — REST API
 *
 * All endpoints mounted under /api/v1
 *
 * Public (no auth):
 *   GET  /health        liveness
 *   GET  /ready         readiness
 *
 * Publisher-key auth (Bearer <api-key>):
 *   POST /auth/token    → { token, tenantId }   exchange key for subscriber JWT
 *   GET  /machines      → { machines[] }
 *   GET  /machines/:id  → { machine, snapshot? }
 *   GET  /snapshots     → { snapshots[] }
 *   GET  /stats         → relay stats
 */

import { Router, Request, Response, NextFunction } from 'express';
import { store }       from '../relay/store';
import { issueSubscriberToken, verifyPublisherKey, extractBearer } from '../auth';

export const apiRouter = Router();

// ── Middleware ────────────────────────────────────────────────────────────────

function requireKey(req: Request, res: Response, next: NextFunction): void {
  const token    = extractBearer(req.headers as any, req.query as any);
  const tenantId = token ? verifyPublisherKey(token) : null;
  if (!tenantId) { res.status(401).json({ error: 'Invalid API key' }); return; }
  (req as any).tenantId = tenantId;
  next();
}

// ── Public ────────────────────────────────────────────────────────────────────

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

apiRouter.get('/ready', (_req, res) => {
  res.json({ status: 'ready', ts: new Date().toISOString() });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * POST /auth/token
 * Body: { apiKey: string }
 *
 * The **separate dashboard repo** calls this once on startup to exchange
 * the publisher API key for a subscriber JWT. The JWT is stored in SecureStore
 * on the device. The API key never needs to live in the app bundle.
 *
 * Response: { token: string, tenantId: string }
 */
apiRouter.post('/auth/token', (req: Request, res: Response) => {
  const apiKey = req.body?.apiKey as string | undefined;
  if (!apiKey) { res.status(400).json({ error: 'Missing apiKey in body' }); return; }
  const tenantId = verifyPublisherKey(apiKey);
  if (!tenantId) { res.status(401).json({ error: 'Invalid API key' }); return; }
  const token = issueSubscriberToken(tenantId);
  res.json({ token, tenantId });
});

// ── Machines ──────────────────────────────────────────────────────────────────

apiRouter.get('/machines', requireKey, (req: Request, res: Response) => {
  const machines = store.getMachines((req as any).tenantId);
  res.json({ machines, count: machines.length });
});

apiRouter.get('/machines/:id', requireKey, (req: Request, res: Response) => {
  const tid     = (req as any).tenantId as string;
  const machine = store.getMachine(tid, req.params.id);
  if (!machine) { res.status(404).json({ error: 'Not found' }); return; }
  const snapshot = store.getSnapshot(tid, req.params.id);
  res.json({ machine, snapshot: snapshot ?? null });
});

apiRouter.get('/snapshots', requireKey, (req: Request, res: Response) => {
  const snaps = store.getAllSnapshots((req as any).tenantId);
  res.json({ snapshots: snaps, count: snaps.length });
});

apiRouter.get('/stats', requireKey, (_req: Request, res: Response) => {
  res.json(store.stats());
});
