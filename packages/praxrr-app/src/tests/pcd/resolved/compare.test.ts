import { assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import type { LiveDiffResult } from '$pcd/resolved/liveDiff.ts';
import { compareAcrossInstances, type CompareDeps } from '$pcd/resolved/compare.ts';

// Mirrors readers.test.ts's fixture recipe: an in-memory PCDCache built from
// hand-written CREATE TABLE/INSERT statements covering only the tables the compared
// entity types touch. `compareAcrossInstances` reads desired payloads straight from
// `cache.kb` (via readResolvedEntity), so a real fixture is used instead of stubbing
// readResolvedEntity -- only `computeLiveDiff`/`registerPreviewCreateAttempt` (bare
// named function exports, unpatchable ESM bindings) are injected via `deps`.
interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

const SCHEMA_AND_DATA_SQL = `
CREATE TABLE regular_expressions (
  name TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  regex101_id TEXT
);

CREATE TABLE tags (
  name TEXT PRIMARY KEY
);

CREATE TABLE regular_expression_tags (
  regular_expression_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (regular_expression_name, tag_name)
);

CREATE TABLE radarr_naming (
  name TEXT PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  movie_format TEXT NOT NULL,
  movie_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format TEXT NOT NULL DEFAULT 'smart',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sonarr_naming (
  name TEXT PRIMARY KEY,
  rename INTEGER NOT NULL DEFAULT 1,
  standard_episode_format TEXT NOT NULL,
  daily_episode_format TEXT NOT NULL,
  anime_episode_format TEXT NOT NULL,
  series_folder_format TEXT NOT NULL,
  season_folder_format TEXT NOT NULL,
  replace_illegal_characters INTEGER NOT NULL DEFAULT 1,
  colon_replacement_format INTEGER NOT NULL DEFAULT 4,
  custom_colon_replacement_format TEXT,
  multi_episode_style INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lidarr_metadata_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lidarr_metadata_profile_primary_types (
  metadata_profile_name TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metadata_profile_name, type_id)
);

CREATE TABLE lidarr_metadata_profile_secondary_types (
  metadata_profile_name TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metadata_profile_name, type_id)
);

CREATE TABLE lidarr_metadata_profile_release_statuses (
  metadata_profile_name TEXT NOT NULL,
  status_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metadata_profile_name, status_id)
);

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);

INSERT INTO radarr_naming (name, movie_format, movie_folder_format, replace_illegal_characters, colon_replacement_format) VALUES
  ('Default', '{Movie Title} ({Release Year})', '{Movie Title} ({Release Year})', 1, 'smart');

INSERT INTO sonarr_naming (
  name, standard_episode_format, daily_episode_format, anime_episode_format,
  series_folder_format, season_folder_format, replace_illegal_characters, colon_replacement_format
) VALUES (
  'Default', '{Series Title} - S{season:00}E{episode:00}', '{Series Title} - {Air-Date}',
  '{Series Title} - {season:00}x{episode:00}', '{Series Title}', 'Season {season:00}', 1, 4
);

INSERT INTO lidarr_metadata_profiles (name, description) VALUES ('Standard', 'Standard profile');
INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed) VALUES
  ('Standard', 1, 'Album', 1);
INSERT INTO lidarr_metadata_profile_secondary_types (metadata_profile_name, type_id, name, allowed) VALUES
  ('Standard', 10, 'Live', 0);
INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed) VALUES
  ('Standard', 20, 'Official', 1);
`;

function withFixture(fn: (cache: PCDCache) => Promise<void>): Promise<void> {
  const fixture = createCacheFixture(SCHEMA_AND_DATA_SQL);
  return fn(fixture.cache).finally(fixture.destroy);
}

// ============================================================================
// TEST HELPERS
// ============================================================================

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function patchLoggerForTest(restores: Restore[]): void {
  patchTarget(logger, 'error', (async () => undefined) as typeof logger.error, restores);
}

let nextInstanceId = 1;

function buildInstance(overrides: Partial<ArrInstance> = {}): ArrInstance {
  const id = overrides.id ?? nextInstanceId++;
  return {
    id,
    name: `Instance ${id}`,
    type: 'radarr',
    url: 'http://localhost:7878',
    external_url: null,
    api_key_fingerprint: null,
    api_key: '',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function buildEntityChange(overrides: Partial<EntityChange> = {}): EntityChange {
  return {
    entityType: 'qualityProfile',
    name: 'Profile A',
    action: 'unchanged',
    remoteId: 10,
    fields: [],
    ...overrides,
  };
}

/** Deps whose `computeLiveDiff`/`registerPreviewCreateAttempt` fail the test if invoked. */
function neverCalledDeps(): CompareDeps {
  return {
    computeLiveDiff: () => {
      throw new Error('computeLiveDiff should not have been called');
    },
    registerPreviewCreateAttempt: () => {
      throw new Error('registerPreviewCreateAttempt should not have been called');
    },
  };
}

// ============================================================================
// ARR_TYPE / ENTITY-TYPE COMPATIBILITY GATING
// ============================================================================

Deno.test(
  'compareAcrossInstances: mixed radarr/sonarr/lidarr instances comparing lidarrMetadataProfile -- only lidarr is compatible',
  async () => {
    await withFixture(async (cache) => {
      const radarr = buildInstance({ type: 'radarr' });
      const sonarr = buildInstance({ type: 'sonarr' });
      const lidarr = buildInstance({ type: 'lidarr' });

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'lidarrMetadataProfile',
        name: 'Standard',
        instances: [radarr, sonarr, lidarr],
        includeLive: false,
        deps: neverCalledDeps(),
      });

      assertEquals(result.instances.length, 3);

      const [radarrResult, sonarrResult, lidarrResult] = result.instances;
      assertEquals(radarrResult.compatible, false);
      assertEquals(radarrResult.error, 'unsupported');
      assertEquals(radarrResult.desired, null);

      assertEquals(sonarrResult.compatible, false);
      assertEquals(sonarrResult.error, 'unsupported');
      assertEquals(sonarrResult.desired, null);

      assertEquals(lidarrResult.compatible, true);
      assertEquals(lidarrResult.present, true);
      assertEquals(lidarrResult.error, null);
      assertEquals((lidarrResult.desired as { name: string }).name, 'Standard');

      // Only the compatible instance gets a diff row (against itself as baseline).
      assertEquals(result.diffs.length, 1);
      assertEquals(result.diffs[0].instanceId, lidarr.id);
      assertEquals(result.diffs[0].changes, [
        { entityType: 'lidarrMetadataProfile', name: 'Standard', action: 'unchanged', remoteId: null, fields: [] },
      ]);
    });
  }
);

Deno.test('compareAcrossInstances: an unrecognized arr_type is marked incompatible, not unsupported', async () => {
  await withFixture(async (cache) => {
    const unknown = buildInstance({ type: 'plex' });

    const result = await compareAcrossInstances({
      cache,
      databaseId: 1,
      entityType: 'regularExpression',
      name: 'Sample RE',
      instances: [unknown],
      includeLive: false,
      deps: neverCalledDeps(),
    });

    assertEquals(result.instances, [
      {
        instanceId: unknown.id,
        instanceName: unknown.name,
        arrType: null,
        rawArrType: 'plex',
        compatible: false,
        present: false,
        desired: null,
        actual: null,
        error: 'incompatible',
      },
    ]);
    assertEquals(result.diffs, []);
  });
});

Deno.test(
  'compareAcrossInstances: regularExpression (no sync section) is still compatible via reader support alone',
  async () => {
    await withFixture(async (cache) => {
      const radarr = buildInstance({ type: 'radarr' });
      const sonarr = buildInstance({ type: 'sonarr' });
      const lidarr = buildInstance({ type: 'lidarr' });

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'regularExpression',
        name: 'Sample RE',
        instances: [radarr, sonarr, lidarr],
        includeLive: false,
        deps: neverCalledDeps(),
      });

      for (const instanceResult of result.instances) {
        assertEquals(instanceResult.compatible, true);
        assertEquals(instanceResult.present, true);
        assertEquals(instanceResult.error, null);
      }

      // All three share the single arr-agnostic desired read -- every diff row is empty.
      assertEquals(result.diffs.length, 3);
      for (const diff of result.diffs) {
        assertEquals(diff.changes[0].fields, []);
        assertEquals(diff.changes[0].action, 'unchanged');
      }
    });
  }
);

Deno.test('compareAcrossInstances: a compatible instance with a missing entity reports not_found', async () => {
  await withFixture(async (cache) => {
    const lidarr = buildInstance({ type: 'lidarr' });

    const result = await compareAcrossInstances({
      cache,
      databaseId: 1,
      entityType: 'lidarrMetadataProfile',
      name: 'Does Not Exist',
      instances: [lidarr],
      includeLive: false,
      deps: neverCalledDeps(),
    });

    assertEquals(result.instances, [
      {
        instanceId: lidarr.id,
        instanceName: lidarr.name,
        arrType: 'lidarr',
        compatible: true,
        present: false,
        desired: null,
        actual: null,
        error: 'not_found',
      },
    ]);
    assertEquals(result.diffs, []);
  });
});

// ============================================================================
// includeLive BEHAVIOR
// ============================================================================

Deno.test('compareAcrossInstances: desired-only mode (includeLive=false) performs zero live calls', async () => {
  await withFixture(async (cache) => {
    const radarrOne = buildInstance({ type: 'radarr' });
    const radarrTwo = buildInstance({ type: 'radarr' });

    const result = await compareAcrossInstances({
      cache,
      databaseId: 1,
      entityType: 'naming',
      name: 'Default',
      instances: [radarrOne, radarrTwo],
      includeLive: false,
      deps: neverCalledDeps(),
    });

    for (const instanceResult of result.instances) {
      assertEquals(instanceResult.actual, null);
      assertEquals(instanceResult.error, null);
    }
  });
});

Deno.test(
  'compareAcrossInstances: one instance live-fetch failing reports a reason status while others succeed',
  async () => {
    await withFixture(async (cache) => {
      const succeeding = buildInstance({ type: 'radarr' });
      const failing = buildInstance({ type: 'radarr' });

      const succeedingChange = buildEntityChange({ entityType: 'naming', name: 'Default' });

      let registerCalls = 0;
      let computeCalls = 0;

      const deps: CompareDeps = {
        registerPreviewCreateAttempt: () => {
          registerCalls += 1;
          return true;
        },
        computeLiveDiff: (liveInput): Promise<LiveDiffResult> => {
          computeCalls += 1;
          if (liveInput.instance.id === succeeding.id) {
            return Promise.resolve({ found: true, change: succeedingChange });
          }
          return Promise.resolve({ found: false, reason: 'unreachable' });
        },
      };

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'naming',
        name: 'Default',
        instances: [succeeding, failing],
        includeLive: true,
        nowMs: 1000,
        deps,
      });

      assertEquals(registerCalls, 2);
      assertEquals(computeCalls, 2);

      const succeedingResult = result.instances.find((instanceResult) => instanceResult.instanceId === succeeding.id);
      const failingResult = result.instances.find((instanceResult) => instanceResult.instanceId === failing.id);

      assertEquals(succeedingResult?.error, null);
      assertEquals(succeedingResult?.actual, succeedingChange);

      assertEquals(failingResult?.error, 'unreachable');
      assertEquals(failingResult?.actual, null);
      // A failed live fetch does not affect the instance's own compatible/present/desired status.
      assertEquals(failingResult?.compatible, true);
      assertEquals(failingResult?.present, true);
    });
  }
);

Deno.test(
  'compareAcrossInstances: registerPreviewCreateAttempt returning false reports rate-limited without calling computeLiveDiff',
  async () => {
    await withFixture(async (cache) => {
      const radarr = buildInstance({ type: 'radarr' });
      let computeCalls = 0;

      const deps: CompareDeps = {
        registerPreviewCreateAttempt: () => false,
        computeLiveDiff: () => {
          computeCalls += 1;
          throw new Error('computeLiveDiff should not have been called when rate-limited');
        },
      };

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'naming',
        name: 'Default',
        instances: [radarr],
        includeLive: true,
        nowMs: 1000,
        deps,
      });

      assertEquals(computeCalls, 0);
      assertEquals(result.instances[0].error, 'rate-limited');
      assertEquals(result.instances[0].actual, null);
    });
  }
);

Deno.test(
  'compareAcrossInstances: an unexpected computeLiveDiff exception is sanitized to error and logged, not thrown',
  async () => {
    const restores: Restore[] = [];
    patchLoggerForTest(restores);
    try {
      await withFixture(async (cache) => {
        const radarr = buildInstance({ type: 'radarr' });

        const deps: CompareDeps = {
          registerPreviewCreateAttempt: () => true,
          computeLiveDiff: () => {
            throw new Error('connect ETIMEDOUT 10.0.0.5:7878');
          },
        };

        const result = await compareAcrossInstances({
          cache,
          databaseId: 1,
          entityType: 'naming',
          name: 'Default',
          instances: [radarr],
          includeLive: true,
          nowMs: 1000,
          deps,
        });

        assertEquals(result.instances[0].error, 'error');
        assertEquals(result.instances[0].actual, null);
        // The instance's own desired-read status is unaffected by the live-fetch failure.
        assertEquals(result.instances[0].compatible, true);
        assertEquals(result.instances[0].present, true);
      });
    } finally {
      restores.forEach((restore) => restore());
    }
  }
);

// ============================================================================
// PAIRWISE DIFF CORRECTNESS
// ============================================================================

Deno.test(
  'compareAcrossInstances: two same-arr instances produce an empty (unchanged) diff for identical desired state',
  async () => {
    await withFixture(async (cache) => {
      const radarrOne = buildInstance({ type: 'radarr' });
      const radarrTwo = buildInstance({ type: 'radarr' });

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'naming',
        name: 'Default',
        instances: [radarrOne, radarrTwo],
        includeLive: false,
        deps: neverCalledDeps(),
      });

      assertEquals(result.diffs.length, 2);
      for (const diff of result.diffs) {
        assertEquals(diff.changes.length, 1);
        assertEquals(diff.changes[0].action, 'unchanged');
        assertEquals(diff.changes[0].fields, []);
      }
    });
  }
);

Deno.test(
  'compareAcrossInstances: diffs a genuinely different per-arr desired payload (radarr vs sonarr naming) with correct field changes',
  async () => {
    await withFixture(async (cache) => {
      const radarr = buildInstance({ type: 'radarr' });
      const sonarr = buildInstance({ type: 'sonarr' });

      const result = await compareAcrossInstances({
        cache,
        databaseId: 1,
        entityType: 'naming',
        name: 'Default',
        instances: [radarr, sonarr],
        includeLive: false,
        deps: neverCalledDeps(),
      });

      assertEquals(result.diffs.length, 2);

      const radarrDiff = result.diffs.find((diff) => diff.instanceId === radarr.id);
      const sonarrDiff = result.diffs.find((diff) => diff.instanceId === sonarr.id);

      // The baseline (first compatible instance, radarr) diffed against itself is empty.
      assertEquals(radarrDiff?.changes[0].action, 'unchanged');
      assertEquals(radarrDiff?.changes[0].fields, []);

      // Sonarr's Portable shape has entirely different fields from radarr's -- the diff
      // must surface both the radarr-only fields as 'removed' and the sonarr-only fields
      // as 'added'.
      const sonarrFields = sonarrDiff?.changes[0].fields ?? [];
      assertEquals(sonarrDiff?.changes[0].action, 'update');
      assertEquals(
        sonarrFields.some((field) => field.field === 'movieFormat' && field.type === 'removed'),
        true
      );
      assertEquals(
        sonarrFields.some((field) => field.field === 'standardEpisodeFormat' && field.type === 'added'),
        true
      );
    });
  }
);
