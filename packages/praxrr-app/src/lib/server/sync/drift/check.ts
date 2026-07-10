/**
 * Drift check service
 *
 * Computes the drift of a single Arr instance by reusing the sync preview engine
 * (`generatePreview`) verbatim: `EntityChange.fields` is already the field-level
 * desired-vs-live diff (`current` = LIVE, `desired` = PCD). This module adds:
 *   - a bounded, never-throwing IO shell (`checkInstanceDrift`) that heartbeats first,
 *     version-gates sections, guards the PCD cache and the shared rate-limit window, and
 *     races the preview under a wall-clock budget so a slow instance can't hang the sweep;
 *   - two pure cores (`aggregateDrift`, `driftSignature`) that hold the drift semantics.
 *
 * `generatePreview`/`getSystemStatus`/`registerPreviewCreateAttempt` are bare ESM bindings
 * (not monkey-patchable), so everything with I/O is injected via `DriftCheckDeps`.
 *
 * See docs/plans/drift-detection/design.md §4.
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getCache } from '$pcd/database/registry.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { ArrType } from '$arr/types.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import { registerPreviewCreateAttempt } from '$sync/preview/limits.ts';
import { SYNC_SECTION_ORDER, resolveSyncSectionAvailability, type SyncArrType } from '$sync/mappings.ts';
import type { SectionType } from '$sync/types.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { EntityChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import type { DriftCategory, DriftEntityChange, HeartbeatResult, InstanceDriftResult } from './types.ts';

const SOURCE = 'DriftCheck';

/** Default wall-clock budget for the full section fetch+diff of a single instance. */
export const DEFAULT_DRIFT_BUDGET_MS = 20_000;

// ============================================================================
// DEPS (injectable so the module stays unit-testable)
// ============================================================================

export interface DriftCheckDeps {
  /** Runs the live-vs-desired section diff for an instance. */
  readonly generatePreview: typeof generatePreview;
  /** Cheap reachability probe (short timeout, no retries); never throws. */
  readonly heartbeat: (instance: ArrInstance) => Promise<HeartbeatResult>;
  /** True iff every PCD database this instance syncs from has a built cache. */
  readonly isPcdCacheReady: (instance: ArrInstance) => boolean;
  /** Version-gated set of sections worth comparing for this instance. */
  readonly resolveAvailableSections: (instance: ArrInstance, version: string | null) => Set<SyncPreviewSection>;
  /** Shared preview rate-limit window (drift + sync-preview cannot collectively exceed it). */
  readonly registerPreviewAttempt: (instanceId: number, nowMs: number) => boolean;
  readonly now: () => number;
  readonly budgetMs: number;
}

/** Best-effort heartbeat: builds a dedicated 5s / 0-retry client, probes, persists version, closes. */
async function defaultHeartbeat(instance: ArrInstance): Promise<HeartbeatResult> {
  try {
    const client = await getArrInstanceClient(instance.type as ArrType, instance.id, instance.url, {
      timeout: 5000,
      retries: 0,
    });
    try {
      const status = await client.getSystemStatus();
      if (!status.ok) {
        return { ok: false, status: status.status };
      }

      // Best-effort: persist the observed version off the single heartbeat round-trip (no re-fetch).
      try {
        arrInstancesQueries.setDetectedVersion(instance.id, {
          version: status.version,
          detectedAt: new Date().toISOString(),
        });
      } catch {
        // detection is a side-channel; never let it affect the drift result
      }

      return { ok: true, version: status.version, appName: status.appName };
    } finally {
      client.close();
    }
  } catch {
    return { ok: false };
  }
}

/** True iff every PCD database referenced by the instance's sync selections has a built cache. */
function defaultIsPcdCacheReady(instance: ArrInstance): boolean {
  const full = arrSyncQueries.getFullSyncData(instance.id);
  const dbIds = new Set<number>();
  for (const selection of full.qualityProfiles.selections) {
    dbIds.add(selection.databaseId);
  }
  for (const id of [
    full.delayProfiles.databaseId,
    full.mediaManagement.namingDatabaseId,
    full.mediaManagement.qualityDefinitionsDatabaseId,
    full.mediaManagement.mediaSettingsDatabaseId,
    full.metadataProfiles.databaseId,
  ]) {
    if (id !== null) {
      dbIds.add(id);
    }
  }

  // Nothing configured → nothing to compare; the preview will resolve to `not_configured`.
  // A configured DB whose cache is absent/unbuilt must degrade, never silently read empty
  // desired (which would look like a false `in-sync`).
  for (const dbId of dbIds) {
    if (getCache(dbId)?.isBuilt() !== true) {
      return false;
    }
  }
  return true;
}

/** Version-gated section set: include a section unless its availability is `unavailable`. */
function defaultResolveAvailableSections(instance: ArrInstance, version: string | null): Set<SyncPreviewSection> {
  const arrType = instance.type as SyncArrType;
  const available = new Set<SyncPreviewSection>();
  for (const section of SYNC_SECTION_ORDER) {
    if (resolveSyncSectionAvailability(arrType, section, version).status !== 'unavailable') {
      available.add(section as SyncPreviewSection);
    }
  }
  return available;
}

export const defaultDriftCheckDeps: DriftCheckDeps = {
  generatePreview,
  heartbeat: defaultHeartbeat,
  isPcdCacheReady: defaultIsPcdCacheReady,
  resolveAvailableSections: defaultResolveAvailableSections,
  registerPreviewAttempt: registerPreviewCreateAttempt,
  now: () => Date.now(),
  budgetMs: DEFAULT_DRIFT_BUDGET_MS,
};

// ============================================================================
// PURE CORE
// ============================================================================

const ACTION_CATEGORY: Record<'create' | 'update' | 'delete', DriftCategory> = {
  update: 'drift',
  create: 'missing',
  delete: 'unmanaged',
};

function toDriftChange(section: SyncPreviewSection, entity: EntityChange): DriftEntityChange | null {
  if (entity.action === 'unchanged') {
    return null;
  }
  return {
    section,
    entityType: entity.entityType,
    name: entity.name,
    action: entity.action,
    category: ACTION_CATEGORY[entity.action],
    remoteId: entity.remoteId,
    fields: entity.fields,
  };
}

function collectSection(
  section: SyncPreviewSection,
  entities: ReadonlyArray<EntityChange | null> | null | undefined,
  out: DriftEntityChange[]
): void {
  if (!entities) {
    return;
  }
  for (const entity of entities) {
    if (!entity) {
      continue;
    }
    const change = toDriftChange(section, entity);
    if (change) {
      out.push(change);
    }
  }
}

export interface AggregateResult {
  changes: DriftEntityChange[];
  counts: { drifted: number; missing: number; unmanaged: number };
  /** Every available section that ran errored (none produced a result). */
  allSectionsErrored: boolean;
  /** At least one available section errored (partial OR total failure). */
  anySectionErrored: boolean;
  /** At least one available section produced a successful diff result. */
  comparedAny: boolean;
}

/**
 * Pure aggregation. Reads the NESTED section payloads (CF/QP live inside
 * `preview.qualityProfiles`), restricted to `availableSections`, collecting every
 * non-`unchanged` `EntityChange`. `allSectionsErrored`/`comparedAny` derive from
 * `preview.sectionOutcomes` (the top-level section fields are `null` for errored,
 * skipped, and not-configured alike, so they can't classify errors).
 */
export function aggregateDrift(
  preview: GeneratePreviewResult,
  availableSections: Set<SyncPreviewSection>
): AggregateResult {
  const changes: DriftEntityChange[] = [];

  if (availableSections.has('qualityProfiles') && preview.qualityProfiles) {
    collectSection('qualityProfiles', preview.qualityProfiles.customFormats, changes);
    collectSection('qualityProfiles', preview.qualityProfiles.qualityProfiles, changes);
  }
  if (availableSections.has('delayProfiles') && preview.delayProfiles) {
    collectSection('delayProfiles', [preview.delayProfiles.profile], changes);
  }
  if (availableSections.has('mediaManagement') && preview.mediaManagement) {
    collectSection('mediaManagement', [preview.mediaManagement.naming], changes);
    collectSection('mediaManagement', [preview.mediaManagement.mediaSettings], changes);
    collectSection('mediaManagement', preview.mediaManagement.qualityDefinitions, changes);
  }
  if (availableSections.has('metadataProfiles') && preview.metadataProfiles) {
    collectSection('metadataProfiles', [preview.metadataProfiles.profile], changes);
  }

  const counts = { drifted: 0, missing: 0, unmanaged: 0 };
  for (const change of changes) {
    if (change.category === 'drift') counts.drifted += 1;
    else if (change.category === 'missing') counts.missing += 1;
    else counts.unmanaged += 1;
  }

  const availableOutcomes = preview.sectionOutcomes.filter((outcome) =>
    availableSections.has(outcome.section as SyncPreviewSection)
  );
  const succeeded = availableOutcomes.filter((outcome) => outcome.failure === null && !outcome.skipped);
  const errored = availableOutcomes.filter((outcome) => outcome.failure !== null);

  return {
    changes,
    counts,
    allSectionsErrored: succeeded.length === 0 && errored.length > 0,
    anySectionErrored: errored.length > 0,
    comparedAny: succeeded.length > 0,
  };
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable hash over the sorted ALERTING (update+create) changes only, each remoteId-qualified
 * so two same-named managed entities from different databases do not collapse. `null` when
 * there is no alerting drift. `delete`/`unchanged` are excluded so unmanaged churn never
 * perturbs the notification dedup key.
 */
export function driftSignature(changes: readonly DriftEntityChange[]): string | null {
  const tokens = changes
    .filter((change) => change.action === 'update' || change.action === 'create')
    .map(
      (change) => `${change.section}|${change.entityType}|${change.name}|${change.remoteId ?? 'new'}|${change.action}`
    )
    .sort();
  if (tokens.length === 0) {
    return null;
  }
  return stableHash(tokens.join('\n'));
}

// ============================================================================
// IO SHELL — never throws; always returns a status
// ============================================================================

const BUDGET_EXCEEDED = Symbol('drift-budget-exceeded');

async function raceWithBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | typeof BUDGET_EXCEEDED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof BUDGET_EXCEEDED>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_EXCEEDED), budgetMs);
  });
  try {
    return await Promise.race([work, budget]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Computes drift for one instance following the strict precedence in design §4.2:
 * heartbeat → rate-limit gate → PCD-cache gate → version-available sections → budgeted
 * preview → aggregate. Never throws; returns an `InstanceDriftResult` with a `status`
 * even on every failure path.
 *
 * The caller guarantees `instance.type` is sync-preview-eligible (`radarr|sonarr|lidarr`);
 * an ineligible type is short-circuited to `error` rather than trusted.
 */
export async function checkInstanceDrift(
  instance: ArrInstance,
  deps: Partial<DriftCheckDeps> = {}
): Promise<InstanceDriftResult> {
  const d: DriftCheckDeps = { ...defaultDriftCheckDeps, ...deps };
  const startMs = d.now();
  const checkedAt = new Date(startMs).toISOString();
  const arrType = instance.type as SyncPreviewArrType;

  const build = (
    status: InstanceDriftResult['status'],
    reason: InstanceDriftResult['reason'],
    extras: Partial<InstanceDriftResult> = {}
  ): InstanceDriftResult => ({
    instanceId: instance.id,
    instanceName: instance.name,
    arrType,
    status,
    reason,
    detectedVersion: null,
    counts: { drifted: 0, missing: 0, unmanaged: 0 },
    changes: [],
    driftSignature: null,
    checkedAt,
    contentCheckedAt: null,
    durationMs: Math.max(0, d.now() - startMs),
    ...extras,
  });

  if (!isSyncPreviewArrType(instance.type)) {
    return build('error', 'error');
  }

  // 1. Heartbeat.
  let heartbeat: HeartbeatResult;
  try {
    heartbeat = await d.heartbeat(instance);
  } catch (error) {
    await logger.error('Drift heartbeat threw unexpectedly', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return build('error', 'error');
  }

  if (!heartbeat.ok) {
    if (heartbeat.status === 401 || heartbeat.status === 403) {
      return build('unauthorized', 'unauthorized');
    }
    if (heartbeat.status === undefined) {
      return build('unreachable', 'timeout');
    }
    return build('error', 'invalid_response');
  }

  const version = heartbeat.version;

  // 2. Gates (heartbeat OK only).
  if (!d.registerPreviewAttempt(instance.id, d.now())) {
    return build('error', 'rate_limited', { detectedVersion: version });
  }
  if (!d.isPcdCacheReady(instance)) {
    return build('error', 'cache_not_ready', { detectedVersion: version });
  }

  const available = d.resolveAvailableSections(instance, version);
  if (available.size === 0) {
    return build('in-sync', 'not_configured', { detectedVersion: version, contentCheckedAt: checkedAt });
  }

  // 3. Budgeted full check.
  let outcome: GeneratePreviewResult | typeof BUDGET_EXCEEDED;
  try {
    outcome = await raceWithBudget(
      d.generatePreview({ instance, sections: [...available] as SectionType[], nowMs: startMs }),
      d.budgetMs
    );
  } catch (error) {
    await logger.error('Drift preview generation failed', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return build('error', 'error', { detectedVersion: version });
  }

  if (outcome === BUDGET_EXCEEDED) {
    return build('error', 'timeout', { detectedVersion: version });
  }

  // 4. Aggregate.
  const aggregate = aggregateDrift(outcome, available);
  if (aggregate.anySectionErrored) {
    // A partial (or total) section failure is an incomplete diff. Surface degraded and leave
    // contentCheckedAt null so persist preserves last-known content rather than overwriting
    // prior drift with an incomplete "clean" snapshot (which would erase drift in the failed
    // section and surface a false in-sync).
    return build('error', 'invalid_response', { detectedVersion: version });
  }
  if (!aggregate.comparedAny) {
    return build('in-sync', 'not_configured', { detectedVersion: version, contentCheckedAt: checkedAt });
  }

  const drifted = aggregate.counts.drifted > 0 || aggregate.counts.missing > 0;
  return build(drifted ? 'drifted' : 'in-sync', null, {
    detectedVersion: version,
    counts: aggregate.counts,
    changes: aggregate.changes,
    driftSignature: driftSignature(aggregate.changes),
    contentCheckedAt: checkedAt,
  });
}
