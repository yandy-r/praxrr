import { db } from '../db.ts';
import { sanitizeCommandPaletteRecents, type CommandPaletteRecent } from '$shared/search/recents.ts';

interface CommandPaletteRecentsRow {
  recents_json: string;
}

/**
 * Per-user command palette recents (`user_command_palette_recents`). One row per user holding a
 * JSON array that the route validates before writing.
 */
export const commandPaletteRecentsQueries = {
  /**
   * Read a user's recents. Missing rows, malformed JSON, and invalid entries degrade to the
   * sanitized subset (possibly `[]`) instead of throwing.
   */
  getByUserId(userId: number): CommandPaletteRecent[] {
    const row = db.queryFirst<CommandPaletteRecentsRow>(
      'SELECT recents_json FROM user_command_palette_recents WHERE user_id = ?',
      userId
    );
    if (!row) return [];

    try {
      return sanitizeCommandPaletteRecents(JSON.parse(row.recents_json));
    } catch {
      return [];
    }
  },

  /**
   * Replace a user's recents with an already-validated list.
   */
  replace(userId: number, recents: readonly CommandPaletteRecent[]): void {
    db.execute(
      `INSERT INTO user_command_palette_recents (user_id, recents_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         recents_json = excluded.recents_json,
         updated_at = excluded.updated_at`,
      userId,
      JSON.stringify(recents),
      new Date().toISOString()
    );
  },
};
