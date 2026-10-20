/**
 * Regression tests for YAN-481: restores must be validated and staged, then applied
 * at startup before the database is opened, instead of extracting over live data.
 */

import { Database } from '@jsr/db__sqlite';
import { assertEquals, assertRejects } from '@std/assert';
import { BaseTest } from '../base/BaseTest.ts';
import {
  applyPendingRestore,
  BackupRestoreError,
  isValidBackupFilename,
  RESTORE_FAILED_MANIFEST_FILENAME,
  RESTORE_MANIFEST_FILENAME,
  RESTORE_STAGING_DIRNAME,
  RESTORE_STAGING_TMP_PREFIX,
  stageRestore,
} from '../../lib/server/backups/restore.ts';

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function tar(args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command('tar', { args, stdout: 'piped', stderr: 'piped' }).output();
  if (code !== 0) {
    throw new Error(`tar failed: ${new TextDecoder().decode(stderr)}`);
  }
}

function createSqliteDb(path: string, value: string): void {
  const database = new Database(path);
  try {
    database.exec('CREATE TABLE marker (value TEXT)');
    database.prepare('INSERT INTO marker (value) VALUES (?)').run(value);
  } finally {
    database.close();
  }
}

function readMarker(path: string): string {
  const database = new Database(path, { readonly: true });
  try {
    const row = database.prepare('SELECT value FROM marker').get() as { value: string };
    return row.value;
  } finally {
    database.close();
  }
}

/** Build `<root>/data/praxrr.db` (+ extra file) and archive it as `data/...`. */
async function buildValidArchive(root: string, archivePath: string, marker: string): Promise<void> {
  await Deno.mkdir(`${root}/data/databases`, { recursive: true });
  createSqliteDb(`${root}/data/praxrr.db`, marker);
  await Deno.writeTextFile(`${root}/data/databases/note.txt`, `${marker}\n`);
  await tar(['-czf', archivePath, '-C', root, 'data']);
}

/** Build a live base dir with a WAL database plus stray -wal/-shm files. */
async function buildLiveBase(basePath: string): Promise<void> {
  await Deno.mkdir(`${basePath}/data`, { recursive: true });
  createSqliteDb(`${basePath}/data/praxrr.db`, 'live');
  await Deno.writeTextFile(`${basePath}/data/praxrr.db-wal`, 'stale-wal');
  await Deno.writeTextFile(`${basePath}/data/praxrr.db-shm`, 'stale-shm');
}

async function assertStageRejected(basePath: string, archivePath: string, code: string): Promise<void> {
  const error = await assertRejects(
    () => stageRestore({ archivePath, basePath, filename: 'backup-test.tar.gz' }),
    BackupRestoreError
  );
  assertEquals(error.code, code);
  assertEquals(await exists(`${basePath}/${RESTORE_STAGING_DIRNAME}`), false);
}

class RestoreTest extends BaseTest {
  testFilenameValidation(): void {
    this.test('isValidBackupFilename', () => {
      assertEquals(isValidBackupFilename('backup-2025-01-15-143045.tar.gz'), true);
      assertEquals(isValidBackupFilename('backup-uploaded-1700000000000.tar.gz'), true);
      // Browser-renamed duplicates and other printable names already on disk stay usable
      assertEquals(isValidBackupFilename('backup-2026-01-01 (1).tar.gz'), true);
      assertEquals(isValidBackupFilename('backup-café.tar.gz'), true);
      assertEquals(isValidBackupFilename('backup-../../etc.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-a/b.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-a\\b.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-..tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-a\u0000.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-a\n.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-a\u007f.tar.gz'), false);
      assertEquals(isValidBackupFilename('other.tar.gz'), false);
      assertEquals(isValidBackupFilename('backup-x.zip'), false);
      assertEquals(isValidBackupFilename(''), false);
    });
  }

  testStageValidArchive(): void {
    this.test('stageRestore stages valid archive without touching live data', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');

      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });

      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      const manifest = JSON.parse(await Deno.readTextFile(`${staging}/manifest.json`));
      assertEquals(manifest.filename, 'backup-valid.tar.gz');
      assertEquals(typeof manifest.stagedAt, 'string');
      assertEquals(readMarker(`${staging}/extract/data/praxrr.db`), 'restored');

      // Live data untouched
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
      assertEquals(await Deno.readTextFile(`${basePath}/data/praxrr.db-wal`), 'stale-wal');
    });
  }

  testRejectsOutsideDataMember(): void {
    this.test('stageRestore rejects members outside data/', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      createSqliteDb(`${src}/data/praxrr.db`, 'x');
      await Deno.writeTextFile(`${src}/evil.txt`, 'evil');
      const archivePath = `${context.tempDir}/backup-outside.tar.gz`;
      await tar(['-czf', archivePath, '-C', src, 'data', 'evil.txt']);

      await assertStageRejected(basePath, archivePath, 'unsafe_member');
      assertEquals(await exists(`${basePath}/evil.txt`), false);
    });
  }

  testRejectsDotDotMember(): void {
    this.test('stageRestore rejects .. members', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      createSqliteDb(`${src}/data/praxrr.db`, 'x');
      await Deno.writeTextFile(`${context.tempDir}/evil.txt`, 'evil');
      const archivePath = `${context.tempDir}/backup-dotdot.tar.gz`;
      // -P keeps the `..` segment in the member name
      await tar(['-czPf', archivePath, '-C', src, 'data/praxrr.db', 'data/../../evil.txt']);

      await assertStageRejected(basePath, archivePath, 'unsafe_member');
    });
  }

  testRejectsAbsoluteMember(): void {
    this.test('stageRestore rejects absolute members', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      createSqliteDb(`${src}/data/praxrr.db`, 'x');
      await Deno.writeTextFile(`${context.tempDir}/evil.txt`, 'evil');
      const archivePath = `${context.tempDir}/backup-abs.tar.gz`;
      await tar(['-czPf', archivePath, '-C', src, 'data/praxrr.db', `${context.tempDir}/evil.txt`]);

      await assertStageRejected(basePath, archivePath, 'unsafe_member');
    });
  }

  testRejectsSymlinkMember(): void {
    this.test('stageRestore rejects symlink members', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      createSqliteDb(`${src}/data/praxrr.db`, 'x');
      await Deno.symlink('/etc/passwd', `${src}/data/link`);
      const archivePath = `${context.tempDir}/backup-symlink.tar.gz`;
      await tar(['-czf', archivePath, '-C', src, 'data']);

      await assertStageRejected(basePath, archivePath, 'unsafe_entry');
    });
  }

  testRejectsMissingDatabase(): void {
    this.test('stageRestore rejects archive without data/praxrr.db', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      await Deno.writeTextFile(`${src}/data/other.txt`, 'x');
      const archivePath = `${context.tempDir}/backup-nodb.tar.gz`;
      await tar(['-czf', archivePath, '-C', src, 'data']);

      await assertStageRejected(basePath, archivePath, 'missing_database');
    });
  }

  testRejectsNonSqliteDatabase(): void {
    this.test('stageRestore rejects non-SQLite praxrr.db', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      await Deno.writeTextFile(`${src}/data/praxrr.db`, 'not a database at all, definitely');
      const archivePath = `${context.tempDir}/backup-notsqlite.tar.gz`;
      await tar(['-czf', archivePath, '-C', src, 'data']);

      await assertStageRejected(basePath, archivePath, 'invalid_database');
    });
  }

  testRejectsCorruptArchive(): void {
    this.test('stageRestore rejects unreadable archive', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-corrupt.tar.gz`;
      await Deno.writeTextFile(archivePath, 'garbage');

      await assertStageRejected(basePath, archivePath, 'invalid_archive');
    });
  }

  testApplyNoManifestIsNoop(): void {
    this.test('applyPendingRestore is a no-op without manifest', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      // Incomplete staging (no manifest) must be ignored
      await Deno.mkdir(`${basePath}/${RESTORE_STAGING_DIRNAME}/extract/data`, { recursive: true });

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'none');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
    });
  }

  testApplySwapsData(): void {
    this.test('applyPendingRestore swaps data and keeps rollback copy', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      // Older rollback copy should be pruned
      await Deno.mkdir(`${basePath}/data.pre-restore-2000-01-01T00-00-00-000Z`);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');
      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });

      const result = await applyPendingRestore(basePath);

      if (result.status !== 'applied') throw new Error(`expected applied, got ${JSON.stringify(result)}`);
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'restored');
      assertEquals(await Deno.readTextFile(`${basePath}/data/databases/note.txt`), 'restored\n');
      // Stale live WAL/SHM must not sit next to the restored database
      assertEquals(await exists(`${basePath}/data/praxrr.db-wal`), false);
      assertEquals(await exists(`${basePath}/data/praxrr.db-shm`), false);
      assertEquals(await exists(`${basePath}/${RESTORE_STAGING_DIRNAME}`), false);

      const rollbacks: string[] = [];
      for await (const entry of Deno.readDir(basePath)) {
        if (entry.name.startsWith('data.pre-restore-')) rollbacks.push(entry.name);
      }
      assertEquals(rollbacks.length, 1);
      assertEquals(rollbacks[0] === 'data.pre-restore-2000-01-01T00-00-00-000Z', false);
      assertEquals(result.rollbackPath, `${basePath}/${rollbacks[0]}`);
      assertEquals(readMarker(`${basePath}/${rollbacks[0]}/praxrr.db`), 'live');
    });
  }

  testApplyKeepsLiveWhenStagedDataMissing(): void {
    this.test('applyPendingRestore keeps live data when staged data is missing', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');
      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });
      await Deno.remove(`${basePath}/${RESTORE_STAGING_DIRNAME}/extract/data`, { recursive: true });

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'failed');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
      assertEquals(await Deno.readTextFile(`${basePath}/data/praxrr.db-wal`), 'stale-wal');
      for await (const entry of Deno.readDir(basePath)) {
        assertEquals(entry.name.startsWith('data.pre-restore-'), false);
      }
      // Failed restore is marked and not retried
      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      assertEquals(await exists(`${staging}/${RESTORE_MANIFEST_FILENAME}`), false);
      assertEquals(await exists(`${staging}/${RESTORE_FAILED_MANIFEST_FILENAME}`), true);
      assertEquals((await applyPendingRestore(basePath)).status, 'none');
    });
  }

  testApplySwapFailureRollsBack(): void {
    this.test('applyPendingRestore rolls back and marks failed when swap fails', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');
      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });
      const stagedData = `${basePath}/${RESTORE_STAGING_DIRNAME}/extract/data`;

      const result = await applyPendingRestore(basePath, undefined, {
        rename: async (from, to) => {
          if (from === stagedData) throw new Error('simulated rename failure');
          await Deno.rename(from, to);
        },
      });

      assertEquals(result.status, 'failed');
      assertEquals('dataMissing' in result, false);
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      assertEquals(await exists(`${staging}/${RESTORE_FAILED_MANIFEST_FILENAME}`), true);
      assertEquals((await applyPendingRestore(basePath)).status, 'none');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
    });
  }

  testApplyDoubleFailureReportsDataMissing(): void {
    this.test('applyPendingRestore reports dataMissing when swap and rollback both fail', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');
      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });
      const liveData = `${basePath}/data`;

      const result = await applyPendingRestore(basePath, undefined, {
        rename: async (from, to) => {
          if (to !== liveData) {
            await Deno.rename(from, to);
            return;
          }
          throw new Error('simulated rename failure');
        },
      });

      if (result.status !== 'failed' || !('dataMissing' in result)) {
        throw new Error(`expected dataMissing failure, got ${JSON.stringify(result)}`);
      }
      assertEquals(result.dataMissing, true);
      assertEquals(await exists(liveData), false);
      assertEquals(readMarker(`${result.rollbackPath}/praxrr.db`), 'live');

      // Marked failed: a later startup neither retries the restore nor prunes the real data
      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      assertEquals(await exists(`${staging}/${RESTORE_MANIFEST_FILENAME}`), false);
      assertEquals(await exists(`${staging}/${RESTORE_FAILED_MANIFEST_FILENAME}`), true);
      assertEquals((await applyPendingRestore(basePath)).status, 'none');
      assertEquals(readMarker(`${result.rollbackPath}/praxrr.db`), 'live');
    });
  }

  testStagesNonAsciiNamesInCLocale(): void {
    this.test('stageRestore accepts non-ASCII member names escaped by tar', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const src = `${context.tempDir}/src`;
      await Deno.mkdir(`${src}/data/databases`, { recursive: true });
      createSqliteDb(`${src}/data/praxrr.db`, 'restored');
      await Deno.writeTextFile(`${src}/data/databases/café.yml`, 'name: café\n');
      const archivePath = `${context.tempDir}/backup-unicode.tar.gz`;
      await tar(['-czf', archivePath, '-C', src, 'data']);

      // GNU tar lists `caf\303\251.yml` under the C locale (as in minimal containers)
      const previous = Deno.env.get('LC_ALL');
      Deno.env.set('LC_ALL', 'C');
      try {
        await stageRestore({ archivePath, basePath, filename: 'backup-unicode.tar.gz' });
      } finally {
        if (previous === undefined) Deno.env.delete('LC_ALL');
        else Deno.env.set('LC_ALL', previous);
      }

      const staged = `${basePath}/${RESTORE_STAGING_DIRNAME}/extract/data/databases/café.yml`;
      assertEquals(await Deno.readTextFile(staged), 'name: café\n');
    });
  }

  testConcurrentStagesStayConsistent(): void {
    this.test('concurrent stageRestore calls leave one consistent staged restore', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const markers = ['one', 'two', 'three'];
      for (const marker of markers) {
        await buildValidArchive(
          `${context.tempDir}/src-${marker}`,
          `${context.tempDir}/backup-${marker}.tar.gz`,
          marker
        );
      }

      const results = await Promise.allSettled(
        markers.map((marker) =>
          stageRestore({
            archivePath: `${context.tempDir}/backup-${marker}.tar.gz`,
            basePath,
            filename: `backup-${marker}.tar.gz`,
          })
        )
      );
      assertEquals(
        results.some((result) => result.status === 'fulfilled'),
        true
      );

      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      const manifest = JSON.parse(await Deno.readTextFile(`${staging}/${RESTORE_MANIFEST_FILENAME}`));
      const marker = /^backup-(.+)\.tar\.gz$/.exec(manifest.filename)?.[1];
      assertEquals(readMarker(`${staging}/extract/data/praxrr.db`), marker);
      assertEquals(await Deno.readTextFile(`${staging}/extract/data/databases/note.txt`), `${marker}\n`);
      for await (const entry of Deno.readDir(basePath)) {
        assertEquals(entry.name.startsWith(RESTORE_STAGING_TMP_PREFIX), false);
      }
    });
  }

  testFailedStageKeepsExistingStagedRestore(): void {
    this.test('failed stageRestore leaves an already staged restore intact', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const archivePath = `${context.tempDir}/backup-valid.tar.gz`;
      await buildValidArchive(`${context.tempDir}/src`, archivePath, 'restored');
      await stageRestore({ archivePath, basePath, filename: 'backup-valid.tar.gz' });

      const src = `${context.tempDir}/bad`;
      await Deno.mkdir(`${src}/data`, { recursive: true });
      await Deno.writeTextFile(`${src}/data/praxrr.db`, 'not a database at all, definitely');
      const badArchive = `${context.tempDir}/backup-bad.tar.gz`;
      await tar(['-czf', badArchive, '-C', src, 'data']);
      await assertRejects(
        () => stageRestore({ archivePath: badArchive, basePath, filename: 'backup-bad.tar.gz' }),
        BackupRestoreError
      );

      const staging = `${basePath}/${RESTORE_STAGING_DIRNAME}`;
      const manifest = JSON.parse(await Deno.readTextFile(`${staging}/${RESTORE_MANIFEST_FILENAME}`));
      assertEquals(manifest.filename, 'backup-valid.tar.gz');
      assertEquals(readMarker(`${staging}/extract/data/praxrr.db`), 'restored');
      for await (const entry of Deno.readDir(basePath)) {
        assertEquals(entry.name.startsWith(RESTORE_STAGING_TMP_PREFIX), false);
      }
    });
  }

  testApplyRemovesStaleStagingTemps(): void {
    this.test('applyPendingRestore removes stale staging temp dirs', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      const stale = `${basePath}/${RESTORE_STAGING_TMP_PREFIX}abc123`;
      await Deno.mkdir(`${stale}/extract/data`, { recursive: true });

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'none');
      assertEquals(await exists(stale), false);
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
    });
  }

  runTests(): void {
    this.testFilenameValidation();
    this.testStageValidArchive();
    this.testRejectsOutsideDataMember();
    this.testRejectsDotDotMember();
    this.testRejectsAbsoluteMember();
    this.testRejectsSymlinkMember();
    this.testRejectsMissingDatabase();
    this.testRejectsNonSqliteDatabase();
    this.testRejectsCorruptArchive();
    this.testApplyNoManifestIsNoop();
    this.testApplySwapsData();
    this.testApplyKeepsLiveWhenStagedDataMissing();
    this.testApplySwapFailureRollsBack();
    this.testApplyDoubleFailureReportsDataMissing();
    this.testStagesNonAsciiNamesInCLocale();
    this.testConcurrentStagesStayConsistent();
    this.testFailedStageKeepsExistingStagedRestore();
    this.testApplyRemovesStaleStagingTemps();
  }
}

const test = new RestoreTest();
await test.runTests();
