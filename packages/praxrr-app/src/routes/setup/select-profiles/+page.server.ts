import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { arrSyncQueries, type ProfileSelection } from '$db/queries/arrSync.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { pcdManager } from '$pcd/index.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import { getArrAppMetadata, isArrAppType } from '$shared/arr/capabilities.ts';
import { logger } from '$logger/logger.ts';
import { resolvePrimaryInstance } from '$server/setup/progress.ts';

export const load: PageServerLoad = async () => {
  const instance = resolvePrimaryInstance();
  if (!instance) {
    throw redirect(303, '/setup/connect-arr');
  }

  // Cross-Arr policy: resolve strictly by this instance's own arr_type, never
  // by a sibling app's semantics.
  if (!isArrAppType(instance.type)) {
    throw error(500, `Unsupported arr_type for instance "${instance.name}": ${instance.type}`);
  }
  const arrType = instance.type;

  const database = pcdManager.getAll()[0];
  if (!database) {
    throw redirect(303, '/setup/link-database');
  }

  const cache = pcdManager.getCache(database.id);
  if (!cache) {
    throw redirect(303, '/setup/link-database');
  }

  // Mirrors qualityProfiles/list.ts's arr_type compatibility filter: scoped by
  // quality_api_mappings, never by arr_type = 'all' scores, never gated on
  // enabled = 1.
  const profiles = await qualityProfileQueries.list(cache, arrType);

  const existingSelections = arrSyncQueries.getQualityProfilesSync(instance.id).selections;
  const selectedProfileNames = existingSelections
    .filter((selection) => selection.databaseId === database.id)
    .map((selection) => selection.profileName);

  return {
    instanceId: instance.id,
    arrType,
    arrTypeLabel: getArrAppMetadata(arrType).label,
    databaseId: database.id,
    databaseName: database.name,
    profiles: profiles.map((profile) => ({
      name: profile.name,
      description: profile.description,
      customFormatCount: profile.custom_formats.total,
    })),
    selectedProfileNames,
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const instance = resolvePrimaryInstance();
    if (!instance) {
      return fail(400, { error: 'No connected arr instance' });
    }

    const database = pcdManager.getAll()[0];
    if (!database) {
      return fail(400, { error: 'No linked configuration database' });
    }

    const formData = await request.formData();
    const selectedJson = (formData.get('selectedProfileNames') as string | null) ?? '[]';

    let selectedProfileNames: string[];
    try {
      const parsed: unknown = JSON.parse(selectedJson);
      if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === 'string')) {
        return fail(400, { error: 'selectedProfileNames must be an array of strings' });
      }
      selectedProfileNames = parsed;
    } catch {
      return fail(400, { error: 'selectedProfileNames must be valid JSON' });
    }

    const selections: ProfileSelection[] = selectedProfileNames.map((profileName) => ({
      databaseId: database.id,
      profileName,
    }));

    try {
      // Allow zero selections — the wizard should not force a choice here.
      arrSyncQueries.saveQualityProfilesSync(instance.id, selections, { trigger: 'manual', cron: null });

      await logger.info(`Quality profile selections saved for "${instance.name}" during setup`, {
        source: 'setup',
        meta: { instanceId: instance.id, databaseId: database.id, profileCount: selections.length },
      });
    } catch (e) {
      await logger.error('Failed to save quality profile selections during setup', {
        source: 'setup',
        meta: { instanceId: instance.id, error: e },
      });
      return fail(500, { error: 'Failed to save quality profile selections' });
    }

    setupStateQueries.setWizardStep('preview-sync');
    throw redirect(303, '/setup/preview-sync');
  },
};
