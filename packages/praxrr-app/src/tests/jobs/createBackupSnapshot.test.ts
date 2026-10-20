/**
 * Regression tests for YAN-482: backups must capture a consistent SQLite snapshot
 * instead of tarring the live WAL database files.
 */

import { Database } from '@jsr/db__sqlite';
import { assertEquals } from '@std/assert';
import { BaseTest } from '../base/BaseTest.ts';
import { classifyTarExit, createBackup } from '../../lib/server/jobs/logic/createBackup.ts';

async function listArchive(archivePath: string): Promise<string[]> {
  const { code, stdout } = await new Deno.Command('tar', {
    args: ['-tzf', archivePath],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  assertEquals(code, 0);
  return new TextDecoder()
    .decode(stdout)
    .split('\n')
    .map((line) => line.trim().replace(/\/$/, ''))
    .filter((line) => line.length > 0);
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await Deno.mkdir(destDir, { recursive: true });
  const { code } = await new Deno.Command('tar', {
    args: ['-xzf', archivePath, '-C', destDir],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  assertEquals(code, 0);
}

class CreateBackupSnapshotTest extends BaseTest {
  testSnapshotReplacesLiveDatabase(): void {
    this.test('snapshotDatabase replaces live db and skips wal/shm', async (context) => {
      const dataDir = `${context.tempDir}/data`;
      await Deno.mkdir(`${dataDir}/databases/repo`, { recursive: true });
      await Deno.writeTextFile(`${dataDir}/databases/repo/file.txt`, 'pcd\n');
      await Deno.writeTextFile(`${dataDir}/other.json`, '{}\n');

      // Live WAL database kept open with uncheckpointed writes
      const liveDb = new Database(`${dataDir}/praxrr.db`);
      try {
        liveDb.exec('PRAGMA journal_mode = WAL');
        liveDb.exec('PRAGMA wal_autocheckpoint = 0');
        liveDb.exec('CREATE TABLE items (name TEXT)');
        liveDb.exec("INSERT INTO items (name) VALUES ('alpha'), ('beta')");

        const walExists = await Deno.stat(`${dataDir}/praxrr.db-wal`)
          .then(() => true)
          .catch(() => false);
        assertEquals(walExists, true);

        const backupDir = `${context.tempDir}/backups`;
        const result = await createBackup(dataDir, backupDir, undefined, {
          databaseFilename: 'praxrr.db',
          snapshotDatabase: (destPath) => {
            liveDb.exec(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`);
          },
        });

        assertEquals(result.success, true);
        const archivePath = `${backupDir}/${result.filename}`;
        const members = await listArchive(archivePath);

        assertEquals(members.includes('data/praxrr.db'), true);
        assertEquals(members.includes('data/praxrr.db-wal'), false);
        assertEquals(members.includes('data/praxrr.db-shm'), false);
        assertEquals(members.includes('data/other.json'), true);
        assertEquals(members.includes('data/databases/repo/file.txt'), true);
        assertEquals(members.filter((m) => m === 'data/praxrr.db').length, 1);

        const extractDir = `${context.tempDir}/extract`;
        await extractArchive(archivePath, extractDir);
        const restored = new Database(`${extractDir}/data/praxrr.db`, { readonly: true });
        try {
          const rows = restored.prepare('SELECT name FROM items ORDER BY name').all() as { name: string }[];
          assertEquals(
            rows.map((row) => row.name),
            ['alpha', 'beta']
          );
        } finally {
          restored.close();
        }
      } finally {
        liveDb.close();
      }

      // Staging directory is cleaned up
      const backupEntries: string[] = [];
      for await (const entry of Deno.readDir(`${context.tempDir}/backups`)) {
        backupEntries.push(entry.name);
      }
      assertEquals(
        backupEntries.filter((name) => name.startsWith('.')),
        []
      );
    });
  }

  testSnapshotFailureFailsBackup(): void {
    this.test('snapshotDatabase failure fails the backup', async (context) => {
      const dataDir = `${context.tempDir}/data`;
      await Deno.mkdir(dataDir, { recursive: true });
      await Deno.writeTextFile(`${dataDir}/praxrr.db`, 'live');

      const result = await createBackup(dataDir, `${context.tempDir}/backups`, undefined, {
        databaseFilename: 'praxrr.db',
        snapshotDatabase: () => {
          throw new Error('snapshot boom');
        },
      });

      assertEquals(result.success, false);
      assertEquals(result.error?.includes('snapshot boom'), true);
    });
  }

  testRemovesStaleStagingDirs(): void {
    this.test('removes stale snapshot staging dirs from killed runs', async (context) => {
      const dataDir = `${context.tempDir}/data`;
      const backupDir = `${context.tempDir}/backups`;
      await Deno.mkdir(dataDir, { recursive: true });
      await Deno.writeTextFile(`${dataDir}/file.txt`, 'x');
      await Deno.mkdir(`${backupDir}/.backup-staging-abc123/data`, { recursive: true });
      await Deno.writeTextFile(`${backupDir}/.backup-staging-abc123/data/praxrr.db`, 'orphan');

      const result = await createBackup(dataDir, backupDir);

      assertEquals(result.success, true);
      const names: string[] = [];
      for await (const entry of Deno.readDir(backupDir)) names.push(entry.name);
      assertEquals(names, [result.filename]);
    });
  }

  testTarExitClassification(): void {
    this.test('classifyTarExit treats file-changed warning as success', () => {
      assertEquals(classifyTarExit(0, ''), { ok: true });
      assertEquals(classifyTarExit(1, 'tar: data/x.log: file changed as we read it\n'), {
        ok: true,
        warning: 'tar: data/x.log: file changed as we read it',
      });
      assertEquals(classifyTarExit(1, 'tar: something else\n').ok, false);
      assertEquals(classifyTarExit(2, 'tar: file changed as we read it\n').ok, false);
    });
  }

  runTests(): void {
    this.testSnapshotReplacesLiveDatabase();
    this.testSnapshotFailureFailsBackup();
    this.testTarExitClassification();
    this.testRemovesStaleStagingDirs();
  }
}

const test = new CreateBackupSnapshotTest();
await test.runTests();
