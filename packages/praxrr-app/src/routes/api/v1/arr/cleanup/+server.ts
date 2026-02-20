import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { BaseArrClient } from '$utils/arr/base.ts';
import { scanForStaleItems, deleteStaleItems } from '$lib/server/sync/cleanup.ts';
import type { ArrType } from '$utils/arr/types.ts';

/**
 * POST /api/v1/arr/cleanup
 *
 * Scan or execute cleanup of stale namespace-suffixed configs.
 *
 * Body (scan):    { instanceId: number, action: 'scan' }
 * Body (execute): { instanceId: number, action: 'execute', scanResult: CleanupScanResult }
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { instanceId, action } = body;

  if (!instanceId || typeof instanceId !== 'number') {
    return json({ error: 'instanceId is required' }, { status: 400 });
  }

  if (action !== 'scan' && action !== 'execute') {
    return json({ error: 'action must be "scan" or "execute"' }, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' }, { status: 404 });
  }

  let client: BaseArrClient | null = null;
  // Disable retries so "in use" HTTP 500 from the arr fails fast
  try {
    client = await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url, {
      retries: 0,
    });

    if (action === 'scan') {
      const result = await scanForStaleItems(client, instanceId);
      return json(result);
    }

    // action === 'execute'
    const { scanResult } = body;
    if (!scanResult) {
      return json({ error: 'scanResult is required for execute action' }, { status: 400 });
    }

    const result = await deleteStaleItems(client, scanResult);
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cleanup failed';
    return json({ error: message }, { status: 500 });
  } finally {
    if (client) {
      client.close();
    }
  }
};
