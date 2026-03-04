import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';

type UiPreferenceMode = 'basic' | 'advanced';

/**
 * Load persisted section modes for a set of disclosure keys.
 * Returns a record mapping each key to its stored mode, defaulting
 * absent rows to `'basic'`.
 */
export function loadSectionModes(
  userId: number | undefined,
  sectionKeys: readonly string[]
): Record<string, UiPreferenceMode> {
  const modes: Record<string, UiPreferenceMode> = {};

  for (const key of sectionKeys) {
    modes[key] = 'basic';
  }

  if (!userId) {
    return modes;
  }

  for (const key of sectionKeys) {
    const preference = userInterfacePreferencesQueries.getByUserIdAndSectionKey(userId, key);
    if (preference?.mode) {
      modes[key] = preference.mode;
    }
  }

  return modes;
}
