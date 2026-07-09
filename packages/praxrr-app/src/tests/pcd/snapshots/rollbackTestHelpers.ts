import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';

/**
 * Run a test body against a real, freshly-migrated in-memory-ish app DB (scratch SQLite file
 * under a temp base path). Mirrors the `migratedTest` harness in tests/routes/syncHistory.test.ts
 * so rollback tests exercise the real pcd_ops / pcd_snapshots / pcd_rollbacks schema.
 */
export function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/rollback-${crypto.randomUUID()}`;
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

/** Create a database_instances row and return its id (a valid FK target for pcd_ops). */
export function createTestDatabase(localPath = '/tmp/praxrr-rollback-none'): number {
  return databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: `rollback-db-${crypto.randomUUID()}`,
    repositoryUrl: '',
    localPath,
  });
}

export interface InsertOpInput {
  id: number;
  databaseId: number;
  origin?: 'base' | 'user';
  state?: 'published' | 'draft' | 'superseded' | 'dropped' | 'orphaned';
  source?: 'repo' | 'local' | 'import';
  sequence?: number | null;
  sql?: string;
  metadata?: string | null;
  contentHash?: string | null;
  supersededByOpId?: number | null;
}

/** Insert a pcd_ops row with an explicit id so predicate/ordering can be asserted precisely. */
export function insertOp(input: InsertOpInput): void {
  db.execute(
    `INSERT INTO pcd_ops (
			id, database_id, origin, state, source, sequence, sql, metadata, content_hash, superseded_by_op_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.databaseId,
    input.origin ?? 'user',
    input.state ?? 'published',
    input.source ?? 'local',
    input.sequence ?? input.id,
    input.sql ?? `SQL-${input.id}`,
    input.metadata ?? null,
    input.contentHash ?? `hash-${input.id}`,
    input.supersededByOpId ?? null
  );
}

/** The set of currently-published op ids for a database. */
export function publishedOpIds(databaseId: number): Set<number> {
  const rows = db.query<{ id: number }>(
    "SELECT id FROM pcd_ops WHERE database_id = ? AND state = 'published' ORDER BY id",
    databaseId
  );
  return new Set(rows.map((row) => row.id));
}

/** Total pcd_ops row count for a database (to assert append-only: never decreases). */
export function opRowCount(databaseId: number): number {
  const result = db.queryFirst<{ count: number }>(
    'SELECT COUNT(*) as count FROM pcd_ops WHERE database_id = ?',
    databaseId
  );
  return result?.count ?? 0;
}
