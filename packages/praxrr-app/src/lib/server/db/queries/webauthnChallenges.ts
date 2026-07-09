import { db } from '../db.ts';

export type WebAuthnChallengePurpose = 'register' | 'authenticate';

/**
 * A short-lived, single-use WebAuthn challenge (webauthn_challenges).
 */
export interface WebAuthnChallengeRow {
  id: string;
  challenge: string;
  purpose: WebAuthnChallengePurpose;
  user_id: number | null;
  expires_at: string;
  created_at: string;
}

/**
 * All queries for the webauthn_challenges table.
 * Challenges are opaque, TTL-bounded, and single-use — the handle (uuid) is carried in a
 * short-lived cookie while the browser runs navigator.credentials.
 */
export const webauthnChallengesQueries = {
  /**
   * Store a challenge and return the opaque handle (uuid) to carry in the cookie.
   */
  create(challenge: string, purpose: WebAuthnChallengePurpose, userId: number | null, ttlSeconds: number): string {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    db.execute(
      'INSERT INTO webauthn_challenges (id, challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      id,
      challenge,
      purpose,
      userId,
      expiresAt
    );

    return id;
  },

  /**
   * Single-use consume: return the challenge for a matching, non-expired handle+purpose, then
   * DELETE the row. The DELETE runs unconditionally (even on a miss/expiry) so a handle can
   * never be replayed.
   */
  consume(handle: string, purpose: WebAuthnChallengePurpose): { challenge: string; userId: number | null } | undefined {
    const row = db.queryFirst<WebAuthnChallengeRow>(
      `SELECT * FROM webauthn_challenges
			 WHERE id = ? AND purpose = ? AND datetime(expires_at) > datetime('now')`,
      handle,
      purpose
    );

    db.execute('DELETE FROM webauthn_challenges WHERE id = ?', handle);

    return row ? { challenge: row.challenge, userId: row.user_id } : undefined;
  },

  /**
   * Delete all expired challenges (called lazily on issuance + at startup).
   */
  deleteExpired(): number {
    return db.execute(`DELETE FROM webauthn_challenges WHERE datetime(expires_at) <= datetime('now')`);
  },
};
