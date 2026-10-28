import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { getCache } from '$pcd/database/registry.ts';
import { deserializeByEntityType } from '$pcd/entities/deserialize.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PcdBundle } from '$shared/pcd/bundle.ts';
import type { EntityType, PortableEntityData } from '$shared/pcd/portable.ts';

const SCHEMA_OPS_DIR = new URL('../../../../../praxrr-schema/ops/', import.meta.url);

/**
 * Run a test body against a migrated scratch app DB. Each test gets a clean base path, so
 * database ids and `pcd_ops` start empty.
 */
export function bundleTest(name: string, fn: () => Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/bundles-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });
      db.close();
      config.setBasePath(tempBasePath);
      const createdIds: number[] = [];
      createdPcdIds.set(tempBasePath, createdIds);
      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        for (const id of createdIds) invalidate(id);
        db.close();
        config.setBasePath(originalBasePath);
        createdPcdIds.delete(tempBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

const createdPcdIds = new Map<string, number[]>();

/**
 * Create a PCD database instance backed by the real schema ops and compile its cache.
 * `base` writes require a personal access token and local ops disabled, so `withToken` sets both.
 */
export async function createPcd(options: { withToken?: boolean } = {}): Promise<number> {
  const localPath = `${config.paths.base}/pcd-${crypto.randomUUID()}`;
  const schemaDir = `${localPath}/deps/schema/ops`;
  await Deno.mkdir(schemaDir, { recursive: true });
  for await (const entry of Deno.readDir(SCHEMA_OPS_DIR)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      await Deno.copyFile(new URL(entry.name, SCHEMA_OPS_DIR), `${schemaDir}/${entry.name}`);
    }
  }
  const id = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: `bundle-test-${crypto.randomUUID()}`,
    repositoryUrl: 'https://example.com/db.git',
    localPath,
    personalAccessToken: options.withToken ? 'token' : undefined,
    localOpsEnabled: false,
  });
  createdPcdIds.get(config.paths.base)?.push(id);
  await compile(localPath, id);
  return id;
}

export function liveCache(databaseId: number): PCDCache {
  const cache = getCache(databaseId);
  if (!cache) throw new Error(`No cache for database ${databaseId}`);
  return cache;
}

/** Create one entity through the real deserializer (the same path a legacy import takes). */
export async function seedEntity(
  databaseId: number,
  entityType: EntityType,
  data: PortableEntityData,
  layer: 'user' | 'base' = 'user'
): Promise<void> {
  const result = await deserializeByEntityType({
    databaseId,
    cache: liveCache(databaseId),
    layer,
    entityType,
    data,
  });
  if (result && typeof result === 'object' && (result as { success?: boolean }).success === false) {
    throw new Error(`seed ${entityType} failed: ${(result as { error?: string }).error}`);
  }
}

export function regexData(name: string, pattern = 'x264'): PortableEntityData {
  return { name, pattern, tags: ['codec'], description: null, regex101Id: null };
}

export function customFormatData(name: string, regexName: string): PortableEntityData {
  return {
    name,
    description: null,
    includeInRename: false,
    tags: [],
    conditions: [
      {
        name: 'title',
        type: 'release_title',
        arrType: 'all',
        negate: false,
        required: true,
        patterns: [{ name: regexName, pattern: 'ignored-by-write' }],
      },
    ],
    tests: [],
  };
}

export function qualityProfileData(name: string, cfNames: string[]): PortableEntityData {
  return {
    name,
    description: null,
    tags: [],
    language: null,
    orderedItems: [],
    minimumScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    customFormatScores: cfNames.map((customFormatName, index) => ({
      customFormatName,
      arrType: 'radarr',
      score: (index + 1) * 100,
    })),
  };
}

export function bundleOf(...entries: Array<[EntityType, PortableEntityData]>): PcdBundle {
  return { version: 1, entities: entries.map(([entityType, data]) => ({ entityType, data })) };
}

export interface OpsSnapshot {
  ops: PcdOp[];
  historyCount: number;
}

export function snapshotOps(databaseId: number): OpsSnapshot {
  return {
    ops: pcdOpsQueries.listByDatabase(databaseId),
    historyCount: pcdOpHistoryQueries.listByDatabase(databaseId).length,
  };
}

export function namesIn(cache: PCDCache, table: string): string[] {
  return cache.query<{ name: string }>(`SELECT name FROM ${table} ORDER BY name`).map((row) => row.name);
}

export function scoredFormatNames(cache: PCDCache, profileName: string): string[] {
  return cache
    .query<{ custom_format_name: string }>(
      'SELECT custom_format_name FROM quality_profile_custom_formats WHERE quality_profile_name = ? ORDER BY custom_format_name',
      profileName
    )
    .map((row) => row.custom_format_name);
}
