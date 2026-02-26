/**
 * Sync processor
 * Processes pending syncs by creating syncer instances and running them
 *
 * Triggers:
 * - on_pull: Triggered directly via triggerSyncs() after database git pull completes
 * - on_change: Triggered directly via triggerSyncs() after PCD files change
 * - schedule: Cron expressions evaluated by evaluateScheduledSyncs() before processing
 */

import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { calculateNextRun } from './utils.ts';
import type { ArrType } from '$arr/types.ts';
import type { ArrInstanceClientCache } from '$arr/arrInstanceClients.ts';
import { logger } from '$logger/logger.ts';
import { upsertScheduledJob } from '$lib/server/jobs/queueService.ts';
import { createArrInstanceClientCache, getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type {
  SectionType,
  SectionHandler,
  ProcessSyncsResult,
  InstanceSyncResult,
  SyncTriggerEvent,
  TriggerContext,
} from './types.ts';
// Import handlers to trigger registration
import './qualityProfiles/handler.ts';
import './delayProfiles/handler.ts';
import './mediaManagement/handler.ts';
import './metadataProfiles/handler.ts';

import { getAllSections, getSection } from './registry.ts';
import { generatePreview, type GeneratePreviewResult } from './preview/orchestrator.ts';

// Concurrency limit for parallel instance processing
const CONCURRENCY_LIMIT = 3;

// Process-level guard: instances actively being processed by startup pull.
// When set, triggerSyncs skips on_pull fanout for these instances to prevent
// redundant sync work (the selections were just reconstructed from live Arr state).
const startupPullActiveInstances = new Set<number>();

/**
 * Mark an instance as actively being processed by a startup pull to suppress redundant sync triggers.
 *
 * @param instanceId - The Arr instance ID to mark
 */
export function markInstanceStartupPullActive(instanceId: number): void {
  startupPullActiveInstances.add(instanceId);
}

/**
 * Clear the startup pull active guard for an instance once the pull completes.
 *
 * @param instanceId - The Arr instance ID to unmark
 */
export function markInstanceStartupPullComplete(instanceId: number): void {
  startupPullActiveInstances.delete(instanceId);
}

/**
 * Returns true if a startup pull is currently in progress for the given instance.
 *
 * @param instanceId - The Arr instance ID to check
 * @returns Whether the instance startup pull is active
 */
export function isStartupPullInstanceActive(instanceId: number): boolean {
  return startupPullActiveInstances.has(instanceId);
}

export type { ProcessSyncsResult, InstanceSyncResult, SyncTriggerEvent, TriggerContext };

export interface PreviewInstanceRequest {
  instanceId: number;
  sections?: SectionType[];
  nowMs?: number;
}

async function generateSingleInstancePreview(request: PreviewInstanceRequest): Promise<GeneratePreviewResult> {
  const instance = arrInstancesQueries.getById(request.instanceId);
  if (!instance) {
    throw new Error(`Instance ${request.instanceId} not found`);
  }

  if (!instance.enabled) {
    throw new Error(`Instance "${instance.name}" is disabled`);
  }

  return generatePreview({
    instance,
    sections: request.sections,
    nowMs: request.nowMs,
  });
}

/**
 * Generate a preview for one instance.
 */
export function generateInstancePreview(instanceId: number, sections?: SectionType[]): Promise<GeneratePreviewResult> {
  return generateSingleInstancePreview({ instanceId, sections });
}

/**
 * Generate previews for multiple instances with bounded concurrency.
 */
export async function generateInstancePreviews(requests: PreviewInstanceRequest[]): Promise<GeneratePreviewResult[]> {
  if (requests.length === 0) return [];

  const baseNowMs = Date.now();
  const preparedRequests = requests.map((request, index) => ({
    ...request,
    nowMs: request.nowMs ?? baseNowMs + index,
  }));

  return processBatches(preparedRequests, generateSingleInstancePreview, CONCURRENCY_LIMIT);
}

/**
 * Check if a scheduled config should trigger based on next_run_at
 * Returns true if:
 * - nextRunAt is null (first run / bootstrap)
 * - current time >= nextRunAt
 */
function shouldTrigger(nextRunAt: string | null): boolean {
  // Bootstrap case: no next_run_at set yet, trigger immediately
  if (!nextRunAt) return true;
  const now = new Date();
  const nextRun = new Date(nextRunAt);
  return now >= nextRun;
}

/**
 * Evaluate scheduled sync configs and mark matching ones for sync
 * Uses the section registry to reduce code duplication
 */
async function evaluateScheduledSyncs(): Promise<void> {
  const sections = getAllSections();
  let totalScheduled = 0;
  let marked = 0;

  // Gather all scheduled configs
  const scheduledBySection = new Map<SectionType, ReturnType<SectionHandler['getScheduledConfigs']>>();
  for (const handler of sections) {
    const configs = handler.getScheduledConfigs();
    scheduledBySection.set(handler.type, configs);
    totalScheduled += configs.length;
  }

  if (totalScheduled === 0) return;

  await logger.debug(`Evaluating ${totalScheduled} scheduled config(s)`, {
    source: 'SyncProcessor',
    meta: Object.fromEntries([...scheduledBySection.entries()].map(([type, configs]) => [type, configs.length])),
  });

  // Process each section's scheduled configs
  for (const handler of sections) {
    const configs = scheduledBySection.get(handler.type) ?? [];
    for (const config of configs) {
      if (shouldTrigger(config.nextRunAt)) {
        // Use setStatusPending which sets both should_sync and sync_status
        handler.setStatusPending(config.instanceId);
        const nextRun = calculateNextRun(config.cron);
        handler.setNextRunAt(config.instanceId, nextRun);
        marked++;
      }
    }
  }

  if (marked > 0) {
    await logger.debug(`Marked ${marked} config(s) for sync based on schedule`, {
      source: 'SyncProcessor',
    });
  }
}

/**
 * Get all pending syncs grouped by instance
 * Returns a map of instanceId -> list of section types that need syncing
 */
function getPendingSyncsByInstance(): Map<number, SectionType[]> {
  const result = new Map<number, SectionType[]>();

  for (const handler of getAllSections()) {
    const instanceIds = handler.getPendingInstanceIds();
    for (const instanceId of instanceIds) {
      if (!result.has(instanceId)) {
        result.set(instanceId, []);
      }
      result.get(instanceId)!.push(handler.type);
    }
  }

  return result;
}

/**
 * Process a single instance's pending syncs
 * Sections are processed sequentially within an instance (dependency order matters)
 */
async function processInstanceSections(
  instance: ArrInstance,
  sectionTypes: SectionType[],
  clientCache: ArrInstanceClientCache
): Promise<InstanceSyncResult> {
  const instanceResult: InstanceSyncResult = {
    instanceId: instance.id,
    instanceName: instance.name,
  };

  const client = await getArrInstanceClient(
    instance.type as ArrType,
    instance.id,
    instance.url,
    undefined,
    clientCache
  );

  // Process sections sequentially (quality profiles depend on custom formats being synced first)
  for (const sectionType of sectionTypes) {
    const handler = getSection(sectionType);

    // Atomically claim the sync (prevents double-processing)
    if (!handler.claimSync(instance.id)) {
      await logger.debug(`Sync for ${sectionType} already claimed, skipping`, {
        source: 'SyncProcessor',
        meta: { instanceId: instance.id, section: sectionType },
      });
      continue;
    }

    try {
      const syncer = handler.createSyncer(client, instance);
      const syncResult = await syncer.sync();

      // Store result on the instance result object
      instanceResult[sectionType] = syncResult;

      // Mark as complete or failed based on result
      if (syncResult.success) {
        handler.completeSync(instance.id);
      } else {
        handler.failSync(instance.id, syncResult.error ?? 'Unknown error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      handler.failSync(instance.id, errorMsg);
      await logger.error(`Failed to sync ${sectionType} for "${instance.name}"`, {
        source: 'SyncProcessor',
        meta: { instanceId: instance.id, section: sectionType, error: errorMsg },
      });
      instanceResult[sectionType] = { success: false, itemsSynced: 0, error: errorMsg };
    }
  }

  return instanceResult;
}

/**
 * Process items in batches with concurrency limit
 */
async function processBatches<T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Process all pending syncs
 * Called by the sync job and directly via triggerSyncs()
 */
export async function processPendingSyncs(): Promise<ProcessSyncsResult> {
  // Evaluate scheduled configs and mark them for sync if cron matches
  await evaluateScheduledSyncs();

  const pendingByInstance = getPendingSyncsByInstance();

  if (pendingByInstance.size === 0) {
    await logger.debug('No pending syncs', { source: 'SyncProcessor' });
    return { totalSynced: 0, results: [] };
  }

  // Log pending counts
  const pendingCounts: Record<string, number> = {};
  for (const handler of getAllSections()) {
    pendingCounts[handler.type] = handler.getPendingInstanceIds().length;
  }

  await logger.info(`Processing syncs for ${pendingByInstance.size} instance(s)`, {
    source: 'SyncProcessor',
    meta: pendingCounts,
  });

  // Prepare instance processing tasks
  const instanceTasks: Array<{
    instance: ArrInstance;
    sectionTypes: SectionType[];
    clientCache: ArrInstanceClientCache;
  }> = [];

  for (const [instanceId, sectionTypes] of pendingByInstance) {
    const instance = arrInstancesQueries.getById(instanceId);

    if (!instance) {
      await logger.warn(`Instance ${instanceId} not found, skipping sync`, {
        source: 'SyncProcessor',
      });
      continue;
    }

    if (!instance.enabled) {
      await logger.debug(`Instance "${instance.name}" is disabled, skipping sync`, {
        source: 'SyncProcessor',
      });
      continue;
    }

    instanceTasks.push({
      instance,
      sectionTypes,
      clientCache: createArrInstanceClientCache(),
    });
  }

  // Process instances in parallel with concurrency limit
  const results = await processBatches(
    instanceTasks,
    ({ instance, sectionTypes, clientCache }) => processInstanceSections(instance, sectionTypes, clientCache),
    CONCURRENCY_LIMIT
  );

  // Calculate total synced
  let totalSynced = 0;
  for (const result of results) {
    if (result.qualityProfiles?.itemsSynced) totalSynced += result.qualityProfiles.itemsSynced;
    if (result.delayProfiles?.itemsSynced) totalSynced += result.delayProfiles.itemsSynced;
    if (result.mediaManagement?.itemsSynced) totalSynced += result.mediaManagement.itemsSynced;
    if (result.metadataProfiles?.itemsSynced) totalSynced += result.metadataProfiles.itemsSynced;
  }

  await logger.info(`Sync processing complete`, {
    source: 'SyncProcessor',
    meta: { totalSynced, instanceCount: results.length },
  });

  return { totalSynced, results };
}

/**
 * Sync a specific instance manually
 * Syncs all configured sections regardless of should_sync flag
 */
export async function syncInstance(instanceId: number): Promise<InstanceSyncResult> {
  const instance = arrInstancesQueries.getById(instanceId);

  if (!instance) {
    throw new Error(`Instance ${instanceId} not found`);
  }

  await logger.info(`Manual sync triggered for "${instance.name}"`, {
    source: 'SyncProcessor',
    meta: { instanceId },
  });

  const client = await getArrInstanceClient(
    instance.type as ArrType,
    instance.id,
    instance.url,
    undefined,
    createArrInstanceClientCache()
  );
  const result: InstanceSyncResult = {
    instanceId,
    instanceName: instance.name,
  };

  // Sync all sections that have configuration
  for (const handler of getAllSections()) {
    if (handler.hasConfig(instanceId)) {
      const syncer = handler.createSyncer(client, instance);
      result[handler.type] = await syncer.sync();
    }
  }

  return result;
}

// =============================================================================
// Event triggers
// =============================================================================

/**
 * Trigger syncs for configs matching the event type
 * Called directly from pcd.ts (on_pull) and cache.ts (on_change)
 */
export async function triggerSyncs(context: TriggerContext): Promise<void> {
  await logger.debug(`Sync trigger: ${context.event}`, {
    source: 'SyncProcessor',
    meta: { databaseId: context.databaseId },
  });

  const triggers = context.event === 'on_change' ? ['on_pull', 'on_change'] : [context.event];
  const instanceIds = arrSyncQueries.getInstanceIdsForTrigger(context.event);

  for (const instanceId of instanceIds) {
    // Skip instances actively being processed by startup pull to prevent
    // redundant sync work (selections were just reconstructed from live state).
    if (startupPullActiveInstances.has(instanceId)) {
      await logger.debug(`Skipping sync trigger for instance ${instanceId} (startup pull active)`, {
        source: 'SyncProcessor',
        meta: { instanceId, event: context.event },
      });
      continue;
    }

    const status = arrSyncQueries.getSyncConfigStatus(instanceId);

    if (triggers.includes(status.qualityProfiles.trigger)) {
      arrSyncQueries.setQualityProfilesStatusPending(instanceId);
      upsertScheduledJob({
        jobType: 'arr.sync.qualityProfiles',
        runAt: new Date().toISOString(),
        payload: { instanceId },
        source: 'system',
        dedupeKey: `arr.sync.qualityProfiles:event:${instanceId}`,
      });
    }
    if (triggers.includes(status.delayProfiles.trigger)) {
      arrSyncQueries.setDelayProfilesStatusPending(instanceId);
      upsertScheduledJob({
        jobType: 'arr.sync.delayProfiles',
        runAt: new Date().toISOString(),
        payload: { instanceId },
        source: 'system',
        dedupeKey: `arr.sync.delayProfiles:event:${instanceId}`,
      });
    }
    if (triggers.includes(status.mediaManagement.trigger)) {
      arrSyncQueries.setMediaManagementStatusPending(instanceId);
      upsertScheduledJob({
        jobType: 'arr.sync.mediaManagement',
        runAt: new Date().toISOString(),
        payload: { instanceId },
        source: 'system',
        dedupeKey: `arr.sync.mediaManagement:event:${instanceId}`,
      });
    }
    if (status.metadataProfiles && triggers.includes(status.metadataProfiles.trigger)) {
      arrSyncQueries.setMetadataProfilesStatusPending(instanceId);
      upsertScheduledJob({
        jobType: 'arr.sync.metadataProfiles',
        runAt: new Date().toISOString(),
        payload: { instanceId },
        source: 'system',
        dedupeKey: `arr.sync.metadataProfiles:event:${instanceId}`,
      });
    }
  }
}
