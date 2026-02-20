import { db } from '../db.ts';

export interface DatabaseInstanceCredential {
  instance_id: number;
  ciphertext: string;
  nonce: string;
  key_version: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDatabaseInstanceCredentialInput {
  instanceId: number;
  ciphertext: string;
  nonce: string;
  keyVersion: string;
}

export type DatabaseInstanceCredentialWriteInput = Omit<CreateDatabaseInstanceCredentialInput, 'instanceId'>;

/**
 * Queries for database_instance_credentials table
 */
export const databaseInstanceCredentialsQueries = {
  create(input: CreateDatabaseInstanceCredentialInput): void {
    db.execute(
      `INSERT INTO database_instance_credentials (instance_id, ciphertext, nonce, key_version)
       VALUES (?, ?, ?, ?)`,
      input.instanceId,
      input.ciphertext,
      input.nonce,
      input.keyVersion
    );
  },

  getByInstanceId(instanceId: number): DatabaseInstanceCredential | undefined {
    return db.queryFirst<DatabaseInstanceCredential>(
      'SELECT * FROM database_instance_credentials WHERE instance_id = ?',
      instanceId
    );
  },

  upsert(input: CreateDatabaseInstanceCredentialInput): void {
    db.execute(
      `INSERT INTO database_instance_credentials (instance_id, ciphertext, nonce, key_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         key_version = excluded.key_version,
         updated_at = CURRENT_TIMESTAMP`,
      input.instanceId,
      input.ciphertext,
      input.nonce,
      input.keyVersion
    );
  },

  deleteByInstanceId(instanceId: number): boolean {
    const affected = db.execute('DELETE FROM database_instance_credentials WHERE instance_id = ?', instanceId);
    return affected > 0;
  },
};
