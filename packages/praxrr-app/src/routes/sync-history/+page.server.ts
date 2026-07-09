import type { ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { syncHistoryQueries, type SyncHistoryFilters, type SyncHistorySummary } from '$db/queries/syncHistory.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType } from '$sync/preview/types.ts';

/** Eligible instance picker option (id/name/type only — never credentials). */
interface SyncHistoryInstanceOption {
  id: number;
  name: string;
  type: SyncPreviewArrType;
}

/** Typed shape returned by the sync-history list load. */
interface SyncHistoryPageData {
  rows: SyncHistorySummary[];
  total: number;
  page: number;
  pageSize: number;
  filters: SyncHistoryFilters;
  instances: SyncHistoryInstanceOption[];
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 250;

/** Parse a positive integer query param, falling back when absent or invalid. */
function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Sync-history list load.
 *
 * Parses list/filter query params, runs the shared filtered `search` + `count`
 * (so pagination totals never diverge from the returned page), and exposes only the
 * eligible instance picker list (id/name/type) — the same eligibility gate used by
 * the sync-preview and drift surfaces (`radarr|sonarr|lidarr`), never credentials.
 */
export const load: ServerLoad = ({ url }) => {
  const params = url.searchParams;

  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE));

  const instanceIdRaw = params.get('instanceId');
  const instanceIdParsed = instanceIdRaw ? Number.parseInt(instanceIdRaw, 10) : NaN;

  const filters: SyncHistoryFilters = {
    instanceId: Number.isFinite(instanceIdParsed) ? instanceIdParsed : undefined,
    arrType: params.get('arrType') || undefined,
    status: params.get('status') || undefined,
    trigger: params.get('trigger') || undefined,
    section: params.get('section') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    q: params.get('q') || undefined,
  };

  const offset = (page - 1) * pageSize;
  const rows = syncHistoryQueries.search(filters, { limit: pageSize, offset });
  const total = syncHistoryQueries.count(filters);

  const instances: SyncHistoryInstanceOption[] = arrInstancesQueries
    .getEnabled()
    .filter((instance) => isSyncPreviewArrType(instance.type))
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
      type: instance.type as SyncPreviewArrType,
    }));

  const data: SyncHistoryPageData = { rows, total, page, pageSize, filters, instances };
  return data;
};
