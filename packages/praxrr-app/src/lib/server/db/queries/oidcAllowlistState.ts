import { db } from '../db.ts';

/** Singleton state for detecting OIDC allowlist changes between server starts. */
export const oidcAllowlistStateQueries = {
  getFingerprint(): string | null {
    return (
      db.queryFirst<{ fingerprint: string }>('SELECT fingerprint FROM oidc_allowlist_state WHERE id = 1')
        ?.fingerprint ?? null
    );
  },

  storeFingerprint(fingerprint: string): void {
    db.execute(
      `INSERT INTO oidc_allowlist_state (id, fingerprint) VALUES (1, ?)
			 ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = CURRENT_TIMESTAMP`,
      fingerprint
    );
  },
};
