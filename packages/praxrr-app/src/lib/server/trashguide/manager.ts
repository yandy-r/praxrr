import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import {
  type TrashGuideEntityCache,
  type TrashGuideEntityCacheInput,
  trashGuideEntityCacheQueries,
} from '$db/queries/trashGuideEntityCache.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { triggerSyncs } from '$sync/processor.ts';
import { isValidScheduleIntervalMinutes, SYNC_STRATEGY_RANGE_ERROR } from '$jobs/scheduleUtils.ts';
import {
  checkForUpdates as checkGitForUpdates,
  getCommits,
  isLocalRepositorySource,
  resetToCommit,
  type UpdateInfo,
} from '$utils/git/index.ts';
import { discoverTrashGuideFiles, fetchTrashGuideSource } from './fetcher.ts';
import { parseTrashGuideEntities } from './parser.ts';
import { transformTrashGuideEntities, type TrashGuideTransformResult } from './transformer.ts';
import type {
  TrashGuideParsedEntities,
  TrashGuideParsedEntity,
  TrashGuideParseResult,
  TrashGuideParseStatus,
  TrashGuideSupportedArrType,
} from './types.ts';
import { isTrashGuideSupportedArrType } from './types.ts';

const TRASHGUIDE_CLONES_DIR = `${config.paths.data}/trashguide`;
const DEFAULT_BRANCH = 'master';

export interface TrashGuideLinkOptions {
  name: string;
  repositoryUrl: string;
  branch?: string;
  arrType: TrashGuideSupportedArrType;
  scoreProfile?: string;
  syncStrategy?: number;
  autoPull?: boolean;
  enabled?: boolean;
}

interface TrashGuideSyncResultCounts {
  commitsBehind: number;
  parseStatus: TrashGuideParseStatus;
  parsedFiles: number;
  failedFiles: number;
  activeOperations: number;
  removedEntities: number;
  renamedEntities: number;
}

export interface TrashGuideSyncSuccess extends TrashGuideSyncResultCounts {
  success: true;
  error?: never;
  failureKind?: never;
}

export interface TrashGuideSyncFailure extends TrashGuideSyncResultCounts {
  success: false;
  error: string;
  /**
   * 'parse' = every discovered file failed to parse (cache left untouched); 'run' = any other
   * failure (fetch, git, persistence, ...).
   */
  failureKind: 'parse' | 'run';
}

export type TrashGuideSyncResult = TrashGuideSyncSuccess | TrashGuideSyncFailure;

/** A parse result that is safe to persist: at least one file parsed. */
export type UsableParseResult = TrashGuideParseResult & { readonly status: 'success' | 'partial' };

function isUsableParse(parsed: TrashGuideParseResult): parsed is UsableParseResult {
  return parsed.status !== 'failed';
}

/** A parse where every discovered file failed must never reach the cache/mappings. */
function assertParseUsable(parsed: TrashGuideParseResult): asserts parsed is UsableParseResult {
  if (!isUsableParse(parsed)) {
    throw new TrashGuideSourceValidationError(
      'parse_failed',
      `TRaSH parse failed for every discovered file (${parsed.failed_files})`
    );
  }
}

export interface TrashGuideSourceEntityCounts {
  customFormats: number;
  customFormatGroups: number;
  qualityProfiles: number;
  qualitySizes: number;
  naming: number;
}

export interface TrashGuideSourceResponse {
  id: number;
  name: string;
  repositoryUrl: string;
  branch: string;
  arrType: TrashGuideSupportedArrType;
  scoreProfile: string;
  autoPull: boolean;
  enabled: boolean;
  syncStrategy: number;
  lastSyncedAt: string | null;
  lastCommitHash: string | null;
  entityCounts: TrashGuideSourceEntityCounts;
}

export interface TrashGuideSourceCreateInput {
  name: string;
  repositoryUrl: string;
  branch?: string;
  arrType: string;
  scoreProfile?: string;
  autoPull?: boolean;
  enabled?: boolean;
  syncStrategy?: number;
}

export interface TrashGuideSourceUpdateInput {
  name?: string;
  repositoryUrl?: string;
  branch?: string;
  arrType?: string;
  scoreProfile?: string;
  autoPull?: boolean;
  enabled?: boolean;
  syncStrategy?: number;
}

export class TrashGuideSourceNotFoundError extends Error {
  readonly sourceId: number;

  constructor(sourceId: number) {
    super(`TRaSH source ${sourceId} not found`);
    this.name = 'TrashGuideSourceNotFoundError';
    this.sourceId = sourceId;
  }
}

export class TrashGuideSourceConflictError extends Error {
  readonly conflictField: 'name' | 'repository';

  constructor(conflictField: 'name' | 'repository', message: string) {
    super(message);
    this.name = 'TrashGuideSourceConflictError';
    this.conflictField = conflictField;
  }
}

export type TrashGuideSourceValidationErrorCode =
  'arr_type_invalid' | 'arr_type_mismatch' | 'sync_strategy_invalid' | 'parse_failed';

export class TrashGuideSourceValidationError extends Error {
  readonly code: TrashGuideSourceValidationErrorCode;

  constructor(code: TrashGuideSourceValidationErrorCode, message: string) {
    super(message);
    this.name = 'TrashGuideSourceValidationError';
    this.code = code;
  }
}

class TrashGuideManager {
  async initialize(): Promise<void> {
    await Deno.mkdir(TRASHGUIDE_CLONES_DIR, { recursive: true });

    const sources = trashGuideSourcesQueries.getAll();
    let missingLocalClones = 0;

    for (const source of sources) {
      let localCloneAvailable = true;
      try {
        await Deno.stat(source.local_path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          localCloneAvailable = false;
          missingLocalClones += 1;
          await logger.warn('TRaSH source clone directory missing', {
            source: 'TrashGuideManager',
            meta: { sourceId: source.id, localPath: source.local_path },
          });
        } else {
          throw error;
        }
      }

      this.ensureSyncConfigRows(source);
      if (localCloneAvailable) {
        await this.backfillMissingCustomFormatGroups(source);
      }
    }

    await logger.info('TRaSH guide manager initialized', {
      source: 'TrashGuideManager',
      meta: {
        sources: sources.length,
        missingLocalClones,
      },
    });
  }

  listSources(): TrashGuideSourceResponse[] {
    return trashGuideSourcesQueries.getAll().map((source) => this.toSourceResponse(source));
  }

  getSource(id: number): TrashGuideSourceResponse {
    return this.toSourceResponse(this.getSourceOrThrow(id));
  }

  async createSource(input: TrashGuideSourceCreateInput): Promise<TrashGuideSourceResponse> {
    const arrType = this.parseArrType(input.arrType);
    this.assertSyncStrategy(input.syncStrategy);
    this.assertCreateConflicts({
      name: input.name,
      repositoryUrl: input.repositoryUrl,
      branch: input.branch ?? DEFAULT_BRANCH,
      arrType,
    });

    let source: TrashGuideSource;
    try {
      source = await this.link({
        name: input.name,
        repositoryUrl: input.repositoryUrl,
        branch: input.branch,
        arrType,
        scoreProfile: input.scoreProfile,
        syncStrategy: input.syncStrategy,
        autoPull: input.autoPull,
        enabled: input.enabled,
      });
    } catch (error) {
      if (this.isNameConflictError(error)) {
        throw new TrashGuideSourceConflictError('name', `TRaSH source name already exists: ${input.name}`);
      }

      throw error;
    }

    return this.toSourceResponse(this.getSourceOrThrow(source.id));
  }

  async updateSource(id: number, input: TrashGuideSourceUpdateInput): Promise<TrashGuideSourceResponse> {
    const current = this.getSourceOrThrow(id);
    this.assertSyncStrategy(input.syncStrategy);

    if (input.arrType !== undefined) {
      const nextArrType = this.parseArrType(input.arrType);
      if (nextArrType !== current.arr_type) {
        throw new TrashGuideSourceValidationError(
          'arr_type_mismatch',
          'TRaSH source arrType cannot be changed once created'
        );
      }
    }

    const nextName = input.name ?? current.name;
    const nextRepositoryUrl = input.repositoryUrl ?? current.repository_url;
    const nextBranch = input.branch ?? current.branch;
    const nextArrType = current.arr_type;

    this.assertUpdateConflicts(id, {
      name: nextName,
      repositoryUrl: nextRepositoryUrl,
      branch: nextBranch,
      arrType: nextArrType,
    });

    const shouldReinitializeClone = input.repositoryUrl !== undefined && input.repositoryUrl !== current.repository_url;
    const updateInput = {
      name: input.name,
      repositoryUrl: input.repositoryUrl,
      branch: input.branch,
      scoreProfile: input.scoreProfile,
      enabled: input.enabled,
      syncStrategy: input.syncStrategy,
      autoPull: input.autoPull,
    };

    let updated = false;
    let tempClonePath: string | null = null;

    try {
      if (shouldReinitializeClone) {
        const clonePath = `${TRASHGUIDE_CLONES_DIR}/${crypto.randomUUID()}`;
        tempClonePath = clonePath;

        const fetchResult = await fetchTrashGuideSource({
          repository_url: nextRepositoryUrl,
          local_path: clonePath,
          branch: nextBranch,
          arr_type: current.arr_type,
        });
        const parsed = await parseTrashGuideEntities({
          arr_type: fetchResult.arr_type,
          discovery: fetchResult.discovery,
        });
        assertParseUsable(parsed);

        const nextSource = {
          ...current,
          repository_url: nextRepositoryUrl,
          branch: fetchResult.branch,
          local_path: clonePath,
        };

        // Different repository: prior cache rows belong to another repo, so never retain them.
        await this.persistSourceSyncData(nextSource, parsed, { retainPrior: false });

        updated = trashGuideSourcesQueries.update(id, {
          ...updateInput,
          branch: fetchResult.branch,
          localPath: clonePath,
        });
      } else {
        updated = trashGuideSourcesQueries.update(id, updateInput);
      }

      if (!updated) {
        throw new TrashGuideSourceNotFoundError(id);
      }
    } catch (error) {
      if (this.isNameConflictError(error)) {
        throw new TrashGuideSourceConflictError('name', `TRaSH source name already exists: ${nextName}`);
      }

      if (tempClonePath !== null) {
        try {
          await Deno.remove(tempClonePath, { recursive: true });
        } catch (cleanupError) {
          if (!(cleanupError instanceof Deno.errors.NotFound)) {
            await logger.warn('Failed to cleanup temporary TRaSH clone path after update failure', {
              source: 'TrashGuideManager',
              meta: {
                sourceId: id,
                clonePath: tempClonePath,
                error: String(cleanupError),
              },
            });
          }
        }
      }

      throw error;
    }

    if (shouldReinitializeClone && current.local_path) {
      try {
        await Deno.remove(current.local_path, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          await logger.warn('Failed to replace TRaSH source clone during update', {
            source: 'TrashGuideManager',
            meta: {
              sourceId: id,
              oldPath: current.local_path,
              error: String(error),
            },
          });
        }
      }
    }

    return this.toSourceResponse(this.getSourceOrThrow(id));
  }

  async deleteSource(id: number): Promise<void> {
    await this.unlink(id);
  }

  async link(options: TrashGuideLinkOptions): Promise<TrashGuideSource> {
    const clonePath = `${TRASHGUIDE_CLONES_DIR}/${crypto.randomUUID()}`;
    let sourceId: number | null = null;

    try {
      const fetchResult = await fetchTrashGuideSource({
        repository_url: options.repositoryUrl,
        local_path: clonePath,
        branch: options.branch,
        arr_type: options.arrType,
      });
      const parsed = await parseTrashGuideEntities({
        arr_type: fetchResult.arr_type,
        discovery: fetchResult.discovery,
      });
      assertParseUsable(parsed);

      sourceId = trashGuideSourcesQueries.create({
        name: options.name,
        repositoryUrl: options.repositoryUrl,
        branch: fetchResult.branch,
        localPath: clonePath,
        arrType: fetchResult.arr_type,
        scoreProfile: options.scoreProfile,
        syncStrategy: options.syncStrategy,
        autoPull: options.autoPull,
        enabled: options.enabled,
      });

      const source = this.getSourceOrThrow(sourceId);
      await this.persistSourceSyncData(source, parsed, { retainPrior: false });
      this.ensureSyncConfigRows(source);

      await this.triggerPullSync(source.id);

      return source;
    } catch (error) {
      if (sourceId !== null) {
        try {
          trashGuideSourcesQueries.delete(sourceId);
        } catch (cleanupError) {
          await logger.warn('Failed to rollback TRaSH source row after link failure', {
            source: 'TrashGuideManager',
            meta: {
              sourceId,
              error: String(cleanupError),
            },
          });
        }
      }

      try {
        await Deno.remove(clonePath, { recursive: true });
      } catch (cleanupError) {
        if (!(cleanupError instanceof Deno.errors.NotFound)) {
          await logger.warn('Failed to cleanup TRaSH clone path after link failure', {
            source: 'TrashGuideManager',
            meta: { clonePath, error: String(cleanupError) },
          });
        }
      }

      throw error;
    }
  }

  async unlink(id: number): Promise<void> {
    const source = this.getSourceOrThrow(id);
    trashGuideSourcesQueries.delete(id);

    try {
      await Deno.remove(source.local_path, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        await logger.warn('Failed to remove TRaSH source clone during unlink', {
          source: 'TrashGuideManager',
          meta: {
            sourceId: id,
            localPath: source.local_path,
            error: String(error),
          },
        });
      }
    }
  }

  async sync(id: number): Promise<TrashGuideSyncResult> {
    const source = this.getSourceOrThrow(id);
    const isLocalSource = isLocalRepositorySource(source.repository_url);

    let updates: UpdateInfo = {
      hasUpdates: !isLocalSource,
      commitsBehind: 0,
      commitsAhead: 0,
      latestRemoteCommit: isLocalSource ? 'local' : '',
      currentLocalCommit: isLocalSource ? 'local' : '',
    };

    if (!isLocalSource) {
      try {
        updates = await checkGitForUpdates(source.local_path);
      } catch (error) {
        await logger.warn('Failed TRaSH source pre-sync update check', {
          source: 'TrashGuideManager',
          meta: {
            sourceId: source.id,
            localPath: source.local_path,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        // Continue with fetch/parse sync flow even if pre-check cannot be resolved.
      }
    }

    // Track progress so the catch path knows whether the clone moved ahead of the cache.
    let fetched = false;
    let persisted = false;

    try {
      const fetchResult = await fetchTrashGuideSource({
        repository_url: source.repository_url,
        local_path: source.local_path,
        branch: source.branch,
        arr_type: source.arr_type,
      });
      fetched = true;
      const parsed = await parseTrashGuideEntities({
        arr_type: fetchResult.arr_type,
        discovery: fetchResult.discovery,
      });

      if (!isUsableParse(parsed)) {
        // Never persist or fan out on a total parse failure: cache and mappings still hold the
        // last good entities, and reporting success here would mark everything upstream_deleted.
        // Log metadata only — no raw file contents.
        await logger.error('TRaSH source parse failed; no entities persisted', {
          source: 'TrashGuideManager',
          meta: {
            sourceId: source.id,
            parsedFiles: parsed.parsed_files,
            failedFiles: parsed.failed_files,
          },
        });
        // The fetch already advanced the clone to the new upstream head. Put it back on the last
        // successfully synced commit so the clone matches the cache and the next update check still
        // reports commitsBehind > 0 (otherwise the job would skip and never retry).
        await this.restoreCloneToLastSyncedCommit(source, isLocalSource);
        return {
          success: false,
          commitsBehind: updates.commitsBehind,
          parseStatus: 'failed',
          parsedFiles: parsed.parsed_files,
          failedFiles: parsed.failed_files,
          activeOperations: 0,
          removedEntities: 0,
          renamedEntities: 0,
          error: `TRaSH parse failed for every discovered file (${parsed.failed_files})`,
          failureKind: 'parse',
        };
      }

      const transformed = await this.persistSourceSyncData(source, parsed, { retainPrior: true });
      persisted = true;

      await this.triggerPullSync(source.id);

      return {
        success: true,
        commitsBehind: updates.commitsBehind,
        parseStatus: parsed.status,
        parsedFiles: parsed.parsed_files,
        failedFiles: parsed.failed_files,
        activeOperations: transformed.activeOperations.length,
        removedEntities: transformed.removedEntities.length,
        renamedEntities: transformed.renamedEntities.length,
      };
    } catch (error) {
      await logger.error('TRaSH source sync failed', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          arrType: source.arr_type,
          localPath: source.local_path,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (fetched && !persisted) {
        // The clone may have advanced without the cache following; realign it so the next update
        // check still sees the source as behind and retries.
        await this.restoreCloneToLastSyncedCommit(source, isLocalSource);
      }
      return {
        success: false,
        commitsBehind: updates.commitsBehind,
        parseStatus: 'failed',
        parsedFiles: 0,
        failedFiles: 0,
        activeOperations: 0,
        removedEntities: 0,
        renamedEntities: 0,
        error: error instanceof Error ? error.message : String(error),
        failureKind: 'run',
      };
    }
  }

  async checkForUpdates(id: number): Promise<UpdateInfo> {
    const source = this.getSourceOrThrow(id);
    if (isLocalRepositorySource(source.repository_url)) {
      return {
        hasUpdates: false,
        commitsBehind: 0,
        commitsAhead: 0,
        latestRemoteCommit: 'local',
        currentLocalCommit: 'local',
      };
    }

    return await checkGitForUpdates(source.local_path);
  }

  private parseArrType(arrType: string): TrashGuideSupportedArrType {
    if (!isTrashGuideSupportedArrType(arrType)) {
      throw new TrashGuideSourceValidationError('arr_type_invalid', `Invalid TRaSH source arrType: ${arrType}`);
    }

    return arrType;
  }

  private assertSyncStrategy(syncStrategy: number | undefined): void {
    if (syncStrategy !== undefined && !isValidScheduleIntervalMinutes(syncStrategy)) {
      throw new TrashGuideSourceValidationError('sync_strategy_invalid', SYNC_STRATEGY_RANGE_ERROR);
    }
  }

  private assertCreateConflicts(input: {
    name: string;
    repositoryUrl: string;
    branch: string;
    arrType: TrashGuideSupportedArrType;
  }): void {
    if (trashGuideSourcesQueries.nameExists(input.name)) {
      throw new TrashGuideSourceConflictError('name', `TRaSH source name already exists: ${input.name}`);
    }

    if (this.repositoryConflictExists(input.repositoryUrl, input.branch, input.arrType)) {
      throw new TrashGuideSourceConflictError(
        'repository',
        'TRaSH source repository already exists for this branch and arrType'
      );
    }
  }

  private assertUpdateConflicts(
    sourceId: number,
    input: {
      name: string;
      repositoryUrl: string;
      branch: string;
      arrType: TrashGuideSupportedArrType;
    }
  ): void {
    if (trashGuideSourcesQueries.nameExists(input.name, sourceId)) {
      throw new TrashGuideSourceConflictError('name', `TRaSH source name already exists: ${input.name}`);
    }

    if (this.repositoryConflictExists(input.repositoryUrl, input.branch, input.arrType, sourceId)) {
      throw new TrashGuideSourceConflictError(
        'repository',
        'TRaSH source repository already exists for this branch and arrType'
      );
    }
  }

  private repositoryConflictExists(
    repositoryUrl: string,
    branch: string,
    arrType: TrashGuideSupportedArrType,
    excludeSourceId?: number
  ): boolean {
    return trashGuideSourcesQueries.getAll().some((source) => {
      if (excludeSourceId !== undefined && source.id === excludeSourceId) {
        return false;
      }

      return source.repository_url === repositoryUrl && source.branch === branch && source.arr_type === arrType;
    });
  }

  private isNameConflictError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('unique') && message.includes('trash_guide_sources.name');
  }

  private toSourceResponse(source: TrashGuideSource): TrashGuideSourceResponse {
    return {
      id: source.id,
      name: source.name,
      repositoryUrl: source.repository_url,
      branch: source.branch,
      arrType: source.arr_type,
      scoreProfile: source.score_profile,
      autoPull: source.auto_pull,
      enabled: source.enabled,
      syncStrategy: source.sync_strategy,
      lastSyncedAt: source.last_synced_at,
      lastCommitHash: source.last_commit_hash,
      entityCounts: this.getEntityCounts(source.id),
    };
  }

  private getEntityCounts(sourceId: number): TrashGuideSourceEntityCounts {
    const counts: TrashGuideSourceEntityCounts = {
      customFormats: 0,
      customFormatGroups: 0,
      qualityProfiles: 0,
      qualitySizes: 0,
      naming: 0,
    };

    const entities = trashGuideEntityCacheQueries.getBySource(sourceId);
    for (const entity of entities) {
      switch (entity.entityType) {
        case 'custom_format':
          counts.customFormats += 1;
          break;
        case 'custom_format_group':
          counts.customFormatGroups += 1;
          break;
        case 'quality_profile':
          counts.qualityProfiles += 1;
          break;
        case 'quality_size':
          counts.qualitySizes += 1;
          break;
        case 'naming':
          counts.naming += 1;
          break;
      }
    }

    return counts;
  }

  private getSourceOrThrow(id: number): TrashGuideSource {
    const source = trashGuideSourcesQueries.getById(id);
    if (!source) {
      throw new TrashGuideSourceNotFoundError(id);
    }
    return source;
  }

  private async triggerPullSync(sourceId: number): Promise<void> {
    const source = this.getSourceOrThrow(sourceId);
    this.ensureSyncConfigRows(source);

    const marked = trashGuideSyncQueries.setStatusPendingBySource(sourceId);
    if (marked <= 0) {
      return;
    }

    await triggerSyncs({ event: 'on_pull' });
  }

  private ensureSyncConfigRows(source: TrashGuideSource): void {
    const instances = arrInstancesQueries.getByType(source.arr_type);
    for (const instance of instances) {
      const existing = trashGuideSyncQueries.getConfig(instance.id, source.id);
      if (existing) {
        continue;
      }

      trashGuideSyncQueries.saveConfig({
        instanceId: instance.id,
        sourceId: source.id,
        trigger: 'on_pull',
      });
    }
  }

  private async backfillMissingCustomFormatGroups(source: TrashGuideSource): Promise<void> {
    const existingGroups = trashGuideEntityCacheQueries.getBySourceAndType(source.id, 'custom_format_group');
    if (existingGroups.length > 0) {
      return;
    }

    let discovery;
    try {
      discovery = await discoverTrashGuideFiles({
        local_path: source.local_path,
        arr_type: source.arr_type,
      });
    } catch (error) {
      await logger.warn('Failed to discover TRaSH files for custom format group backfill', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          arrType: source.arr_type,
          localPath: source.local_path,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    if (discovery.files_by_entity.custom_format_group.length === 0) {
      return;
    }

    let parsed: TrashGuideParseResult;
    try {
      parsed = await parseTrashGuideEntities({
        arr_type: source.arr_type,
        discovery,
      });
    } catch (error) {
      await logger.warn('Failed to parse TRaSH custom format groups for backfill', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          arrType: source.arr_type,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    const groups = parsed.entities.custom_format_groups;
    if (groups.length === 0) {
      await logger.warn('TRaSH custom format group backfill found no parseable groups', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          arrType: source.arr_type,
          parseStatus: parsed.status,
          failedFiles: parsed.failed_files,
        },
      });
      return;
    }

    const cacheRows = await this.toCacheRows(source.id, groups);
    trashGuideEntityCacheQueries.upsertMany(cacheRows);
    trashIdMappingsQueries.upsertMany(
      groups.map((group) => ({
        sourceId: source.id,
        arrType: source.arr_type,
        entityType: 'custom_format_group',
        trashId: group.trash_id,
        entityName: group.name,
      }))
    );

    await logger.info('Backfilled missing TRaSH custom format groups', {
      source: 'TrashGuideManager',
      meta: {
        sourceId: source.id,
        arrType: source.arr_type,
        groupCount: groups.length,
      },
    });
  }

  /**
   * Move a git-backed clone back to the last successfully synced commit when a sync fetched new
   * upstream content but did not persist it. Without this the clone sits at the new head, the
   * pre-sync update check reports nothing behind, and the failed content is never retried.
   * Best effort: a failure here is logged as an error and never masks the sync result.
   */
  private async restoreCloneToLastSyncedCommit(source: TrashGuideSource, isLocalSource: boolean): Promise<void> {
    if (isLocalSource || !source.last_commit_hash) {
      return;
    }
    try {
      await resetToCommit(source.local_path, source.last_commit_hash);
    } catch (error) {
      await logger.error('Failed to reset TRaSH clone to last synced commit after unpersisted sync', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          localPath: source.local_path,
          commit: source.last_commit_hash,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Persist a usable (non-failed) parse.
   *
   * `retainPrior`: for a partial parse of the SAME repository, keep prior cache entities whose file
   * failed to parse so they are neither deleted nor reported upstream_deleted. Callers that swap the
   * repository (link, updateSource re-clone) pass false: old rows belong to different content.
   */
  private async persistSourceSyncData(
    source: TrashGuideSource,
    parsed: UsableParseResult,
    options: { retainPrior: boolean }
  ): Promise<TrashGuideTransformResult> {
    let effectiveParsed: UsableParseResult = parsed;
    if (parsed.status === 'partial') {
      const merge = options.retainPrior
        ? await this.mergeRetainedEntities(source, parsed)
        : { parsed, retainedEntities: 0, undecodableRows: 0 };
      effectiveParsed = merge.parsed;
      if (merge.undecodableRows > 0) {
        await logger.warn('TRaSH source parse partial; failed to decode retained cache entities', {
          source: 'TrashGuideManager',
          meta: { sourceId: source.id, failedFiles: parsed.failed_files, undecodableRows: merge.undecodableRows },
        });
      }
      await logger.warn('TRaSH source parse partial; retained previous entities for failed files', {
        source: 'TrashGuideManager',
        meta: {
          sourceId: source.id,
          failedFiles: parsed.failed_files,
          retainedEntities: merge.retainedEntities,
        },
      });
    }

    const existingMappings = trashIdMappingsQueries.getBySource(source.id, source.arr_type);
    const transformed = transformTrashGuideEntities({
      sourceId: source.id,
      arrType: source.arr_type,
      parsed: effectiveParsed,
      existingMappings,
    });

    const cacheRows = await this.toCacheRows(source.id, effectiveParsed.ordered_entities);
    trashGuideEntityCacheQueries.replaceSourceCache(source.id, cacheRows);
    trashIdMappingsQueries.replaceSourceMappings(source.id, source.arr_type, transformed.mappingWrites);
    trashGuideSourcesQueries.updateSyncMetadata(source.id, {
      lastSyncedAt: new Date().toISOString(),
      lastCommitHash: await this.getCurrentCommitHash(source.local_path),
    });

    return transformed;
  }

  /**
   * Build the parse result a partial sync persists: freshly parsed entities plus the prior cache
   * entities whose file failed to parse this run. Retention is keyed on the issue file_path (repo
   * relative, matching the cache row filePath) and skipped when the same identity re-parsed from
   * another file. Cached rows are validated against their row identity/source before reuse.
   * Buckets and ordered_entities are kept consistent so downstream consumers of either shape see
   * the same merged entity set.
   */
  private async mergeRetainedEntities(
    source: TrashGuideSource,
    parsed: UsableParseResult
  ): Promise<{ parsed: UsableParseResult; retainedEntities: number; undecodableRows: number }> {
    const failedFiles = new Set(parsed.issues.map((issue) => issue.file_path));
    const parsedIdentities = new Set(
      parsed.ordered_entities.map((entity) => `${entity.entity_type}:${entity.trash_id}`)
    );

    const retained: TrashGuideParsedEntity[] = [];
    let undecodableRows = 0;
    for (const row of trashGuideEntityCacheQueries.getBySource(source.id)) {
      if (!failedFiles.has(row.filePath)) {
        continue;
      }
      if (parsedIdentities.has(`${row.entityType}:${row.trashId}`)) {
        continue;
      }
      const entity = decodeCachedEntity(row, source.arr_type);
      if (entity === null) {
        undecodableRows += 1;
        continue;
      }
      retained.push(entity);
    }

    if (retained.length === 0) {
      return { parsed, retainedEntities: 0, undecodableRows };
    }

    const entities: TrashGuideParsedEntities = {
      custom_formats: [...parsed.entities.custom_formats, ...retained.filter((e) => e.entity_type === 'custom_format')],
      custom_format_groups: [
        ...parsed.entities.custom_format_groups,
        ...retained.filter((e) => e.entity_type === 'custom_format_group'),
      ],
      quality_profiles: [
        ...parsed.entities.quality_profiles,
        ...retained.filter((e) => e.entity_type === 'quality_profile'),
      ],
      quality_sizes: [...parsed.entities.quality_sizes, ...retained.filter((e) => e.entity_type === 'quality_size')],
      naming: [...parsed.entities.naming, ...retained.filter((e) => e.entity_type === 'naming')],
    };

    return {
      parsed: { ...parsed, entities, ordered_entities: [...parsed.ordered_entities, ...retained] },
      retainedEntities: retained.length,
      undecodableRows,
    };
  }

  private async toCacheRows(
    sourceId: number,
    entities: readonly TrashGuideParsedEntity[]
  ): Promise<TrashGuideEntityCacheInput[]> {
    const cacheRows: TrashGuideEntityCacheInput[] = [];

    for (const entity of entities) {
      const jsonData = JSON.stringify(entity);
      const contentHash = await computeContentHash(jsonData);
      cacheRows.push({
        sourceId,
        trashId: entity.trash_id,
        entityType: entity.entity_type,
        name: entity.name,
        jsonData,
        filePath: entity.file_path,
        contentHash,
      });
    }

    return cacheRows;
  }

  private async getCurrentCommitHash(localPath: string): Promise<string | null> {
    try {
      const commits = await getCommits(localPath, 1, 'HEAD');
      return commits[0]?.hash ?? null;
    } catch (error) {
      await logger.warn('Failed to retrieve TRaSH source commit hash', {
        source: 'TrashGuideManager',
        meta: {
          localPath,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per-type structural check of the fields the transformer iterates, so a corrupt row cannot crash a sync. */
function hasRequiredShape(entity: Record<string, unknown>): boolean {
  switch (entity.entity_type) {
    case 'custom_format':
      return Array.isArray(entity.specifications) && isPlainObject(entity.scores);
    case 'custom_format_group':
      return (
        Array.isArray(entity.custom_formats) &&
        isPlainObject(entity.quality_profiles) &&
        isPlainObject(entity.quality_profiles.include)
      );
    case 'quality_profile':
      return Array.isArray(entity.items) && Array.isArray(entity.format_items);
    case 'quality_size':
      return Array.isArray(entity.qualities);
    case 'naming':
      return isPlainObject(entity.templates);
    default:
      return false;
  }
}

/** Decode a cached entity row, rejecting rows whose payload disagrees with the row identity or shape. */
function decodeCachedEntity(row: TrashGuideEntityCache, arrType: string): TrashGuideParsedEntity | null {
  let value: unknown;
  try {
    value = JSON.parse(row.jsonData);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  if (
    value.entity_type !== row.entityType ||
    value.trash_id !== row.trashId ||
    value.arr_type !== arrType ||
    value.file_path !== row.filePath ||
    typeof value.name !== 'string' ||
    !hasRequiredShape(value)
  ) {
    return null;
  }
  return value as unknown as TrashGuideParsedEntity;
}

async function computeContentHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const trashGuideManager = new TrashGuideManager();
