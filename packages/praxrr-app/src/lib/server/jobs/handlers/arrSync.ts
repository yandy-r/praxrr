import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler, JobRunStatus, JobType } from '../queueTypes.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import { detectAndRecordArrVersion } from '$arr/instanceCompatibility.ts';
import type { ArrType } from '$arr/types.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import { getSection } from '$lib/server/sync/registry.ts';
import {
  SYNC_SECTION_ORDER,
  getUnsupportedSyncSectionReason,
  resolveSyncSectionAvailability,
  type SyncArrType,
} from '$lib/server/sync/mappings.ts';
import { logger } from '$logger/logger.ts';
import { snapshotService } from '$pcd/snapshots/service.ts';
import { capturePreSyncChanges, deriveSyncHistoryStatus, recordSyncHistory } from '$sync/syncHistory/record.ts';
import type {
  SyncEntityChange,
  SyncOperationStatus,
  SyncPreviewSection,
  SyncSectionResult,
} from '$sync/syncHistory/types.ts';

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
  source: 'manual' | 'system' | 'schedule' = 'manual'
): Promise<{
  status: JobRunStatus;
  output?: string;
  error?: string;
  rescheduleAt?: string | null;
}> {
  setSectionsStatusPending(instanceId, sections);

  const now = new Date().toISOString();
  const payload = sections.length === 0 ? { instanceId } : { instanceId, sections };

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

const arrSyncHandler: JobHandler = async (job) => {
  const startedAt = new Date().toISOString();
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    // No instance context — nothing attempted, no audit row.
    return { status: 'failure', error: 'Invalid instance ID' };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance || !instance.enabled) {
    // Disabled/missing instance — nothing attempted (semantically cancelled), no audit row.
    return { status: 'cancelled', output: 'Arr instance disabled' };
  }

  const syncArrType = toSyncArrType(instance.type);
  if (!syncArrType) {
    // arr_type cannot satisfy the sync_history CHECK (radarr/sonarr/lidarr only), so this
    // misconfiguration is not audited beyond the failure return.
    return { status: 'failure', error: `Unsupported sync instance type: ${instance.type}` };
  }

  // Audit-trail recorder (never throws; self-gates on sync_history_settings.enabled).
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
    } = {}
  ): void => {
    const finishedAt = new Date().toISOString();
    recordSyncHistory({
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
      error: opts.error ?? null,
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    });
  };

  const configStatus = arrSyncQueries.getSyncConfigStatus(instanceId);
  const sectionsToRun = resolveSections(job.jobType, job.payload);

  if (sectionsToRun.length === 0) {
    recordHistory('skipped', { error: 'No sync sections specified' });
    return { status: 'skipped', output: 'No sync sections specified' };
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
      recordHistory('failed', {
        error: credentialError,
        sectionsAttempted: sectionsToRun,
        failureCount: sectionsToRun.length,
      });
      return { status: 'failure', error: credentialError };
    }

    recordHistory('failed', { error: message, sectionsAttempted: sectionsToRun, failureCount: sectionsToRun.length });
    return { status: 'failure', error: message };
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

      itemsSynced += result.itemsSynced;
      if (result.success) {
        handler.completeSync(instanceId);
        results.push(`${section}: ${result.itemsSynced} item(s)`);
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

  const historyStatus = deriveSyncHistoryStatus(ranSections, failures, sectionResults);
  recordHistory(historyStatus, {
    error: failures > 0 ? results.join(', ') : null,
    sectionsAttempted: sectionsToRun,
    sectionsRun: ranSections,
    itemsSynced,
    failureCount: failures,
    sectionResults,
    changes,
  });

  if (job.source === 'schedule' && job.jobType === 'arr.sync') {
    const nextRunAt = arrSyncQueries.getNextScheduledRunAt(instanceId);
    if (nextRunAt) {
      return {
        status: failures > 0 ? 'failure' : 'success',
        output: results.join(', '),
        rescheduleAt: nextRunAt,
      };
    }
  }

  return {
    status: ranSections === 0 ? 'skipped' : failures > 0 ? 'failure' : 'success',
    output: results.join(', '),
    rescheduleAt: job.source === 'schedule' ? rescheduleAt : null,
  };
};

jobQueueRegistry.register('arr.sync', arrSyncHandler);
jobQueueRegistry.register('arr.sync.qualityProfiles', arrSyncHandler);
jobQueueRegistry.register('arr.sync.delayProfiles', arrSyncHandler);
jobQueueRegistry.register('arr.sync.mediaManagement', arrSyncHandler);
jobQueueRegistry.register('arr.sync.metadataProfiles', arrSyncHandler);
