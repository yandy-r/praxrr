// End-to-end field-lineage engine tests (issue #231). Uses the real PCD schema in a temp-dir
// PCD (Recipe A): schema/tweaks are file layers; base/user are DB layers stubbed via
// `pcdOpsQueries.listByDatabaseAndOrigin`. `databaseInstancesQueries.getById`,
// `pcdOpHistoryQueries.listLatestByDatabaseWithOps` and `listLatestConflictsByDatabase` are
// object methods, so they are patchable. Proves AC1/AC2/AC3/AC4/AC7.

import { assertEquals } from '@std/assert';
import { resolveEntityLineage } from '$pcd/index.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { ListPcdOpsOptions, PcdOp, PcdOpOrigin } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { PcdOpHistoryStatus, PcdOpHistoryWithOp } from '$db/queries/pcdOpHistory.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { clearSchemaDefaultsCache } from '$pcd/resolved/lineage/schemaDefaults.ts';
import type { FieldLineage } from '$shared/pcd/fieldLineage.ts';
import { logger } from '$logger/logger.ts';

const DATABASE_ID = 77231;
const SCHEMA_FILES = ['0.schema.sql', '1.languages.sql', '2.qualities.sql'] as const;

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

function silenceLogger(restores: Restore[]): void {
  for (const level of ['debug', 'info', 'warn', 'error', 'errorWithTrace'] as const) {
    patchTarget(logger, level, (async () => undefined) as (typeof logger)[typeof level], restores);
  }
}

function makeOp(overrides: Partial<PcdOp> & Pick<PcdOp, 'id' | 'sql'>): PcdOp {
  return {
    database_id: DATABASE_ID,
    origin: 'base',
    state: 'published',
    source: 'repo',
    filename: null,
    op_number: null,
    sequence: overrides.id,
    metadata: null,
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

async function copyRealSchema(pcdPath: string): Promise<void> {
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.mkdir(`${pcdPath}/tweaks`, { recursive: true });
  for (const file of SCHEMA_FILES) {
    const src = new URL(`../../../../../../praxrr-schema/ops/${file}`, import.meta.url);
    await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/${file}`, await Deno.readTextFile(src));
  }
}

interface FixtureConfig {
  baseOps?: PcdOp[];
  userOps?: PcdOp[];
  tweaks?: string;
  history?: Array<{ opId: number; status: PcdOpHistoryStatus }>;
  conflicts?: Array<{ entity: string; name: string }>;
}

interface Fixture {
  run: (
    entityType: Parameters<typeof resolveEntityLineage>[0]['entityType'],
    name: string,
    arrType?: 'radarr' | 'sonarr' | 'lidarr'
  ) => ReturnType<typeof resolveEntityLineage>;
  cleanup: () => Promise<void>;
}

async function setUp(config: FixtureConfig): Promise<Fixture> {
  const restores: Restore[] = [];
  silenceLogger(restores);
  clearSchemaDefaultsCache();

  const pcdPath = await Deno.makeTempDir({ prefix: 'lineage-engine-' });
  await copyRealSchema(pcdPath);
  if (config.tweaks) await Deno.writeTextFile(`${pcdPath}/tweaks/3.tweak.sql`, config.tweaks);

  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) =>
      id === DATABASE_ID
        ? ({ id, local_path: pcdPath, enabled: 1, conflict_strategy: 'override' } as unknown as ReturnType<
            typeof databaseInstancesQueries.getById
          >)
        : undefined) as typeof databaseInstancesQueries.getById,
    restores
  );

  patchTarget(
    pcdOpsQueries,
    'listByDatabaseAndOrigin',
    ((_id: number, origin: PcdOpOrigin, options?: ListPcdOpsOptions): PcdOp[] => {
      const states = options?.states ?? [];
      if (!states.includes('published')) return [];
      if (origin === 'base') return config.baseOps ?? [];
      if (origin === 'user') return config.userOps ?? [];
      return [];
    }) as typeof pcdOpsQueries.listByDatabaseAndOrigin,
    restores
  );

  const historyRows: PcdOpHistoryWithOp[] = (config.history ?? []).map(({ opId, status }) => ({
    history: {
      id: opId,
      op_id: opId,
      database_id: DATABASE_ID,
      batch_id: 'b',
      status,
      rowcount: 1,
      conflict_reason: null,
      error: null,
      details: null,
      applied_at: '2026-01-01 00:00:00',
    },
    op: makeOp({ id: opId, sql: '' }),
  }));
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestByDatabaseWithOps',
    (() => historyRows) as typeof pcdOpHistoryQueries.listLatestByDatabaseWithOps,
    restores
  );

  const conflictRows: PcdOpHistoryWithOp[] = (config.conflicts ?? []).map(({ entity, name }, i) => ({
    history: {
      id: 1000 + i,
      op_id: 1000 + i,
      database_id: DATABASE_ID,
      batch_id: 'b',
      status: 'conflicted_pending' as PcdOpHistoryStatus,
      rowcount: 0,
      conflict_reason: 'guard_mismatch',
      error: null,
      details: null,
      applied_at: '2026-01-01 00:00:00',
    },
    op: makeOp({ id: 1000 + i, sql: '', origin: 'user', metadata: JSON.stringify({ entity, name }) }),
  }));
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    (() => conflictRows) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );

  return {
    run: (entityType, name, arrType) => resolveEntityLineage({ databaseId: DATABASE_ID, entityType, arrType, name }),
    cleanup: async () => {
      await Deno.remove(pcdPath, { recursive: true });
      for (const restore of restores.reverse()) restore();
    },
  };
}

function byPath(lineage: FieldLineage[], path: string): FieldLineage {
  const found = lineage.find((l) => l.fieldPath === path);
  if (!found) throw new Error(`no lineage for path "${path}"; have: ${lineage.map((l) => l.fieldPath).join(', ')}`);
  return found;
}

// ============================================================================
// AC1 + AC2 + AC3 + AC7 — custom format scalar lineage across four sources
// ============================================================================

Deno.test(
  'lineage: explicit base-op value equal to default is distinct from implicit schema-default (AC3/AC7)',
  async () => {
    const fixture = await setUp({
      baseOps: [
        // Explicitly names include_in_rename = 0 (== schema DEFAULT 0).
        makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, include_in_rename) VALUES ('Explicit CF', 0)" }),
        // Omits include_in_rename -> value 0 comes from the schema DEFAULT.
        makeOp({ id: 2, sql: "INSERT INTO custom_formats (name) VALUES ('Implicit CF')" }),
      ],
    });
    try {
      const explicit = await fixture.run('customFormat', 'Explicit CF');
      const explicitField = byPath(explicit.lineage, 'includeInRename');
      assertEquals(explicitField.sourceKind, 'base-op', 'explicit write -> base-op');
      assertEquals(explicitField.explicit, true);
      assertEquals(explicitField.valueEqualsDefault, true, 'value equals default but was explicitly written');
      assertEquals(byPath(explicit.lineage, 'name').sourceKind, 'base-op');
      assertEquals(byPath(explicit.lineage, 'name').sourceLayer, 'base');

      const implicit = await fixture.run('customFormat', 'Implicit CF');
      const implicitField = byPath(implicit.lineage, 'includeInRename');
      assertEquals(implicitField.sourceKind, 'schema-default', 'omitted column -> schema-default');
      assertEquals(implicitField.explicit, false);
      assertEquals(implicitField.opId, null);
      assertEquals(implicitField.opRef?.filename, '0.schema.sql');
      // Same resolved value (0), opposite lineage.
      assertEquals(implicitField.valueEqualsDefault, true);
    } finally {
      await fixture.cleanup();
    }
  }
);

Deno.test(
  'lineage: adding/removing an unrelated user override never changes other fields (AC7 structural)',
  async () => {
    const base = [
      makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, include_in_rename) VALUES ('Explicit CF', 0)" }),
      makeOp({ id: 2, sql: "INSERT INTO custom_formats (name) VALUES ('Implicit CF')" }),
    ];
    const withoutUser = await setUp({ baseOps: base });
    const withUser = await setUp({
      baseOps: base,
      // An UNRELATED user op touching a different entity.
      userOps: [makeOp({ id: 9, origin: 'user', sql: "INSERT INTO custom_formats (name) VALUES ('Unrelated')" })],
    });
    try {
      for (const fixture of [withoutUser, withUser]) {
        const explicit = byPath((await fixture.run('customFormat', 'Explicit CF')).lineage, 'includeInRename');
        assertEquals(explicit.sourceKind, 'base-op', 'base-op field unchanged by presence of unrelated user op');
        const implicit = byPath((await fixture.run('customFormat', 'Implicit CF')).lineage, 'includeInRename');
        assertEquals(
          implicit.sourceKind,
          'schema-default',
          'never promoted to a source by absence-of-user-override reasoning'
        );
      }
    } finally {
      await withoutUser.cleanup();
      await withUser.cleanup();
    }
  }
);

// ============================================================================
// AC2 — four distinct sources (schema-default, base-op, tweaks-op, user-op)
// ============================================================================

Deno.test('lineage: distinguishes schema-default / base-op / tweaks-op / user-op (AC2, last-writer-wins)', async () => {
  const fixture = await setUp({
    baseOps: [makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, description) VALUES ('CF', 'base desc')" })],
    tweaks: "UPDATE custom_formats SET include_in_rename = 1 WHERE name = 'CF';",
    // Kysely-shaped quoted-identifier UPDATE exercises the analyzer's quoted-ident path.
    userOps: [
      makeOp({
        id: 10,
        origin: 'user',
        sql: 'update "custom_formats" set "description" = \'user desc\' where "name" = \'CF\'',
      }),
    ],
  });
  try {
    const { lineage } = await fixture.run('customFormat', 'CF');
    assertEquals(byPath(lineage, 'name').sourceLayer, 'base');
    assertEquals(byPath(lineage, 'includeInRename').sourceKind, 'tweaks-op', 'tweaks UPDATE is the last writer');
    assertEquals(byPath(lineage, 'includeInRename').sourceLayer, 'tweaks');
    const desc = byPath(lineage, 'description');
    assertEquals(desc.sourceKind, 'user-op', 'user UPDATE is the last writer of description');
    assertEquals(desc.opId, 10);
  } finally {
    await fixture.cleanup();
  }
});

// ============================================================================
// AC4 — dropped / skipped / conflicted / pending never get false lineage
// ============================================================================

Deno.test('lineage: a skipped establishing op is excluded and re-resolves to the prior writer (AC4)', async () => {
  const fixture = await setUp({
    baseOps: [makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, description) VALUES ('CF', 'base desc')" })],
    userOps: [
      makeOp({
        id: 10,
        origin: 'user',
        sql: 'update "custom_formats" set "description" = \'user desc\' where "name" = \'CF\'',
      }),
    ],
    // The live value-guard build skipped the user op; buildReadOnly replays it, but lineage must exclude it.
    history: [{ opId: 10, status: 'skipped' }],
  });
  try {
    const desc = byPath((await fixture.run('customFormat', 'CF')).lineage, 'description');
    assertEquals(desc.sourceKind, 'base-op', 'skipped user op excluded -> prior base writer surfaces');
    assertEquals(desc.opId, 1);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test('lineage: a conflicted establishing op yields ambiguous, not a confident source (AC4)', async () => {
  const fixture = await setUp({
    baseOps: [makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, description) VALUES ('CF', 'base desc')" })],
    userOps: [
      makeOp({
        id: 10,
        origin: 'user',
        sql: 'update "custom_formats" set "description" = \'user desc\' where "name" = \'CF\'',
      }),
    ],
    history: [{ opId: 10, status: 'conflicted' }],
  });
  try {
    const desc = byPath((await fixture.run('customFormat', 'CF')).lineage, 'description');
    assertEquals(desc.status, 'ambiguous');
    assertEquals(desc.sourceKind, 'ambiguous');
  } finally {
    await fixture.cleanup();
  }
});

Deno.test('lineage: a pending value-guard conflict forces every field ambiguous (AC4 / Business Rule 6)', async () => {
  const fixture = await setUp({
    baseOps: [makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, include_in_rename) VALUES ('CF', 0)" })],
    conflicts: [{ entity: 'custom_format', name: 'CF' }],
  });
  try {
    const { lineage, lineageStatus } = await fixture.run('customFormat', 'CF');
    assertEquals(lineageStatus, 'ambiguous');
    for (const field of lineage) {
      assertEquals(field.status, 'ambiguous', `field ${field.fieldPath} must be ambiguous under a pending conflict`);
    }
  } finally {
    await fixture.cleanup();
  }
});

// ============================================================================
// Nested lists + user-created entity
// ============================================================================

Deno.test('lineage: nested custom-format condition fields are attributed (AC1 nested lists)', async () => {
  const fixture = await setUp({
    baseOps: [
      makeOp({ id: 1, sql: "INSERT INTO custom_formats (name) VALUES ('CF')" }),
      makeOp({
        id: 2,
        sql: "INSERT INTO custom_format_conditions (custom_format_name, name, type, negate) VALUES ('CF', 'Is Bluray', 'source', 1)",
      }),
      makeOp({
        id: 3,
        sql: "INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('CF', 'Is Bluray', 'bluray')",
      }),
    ],
  });
  try {
    const { lineage } = await fixture.run('customFormat', 'CF');
    assertEquals(byPath(lineage, 'conditions["Is Bluray"].negate').sourceKind, 'base-op');
    assertEquals(byPath(lineage, 'conditions["Is Bluray"].sources[0]').sourceKind, 'base-op');
    assertEquals(byPath(lineage, 'conditions["Is Bluray"].sources[0]').sourceLayer, 'base');
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  'lineage: a user-created entity attributes all fields to user-op or schema-default (AC6 user-created)',
  async () => {
    const fixture = await setUp({
      userOps: [
        makeOp({
          id: 5,
          origin: 'user',
          sql: "INSERT INTO custom_formats (name, description) VALUES ('User CF', 'mine')",
        }),
      ],
    });
    try {
      const { lineage } = await fixture.run('customFormat', 'User CF');
      assertEquals(byPath(lineage, 'name').sourceKind, 'user-op');
      assertEquals(byPath(lineage, 'description').sourceKind, 'user-op');
      assertEquals(
        byPath(lineage, 'includeInRename').sourceKind,
        'schema-default',
        'unset column is schema-default even on a user-created entity'
      );
    } finally {
      await fixture.cleanup();
    }
  }
);

Deno.test('lineage: a key-column rename keeps prior-writer attribution on the renamed entity (AC1/AC4)', async () => {
  const fixture = await setUp({
    baseOps: [makeOp({ id: 1, sql: "INSERT INTO custom_formats (name, include_in_rename) VALUES ('Old CF', 0)" })],
    // Rename the key column: the business key changes from 'Old CF' to 'New CF'.
    userOps: [
      makeOp({
        id: 10,
        origin: 'user',
        sql: 'update "custom_formats" set "name" = \'New CF\' where "name" = \'Old CF\'',
      }),
    ],
  });
  try {
    const { lineage } = await fixture.run('customFormat', 'New CF');
    // The rename op established the name.
    const name = byPath(lineage, 'name');
    assertEquals(name.sourceKind, 'user-op');
    assertEquals(name.opId, 10);
    // A column written BEFORE the rename must still resolve to its original base op (its cell was
    // migrated to the new key) — never orphaned to unavailable/schema-default.
    const include = byPath(lineage, 'includeInRename');
    assertEquals(include.sourceKind, 'base-op');
    assertEquals(include.opId, 1);
  } finally {
    await fixture.cleanup();
  }
});

// ============================================================================
// AC6 — end-to-end resolution for a per-Arr family (naming) and the metadata profile
// (whose child tables use divergent type_id / status_id business keys).
// ============================================================================

Deno.test('lineage: per-Arr radarr naming resolves scalar leaves end-to-end (AC6 arr mapping)', async () => {
  const fixture = await setUp({
    baseOps: [
      makeOp({
        id: 1,
        sql: "INSERT INTO radarr_naming (name, movie_format, movie_folder_format) VALUES ('R', 'fmt', 'folder')",
      }),
    ],
  });
  try {
    const { lineage } = await fixture.run('naming', 'R', 'radarr');
    assertEquals(byPath(lineage, 'movieFormat').sourceKind, 'base-op');
    // colon_replacement_format was not written -> its DEFAULT 'smart' surfaces as schema-default.
    assertEquals(byPath(lineage, 'colonReplacementFormat').sourceKind, 'schema-default');
  } finally {
    await fixture.cleanup();
  }
});

Deno.test(
  'lineage: lidarr metadata profile resolves nested type/status arrays end-to-end (AC6 nested + key divergence)',
  async () => {
    const fixture = await setUp({
      baseOps: [
        makeOp({ id: 1, sql: "INSERT INTO lidarr_metadata_profiles (name, description) VALUES ('MP', 'd')" }),
        makeOp({
          id: 2,
          sql: "INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed) VALUES ('MP', 0, 'Album', 1)",
        }),
        makeOp({
          id: 3,
          sql: "INSERT INTO lidarr_metadata_profile_release_statuses (metadata_profile_name, status_id, name, allowed) VALUES ('MP', 0, 'Official', 1)",
        }),
      ],
    });
    try {
      const { lineage } = await fixture.run('lidarrMetadataProfile', 'MP', 'lidarr');
      assertEquals(byPath(lineage, 'name').sourceKind, 'base-op');
      // type_id-keyed child table.
      assertEquals(byPath(lineage, 'primaryTypes["Album"].allowed').sourceKind, 'base-op');
      // status_id-keyed child table (the divergent key) resolves its backing row too.
      assertEquals(byPath(lineage, 'releaseStatuses["Official"].allowed').sourceKind, 'base-op');
    } finally {
      await fixture.cleanup();
    }
  }
);
