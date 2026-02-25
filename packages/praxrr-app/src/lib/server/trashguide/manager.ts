import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { trashGuideSourcesQueries, type TrashGuideSource } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries, type TrashGuideEntityCacheInput } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { triggerSyncs } from '$sync/processor.ts';
import { checkForUpdates as checkGitForUpdates, getCommits, type UpdateInfo } from '$utils/git/index.ts';
import { fetchTrashGuideSource } from './fetcher.ts';
import { parseTrashGuideEntities } from './parser.ts';
import { transformTrashGuideEntities } from './transformer.ts';
import type {
  TrashGuideArrType,
  TrashGuideParseResult,
  TrashGuideParseStatus,
  TrashGuideParsedEntity,
} from './types.ts';

const TRASHGUIDE_CLONES_DIR = `${config.paths.data}/trashguide`;

export interface TrashGuideLinkOptions {
  name: string;
  repositoryUrl: string;
  branch?: string;
  arrType: TrashGuideArrType;
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

class TrashGuideManager {
  async initialize(): Promise<void> {
    await Deno.mkdir(TRASHGUIDE_CLONES_DIR, { recursive: true });

    const sources = trashGuideSourcesQueries.getAll();
    let missingLocalClones = 0;

    for (const source of sources) {
      try {
        await Deno.stat(source.local_path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          missingLocalClones += 1;
          await logger.warn('TRaSH source clone directory missing', {
            source: 'TrashGuideManager',
            meta: { sourceId: source.id, localPath: source.local_path },
          });
          continue;
        }
        throw error;
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
    } catch {
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

  private getSourceOrThrow(id: number): TrashGuideSource {
    const source = trashGuideSourcesQueries.getById(id);
    if (!source) {
      throw new Error(`TRaSH source ${id} not found`);
    }
    return source;
  }

  private async triggerPullSync(sourceId: number): Promise<void> {
    const marked = trashGuideSyncQueries.setStatusPendingBySource(sourceId);
    if (marked <= 0) {
      return;
    }

    await triggerSyncs({ event: 'on_pull' });
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
    return await Promise.all(
      entities.map(async (entity) => {
        const jsonData = JSON.stringify(entity);
        return {
          sourceId,
          trashId: entity.trash_id,
          entityType: entity.entity_type,
          name: entity.name,
          jsonData,
          filePath: entity.file_path,
          contentHash: await computeContentHash(jsonData),
        } satisfies TrashGuideEntityCacheInput;
      })
    );
  }

  private async getCurrentCommitHash(localPath: string): Promise<string | null> {
    try {
      const commits = await getCommits(localPath, 1, 'HEAD');
      return commits[0]?.hash ?? null;
    } catch {
      return null;
    }
  }
}

async function computeContentHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const trashGuideManager = new TrashGuideManager();
