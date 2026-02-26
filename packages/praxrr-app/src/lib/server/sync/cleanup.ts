/**
 * Config cleanup: delete all QPs and CFs from an Arr instance
 * that are not in the current sync selections.
 *
 * Simple rule: if it's not expected, it's stale.
 * QPs assigned to media will be skipped (arr returns HTTP 500).
 */

import type { BaseArrClient } from '$utils/arr/base.ts';
import {
  getTrashGuideNamespaceSuffix,
  getNamespaceSuffix,
  hasNamespaceSuffix,
  stripNamespaceSuffix,
} from './namespace.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { getCache } from '$pcd/index.ts';
import { getReferencedCustomFormatNames } from './qualityProfiles/transformer.ts';
import { transformTrashGuideEntities } from '$lib/server/trashguide/transformer.ts';
import type {
  TrashGuideCustomFormatEntity,
  TrashGuideNamingEntity,
  TrashGuideParsedEntity,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
} from '$lib/server/trashguide/types.ts';
import type { PortableCustomFormat, PortableQualityProfile } from '$shared/pcd/portable.ts';
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

  // 1b. Also include expected names from TRaSH Guide selections
  const trashSourceHydrations = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance(instanceId);
  let trashNamespaceIndex = 0;

  for (const sourceHydration of trashSourceHydrations) {
    if (sourceHydration.selectedQualityProfiles.length === 0) continue;

    const source = trashGuideSourcesQueries.getById(sourceHydration.sourceId);
    if (!source || source.arr_type !== arrType) continue;

    const cachedRows = trashGuideEntityCacheQueries.getBySource(source.id);
    if (cachedRows.length === 0) continue;

    const parsedEntities: TrashGuideParsedEntity[] = [];
    let malformedRows = 0;
    for (const row of cachedRows) {
      try {
        parsedEntities.push(JSON.parse(row.jsonData) as TrashGuideParsedEntity);
      } catch (error) {
        malformedRows += 1;
        await logger.warn('Failed to parse TRaSH cache row during cleanup scan', {
          source: SOURCE,
          meta: {
            instanceId,
            sourceId: source.id,
            sourceName: source.name,
            trashId: row.trashId,
            filePath: row.filePath,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    if (parsedEntities.length === 0) {
      const message = `Failed to parse all TRaSH cache rows for source "${source.name}" during cleanup scan`;
      await logger.error(message, {
        source: SOURCE,
        meta: {
          instanceId,
          sourceId: source.id,
          sourceName: source.name,
          totalRows: cachedRows.length,
          malformedRows,
        },
      });
      throw new Error(message);
    }
    if (malformedRows > 0) {
      await logger.warn('Some TRaSH cache rows were malformed during cleanup scan; using successfully parsed rows', {
        source: SOURCE,
        meta: {
          instanceId,
          sourceId: source.id,
          sourceName: source.name,
          totalRows: cachedRows.length,
          malformedRows,
        },
      });
    }

    let transformed;
    try {
      transformed = transformTrashGuideEntities({
        sourceId: source.id,
        arrType: source.arr_type,
        parsed: {
          arr_type: source.arr_type,
          status: 'success',
          entities: {
            custom_formats: parsedEntities.filter(
              (e): e is TrashGuideCustomFormatEntity => e.entity_type === 'custom_format'
            ),
            quality_profiles: parsedEntities.filter(
              (e): e is TrashGuideQualityProfileEntity => e.entity_type === 'quality_profile'
            ),
            quality_sizes: parsedEntities.filter(
              (e): e is TrashGuideQualitySizeEntity => e.entity_type === 'quality_size'
            ),
            naming: parsedEntities.filter((e): e is TrashGuideNamingEntity => e.entity_type === 'naming'),
          },
          ordered_entities: parsedEntities,
          issues: [],
          parsed_files: parsedEntities.length,
          failed_files: 0,
        },
      });
    } catch (error) {
      await logger.warn(`Skipping TRaSH quality profiles due to transform failure for source "${source.name}"`, {
        source: SOURCE,
        meta: {
          instanceId,
          sourceId: source.id,
          sourceName: source.name,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      continue;
    }

    const portableProfilesByName = new Map<string, PortableQualityProfile>();
    const portableFormatsByName = new Map<string, PortableCustomFormat>();
    for (const op of transformed.activeOperations) {
      if (op.portableEntityType === 'quality_profile') {
        portableProfilesByName.set(op.data.name, op.data);
      } else if (op.portableEntityType === 'custom_format') {
        portableFormatsByName.set(op.data.name, op.data);
      }
    }

    trashNamespaceIndex += 1;
    const trashSuffix = getTrashGuideNamespaceSuffix(trashNamespaceIndex);

    for (const profileName of sourceHydration.selectedQualityProfiles) {
      const portable = portableProfilesByName.get(profileName);
      if (!portable) continue;

      expectedQPNames.add(profileName + trashSuffix);

      for (const score of portable.customFormatScores) {
        if (score.arrType === arrType || score.arrType === 'all') {
          expectedCFNames.add(score.customFormatName + trashSuffix);
        }
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
