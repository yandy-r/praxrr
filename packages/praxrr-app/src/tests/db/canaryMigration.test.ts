import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { migration as createCanaryTablesMigration } from '$db/migrations/20260715_create_canary_tables.ts';
import { migration as addCanaryPreviewEvidenceMigration } from '$db/migrations/20260722_add_canary_preview_evidence.ts';
import { loadMigrations, runMigrations } from '$db/migrations.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so migration 20260715 creates the canary tables
 * and seeds the settings singleton in its real context), invoke the test body,
 * then tear the connection down. Mirrors syncHistoryQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-migration-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function tableNames(): Set<string> {
  const rows = db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((row) => row.name));
}

function indexNames(): Set<string> {
  const rows = db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'");
  return new Set(rows.map((row) => row.name));
}

// ---------------------------------------------------------------------------
// up: table shape
// ---------------------------------------------------------------------------

migratedTest('up registers every canary_rollouts column via PRAGMA table_info', () => {
  const columns = db.query<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>('PRAGMA table_info(canary_rollouts)');
  const byName = new Map(columns.map((c) => [c.name, c]));

  const expected = [
    'id',
    'arr_type',
    'status',
    'canary_instance_id',
    'canary_instance_name',
    'canary_status',
    'canary_sync_history_id',
    'sections',
    'max_batch_size',
    'partial_policy',
    'canary_output',
    'canary_error',
    'remaining_targets',
    'batch_cursor',
    'rollout_results',
    'trigger',
    'started_at',
    'finished_at',
    'state_token',
    'remaining_preview_evidence',
    'created_at',
    'updated_at',
  ];
  for (const name of expected) {
    assert(byName.has(name), `expected canary_rollouts to have column ${name}`);
  }
  assertEquals(byName.size, expected.length);

  // NOT NULL columns per the migration.
  assertEquals(byName.get('arr_type')?.notnull, 1);
  assertEquals(byName.get('status')?.notnull, 1);
  assertEquals(byName.get('canary_instance_name')?.notnull, 1);
  assertEquals(byName.get('started_at')?.notnull, 1);
  assertEquals(byName.get('state_token')?.notnull, 1);
  // Nullable columns (FKs + optional bookkeeping).
  assertEquals(byName.get('canary_instance_id')?.notnull, 0);
  assertEquals(byName.get('canary_status')?.notnull, 0);
  assertEquals(byName.get('canary_sync_history_id')?.notnull, 0);
  assertEquals(byName.get('finished_at')?.notnull, 0);
  assertEquals(byName.get('remaining_preview_evidence')?.notnull, 0);
  assertEquals(byName.get('remaining_preview_evidence')?.dflt_value, null);
  // Defaults for the resumable rollout state.
  assertEquals(byName.get('max_batch_size')?.dflt_value, '1');
  assertEquals(byName.get('partial_policy')?.dflt_value, "'gate'");
  assertEquals(byName.get('remaining_targets')?.dflt_value, "'[]'");
  assertEquals(byName.get('batch_cursor')?.dflt_value, '0');
  assertEquals(byName.get('rollout_results')?.dflt_value, "'[]'");
  assertEquals(byName.get('trigger')?.dflt_value, "'manual'");
});

migratedTest('up registers every canary_settings column via PRAGMA table_info', () => {
  const columns = db.query<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>('PRAGMA table_info(canary_settings)');
  const byName = new Map(columns.map((c) => [c.name, c]));

  const expected = [
    'id',
    'enabled',
    'default_max_batch_size',
    'auto_select',
    'default_canary_instance_id',
    'default_partial_policy',
    'created_at',
    'updated_at',
  ];
  for (const name of expected) {
    assert(byName.has(name), `expected canary_settings to have column ${name}`);
  }
  assertEquals(byName.size, expected.length);
  assertEquals(byName.get('enabled')?.dflt_value, '0');
  assertEquals(byName.get('default_max_batch_size')?.dflt_value, '1');
  assertEquals(byName.get('auto_select')?.dflt_value, '1');
  assertEquals(byName.get('default_partial_policy')?.dflt_value, "'gate'");
});

// ---------------------------------------------------------------------------
// up: CHECK constraints + indexes + seeded singleton
// ---------------------------------------------------------------------------

migratedTest('up encodes the canary CHECK constraints in the table DDL', () => {
  const rollout = db.queryFirst<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'canary_rollouts'"
  );
  assertExists(rollout);
  const ddl = rollout.sql;
  assert(ddl.includes("arr_type IN ('radarr', 'sonarr', 'lidarr')"), 'arr_type CHECK missing');
  assert(
    ddl.includes(
      "status IN ('canary_running', 'awaiting_confirmation', 'rolling_out', 'completed', 'aborted', 'failed')"
    ),
    'status CHECK missing'
  );
  assert(
    ddl.includes("canary_status IN ('success', 'partial', 'failed', 'skipped') OR canary_status IS NULL"),
    'canary_status CHECK missing'
  );
  assert(ddl.includes('max_batch_size >= 1'), 'max_batch_size CHECK missing');
  assert(ddl.includes("partial_policy IN ('gate', 'abort')"), 'partial_policy CHECK missing');
  assert(ddl.includes("trigger IN ('manual', 'system', 'schedule')"), 'trigger CHECK missing');

  const settings = db.queryFirst<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'canary_settings'"
  );
  assertExists(settings);
  assert(settings.sql.includes('id = 1'), 'canary_settings singleton CHECK missing');
  assert(settings.sql.includes('enabled IN (0, 1)'), 'canary_settings enabled CHECK missing');
  assert(settings.sql.includes('default_max_batch_size >= 1'), 'canary_settings batch-size CHECK missing');
});

migratedTest('up creates both canary_rollouts indexes', () => {
  const indexes = indexNames();
  assert(indexes.has('idx_canary_rollouts_status'), 'status index missing');
  assert(indexes.has('idx_canary_rollouts_arr_type_started'), 'arr_type/started index missing');
});

migratedTest('up seeds exactly one canary_settings row (id=1) with fail-closed defaults', () => {
  const rows = db.query<{
    id: number;
    enabled: number;
    default_max_batch_size: number;
    auto_select: number;
    default_canary_instance_id: number | null;
    default_partial_policy: string;
  }>('SELECT * FROM canary_settings');

  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals(row.id, 1);
  assertEquals(row.enabled, 0);
  assertEquals(row.default_max_batch_size, 1);
  assertEquals(row.auto_select, 1);
  assertEquals(row.default_canary_instance_id, null);
  assertEquals(row.default_partial_policy, 'gate');
});

migratedTest('migration 20260722 is registered immediately after 20260721', () => {
  const migrations = loadMigrations();
  const previousIndex = migrations.findIndex((candidate) => candidate.version === 20260721);
  const evidenceIndex = migrations.findIndex((candidate) => candidate.version === 20260722);

  assert(previousIndex >= 0, 'migration 20260721 should be registered');
  assertEquals(evidenceIndex, previousIndex + 1);
  assertEquals(migrations[evidenceIndex].name, 'Add canary preview evidence');
});

migratedTest('migration 20260722 down/up preserves legacy rows with null evidence', () => {
  const down = addCanaryPreviewEvidenceMigration.down;
  assertExists(down);
  db.exec(down);

  let columns = db.query<{ name: string }>('PRAGMA table_info(canary_rollouts)');
  assert(
    !columns.some((column) => column.name === 'remaining_preview_evidence'),
    'down should remove remaining_preview_evidence'
  );

  db.execute(
    `INSERT INTO canary_rollouts (
			arr_type, status, canary_instance_name, started_at, state_token
		) VALUES (?, ?, ?, ?, ?)`,
    'radarr',
    'canary_running',
    'Legacy Radarr',
    '2026-07-10T00:00:00.000Z',
    'legacy-token'
  );

  db.exec(addCanaryPreviewEvidenceMigration.up);
  columns = db.query<{ name: string }>('PRAGMA table_info(canary_rollouts)');
  assert(
    columns.some((column) => column.name === 'remaining_preview_evidence'),
    'up should restore remaining_preview_evidence'
  );

  const legacy = db.queryFirst<{ remaining_preview_evidence: string | null }>(
    'SELECT remaining_preview_evidence FROM canary_rollouts WHERE state_token = ?',
    'legacy-token'
  );
  assertExists(legacy);
  assertEquals(legacy.remaining_preview_evidence, null);

  db.execute(
    `INSERT INTO canary_rollouts (
			arr_type, status, canary_instance_name, started_at, state_token
		) VALUES (?, ?, ?, ?, ?)`,
    'sonarr',
    'canary_running',
    'New Sonarr',
    '2026-07-10T00:01:00.000Z',
    'new-token'
  );
  const current = db.queryFirst<{
    remaining_preview_evidence: string | null;
  }>('SELECT remaining_preview_evidence FROM canary_rollouts WHERE state_token = ?', 'new-token');
  assertExists(current);
  assertEquals(current.remaining_preview_evidence, null);
});

// ---------------------------------------------------------------------------
// down: reverse-drops indexes then tables (and up remains re-runnable)
// ---------------------------------------------------------------------------

migratedTest('down reverse-drops both tables and their indexes', () => {
  const down = createCanaryTablesMigration.down;
  assertExists(down);
  db.exec(down);

  const tables = tableNames();
  assert(!tables.has('canary_rollouts'), 'canary_rollouts should be dropped');
  assert(!tables.has('canary_settings'), 'canary_settings should be dropped');

  const indexes = indexNames();
  assert(!indexes.has('idx_canary_rollouts_status'), 'status index should be dropped');
  assert(!indexes.has('idx_canary_rollouts_arr_type_started'), 'arr_type/started index should be dropped');

  // up is re-runnable: re-applying it restores tables, indexes, and the seeded singleton.
  db.exec(createCanaryTablesMigration.up);
  const restored = tableNames();
  assert(restored.has('canary_rollouts'));
  assert(restored.has('canary_settings'));
  assertEquals(db.query('SELECT id FROM canary_settings').length, 1);
});
