import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { isArrAppType, type ArrAppType } from '$shared/arr/capabilities.ts';

interface ResolvedConfigInstanceOption {
  id: number;
  name: string;
  type: ArrAppType;
}

/**
 * Instance options for the Live Diff / Compare Instances panel selectors. Returns only
 * the fields those selectors need -- id, name, and arr type -- never `api_key`/`url`/
 * other credential-adjacent fields. `arrInstancesQueries` already blanks `api_key` at the
 * SQL layer; this additionally omits every other field by construction.
 *
 * Only enabled instances are listed: a disabled instance is not a valid live-diff/compare
 * target (sync never targets it either). Instances are global, not scoped to a PCD
 * database, so this does not depend on `databaseId`.
 */
function getResolvedConfigInstanceOptions(): ResolvedConfigInstanceOption[] {
  return arrInstancesQueries
    .getEnabled()
    .filter((instance) => isArrAppType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as ArrAppType,
    }));
}

/**
 * Resolved Config Viewer route load.
 *
 * Mirrors the parity-map load pattern (validate -> inline `{ error? }` in data, never
 * throw a SvelteKit error page) but resolves `databaseId` from the path param (this
 * route is `/resolved-config/[databaseId]`) rather than a `?databaseId=` query param.
 *
 * Entity-type/name selection and the resolved-state fetch itself happen client-side in
 * +page.svelte against the `/api/v1/pcd/{databaseId}/resolved/**` endpoints -- this load
 * only supplies the database picker, the Arr instance options for the Live Diff/Compare
 * Instances panels, and validates the selected database is usable.
 */
export const load: ServerLoad = ({ params }) => {
  const databases = pcdManager.getAll().map((database) => ({
    id: database.id,
    name: database.name,
  }));
  const instances = getResolvedConfigInstanceOptions();

  const databaseIdParam = params.databaseId;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return {
      databases,
      instances,
      selectedDatabaseId: null,
      error: 'Invalid database ID',
    };
  }

  const selectedDatabaseId = Number.parseInt(databaseIdParam, 10);

  const selectedDatabase = databases.find((database) => database.id === selectedDatabaseId);
  if (!selectedDatabase) {
    return {
      databases,
      instances,
      selectedDatabaseId,
      error: 'Database not found',
    };
  }

  const cache = pcdManager.getCache(selectedDatabaseId);
  if (!cache?.isBuilt()) {
    return {
      databases,
      instances,
      selectedDatabaseId,
      error: 'Database cache not available',
    };
  }

  return { databases, instances, selectedDatabaseId, error: undefined };
};
