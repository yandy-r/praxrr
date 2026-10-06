import { db } from '../db.ts';

/**
 * Types for sessions table
 */
export interface Session {
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
   * Create a new session with optional metadata
   */
  create(userId: number, durationHours: number, metadata?: SessionMetadata): string {
    const id = crypto.randomUUID();
    const publicId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    db.execute(
      `INSERT INTO sessions (id, public_id, user_id, expires_at, ip_address, user_agent, browser, os, device_type, last_active_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      id,
      publicId,
      userId,
      expiresAt.toISOString(),
      metadata?.ipAddress ?? null,
      metadata?.userAgent ?? null,
      metadata?.browser ?? null,
      metadata?.os ?? null,
      metadata?.deviceType ?? null
    );

    return id;
  },

  /**
   * Get a session by ID (regardless of expiration)
   */
  getById(id: string): Session | undefined {
    return db.queryFirst<Session>('SELECT * FROM sessions WHERE id = ?', id);
  },

  /**
   * Get a valid (non-expired) session by ID
   */
  getValidById(id: string): Session | undefined {
    return db.queryFirst<Session>(
      `SELECT * FROM sessions
			 WHERE id = ? AND datetime(expires_at) > datetime('now')`,
      id
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
   * Delete a specific session (logout)
   */
  deleteById(id: string): boolean {
    const affected = db.execute('DELETE FROM sessions WHERE id = ?', id);
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
   * Extend session expiration (sliding expiration)
   * Also updates last_active_at for activity tracking
   */
  extendExpiration(id: string, durationHours: number): boolean {
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    const affected = db.execute(
      'UPDATE sessions SET expires_at = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
      expiresAt.toISOString(),
      id
    );
    return affected > 0;
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
