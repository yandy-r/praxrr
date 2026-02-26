import { error, fail } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries, type SyncTrigger, type ProfileSelection } from '$db/queries/arrSync.ts';
import { trashGuideEntityCacheQueries, type TrashGuideEntityType } from '$db/queries/trashGuideEntityCache.ts';
import {
  trashGuideSyncQueries,
  TrashGuideSyncScopeError,
  TrashGuideSyncValidationError,
  type TrashGuideSyncSectionType,
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
import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';
import { enqueueManualTrashGuideSourceSync } from '../../../api/v1/trash-guide/sources/[id]/sync/+server.ts';
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
};

interface TrashGuideAvailableSelectionGroup {
  sectionType: TrashGuideSyncSectionType;
  label: string;
  items: string[];
}

const TRASH_GUIDE_SECTION_LABELS: Record<TrashGuideSyncSectionType, string> = {
  qualityProfiles: 'Quality Profiles',
  customFormats: 'Custom Formats',
  qualityDefinitions: 'Quality Definitions',
  naming: 'Naming',
  mediaManagement: 'Media Management',
};

const TRASH_GUIDE_SECTION_ORDER: readonly TrashGuideSyncSectionType[] = [
  'qualityProfiles',
  'customFormats',
  'qualityDefinitions',
  'naming',
];

const TRASH_ENTITY_SECTION_MAP: Record<TrashGuideEntityType, TrashGuideSyncSectionType> = {
  quality_profile: 'qualityProfiles',
  custom_format: 'customFormats',
  quality_size: 'qualityDefinitions',
  naming: 'naming',
};

function buildTrashGuideAvailableSelections(sourceId: number): TrashGuideAvailableSelectionGroup[] {
  const grouped = new Map<TrashGuideSyncSectionType, Set<string>>();
  for (const sectionType of TRASH_GUIDE_SECTION_ORDER) {
    grouped.set(sectionType, new Set<string>());
  }

  const entities = trashGuideEntityCacheQueries.getBySource(sourceId);
  for (const entity of entities) {
    const sectionType = TRASH_ENTITY_SECTION_MAP[entity.entityType];
    const normalizedName = entity.name.trim();
    if (!sectionType || normalizedName.length === 0) {
      continue;
    }

    grouped.get(sectionType)?.add(normalizedName);
  }

  return TRASH_GUIDE_SECTION_ORDER.flatMap((sectionType) => {
    const values = grouped.get(sectionType);
    if (!values || values.size === 0) {
      return [];
    }

    return [
      {
        sectionType,
        label: TRASH_GUIDE_SECTION_LABELS[sectionType],
        items: [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      },
    ];
  });
}

function getSyncPreviewRouteState(instanceId: number, previewId: string | null): SyncPreviewRouteState {
  if (!previewId) {
    return {
      previewId: null,
      status: 'idle',
      summary: null,
      error: null,
    };
  }

  const snapshot = previewStore.get(previewId);
  if (!snapshot || snapshot.instanceId !== instanceId) {
    return {
      previewId,
      status: 'error',
      summary: null,
      error: 'Preview not found or not associated with this instance',
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
    error: snapshot.error ?? null,
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

export const load: ServerLoad = async ({ params, url }) => {
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
  const trashGuideSyncBySource = trashGuideSyncQueries.getSourceHydrationByInstance(id).map((source) => ({
    ...source,
    availableSelections: buildTrashGuideAvailableSelections(source.sourceId),
  }));

  return {
    instance,
    databases: databasesWithProfiles,
    syncData,
    trashGuideSyncBySource,
    metadataProfilesSupported: canLoadMetadataProfiles,
    syncPreview,
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

    try {
      const selections: ProfileSelection[] = JSON.parse(selectionsJson || '[]');
      const effectiveTrigger = trigger || 'manual';
      const effectiveCron = cron || null;
      arrSyncQueries.saveQualityProfilesSync(id, selections, {
        trigger: effectiveTrigger,
        cron: effectiveCron,
        nextRunAt: effectiveTrigger === 'schedule' ? calculateNextRun(effectiveCron) : null,
      });

      await logger.info(`Quality profiles sync config saved for "${instance?.name}"`, {
        source: 'sync',
        meta: { instanceId: id, profileCount: selections.length, trigger },
      });

      scheduleArrSyncForInstance(id);

      return { success: true };
    } catch (e) {
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
      if (queued.status === 'already_running') {
        return fail(409, {
          error: 'TRaSH sync is already running for this source',
          run: queued.run,
        });
      }

      await logger.info(`Queued TRaSH source sync for "${instance.name}"`, {
        source: 'sync',
        meta: {
          instanceId: id,
          sourceId,
          jobId: queued.job.id,
          jobStatus: queued.job.status,
          runAt: queued.job.runAt,
        },
      });

      return {
        success: true,
        message: 'TRaSH source sync queued',
        job: queued.job,
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

      return { success: true, message: 'Delay profiles sync queued' };
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

      return { success: true, message: 'Quality profiles sync queued' };
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

      return { success: true, message: 'Media management sync queued' };
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

      return { success: true, message: 'Metadata profiles sync queued' };
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
