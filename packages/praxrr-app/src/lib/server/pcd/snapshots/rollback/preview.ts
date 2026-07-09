/**
 * Rollback preview (issue #16).
 *
 * Computes the mandatory PCD-to-PCD delta a restore would apply: it reconstructs the
 * snapshot's published-op set (verified against the fingerprint, fail-closed), materializes
 * an ephemeral snapshot-state cache from EXACTLY that set (the same set restore replays, so
 * preview and restore can never disagree), and diffs every entity family against the current
 * resolved state. No live Arr is contacted — this is desired-state only.
 */

import { getCache } from '../../database/registry.ts';
import type { PCDCache } from '../../database/cache.ts';
import { withCurrentCache, withSnapshotCache } from '../../resolved/layers.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { computeOpsWrittenSince, computeStateHash } from '../fingerprint.ts';
import { reconstructSnapshotOpIds, verifySnapshot } from '../reconstruct.ts';
import { diffEntityFamily, rollbackEntityTargets, summarizeSections } from './entities.ts';
import type { RollbackPreview, RollbackSection } from './types.ts';

const EMPTY_SUMMARY = { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 };

/** Diff every entity family sequentially (one SQLite connection per cache — avoid interleaving). */
async function diffAllFamilies(currentCache: PCDCache, snapshotCache: PCDCache): Promise<RollbackSection[]> {
  const sections: RollbackSection[] = [];
  for (const target of rollbackEntityTargets()) {
    sections.push(await diffEntityFamily(currentCache, snapshotCache, target));
  }
  return sections;
}

/**
 * Preview restoring a snapshot. Throws if the snapshot does not exist; callers enforce
 * database ownership before invoking.
 */
export async function previewRestore(snapshotId: number): Promise<RollbackPreview> {
  const snapshot = pcdSnapshotQueries.getById(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  const { databaseId, opsSequenceMaxId } = snapshot;
  const opsWrittenSince = computeOpsWrittenSince(databaseId, opsSequenceMaxId);
  const verification = await verifySnapshot(snapshot);

  if (!verification.reconstructable) {
    return {
      databaseId,
      snapshotId,
      reconstructable: false,
      reason: verification.reason,
      currentStateHash: await computeStateHash(databaseId),
      snapshotStateHash: snapshot.cacheStateHash,
      opsWrittenSince,
      sections: [],
      summary: { ...EMPTY_SUMMARY },
    };
  }

  const snapshotOpIds = reconstructSnapshotOpIds(databaseId, opsSequenceMaxId);

  const sections = await withSnapshotCache(databaseId, snapshotOpIds, async (snapshotCache) => {
    const registered = getCache(databaseId);
    if (registered && registered.isBuilt()) {
      return diffAllFamilies(registered, snapshotCache);
    }
    // No live cache registered (e.g. disabled database) — build a best-effort current cache.
    return withCurrentCache(databaseId, (currentCache) => diffAllFamilies(currentCache, snapshotCache));
  });

  return {
    databaseId,
    snapshotId,
    reconstructable: true,
    reason: null,
    currentStateHash: await computeStateHash(databaseId),
    snapshotStateHash: snapshot.cacheStateHash,
    opsWrittenSince,
    sections,
    summary: summarizeSections(sections),
  };
}
