import type { Migration } from '../migrations.ts';
import { db } from '../db.ts';
import { logger } from '$logger/logger.ts';
import { encryptDatabasePersonalAccessToken } from '$server/utils/encryption/database-credentials.ts';

interface DatabaseInstancePatRow {
  id: number;
  personal_access_token: string | null;
}

/**
 * Migration 20260222: Encrypt database personal access tokens
 *
 * - Creates `database_instance_credentials`
 * - Backfills legacy plaintext PAT values into encrypted credentials
 * - Clears plaintext PAT values in `database_instances.personal_access_token`
 * - Adds triggers to reject plaintext PAT writes going forward
 */
export const migration: Migration = {
  version: 20260222,
  name: 'Encrypt database personal access tokens',

  up: `
		CREATE TABLE IF NOT EXISTS database_instance_credentials (
			instance_id INTEGER PRIMARY KEY,
			ciphertext TEXT NOT NULL,
			nonce TEXT NOT NULL,
			key_version TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (instance_id) REFERENCES database_instances(id) ON DELETE CASCADE
		);

		CREATE TRIGGER IF NOT EXISTS trg_database_instances_reject_plain_pat_insert
		BEFORE INSERT ON database_instances
		WHEN NEW.personal_access_token IS NOT NULL AND TRIM(NEW.personal_access_token) != ''
		BEGIN
			SELECT RAISE(ABORT, 'Database PAT must be written to database_instance_credentials');
		END;

		CREATE TRIGGER IF NOT EXISTS trg_database_instances_reject_plain_pat_update
		BEFORE UPDATE OF personal_access_token ON database_instances
		WHEN NEW.personal_access_token IS NOT NULL AND TRIM(NEW.personal_access_token) != ''
		BEGIN
			SELECT RAISE(ABORT, 'Database PAT must be written to database_instance_credentials');
		END;
	`,

  afterUp: async () => {
    const instances = db.query<DatabaseInstancePatRow>(
      `
			SELECT id, personal_access_token
			FROM database_instances
			WHERE personal_access_token IS NOT NULL AND TRIM(personal_access_token) != ''
		`
    );

    for (const instance of instances) {
      const personalAccessToken = instance.personal_access_token?.trim();
      if (!personalAccessToken) {
        continue;
      }

      const encrypted = await encryptDatabasePersonalAccessToken(personalAccessToken);

      db.execute(
        `
				INSERT INTO database_instance_credentials (instance_id, ciphertext, nonce, key_version)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(instance_id) DO UPDATE SET
					ciphertext = excluded.ciphertext,
					nonce = excluded.nonce,
					key_version = excluded.key_version,
					updated_at = CURRENT_TIMESTAMP
			`,
        instance.id,
        encrypted.credential.ciphertext,
        encrypted.credential.nonce,
        encrypted.credential.keyVersion
      );

      db.execute('UPDATE database_instances SET personal_access_token = ? WHERE id = ?', '', instance.id);
    }

    if (instances.length > 0) {
      await logger.info('Backfilled database PAT credentials', {
        source: 'DatabaseMigrations',
        meta: { migratedCount: instances.length, migration: 20260222 },
      });
    }
  },
};
