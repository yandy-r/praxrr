import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';
import type { SectionKey, UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';

/**
 * Load persisted section modes for a set of disclosure keys.
 * Returns a record mapping each key to its stored mode, defaulting
 * absent rows to `'basic'`.
 */
export function loadSectionModes<K extends SectionKey>(
  userId: number | undefined,
  sectionKeys: readonly K[]
): Record<K, UiPreferenceMode> {
  const modes = {} as Record<K, UiPreferenceMode>;

  for (const key of sectionKeys) {
    modes[key] = 'basic';
  }

  if (!userId) {
    return modes;
  }

  for (const key of sectionKeys) {
    try {
      const preference = userInterfacePreferencesQueries.getByUserIdAndSectionKey(userId, key);
      if (preference?.mode) {
        modes[key] = preference.mode;
      }
    } catch (error) {
      console.warn('Failed to load UI preference section mode', {
        userId,
        sectionKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return modes;
}
