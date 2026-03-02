import { db } from '../db.ts';

export interface UserInterfacePreference {
  userId: number;
  sectionKey: string;
  mode: 'basic' | 'advanced';
  updatedAt: string;
}

export interface UserInterfacePreferenceInput {
  userId: number;
  sectionKey: string;
  mode: 'basic' | 'advanced';
}

interface UserInterfacePreferenceRow {
  user_id: number;
  section_key: string;
  mode: 'basic' | 'advanced';
  updated_at: string;
}

const SECTION_KEY_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;
const SECTION_KEY_MAX_LENGTH = 96;

function rowToPreference(row: UserInterfacePreferenceRow): UserInterfacePreference {
  return {
    userId: row.user_id,
    sectionKey: row.section_key,
    mode: row.mode,
    updatedAt: row.updated_at,
  };
}

function assertSectionKey(sectionKey: string): void {
  if (sectionKey.length > SECTION_KEY_MAX_LENGTH) {
    throw new Error(`Invalid disclosure section key format: ${sectionKey}`);
  }

  if (!SECTION_KEY_PATTERN.test(sectionKey)) {
    throw new Error(`Invalid disclosure section key format: ${sectionKey}`);
  }
}

export const userInterfacePreferencesQueries = {
  /**
   * Validate a section key against the canonical route-family key format.
   */
  isValidSectionKey(sectionKey: string): boolean {
    return SECTION_KEY_PATTERN.test(sectionKey);
  },

  /**
   * Get a single preference for a user and section key.
   */
  getByUserIdAndSectionKey(userId: number, sectionKey: string): UserInterfacePreference | undefined {
    assertSectionKey(sectionKey);

    const row = db.queryFirst<UserInterfacePreferenceRow>(
      'SELECT * FROM user_interface_preferences WHERE user_id = ? AND section_key = ?',
      userId,
      sectionKey
    );

    return row ? rowToPreference(row) : undefined;
  },

  /**
   * List all preferences for a user.
   */
  getByUserId(userId: number): UserInterfacePreference[] {
    return db
      .query<UserInterfacePreferenceRow>(
        'SELECT * FROM user_interface_preferences WHERE user_id = ? ORDER BY section_key',
        userId
      )
      .map(rowToPreference);
  },

  /**
   * Create or update a preference value.
   * Writes are idempotent: if mode matches current state, no DB write occurs.
   */
  upsert(input: UserInterfacePreferenceInput): UserInterfacePreference {
    assertSectionKey(input.sectionKey);

    const existing = this.getByUserIdAndSectionKey(input.userId, input.sectionKey);
    if (existing && existing.mode === input.mode) {
      return existing;
    }

    if (existing) {
      db.execute(
        `UPDATE user_interface_preferences SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND section_key = ?`,
        input.mode,
        input.userId,
        input.sectionKey
      );
    } else {
      db.execute(
        'INSERT INTO user_interface_preferences (user_id, section_key, mode) VALUES (?, ?, ?)',
        input.userId,
        input.sectionKey,
        input.mode
      );
    }

    const updated = this.getByUserIdAndSectionKey(input.userId, input.sectionKey);
    if (!updated) {
      throw new Error('Failed to persist user interface preference');
    }

    return updated;
  },
};
