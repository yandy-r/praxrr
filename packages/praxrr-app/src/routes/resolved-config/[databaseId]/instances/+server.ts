import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isArrAppType, type ArrAppType } from '$shared/arr/capabilities.ts';

interface ResolvedConfigInstanceOption {
  id: number;
  name: string;
  type: ArrAppType;
}

/**
 * GET /resolved-config/{databaseId}/instances
 *
 * Page-scoped support endpoint for the Live Diff panel's instance selector
 * (mirrors the `arr/test/+server.ts` precedent for route-colocated,
 * non-`/api/v1` handlers that back a single page rather than a public
 * contract). Returns only the fields the selector needs -- id, name, and arr
 * type -- never `api_key`/`url`/other credential-adjacent fields.
 * `arrInstancesQueries` already blanks `api_key` at the SQL layer; this
 * handler additionally omits every other field by construction.
 *
 * Only enabled instances are listed: a disabled instance is not a valid
 * live-diff target (sync never targets it either).
 *
 * `databaseId` is validated for route-shape consistency with sibling
 * `/resolved-config/[databaseId]/**` surfaces but is not otherwise used --
 * Arr instances are global, not scoped to a PCD database.
 */
export const GET: RequestHandler = async ({ params }) => {
  const databaseIdParam = params.databaseId;
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return json({ error: 'Invalid databaseId' }, { status: 400 });
  }

  const instances: ResolvedConfigInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isArrAppType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as ArrAppType,
    }));

  return json({ instances });
};
