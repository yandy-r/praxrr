/**
 * Config cleanup: delete all QPs and CFs from an Arr instance
 * that are not in the current sync selections.
 *
 * Rule: if it's not expected, it's stale — except when a selected namespace's
 * expected names cannot be determined right now. Those namespaces are kept
 * (fail-safe) so a missing cache never deletes live configs.
 * QPs assigned to media will be skipped (arr returns HTTP 500).
 *
 * Scope: by default stale items are additionally limited to ids recorded in the
 * `arr_managed_entities` ownership ledger (entities Praxrr created). Passing
 * `includeUnmanaged` restores the legacy everything-unexpected-is-stale scope.
 */

import type { BaseArrClient } from '$utils/arr/base.ts';
import { hasNamespaceSuffix, stripNamespaceSuffix } from './namespace.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { resolveExpectedArrConfig } from './ownership/expectedConfig.ts';
import type { SyncArrType } from './mappings.ts';
import { HttpError } from '$http/types.ts';
import { logger } from '$logger/logger.ts';

const SOURCE = 'Cleanup';

export interface StaleItem {
  id: number;
  name: string;
  strippedName: string;
}

export interface CleanupScanResult {
  staleCustomFormats: StaleItem[];
  staleQualityProfiles: StaleItem[];
}

export interface CleanupDeleteResult {
  deletedCustomFormats: StaleItem[];
  deletedQualityProfiles: StaleItem[];
  failedCustomFormats: { item: StaleItem; reason: string }[];
  skippedQualityProfiles: { item: StaleItem; reason: string }[];
}

/**
 * Scan an Arr instance for stale configs.
 * Stale = not in the current sync selections and not in a namespace whose
 * expected contents are currently undeterminable.
 *
 * With `includeUnmanaged` false (the default) stale items are also limited to
 * ids in the ownership ledger, so hand-made entities are never listed.
 */
export async function scanForStaleItems(
  client: BaseArrClient,
  instanceId: number,
  includeUnmanaged = false
): Promise<CleanupScanResult> {
  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) throw new Error(`Instance ${instanceId} not found`);
  const arrType = instance.type as SyncArrType;

  const { expectedQPNames, expectedCFNames, isKept, expectedProfiles, keptNamespaces, keptAllTrashNamespaces } =
    await resolveExpectedArrConfig(instanceId, arrType);

  // 2. Fetch all CFs and QPs from the arr
  const [remoteCFs, remoteQPs] = await Promise.all([client.getCustomFormats(), client.getQualityProfiles()]);

  // 3. Stale QPs = everything not expected and not in a kept namespace
  let staleQualityProfiles: StaleItem[] = [];
  const qpDecisions: { name: string; id: number; decision: string }[] = [];

  for (const qp of remoteQPs) {
    if (expectedQPNames.has(qp.name) || isKept(qp.name)) {
      qpDecisions.push({ name: stripNamespaceSuffix(qp.name), id: qp.id, decision: 'keep' });
    } else {
      const displayName = hasNamespaceSuffix(qp.name) ? stripNamespaceSuffix(qp.name) : qp.name;
      staleQualityProfiles.push({ id: qp.id, name: qp.name, strippedName: displayName });
      qpDecisions.push({ name: displayName, id: qp.id, decision: 'stale' });
    }
  }

  // 4. Stale CFs = everything not expected and not in a kept namespace
  let staleCustomFormats: StaleItem[] = [];
  for (const cf of remoteCFs) {
    if (cf.id == null) continue;
    if (expectedCFNames.has(cf.name) || isKept(cf.name)) continue;
    const displayName = hasNamespaceSuffix(cf.name) ? stripNamespaceSuffix(cf.name) : cf.name;
    staleCustomFormats.push({ id: cf.id, name: cf.name, strippedName: displayName });
  }

  if (!includeUnmanaged) {
    const scoped = await scopeStaleItemsToManaged(instanceId, staleCustomFormats, staleQualityProfiles);
    staleCustomFormats = scoped.staleCustomFormats;
    staleQualityProfiles = scoped.staleQualityProfiles;
  }

  await logger.debug('Scan complete', {
    source: SOURCE,
    meta: {
      instanceId,
      includeUnmanaged,
      expectedProfiles,
      expectedCFs: expectedCFNames.size,
      keptNamespaces,
      keptAllTrashNamespaces,
      qualityProfiles: qpDecisions,
      staleCFs: staleCustomFormats.length,
      staleQPs: staleQualityProfiles.length,
    },
  });

  return { staleCustomFormats, staleQualityProfiles };
}

/**
 * Managed-only scope: require ownership ledger type, id, and exact live name.
 * A ledger read failure fails closed: no stale items are returned and the error is logged.
 */
async function scopeStaleItemsToManaged(
  instanceId: number,
  staleCustomFormats: StaleItem[],
  staleQualityProfiles: StaleItem[]
): Promise<{ staleCustomFormats: StaleItem[]; staleQualityProfiles: StaleItem[] }> {
  const managedNames = new Map<string, string>();
  try {
    for (const row of arrManagedEntitiesQueries.listForInstance(instanceId)) {
      managedNames.set(`${row.entityType}:${row.remoteId}`, row.arrName);
    }
  } catch (err) {
    await logger.error('Failed to read the managed entities ledger; reporting no stale items', {
      source: SOURCE,
      meta: { instanceId, error: err instanceof Error ? err.message : String(err) },
    });
    return { staleCustomFormats: [], staleQualityProfiles: [] };
  }
  return {
    staleCustomFormats: staleCustomFormats.filter((cf) => managedNames.get(`customFormat:${cf.id}`) === cf.name),
    staleQualityProfiles: staleQualityProfiles.filter((qp) => managedNames.get(`qualityProfile:${qp.id}`) === qp.name),
  };
}

/** Reason reported for requested items that a fresh server-side scan no longer considers stale. */
export const NO_LONGER_STALE_REASON = 'No longer stale; not deleted';

/** Rejected items included in the warning log (the full count is always logged). */
const REJECTED_LOG_SAMPLE_SIZE = 20;

/**
 * Execute a cleanup request safely: re-scan server-side and delete only requested
 * items whose `id` AND `name` match a currently stale item of the same kind.
 * Requested items that are not currently stale are reported (CFs in
 * `failedCustomFormats`, QPs in `skippedQualityProfiles`) and never deleted.
 *
 * The re-scan uses the same `includeUnmanaged` scope as the request (YAN-471),
 * so a managed-only execute can never delete ids outside the ledger.
 */
export async function executeCleanup(
  client: BaseArrClient,
  instanceId: number,
  requested: CleanupScanResult,
  includeUnmanaged = false
): Promise<CleanupDeleteResult> {
  const fresh = await scanForStaleItems(client, instanceId, includeUnmanaged);

  const partition = (requestedItems: StaleItem[], freshItems: StaleItem[]) => {
    const freshById = new Map(freshItems.map((item) => [item.id, item]));
    const confirmed: StaleItem[] = [];
    const rejected: StaleItem[] = [];
    // Only the first request per id counts; later duplicates are neither deleted twice nor reported.
    const seenIds = new Set<number>();
    for (const item of requestedItems) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      const freshItem = freshById.get(item.id);
      if (freshItem && freshItem.name === item.name) {
        // Delete the server-side item so client-supplied display names are never trusted.
        confirmed.push(freshItem);
      } else {
        rejected.push(item);
      }
    }
    return { confirmed, rejected };
  };

  const cfs = partition(requested.staleCustomFormats, fresh.staleCustomFormats);
  const qps = partition(requested.staleQualityProfiles, fresh.staleQualityProfiles);

  if (cfs.rejected.length > 0 || qps.rejected.length > 0) {
    const summarize = (items: StaleItem[]) => ({
      count: items.length,
      sample: items.slice(0, REJECTED_LOG_SAMPLE_SIZE).map((item) => ({ id: item.id, name: item.strippedName })),
    });
    await logger.warn('Cleanup request contained items that are no longer stale; they were not deleted', {
      source: SOURCE,
      meta: {
        instanceId,
        customFormats: summarize(cfs.rejected),
        qualityProfiles: summarize(qps.rejected),
      },
    });
  }

  const result = await deleteStaleItems(client, {
    staleCustomFormats: cfs.confirmed,
    staleQualityProfiles: qps.confirmed,
  });
  for (const item of cfs.rejected) {
    result.failedCustomFormats.push({ item, reason: NO_LONGER_STALE_REASON });
  }
  for (const item of qps.rejected) {
    result.skippedQualityProfiles.push({ item, reason: NO_LONGER_STALE_REASON });
  }
  await dropDeletedFromLedger(instanceId, result);
  return result;
}

/**
 * Remove ledger rows for entities that were actually deleted, in both scopes, so
 * the ledger never claims ownership of remote ids that no longer exist.
 */
async function dropDeletedFromLedger(instanceId: number, result: CleanupDeleteResult): Promise<void> {
  const removals: { entityType: 'customFormat' | 'qualityProfile'; remoteId: number }[] = [
    ...result.deletedCustomFormats.map((cf) => ({ entityType: 'customFormat' as const, remoteId: cf.id })),
    ...result.deletedQualityProfiles.map((qp) => ({ entityType: 'qualityProfile' as const, remoteId: qp.id })),
  ];
  for (const removal of removals) {
    try {
      arrManagedEntitiesQueries.deleteConfirmed(instanceId, removal.entityType, removal.remoteId);
    } catch (err) {
      await logger.error('Failed to remove a deleted entity from the managed entities ledger', {
        source: SOURCE,
        meta: {
          instanceId,
          entityType: removal.entityType,
          remoteId: removal.remoteId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Delete stale items from an Arr instance. Deletes CFs first, then QPs.
 * QPs that are assigned to media (HTTP 500) are skipped with a warning.
 * Callers must pass server-verified items; API requests go through `executeCleanup`.
 */
export async function deleteStaleItems(
  client: BaseArrClient,
  scanResult: CleanupScanResult
): Promise<CleanupDeleteResult> {
  const deletedCustomFormats: StaleItem[] = [];
  const deletedQualityProfiles: StaleItem[] = [];
  const failedCustomFormats: { item: StaleItem; reason: string }[] = [];
  const skippedQualityProfiles: { item: StaleItem; reason: string }[] = [];

  // Delete CFs first
  for (const cf of scanResult.staleCustomFormats) {
    try {
      await client.deleteCustomFormat(cf.id);
      deletedCustomFormats.push(cf);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failedCustomFormats.push({ item: cf, reason });
      await logger.warn(`Failed to delete CF "${cf.strippedName}" (id=${cf.id})`, {
        source: SOURCE,
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // Then delete QPs
  for (const qp of scanResult.staleQualityProfiles) {
    try {
      await client.deleteQualityProfile(qp.id);
      deletedQualityProfiles.push(qp);
    } catch (err) {
      const reason =
        err instanceof HttpError && err.status === 500
          ? 'Profile is assigned to media'
          : err instanceof Error
            ? err.message
            : String(err);
      skippedQualityProfiles.push({ item: qp, reason });
    }
  }

  await logger.info('Cleanup complete', {
    source: SOURCE,
    meta: {
      deletedCFs: deletedCustomFormats.map((cf) => cf.strippedName),
      deletedQPs: deletedQualityProfiles.map((qp) => qp.strippedName),
      failedCFs: failedCustomFormats.map((cf) => cf.item.strippedName),
      skippedQPs: skippedQualityProfiles.map((s) => s.item.strippedName),
    },
  });

  return { deletedCustomFormats, deletedQualityProfiles, failedCustomFormats, skippedQualityProfiles };
}
