import { db } from '../db.ts';
import { userInterfacePreferencesQueries } from './user_interface_preferences.ts';

/** Username prefix marking an OIDC-sourced identity (exact lowercase, as written by getOrCreateOidcUser). */
export const OIDC_USERNAME_PREFIX = 'oidc:';

/** Password hash placeholder marking a passwordless OIDC account. */
export const OIDC_PASSWORD_PLACEHOLDER = 'OIDC_NO_PASSWORD';

/** True only for usernames written by getOrCreateOidcUser (case-sensitive). */
export function isOidcUsername(username: string): boolean {
  return username.startsWith(OIDC_USERNAME_PREFIX);
}

/** An OIDC identity: exact `oidc:` username prefix AND the passwordless placeholder hash. */
export function isOidcUser(u: Pick<User, 'username' | 'password_hash'>): boolean {
  return isOidcUsername(u.username) && u.password_hash === OIDC_PASSWORD_PLACEHOLDER;
}

/** Local usernames may not claim the oidc: prefix in any casing. */
export function isReservedLocalUsername(username: string): boolean {
  return /^oidc:/i.test(username);
}

/**
 * Types for users table
 */
export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/**
 * All queries for users table
 * Single admin user - no multi-user support
 */
export const usersQueries = {
  /**
   * Check if any users exist (for first-run setup detection)
   */
  exists(): boolean {
    const result = db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return (result?.count ?? 0) > 0;
  },

  /**
   * Check if any local (non-OIDC) users exist
   * OIDC users are rows with the exact 'oidc:' prefix AND the placeholder hash
   */
  existsLocal(): boolean {
    const result = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM users WHERE NOT (substr(username, 1, 5) = 'oidc:' AND password_hash = '${OIDC_PASSWORD_PLACEHOLDER}')`
    );
    return (result?.count ?? 0) > 0;
  },

  /**
   * Get user by ID
   */
  getById(id: number): User | undefined {
    return db.queryFirst<User>('SELECT * FROM users WHERE id = ?', id);
  },

  /**
   * Get user by username
   */
  getByUsername(username: string): User | undefined {
    return db.queryFirst<User>('SELECT * FROM users WHERE username = ?', username);
  },

  /**
   * Get all usernames (for login analysis - typo detection)
   * Excludes OIDC users (prefix + placeholder hash) since they can't login with password
   */
  getAllUsernames(): string[] {
    const results = db.query<{ username: string }>(
      `SELECT username FROM users WHERE NOT (substr(username, 1, 5) = 'oidc:' AND password_hash = '${OIDC_PASSWORD_PLACEHOLDER}')`
    );
    return results.map((r) => r.username);
  },

  /**
   * Create a new local user (should only be called once during setup)
   * Rejects usernames that claim the reserved oidc: prefix in any casing
   */
  create(username: string, passwordHash: string): number {
    if (isReservedLocalUsername(username)) {
      throw new Error('Username uses the reserved oidc: prefix');
    }

    db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, passwordHash);

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    return result?.id ?? 0;
  },

  /**
   * Update user's password
   */
  updatePassword(id: number, passwordHash: string): boolean {
    const affected = db.execute(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      passwordHash,
      id
    );
    return affected > 0;
  },

  /**
   * Update username
   * Rejects usernames that claim the reserved oidc: prefix in any casing
   */
  updateUsername(id: number, username: string): boolean {
    if (isReservedLocalUsername(username)) {
      throw new Error('Username uses the reserved oidc: prefix');
    }

    const affected = db.execute(
      'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      username,
      id
    );
    return affected > 0;
  },

  /**
   * Get or create OIDC user
   * OIDC users have no password (placeholder hash); refuses to reuse a local account's username
   */
  getOrCreateOidcUser(identifier: string): number {
    const username = `oidc:${identifier}`;
    const existing = this.getByUsername(username);
    if (existing) {
      if (!isOidcUser(existing)) {
        throw new Error(`Username '${username}' is occupied by a local account`);
      }
      return existing.id;
    }

    // Create with placeholder - OIDC users can't login with password
    db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, OIDC_PASSWORD_PLACEHOLDER);

    const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');
    return result?.id ?? 0;
  },
};

export { userInterfacePreferencesQueries };
