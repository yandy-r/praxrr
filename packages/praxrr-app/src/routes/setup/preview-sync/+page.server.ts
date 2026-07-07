import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { pcdManager } from '$pcd/index.ts';

/**
 * The primary connected instance for the wizard: prefer an enabled instance
 * (the common case for a freshly-connected one), falling back to the first
 * instance if none is enabled yet. Mirrors select-profiles/+page.server.ts.
 */
function resolvePrimaryInstance() {
  return arrInstancesQueries.getEnabled()[0] ?? arrInstancesQueries.getAll()[0];
}

export const load: PageServerLoad = async () => {
  const instance = resolvePrimaryInstance();
  if (!instance) {
    throw redirect(303, '/setup/connect-arr');
  }

  const database = pcdManager.getAll()[0];
  if (!database) {
    throw redirect(303, '/setup/link-database');
  }

  const { selections } = arrSyncQueries.getQualityProfilesSync(instance.id);
  if (selections.length === 0) {
    throw redirect(303, '/setup/select-profiles');
  }

  return {
    instanceId: instance.id,
    instanceName: instance.name,
    selectionCount: selections.length,
  };
};
