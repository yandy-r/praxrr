/**
 * Shared drift API response mappers. Keep the `/api/v1/drift/*` routes DRY and consistent:
 * summary and detail both project the same stored row, and never-checked instances are
 * synthesized identically everywhere. The suppression overlay and remediation policy are derived
 * here at response time (the stored drift `status` is never rewritten).
 */

import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { DriftCheckSettings } from '$db/queries/driftSettings.ts';
import type { DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import type { SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import { SYNC_SECTION_ORDER, resolveSyncSectionAvailability, type SyncArrType } from '$sync/mappings.ts';
import { hasConfiguredSection } from '$sync/registry.ts';
// Section handlers register on import; `hasConfiguredSection` throws for an unregistered section.
import '$sync/qualityProfiles/handler.ts';
import '$sync/delayProfiles/handler.ts';
import '$sync/mediaManagement/handler.ts';
import '$sync/metadataProfiles/handler.ts';
import { driftEntityKey } from './check.ts';
import { remediableSections, resolveDriftSuppression } from './suppression.ts';
import type {
  DriftCounts,
  DriftEntityChange,
  DriftReason,
  DriftRemediationMode,
  DriftRemediationPolicy,
  DriftRemediationRecord,
  DriftStatus,
  DriftSuppression,
  DriftSuppressionState,
} from './types.ts';

export type DriftSummaryStatus = DriftStatus | 'never-checked';

const ZERO_COUNTS: DriftCounts = { drifted: 0, missing: 0, unmanaged: 0, prune: 0 };

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
  suppression: DriftSuppressionState;
  remediationMode: DriftRemediationMode;
}

export function toInstanceSummary(
  instance: ArrInstance,
  row: DriftInstanceStatusDetail | undefined,
  nowMs: number = Date.now()
): DriftInstanceSummary {
  const arrType = (row?.arrType ?? instance.type) as SyncPreviewArrType;
  const remediationMode = driftRemediationPolicyQueries.get(instance.id, arrType).mode;
  if (!row) {
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      arrType,
      status: 'never-checked',
      reason: null,
      detectedVersion: instance.detected_version ?? null,
      counts: ZERO_COUNTS,
      checkedAt: null,
      contentCheckedAt: null,
      suppression: 'none',
      remediationMode,
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
    suppression: resolveDriftSuppression(row, nowMs).state,
    remediationMode,
  };
}

/** Wire shape of a drift change: the stored change plus its response-time `key` (never stored). */
export type DriftEntityChangeResponse = DriftEntityChange & { readonly key: string };

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
  drift: DriftEntityChangeResponse[];
  missing: DriftEntityChangeResponse[];
  unmanaged: DriftEntityChangeResponse[];
  prune: DriftEntityChangeResponse[];
  driftSignature: string | null;
  driftDetectedAt: string | null;
  suppression: DriftSuppression;
  remediationPolicy: DriftRemediationPolicy;
  lastRemediation: DriftRemediationRecord;
  reconcilableSections: SyncPreviewSection[];
}

const NO_REMEDIATION: DriftRemediationRecord = {
  trigger: null,
  status: null,
  signature: null,
  at: null,
  syncHistoryId: null,
};

/**
 * Plan D16 base set: sections with alerting (drift/missing) changes in the stored row that are
 * configured for the instance AND version-available for its `arr_type`, in sync order. Empty
 * unless the row is `drifted` with fresh content. Not ack-filtered (a human reconcile may revert
 * an acknowledged change); the reconcile route narrows it further by request.
 */
export function resolveReconcilableSections(
  instance: ArrInstance,
  row: DriftInstanceStatusDetail | undefined
): SyncPreviewSection[] {
  if (!row || row.status !== 'drifted' || row.contentCheckedAt === null) {
    return [];
  }
  const drifted = new Set(remediableSections(row.changes, []));
  const arrType = row.arrType as SyncArrType;
  const version = row.detectedVersion ?? instance.detected_version ?? null;
  return SYNC_SECTION_ORDER.filter(
    (section): section is SyncPreviewSection =>
      drifted.has(section as SyncPreviewSection) &&
      resolveSyncSectionAvailability(arrType, section, version).status !== 'unavailable' &&
      hasConfiguredSection(instance.id, section)
  );
}

function withKeys(changes: readonly DriftEntityChange[], category: DriftEntityChange['category']) {
  return changes
    .filter((change) => change.category === category)
    .map((change): DriftEntityChangeResponse => ({ ...change, key: driftEntityKey(change) }));
}

export function toDriftDetail(
  instance: ArrInstance,
  row: DriftInstanceStatusDetail | undefined,
  nowMs: number = Date.now()
): DriftDetailResponse {
  const arrType = (row?.arrType ?? instance.type) as SyncPreviewArrType;
  const remediationPolicy = driftRemediationPolicyQueries.get(instance.id, arrType);
  const suppression = resolveDriftSuppression(row, nowMs);
  if (!row) {
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      arrType,
      status: 'never-checked',
      reason: null,
      detectedVersion: instance.detected_version ?? null,
      checkedAt: null,
      contentCheckedAt: null,
      counts: ZERO_COUNTS,
      drift: [],
      missing: [],
      unmanaged: [],
      prune: [],
      driftSignature: null,
      driftDetectedAt: null,
      suppression,
      remediationPolicy,
      lastRemediation: NO_REMEDIATION,
      reconcilableSections: [],
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
    drift: withKeys(row.changes, 'drift'),
    missing: withKeys(row.changes, 'missing'),
    unmanaged: withKeys(row.changes, 'unmanaged'),
    prune: withKeys(row.changes, 'prune'),
    driftSignature: row.driftSignature,
    driftDetectedAt: row.driftDetectedAt,
    suppression,
    remediationPolicy,
    lastRemediation: row.lastRemediation,
    reconcilableSections: resolveReconcilableSections(instance, row),
  };
}
