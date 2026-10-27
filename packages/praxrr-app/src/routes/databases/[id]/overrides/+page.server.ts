import { error } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import type { PageServerLoad } from './$types';
import { getCache, listOverrides } from '$pcd/index.ts';
import type { OverrideEntity, LastAction } from '$pcd/index.ts';

export const load: PageServerLoad = async ({ parent }) => {
  const { database } = await parent();
  const cache = getCache(database.id);

  if (!cache?.isBuilt()) {
    return {
      databaseId: database.id,
      entities: [] as OverrideEntity[],
      lastAction: null as LastAction | null,
      unmappedOpCount: 0,
      unavailable: true,
    };
  }

  try {
    const snapshot = await listOverrides(database.id);
    return {
      databaseId: database.id,
      entities: snapshot.entities,
      lastAction: snapshot.lastAction,
      unmappedOpCount: snapshot.unmappedOpCount,
      unavailable: false,
    };
  } catch (err) {
    await logger.error('Failed to load local overrides', {
      source: 'databases/overrides',
      meta: { databaseId: database.id, error: err instanceof Error ? err.message : String(err) },
    });
    if (err instanceof Error && err.message === `Database ${database.id} cache is not built`) {
      return {
        databaseId: database.id,
        entities: [] as OverrideEntity[],
        lastAction: null as LastAction | null,
        unmappedOpCount: 0,
        unavailable: true,
      };
    }
    throw error(500, 'Failed to load local overrides');
  }
};
