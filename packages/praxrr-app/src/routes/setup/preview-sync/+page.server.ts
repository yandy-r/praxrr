import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { pcdManager } from '$pcd/index.ts';
import { resolvePrimaryInstance } from '$server/setup/progress.ts';

export const load: PageServerLoad = async () => {
  const instance = resolvePrimaryInstance();
  if (!instance) {
    throw redirect(303, '/setup/connect-arr');
  }

  const database = pcdManager.getAll()[0];
  if (!database) {
    throw redirect(303, '/setup/link-database');
  }

  // Zero selections is a supported path (select-profiles allows advancing with
  // none chosen) — render an explicit "nothing to sync" state instead of
  // bouncing back, which would trap the user in a redirect loop.
  const { selections } = arrSyncQueries.getQualityProfilesSync(instance.id);

  return {
    instanceId: instance.id,
    instanceName: instance.name,
    selectionCount: selections.length,
  };
};
