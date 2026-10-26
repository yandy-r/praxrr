import { createHash } from 'node:crypto';
import { db } from '../db.ts';
import type { AuthMode } from '$config';
import { OIDC_USER_SQL, OIDC_USER_SQL_PARAMS } from './users.ts';

/** Random bytes per session bearer token (cookie value): 32 bytes → 64 hex chars. */
const SESSION_TOKEN_BYTES = 32;

/**
 * SHA-256 hex of a raw session cookie value. `sessions.id` stores exactly this — never a bearer
 * credential at rest (same style as `hashApiToken` in `$auth/apiTokens.ts`).
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 64 lowercase hex characters from 32 random bytes; used as the raw `session` cookie value. */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Types for sessions table
 */
export interface Session {
  /** Stored sha256 hex of the session cookie value; never a bearer credential. */
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
  // Metadata fields (Migration 037)
  ip_address: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  last_active_at: string | null;
  // Client-visible handle (Migration 20261006); independent of id
  public_id: string;
}

/**
 * Metadata-only session row safe to serialize to the browser (no bearer id)
 */
export interface SessionSummary {
  public_id: string;
  created_at: string;
  expires_at: string;
  last_active_at: string | null;
  ip_address: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  isCurrent: boolean;
}

/**
 * Metadata to capture when creating a session
 */
export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
}

/**
 * All queries for sessions table
 * Multiple sessions per user (different browsers/devices)
 */
export const sessionsQueries = {
  /**
   * Create a new session with optional metadata. Returns the RAW bearer token (the cookie value);
   * only its sha256 is persisted as the row id.
   */
  create(userId: number, durationHours: number, metadata?: SessionMetadata): string {
    const token = generateSessionToken();
    const publicId = crypto.randomUUID();

    db.execute(
      `INSERT INTO sessions (id, public_id, user_id, expires_at, ip_address, user_agent, browser, os, device_type, last_active_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      hashSessionToken(token),
      publicId,
      userId,
      expiryFromDuration(durationHours).toISOString(),
      metadata?.ipAddress ?? null,
      metadata?.userAgent ?? null,
      metadata?.browser ?? null,
      metadata?.os ?? null,
      metadata?.deviceType ?? null
    );

    return token;
  },

  /**
   * Get a session by the RAW cookie token (hashing internally), regardless of expiration
   */
  getByToken(token: string): Session | undefined {
    return db.queryFirst<Session>('SELECT * FROM sessions WHERE id = ?', hashSessionToken(token));
  },

  /**
   * Get a valid (non-expired) session by ID (stored hash)
   */
  getValidById(id: string): Session | undefined {
    return db.queryFirst<Session>(
      `SELECT * FROM sessions
			 WHERE id = ? AND datetime(expires_at) > datetime('now')`,
      id
    );
  },

  /**
   * Get a valid (non-expired) session by the RAW cookie token (hashing internally)
   */
  getValidByToken(token: string): Session | undefined {
    return db.queryFirst<Session>(
      `SELECT * FROM sessions
			 WHERE id = ? AND datetime(expires_at) > datetime('now')`,
      hashSessionToken(token)
    );
  },

  /**
   * Get all sessions for a user
   */
  getByUserId(userId: number): Session[] {
    return db.query<Session>('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC', userId);
  },

  /**
   * List a user's unexpired sessions as metadata only (never selects id/user_agent/user_id)
   */
  listSummariesByUserId(userId: number, currentSessionId: string): SessionSummary[] {
    const rows = db.query<Omit<SessionSummary, 'isCurrent'> & { is_current: number }>(
      `SELECT public_id, created_at, expires_at, last_active_at, ip_address, browser, os, device_type,
			        CASE WHEN id = ? THEN 1 ELSE 0 END AS is_current
			 FROM sessions
			 WHERE user_id = ? AND datetime(expires_at) > datetime('now')
			 ORDER BY created_at DESC`,
      currentSessionId,
      userId
    );
    return rows.map(({ is_current, ...row }) => ({ ...row, isCurrent: is_current === 1 }));
  },

  /**
   * Delete one of a user's other sessions by public_id (owner-scoped, never the current session)
   */
  deleteOtherByPublicId(userId: number, publicId: string, currentSessionId: string): boolean {
    const affected = db.execute(
      'DELETE FROM sessions WHERE public_id = ? AND user_id = ? AND id <> ?',
      publicId,
      userId,
      currentSessionId
    );
    return affected > 0;
  },

  /**
   * Delete a specific session by the RAW cookie token (logout)
   */
  deleteByToken(token: string): boolean {
    const affected = db.execute('DELETE FROM sessions WHERE id = ?', hashSessionToken(token));
    return affected > 0;
  },

  /**
   * Delete all sessions for a user (logout everywhere)
   */
  deleteByUserId(userId: number): number {
    return db.execute('DELETE FROM sessions WHERE user_id = ?', userId);
  },

  /**
   * Delete all sessions except one (logout other devices)
   */
  deleteOthersByUserId(userId: number, keepSessionId: string): number {
    return db.execute('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keepSessionId);
  },

  /**
   * Delete all expired sessions (cleanup)
   */
  deleteExpired(): number {
    return db.execute(`DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')`);
  },

  /**
   * Delete sessions whose user kind disagrees with the auth mode:
   * AUTH=oidc keeps only OIDC-user sessions; on/local/off keep only local-user sessions
   * (off intentionally drops OIDC sessions: password mode is the fallback identity).
   * OIDC users are rows matching OIDC_USER_SQL (exact prefix AND placeholder hash).
   */
  deleteModeMismatched(authMode: AuthMode): number {
    const mismatch = authMode === 'oidc' ? `NOT ${OIDC_USER_SQL}` : OIDC_USER_SQL;
    return db.execute(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE ${mismatch})`,
      ...OIDC_USER_SQL_PARAMS
    );
  },

  /**
   * Extend session expiration (sliding expiration); also updates last_active_at.
   * Returns the new expiry (null when no row was updated) so the cookie can match the DB exactly.
   */
  extendExpiration(id: string, durationHours: number): Date | null {
    const expiresAt = expiryFromDuration(durationHours);
    const affected = db.execute(
      'UPDATE sessions SET expires_at = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
      expiresAt.toISOString(),
      id
    );
    return affected > 0 ? expiresAt : null;
  },

  /**
   * Count active sessions for a user
   */
  countByUserId(userId: number): number {
    const result = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions
			 WHERE user_id = ? AND datetime(expires_at) > datetime('now')`,
      userId
    );
    return result?.count ?? 0;
  },
};

/** Expiry instant for a session created or extended right now with the given duration. */
function expiryFromDuration(durationHours: number): Date {
  return new Date(Date.now() + durationHours * 60 * 60 * 1000);
}
