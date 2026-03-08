import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { config, publisherKeyMap } from '../config';

export interface TokenClaims {
  tenantId: string;
  sub: string;
  role: 'subscriber' | 'publisher';
  iat: number;
  exp: number;
}

// ── Subscriber JWT ────────────────────────────────────────────────────────────

export function issueSubscriberToken(tenantId: string): string {
  return jwt.sign(
    { tenantId, sub: uuid(), role: 'subscriber' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any }
  );
}

export function verifySubscriberToken(token: string): TokenClaims | null {
  try {
    const c = jwt.verify(token, config.jwtSecret) as TokenClaims;
    return c.role === 'subscriber' ? c : null;
  } catch {
    return null;
  }
}

// ── Publisher API key ─────────────────────────────────────────────────────────

export function verifyPublisherKey(apiKey: string): string | null {
  return publisherKeyMap.get(apiKey) ?? null;
}

// ── Token extraction (header or query) ────────────────────────────────────────

export function extractBearer(
  headers: Record<string, string | string[] | undefined>,
  query:   Record<string, string | string[] | undefined>
): string | null {
  const h = headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  const q = query['token'];
  if (typeof q === 'string') return q.trim();
  return null;
}
