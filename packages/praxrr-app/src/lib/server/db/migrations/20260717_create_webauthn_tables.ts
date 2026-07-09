import type { Migration } from '../migrations.ts';

/**
 * Migration 20260717: WebAuthn / passkey tables (issue #18).
 *
 * Passkeys supplement password auth under AUTH=on (they never replace it). This adds two
 * app-DB tables — it is NOT a PCD base-op, so seedBuiltInBaseOps.ts is untouched.
 *
 * webauthn_credentials: one row per registered passkey, scoped to the single local user.
 *   `id` is the authenticator's Base64URLString credential id (the lookup key on login), stored
 *   verbatim. `public_key` is the COSE key base64url-encoded (isoBase64URL.fromBuffer), decoded
 *   back to a Uint8Array before verifyAuthenticationResponse. `counter` is bumped to
 *   authenticationInfo.newCounter after each verified assertion (clone-detection). Credential
 *   names are unique per user, case-insensitively (repo convention).
 *
 * webauthn_challenges: short-lived, single-use registration/authentication challenges. The
 *   options endpoint stores the base64url challenge keyed by an opaque uuid handle carried in a
 *   short-lived httpOnly cookie; the verify endpoint consumes (select-then-delete) it and passes
 *   it as expectedChallenge. `user_id` is set for register (authenticated) and NULL for the
 *   pre-login authentication ceremony. Expired rows are pruned lazily + at startup.
 */
export const migration: Migration = {
  version: 20260717,
  name: 'Create webauthn credentials and challenges tables',

  up: `
		CREATE TABLE webauthn_credentials (
			id               TEXT PRIMARY KEY,
			user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			public_key       TEXT NOT NULL,
			counter          INTEGER NOT NULL DEFAULT 0,
			transports       TEXT,
			device_type      TEXT NOT NULL DEFAULT 'singleDevice' CHECK (device_type IN ('singleDevice', 'multiDevice')),
			backed_up        INTEGER NOT NULL DEFAULT 0,
			webauthn_user_id TEXT NOT NULL,
			aaguid           TEXT,
			name             TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0 AND LENGTH(name) <= 100),
			created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_used_at     TEXT
		);

		CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);
		CREATE UNIQUE INDEX idx_webauthn_credentials_name ON webauthn_credentials(user_id, name COLLATE NOCASE);

		CREATE TABLE webauthn_challenges (
			id         TEXT PRIMARY KEY,
			challenge  TEXT NOT NULL,
			purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate')),
			user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
	`,

  down: `
		DROP INDEX IF EXISTS idx_webauthn_challenges_expires;
		DROP TABLE IF EXISTS webauthn_challenges;
		DROP INDEX IF EXISTS idx_webauthn_credentials_name;
		DROP INDEX IF EXISTS idx_webauthn_credentials_user;
		DROP TABLE IF EXISTS webauthn_credentials;
	`,
};
