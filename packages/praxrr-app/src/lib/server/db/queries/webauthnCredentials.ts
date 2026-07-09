import { db } from '../db.ts';

/**
 * A stored passkey credential row (webauthn_credentials).
 */
export interface WebAuthnCredentialRow {
  id: string;
  user_id: number;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: number;
  webauthn_user_id: string;
  aaguid: string | null;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Input for persisting a newly registered credential.
 */
export interface CreateWebAuthnCredentialInput {
  id: string;
  userId: number;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  webauthnUserId: string;
  aaguid: string | null;
  name: string;
}

/**
 * All queries for the webauthn_credentials table.
 * Single-user app, but the user may register multiple passkeys (phone, laptop, security key).
 */
export const webauthnCredentialsQueries = {
  /**
   * Persist a verified registration. The primary key is the authenticator-provided credential id.
   * Throws (UNIQUE constraint) if the name already exists for the user (case-insensitive).
   */
  create(input: CreateWebAuthnCredentialInput): WebAuthnCredentialRow {
    db.execute(
      `INSERT INTO webauthn_credentials
			 (id, user_id, public_key, counter, transports, device_type, backed_up, webauthn_user_id, aaguid, name)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.userId,
      input.publicKey,
      input.counter,
      input.transports ? JSON.stringify(input.transports) : null,
      input.deviceType,
      input.backedUp ? 1 : 0,
      input.webauthnUserId,
      input.aaguid,
      input.name
    );

    const row = this.getById(input.id);
    if (!row) {
      throw new Error('Failed to persist webauthn credential');
    }
    return row;
  },

  /**
   * Get a credential by its (authenticator-provided) id, regardless of owner.
   */
  getById(id: string): WebAuthnCredentialRow | undefined {
    return db.queryFirst<WebAuthnCredentialRow>('SELECT * FROM webauthn_credentials WHERE id = ?', id);
  },

  /**
   * All credentials for a user, oldest first (stable ordering for the management UI).
   */
  listByUserId(userId: number): WebAuthnCredentialRow[] {
    return db.query<WebAuthnCredentialRow>(
      'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC, id ASC',
      userId
    );
  },

  /**
   * Count credentials for a user.
   */
  countByUserId(userId: number): number {
    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ?',
      userId
    );
    return result?.count ?? 0;
  },

  /**
   * Count all credentials (single-user "does any passkey exist?" gate for the login page).
   */
  count(): number {
    const result = db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM webauthn_credentials');
    return result?.count ?? 0;
  },

  /**
   * Case-insensitive existence check for a credential name within a user's set.
   */
  existsByNameForUser(userId: number, name: string): boolean {
    const result = db.queryFirst<{ count: number }>(
      'SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ? AND name = ? COLLATE NOCASE',
      userId,
      name
    );
    return (result?.count ?? 0) > 0;
  },

  /**
   * Rename a credential (scoped to its owner). Returns rows affected.
   */
  rename(id: string, userId: number, name: string): number {
    return db.execute(
      'UPDATE webauthn_credentials SET name = ? WHERE id = ? AND user_id = ?',
      name,
      id,
      userId
    );
  },

  /**
   * Update the signature counter and stamp last_used_at after a verified assertion.
   */
  updateCounter(id: string, newCounter: number): number {
    return db.execute(
      'UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      newCounter,
      id
    );
  },

  /**
   * Delete a credential (scoped to its owner). Returns rows affected.
   */
  deleteById(id: string, userId: number): number {
    return db.execute('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?', id, userId);
  },
};
