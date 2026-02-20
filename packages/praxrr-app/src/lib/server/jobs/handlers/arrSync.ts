import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler, JobRunStatus, JobType } from '../queueTypes.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { ArrType } from '$arr/types.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import { getSection } from '$lib/server/sync/registry.ts';
import { SYNC_SECTION_ORDER, getUnsupportedSyncSectionReason, type SyncArrType } from '$lib/server/sync/mappings.ts';
import { logger } from '$logger/logger.ts';

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

const arrSyncHandler: JobHandler = async (job) => {
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    return { status: 'failure', error: 'Invalid instance ID' };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance || !instance.enabled) {
    return { status: 'cancelled', output: 'Arr instance disabled' };
  }

  const configStatus = arrSyncQueries.getSyncConfigStatus(instanceId);
  const sectionsToRun = resolveSections(job.jobType, job.payload);

  if (sectionsToRun.length === 0) {
    return { status: 'skipped', output: 'No sync sections specified' };
  }

  const syncArrType = toSyncArrType(instance.type);
  if (!syncArrType) {
    return { status: 'failure', error: `Unsupported sync instance type: ${instance.type}` };
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

      return {
        status: 'failure',
        error: `Arr credentials are not readable. ${getArrClientFailureMessage(message)} The instance has been disabled.`,
      };
    }

    return { status: 'failure', error: message };
  }
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

    if (job.source === 'schedule' && config.trigger !== 'schedule') {
      results.push(`${section}: skipped`);
      continue;
    }

    if (!handler.hasConfig(instanceId)) {
      results.push(`${section}: skipped`);
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

      if (result.success) {
        handler.completeSync(instanceId);
        results.push(`${section}: ${result.itemsSynced} item(s)`);
      } else {
        handler.failSync(instanceId, result.error ?? 'Unknown error');
        results.push(`${section}: failed`);
        failures++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      handler.failSync(instanceId, message);
      results.push(`${section}: failed`);
      failures++;
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
