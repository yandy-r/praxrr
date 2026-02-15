/**
 * Config cleanup: delete all QPs and CFs from an Arr instance
 * that are not in the current sync selections.
 *
 * Simple rule: if it's not expected, it's stale.
 * QPs assigned to media will be skipped (arr returns HTTP 500).
 */

import type { BaseArrClient } from '$utils/arr/base.ts';
import { hasNamespaceSuffix, stripNamespaceSuffix, getNamespaceSuffix } from './namespace.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { getCache } from '$pcd/index.ts';
import { getReferencedCustomFormatNames } from './qualityProfiles/transformer.ts';
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
  skippedQualityProfiles: { item: StaleItem; reason: string }[];
}

/**
 * Scan an Arr instance for stale configs.
 * Stale = not in the current sync selections.
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

  for (const sel of selections) {
    const nsIndex = arrNamespaceQueries.get(instanceId, sel.databaseId);
    if (nsIndex === null) continue;
    const suffix = getNamespaceSuffix(nsIndex);

    expectedQPNames.add(sel.profileName + suffix);
    expectedProfiles.push({ profileName: sel.profileName, databaseId: sel.databaseId, namespaceIndex: nsIndex });

    // Get CF names from PCD cache for this profile
    const cache = getCache(sel.databaseId);
    if (cache) {
      const cfNames = await getReferencedCustomFormatNames(cache, sel.profileName, arrType);
      for (const name of cfNames) {
        expectedCFNames.add(name + suffix);
      }
    }
  }

  // 2. Fetch all CFs and QPs from the arr
  const [remoteCFs, remoteQPs] = await Promise.all([client.getCustomFormats(), client.getQualityProfiles()]);

  // 3. Stale QPs = everything not in the expected set
  const staleQualityProfiles: StaleItem[] = [];
  const qpDecisions: { name: string; id: number; decision: string }[] = [];

  for (const qp of remoteQPs) {
    if (expectedQPNames.has(qp.name)) {
      qpDecisions.push({ name: stripNamespaceSuffix(qp.name), id: qp.id, decision: 'keep' });
    } else {
      const displayName = hasNamespaceSuffix(qp.name) ? stripNamespaceSuffix(qp.name) : qp.name;
      staleQualityProfiles.push({ id: qp.id, name: qp.name, strippedName: displayName });
      qpDecisions.push({ name: displayName, id: qp.id, decision: 'stale' });
    }
  }

  // 4. Stale CFs = everything not in the expected CF set
  const staleCustomFormats: StaleItem[] = [];
  for (const cf of remoteCFs) {
    if (cf.id == null) continue;
    if (expectedCFNames.has(cf.name)) continue;
    const displayName = hasNamespaceSuffix(cf.name) ? stripNamespaceSuffix(cf.name) : cf.name;
    staleCustomFormats.push({ id: cf.id, name: cf.name, strippedName: displayName });
  }

  await logger.debug('Scan complete', {
    source: SOURCE,
    meta: {
      instanceId,
      expectedProfiles,
      expectedCFs: expectedCFNames.size,
      qualityProfiles: qpDecisions,
      staleCFs: staleCustomFormats.length,
      staleQPs: staleQualityProfiles.length,
    },
  });

  return { staleCustomFormats, staleQualityProfiles };
}

/**
 * Delete stale items from an Arr instance. Deletes CFs first, then QPs.
 * QPs that are assigned to media (HTTP 500) are skipped with a warning.
 */
export async function deleteStaleItems(
  client: BaseArrClient,
  scanResult: CleanupScanResult
): Promise<CleanupDeleteResult> {
  const deletedCustomFormats: StaleItem[] = [];
  const deletedQualityProfiles: StaleItem[] = [];
  const skippedQualityProfiles: { item: StaleItem; reason: string }[] = [];

  // Delete CFs first
  for (const cf of scanResult.staleCustomFormats) {
    try {
      await client.deleteCustomFormat(cf.id);
      deletedCustomFormats.push(cf);
    } catch (err) {
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
      skippedQPs: skippedQualityProfiles.map((s) => s.item.strippedName),
    },
  });

  return { deletedCustomFormats, deletedQualityProfiles, skippedQualityProfiles };
}
