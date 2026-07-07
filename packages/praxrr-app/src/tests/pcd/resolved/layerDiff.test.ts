// The first section is pure -- no I/O, no PCDCache, no database. `computeUserOverrides`
// is a thin, synchronous wrapper around `diffToFieldChanges` with Portable-field-named
// array-key strategies, so those tests exercise it directly against synthetic
// Portable-shaped objects, mirroring `tests/base/syncPreviewDiff.test.ts`'s style.
//
// The later sections (`readEntityOrNull`, `buildPendingConflictIndex`) DO use a real
// in-memory PCDCache fixture (mirrors `readers.test.ts`'s recipe) and a patched
// `pcdOpHistoryQueries.listLatestConflictsByDatabase` (mirrors `equivalence.test.ts`'s
// patch-and-restore idiom) -- they cover the CONFIRMED not-found-masking and O(n)-query
// fixes, which cannot be exercised without a real cache/query surface.

import { assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type {
  PortableCustomFormat,
  PortableDelayProfile,
  PortableLidarrMetadataProfile,
  PortableQualityDefinitions,
  PortableQualityProfile,
} from '$shared/pcd/portable.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PcdOpHistoryWithOp } from '$db/queries/pcdOpHistory.ts';
import { ResolvedConfigValidationError } from '$pcd/resolved/readers.ts';
import {
  buildPendingConflictIndex,
  computeHasPendingConflict,
  computeUserOverrides,
  PORTABLE_ARRAY_KEY_STRATEGIES,
  readEntityOrNull,
} from '$pcd/resolved/layerDiff.ts';

function buildQualityProfile(overrides: Partial<PortableQualityProfile> = {}): PortableQualityProfile {
  return {
    name: 'HD-1080p',
    description: null,
    tags: [],
    language: null,
    orderedItems: [
      { type: 'quality', name: 'Bluray-1080p', position: 0, enabled: true, upgradeUntil: false },
      { type: 'quality', name: 'WEBDL-1080p', position: 1, enabled: true, upgradeUntil: false },
      {
        type: 'group',
        name: 'WEB 720p',
        position: 2,
        enabled: true,
        upgradeUntil: false,
        members: [{ name: 'WEBDL-720p' }],
      },
    ],
    minimumScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    customFormatScores: [
      { customFormatName: 'x264', arrType: 'radarr', score: 10 },
      { customFormatName: 'HDR', arrType: 'radarr', score: 20 },
    ],
    ...overrides,
  };
}

function buildCustomFormat(overrides: Partial<PortableCustomFormat> = {}): PortableCustomFormat {
  return {
    name: 'HDR10',
    description: null,
    includeInRename: false,
    tags: [],
    conditions: [
      { name: 'HDR10 Source', type: 'source', arrType: 'radarr', negate: false, required: true, sources: ['hdr10'] },
      {
        name: 'x265 Codec',
        type: 'release_group',
        arrType: 'radarr',
        negate: false,
        required: true,
        patterns: [{ name: 'p', pattern: 'x265' }],
      },
    ],
    tests: [
      { title: 'Matches HDR10 release', type: 'movie', shouldMatch: true, description: null },
      { title: 'Rejects SDR release', type: 'movie', shouldMatch: false, description: null },
    ],
    ...overrides,
  };
}

function buildQualityDefinitions(overrides: Partial<PortableQualityDefinitions> = {}): PortableQualityDefinitions {
  return {
    name: 'radarr-quality-definitions',
    entries: [
      { quality_name: 'Bluray-1080p', min_size: 10, max_size: 100, preferred_size: 50 },
      { quality_name: 'WEBDL-1080p', min_size: 5, max_size: 80, preferred_size: 40 },
    ],
    ...overrides,
  };
}

function buildMetadataProfile(overrides: Partial<PortableLidarrMetadataProfile> = {}): PortableLidarrMetadataProfile {
  return {
    name: 'Standard',
    description: null,
    primaryTypes: [
      { id: 1, name: 'Album', allowed: true },
      { id: 2, name: 'EP', allowed: true },
    ],
    secondaryTypes: [
      { id: 10, name: 'Live', allowed: false },
      { id: 11, name: 'Remix', allowed: true },
    ],
    releaseStatuses: [
      { id: 20, name: 'Official', allowed: true },
      { id: 21, name: 'Bootleg', allowed: false },
    ],
    ...overrides,
  };
}

function buildDelayProfile(overrides: Partial<PortableDelayProfile> = {}): PortableDelayProfile {
  return {
    name: 'Default',
    preferredProtocol: 'prefer_usenet',
    usenetDelay: 0,
    torrentDelay: 0,
    bypassIfHighestQuality: true,
    bypassIfAboveCfScore: false,
    minimumCfScore: 0,
    ...overrides,
  };
}

// ============================================================================
// PORTABLE_ARRAY_KEY_STRATEGIES SHAPE
// ============================================================================

Deno.test('PORTABLE_ARRAY_KEY_STRATEGIES covers the Portable-shaped nested object arrays', () => {
  const paths = PORTABLE_ARRAY_KEY_STRATEGIES.map((strategy) => strategy.path).sort();

  assertEquals(paths, [
    'conditions',
    'customFormatScores',
    'entries',
    'orderedItems',
    'primaryTypes',
    'releaseStatuses',
    'secondaryTypes',
    'tests',
  ]);
});

// ============================================================================
// ARRAY REORDER -> NO CHANGES
// ============================================================================

Deno.test('computeUserOverrides: reordering orderedItems produces no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({ orderedItems: [...base.orderedItems].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering customFormatScores produces no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({ customFormatScores: [...base.customFormatScores].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering custom format conditions and tests produces no changes', () => {
  const base = buildCustomFormat();
  const resolved = buildCustomFormat({
    conditions: [...base.conditions].reverse(),
    tests: [...base.tests].reverse(),
  });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering quality definition entries produces no changes', () => {
  const base = buildQualityDefinitions();
  const resolved = buildQualityDefinitions({ entries: [...base.entries].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering metadata profile type arrays produces no changes', () => {
  const base = buildMetadataProfile();
  const resolved = buildMetadataProfile({
    primaryTypes: [...base.primaryTypes].reverse(),
    secondaryTypes: [...base.secondaryTypes].reverse(),
    releaseStatuses: [...base.releaseStatuses].reverse(),
  });

  assertEquals(computeUserOverrides(base, resolved), []);
});

// ============================================================================
// VALUE CHANGE -> 'changed' FIELDCHANGE
// ============================================================================

Deno.test("computeUserOverrides: a scalar value change produces a 'changed' FieldChange", () => {
  const base = buildQualityProfile({ minimumScore: 0 });
  const resolved = buildQualityProfile({ minimumScore: 5 });

  assertEquals(computeUserOverrides(base, resolved), [
    { field: 'minimumScore', type: 'changed', current: 0, desired: 5 },
  ]);
});

Deno.test("computeUserOverrides: a keyed array item's field change still reports as 'changed'", () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({
    customFormatScores: [{ customFormatName: 'x264', arrType: 'radarr', score: 99 }, base.customFormatScores[1]],
  });

  assertEquals(computeUserOverrides(base, resolved), [
    { field: 'customFormatScores["x264:radarr"].score', type: 'changed', current: 10, desired: 99 },
  ]);
});

// ============================================================================
// BASE-ABSENT (undefined/null) -> 'added' CHANGES
// ============================================================================

Deno.test(
  "computeUserOverrides: a null base produces 'added' changes for every resolved field (user-created entity)",
  () => {
    const resolved = buildDelayProfile();

    const changes = computeUserOverrides(null, resolved);

    assertEquals(changes.length > 0, true);
    assertEquals(
      changes.every((change) => change.type === 'added'),
      true
    );
    assertEquals(
      changes.find((change) => change.field === 'name'),
      {
        field: 'name',
        type: 'added',
        current: null,
        desired: 'Default',
      }
    );
  }
);

Deno.test("computeUserOverrides: a null resolved entity produces 'removed' changes for every base field", () => {
  const base = buildDelayProfile();

  const changes = computeUserOverrides(base, null);

  assertEquals(changes.length > 0, true);
  assertEquals(
    changes.every((change) => change.type === 'removed'),
    true
  );
});

Deno.test('computeUserOverrides: identical base and resolved entities produce no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile();

  assertEquals(computeUserOverrides(base, resolved), []);
});

// ============================================================================
// readEntityOrNull -- typed not-found error handling (CONFIRMED masking-bug fix)
// ============================================================================

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

// Complete schema (mirrors readers.test.ts's fixture) -- a present row round-trips
// through both of serializeRegularExpression's queries without error.
const COMPLETE_SCHEMA_SQL = `
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

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);
`;

// Deliberately omits `tags`/`regular_expression_tags` -- serializeRegularExpression's
// tag lookup will throw a genuine "no such table" SQL error for a PRESENT row. This is
// NOT a by-name miss (does not match `isReaderNotFoundMessage`'s shape) and must
// propagate, not be swallowed as null.
const SCHEMA_MISSING_TAGS_TABLE_SQL = `
CREATE TABLE regular_expressions (
  name TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  regex101_id TEXT
);

INSERT INTO regular_expressions (name, pattern, description, regex101_id) VALUES
  ('Sample RE', '.*sample.*', 'A sample regular expression', NULL);
`;

Deno.test('readEntityOrNull returns null for a genuine by-name miss', async () => {
  const fixture = createCacheFixture(COMPLETE_SCHEMA_SQL);
  try {
    const result = await readEntityOrNull(fixture.cache, 'regularExpression', undefined, 'Does Not Exist');
    assertEquals(result, null);
  } finally {
    await fixture.destroy();
  }
});

Deno.test(
  'readEntityOrNull rethrows a genuine cache failure instead of masking it as absence (CONFIRMED fix)',
  async () => {
    const fixture = createCacheFixture(SCHEMA_MISSING_TAGS_TABLE_SQL);
    try {
      await assertRejects(() => readEntityOrNull(fixture.cache, 'regularExpression', undefined, 'Sample RE'), Error);
    } finally {
      await fixture.destroy();
    }
  }
);

Deno.test(
  'readEntityOrNull rethrows ResolvedConfigValidationError (caller-input problems are not absence)',
  async () => {
    const fixture = createCacheFixture(COMPLETE_SCHEMA_SQL);
    try {
      await assertRejects(
        () => readEntityOrNull(fixture.cache, 'naming', undefined, 'Default'),
        ResolvedConfigValidationError
      );
    } finally {
      await fixture.destroy();
    }
  }
);

// ============================================================================
// buildPendingConflictIndex / computeHasPendingConflict parity (perf fix, CONFIRMED)
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

function buildConflictRow(entity: string, name: string): PcdOpHistoryWithOp {
  return {
    history: {
      id: 1,
      op_id: 1,
      database_id: 1,
      batch_id: 'batch-1',
      status: 'conflicted',
      rowcount: null,
      conflict_reason: 'diverged',
      error: null,
      details: null,
      applied_at: '2026-01-01 00:00:00',
    },
    op: {
      id: 1,
      database_id: 1,
      origin: 'user',
      state: 'published',
      source: 'local',
      filename: null,
      op_number: null,
      sequence: null,
      sql: '',
      metadata: JSON.stringify({ entity, name }),
      desired_state: null,
      content_hash: null,
      last_seen_in_repo_at: null,
      superseded_by_op_id: null,
      pushed_at: null,
      pushed_commit: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
    },
  };
}

Deno.test('buildPendingConflictIndex lookup matches computeHasPendingConflict for the same inputs', () => {
  const restores: Restore[] = [];
  let queryCalls = 0;

  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    ((_databaseId: number) => {
      queryCalls += 1;
      return [buildConflictRow('custom_format', 'HDR10')];
    }) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );

  try {
    const lookup = buildPendingConflictIndex(1);
    assertEquals(queryCalls, 1, 'buildPendingConflictIndex must query exactly once');

    // Matching (entityType, arrType, name) -> true on both the index lookup and the
    // per-call wrapper.
    assertEquals(lookup('customFormat', undefined, 'HDR10'), true);
    assertEquals(computeHasPendingConflict(1, 'customFormat', undefined, 'HDR10'), true);

    // Non-matching name -> false on both.
    assertEquals(lookup('customFormat', undefined, 'Other'), false);
    assertEquals(computeHasPendingConflict(1, 'customFormat', undefined, 'Other'), false);

    // Unmapped (entityType, arrType) combination -> false on both (defensive, not a throw).
    assertEquals(lookup('lidarrMetadataProfile', 'radarr', 'HDR10'), false);
    assertEquals(computeHasPendingConflict(1, 'lidarrMetadataProfile', 'radarr', 'HDR10'), false);

    // The index itself must not re-query on repeated lookups -- only the three
    // computeHasPendingConflict calls above (each a fresh per-call index build) added
    // to queryCalls beyond the first.
    assertEquals(queryCalls, 4);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

Deno.test('buildPendingConflictIndex: unparsable op metadata is uncorrelated, not a throw', () => {
  const restores: Restore[] = [];

  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    ((_databaseId: number) => {
      const row = buildConflictRow('custom_format', 'HDR10');
      return [{ ...row, op: { ...row.op, metadata: 'not-json' } }];
    }) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );

  try {
    const lookup = buildPendingConflictIndex(1);
    assertEquals(lookup('customFormat', undefined, 'HDR10'), false);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
