/**
 * Execute reviewed prune deletes for ledger-owned Arr entities (YAN-516).
 *
 * Validate reviewed snapshots before the batch, then re-read each entity immediately
 * before DELETE. Surviving profiles protect their scored formats. HTTP 404 counts
 * as success (already gone); skips and failures keep ownership for the next run.
 */

import { HttpError } from '$http/types.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import type { PruneLiveEntity, PrunePlanItem } from './planPrunes.ts';
import type { SyncPreviewArrType } from '../preview/types.ts';
import type { SyncEntityOutcome } from '../types.ts';
import type { BaseArrClient } from '$arr/base.ts';
import { logger } from '$logger/logger.ts';

export interface ExecutePruneGuards {
  readonly customFormats: readonly PruneLiveEntity[];
  readonly qualityProfiles: readonly PruneLiveEntity[];
}

/** Live entity shape accepted here; `name` is required for the guard. */
export type { PruneLiveEntity };

/**
 * Delete the planned ledger-owned entities in the given order (QPs first).
 * Throws before any DELETE when an item no longer matches its live guard.
 */
export async function executePrunes(
  client: BaseArrClient,
  instanceId: number,
  arrType: SyncPreviewArrType,
  items: readonly PrunePlanItem[],
  guards: ExecutePruneGuards
): Promise<SyncEntityOutcome[]> {
  const liveCFById = indexById(guards.customFormats);
  const liveQPById = indexById(guards.qualityProfiles);

  for (const item of items) {
    const live = item.entityType === 'qualityProfile' ? liveQPById.get(item.remoteId) : liveCFById.get(item.remoteId);
    if (!live || live.name !== item.arrName) {
      throw new Error(`Prune guard mismatch for ${item.entityType} "${item.arrName}" (id=${item.remoteId})`);
    }
  }

  const outcomes: SyncEntityOutcome[] = [];
  const protectedFormatIds = new Set<number>();
  const protectedFormatNames = new Set<string>();
  const protectFormats = (profile: PruneLiveEntity | undefined): void => {
    for (const format of profile?.formatItems ?? []) {
      if ((format.score ?? 0) === 0) continue;
      if (typeof format.format === 'number') protectedFormatIds.add(format.format);
      if (typeof format.name === 'string') protectedFormatNames.add(format.name);
    }
  };

  for (const item of items) {
    if (
      item.entityType === 'customFormat' &&
      (protectedFormatIds.has(item.remoteId) || protectedFormatNames.has(item.arrName))
    ) {
      outcomes.push(
        outcomeFor(item, arrType, 'skipped', 'Custom format is scored by a quality profile that was not deleted')
      );
      continue;
    }
    let freshProfile: PruneLiveEntity | undefined;
    try {
      const live =
        item.entityType === 'qualityProfile'
          ? await client.getQualityProfile(item.remoteId)
          : await client.getCustomFormat(item.remoteId);
      if (live.name !== item.arrName) {
        if (item.entityType === 'qualityProfile') {
          protectFormats(liveQPById.get(item.remoteId));
          protectFormats(live);
        }
        outcomes.push(outcomeFor(item, arrType, 'skipped', 'Arr entity changed since review; not deleted'));
        continue;
      }
      if (item.entityType === 'qualityProfile') {
        // Preserve fresh references too if Arr refuses this profile's deletion.
        freshProfile = live;
        await client.deleteQualityProfile(item.remoteId);
      } else {
        await client.deleteCustomFormat(item.remoteId);
      }
      arrManagedEntitiesQueries.deleteConfirmed(instanceId, item.entityType, item.remoteId);
      outcomes.push(outcomeFor(item, arrType, 'success', null));
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        // Already gone: the entity state we want is confirmed; drop the row.
        arrManagedEntitiesQueries.deleteConfirmed(instanceId, item.entityType, item.remoteId);
        outcomes.push(outcomeFor(item, arrType, 'success', null));
        continue;
      }
      if (item.entityType === 'qualityProfile') {
        protectFormats(liveQPById.get(item.remoteId));
        protectFormats(freshProfile);
      }
      const sanitized = sanitizeArrWriteError(error);
      void logger.error(`Failed to prune ${item.entityType} "${item.pcdName}"`, {
        source: 'Sync:Ownership',
        meta: {
          instanceId,
          entityType: item.entityType,
          remoteId: item.remoteId,
          ...sanitized.protectedDetails,
        },
      });
      outcomes.push(outcomeFor(item, arrType, 'failed', sanitized.reason));
    }
  }

  return outcomes;
}

function indexById(entities: readonly PruneLiveEntity[]): Map<number, PruneLiveEntity> {
  const byId = new Map<number, PruneLiveEntity>();
  for (const entity of entities) {
    if (typeof entity.id === 'number') byId.set(entity.id, entity);
  }
  return byId;
}

function outcomeFor(
  item: PrunePlanItem,
  arrType: SyncPreviewArrType,
  status: 'success' | 'failed' | 'skipped',
  reason: string | null
): SyncEntityOutcome {
  return {
    section: 'qualityProfiles',
    arrType,
    entityType: item.entityType,
    name: item.pcdName,
    action: 'delete',
    status,
    remoteId: String(item.remoteId),
    reason,
  };
}
