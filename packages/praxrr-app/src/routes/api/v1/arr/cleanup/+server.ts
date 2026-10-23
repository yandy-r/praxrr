import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { BaseArrClient } from '$utils/arr/base.ts';
import { executeCleanup, scanForStaleItems } from '$lib/server/sync/cleanup.ts';
import { parseCleanupRequest } from '$lib/server/sync/cleanupRequest.ts';
import type { ArrType } from '$utils/arr/types.ts';

/**
 * POST /api/v1/arr/cleanup
 *
 * Scan or execute cleanup of stale namespace-suffixed configs.
 *
 * Body (scan):    { instanceId: number, action: 'scan', includeUnmanaged?: boolean }
 * Body (execute): { instanceId: number, action: 'execute', includeUnmanaged?: boolean, scanResult: CleanupScanResult }
 *
 * Execute re-scans server-side and deletes only requested items that are still stale
 * under the same scope. By default only entities recorded in the ownership ledger
 * (created by Praxrr) are considered; `includeUnmanaged: true` opts into the legacy
 * everything-unexpected-is-stale scope.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseCleanupRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, { status: 400 });
  }
  const cleanupRequest = parsed.request;

  const instance = arrInstancesQueries.getById(cleanupRequest.instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' }, { status: 404 });
  }

  let client: BaseArrClient | null = null;
  // Disable retries so "in use" HTTP 500 from the arr fails fast
  try {
    client = await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url, {
      retries: 0,
    });

    if (cleanupRequest.action === 'scan') {
      return json(await scanForStaleItems(client, cleanupRequest.instanceId, cleanupRequest.includeUnmanaged));
    }

    return json(
      await executeCleanup(
        client,
        cleanupRequest.instanceId,
        cleanupRequest.scanResult,
        cleanupRequest.includeUnmanaged
      )
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cleanup failed';
    return json({ error: message }, { status: 500 });
  } finally {
    if (client) {
      client.close();
    }
  }
};
