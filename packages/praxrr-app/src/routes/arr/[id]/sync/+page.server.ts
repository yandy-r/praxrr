import { error, fail } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries, InvalidProfileSelectionError, type SyncTrigger } from '$db/queries/arrSync.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import {
  trashGuideSyncQueries,
  TrashGuideSyncScopeError,
  TrashGuideSyncValidationError,
  type TrashGuideSyncSelectionInput,
  type TrashGuideSyncTrigger,
} from '$db/queries/trashGuideSync.ts';
import { pcdManager } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/index.ts';
import * as metadataProfileQueries from '$pcd/entities/metadataProfiles/index.ts';
import * as namingQueries from '$pcd/entities/mediaManagement/naming/index.ts';
import * as qualityDefinitionsQueries from '$pcd/entities/mediaManagement/quality-definitions/index.ts';
import * as mediaSettingsQueries from '$pcd/entities/mediaManagement/media-settings/index.ts';
import { calculateNextRun } from '$lib/server/sync/utils.ts';
import { scheduleArrSyncForInstance } from '$lib/server/jobs/init.ts';
import { enqueueJob } from '$lib/server/jobs/queueService.ts';
import { buildJobDisplayName } from '$lib/server/jobs/display.ts';
import { isSyncSectionSupported } from '$lib/server/sync/mappings.ts';
import { isArrAppType, supportsArrSyncSurface, type ArrSyncSurface } from '$shared/arr/capabilities.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';
import { enqueueManualTrashGuideSourceSync } from '$jobs/helpers/trashGuideSyncQueue.ts';
import {
  previewStore,
  PREVIEW_STATUS_APPLYING,
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_EXPIRED,
  PREVIEW_STATUS_FAILED,
  PREVIEW_STATUS_GENERATING,
  PREVIEW_STATUS_READY,
} from '$sync/preview/store.ts';
import type { SyncPreviewSummary } from '$sync/preview/types.ts';
import { LIVE_DEPENDENCY_KEYS } from '$shared/events/types.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import type { ArrSyncSection, JobQueueRecord, JobType } from '$jobs/queueTypes.ts';

const METADATA_PROFILES_SURFACE: ArrSyncSurface = 'metadata_profiles';
const METADATA_PROFILES_SECTION = 'metadataProfiles';
const METADATA_PROFILE_UNSUPPORTED_ERROR = 'Metadata profile sync is supported only for Lidarr instances';
const VALID_TRASH_GUIDE_SYNC_TRIGGERS: ReadonlySet<string> = new Set<TrashGuideSyncTrigger>([
  'none',
  'manual',
  'on_pull',
  'on_change',
  'schedule',
]);
const EMPTY_PREVIEW_SUMMARY: SyncPreviewSummary = {
  totalCreates: 0,
  totalUpdates: 0,
  totalDeletes: 0,
  totalUnchanged: 0,
};
type SyncPreviewTriggerStatus = 'idle' | 'generating' | 'error' | 'ready';

type SyncPreviewRouteState = {
  previewId: string | null;
  status: SyncPreviewTriggerStatus;
  summary: SyncPreviewSummary | null;
  error: string | null;
  recoveryAction: string | null;
};

function buildTrashGuideAvailableSelections(sourceId: number, selectedQualityProfiles: string[]): string[] {
  const names = new Set<string>();
  const cachedProfiles = trashGuideEntityCacheQueries.getBySourceAndType(sourceId, 'quality_profile');
  for (const profile of cachedProfiles) {
    const normalized = profile.name.trim();
    if (normalized.length > 0) {
      names.add(normalized);
    }
  }

  for (const selected of selectedQualityProfiles) {
    const normalized = selected.trim();
    if (normalized.length > 0) {
      names.add(normalized);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getSyncPreviewRouteState(instanceId: number, previewId: string | null): SyncPreviewRouteState {
  if (!previewId) {
    return {
      previewId: null,
      status: 'idle',
      summary: null,
      error: null,
      recoveryAction: null,
    };
  }

  const snapshot = previewStore.get(previewId);
  if (!snapshot || snapshot.instanceId !== instanceId) {
    return {
      previewId,
      status: 'error',
      summary: null,
      error: 'Preview not found or not associated with this instance',
      recoveryAction: null,
    };
  }

  const mapStatus = (() => {
    switch (snapshot.status) {
      case PREVIEW_STATUS_GENERATING:
      case PREVIEW_STATUS_APPLYING:
        return 'generating';
      case PREVIEW_STATUS_READY:
      case PREVIEW_STATUS_APPLIED:
        return 'ready';
      case PREVIEW_STATUS_FAILED:
      case PREVIEW_STATUS_EXPIRED:
        return 'error';
      default:
        return 'error';
    }
  })();

  return {
    previewId: snapshot.id,
    status: mapStatus,
    summary: snapshot.summary ?? EMPTY_PREVIEW_SUMMARY,
    error: snapshot.failure?.message ?? null,
    recoveryAction: snapshot.failure?.recoveryAction ?? null,
  };
}

function supportsMetadataProfiles(instanceType: string): boolean {
  if (!isArrAppType(instanceType)) {
    return false;
  }

  return (
    supportsArrSyncSurface(instanceType, METADATA_PROFILES_SURFACE) &&
    isSyncSectionSupported(instanceType, METADATA_PROFILES_SECTION)
  );
}

function parseSourceIdFromForm(value: FormDataEntryValue | null): { value: number } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'sourceId is required' };
  }

  const sourceId = Number.parseInt(value, 10);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return { error: 'Invalid sourceId' };
  }

  return { value: sourceId };
}

function parseTrashGuideTriggerFromForm(
  value: FormDataEntryValue | null
): { value: TrashGuideSyncTrigger } | { error: string } {
  if (value === null || value === '') {
    return { value: 'manual' };
  }

  if (typeof value !== 'string') {
    return { error: 'trigger must be a string' };
  }

  if (!VALID_TRASH_GUIDE_SYNC_TRIGGERS.has(value)) {
    return { error: `Invalid TRaSH sync trigger: ${value}` };
  }

  return { value: value as TrashGuideSyncTrigger };
}

function parseTrashGuideSelectionsFromForm(
  value: FormDataEntryValue | null
): { value: TrashGuideSyncSelectionInput[] } | { error: string } {
  if (value === null || value === '') {
    return { value: [] };
  }

  if (typeof value !== 'string') {
    return { error: 'selections must be a JSON string array' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'selections must be valid JSON' };
  }

  if (!Array.isArray(parsed)) {
    return { error: 'selections must be an array' };
  }

  const selections: TrashGuideSyncSelectionInput[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: `selections[${i}] must be an object` };
    }

    const row = item as Record<string, unknown>;
    if (typeof row.sectionType !== 'string') {
      return { error: `selections[${i}].sectionType must be a string` };
    }

    if (typeof row.itemName !== 'string') {
      return { error: `selections[${i}].itemName must be a string` };
    }

    selections.push({
      sectionType: row.sectionType as TrashGuideSyncSelectionInput['sectionType'],
      itemName: row.itemName,
    });
  }

  return { value: selections };
}

function mapTrashGuideActionError(error: unknown): { status: number; message: string } {
  if (error instanceof TrashGuideSyncScopeError) {
    return {
      status: error.code === 'arr_type_mismatch' ? 422 : 404,
      message: error.message,
    };
  }

  if (error instanceof TrashGuideSyncValidationError) {
    return { status: 400, message: error.message };
  }

  if (error instanceof TrashGuideSourceNotFoundError) {
    return { status: 404, message: error.message };
  }

  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }

  return { status: 500, message: 'TRaSH source sync request failed' };
}

const ARR_SYNC_SECTIONS: readonly ArrSyncSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];

/** Queue job types that execute Arr sync sections for one instance (`payload.instanceId`). */
const ARR_SYNC_SECTION_JOB_TYPES: ReadonlyMap<JobType, ArrSyncSection> = new Map<JobType, ArrSyncSection>([
  ['arr.sync.qualityProfiles', 'qualityProfiles'],
  ['arr.sync.delayProfiles', 'delayProfiles'],
  ['arr.sync.mediaManagement', 'mediaManagement'],
  ['arr.sync.metadataProfiles', 'metadataProfiles'],
]);
const ARR_SYNC_JOB_TYPES: readonly JobType[] = ['arr.sync', ...ARR_SYNC_SECTION_JOB_TYPES.keys()];

type SectionStatusMap = Record<ArrSyncSection, string>;

function isArrSyncSection(value: unknown): value is ArrSyncSection {
  return ARR_SYNC_SECTIONS.some((section) => section === value);
}

/** Sections a queued `arr.sync*` job will run; mirrors the arrSync handler's section resolution. */
function resolveJobSections(job: JobQueueRecord): readonly ArrSyncSection[] {
  const mapped = ARR_SYNC_SECTION_JOB_TYPES.get(job.jobType);
  if (mapped) return [mapped];
  if (job.jobType !== 'arr.sync') return [];

  const payload: Record<string, unknown> = job.payload;
  const raw = payload.sections ?? payload.section;
  const requested = Array.isArray(raw) ? raw.filter(isArrSyncSection) : isArrSyncSection(raw) ? [raw] : [];
  return requested.length > 0 ? requested : ARR_SYNC_SECTIONS;
}

function isDueQueuedJob(job: JobQueueRecord, now: number): boolean {
  if (job.status !== 'queued') return false;
  const runAt = Date.parse(job.runAt);
  return !Number.isFinite(runAt) || runAt <= now;
}

/**
 * Sections a running (or queued and due) `sync.canary.rollout` job covers on this instance. The
 * rollout handler syncs `remainingTargets[batchCursor, batchCursor + maxBatchSize)` through
 * `executeSyncJob`, which marks sections pending without a per-instance queue row; the cursor only
 * advances after the batch finishes, so the current slice is exactly the in-flight batch.
 */
function resolveCanaryRolloutSections(job: JobQueueRecord, instanceId: number): readonly ArrSyncSection[] {
  const rollout = canaryRolloutQueries.getById(Number(job.payload.rolloutId));
  if (!rollout || rollout.status !== 'rolling_out') return [];
  const batch = rollout.remainingTargets.slice(rollout.batchCursor, rollout.batchCursor + rollout.maxBatchSize);
  if (!batch.some((target) => target.instanceId === instanceId)) return [];
  const sections = (rollout.sections ?? []).filter(isArrSyncSection);
  return sections.length > 0 ? sections : ARR_SYNC_SECTIONS;
}

/**
 * Reconciles persisted section sync status with the instance's active `arr.sync*` jobs and any
 * active canary rollout batch that includes the instance.
 *
 * A job is marked `running` when the dispatcher claims it, but the section only flips to
 * `in_progress` later inside the handler, so a running job covering a `pending` section reports it
 * as `in_progress`. A `pending` section with no queued or running job covering it (a skipped or
 * cancelled run) reports `idle` instead of a stale queued state.
 */
function deriveSectionStatus(instanceId: number, persisted: SectionStatusMap): SectionStatusMap {
  const running = new Set<ArrSyncSection>();
  const queued = new Set<ArrSyncSection>();
  const cover = (job: JobQueueRecord, sections: readonly ArrSyncSection[]): void => {
    const target = job.status === 'running' ? running : queued;
    for (const section of sections) {
      target.add(section);
    }
  };
  for (const job of jobQueueQueries.listActiveByJobTypesAndInstanceId(ARR_SYNC_JOB_TYPES, instanceId)) {
    cover(job, resolveJobSections(job));
  }
  const now = Date.now();
  for (const job of jobQueueQueries.listByJobTypes(['sync.canary.rollout'])) {
    if (job.status !== 'running' && !isDueQueuedJob(job, now)) continue;
    cover(job, resolveCanaryRolloutSections(job, instanceId));
  }

  const derived = { ...persisted };
  for (const section of ARR_SYNC_SECTIONS) {
    const status = persisted[section];
    if (status !== 'pending' && status !== 'in_progress') continue;
    if (running.has(section)) {
      derived[section] = 'in_progress';
    } else if (status === 'pending' && !queued.has(section)) {
      derived[section] = 'idle';
    }
  }
  return derived;
}

export const load: ServerLoad = async ({ params, url, depends }) => {
  depends(LIVE_DEPENDENCY_KEYS.sync);
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  // Get all databases
  const databases = pcdManager.getAll();
  const arrType = instance.type;
  const typedArrType = isArrAppType(arrType) ? arrType : null;
  const canLoadMetadataProfiles = supportsMetadataProfiles(arrType);
  const previewId = url.searchParams.get('previewId');
  const syncPreview = getSyncPreviewRouteState(id, previewId);

  // Fetch profiles and configs from each database
  const databasesWithProfiles = await Promise.all(
    databases.map(async (db) => {
      const cache = pcdManager.getCache(db.id);
      if (!cache) {
        return {
          id: db.id,
          name: db.name,
          qualityProfiles: [],
          delayProfiles: [],
          namingConfigs: [],
          qualityDefinitionsConfigs: [],
          mediaSettingsConfigs: [],
          metadataProfiles: [],
        };
      }

      const [qualityProfiles, delayProfiles, allNamingConfigs, allQualityDefinitionsConfigs, allMediaSettingsConfigs] =
        await Promise.all([
          qualityProfileQueries.list(cache, typedArrType ?? undefined),
          delayProfileQueries.list(cache),
          namingQueries.list(cache),
          qualityDefinitionsQueries.list(cache),
          mediaSettingsQueries.list(cache),
        ]);

      const metadataProfiles = canLoadMetadataProfiles ? await metadataProfileQueries.list(cache) : [];

      // Filter configs by arr type - only show configs for the instance's arr type
      const namingConfigs = allNamingConfigs.filter((c) => c.arr_type === arrType).map((c) => ({ name: c.name }));
      const qualityDefinitionsConfigs = allQualityDefinitionsConfigs
        .filter((c) => c.arr_type === arrType)
        .map((c) => ({ name: c.name }));
      const mediaSettingsConfigs = allMediaSettingsConfigs
        .filter((c) => c.arr_type === arrType)
        .map((c) => ({ name: c.name }));

      return {
        id: db.id,
        name: db.name,
        qualityProfiles,
        delayProfiles,
        namingConfigs,
        qualityDefinitionsConfigs,
        mediaSettingsConfigs,
        metadataProfiles: metadataProfiles.map((profile) => ({ name: profile.name })),
      };
    })
  );

  // Load existing sync data
  const syncData = arrSyncQueries.getFullSyncData(id);
  const trashGuideQualityProfilesBySource = trashGuideSyncQueries
    .getQualityProfileSourceHydrationByInstance(id)
    .map((source) => ({
      ...source,
      availableQualityProfiles: buildTrashGuideAvailableSelections(source.sourceId, source.selectedQualityProfiles),
    }));

  const hydratedMediaManagementSources = trashGuideSyncQueries.getSourceHydrationByInstance(id);
  const mediaManagementSourceHydrationById = new Map<number, (typeof hydratedMediaManagementSources)[number]>();
  for (const source of hydratedMediaManagementSources) {
    mediaManagementSourceHydrationById.set(source.sourceId, source);
  }

  if (isTrashGuideSupportedArrType(arrType)) {
    for (const source of trashGuideSourcesQueries.getByArrType(arrType)) {
      if (mediaManagementSourceHydrationById.has(source.id)) {
        continue;
      }

      mediaManagementSourceHydrationById.set(source.id, {
        sourceId: source.id,
        sourceName: source.name,
        sourceArrType: source.arr_type,
        config: null,
        selections: [],
      });
    }
  }

  const trashGuideMediaManagementBySource = [...mediaManagementSourceHydrationById.values()]
    .map((source) => {
      const namingSel = source.selections.find((s) => s.sectionType === 'naming');
      const qdSel = source.selections.find((s) => s.sectionType === 'qualityDefinitions');
      const selectedNaming = namingSel?.itemName?.trim() || null;
      const selectedQualityDefinitions = qdSel?.itemName?.trim() || null;

      const namingEntities = trashGuideEntityCacheQueries
        .getBySourceAndType(source.sourceId, 'naming')
        .map((entity) => entity.name.trim())
        .filter((name) => name.length > 0);
      if (selectedNaming) {
        namingEntities.push(selectedNaming);
      }

      const qualitySizeEntities = trashGuideEntityCacheQueries
        .getBySourceAndType(source.sourceId, 'quality_size')
        .map((entity) => entity.name.trim())
        .filter((name) => name.length > 0);
      if (selectedQualityDefinitions) {
        qualitySizeEntities.push(selectedQualityDefinitions);
      }

      return {
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        sourceArrType: source.sourceArrType,
        namingEntities: [...new Set(namingEntities)].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        ),
        qualitySizeEntities: [...new Set(qualitySizeEntities)].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        ),
        selectedNaming,
        selectedQualityDefinitions,
      };
    })
    .filter(
      (source) =>
        source.namingEntities.length > 0 ||
        source.qualitySizeEntities.length > 0 ||
        source.selectedNaming !== null ||
        source.selectedQualityDefinitions !== null
    )
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: 'base' }));

  const configStatus = arrSyncQueries.getSyncConfigStatus(id);

  return {
    instance,
    databases: databasesWithProfiles,
    syncData,
    trashGuideQualityProfilesBySource,
    trashGuideMediaManagementBySource,
    metadataProfilesSupported: canLoadMetadataProfiles,
    syncPreview,
    sectionStatus: deriveSectionStatus(id, {
      qualityProfiles: configStatus.qualityProfiles.syncStatus,
      delayProfiles: configStatus.delayProfiles.syncStatus,
      mediaManagement: configStatus.mediaManagement.syncStatus,
      metadataProfiles: configStatus.metadataProfiles.syncStatus,
    }),
  };
};

export const actions: Actions = {
  saveQualityProfiles: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    const formData = await request.formData();
    const selectionsJson = formData.get('selections') as string;
    const trigger = formData.get('trigger') as SyncTrigger;
    const cron = formData.get('cron') as string | null;

    let rawSelections: unknown;
    try {
      rawSelections = JSON.parse(selectionsJson || '[]');
    } catch {
      return fail(400, { error: 'Invalid quality profile selections payload' });
    }
    if (!Array.isArray(rawSelections)) {
      return fail(400, { error: 'Quality profile selections must be an array' });
    }

    try {
      const effectiveTrigger = trigger || 'manual';
      const effectiveCron = cron || null;
      const profileCount = arrSyncQueries.saveQualityProfilesSync(id, rawSelections, {
        trigger: effectiveTrigger,
        cron: effectiveCron,
        nextRunAt: effectiveTrigger === 'schedule' ? calculateNextRun(effectiveCron) : null,
      });

      await logger.info(`Quality profiles sync config saved for "${instance?.name}"`, {
        source: 'sync',
        meta: { instanceId: id, profileCount, trigger },
      });

      scheduleArrSyncForInstance(id);

      return { success: true };
    } catch (e) {
      if (e instanceof InvalidProfileSelectionError) {
        return fail(400, { error: e.message });
      }
      await logger.error('Failed to save quality profiles sync config', {
        source: 'sync',
        meta: { instanceId: id, error: e },
      });
      return fail(500, { error: 'Failed to save quality profiles sync config' });
    }
  },

  saveDelayProfiles: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    const formData = await request.formData();
    const databaseId = formData.get('databaseId') as string | null;
    const profileName = formData.get('profileName') as string | null;
    const trigger = formData.get('trigger') as SyncTrigger;
    const cron = formData.get('cron') as string | null;

    try {
      const effectiveTrigger = trigger || 'manual';
      const effectiveCron = cron || null;
      arrSyncQueries.saveDelayProfilesSync(id, {
        databaseId: databaseId ? parseInt(databaseId, 10) : null,
        profileName: profileName || null,
        trigger: effectiveTrigger,
        cron: effectiveCron,
        nextRunAt: effectiveTrigger === 'schedule' ? calculateNextRun(effectiveCron) : null,
      });

      await logger.info(`Delay profile sync config saved for "${instance?.name}"`, {
        source: 'sync',
        meta: { instanceId: id, databaseId, profileName, trigger },
      });

      scheduleArrSyncForInstance(id);

      return { success: true };
    } catch (e) {
      await logger.error('Failed to save delay profile sync config', {
        source: 'sync',
        meta: { instanceId: id, error: e },
      });
      return fail(500, { error: 'Failed to save delay profile sync config' });
    }
  },

  saveMediaManagement: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    const formData = await request.formData();
    const namingDatabaseId = formData.get('namingDatabaseId') as string | null;
    const namingConfigName = formData.get('namingConfigName') as string | null;
    const qualityDefinitionsDatabaseId = formData.get('qualityDefinitionsDatabaseId') as string | null;
    const qualityDefinitionsConfigName = formData.get('qualityDefinitionsConfigName') as string | null;
    const mediaSettingsDatabaseId = formData.get('mediaSettingsDatabaseId') as string | null;
    const mediaSettingsConfigName = formData.get('mediaSettingsConfigName') as string | null;
    const trigger = formData.get('trigger') as SyncTrigger;
    const cron = formData.get('cron') as string | null;

    try {
      const effectiveTrigger = trigger || 'manual';
      const effectiveCron = cron || null;
      arrSyncQueries.saveMediaManagementSync(id, {
        namingDatabaseId: namingDatabaseId ? parseInt(namingDatabaseId, 10) : null,
        namingConfigName: namingConfigName || null,
        qualityDefinitionsDatabaseId: qualityDefinitionsDatabaseId ? parseInt(qualityDefinitionsDatabaseId, 10) : null,
        qualityDefinitionsConfigName: qualityDefinitionsConfigName || null,
        mediaSettingsDatabaseId: mediaSettingsDatabaseId ? parseInt(mediaSettingsDatabaseId, 10) : null,
        mediaSettingsConfigName: mediaSettingsConfigName || null,
        trigger: effectiveTrigger,
        cron: effectiveCron,
        nextRunAt: effectiveTrigger === 'schedule' ? calculateNextRun(effectiveCron) : null,
      });

      await logger.info(`Media management sync config saved for "${instance?.name}"`, {
        source: 'sync',
        meta: { instanceId: id, trigger },
      });

      scheduleArrSyncForInstance(id);

      return { success: true };
    } catch (e) {
      await logger.error('Failed to save media management sync config', {
        source: 'sync',
        meta: { instanceId: id, error: e },
      });
      return fail(500, { error: 'Failed to save media management sync config' });
    }
  },

  saveMetadataProfiles: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }
    if (!supportsMetadataProfiles(instance.type)) {
      return fail(400, { error: METADATA_PROFILE_UNSUPPORTED_ERROR });
    }

    const formData = await request.formData();
    const databaseId = formData.get('databaseId') as string | null;
    const profileName = formData.get('profileName') as string | null;
    const trigger = formData.get('trigger') as SyncTrigger;
    const cron = formData.get('cron') as string | null;

    try {
      const effectiveTrigger = trigger || 'manual';
      const effectiveCron = cron || null;
      arrSyncQueries.saveMetadataProfilesSync(id, {
        databaseId: databaseId ? parseInt(databaseId, 10) : null,
        profileName: profileName || null,
        trigger: effectiveTrigger,
        cron: effectiveCron,
        nextRunAt: effectiveTrigger === 'schedule' ? calculateNextRun(effectiveCron) : null,
      });

      await logger.info(`Metadata profiles sync config saved for "${instance?.name}"`, {
        source: 'sync',
        meta: { instanceId: id, databaseId, profileName, trigger },
      });

      scheduleArrSyncForInstance(id);

      return { success: true };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      await logger.error('Failed to save metadata profiles sync config', {
        source: 'sync',
        meta: { instanceId: id, error: errorMsg },
      });

      return fail(500, { error: `Failed to save metadata profiles sync config: ${errorMsg}` });
    }
  },

  saveTrashGuideSource: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const formData = await request.formData();
    const sourceIdResult = parseSourceIdFromForm(formData.get('sourceId'));
    if ('error' in sourceIdResult) {
      return fail(400, { error: sourceIdResult.error });
    }

    const mergeMediaManagementSelections = formData.get('mergeMediaManagementSelections') === 'true';

    if (mergeMediaManagementSelections) {
      // Media Management only: merge naming/qualityDefinitions into existing selections; do not change trigger/cron or other section types
      const selectionsResult = parseTrashGuideSelectionsFromForm(formData.get('selections'));
      if ('error' in selectionsResult) {
        return fail(400, { error: selectionsResult.error });
      }
      const sourceId = sourceIdResult.value;
      try {
        trashGuideSyncQueries.assertScope(id, sourceId);
        const existing = trashGuideSyncQueries.getSelections(id, sourceId);
        const otherSections = existing.filter(
          (s) => s.sectionType !== 'naming' && s.sectionType !== 'qualityDefinitions'
        );
        const merged = [
          ...otherSections.map((s) => ({ sectionType: s.sectionType, itemName: s.itemName })),
          ...selectionsResult.value,
        ];
        trashGuideSyncQueries.setSelections(id, sourceId, merged);
        await logger.info(`TRaSH media management selections merged for "${instance.name}"`, {
          source: 'sync',
          meta: { instanceId: id, sourceId, selectionCount: merged.length },
        });
        return { success: true };
      } catch (error) {
        const mapped = mapTrashGuideActionError(error);
        if (mapped.status >= 500) {
          await logger.error('Failed to merge TRaSH media management selections', {
            source: 'sync',
            meta: { instanceId: id, sourceId: sourceIdResult.value, error: mapped.message },
          });
        }
        return fail(mapped.status, { error: mapped.message });
      }
    }

    const triggerResult = parseTrashGuideTriggerFromForm(formData.get('trigger'));
    if ('error' in triggerResult) {
      return fail(400, { error: triggerResult.error });
    }

    const selectionsResult = parseTrashGuideSelectionsFromForm(formData.get('selections'));
    if ('error' in selectionsResult) {
      return fail(400, { error: selectionsResult.error });
    }

    const cronValue = formData.get('cron');
    const cron = typeof cronValue === 'string' && cronValue.length > 0 ? cronValue : null;

    try {
      const trigger = triggerResult.value;
      trashGuideSyncQueries.saveState({
        instanceId: id,
        sourceId: sourceIdResult.value,
        trigger,
        cron,
        nextRunAt: trigger === 'schedule' ? calculateNextRun(cron) : null,
        shouldSync: false,
        selections: selectionsResult.value,
      });

      await logger.info(`TRaSH source sync config saved for "${instance.name}"`, {
        source: 'sync',
        meta: {
          instanceId: id,
          sourceId: sourceIdResult.value,
          trigger,
          selectionCount: selectionsResult.value.length,
        },
      });

      return { success: true };
    } catch (error) {
      const mapped = mapTrashGuideActionError(error);
      if (mapped.status >= 500) {
        await logger.error('Failed to save TRaSH source sync config', {
          source: 'sync',
          meta: { instanceId: id, sourceId: sourceIdResult.value, error: mapped.message },
        });
      }
      return fail(mapped.status, { error: mapped.message });
    }
  },

  syncTrashGuideSource: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const formData = await request.formData();
    const sourceIdResult = parseSourceIdFromForm(formData.get('sourceId'));
    if ('error' in sourceIdResult) {
      return fail(400, { error: sourceIdResult.error });
    }

    const sourceId = sourceIdResult.value;

    try {
      trashGuideSyncQueries.assertScope(id, sourceId);
      const queued = enqueueManualTrashGuideSourceSync(sourceId);
      const statusUrl = `/api/v1/trash-guide/sources/${sourceId}/sync`;
      if (queued.status === 'already_running') {
        return fail(409, {
          error: 'TRaSH sync is already running for this source',
          deduped: true,
          runToken: queued.runToken,
          statusUrl,
          view: queued.view,
        });
      }

      await logger.info(`Queued TRaSH source sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          instanceId: id,
          sourceId,
          queueId: queued.view.queueId,
          runId: queued.runToken,
          jobStatus: queued.view.current?.status ?? null,
          runAt: queued.view.current?.runAt ?? null,
        },
      });

      return {
        success: true,
        message: 'TRaSH source sync queued',
        runToken: queued.runToken,
        statusUrl,
        view: queued.view,
      };
    } catch (error) {
      const mapped = mapTrashGuideActionError(error);
      if (mapped.status >= 500) {
        await logger.error(`TRaSH source sync enqueue failed for "${instance.name}"`, {
          source: 'sync',
          meta: { instanceId: id, sourceId, error: mapped.message },
        });
      }
      return fail(mapped.status, { error: mapped.message });
    }
  },

  syncDelayProfiles: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    try {
      arrSyncQueries.setDelayProfilesStatusPending(id);
      const queued = enqueueJob({
        jobType: 'arr.sync.delayProfiles',
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
      });

      await logger.info(`Queued delay profiles sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName('arr.sync.delayProfiles', { instanceId: id }),
        },
      });

      return { success: true, message: 'Delay profiles sync queued', jobId: queued.id };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      await logger.error(`Delay profiles sync enqueue failed for "${instance.name}"`, {
        source: 'sync',
        meta: { instanceId: id, error: errorMsg },
      });
      return fail(500, { error: `Sync failed: ${errorMsg}` });
    }
  },

  syncQualityProfiles: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    try {
      arrSyncQueries.setQualityProfilesStatusPending(id);
      const queued = enqueueJob({
        jobType: 'arr.sync.qualityProfiles',
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
      });

      await logger.info(`Queued quality profiles sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName('arr.sync.qualityProfiles', { instanceId: id }),
        },
      });

      return { success: true, message: 'Quality profiles sync queued', jobId: queued.id };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      await logger.error(`Quality profiles sync enqueue failed for "${instance.name}"`, {
        source: 'sync',
        meta: { instanceId: id, error: errorMsg },
      });
      return fail(500, { error: `Sync failed: ${errorMsg}` });
    }
  },

  syncMediaManagement: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    try {
      arrSyncQueries.setMediaManagementStatusPending(id);
      const queued = enqueueJob({
        jobType: 'arr.sync.mediaManagement',
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
      });

      await logger.info(`Queued media management sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName('arr.sync.mediaManagement', { instanceId: id }),
        },
      });

      return { success: true, message: 'Media management sync queued', jobId: queued.id };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      await logger.error(`Media management sync enqueue failed for "${instance.name}"`, {
        source: 'sync',
        meta: { instanceId: id, error: errorMsg },
      });
      return fail(500, { error: `Sync failed: ${errorMsg}` });
    }
  },

  syncMetadataProfiles: async ({ params }) => {
    const id = parseInt(params.id || '', 10);
    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }
    if (!supportsMetadataProfiles(instance.type)) {
      return fail(400, { error: METADATA_PROFILE_UNSUPPORTED_ERROR });
    }

    try {
      const jobType = 'arr.sync.metadataProfiles';

      arrSyncQueries.setMetadataProfilesStatusPending(id);
      const queued = enqueueJob({
        jobType,
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
      });

      await logger.info(`Queued metadata profiles sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName(jobType, { instanceId: id }),
        },
      });

      return { success: true, message: 'Metadata profiles sync queued', jobId: queued.id };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      await logger.error(`Metadata profiles sync enqueue failed for "${instance.name}"`, {
        source: 'sync',
        meta: { instanceId: id, error: errorMsg },
      });

      return fail(500, { error: `Sync failed: ${errorMsg}` });
    }
  },
};
