/**
 * Config cleanup: delete all QPs and CFs from an Arr instance
 * that are not in the current sync selections.
 *
 * Rule: if it's not expected, it's stale — except when a selected namespace's
 * expected names cannot be determined right now. Those namespaces are kept
 * (fail-safe) so a missing cache never deletes live configs.
 * QPs assigned to media will be skipped (arr returns HTTP 500).
 */

import type { BaseArrClient } from '$utils/arr/base.ts';
import {
  getNamespaceSuffix,
  getTrailingNamespaceSuffix,
  hasNamespaceSuffix,
  getTrashGuideNamespaceSuffix,
  isTrashGuideNamespaceSuffix,
  stripNamespaceSuffix,
} from './namespace.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrTrashNamespaceQueries } from '$db/queries/arrTrashNamespaces.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { getCache } from '$pcd/index.ts';
import { getReferencedCustomFormatNames } from './qualityProfiles/transformer.ts';
import { resolveTrashSourceProfiles } from './trashSourceProfiles.ts';
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
 */
export async function scanForStaleItems(client: BaseArrClient, instanceId: number): Promise<CleanupScanResult> {
  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) throw new Error(`Instance ${instanceId} not found`);
  const arrType = instance.type as SyncArrType;

  // 1. Build expected suffixed QP names and expected CF names from PCD cache
  const { selections } = arrSyncQueries.getQualityProfilesSync(instanceId);
  const expectedQPNames = new Set<string>();
  const expectedCFNames = new Set<string>();
  const expectedProfiles: { profileName: string; databaseId: number; namespaceIndex: number }[] = [];
  // Exact trailing suffix runs whose items must all be kept: a selected DB whose cache is
  // unavailable, or a TRaSH source with a selected profile that no longer resolves.
  const keepSuffixes = new Set<string>();

  for (const sel of selections) {
    const nsIndex = arrNamespaceQueries.get(instanceId, sel.databaseId);
    if (nsIndex === null) continue;
    const suffix = getNamespaceSuffix(nsIndex);

    expectedQPNames.add(sel.profileName + suffix);
    expectedProfiles.push({ profileName: sel.profileName, databaseId: sel.databaseId, namespaceIndex: nsIndex });

    // Get CF names from PCD cache for this profile
    const cache = getCache(sel.databaseId);
    if (!cache) {
      if (!keepSuffixes.has(suffix)) {
        keepSuffixes.add(suffix);
        await logger.warn('PCD cache unavailable during cleanup scan; keeping all items in its namespace', {
          source: SOURCE,
          meta: { instanceId, databaseId: sel.databaseId, namespaceIndex: nsIndex },
        });
      }
      continue;
    }
    const cfNames = await getReferencedCustomFormatNames(cache, sel.profileName, arrType);
    for (const name of cfNames) {
      expectedCFNames.add(name + suffix);
    }
  }

  // 1b. Also include expected names from TRaSH Guide selections. Suffixes are read (never
  // assigned) from the same persisted per-(instance, source) index the syncer uses.
  const trashSourceHydrations = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance(instanceId);
  let keepAllTrashSuffixed = false;
  // Resolvable sources that have never been synced since persisted TRaSH namespaces shipped.
  const unassignedTrashSources: { sourceId: number; sourceName: string }[] = [];

  for (const sourceHydration of trashSourceHydrations) {
    if (sourceHydration.selectedQualityProfiles.length === 0) continue;

    const resolution = await resolveTrashSourceProfiles(sourceHydration, arrType, {
      logSource: SOURCE,
      instanceId,
      rowParseFailedMessage: 'Failed to parse TRaSH cache row during cleanup scan',
      allRowsMalformedMessage: (sourceName) =>
        `Failed to parse all TRaSH cache rows for source "${sourceName}" during cleanup scan`,
      someRowsMalformedMessage:
        'Some TRaSH cache rows were malformed during cleanup scan; using successfully parsed rows',
    });

    if (resolution.status === 'no_cache' || resolution.status === 'transform_failed') {
      // This source's expected contents are unknowable, so no TRaSH namespace can be trusted.
      keepAllTrashSuffixed = true;
      await logger.warn('TRaSH source undeterminable during cleanup scan; keeping all TRaSH-suffixed items', {
        source: SOURCE,
        meta: {
          instanceId,
          sourceId: resolution.source.id,
          sourceName: resolution.source.name,
          reason: resolution.status,
        },
      });
      continue;
    }

    if (resolution.status !== 'resolved') continue;

    // Read-only: cleanup never assigns indexes (YAN-443).
    const trashIndex = arrTrashNamespaceQueries.get(instanceId, resolution.source.id);
    if (trashIndex === null) {
      // Nothing to sync and never synced: this source owns no Arr items.
      if (resolution.resolvedProfileNames.length === 0) continue;
      // Resolvable but not yet synced since persisted namespaces shipped: items synced under the
      // old positional scheme cannot be attributed yet, so keep them until the next sync.
      keepAllTrashSuffixed = true;
      unassignedTrashSources.push({ sourceId: resolution.source.id, sourceName: resolution.source.name });
      continue;
    }
    const trashSuffix = getTrashGuideNamespaceSuffix(trashIndex);

    if (resolution.missingProfileNames.length > 0) {
      // Previously synced copies of the missing profiles (and their CFs) still carry this
      // suffix; their expected contents are unknown, so keep the whole namespace.
      keepSuffixes.add(trashSuffix);
      await logger.warn('TRaSH selected profiles missing from source during cleanup scan; keeping its namespace', {
        source: SOURCE,
        meta: {
          instanceId,
          sourceId: resolution.source.id,
          sourceName: resolution.source.name,
          missingProfiles: resolution.missingProfileNames,
        },
      });
    }

    for (const profileName of resolution.resolvedProfileNames) {
      const portable = resolution.portableProfilesByName.get(profileName);
      if (!portable) continue;

      expectedQPNames.add(profileName + trashSuffix);

      for (const score of portable.customFormatScores) {
        if (score.arrType === arrType || score.arrType === 'all') {
          expectedCFNames.add(score.customFormatName + trashSuffix);
        }
      }
    }
  }

  if (unassignedTrashSources.length > 0) {
    await logger.warn(
      'TRaSH sources have no namespace assigned yet; keeping all TRaSH-suffixed items until they are synced',
      { source: SOURCE, meta: { instanceId, sources: unassignedTrashSources } }
    );
  }

  // Exact trailing-run comparison: `endsWith` would wrongly match TRaSH suffixes (which end in U+200B).
  const inKeptNamespace = (name: string): boolean => {
    const suffix = getTrailingNamespaceSuffix(name);
    return keepSuffixes.has(suffix) || (keepAllTrashSuffixed && isTrashGuideNamespaceSuffix(suffix));
  };

  // 2. Fetch all CFs and QPs from the arr
  const [remoteCFs, remoteQPs] = await Promise.all([client.getCustomFormats(), client.getQualityProfiles()]);

  // 3. Stale QPs = everything not expected and not in a kept namespace
  const staleQualityProfiles: StaleItem[] = [];
  const qpDecisions: { name: string; id: number; decision: string }[] = [];

  for (const qp of remoteQPs) {
    if (expectedQPNames.has(qp.name) || inKeptNamespace(qp.name)) {
      qpDecisions.push({ name: stripNamespaceSuffix(qp.name), id: qp.id, decision: 'keep' });
    } else {
      const displayName = hasNamespaceSuffix(qp.name) ? stripNamespaceSuffix(qp.name) : qp.name;
      staleQualityProfiles.push({ id: qp.id, name: qp.name, strippedName: displayName });
      qpDecisions.push({ name: displayName, id: qp.id, decision: 'stale' });
    }
  }

  // 4. Stale CFs = everything not expected and not in a kept namespace
  const staleCustomFormats: StaleItem[] = [];
  for (const cf of remoteCFs) {
    if (cf.id == null) continue;
    if (expectedCFNames.has(cf.name) || inKeptNamespace(cf.name)) continue;
    const displayName = hasNamespaceSuffix(cf.name) ? stripNamespaceSuffix(cf.name) : cf.name;
    staleCustomFormats.push({ id: cf.id, name: cf.name, strippedName: displayName });
  }

  await logger.debug('Scan complete', {
    source: SOURCE,
    meta: {
      instanceId,
      expectedProfiles,
      expectedCFs: expectedCFNames.size,
      keptNamespaces: keepSuffixes.size,
      keptAllTrashNamespaces: keepAllTrashSuffixed,
      qualityProfiles: qpDecisions,
      staleCFs: staleCustomFormats.length,
      staleQPs: staleQualityProfiles.length,
    },
  });

  return { staleCustomFormats, staleQualityProfiles };
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
 */
export async function executeCleanup(
  client: BaseArrClient,
  instanceId: number,
  requested: CleanupScanResult
): Promise<CleanupDeleteResult> {
  const fresh = await scanForStaleItems(client, instanceId);

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
  return result;
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
