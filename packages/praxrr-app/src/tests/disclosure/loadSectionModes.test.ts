import { assertEquals } from '@std/assert';
import {
  userInterfacePreferencesQueries,
  type UserInterfacePreference,
} from '$db/queries/user_interface_preferences.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { CF_CONDITIONS, CF_SCORING, type SectionKey, type UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';

type Restore = () => void;

type PreferenceQuery = (userId: number, sectionKey: SectionKey) => UserInterfacePreference | undefined;

function withGetByUserIdAndSectionKeyReplacement(replacement: PreferenceQuery): Restore {
  const original = userInterfacePreferencesQueries.getByUserIdAndSectionKey;
  userInterfacePreferencesQueries.getByUserIdAndSectionKey = replacement;

  return () => {
    userInterfacePreferencesQueries.getByUserIdAndSectionKey = original;
  };
}

Deno.test('loadSectionModes returns empty map when userId is undefined', () => {
  const restore = withGetByUserIdAndSectionKeyReplacement(() => {
    throw new Error('should not query preferences when no user is provided');
  });

  try {
    const keys = [CF_CONDITIONS, CF_SCORING] as const;
    const sectionModes = loadSectionModes(undefined, keys);

    assertEquals(sectionModes, {});
  } finally {
    restore();
  }
});

Deno.test('loadSectionModes returns only persisted modes for valid userId', () => {
  const storedMode: UiPreferenceMode = 'advanced';

  const restore = withGetByUserIdAndSectionKeyReplacement((userId, sectionKey) => {
    if (userId === 3 && sectionKey === CF_CONDITIONS) {
      return {
        userId,
        sectionKey,
        mode: storedMode,
        updatedAt: new Date().toISOString(),
      };
    }

    return undefined;
  });

  try {
    const sectionModes = loadSectionModes(3, [CF_CONDITIONS, CF_SCORING]);

    assertEquals(sectionModes, {
      [CF_CONDITIONS]: 'advanced',
    });
  } finally {
    restore();
  }
});

Deno.test('loadSectionModes returns empty map for empty sectionKeys input', () => {
  const sectionModes = loadSectionModes(99, []);
  assertEquals(sectionModes, {});
});

Deno.test('loadSectionModes returns empty map when preference query throws', () => {
  const restore = withGetByUserIdAndSectionKeyReplacement(() => {
    throw new Error('simulated database failure');
  });

  try {
    const sectionModes = loadSectionModes(1, [CF_SCORING]);

    assertEquals(sectionModes, {});
  } finally {
    restore();
  }
});
