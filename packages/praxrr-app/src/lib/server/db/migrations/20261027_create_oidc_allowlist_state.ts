import type { Migration } from '../migrations.ts';

/** Stores the last OIDC allowlist fingerprint used for startup session revocation. */
export const migration: Migration = {
  version: 20261027,
  name: 'Create OIDC allowlist state',

  up: `
		CREATE TABLE oidc_allowlist_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`,

  down: `
		DROP TABLE IF EXISTS oidc_allowlist_state;
	`,
};
