import { db } from '../db.ts';
import { isApiTokenScope, type ApiTokenScope, type ApiTokenSummary } from '$shared/auth/apiTokenScopes.ts';

/**
 * Raw api_tokens row. `token_hash` never leaves this module: every public query maps to the
 * client-safe {@link ApiTokenSummary}.
 */
interface ApiTokenRow {
  id: number;
  name: string;
  token_hash: string;
  prefix: string;
  scopes: string;
  is_legacy: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CreateApiTokenInput {
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: ApiTokenScope[];
  /** `YYYY-MM-DD HH:MM:SS` UTC (CURRENT_TIMESTAMP format), or null for never. */
  expiresAt: string | null;
  isLegacy?: boolean;
}

const SUMMARY_COLUMNS =
  'id, name, token_hash, prefix, scopes, is_legacy, created_at, last_used_at, expires_at, revoked_at';

/** SQL predicate for a usable token; evaluated by SQLite so expiry uses its own clock/format. */
const ACTIVE_PREDICATE = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)';

/** Current UTC time in SQLite `CURRENT_TIMESTAMP` format, for status computation. */
function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Parse the stored JSON scopes defensively; unknown or malformed values are dropped. */
function parseScopes(raw: string): ApiTokenScope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter(isApiTokenScope))];
}

function toSummary(row: ApiTokenRow, now: string): ApiTokenSummary {
  const status =
    row.revoked_at !== null ? 'revoked' : row.expires_at !== null && row.expires_at <= now ? 'expired' : 'active';
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    isLegacy: row.is_legacy === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status,
  };
}

/**
 * All queries for the api_tokens table.
 */
export const apiTokensQueries = {
  /** Every token, newest first, including revoked and expired ones. */
  list(): ApiTokenSummary[] {
    const now = sqliteNow();
    return db
      .query<ApiTokenRow>(`SELECT ${SUMMARY_COLUMNS} FROM api_tokens ORDER BY created_at DESC, id DESC`)
      .map((row) => toSummary(row, now));
  },

  create(input: CreateApiTokenInput): ApiTokenSummary {
    db.execute(
      `INSERT INTO api_tokens (name, token_hash, prefix, scopes, is_legacy, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.name,
      input.tokenHash,
      input.prefix,
      JSON.stringify(input.scopes),
      input.isLegacy ? 1 : 0,
      input.expiresAt
    );
    const row = db.queryFirst<ApiTokenRow>(`SELECT ${SUMMARY_COLUMNS} FROM api_tokens WHERE id = last_insert_rowid()`);
    if (!row) {
      throw new Error('Failed to read back created API token');
    }
    return toSummary(row, sqliteNow());
  },

  /** Lookup by hash; only tokens that are neither revoked nor expired match. */
  findActiveByHash(tokenHash: string): ApiTokenSummary | undefined {
    const row = db.queryFirst<ApiTokenRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM api_tokens WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`,
      tokenHash
    );
    return row ? toSummary(row, sqliteNow()) : undefined;
  },

  /** True when the token id exists and is neither revoked nor expired. */
  isActiveById(id: number): boolean {
    return (
      db.queryFirst<{ id: number }>(`SELECT id FROM api_tokens WHERE id = ? AND ${ACTIVE_PREDICATE}`, id) !== undefined
    );
  },

  /** Record use; a single conditional UPDATE throttles writes to one per 60s per token. */
  touchLastUsed(id: number): void {
    db.execute(
      `UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-60 seconds'))`,
      id
    );
  },

  /** Revoke a token. False when it does not exist or is already revoked. */
  revoke(id: number): boolean {
    return (
      db.execute('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL', id) > 0
    );
  },

  hasActiveLegacy(): boolean {
    const row = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) AS count FROM api_tokens WHERE is_legacy = 1 AND ${ACTIVE_PREDICATE}`
    );
    return (row?.count ?? 0) > 0;
  },

  countActive(): number {
    return (
      db.queryFirst<{ count: number }>(`SELECT COUNT(*) AS count FROM api_tokens WHERE ${ACTIVE_PREDICATE}`)?.count ?? 0
    );
  },
};
