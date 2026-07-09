/**
 * Sync history API response mappers. The query-module records
 * ({@link SyncHistorySummary}/{@link SyncHistoryDetail}) are already camelCase and
 * structurally match the OpenAPI schemas, so the summary/detail mappers are stable
 * passthroughs that mark the API boundary; {@link buildSyncHistoryListResponse}
 * assembles the paginated envelope.
 */

import type { SyncHistoryDetail, SyncHistorySummary } from '$db/queries/syncHistory.ts';
import type { SyncHistorySettings } from '$db/queries/syncHistorySettings.ts';

export interface SyncHistorySettingsResponse {
  enabled: boolean;
  retentionDays: number;
  retentionMaxEntries: number;
}

export function toSyncHistorySettingsResponse(row: SyncHistorySettings): SyncHistorySettingsResponse {
  return {
    enabled: row.enabled === 1,
    retentionDays: row.retention_days,
    retentionMaxEntries: row.retention_max_entries,
  };
}

export interface SyncHistoryListResponse {
  items: SyncHistorySummary[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
}

export function toSyncHistorySummary(record: SyncHistorySummary): SyncHistorySummary {
  return record;
}

export function toSyncHistoryDetail(record: SyncHistoryDetail): SyncHistoryDetail {
  return record;
}

export function buildSyncHistoryListResponse(
  rows: SyncHistorySummary[],
  opts: { page: number; pageSize: number; total: number }
): SyncHistoryListResponse {
  const totalPages = opts.pageSize > 0 ? Math.ceil(opts.total / opts.pageSize) : 0;
  return {
    items: rows.map(toSyncHistorySummary),
    page: opts.page,
    pageSize: opts.pageSize,
    totalRecords: opts.total,
    totalPages,
    hasNext: opts.page < totalPages,
  };
}
