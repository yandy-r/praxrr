import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { type TrashGuideSource, trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { type TrashGuideEntityCacheInput, trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { triggerSyncs } from '$sync/processor.ts';
import { checkForUpdates as checkGitForUpdates, getCommits, type UpdateInfo } from '$utils/git/index.ts';
import { discoverTrashGuideFiles, fetchTrashGuideSource } from './fetcher.ts';
import { parseTrashGuideEntities } from './parser.ts';
import { transformTrashGuideEntities } from './transformer.ts';
import type {
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

export interface TrashGuideSyncResult {
  success: boolean;
  commitsBehind: number;
  parseStatus: TrashGuideParseStatus;
  parsedFiles: number;
  failedFiles: number;
  activeOperations: number;
  removedEntities: number;
  renamedEntities: number;
  error?: string;
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

export class TrashGuideSourceValidationError extends Error {
  readonly code: 'arr_type_invalid' | 'arr_type_mismatch';

  constructor(code: 'arr_type_invalid' | 'arr_type_mismatch', message: string) {
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

        const nextSource = {
          ...current,
          repository_url: nextRepositoryUrl,
          branch: fetchResult.branch,
          local_path: clonePath,
        };

        await this.persistSourceSyncData(nextSource, parsed);

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
              meta: { sourceId: id, clonePath: tempClonePath, error: String(cleanupError) },
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
      await this.persistSourceSyncData(source, parsed);
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

    let updates: UpdateInfo = {
      hasUpdates: true,
      commitsBehind: 0,
      commitsAhead: 0,
      latestRemoteCommit: '',
      currentLocalCommit: '',
    };

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
      // Continue with pull/parse sync flow even if pre-check cannot be resolved.
    }

    try {
      const fetchResult = await fetchTrashGuideSource({
        repository_url: source.repository_url,
        local_path: source.local_path,
        branch: source.branch,
        arr_type: source.arr_type,
      });
      const parsed = await parseTrashGuideEntities({
        arr_type: fetchResult.arr_type,
        discovery: fetchResult.discovery,
      });
      const transformed = await this.persistSourceSyncData(source, parsed);

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
      };
    }
  }

  async checkForUpdates(id: number): Promise<UpdateInfo> {
    const source = this.getSourceOrThrow(id);
    return await checkGitForUpdates(source.local_path);
  }

  private parseArrType(arrType: string): TrashGuideSupportedArrType {
    if (!isTrashGuideSupportedArrType(arrType)) {
      throw new TrashGuideSourceValidationError('arr_type_invalid', `Invalid TRaSH source arrType: ${arrType}`);
    }

    return arrType;
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

  private async persistSourceSyncData(source: TrashGuideSource, parsed: TrashGuideParseResult) {
    const existingMappings = trashIdMappingsQueries.getBySource(source.id, source.arr_type);
    const transformed = transformTrashGuideEntities({
      sourceId: source.id,
      arrType: source.arr_type,
      parsed,
      existingMappings,
    });

    const cacheRows = await this.toCacheRows(source.id, parsed.ordered_entities);
    trashGuideEntityCacheQueries.replaceSourceCache(source.id, cacheRows);
    trashIdMappingsQueries.replaceSourceMappings(source.id, source.arr_type, transformed.mappingWrites);
    trashGuideSourcesQueries.updateSyncMetadata(source.id, {
      lastSyncedAt: new Date().toISOString(),
      lastCommitHash: await this.getCurrentCommitHash(source.local_path),
    });

    return transformed;
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

async function computeContentHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const trashGuideManager = new TrashGuideManager();
