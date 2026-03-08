import * as dotenv from 'dotenv';
dotenv.config();

function opt(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
function optInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`Env var ${key} must be integer, got: ${v}`);
  return n;
}

export const config = {
  port:    optInt('PORT', 4242),
  host:    opt('HOST', '0.0.0.0'),
  nodeEnv: opt('NODE_ENV', 'development'),

  jwtSecret:    opt('JWT_SECRET', 'dev-secret-change-in-production'),
  jwtExpiresIn: opt('JWT_EXPIRES_IN', '30d'),

  /**
   * Publisher API keys — format: "tenantId:apiKey,tenantId2:apiKey2"
   * Each key grants publish rights for one tenant.
   * Subscribers exchange keys for short-lived JWTs via POST /api/v1/auth/token.
   */
  publisherKeys: opt('PUBLISHER_KEYS', 'dev-tenant:dev-publisher-key'),

  maxSubscribersPerTenant: optInt('MAX_SUBSCRIBERS_PER_TENANT', 50),
  maxPublishersPerTenant:  optInt('MAX_PUBLISHERS_PER_TENANT', 10),
  snapshotTtlMs:   optInt('SNAPSHOT_TTL_MS',   300_000), // 5 min
  pingIntervalMs:  optInt('PING_INTERVAL_MS',   30_000),
  maxMessageBytes: optInt('MAX_MESSAGE_BYTES',  256_000),

  corsOrigins: opt('CORS_ORIGINS', '*'),
} as const;

/** Parse "tenant1:key1,tenant2:key2" → Map<key, tenantId> */
export function parsePublisherKeys(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length >= 2) {
      const tenantId = parts[0].trim();
      const key      = parts.slice(1).join(':').trim(); // allow colons in keys
      if (tenantId && key) map.set(key, tenantId);
    }
  }
  return map;
}

export const publisherKeyMap = parsePublisherKeys(config.publisherKeys);
