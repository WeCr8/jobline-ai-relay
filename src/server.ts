/**
 * server.ts — JobLine Relay
 *
 * Single Node.js process. No Redis, no database.
 * State is in-memory — publishers and subscribers rebuild automatically on reconnect.
 *
 * Two WebSocket paths on one HTTP server:
 *   ws://<host>/ws/publisher  ← VS Code extension (API-key auth)
 *   ws://<host>/ws/subscriber ← React Native dashboard (JWT auth)
 *
 * REST API at /api/v1 handles bootstrap, auth, and machine queries.
 */

import * as http from 'http';
import express   from 'express';
import { WebSocketServer } from 'ws';

import { config }           from './config';
import { apiRouter }        from './api/routes';
import { handlePublisher }  from './relay/publisher';
import { handleSubscriber } from './relay/subscriber';

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  config.corsOrigins);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use('/api/v1', apiRouter);

// Helpful root info page
app.get('/', (_req, res) => {
  res.json({
    name: 'JobLine.ai Relay', version: '1.0.0',
    endpoints: {
      health:       'GET  /api/v1/health',
      authToken:    'POST /api/v1/auth/token  { apiKey }',
      machines:     'GET  /api/v1/machines',
      snapshots:    'GET  /api/v1/snapshots',
      stats:        'GET  /api/v1/stats',
      publisher_ws: 'ws://host/ws/publisher  (publisher API key)',
      subscriber_ws:'ws://host/ws/subscriber (subscriber JWT)',
    },
  });
});

// ── HTTP + WebSocket servers ──────────────────────────────────────────────────

const server = http.createServer(app);

const pubWss = new WebSocketServer({ noServer: true });
const subWss = new WebSocketServer({ noServer: true });

pubWss.on('connection', handlePublisher);
subWss.on('connection', handleSubscriber);

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;

  if (path === '/ws/publisher') {
    pubWss.handleUpgrade(req, socket as any, head, (ws) =>
      pubWss.emit('connection', ws, req));
  } else if (path === '/ws/subscriber') {
    subWss.handleUpgrade(req, socket as any, head, (ws) =>
      subWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log(`\nJobLine Relay  [${config.nodeEnv}]  port ${config.port}`);
    console.log(`  Publisher  → ws://localhost:${config.port}/ws/publisher`);
    console.log(`  Subscriber → ws://localhost:${config.port}/ws/subscriber`);
    console.log(`  REST API   → http://localhost:${config.port}/api/v1\n`);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown() {
  console.log('\nShutting down…');
  server.close(() => { pubWss.close(); subWss.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

export { server, pubWss, subWss };
