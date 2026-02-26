import { db } from '../db.ts';

function isUninitializedDatabaseError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Database not initialized');
}

function safeQueryFirst<T>(query: () => T | undefined): T | undefined {
  try {
    return query();
  } catch (error) {
    if (isUninitializedDatabaseError(error)) {
      return undefined;
    }

    throw error;
  }
}

export interface ArrInstanceCredential {
  instance_id: number;
  ciphertext: string;
  nonce: string;
  key_version: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface CreateArrInstanceCredentialInput {
  instanceId: number;
  ciphertext: string;
  nonce: string;
  keyVersion: string;
  fingerprint: string;
}

export type ArrInstanceCredentialWriteInput = Omit<CreateArrInstanceCredentialInput, 'instanceId'>;

export interface UpdateArrInstanceCredentialInput {
  ciphertext?: string;
  nonce?: string;
  keyVersion?: string;
  fingerprint?: string;
}

/**
 * Queries for arr_instance_credentials table
 */
export const arrInstanceCredentialsQueries = {
  create(input: CreateArrInstanceCredentialInput): void {
    db.execute(
      `INSERT INTO arr_instance_credentials (instance_id, ciphertext, nonce, key_version, fingerprint)
       VALUES (?, ?, ?, ?, ?)`,
      input.instanceId,
      input.ciphertext,
      input.nonce,
      input.keyVersion,
      input.fingerprint
    );
  },

  getByInstanceId(instanceId: number): ArrInstanceCredential | undefined {
    return safeQueryFirst(() =>
      db.queryFirst<ArrInstanceCredential>('SELECT * FROM arr_instance_credentials WHERE instance_id = ?', instanceId)
    );
  },

  getByFingerprint(fingerprint: string): ArrInstanceCredential | undefined {
    return safeQueryFirst(() =>
      db.queryFirst<ArrInstanceCredential>(
        'SELECT * FROM arr_instance_credentials WHERE fingerprint = ? LIMIT 1',
        fingerprint
      )
    );
  },

  getByAnyFingerprint(fingerprints: string[]): ArrInstanceCredential | undefined {
    if (fingerprints.length === 0) {
      return undefined;
    }

    const placeholders = fingerprints.map(() => '?').join(', ');
    return safeQueryFirst(() =>
      db.queryFirst<ArrInstanceCredential>(
        `SELECT * FROM arr_instance_credentials WHERE fingerprint IN (${placeholders}) LIMIT 1`,
        ...fingerprints
      )
    );
  },

  upsert(input: CreateArrInstanceCredentialInput): void {
    db.execute(
      `INSERT INTO arr_instance_credentials (instance_id, ciphertext, nonce, key_version, fingerprint)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         key_version = excluded.key_version,
         fingerprint = excluded.fingerprint,
         updated_at = CURRENT_TIMESTAMP`,
      input.instanceId,
      input.ciphertext,
      input.nonce,
      input.keyVersion,
      input.fingerprint
    );
  },

  update(instanceId: number, input: UpdateArrInstanceCredentialInput): boolean {
    const updates: string[] = [];
    const params: Array<string | number> = [];

    if (input.ciphertext !== undefined) {
      updates.push('ciphertext = ?');
      params.push(input.ciphertext);
    }
    if (input.nonce !== undefined) {
      updates.push('nonce = ?');
      params.push(input.nonce);
    }
    if (input.keyVersion !== undefined) {
      updates.push('key_version = ?');
      params.push(input.keyVersion);
    }
    if (input.fingerprint !== undefined) {
      updates.push('fingerprint = ?');
      params.push(input.fingerprint);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(instanceId);

    const affected = db.execute(
      `UPDATE arr_instance_credentials SET ${updates.join(', ')} WHERE instance_id = ?`,
      ...params
    );
    return affected > 0;
  },

  deleteByInstanceId(instanceId: number): boolean {
    const affected = db.execute('DELETE FROM arr_instance_credentials WHERE instance_id = ?', instanceId);
    return affected > 0;
  },
};
