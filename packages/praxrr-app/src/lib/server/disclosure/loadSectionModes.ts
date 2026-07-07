import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';
import type { SectionKey, UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';

/**
 * Load persisted section modes for a set of disclosure keys.
 * Returns only keys with stored preferences (mirrors API `persisted: true`).
 */
export function loadSectionModes<K extends SectionKey>(
  userId: number | undefined,
  sectionKeys: readonly K[]
): Partial<Record<K, UiPreferenceMode>> {
  const modes = {} as Partial<Record<K, UiPreferenceMode>>;

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
