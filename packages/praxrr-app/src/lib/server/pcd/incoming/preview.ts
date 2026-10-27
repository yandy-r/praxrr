/**
 * Incoming-upstream preview (YAN-570).
 *
 * Computes, without changing anything, what pulling `origin/<branch>` would do to a linked PCD:
 * the per-entity base-state diff and the predicted fate of local user ops.
 *
 * How it mirrors the pull (`PCDManager.sync`): the pull moves the clone, refreshes the schema
 * dependency, then `importBaseOps` re-derives base ops from `entities/**` YAML, orphans repo ops
 * not seen upstream, and `compile()` replays schema -> base -> tweaks -> user ops. Here the
 * incoming tree is extracted with `git archive` into a temp dir, the same deserializers run in
 * capture mode (ops kept in memory, never persisted), and an ephemeral cache replays exactly the
 * base set the post-pull compile would, followed by a dry replay of the published user ops.
 *
 * Never-call list (each mutates app DB or registry): `PCDCache.build()`, `compile()`,
 * `importBaseOps()`, `writeOperation()` outside capture mode, `pcdOpsQueries.create/update`,
 * `pcdOpHistoryQueries.create`, `setCache`, `pull()`, `checkout()`, `updateSyncedAt`.
 */

import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { EXPORT_BATCH_METADATA_KEY, pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { getDecryptedDatabasePersonalAccessToken } from '$server/utils/encryption/database-credentials.ts';
import { execGit, execGitSafe } from '$utils/git/exec.ts';
import { getBranch, isLocalRepositorySource, readIncomingChanges } from '$utils/git/index.ts';
import { sortMigrationCandidatesByImportOrder } from '$pcd/migration/migrationImportUtils.ts';
import { type MigrationEntityCandidate, readMigrationEntitySources } from '$pcd/migration/reader.ts';
import type { Operation } from '../core/types.ts';
import { PCDCache } from '../database/cache.ts';
import { getCache, getRegisteredCache, withScopedCache } from '../database/registry.ts';
import { getPcdSyncDedupeKey } from '../../jobs/helpers/pcdSyncDedupeKey.ts';
import { syncDependencies } from '../git/dependencies.ts';
import {
  buildPublishedRepoBaseOpIndex,
  ENTITY_OP_FILENAME_PREFIX,
  hasBaseEntityByStableIdentity,
  matchingPublishedRepoBaseOpIds,
  type RepoOpIndex,
  validateStableIdentityConflicts,
  YAML_SEQUENCE_BASE,
  YAML_SEQUENCE_STRIDE,
} from '../ops/importBaseOps.ts';
import { type CapturedBaseOp, withBaseOpCapture, withRepoImportWriteContext } from '../ops/writer.ts';
import { withBaseOnlyCache } from '../resolved/layers.ts';
import { computeStateHash } from '../snapshots/fingerprint.ts';
import { summarizeSections } from '../snapshots/rollback/entities.ts';
import { diffAllFamilies } from '../snapshots/rollback/preview.ts';
import {
  assertPreviewableTree,
  copyInstalledDependencies,
  extractTreeAtRef,
  fetchRemoteBranchStrict,
  resolveCommit,
  verifyExtractedTree,
} from './extract.ts';
import { replayUserOpsDry } from './replay.ts';
import {
  type ConflictStrategy,
  type IncomingPreview,
  IncomingPreviewError,
  type RollbackSection,
  type RollbackSummary,
} from './types.ts';

const SOURCE = 'IncomingPreview';
const BASE_ONLY_LAYERS = new Set<'schema' | 'base' | 'tweaks'>(['schema', 'base', 'tweaks']);
const EMPTY_SUMMARY: RollbackSummary = { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 };

function resolveStrategy(value: string | undefined): ConflictStrategy {
  return value === 'align' || value === 'ask' ? value : 'override';
}

/** Mirrors the `markBaseOrphaned` exemption: JSON `true` under the export-batch key. */
function isExportBatchOp(op: PcdOp): boolean {
  if (!op.metadata) return false;
  try {
    const parsed = JSON.parse(op.metadata) as Record<string, unknown>;
    return parsed[EXPORT_BATCH_METADATA_KEY] === true || parsed[EXPORT_BATCH_METADATA_KEY] === 1;
  } catch {
    return false;
  }
}

function emptyPreview(
  databaseId: number,
  conflictStrategy: ConflictStrategy,
  overrides: Partial<IncomingPreview>
): IncomingPreview {
  return {
    databaseId,
    available: true,
    unavailableReason: null,
    branch: null,
    hasUpdates: false,
    commitsBehind: 0,
    commitsAhead: 0,
    commits: [],
    conflictStrategy,
    sections: [],
    summary: { ...EMPTY_SUMMARY },
    predictedConflicts: [],
    predictedErrors: [],
    currentStateHash: null,
    currentHead: null,
    incomingHead: null,
    ...overrides,
  };
}

async function buildBaseOnlyCache(
  pcdPath: string,
  databaseId: number,
  options: {
    excludeBaseOpIds: ReadonlySet<number>;
    extraPublishedBaseOps?: ReadonlyArray<Operation>;
    preparation?: boolean;
  }
): Promise<PCDCache> {
  const cache = new PCDCache(pcdPath, databaseId);
  try {
    // Only the final post-import base must fail closed. The deserializer preparation cache
    // mirrors importBaseOps.buildImportCache: removing refreshed entities can temporarily
    // break old ops that will be orphaned before the real pull's final compile. Those failures
    // must be warn-skipped during preparation, not mistaken for failures of the incoming state.
    await cache.buildReadOnly({
      layers: BASE_ONLY_LAYERS,
      excludeBaseOpIds: options.excludeBaseOpIds,
      extraPublishedBaseOps: options.extraPublishedBaseOps,
      failOnError: !options.preparation,
    });
  } catch (error) {
    cache.close();
    const filename = error instanceof Error ? extractFailedFilename(error.message) : null;
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `The incoming changes cannot be applied${filename ? ` (${filename})` : ''}: pulling would fail`,
      { cause: error }
    );
  }
  return cache;
}

/** `buildReadOnly` fail-closed errors name the failing op as `(filename=..., layer=...)`. */
function extractFailedFilename(message: string): string | null {
  const match = message.match(/filename=([^,)]+)/);
  return match ? match[1] : null;
}

/**
 * Replay what `importBaseOps` would persist, in capture mode against an ephemeral cache, and
 * return the captured ops. Mirrors the import loop: same order, same skip rule, same context.
 */
async function captureIncomingBaseOps(
  databaseId: number,
  treePath: string,
  refreshOpIds: ReadonlySet<number>,
  candidates: readonly MigrationEntityCandidate[],
  repoOpIndex: RepoOpIndex
): Promise<CapturedBaseOp[]> {
  const importCache = await buildBaseOnlyCache(treePath, databaseId, {
    excludeBaseOpIds: refreshOpIds,
    preparation: true,
  });
  const registeredCache = getRegisteredCache(databaseId);
  const previewSeenAt = new Date().toISOString();
  const captured: CapturedBaseOp[] = [];

  try {
    const sorted = sortMigrationCandidatesByImportOrder(candidates);
    await withScopedCache(databaseId, importCache, async () => {
      for (let i = 0; i < sorted.length; i++) {
        const candidate = sorted[i];
        const cache = getCache(databaseId);
        if (!cache) {
          throw new Error(`Cache not available while previewing entity "${candidate.relativePath}"`);
        }

        const isRefresh = matchingPublishedRepoBaseOpIds(repoOpIndex, candidate).length > 0;
        const presenceCache = isRefresh ? cache : (registeredCache ?? cache);
        if (hasBaseEntityByStableIdentity(presenceCache, candidate.stableIdentity)) {
          continue;
        }

        await withRepoImportWriteContext(
          {
            filenamePrefix: `${ENTITY_OP_FILENAME_PREFIX}${candidate.relativePath}`,
            sequenceStart: YAML_SEQUENCE_BASE + i * YAML_SEQUENCE_STRIDE,
            maxOperations: YAML_SEQUENCE_STRIDE,
            lastSeenInRepoAt: previewSeenAt,
          },
          async () => {
            const { result, captured: ops } = await withBaseOpCapture(() =>
              candidate.deserialize({ databaseId, cache, layer: 'base', data: candidate.portable })
            );
            const outcome = result as { success?: unknown; error?: unknown } | null;
            if (!outcome || typeof outcome !== 'object' || typeof outcome.success !== 'boolean') {
              throw new Error(`Failed to preview entity "${candidate.relativePath}": invalid deserialize result`);
            }
            if (outcome.success === false) {
              throw new Error(
                `Failed to preview entity "${candidate.relativePath}": ${String(outcome.error ?? 'unknown write failure')}`
              );
            }
            captured.push(...ops);
          }
        );
      }
    });
  } finally {
    importCache.close();
  }

  return captured;
}

/**
 * Build the post-pull base-only cache: published repo-sourced base ops (other than export-batch
 * ops, which the orphan sweep exempts) and ops the import would rewrite by filename are replaced
 * by the captured ops, exactly the published set `compile()` would see after the pull.
 */
function computeExcludedBaseOps(databaseId: number, captured: readonly CapturedBaseOp[]): Set<number> {
  const capturedFilenames = new Set(captured.map((op) => op.filename));
  const excluded = new Set<number>();
  for (const op of pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'base', { states: ['published'] })) {
    const rewritten = op.filename !== null && capturedFilenames.has(op.filename);
    const swept = op.source === 'repo' && !isExportBatchOp(op);
    if (rewritten || swept) excluded.add(op.id);
  }
  return excluded;
}

function capturedToOperations(captured: readonly CapturedBaseOp[]): Operation[] {
  return captured.map((op) => ({
    filename: op.filename,
    filepath: `incoming_preview:${op.filename}`,
    sql: op.sql,
    order: op.sequence,
    layer: 'base',
  }));
}

async function buildIncomingState(
  databaseId: number,
  treePath: string,
  personalAccessToken: string | undefined,
  cloneRoot: string
): Promise<{ cache: PCDCache; capturedCount: number }> {
  try {
    await copyInstalledDependencies(cloneRoot, treePath);
    await syncDependencies(treePath, personalAccessToken);
  } catch (error) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Failed to resolve incoming dependencies: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const read = await readMigrationEntitySources(treePath);
  if (read.issues.length > 0) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Incoming entity files are invalid:\n${read.issues
        .map((issue) => `${issue.relativePath}: ${issue.kind} - ${issue.message}`)
        .join('\n')}`
    );
  }
  try {
    validateStableIdentityConflicts(read.candidates);
  } catch (error) {
    throw new IncomingPreviewError('incoming_unavailable', error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }

  let captured: CapturedBaseOp[] = [];
  let excluded = new Set<number>();
  if (read.candidates.length > 0) {
    const repoOpIndex = buildPublishedRepoBaseOpIndex(databaseId);
    const refreshOpIds = new Set<number>();
    for (const candidate of read.candidates) {
      for (const opId of matchingPublishedRepoBaseOpIds(repoOpIndex, candidate)) refreshOpIds.add(opId);
    }
    try {
      captured = await captureIncomingBaseOps(databaseId, treePath, refreshOpIds, read.candidates, repoOpIndex);
    } catch (error) {
      throw new IncomingPreviewError('incoming_unavailable', error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
    excluded = computeExcludedBaseOps(databaseId, captured);
  } else {
    // No entity files: the import orphans every repo-sourced base op and writes nothing.
    excluded = computeExcludedBaseOps(databaseId, []);
  }

  try {
    const cache = await buildBaseOnlyCache(treePath, databaseId, {
      excludeBaseOpIds: excluded,
      extraPublishedBaseOps: capturedToOperations(captured),
    });
    return { cache, capturedCount: captured.length };
  } catch (error) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Failed to build incoming state: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * In-flight previews by database id: concurrent callers share one build (the fetch, cache builds
 * and candidate deserialization are pure reads, so sharing is safe and keeps the cost at one
 * preview per database at a time).
 */
const inFlightPreviews = new Map<number, Promise<IncomingPreview>>();

/**
 * Preview pulling the upstream branch of `databaseId`. Read-only: fetches the remote-tracking
 * ref only, writes nothing to `pcd_ops`/`pcd_op_history`, and never moves HEAD or the worktree.
 * Throws `IncomingPreviewError` for sync-in-progress / stale / fetch / extraction failures.
 */
export function previewIncoming(databaseId: number): Promise<IncomingPreview> {
  const existing = inFlightPreviews.get(databaseId);
  if (existing) return existing;

  const run = previewIncomingUncached(databaseId).finally(() => {
    inFlightPreviews.delete(databaseId);
  });
  inFlightPreviews.set(databaseId, run);
  return run;
}

async function previewIncomingUncached(databaseId: number): Promise<IncomingPreview> {
  const startedAt = performance.now();
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new Error(`Database instance ${databaseId} not found`);
  }
  const conflictStrategy = resolveStrategy(instance.conflict_strategy);

  if (isLocalRepositorySource(instance.repository_url)) {
    return emptyPreview(databaseId, conflictStrategy, { available: false, unavailableReason: 'local_source' });
  }

  if (jobQueueQueries.getByDedupeKey(getPcdSyncDedupeKey(databaseId))?.status === 'running') {
    throw new IncomingPreviewError('sync_in_progress', 'A sync is currently running for this database');
  }

  const repoPath = instance.local_path;
  const stateHashBefore = await computeStateHash(databaseId);

  let branch: string;
  let incomingHead: string;
  let currentHead: string;
  let incoming: Awaited<ReturnType<typeof readIncomingChanges>>;
  let commitsAhead: number;
  try {
    branch = (await getBranch(repoPath)).trim();
    if (!branch) {
      throw new Error('The clone is not on a branch');
    }
    await fetchRemoteBranchStrict(repoPath, branch);
    // Pin everything that follows to the SHA fetched above: a concurrent push must not make the
    // commit list describe a different commit than the extracted tree.
    incomingHead = await resolveCommit(repoPath, `refs/remotes/origin/${branch}`);
    currentHead = await execGit(['rev-parse', 'HEAD'], repoPath);
    incoming = await readIncomingChanges(repoPath, incomingHead);
    const aheadOutput = await execGitSafe(['rev-list', '--count', `${incomingHead}..HEAD`], repoPath);
    commitsAhead = Number.parseInt(aheadOutput ?? '0', 10) || 0;
  } catch (error) {
    if (error instanceof IncomingPreviewError) throw error;
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Failed to read the upstream state of branch "${await getBranch(repoPath).catch(() => 'unknown')}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  const header = {
    branch,
    hasUpdates: incoming.hasUpdates,
    commitsBehind: incoming.commitsBehind,
    commitsAhead,
    commits: incoming.commits,
    currentStateHash: stateHashBefore,
    currentHead,
    incomingHead,
  };

  if (!incoming.hasUpdates) {
    return emptyPreview(databaseId, conflictStrategy, header);
  }

  const tempDir = await Deno.makeTempDir({ prefix: 'praxrr-incoming-preview-' });
  let incomingCache: PCDCache | null = null;
  try {
    const treePath = `${tempDir}/tree`;
    await Deno.mkdir(treePath);
    await assertPreviewableTree(repoPath, incomingHead);
    await extractTreeAtRef(repoPath, incomingHead, treePath);
    await verifyExtractedTree(repoPath, incomingHead, treePath);

    const personalAccessToken = await getDecryptedDatabasePersonalAccessToken(instance.id);
    const built = await buildIncomingState(databaseId, treePath, personalAccessToken, repoPath);
    incomingCache = built.cache;

    const incomingState = incomingCache;
    let sections: RollbackSection[];
    let replay: Awaited<ReturnType<typeof replayUserOpsDry>>;
    try {
      sections = await withBaseOnlyCache(databaseId, (currentBase) => diffAllFamilies(currentBase, incomingState));
      replay = await replayUserOpsDry(incomingState, databaseId, conflictStrategy);
    } catch (error) {
      // A renamed/removed table in the incoming schema can break resolved readers mid-diff;
      // never answer 500 with a half-built preview (spec R5).
      throw new IncomingPreviewError(
        'incoming_unavailable',
        `The incoming changes cannot be previewed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    const { predictedConflicts, predictedErrors } = replay;

    const stateHashAfter = await computeStateHash(databaseId);
    const headAfter = await execGit(['rev-parse', 'HEAD'], repoPath);
    if (stateHashAfter !== stateHashBefore || headAfter !== currentHead) {
      throw new IncomingPreviewError(
        'preview_stale',
        'Local PCD state changed while the preview was being built; run the preview again'
      );
    }

    await logger.debug('Built incoming PCD preview', {
      source: SOURCE,
      meta: {
        databaseId,
        commitsBehind: incoming.commitsBehind,
        capturedOps: built.capturedCount,
        predictedConflicts: predictedConflicts.length,
        timingMs: Math.round(performance.now() - startedAt),
      },
    });

    return emptyPreview(databaseId, conflictStrategy, {
      ...header,
      sections,
      summary: summarizeSections(sections),
      predictedConflicts,
      predictedErrors,
    });
  } finally {
    incomingCache?.close();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}
