/**
 * Expected names and fail-closed keep rules for an Arr instance's current
 * PCD and TRaSH sync selections.
 *
 * Extracted from the cleanup scan. Warning text and `source: 'Cleanup'` stay
 * byte-identical with that scan.
 */

import {
  getNamespaceSuffix,
  getTrailingNamespaceSuffix,
  getTrashGuideNamespaceSuffix,
  isTrashGuideNamespaceSuffix,
} from '../namespace.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { arrTrashNamespaceQueries } from '$db/queries/arrTrashNamespaces.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { getCache } from '$pcd/index.ts';
import { getReferencedCustomFormatNames } from '../qualityProfiles/transformer.ts';
import { resolveTrashSourceProfiles } from '../trashSourceProfiles.ts';
import type { SyncArrType } from '../mappings.ts';
import { logger } from '$logger/logger.ts';

/** Same source label as cleanup.ts so moved warnings stay byte-identical. */
const SOURCE = 'Cleanup';

export interface ExpectedArrConfig {
  expectedQPNames: Set<string>;
  expectedCFNames: Set<string>;
  isKept(name: string): boolean;
  /** PCD selections included in the cleanup "Scan complete" log. */
  expectedProfiles: { profileName: string; databaseId: number; namespaceIndex: number }[];
  /** `keepSuffixes.size`, logged as `keptNamespaces`. */
  keptNamespaces: number;
  /** Logged as `keptAllTrashNamespaces`. */
  keptAllTrashNamespaces: boolean;
}

/**
 * Build the suffixed quality-profile and custom-format names a cleanup or prune
 * scan should treat as expected, and the namespaces that must be kept because
 * their expected contents cannot be determined.
 *
 * `isKept` is fail-closed: PCD cache unavailable, TRaSH `no_cache` /
 * `transform_failed`, an unassigned TRaSH namespace, or a missing TRaSH profile.
 */
export async function resolveExpectedArrConfig(
  instanceId: number,
  instanceType: SyncArrType
): Promise<ExpectedArrConfig> {
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
    const profile = await cache.kb
      .selectFrom('quality_profiles')
      .select('name')
      .where('name', '=', sel.profileName)
      .executeTakeFirst();
    if (!profile) {
      keepSuffixes.add(suffix);
      await logger.warn('PCD selected profile missing from cache during cleanup scan; keeping its namespace', {
        source: SOURCE,
        meta: { instanceId, databaseId: sel.databaseId, profileName: sel.profileName, namespaceIndex: nsIndex },
      });
      continue;
    }
    const cfNames = await getReferencedCustomFormatNames(cache, sel.profileName, instanceType);
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

    const resolution = await resolveTrashSourceProfiles(sourceHydration, instanceType, {
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
        if (score.arrType === instanceType || score.arrType === 'all') {
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
  const isKept = (name: string): boolean => {
    const suffix = getTrailingNamespaceSuffix(name);
    return keepSuffixes.has(suffix) || (keepAllTrashSuffixed && isTrashGuideNamespaceSuffix(suffix));
  };

  return {
    expectedQPNames,
    expectedCFNames,
    isKept,
    expectedProfiles,
    keptNamespaces: keepSuffixes.size,
    keptAllTrashNamespaces: keepAllTrashSuffixed,
  };
}
