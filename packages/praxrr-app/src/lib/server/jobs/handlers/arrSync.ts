import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler, JobHandlerResult, JobQueueRecord, JobType } from '../queueTypes.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { arrSyncQueries, type ReviewedSyncClaim } from '$db/queries/arrSync.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import { detectAndRecordArrVersion } from '$arr/instanceCompatibility.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrType } from '$arr/types.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import type { BaseSyncer, SectionType } from '$lib/server/sync/types.ts';
import { getSection } from '$lib/server/sync/registry.ts';
import {
  SYNC_SECTION_ORDER,
  getUnsupportedSyncSectionReason,
  resolveSyncSectionAvailability,
  type SyncArrType,
} from '$lib/server/sync/mappings.ts';
import { logger } from '$logger/logger.ts';
import { snapshotService } from '$pcd/snapshots/service.ts';
import {
  capturePreSyncChanges,
  deriveSyncHistoryStatus,
  flattenSyncPreviewChanges,
  recordSyncHistory,
} from '$sync/syncHistory/record.ts';
import {
  buildSyncPreviewReviewBinding,
  buildSyncPreviewTargetHash,
  compareReviewedEvidence,
  syncPreviewReviewTarget,
} from '$sync/preview/reviewBinding.ts';
import { generatePreview, type GeneratePreviewWithReviewContextResult } from '$sync/preview/orchestrator.ts';
import type {
  ReviewedEvidenceComparison,
  SyncPreviewEvidenceClass,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewReviewBinding,
  SyncPreviewReviewInvalidationReason,
  SyncPreviewReviewTargetInput,
} from '$sync/preview/types.ts';
import type {
  SyncEntityChange,
  SyncOperationStatus,
  SyncPreviewSection,
  SyncSectionResult,
} from '$sync/syncHistory/types.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';

/**
 * An arr-sync run's result: the job status plus the confirmed per-entity outcomes and the
 * durable Sync History id that exposes them (issue #232). A function returning this subtype
 * of {@link JobHandlerResult} stays assignable to {@link JobHandler} (covariant return).
 */
export interface SyncJobResult extends JobHandlerResult {
  outcomes: SyncEntityOutcome[];
  syncHistoryId: number | null;
}

export interface ExecuteReviewedSyncJobInput {
  readonly binding: SyncPreviewReviewBinding;
  readonly sections: readonly SyncPreviewSection[];
  readonly previewId: string;
  readonly expiresAt: string;
  readonly source?: 'manual' | 'system' | 'schedule';
  /** Test-only/adversarial seam after every section matches and before the first side effect. */
  readonly beforeWrite?: () => void | Promise<void>;
  readonly dependencies?: Partial<ReviewedSyncExecutionDependencies>;
}

export type ReviewedSyncJobResult =
  | { readonly kind: 'executed'; readonly result: SyncJobResult }
  | {
      readonly kind: 'claim_conflict';
      readonly outcomes: readonly [];
      readonly syncHistoryId: null;
    }
  | {
      readonly kind: 'expired';
      readonly outcomes: readonly [];
      readonly syncHistoryId: null;
    }
  | {
      readonly kind: 'invalidated';
      readonly reason: SyncPreviewReviewInvalidationReason;
      readonly changedEvidence: readonly SyncPreviewEvidenceClass[];
      readonly changedSections: readonly SyncPreviewSection[];
      readonly outcomes: readonly [];
      readonly syncHistoryId: null;
    };

interface ReviewedExecutionSyncer extends BaseSyncer {
  setPreparedExecutionContext(context: SyncPreviewPreparedExecutionContext): void;
  clearPreparedExecutionContext(): void;
}

export interface ReviewedSyncExecutionDependencies {
  readonly now: () => number;
  readonly getInstance: (instanceId: number) => ArrInstance | null;
  readonly getClient: (arrType: ArrType, instanceId: number, url: string) => Promise<BaseArrClient>;
  readonly getReviewTarget: (instance: ArrInstance) => SyncPreviewReviewTargetInput;
  readonly detectVersion: typeof detectAndRecordArrVersion;
  readonly claimSections: (instanceId: number, sections: readonly SectionType[]) => ReviewedSyncClaim | null;
  readonly releaseSections: (claim: ReviewedSyncClaim) => boolean;
  readonly completeSections: (claim: ReviewedSyncClaim) => boolean;
  readonly failSections: (claim: ReviewedSyncClaim, error: string) => boolean;
  readonly materializeReview: (
    instance: ArrInstance,
    sections: readonly SectionType[],
    sectionConfigs: Readonly<Partial<Record<SyncPreviewSection, unknown>>>,
    client: BaseArrClient
  ) => Promise<GeneratePreviewWithReviewContextResult>;
  readonly createSnapshot: typeof snapshotService.createAutoSnapshot;
  readonly recordHistory: typeof recordSyncHistory;
  readonly getSectionHandler: typeof getSection;
}

// Register sync handlers
import '$lib/server/sync/qualityProfiles/handler.ts';
import '$lib/server/sync/delayProfiles/handler.ts';
import '$lib/server/sync/mediaManagement/handler.ts';
import '$lib/server/sync/metadataProfiles/handler.ts';

const jobTypeToSection = new Map<JobType, SectionType>([
  ['arr.sync.qualityProfiles', 'qualityProfiles'],
  ['arr.sync.delayProfiles', 'delayProfiles'],
  ['arr.sync.mediaManagement', 'mediaManagement'],
  ['arr.sync.metadataProfiles', 'metadataProfiles'],
]);

const SECTION_SYNC_ORDER: SectionType[] = ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'];

function dedupeSections(requestedSections: readonly SectionType[]): SectionType[] {
  const seen = new Set<SectionType>();
  const sections: SectionType[] = [];
  for (const section of requestedSections) {
    if (seen.has(section)) {
      continue;
    }
    seen.add(section);
    sections.push(section);
  }
  return sections;
}

function getSectionSyncStatus(instanceId: number, section: SectionType): string {
  const configStatus = arrSyncQueries.getSyncConfigStatus(instanceId);
  switch (section) {
    case 'qualityProfiles':
      return configStatus.qualityProfiles.syncStatus;
    case 'delayProfiles':
      return configStatus.delayProfiles.syncStatus;
    case 'mediaManagement':
      return configStatus.mediaManagement.syncStatus;
    case 'metadataProfiles':
      return configStatus.metadataProfiles.syncStatus;
  }
}

export function getSectionsInProgress(instanceId: number): SectionType[] {
  return SECTION_SYNC_ORDER.filter((section) => getSectionSyncStatus(instanceId, section) === 'in_progress');
}

export function setSectionStatusPending(instanceId: number, section: SectionType): void {
  switch (section) {
    case 'qualityProfiles':
      arrSyncQueries.setQualityProfilesStatusPending(instanceId);
      return;
    case 'delayProfiles':
      arrSyncQueries.setDelayProfilesStatusPending(instanceId);
      return;
    case 'mediaManagement':
      arrSyncQueries.setMediaManagementStatusPending(instanceId);
      return;
    case 'metadataProfiles':
      arrSyncQueries.setMetadataProfilesStatusPending(instanceId);
      return;
  }
}

export function setSectionsStatusPending(instanceId: number, sections: readonly SectionType[]): void {
  for (const section of dedupeSections(sections)) {
    setSectionStatusPending(instanceId, section);
  }
}

export async function executeSyncJob(
  instanceId: number,
  sections: readonly SectionType[],
  source: 'manual' | 'system' | 'schedule' = 'manual',
  previewId?: string
): Promise<SyncJobResult> {
  setSectionsStatusPending(instanceId, sections);

  const now = new Date().toISOString();
  const payload = sections.length === 0 ? { instanceId, previewId } : { instanceId, sections, previewId };

  return arrSyncHandler({
    id: 0,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload,
    source,
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  } as Parameters<typeof arrSyncHandler>[0]);
}

function parseLegacySections(payload: Record<string, unknown>): SectionType[] | null {
  const raw = payload.sections ?? payload.section;
  if (Array.isArray(raw)) {
    const sections = raw.filter(
      (value): value is SectionType =>
        value === 'qualityProfiles' ||
        value === 'delayProfiles' ||
        value === 'mediaManagement' ||
        value === 'metadataProfiles'
    );
    return sections.length > 0 ? sections : null;
  }

  if (typeof raw === 'string') {
    if (
      raw === 'qualityProfiles' ||
      raw === 'delayProfiles' ||
      raw === 'mediaManagement' ||
      raw === 'metadataProfiles'
    ) {
      return [raw];
    }
  }

  return null;
}

function isArrCredentialFailure(message: string): boolean {
  return (
    message.includes('Unable to decrypt Arr API key') ||
    message.includes('No Arr credentials found for instance') ||
    message.includes('No Arr credential key configured for version') ||
    message.includes('ARR_CREDENTIAL_MASTER_KEY')
  );
}

function getArrClientFailureMessage(message: string): string {
  if (message.includes('No Arr credentials found for instance') || message.includes('Unable to decrypt Arr API key')) {
    return 'Arr credentials are not readable. Check Arr credential key configuration and recreate the API key.';
  }

  if (
    message.includes('No Arr credential key configured for version') ||
    message.includes('ARR_CREDENTIAL_MASTER_KEY')
  ) {
    return 'Arr master key configuration is invalid or incomplete. Update ARR_CREDENTIAL_MASTER_KEY settings and retry.';
  }

  return message;
}

function resolveSections(jobType: JobType, payload: Record<string, unknown>): SectionType[] {
  const mapped = jobTypeToSection.get(jobType);
  if (mapped) return [mapped];
  if (jobType !== 'arr.sync') return [];
  return parseLegacySections(payload) ?? SYNC_SECTION_ORDER;
}

function toSyncArrType(arrType: string): SyncArrType | null {
  if (arrType === 'radarr' || arrType === 'sonarr' || arrType === 'lidarr') {
    return arrType;
  }

  return null;
}

function addPositiveDatabaseId(ids: Set<number>, databaseId: unknown): void {
  if (typeof databaseId !== 'number' || !Number.isFinite(databaseId) || databaseId <= 0) {
    return;
  }
  ids.add(databaseId);
}

function collectQualityProfileIds(
  instanceId: number,
  ids: Set<number>,
  onError: (error: unknown, section: string) => void
): void {
  try {
    const quality = arrSyncQueries.getQualityProfilesSync(instanceId);
    if (!quality || !Array.isArray(quality.selections)) {
      return;
    }

    for (const sel of quality.selections) {
      addPositiveDatabaseId(ids, sel?.databaseId);
    }
  } catch (error) {
    onError(error, 'qualityProfiles');
  }
}

function collectDelayProfileIds(
  instanceId: number,
  ids: Set<number>,
  onError: (error: unknown, section: string) => void
): void {
  try {
    const delay = arrSyncQueries.getDelayProfilesSync(instanceId);
    addPositiveDatabaseId(ids, delay?.databaseId);
  } catch (error) {
    onError(error, 'delayProfiles');
  }
}

function collectMediaManagementDatabaseIds(
  instanceId: number,
  ids: Set<number>,
  onError: (error: unknown, section: string) => void
): void {
  try {
    const media = arrSyncQueries.getMediaManagementSync(instanceId);
    addPositiveDatabaseId(ids, media?.namingDatabaseId);
    addPositiveDatabaseId(ids, media?.qualityDefinitionsDatabaseId);
    addPositiveDatabaseId(ids, media?.mediaSettingsDatabaseId);
  } catch (error) {
    onError(error, 'mediaManagement');
  }
}

function collectMetadataProfileIds(
  instanceId: number,
  ids: Set<number>,
  onError: (error: unknown, section: string) => void
): void {
  try {
    const metadata = arrSyncQueries.getMetadataProfilesSync(instanceId);
    addPositiveDatabaseId(ids, metadata?.databaseId);
  } catch (error) {
    onError(error, 'metadataProfiles');
  }
}

function collectSnapshotDatabaseIds(instanceId: number, sections: readonly SectionType[]): number[] {
  const ids = new Set<number>();
  const handleSectionError = (error: unknown, section: string): void => {
    const details =
      error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    logger.warn('Failed to collect pre-sync snapshot database IDs for sync section', {
      source: 'ArrSyncJob',
      meta: {
        section,
        instanceId,
        ...details,
      },
    });
  };

  if (sections.includes('qualityProfiles')) {
    collectQualityProfileIds(instanceId, ids, handleSectionError);
  }

  if (sections.includes('delayProfiles')) {
    collectDelayProfileIds(instanceId, ids, handleSectionError);
  }

  if (sections.includes('mediaManagement')) {
    collectMediaManagementDatabaseIds(instanceId, ids, handleSectionError);
  }

  if (sections.includes('metadataProfiles')) {
    collectMetadataProfileIds(instanceId, ids, handleSectionError);
  }

  return [...ids];
}

export const __testOnly = {
  collectSnapshotDatabaseIds,
};

const DEFAULT_REVIEWED_SYNC_DEPENDENCIES: ReviewedSyncExecutionDependencies = {
  now: Date.now,
  getInstance: (instanceId) => arrInstancesQueries.getById(instanceId) ?? null,
  getClient: (arrType, instanceId, url) => getArrInstanceClient(arrType, instanceId, url),
  getReviewTarget: (instance) =>
    syncPreviewReviewTarget(instance, arrInstanceCredentialsQueries.getByInstanceId(instance.id)),
  detectVersion: detectAndRecordArrVersion,
  claimSections: (instanceId, sections) => arrSyncQueries.claimReviewedSyncSections(instanceId, sections),
  releaseSections: (claim) => arrSyncQueries.releaseReviewedSyncSections(claim),
  completeSections: (claim) => arrSyncQueries.completeReviewedSyncSections(claim),
  failSections: (claim, error) => arrSyncQueries.failReviewedSyncSections(claim, error),
  materializeReview: (instance, sections, sectionConfigs, client) =>
    generatePreview(
      {
        instance,
        sections: [...sections],
        sectionConfigs: { ...sectionConfigs },
      },
      { captureReviewContext: true, client }
    ),
  createSnapshot: (input) => snapshotService.createAutoSnapshot(input),
  recordHistory: recordSyncHistory,
  getSectionHandler: getSection,
};

function invalidatedReviewedSync(
  reason: SyncPreviewReviewInvalidationReason,
  changedSections: readonly SyncPreviewSection[],
  changedEvidence: readonly SyncPreviewEvidenceClass[] = []
): ReviewedSyncJobResult {
  return {
    kind: 'invalidated',
    reason,
    changedEvidence: Object.freeze([...changedEvidence]),
    changedSections: Object.freeze([...changedSections]),
    outcomes: [],
    syncHistoryId: null,
  };
}

function isReviewedSectionSubsequence(
  sections: readonly SyncPreviewSection[],
  reviewedSections: readonly SyncPreviewSection[]
): boolean {
  let previousIndex = -1;
  for (const section of sections) {
    const index = reviewedSections.indexOf(section);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function validateReviewedScope(
  binding: SyncPreviewReviewBinding,
  sections: readonly SyncPreviewSection[],
  instance: ArrInstance | null
): ReviewedSyncJobResult | null {
  if (
    !instance ||
    !instance.enabled ||
    instance.id !== binding.instanceId ||
    instance.type !== binding.arrType ||
    sections.length === 0 ||
    new Set(sections).size !== sections.length ||
    !isReviewedSectionSubsequence(sections, binding.sections) ||
    sections.some(
      (section) =>
        !SYNC_SECTION_ORDER.includes(section) ||
        !binding.sections.includes(section) ||
        !binding.evidence[section] ||
        getUnsupportedSyncSectionReason(binding.arrType, section) !== null
    )
  ) {
    return invalidatedReviewedSync('scope_drift', sections);
  }

  return null;
}

function collectReviewedSnapshotDatabaseIds(
  contexts: Readonly<Partial<Record<SyncPreviewSection, SyncPreviewPreparedExecutionContext>>>,
  sections: readonly SyncPreviewSection[]
): number[] {
  const ids = new Set<number>();
  const add = (value: unknown): void => addPositiveDatabaseId(ids, value);

  for (const section of sections) {
    const config = contexts[section]?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
    const value = config as Record<string, unknown>;
    if (section === 'qualityProfiles' && Array.isArray(value.selections)) {
      for (const selection of value.selections) {
        if (selection && typeof selection === 'object') add((selection as Record<string, unknown>).databaseId);
      }
    } else if (section === 'delayProfiles' || section === 'metadataProfiles') {
      add(value.databaseId);
    } else if (section === 'mediaManagement') {
      add(value.namingDatabaseId);
      add(value.qualityDefinitionsDatabaseId);
      add(value.mediaSettingsDatabaseId);
    }
  }

  return [...ids];
}

/**
 * Revalidate and execute an exact reviewed preview subset.
 *
 * Every selected section is claimed and re-materialized before snapshots, history capture,
 * confirmed outcomes, or Arr writes. The prepared contexts narrow the remaining external Arr
 * race, but Arr does not expose a common conditional-write contract across all supported apps.
 */
export async function executeReviewedSyncJob(input: ExecuteReviewedSyncJobInput): Promise<ReviewedSyncJobResult> {
  const deps: ReviewedSyncExecutionDependencies = {
    ...DEFAULT_REVIEWED_SYNC_DEPENDENCIES,
    ...input.dependencies,
  };
  const sections = Object.freeze([...input.sections]);
  const initialInstance = deps.getInstance(input.binding.instanceId);
  const initialScopeFailure = validateReviewedScope(input.binding, sections, initialInstance);
  if (initialScopeFailure) return initialScopeFailure;

  let claim: ReviewedSyncClaim | null;
  try {
    claim = deps.claimSections(input.binding.instanceId, sections);
  } catch {
    return invalidatedReviewedSync('unverifiable_review', sections);
  }
  if (!claim) {
    return { kind: 'claim_conflict', outcomes: [], syncHistoryId: null };
  }

  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    deps.failSections(claim, 'Reviewed sync preview could not be verified');
    return invalidatedReviewedSync('unverifiable_review', sections);
  }
  if (deps.now() >= expiresAtMs) {
    deps.releaseSections(claim);
    return { kind: 'expired', outcomes: [], syncHistoryId: null };
  }

  const instance = deps.getInstance(input.binding.instanceId);
  const claimedScopeFailure = validateReviewedScope(input.binding, sections, instance);
  if (claimedScopeFailure || !instance) {
    deps.failSections(claim, 'Reviewed sync preview scope changed');
    return claimedScopeFailure ?? invalidatedReviewedSync('scope_drift', sections);
  }

  let target: SyncPreviewReviewTargetInput;
  try {
    target = deps.getReviewTarget(instance);
    const currentTargetHash = await buildSyncPreviewTargetHash({
      instanceId: instance.id,
      arrType: input.binding.arrType,
      target,
    });
    if (currentTargetHash !== input.binding.targetHash) {
      deps.failSections(claim, 'Reviewed sync preview target changed');
      return invalidatedReviewedSync('scope_drift', sections);
    }
  } catch {
    deps.failSections(claim, 'Reviewed sync preview target could not be verified');
    return invalidatedReviewedSync('unverifiable_review', sections);
  }

  let client: BaseArrClient | null = null;
  let materialized: GeneratePreviewWithReviewContextResult;
  try {
    client = await deps.getClient(input.binding.arrType, instance.id, instance.url);
    const detected = await deps.detectVersion(instance.id, instance.type, client);
    const detectedVersion = detected?.detectedVersion ?? instance.detected_version;
    const unavailable = sections.filter(
      (section) =>
        resolveSyncSectionAvailability(input.binding.arrType, section, detectedVersion).status === 'unavailable'
    );
    if (unavailable.length > 0) {
      deps.failSections(claim, 'Reviewed sync preview target capability changed');
      client.close();
      return invalidatedReviewedSync('scope_drift', unavailable);
    }

    materialized = await deps.materializeReview(instance, sections, input.binding.sectionConfigs, client);
  } catch {
    deps.failSections(claim, 'Reviewed sync preview could not be verified');
    client?.close();
    return invalidatedReviewedSync('unverifiable_review', sections);
  }

  let comparison: ReviewedEvidenceComparison;
  try {
    const actualBinding = await buildSyncPreviewReviewBinding({
      instanceId: instance.id,
      arrType: input.binding.arrType,
      target,
      sections,
      sectionConfigs: materialized.reviewContext.sectionConfigs,
      evidence: materialized.reviewContext.evidence,
    });
    comparison = compareReviewedEvidence(input.binding, actualBinding, sections);
  } catch {
    comparison = {
      kind: 'invalidated',
      reason: 'unverifiable_review',
      changedEvidence: [],
      changedSections: sections,
    };
  }

  if (comparison.kind === 'invalidated') {
    deps.failSections(claim, 'Reviewed sync preview evidence changed');
    client.close();
    return {
      kind: 'invalidated',
      reason: comparison.reason,
      changedEvidence: comparison.changedEvidence,
      changedSections: comparison.changedSections,
      outcomes: [],
      syncHistoryId: null,
    };
  }

  const preparedContexts = materialized.reviewContext.preparedExecutionContexts;
  if (
    sections.some((section) => {
      const context = preparedContexts[section];
      return !context || context.section !== section;
    })
  ) {
    deps.failSections(claim, 'Reviewed sync preview execution values could not be verified');
    client.close();
    return invalidatedReviewedSync('unverifiable_review', sections);
  }

  const sectionResults: SyncSectionResult[] = [];
  const allOutcomes: SyncEntityOutcome[] = [];
  const results: string[] = [];
  let itemsSynced = 0;
  let failures = 0;
  let ranSections = 0;

  try {
    await input.beforeWrite?.();

    // Materialization and its prepared-context validation may take long enough for the review
    // receipt to expire. Re-check the authoritative deadline at the final pre-side-effect
    // boundary so an expired review cannot create snapshots/history/outcomes or reach Arr writes.
    if (deps.now() >= expiresAtMs) {
      deps.releaseSections(claim);
      return { kind: 'expired', outcomes: [], syncHistoryId: null };
    }

    const startedAt = new Date(deps.now()).toISOString();
    for (const databaseId of collectReviewedSnapshotDatabaseIds(preparedContexts, sections)) {
      await deps.createSnapshot({
        databaseId,
        trigger: 'sync',
        targetInstanceIds: [instance.id],
      });
    }

    // The reviewed materialization is the authoritative, config-bound pre-write diff. Reusing it
    // keeps history aligned with the evidence that was revalidated and avoids a second PCD/Arr
    // preview pass (and its additional network reads) at the execution boundary.
    const changes = flattenSyncPreviewChanges(materialized.preview);
    for (const section of sections) {
      const handler = deps.getSectionHandler(section);
      const context = preparedContexts[section]!;
      const syncer = handler.createSyncer(client, instance) as ReviewedExecutionSyncer;
      ranSections += 1;
      try {
        syncer.setPreparedExecutionContext(context);
        const result = await syncer.sync();
        allOutcomes.push(...result.outcomes);
        itemsSynced += result.itemsSynced;
        if (result.success) {
          const failedEntities = result.outcomes.filter((outcome) => outcome.status === 'failed').length;
          results.push(
            failedEntities > 0
              ? `${section}: ${result.itemsSynced} item(s), ${failedEntities} entity failure(s)`
              : `${section}: ${result.itemsSynced} item(s)`
          );
          sectionResults.push({
            section,
            status: 'success',
            itemsSynced: result.itemsSynced,
            error: null,
            failedProfiles: result.failedProfiles,
          });
        } else {
          failures += 1;
          results.push(`${section}: failed`);
          sectionResults.push({
            section,
            status: 'failed',
            itemsSynced: result.itemsSynced,
            error: result.error ?? 'Unknown error',
            failedProfiles: result.failedProfiles,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failures += 1;
        results.push(`${section}: failed`);
        sectionResults.push({ section, status: 'failed', itemsSynced: 0, error: message });
      } finally {
        syncer.clearPreparedExecutionContext();
        syncer.clearPreviewConfig();
      }
    }

    const historyStatus = deriveSyncHistoryStatus(ranSections, failures, sectionResults, allOutcomes);
    const finishedAt = new Date(deps.now()).toISOString();
    const syncHistoryId = deps.recordHistory({
      arrInstanceId: instance.id,
      instanceName: instance.name,
      arrType: input.binding.arrType,
      jobId: null,
      trigger: input.source ?? 'manual',
      triggerEvent: null,
      sectionsAttempted: [...sections],
      status: historyStatus,
      sectionsRun: ranSections,
      itemsSynced,
      failureCount: failures,
      sectionResults,
      changes,
      entityOutcomes: allOutcomes,
      previewId: input.previewId,
      error: failures > 0 ? results.join(', ') : null,
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    });
    const hasFailedOutcome = allOutcomes.some((outcome) => outcome.status === 'failed');
    const failed = failures > 0 || hasFailedOutcome;
    if (failed) {
      deps.failSections(claim, results.join(', ') || 'Reviewed sync failed');
    } else {
      deps.completeSections(claim);
    }

    return {
      kind: 'executed',
      result: {
        status: ranSections === 0 ? 'skipped' : failed ? 'failure' : 'success',
        output: results.join(', '),
        outcomes: allOutcomes,
        syncHistoryId,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reviewed sync execution failed';
    deps.failSections(claim, 'Reviewed sync execution failed');
    return {
      kind: 'executed',
      result: {
        status: 'failure',
        error: message,
        outcomes: allOutcomes,
        syncHistoryId: null,
      },
    };
  } finally {
    client.close();
  }
}

const arrSyncHandler = async (job: JobQueueRecord): Promise<SyncJobResult> => {
  const startedAt = new Date().toISOString();
  const previewId = typeof job.payload.previewId === 'string' ? job.payload.previewId : null;
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    // No instance context — nothing attempted, no audit row.
    return { status: 'failure', error: 'Invalid instance ID', outcomes: [], syncHistoryId: null };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance || !instance.enabled) {
    // Disabled/missing instance — nothing attempted (semantically cancelled), no audit row.
    return { status: 'cancelled', output: 'Arr instance disabled', outcomes: [], syncHistoryId: null };
  }

  const syncArrType = toSyncArrType(instance.type);
  if (!syncArrType) {
    // arr_type cannot satisfy the sync_history CHECK (radarr/sonarr/lidarr only), so this
    // misconfiguration is not audited beyond the failure return.
    return {
      status: 'failure',
      error: `Unsupported sync instance type: ${instance.type}`,
      outcomes: [],
      syncHistoryId: null,
    };
  }

  // Audit-trail recorder (never throws; self-gates on sync_history_settings.enabled). Returns the
  // durable row id so callers can surface it (issue #232), or null when disabled/failed.
  const recordHistory = (
    status: SyncOperationStatus,
    opts: {
      error?: string | null;
      sectionsAttempted?: readonly SyncPreviewSection[];
      sectionsRun?: number;
      itemsSynced?: number;
      failureCount?: number;
      sectionResults?: SyncSectionResult[];
      changes?: SyncEntityChange[];
      entityOutcomes?: SyncEntityOutcome[];
    } = {}
  ): number | null => {
    const finishedAt = new Date().toISOString();
    return recordSyncHistory({
      arrInstanceId: instanceId,
      instanceName: instance.name,
      arrType: syncArrType,
      jobId: job.id === 0 ? null : job.id,
      trigger: job.source,
      triggerEvent: null,
      sectionsAttempted: [...(opts.sectionsAttempted ?? [])],
      status,
      sectionsRun: opts.sectionsRun ?? 0,
      itemsSynced: opts.itemsSynced ?? 0,
      failureCount: opts.failureCount ?? 0,
      sectionResults: opts.sectionResults ?? [],
      changes: opts.changes ?? [],
      entityOutcomes: opts.entityOutcomes ?? [],
      previewId,
      error: opts.error ?? null,
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    });
  };

  const configStatus = arrSyncQueries.getSyncConfigStatus(instanceId);
  const sectionsToRun = resolveSections(job.jobType, job.payload);

  if (sectionsToRun.length === 0) {
    const syncHistoryId = recordHistory('skipped', { error: 'No sync sections specified' });
    return { status: 'skipped', output: 'No sync sections specified', outcomes: [], syncHistoryId };
  }

  let client: Awaited<ReturnType<typeof getArrInstanceClient>>;
  try {
    client = await getArrInstanceClient(instance.type as ArrType, instanceId, instance.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create Arr client';

    if (isArrCredentialFailure(message)) {
      try {
        arrInstancesQueries.update(instanceId, { enabled: false });
        await logger.warn('Arr sync disabled instance due to credential failure', {
          source: 'ArrSyncJob',
          meta: {
            jobId: job.id,
            instanceId,
            instanceName: instance.name,
            reason: message,
          },
        });
      } catch (disableError) {
        await logger.error('Failed to disable Arr instance after credential failure', {
          source: 'ArrSyncJob',
          meta: {
            jobId: job.id,
            instanceId,
            instanceName: instance.name,
            disableError: disableError instanceof Error ? disableError.message : String(disableError),
          },
        });
      }

      const credentialError = `Arr credentials are not readable. ${getArrClientFailureMessage(message)} The instance has been disabled.`;
      const syncHistoryId = recordHistory('failed', {
        error: credentialError,
        sectionsAttempted: sectionsToRun,
        failureCount: sectionsToRun.length,
      });
      return { status: 'failure', error: credentialError, outcomes: [], syncHistoryId };
    }

    const syncHistoryId = recordHistory('failed', {
      error: message,
      sectionsAttempted: sectionsToRun,
      failureCount: sectionsToRun.length,
    });
    return { status: 'failure', error: message, outcomes: [], syncHistoryId };
  }

  // Refresh the detected application version on every run, reusing this run's
  // client (best-effort, non-fatal). This keeps compatibility badges/warnings
  // current after an Arr upgrade and feeds the per-section version gate below.
  const detected = await detectAndRecordArrVersion(instanceId, instance.type, client);
  const detectedVersion = detected?.detectedVersion ?? instance.detected_version;

  // Pre-sync snapshots: capture PCD state before Arr sync writes
  const snapshotDatabaseIds = collectSnapshotDatabaseIds(instanceId, sectionsToRun);
  for (const databaseId of snapshotDatabaseIds) {
    await snapshotService.createAutoSnapshot({
      databaseId,
      trigger: 'sync',
      targetInstanceIds: [instanceId],
    });
  }

  // Capture the intended before/after diff BEFORE any writes (post-write it would be empty).
  // Best-effort + gated on sync_history_settings.enabled; never affects the sync.
  const changes = await capturePreSyncChanges(instance, sectionsToRun);
  const sectionResults: SyncSectionResult[] = [];
  const allOutcomes: SyncEntityOutcome[] = [];
  let itemsSynced = 0;

  const results: string[] = [];
  let failures = 0;
  let ranSections = 0;
  let rescheduleAt: string | null = null;

  for (const section of sectionsToRun) {
    const handler = getSection(section);
    const config = configStatus[section];
    const unsupportedReason = getUnsupportedSyncSectionReason(syncArrType, section);

    if (unsupportedReason) {
      results.push(`${section}: skipped (${unsupportedReason})`);
      sectionResults.push({ section, status: 'skipped', itemsSynced: 0, error: unsupportedReason });
      await logger.debug('Skipping unsupported sync section', {
        source: 'ArrSyncJob',
        meta: {
          jobId: job.id,
          instanceId,
          instanceName: instance.name,
          instanceType: syncArrType,
          section,
          reason: unsupportedReason,
        },
      });
      continue;
    }

    // Version-compatibility gate: withhold a section that the detected application
    // version cannot support (never a failure — skip and keep going). Layered on
    // the static section-support check above; dormant unless a version resolves to
    // the unsupported tier (e.g. a below-minimum or future breaking major).
    const versionAvailability = resolveSyncSectionAvailability(syncArrType, section, detectedVersion);
    if (versionAvailability.status === 'unavailable') {
      results.push(`${section}: skipped (version ${versionAvailability.reason})`);
      sectionResults.push({
        section,
        status: 'skipped',
        itemsSynced: 0,
        error: `version ${versionAvailability.reason}`,
      });
      await logger.warn('Skipping sync section incompatible with detected Arr version', {
        source: 'ArrSyncJob',
        meta: {
          jobId: job.id,
          instanceId,
          instanceName: instance.name,
          instanceType: syncArrType,
          section,
          detectedVersion,
          reason: versionAvailability.reason,
        },
      });
      continue;
    }

    if (job.source === 'schedule' && config.trigger !== 'schedule') {
      results.push(`${section}: skipped`);
      sectionResults.push({ section, status: 'skipped', itemsSynced: 0, error: null });
      continue;
    }

    if (!handler.hasConfig(instanceId)) {
      results.push(`${section}: skipped`);
      sectionResults.push({ section, status: 'skipped', itemsSynced: 0, error: null });
      continue;
    }

    handler.setStatusPending(instanceId);
    if (!handler.claimSync(instanceId)) {
      continue;
    }

    ranSections++;
    try {
      const syncer = handler.createSyncer(client, instance);
      const result = await syncer.sync();

      allOutcomes.push(...result.outcomes);
      itemsSynced += result.itemsSynced;
      if (result.success) {
        handler.completeSync(instanceId);
        // Surface entity-level failures inside an otherwise-successful section (e.g. a
        // swallowed-then-surfaced custom format) so the aggregate never hides them. The section
        // rollup stays `success` (its own writes succeeded); the run status is pulled to `partial`
        // by the outcome-aware deriveSyncHistoryStatus below, and each failed entity is preserved
        // in `allOutcomes` (issue #232, Gap 1 — never collapse to success).
        const failedEntities = result.outcomes.filter((outcome) => outcome.status === 'failed').length;
        results.push(
          failedEntities > 0
            ? `${section}: ${result.itemsSynced} item(s), ${failedEntities} entity failure(s)`
            : `${section}: ${result.itemsSynced} item(s)`
        );
        sectionResults.push({
          section,
          status: 'success',
          itemsSynced: result.itemsSynced,
          error: null,
          failedProfiles: result.failedProfiles,
        });
      } else {
        handler.failSync(instanceId, result.error ?? 'Unknown error');
        results.push(`${section}: failed`);
        failures++;
        sectionResults.push({
          section,
          status: 'failed',
          itemsSynced: result.itemsSynced,
          error: result.error ?? 'Unknown error',
          failedProfiles: result.failedProfiles,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      handler.failSync(instanceId, message);
      results.push(`${section}: failed`);
      failures++;
      sectionResults.push({ section, status: 'failed', itemsSynced: 0, error: message });
      await logger.error('Arr sync failed', {
        source: 'ArrSyncJob',
        meta: { jobId: job.id, instanceId, instanceName: instance.name, section, error: message },
      });
    } finally {
      if (config.trigger === 'schedule') {
        const nextRun = calculateNextRun(config.cron);
        handler.setNextRunAt(instanceId, nextRun);
        if (job.source === 'schedule') {
          rescheduleAt = nextRun ?? null;
        }
      }
    }
  }

  const historyStatus = deriveSyncHistoryStatus(ranSections, failures, sectionResults, allOutcomes);
  const hasFailedOutcome = allOutcomes.some((outcome) => outcome.status === 'failed');
  const syncHistoryId = recordHistory(historyStatus, {
    error: failures > 0 ? results.join(', ') : null,
    sectionsAttempted: sectionsToRun,
    sectionsRun: ranSections,
    itemsSynced,
    failureCount: failures,
    sectionResults,
    changes,
    entityOutcomes: allOutcomes,
  });

  if (job.source === 'schedule' && job.jobType === 'arr.sync') {
    const nextRunAt = arrSyncQueries.getNextScheduledRunAt(instanceId);
    if (nextRunAt) {
      return {
        status: failures > 0 || hasFailedOutcome ? 'failure' : 'success',
        output: results.join(', '),
        rescheduleAt: nextRunAt,
        outcomes: allOutcomes,
        syncHistoryId,
      };
    }
  }

  return {
    status: ranSections === 0 ? 'skipped' : failures > 0 || hasFailedOutcome ? 'failure' : 'success',
    output: results.join(', '),
    rescheduleAt: job.source === 'schedule' ? rescheduleAt : null,
    outcomes: allOutcomes,
    syncHistoryId,
  };
};

jobQueueRegistry.register('arr.sync', arrSyncHandler);
jobQueueRegistry.register('arr.sync.qualityProfiles', arrSyncHandler);
jobQueueRegistry.register('arr.sync.delayProfiles', arrSyncHandler);
jobQueueRegistry.register('arr.sync.mediaManagement', arrSyncHandler);
jobQueueRegistry.register('arr.sync.metadataProfiles', arrSyncHandler);
