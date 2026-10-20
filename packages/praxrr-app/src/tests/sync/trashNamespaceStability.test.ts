/**
 * Regression tests for YAN-443 / #332: a TRaSH source's namespace suffix must be stable per
 * (Arr instance, source) across syncs, regardless of which other sources resolve.
 */
import { assertEquals, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrTrashNamespaceQueries } from '$db/queries/arrTrashNamespaces.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashGuideEntityCacheQueries, type TrashGuideEntityCache } from '$db/queries/trashGuideEntityCache.ts';
import type { TrashGuideSyncQualityProfileSourceHydration } from '$db/queries/trashGuideSync.ts';
import { logger } from '$logger/logger.ts';
import { getTrashGuideNamespaceSuffix } from '$sync/namespace.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import { confirmTrashNamespace } from '$sync/trashSourceProfiles.ts';

const SOURCE_A = 31; // sorts first ("Source A")
const SOURCE_B = 32;
const SOURCE_EARLY = 33; // added later but sorts before B ("Source 0")

function makeTrashSource(id: number) {
  return {
    id,
    name: `Source ${id}`,
    repository_url: '',
    branch: '',
    local_path: '',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '',
    updated_at: '',
  } as never;
}

function profileRow(sourceId: number): TrashGuideEntityCache {
  const trashId = String(sourceId).padStart(32, '0');
  const profileName = `Profile ${sourceId}`;
  return {
    id: 900 + sourceId,
    sourceId,
    trashId,
    entityType: 'quality_profile',
    name: profileName,
    filePath: `quality-profiles/${trashId}.json`,
    contentHash: 'hash',
    fetchedAt: '2025-01-01T00:00:00.000Z',
    jsonData: JSON.stringify({
      entity_type: 'quality_profile',
      arr_type: 'radarr',
      trash_id: trashId,
      file_path: `quality-profiles/${trashId}.json`,
      name: profileName,
      description: null,
      source_url: null,
      score_set: null,
      group: null,
      upgrade_allowed: true,
      cutoff: 'Bluray-1080p',
      min_format_score: 0,
      cutoff_format_score: 0,
      min_upgrade_format_score: 0,
      language: null,
      items: [{ name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] }],
      format_items: [{ name: `CF ${sourceId}`, score: 10, custom_format_trash_id: null }],
    }),
  };
}

function hydration(sourceId: number): TrashGuideSyncQualityProfileSourceHydration {
  return {
    sourceId,
    sourceName: `Source ${sourceId}`,
    sourceArrType: 'radarr',
    config: null,
    selectedQualityProfiles: [`Profile ${sourceId}`],
  };
}

type TrashBatchFetcher = {
  fetchTrashSyncBatches: (
    hydrations: TrashGuideSyncQualityProfileSourceHydration[],
    mode: 'allocate' | 'predict'
  ) => Promise<{ sourceLabel: string; suffix: string }[]>;
};

/** Suffix per source label for one TRaSH batch pass over `hydrations` (default: a real sync). */
async function trashSuffixes(
  instanceId: number,
  hydrations: TrashGuideSyncQualityProfileSourceHydration[],
  mode: 'allocate' | 'predict' = 'allocate'
): Promise<Record<string, string>> {
  const syncer = new QualityProfileSyncer({} as never, instanceId, 'Test Radarr', 'radarr');
  const batches = await (syncer as unknown as TrashBatchFetcher).fetchTrashSyncBatches(hydrations, mode);
  return Object.fromEntries(batches.map((batch) => [batch.sourceLabel, batch.suffix]));
}

function persistedIndexes(instanceId: number): Record<number, number> {
  const rows = db.query<{ source_id: number; namespace_index: number }>(
    'SELECT source_id, namespace_index FROM arr_trash_guide_namespaces WHERE instance_id = ?',
    instanceId
  );
  return Object.fromEntries(rows.map((row) => [row.source_id, row.namespace_index]));
}

/** Real migrated scratch DB; TRaSH source/cache reads stubbed; `emptyCacheSources` resolve no_cache. */
function migratedTest(name: string, fn: (instanceId: number, emptyCacheSources: Set<number>) => Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/trash-namespace-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });
      const originalGetById = trashGuideSourcesQueries.getById;
      const originalGetBySource = trashGuideEntityCacheQueries.getBySource;
      const originalWarn = logger.warn;
      const originalInfo = logger.info;
      const originalDebug = logger.debug;
      const originalError = logger.error;
      const emptyCacheSources = new Set<number>();

      db.close();
      config.setBasePath(tempBasePath);
      try {
        await db.initialize();
        await runMigrations();
        logger.warn = async () => {};
        logger.info = async () => {};
        logger.debug = async () => {};
        logger.error = async () => {};
        trashGuideSourcesQueries.getById = (id: number) => makeTrashSource(id);
        trashGuideEntityCacheQueries.getBySource = (sourceId: number) =>
          emptyCacheSources.has(sourceId) ? [] : [profileRow(sourceId)];
        const instanceId = arrInstancesQueries.create({
          name: 'Test Radarr',
          type: 'radarr',
          url: 'http://localhost:7878',
          apiKey: 'test',
        });
        await fn(instanceId, emptyCacheSources);
      } finally {
        trashGuideSourcesQueries.getById = originalGetById;
        trashGuideEntityCacheQueries.getBySource = originalGetBySource;
        logger.warn = originalWarn;
        logger.info = originalInfo;
        logger.debug = originalDebug;
        logger.error = originalError;
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

migratedTest(
  'TRaSH namespace: removing an earlier-sorting source keeps the later source suffix',
  async (instanceId) => {
    const first = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(first[`Source ${SOURCE_A}`], getTrashGuideNamespaceSuffix(1));
    assertEquals(first[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));

    const second = await trashSuffixes(instanceId, [hydration(SOURCE_B)]);
    assertEquals(second[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));
  }
);

migratedTest(
  'TRaSH namespace: an earlier source failing to resolve keeps the later source suffix',
  async (instanceId, emptyCacheSources) => {
    await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);

    emptyCacheSources.add(SOURCE_A);
    const second = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(second[`Source ${SOURCE_A}`], undefined);
    assertEquals(second[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));

    emptyCacheSources.delete(SOURCE_A);
    const third = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(third[`Source ${SOURCE_A}`], getTrashGuideNamespaceSuffix(1));
    assertEquals(third[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));
  }
);

migratedTest('TRaSH namespace: a newly added earlier-sorting source takes a fresh index', async (instanceId) => {
  const first = await trashSuffixes(instanceId, [hydration(SOURCE_B)]);
  assertEquals(first[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(1));

  const second = await trashSuffixes(instanceId, [hydration(SOURCE_EARLY), hydration(SOURCE_B)]);
  assertEquals(second[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(1));
  assertEquals(second[`Source ${SOURCE_EARLY}`], getTrashGuideNamespaceSuffix(2));
});

migratedTest(
  'TRaSH namespace: first run with an unresolvable source uses positional suffixes and persists nothing',
  async (instanceId, emptyCacheSources) => {
    // Pre-upgrade Arr state: A held positional index 1, B index 2. A's cache is briefly empty.
    emptyCacheSources.add(SOURCE_A);
    const first = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(first[`Source ${SOURCE_A}`], undefined);
    assertEquals(first[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(1));
    assertEquals(persistedIndexes(instanceId), {});

    // A recovers: the restored positional order is what gets locked in.
    emptyCacheSources.delete(SOURCE_A);
    const second = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(second[`Source ${SOURCE_A}`], getTrashGuideNamespaceSuffix(1));
    assertEquals(second[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));
    assertEquals(persistedIndexes(instanceId), { [SOURCE_A]: 1, [SOURCE_B]: 2 });
  }
);

migratedTest(
  'TRaSH namespace: preview is read-only and predicts the suffixes the next sync persists',
  async (instanceId) => {
    const preview = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)], 'predict');
    assertEquals(persistedIndexes(instanceId), {});

    const sync = await trashSuffixes(instanceId, [hydration(SOURCE_A), hydration(SOURCE_B)]);
    assertEquals(sync, preview);
    assertEquals(persistedIndexes(instanceId), { [SOURCE_A]: 1, [SOURCE_B]: 2 });

    // With rows present, a new source is predicted at MAX + 1 without being persisted.
    const nextPreview = await trashSuffixes(
      instanceId,
      [hydration(SOURCE_EARLY), hydration(SOURCE_A), hydration(SOURCE_B)],
      'predict'
    );
    assertEquals(nextPreview[`Source ${SOURCE_EARLY}`], getTrashGuideNamespaceSuffix(3));
    assertEquals(persistedIndexes(instanceId), { [SOURCE_A]: 1, [SOURCE_B]: 2 });
  }
);

migratedTest('TRaSH namespace: reviewed replay persists or rejects a stale namespace', async (instanceId) => {
  // Reviewed on a fresh instance: A=1, B=2 predicted. Replay persists them in batch order.
  confirmTrashNamespace(instanceId, { sourceId: SOURCE_A, index: 1, persisted: true });
  confirmTrashNamespace(instanceId, { sourceId: SOURCE_B, index: 2, persisted: true });
  assertEquals(persistedIndexes(instanceId), { [SOURCE_A]: 1, [SOURCE_B]: 2 });

  // A review that predicted index 3 for EARLY, replayed after another source took 3, is stale.
  arrTrashNamespaceQueries.getOrCreate(instanceId, SOURCE_A + 100);
  assertThrows(
    () => confirmTrashNamespace(instanceId, { sourceId: SOURCE_EARLY, index: 3, persisted: true }),
    Error,
    'stale'
  );
  // An upgrade-fallback review is stale once any row exists.
  assertThrows(
    () => confirmTrashNamespace(instanceId, { sourceId: SOURCE_B + 100, index: 1, persisted: false }),
    Error,
    'stale'
  );
});

migratedTest('TRaSH namespace: a source resolving no selected profile consumes no index', async (instanceId) => {
  // EARLY resolves (has a cache) but its selected profile is missing from the source.
  const missing = { ...hydration(SOURCE_EARLY), selectedQualityProfiles: ['Gone Profile'] };
  const first = await trashSuffixes(instanceId, [missing, hydration(SOURCE_A), hydration(SOURCE_B)]);
  assertEquals(first[`Source ${SOURCE_EARLY}`], undefined);
  assertEquals(first[`Source ${SOURCE_A}`], getTrashGuideNamespaceSuffix(1));
  assertEquals(first[`Source ${SOURCE_B}`], getTrashGuideNamespaceSuffix(2));
  assertEquals(persistedIndexes(instanceId), { [SOURCE_A]: 1, [SOURCE_B]: 2 });
});
