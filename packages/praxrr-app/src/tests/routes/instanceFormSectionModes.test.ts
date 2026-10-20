import { assertEquals } from '@std/assert';
import {
  userInterfacePreferencesQueries,
  type UserInterfacePreference,
} from '$db/queries/user_interface_preferences.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { ARR_CONNECTION_DETAILS, type SectionKey } from '$shared/disclosure/sectionKeys.ts';
import { load as arrNewLoad } from '../../routes/arr/new/+page.server.ts';
import { load as connectArrLoad } from '../../routes/setup/connect-arr/+page.server.ts';

type Restore = () => void;

/**
 * Regression: InstanceForm reads `$page.data.arrSettingsSectionModes[ARR_CONNECTION_DETAILS]`
 * unconditionally, so every loader rendering it in create mode (`/arr/new`,
 * `/setup/connect-arr`) must supply the map — otherwise SSR 500s.
 */
function installPatches(): Restore {
  const originalPreference = userInterfacePreferencesQueries.getByUserIdAndSectionKey;
  const originalGetAll = arrInstancesQueries.getAll;

  userInterfacePreferencesQueries.getByUserIdAndSectionKey = (
    userId: number,
    sectionKey: SectionKey
  ): UserInterfacePreference | undefined =>
    userId === 5 && sectionKey === ARR_CONNECTION_DETAILS
      ? { userId, sectionKey, mode: 'advanced', updatedAt: '2026-01-01T00:00:00.000Z' }
      : undefined;
  arrInstancesQueries.getAll = (): ArrInstance[] => [];

  return () => {
    userInterfacePreferencesQueries.getByUserIdAndSectionKey = originalPreference;
    arrInstancesQueries.getAll = originalGetAll;
  };
}

// Only `locals.user.id` is read by these loaders.
const loadEvent = { locals: { user: { id: 5 }, session: null, authBypass: false } };

Deno.test('create-mode InstanceForm loaders supply arrSettingsSectionModes', async () => {
  const restore = installPatches();

  try {
    const arrNew = await arrNewLoad(loadEvent as unknown as Parameters<typeof arrNewLoad>[0]);
    const connectArr = await connectArrLoad(loadEvent as unknown as Parameters<typeof connectArrLoad>[0]);

    for (const data of [arrNew, connectArr]) {
      if (!data || !('arrSettingsSectionModes' in data)) {
        throw new Error('loader did not return arrSettingsSectionModes');
      }
      assertEquals(data.arrSettingsSectionModes, { [ARR_CONNECTION_DETAILS]: 'advanced' });
    }
  } finally {
    restore();
  }
});
