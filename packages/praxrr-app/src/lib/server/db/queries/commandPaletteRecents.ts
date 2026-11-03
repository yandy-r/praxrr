import { db } from '../db.ts';
import { sanitizeCommandPaletteRecents, type CommandPaletteRecent } from '$shared/search/recents.ts';

interface CommandPaletteRecentsRow {
  recents_json: string;
  updated_at: string;
}

/** A user's stored recents plus the row's `updated_at` concurrency token (`null` when no row exists). */
export interface StoredCommandPaletteRecents {
  recents: CommandPaletteRecent[];
  updatedAt: string | null;
}

/**
 * Guard for {@link commandPaletteRecentsQueries.replace}:
 * - `undefined`: unconditional write.
 * - `null`: write only if the user has no row yet.
 * - string: write only if the row's `updated_at` still equals it.
 */
export type RecentsWriteGuard = string | null | undefined;

/** Next `updated_at`, always different from `previous` so two writes in one millisecond get distinct tokens. */
function nextUpdatedAt(previous: string | null): string {
  const now = new Date();
  if (previous === null || now.toISOString() !== previous) return now.toISOString();
  return new Date(now.getTime() + 1).toISOString();
}

/**
 * Per-user command palette recents (`user_command_palette_recents`). One row per user holding a
 * JSON array that the route validates before writing; `updated_at` is the optimistic concurrency token.
 */
export const commandPaletteRecentsQueries = {
  /**
   * Read a user's recents and concurrency token. Malformed JSON and invalid entries degrade to the
   * sanitized subset (possibly `[]`) instead of throwing; the token is still returned.
   */
  getByUserId(userId: number): StoredCommandPaletteRecents {
    const row = db.queryFirst<CommandPaletteRecentsRow>(
      'SELECT recents_json, updated_at FROM user_command_palette_recents WHERE user_id = ?',
      userId
    );
    if (!row) return { recents: [], updatedAt: null };

    try {
      return { recents: sanitizeCommandPaletteRecents(JSON.parse(row.recents_json)), updatedAt: row.updated_at };
    } catch {
      return { recents: [], updatedAt: row.updated_at };
    }
  },

  /**
   * Replace a user's recents with an already-validated list, honoring `guard`. Returns the new
   * `updated_at`, or `null` when the guard no longer matches the stored row (nothing written).
   */
  replace(userId: number, recents: readonly CommandPaletteRecent[], guard: RecentsWriteGuard): string | null {
    const previous =
      db.queryFirst<Pick<CommandPaletteRecentsRow, 'updated_at'>>(
        'SELECT updated_at FROM user_command_palette_recents WHERE user_id = ?',
        userId
      )?.updated_at ?? null;
    const updatedAt = nextUpdatedAt(previous);
    const recentsJson = JSON.stringify(recents);

    if (guard === undefined) {
      db.execute(
        `INSERT INTO user_command_palette_recents (user_id, recents_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           recents_json = excluded.recents_json,
           updated_at = excluded.updated_at`,
        userId,
        recentsJson,
        updatedAt
      );
      return updatedAt;
    }

    const changes =
      guard === null
        ? db.execute(
            `INSERT INTO user_command_palette_recents (user_id, recents_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO NOTHING`,
            userId,
            recentsJson,
            updatedAt
          )
        : db.execute(
            `UPDATE user_command_palette_recents
             SET recents_json = ?, updated_at = ?
             WHERE user_id = ? AND updated_at = ?`,
            recentsJson,
            updatedAt,
            userId,
            guard
          );
    return changes > 0 ? updatedAt : null;
  },
};
