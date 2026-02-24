/**
 * Compatibility smoke check for monorepo schema/DB contract sync.
 *
 * Usage:
 *   deno run -A scripts/compat-check.ts
 */

import { Database } from '@jsr/db__sqlite';
import path from 'node:path';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { CreatePcdOpHistoryInput, PcdOpHistory } from '$db/queries/pcdOpHistory.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PcdOp, PcdOpSource, PcdOpState } from '$db/queries/pcdOps.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { compile } from '$pcd/database/compiler.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import type { PCDCache } from '$pcd/index.ts';
import { PCDCache as PCDCacheClass } from '$pcd/database/cache.ts';
import { readMigrationEntitySources } from '$pcd/migration/reader.ts';
import { ENTITY_TYPES } from '$shared/pcd/portable.ts';
import { __testOnly_resetCompile, __testOnly_setCompile, importBaseOps } from '$pcd/ops/importBaseOps.ts';

type CompatibilityError = {
  stage: FailureStage;
  message: string;
  details?: string;
};

type FailureStage = 'schema_ops' | 'yaml_entities' | 'operation_writes';

const SCHEMA_OPS_DIR_PATH = 'packages/praxrr-schema/ops';
const PCD_ENTITIES_ROOT_PATH = 'packages/praxrr-db';
const COMPAT_DATABASE_ID = 90_900_001;
const REQUIRED_MEDIA_MANAGEMENT_ENTITY_SOURCES = [
  'media-management/radarr-naming/radarr.yaml',
  'media-management/radarr-media-settings/radarr.yaml',
  'media-management/radarr-quality-definitions/radarr.yaml',
  'media-management/sonarr-naming/sonarr.yaml',
  'media-management/sonarr-media-settings/sonarr.yaml',
  'media-management/sonarr-quality-definitions/sonarr.yaml',
  'media-management/lidarr-naming/lidarr.yaml',
  'media-management/lidarr-media-settings/lidarr.yaml',
  'media-management/lidarr-quality-definitions/lidarr.yaml',
] as const;

interface SchemaArtifact {
  filename: string;
  sql: string;
}

interface InMemoryPcdOp extends PcdOp {}

type Restore = () => void;

interface QueryStateResult {
  restore: () => void;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(stage: FailureStage, message: string, error?: unknown): never {
  const details = error === undefined ? undefined : formatError(error);
  throw {
    stage,
    message,
    details,
  } satisfies CompatibilityError;
}

function extractOrderFromFilename(filename: string): number {
  const match = filename.match(/^([0-9]+)\./);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }
  return Number.parseInt(match[1], 10);
}

function installQueryShims(databaseId: number): QueryStateResult {
  const restores: Restore[] = [];

  const originalDatabaseInstancesGetById = databaseInstancesQueries.getById;
  const originalPcdOpsGetById = pcdOpsQueries.getById;
  const originalPcdOpsListByDatabaseAndOrigin = pcdOpsQueries.listByDatabaseAndOrigin;
  const originalPcdOpsGetBaseByFilename = pcdOpsQueries.getBaseByFilename;
  const originalPcdOpsCreate = pcdOpsQueries.create;
  const originalPcdOpsUpdate = pcdOpsQueries.update;
  const originalPcdOpsMarkBaseOrphaned = pcdOpsQueries.markBaseOrphaned;
  const originalPcdOpHistoryCreate = pcdOpHistoryQueries.create;
  const originalPcdOpHistoryListLatestByDatabaseWithOps = pcdOpHistoryQueries.listLatestByDatabaseWithOps;
  const originalPcdOpHistoryListLatestConflictsByDatabase = pcdOpHistoryQueries.listLatestConflictsByDatabase;

  const operations: InMemoryPcdOp[] = [];
  let nextOpId = 1;
  let nextHistoryId = 1;

  const fakeInstance: DatabaseInstance = {
    id: databaseId,
    uuid: 'compat-check',
    name: 'compatibility-check',
    repository_url: 'compat-check',
    local_path: 'compat-check',
    sync_strategy: 0,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const patch = <T, K extends keyof T>(target: T, key: K, replacement: T[K]): void => {
    const original = target[key];
    (target as Record<string, unknown>)[key as string] = replacement;
    restores.push(() => {
      (target as Record<string, unknown>)[key as string] = original as never;
    });
  };

  patch(databaseInstancesQueries as Record<string, unknown>, 'getById', ((id: number): DatabaseInstance | undefined => {
    if (id === databaseId) {
      return fakeInstance;
    }
    return originalDatabaseInstancesGetById(id);
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'create', ((input) => {
    const next: InMemoryPcdOp = {
      id: nextOpId,
      database_id: input.databaseId,
      origin: input.origin,
      state: input.state,
      source: input.source,
      filename: input.filename ?? null,
      op_number: input.opNumber ?? null,
      sequence: input.sequence ?? null,
      sql: input.sql,
      metadata: input.metadata ?? null,
      desired_state: input.desiredState ?? null,
      content_hash: input.contentHash ?? null,
      last_seen_in_repo_at: input.lastSeenInRepoAt ?? null,
      superseded_by_op_id: input.supersededByOpId ?? null,
      pushed_at: input.pushedAt ?? null,
      pushed_commit: input.pushedCommit ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    nextOpId += 1;
    operations.push(next);
    return next.id;
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'getById', ((id: number) => {
    return operations.find((op) => op.id === id);
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'listByDatabaseAndOrigin', ((
    searchDatabaseId: number,
    origin: 'base' | 'user',
    options?: { states?: PcdOpState[]; source?: PcdOpSource }
  ) => {
    const byDatabase = operations.filter(
      (operation) => operation.database_id === searchDatabaseId && operation.origin === origin
    );
    const bySource = options?.source
      ? byDatabase.filter((operation) => operation.source === options.source)
      : byDatabase;
    const byState =
      options?.states && options.states.length > 0
        ? bySource.filter((operation) => options.states.includes(operation.state))
        : bySource;

    return byState.sort((a, b) => a.id - b.id);
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'getBaseByFilename', ((
    searchDatabaseId: number,
    filename: string
  ) => {
    return operations.find(
      (op) => op.database_id === searchDatabaseId && op.origin === 'base' && op.filename === filename
    );
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'update', ((id: number, input) => {
    const index = operations.findIndex((operation) => operation.id === id);
    if (index < 0) return false;

    const op = operations[index];
    if (input.state !== undefined) op.state = input.state;
    if (input.source !== undefined) op.source = input.source;
    if (input.filename !== undefined) op.filename = input.filename;
    if (input.opNumber !== undefined) op.op_number = input.opNumber;
    if (input.sequence !== undefined) op.sequence = input.sequence;
    if (input.sql !== undefined) op.sql = input.sql;
    if (input.metadata !== undefined) op.metadata = input.metadata;
    if (input.desiredState !== undefined) {
      op.desired_state = input.desiredState;
    }
    if (input.contentHash !== undefined) op.content_hash = input.contentHash;
    if (input.lastSeenInRepoAt !== undefined) {
      op.last_seen_in_repo_at = input.lastSeenInRepoAt;
    }
    if (input.supersededByOpId !== undefined) {
      op.superseded_by_op_id = input.supersededByOpId;
    }
    if (input.pushedAt !== undefined) op.pushed_at = input.pushedAt;
    if (input.pushedCommit !== undefined) {
      op.pushed_commit = input.pushedCommit;
    }
    operations[index] = op;
    return true;
  }) as never);

  patch(pcdOpsQueries as Record<string, unknown>, 'markBaseOrphaned', (() => 0) as never);

  patch(pcdOpHistoryQueries as Record<string, unknown>, 'create', ((input: CreatePcdOpHistoryInput) => {
    const row: PcdOpHistory = {
      id: nextHistoryId,
      op_id: input.opId,
      database_id: input.databaseId,
      batch_id: input.batchId,
      status: input.status,
      rowcount: input.rowcount ?? null,
      conflict_reason: input.conflictReason ?? null,
      error: input.error ?? null,
      details: input.details ?? null,
      applied_at: new Date().toISOString(),
    };

    nextHistoryId += 1;
    return row.id;
  }) as never);

  patch(pcdOpHistoryQueries as Record<string, unknown>, 'listLatestByDatabaseWithOps', (() => []) as never);

  patch(pcdOpHistoryQueries as Record<string, unknown>, 'listLatestConflictsByDatabase', (() => []) as never);

  return {
    restore: () => {
      for (let i = restores.length - 1; i >= 0; i--) {
        restores[i]();
      }
    },
    // no-op payload
  };
}

async function loadSchemaArtifacts(schemaOpsPath: string): Promise<SchemaArtifact[]> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(schemaOpsPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail('schema_ops', `Missing schema ops directory: ${schemaOpsPath}`);
    }
    fail('schema_ops', `Cannot access schema ops directory: ${schemaOpsPath}`, error);
  }

  if (!stat.isDirectory) {
    fail('schema_ops', `Schema ops path is not a directory: ${schemaOpsPath}`);
  }

  const filenames: string[] = [];
  for await (const entry of Deno.readDir(schemaOpsPath)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      filenames.push(entry.name);
    }
  }

  if (filenames.length === 0) {
    fail('schema_ops', `No schema SQL files found in: ${schemaOpsPath}`);
  }

  const sorted = [...filenames].sort((a, b) => {
    const aOrder = extractOrderFromFilename(a);
    const bOrder = extractOrderFromFilename(b);
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.localeCompare(b);
  });

  const artifacts: SchemaArtifact[] = [];
  for (const filename of sorted) {
    artifacts.push({
      filename,
      sql: await Deno.readTextFile(path.join(schemaOpsPath, filename)),
    });
  }

  return artifacts;
}

async function validateSchemaLoads(artifacts: readonly SchemaArtifact[]): Promise<void> {
  const database = new Database(':memory:');

  try {
    for (const artifact of artifacts) {
      try {
        database.exec(artifact.sql);
      } catch (error) {
        fail('schema_ops', `Failed applying schema operation ${artifact.filename}: ${String(error)}`, error);
      }
    }
  } finally {
    database.close();
  }
}

async function createCompatPCDPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const schemaSource = path.join(Deno.cwd(), SCHEMA_OPS_DIR_PATH);
  const entitySource = path.join(Deno.cwd(), PCD_ENTITIES_ROOT_PATH, 'entities');
  const pcdPath = await Deno.makeTempDir({ prefix: 'compat-check-' });

  const schemaDestination = path.join(pcdPath, 'deps', 'praxrr-schema', 'ops');
  const entityDestination = path.join(pcdPath, 'entities');

  await Deno.mkdir(schemaDestination, { recursive: true });

  for await (const entry of Deno.readDir(schemaSource)) {
    if (!entry.isFile || !entry.name.endsWith('.sql')) {
      continue;
    }

    const sourceFile = path.join(schemaSource, entry.name);
    const targetFile = path.join(schemaDestination, entry.name);
    await Deno.copyFile(sourceFile, targetFile);
  }

  try {
    await Deno.symlink(entitySource, entityDestination);
  } catch (_error) {
    await Deno.cp(entitySource, entityDestination, { recursive: true });
  }

  return {
    path: pcdPath,
    cleanup: async () => {
      await Deno.remove(pcdPath, { recursive: true });
    },
  };
}

async function validateYamlEntities(pcdPath: string): Promise<void> {
  const readerResult = await readMigrationEntitySources(pcdPath);
  if (readerResult.issues.length > 0) {
    const summary = readerResult.issues
      .map((issue) => `${issue.relativePath}: ${issue.kind} - ${issue.message}`)
      .join('; ');
    fail('yaml_entities', `Failed to read YAML entities from ${pcdPath}/entities`, summary);
  }

  const presentTypes = new Set(readerResult.candidates.map((candidate) => candidate.entityType));
  const missing = ENTITY_TYPES.filter((entityType) => !presentTypes.has(entityType));
  if (missing.length > 0) {
    fail('yaml_entities', `Missing YAML entities for supported types: ${missing.join(', ')}`);
  }

  const presentPaths = new Set(readerResult.candidates.map((candidate) => candidate.relativePath));
  const missingEntitySourcePaths = REQUIRED_MEDIA_MANAGEMENT_ENTITY_SOURCES.filter(
    (relativePath) => !presentPaths.has(relativePath)
  );
  if (missingEntitySourcePaths.length > 0) {
    fail('yaml_entities', `Missing required media-management entity sources: ${missingEntitySourcePaths.join(', ')}`);
  }
}

async function validateWritesCompile(pcdPath: string): Promise<void> {
  const queryState = installQueryShims(COMPAT_DATABASE_ID);
  const cache = new PCDCacheClass(pcdPath, COMPAT_DATABASE_ID) as PCDCache;

  try {
    setCache(COMPAT_DATABASE_ID, cache);
    __testOnly_setCompile(compile);

    await importBaseOps(COMPAT_DATABASE_ID, pcdPath);
    await compile(pcdPath, COMPAT_DATABASE_ID);
  } catch (error) {
    fail('operation_writes', 'YAML entity writes failed to compile into cache', error);
  } finally {
    __testOnly_resetCompile();
    deleteCache(COMPAT_DATABASE_ID);
    queryState.restore();
    const currentCache = getCache(COMPAT_DATABASE_ID);
    if (currentCache && currentCache !== cache) {
      currentCache.close();
      deleteCache(COMPAT_DATABASE_ID);
    }
    cache.close();
  }
}

async function main(): Promise<void> {
  const schemaArtifacts = await loadSchemaArtifacts(path.join(Deno.cwd(), SCHEMA_OPS_DIR_PATH));
  const compatibilityRepo = await createCompatPCDPath();

  try {
    await validateSchemaLoads(schemaArtifacts);
    await validateYamlEntities(compatibilityRepo.path);
    await validateWritesCompile(compatibilityRepo.path);

    console.log('[compat-check] All checks passed');
  } finally {
    try {
      await compatibilityRepo.cleanup();
    } catch (_error) {
      console.error('[compat-check] Temporary compatibility repo cleanup failed');
    }
  }
}

try {
  await main();
} catch (error) {
  const failure = error as CompatibilityError;
  if (typeof failure?.stage === 'string' && typeof failure?.message === 'string') {
    console.error(`[compat-check] ${failure.stage}`);
    console.error(failure.message);
    if (failure.details) {
      console.error(failure.details);
    }
  } else {
    console.error('[compat-check] Failure');
    console.error(error);
  }
  Deno.exit(1);
}
