import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { loadMigrations, migrationRunner } from '$db/migrations.ts';

const TRASH_GUIDE_VERSION = 20260226;

/**
 * Regression test for YAN-480: migration 20260226 recreates pcd_ops (DROP TABLE + RENAME). The
 * runner executes up()/down() inside a transaction, where `PRAGMA foreign_keys = OFF` is a no-op,
 * so the DROP cascaded through pcd_op_history(op_id) ON DELETE CASCADE and wiped all history.
 *
 * Applies migrations strictly below 20260226, seeds ops + history, then runs 20260226 (and its
 * rollback) through the real transactional runner path.
 */
function historyTest(name: string, fn: () => Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/trash-guide-op-history-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        const migrations = loadMigrations();
        await migrationRunner.up(migrations.filter((m) => m.version < TRASH_GUIDE_VERSION));
        seed();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

interface HistoryRow {
  id: number;
  op_id: number;
  database_id: number;
  batch_id: string;
  status: string;
  rowcount: number | null;
  conflict_reason: string | null;
  error: string | null;
  details: string | null;
  applied_at: string;
}

function seed(): void {
  db.execute(
    `INSERT INTO database_instances (id, uuid, name, repository_url, local_path)
		VALUES (1, 'uuid-1', 'db-one', 'https://example.com/db.git', '/tmp/db-one')`
  );
  db.execute(
    `INSERT INTO pcd_ops (id, database_id, origin, state, source, sequence, sql, metadata)
		VALUES (10, 1, 'base', 'published', 'repo', 1, 'SELECT 1', '{"entity":"custom_format"}')`
  );
  db.execute(
    `INSERT INTO pcd_ops (id, database_id, origin, state, source, sequence, sql, superseded_by_op_id)
		VALUES (11, 1, 'user', 'superseded', 'local', 2, 'SELECT 2', 10)`
  );
  db.execute(
    `INSERT INTO pcd_op_history (id, op_id, database_id, batch_id, status, rowcount, conflict_reason, error, details)
		VALUES
			(100, 10, 1, 'batch-a', 'applied', 1, NULL, NULL, NULL),
			(101, 11, 1, 'batch-a', 'conflicted', 0, 'row missing', NULL, '{"k":"v"}'),
			(102, 11, 1, 'batch-b', 'error', NULL, NULL, 'boom', NULL)`
  );
}

function readHistory(): HistoryRow[] {
  return db.query<HistoryRow>('SELECT * FROM pcd_op_history ORDER BY id');
}

function assertIntact(before: HistoryRow[]): void {
  assertEquals(readHistory(), before);
  assertEquals(
    db.query<{ id: number; superseded_by_op_id: number | null }>(
      'SELECT id, superseded_by_op_id FROM pcd_ops ORDER BY id'
    ),
    [
      { id: 10, superseded_by_op_id: null },
      { id: 11, superseded_by_op_id: 10 },
    ]
  );
  assertEquals(db.query('PRAGMA foreign_key_check'), []);
  assertEquals(db.queryFirst<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys, 1);
  assertEquals(
    db.queryFirst<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'pcd_op_history_migration_backup'"
    )?.count,
    0
  );
}

historyTest('migration 20260226 up preserves pcd_op_history and pcd_ops through the runner', async () => {
  const before = readHistory();
  assertEquals(before.length, 3);

  const migrations = loadMigrations();
  await migrationRunner.up(migrations.filter((m) => m.version <= TRASH_GUIDE_VERSION));

  assertEquals(migrationRunner.isApplied(TRASH_GUIDE_VERSION), true);
  assertIntact(before);
  // New source taxonomy is in force, proving pcd_ops really was recreated.
  db.execute(
    `INSERT INTO pcd_ops (database_id, origin, state, source, sql) VALUES (1, 'base', 'published', 'trashguide', 'SELECT 3')`
  );
});

historyTest('migration 20260226 down preserves pcd_op_history and pcd_ops through the runner', async () => {
  const before = readHistory();
  const migrations = loadMigrations();
  await migrationRunner.up(migrations.filter((m) => m.version <= TRASH_GUIDE_VERSION));
  assertIntact(before);

  await migrationRunner.down(migrations, TRASH_GUIDE_VERSION - 1);

  assertEquals(migrationRunner.isApplied(TRASH_GUIDE_VERSION), false);
  assertIntact(before);
});
