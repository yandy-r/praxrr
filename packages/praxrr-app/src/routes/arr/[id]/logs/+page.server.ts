import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { ArrType } from '$arr/types.ts';

export const load: ServerLoad = async ({ params, url }) => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  // Parse query params for pagination/filtering
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
  const level = url.searchParams.get('level') || undefined;

  const client = await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url);

  try {
    const logs = await client.getLogs({
      page,
      pageSize,
      sortKey: 'time',
      sortDirection: 'descending',
      level: level as 'Trace' | 'Debug' | 'Info' | 'Warn' | 'Error' | 'Fatal' | undefined,
    });

    return {
      instance,
      logs,
      filters: {
        page,
        pageSize,
        level,
      },
    };
  } catch (err) {
    error(500, `Failed to fetch logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    client.close();
  }
};
