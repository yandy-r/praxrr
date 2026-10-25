import { createHash } from 'node:crypto';
import type { Migration } from '../migrations.ts';
import { db } from '../db.ts';

/**
 * Migration 20261021: Named, hashed, scoped API tokens (YAN-534).
 *
 * Replaces the single plaintext `auth_settings.api_key` with `api_tokens`. Only the SHA-256 hex
 * of a secret is stored (`token_hash`); `prefix` is a short non-secret display handle. `scopes`
 * is a JSON array of ApiTokenScope values. Timestamps use the `CURRENT_TIMESTAMP` format
 * (`YYYY-MM-DD HH:MM:SS`, UTC) so expiry comparisons in SQL are lexical-safe.
 *
 * `afterUp` converts an existing key into a hashed `admin` token flagged legacy — only if a local
 * (non-OIDC) user exists: fresh installs carry a never-shown random key nobody can be using, and
 * OIDC-only installs never could use it because the key is ignored under `AUTH=oidc` — and
 * clears `api_key` unconditionally. The column itself stays (no destructive rebuild).
 *
 * `up` uses IF NOT EXISTS because the runner commits `up` before `afterUp`; a failed `afterUp`
 * must not leave a half-applied schema that breaks the next boot. Rolling back (`down`) cannot
 * restore the legacy plaintext key: only its hash was kept.
 */
export const migration: Migration = {
  version: 20261021,
  name: 'Create api_tokens table',

  up: `
		CREATE TABLE IF NOT EXISTS api_tokens (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			name         TEXT NOT NULL,
			token_hash   TEXT NOT NULL UNIQUE,
			prefix       TEXT NOT NULL,
			scopes       TEXT NOT NULL,
			is_legacy    INTEGER NOT NULL DEFAULT 0,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_used_at DATETIME,
			expires_at   DATETIME,
			revoked_at   DATETIME
		);

		CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at ON api_tokens(revoked_at);
	`,

  down: `
		DROP INDEX IF EXISTS idx_api_tokens_revoked_at;
		DROP TABLE IF EXISTS api_tokens;
	`,

  afterUp: () => migrateLegacyApiKey(),
};

/**
 * Convert `auth_settings.api_key` into a legacy admin token (when local users exist), then clear it.
 * Idempotent: a second run finds `api_key` NULL, and `INSERT OR IGNORE` on the unique hash
 * prevents a duplicate if a prior run inserted but failed before clearing.
 */
export async function migrateLegacyApiKey(): Promise<void> {
  const row = db.queryFirst<{ api_key: string | null }>('SELECT api_key FROM auth_settings WHERE id = 1');
  const legacyKey = row?.api_key ?? null;
  const userCount =
    db.queryFirst<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE NOT (substr(username, 1, 5) = 'oidc:' AND password_hash = 'OIDC_NO_PASSWORD')"
    )?.count ?? 0;

  await db.transaction(() => {
    if (legacyKey !== null && legacyKey.length > 0 && userCount > 0) {
      db.execute(
        `INSERT OR IGNORE INTO api_tokens (name, token_hash, prefix, scopes, is_legacy)
				 VALUES (?, ?, ?, ?, 1)`,
        'Legacy API key',
        createHash('sha256').update(legacyKey).digest('hex'),
        legacyKey.slice(0, 4),
        JSON.stringify(['admin'])
      );
    }
    db.execute('UPDATE auth_settings SET api_key = NULL');
  });
}
