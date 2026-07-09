/**
 * Shared drift API response mappers. Keep the `/api/v1/drift/*` routes DRY and consistent:
 * summary and detail both project the same stored row, and never-checked instances are
 * synthesized identically everywhere.
 */

import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { DriftCheckSettings } from '$db/queries/driftSettings.ts';
import type { DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import type { SyncPreviewArrType } from '$sync/preview/types.ts';
import type { DriftCounts, DriftEntityChange, DriftReason, DriftStatus } from './types.ts';

export type DriftSummaryStatus = DriftStatus | 'never-checked';

const ZERO_COUNTS: DriftCounts = { drifted: 0, missing: 0, unmanaged: 0 };

export interface DriftSettingsResponse {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  backoffUntil: string | null;
  errorCount: number;
}

export function toDriftSettingsResponse(settings: DriftCheckSettings, nextRunAt: string | null): DriftSettingsResponse {
  return {
    enabled: settings.enabled === 1,
    intervalMinutes: settings.interval_minutes,
    lastRunAt: settings.last_run_at,
    nextRunAt,
    backoffUntil: settings.backoff_until,
    errorCount: settings.error_count,
  };
}

export interface DriftInstanceSummary {
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  status: DriftSummaryStatus;
  reason: DriftReason | null;
  detectedVersion: string | null;
  counts: DriftCounts;
  checkedAt: string | null;
  contentCheckedAt: string | null;
}

export function toInstanceSummary(
  instance: ArrInstance,
  row: DriftInstanceStatusDetail | undefined
): DriftInstanceSummary {
  if (!row) {
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      arrType: instance.type as SyncPreviewArrType,
      status: 'never-checked',
      reason: null,
      detectedVersion: instance.detected_version ?? null,
      counts: ZERO_COUNTS,
      checkedAt: null,
      contentCheckedAt: null,
    };
  }
  return {
    instanceId: row.arrInstanceId,
    instanceName: instance.name,
    arrType: row.arrType,
    status: row.status,
    reason: row.reason,
    detectedVersion: row.detectedVersion,
    counts: row.counts,
    checkedAt: row.checkedAt,
    contentCheckedAt: row.contentCheckedAt,
  };
}

export interface DriftDetailResponse {
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  status: DriftSummaryStatus;
  reason: DriftReason | null;
  detectedVersion: string | null;
  checkedAt: string | null;
  contentCheckedAt: string | null;
  counts: DriftCounts;
  drift: DriftEntityChange[];
  missing: DriftEntityChange[];
  unmanaged: DriftEntityChange[];
}

export function toDriftDetail(instance: ArrInstance, row: DriftInstanceStatusDetail | undefined): DriftDetailResponse {
  if (!row) {
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      arrType: instance.type as SyncPreviewArrType,
      status: 'never-checked',
      reason: null,
      detectedVersion: instance.detected_version ?? null,
      checkedAt: null,
      contentCheckedAt: null,
      counts: ZERO_COUNTS,
      drift: [],
      missing: [],
      unmanaged: [],
    };
  }
  return {
    instanceId: row.arrInstanceId,
    instanceName: instance.name,
    arrType: row.arrType,
    status: row.status,
    reason: row.reason,
    detectedVersion: row.detectedVersion,
    checkedAt: row.checkedAt,
    contentCheckedAt: row.contentCheckedAt,
    counts: row.counts,
    drift: row.changes.filter((change) => change.category === 'drift'),
    missing: row.changes.filter((change) => change.category === 'missing'),
    unmanaged: row.changes.filter((change) => change.category === 'unmanaged'),
  };
}
