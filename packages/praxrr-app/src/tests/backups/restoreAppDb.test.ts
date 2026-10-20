/**
 * Backup/restore behavior against the real app database manager (`$db`):
 * - the backup handler's `VACUUM INTO ?` statement snapshots the open WAL database
 * - startup skips applying a staged restore while the database is already open (Vite HMR)
 */

import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { stageRestore, RESTORE_MANIFEST_FILENAME, RESTORE_STAGING_DIRNAME } from '$server/backups/restore.ts';
import { applyPendingRestoreAtStartup } from '$server/backups/applyRestore.ts';
import { buildValidArchive, exists, readMarker } from './restoreTestHelpers.ts';

function appDbTest(name: string, fn: (basePath: string) => Promise<void>): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const basePath = `/tmp/praxrr-tests/backup-appdb-${crypto.randomUUID()}`;
      await Deno.mkdir(basePath, { recursive: true });
      db.close();
      config.setBasePath(basePath);
      try {
        await db.initialize();
        await fn(basePath);
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(basePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

appDbTest('VACUUM INTO ? (handler statement) snapshots the open WAL database', async (basePath) => {
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.exec('CREATE TABLE marker (value TEXT)');
  db.execute('INSERT INTO marker (value) VALUES (?)', 'snapshot');
  assertEquals(await exists(`${config.paths.database}-wal`), true);

  // Path with a space and a quote proves the value is bound, not interpolated
  const snapshotDir = `${basePath}/snap dir's`;
  await Deno.mkdir(snapshotDir);
  const snapshotPath = `${snapshotDir}/praxrr.db`;
  db.execute('VACUUM INTO ?', snapshotPath);

  assertEquals(readMarker(snapshotPath), 'snapshot');
  assertEquals(await exists(`${snapshotPath}-wal`), false);
});

appDbTest('startup skips a staged restore while the database is open (HMR)', async (basePath) => {
  db.exec('CREATE TABLE marker (value TEXT)');
  db.execute('INSERT INTO marker (value) VALUES (?)', 'live');
  const archivePath = `${basePath}/backup-hmr.tar.gz`;
  await buildValidArchive(`${basePath}/src`, archivePath, 'restored');
  await stageRestore({ archivePath, basePath, filename: 'backup-hmr.tar.gz' });

  const infos: string[] = [];
  const result = await applyPendingRestoreAtStartup(basePath, db.isInitialized(), {
    info: (message) => {
      infos.push(message);
    },
    error: () => {},
  });

  assertEquals(result.status, 'skipped');
  assertEquals(infos.length, 1);
  assertEquals(await exists(`${basePath}/${RESTORE_STAGING_DIRNAME}/${RESTORE_MANIFEST_FILENAME}`), true);
  assertEquals(db.queryFirst<{ value: string }>('SELECT value FROM marker')?.value, 'live');

  // Next real restart (database closed) applies it
  db.close();
  assertEquals(db.isInitialized(), false);
  const applied = await applyPendingRestoreAtStartup(basePath, db.isInitialized());
  assertEquals(applied.status, 'applied');
  assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'restored');
});
