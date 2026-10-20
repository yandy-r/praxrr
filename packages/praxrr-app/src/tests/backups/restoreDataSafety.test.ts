/**
 * Regression tests for restore data safety (PR #323 review, P2): the real data must survive
 * failed or interrupted restores, even after startup recreates an empty `data/` directory.
 */

import { assertEquals } from '@std/assert';
import { BaseTest } from '../base/BaseTest.ts';
import { RESTORE_MANIFEST_FILENAME, RESTORE_STAGING_DIRNAME, stageRestore } from '../../lib/server/backups/restore.ts';
import {
  applyPendingRestore,
  type ApplyRestoreResult,
  RESTORE_DATA_MISSING_MARKER,
} from '../../lib/server/backups/applyRestore.ts';
import {
  buildLiveBase,
  buildValidArchive,
  createSqliteDb,
  exists,
  listNames,
  readMarker,
} from './restoreTestHelpers.ts';

const ROLLBACK_PREFIX = 'data.pre-restore-';

function assertDataMissing(result: ApplyRestoreResult): string {
  if (result.status !== 'failed' || !('dataMissing' in result)) {
    throw new Error(`expected dataMissing failure, got ${JSON.stringify(result)}`);
  }
  return result.rollbackPath;
}

/** Stage a valid backup with the given marker into `basePath`. */
async function stageMarker(tempDir: string, basePath: string, marker: string): Promise<void> {
  const archivePath = `${tempDir}/backup-${marker}.tar.gz`;
  await buildValidArchive(`${tempDir}/src-${marker}`, archivePath, marker);
  await stageRestore({ archivePath, basePath, filename: `backup-${marker}.tar.gz` });
}

/** Apply with every rename onto live `data/` failing (swap and move-back both fail). */
function applyWithDoubleFailure(basePath: string): Promise<ApplyRestoreResult> {
  const liveData = `${basePath}/data`;
  return applyPendingRestore(basePath, undefined, {
    rename: async (from, to) => {
      if (to === liveData) throw new Error('simulated rename failure');
      await Deno.rename(from, to);
    },
  });
}

class RestoreDataSafetyTest extends BaseTest {
  testDoubleFailureThenSecondRestoreKeepsRealData(): void {
    this.test('second restore after a double failure never prunes the real data', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      await stageMarker(context.tempDir, basePath, 'first');
      const realDataPath = assertDataMissing(await applyWithDoubleFailure(basePath));

      // Startup aborted, but config.init() on a later boot recreates an empty data/ first
      await Deno.mkdir(`${basePath}/data`, { recursive: true });
      await stageMarker(context.tempDir, basePath, 'second');
      const result = await applyPendingRestore(basePath);

      // Either startup keeps refusing, or the restore applies; the real data must survive
      assertEquals(readMarker(`${realDataPath}/praxrr.db`), 'live');
      if (result.status === 'applied') {
        assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'second');
      } else {
        assertEquals(assertDataMissing(result), realDataPath);
      }
    });
  }

  testKillBetweenRenamesRecovers(): void {
    this.test('apply after a kill between renames swaps staged data and keeps original', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      await stageMarker(context.tempDir, basePath, 'restored');
      // Simulate a kill after `data` -> rollback but before staged -> `data`
      const originalPath = `${basePath}/${ROLLBACK_PREFIX}2026-01-01T00-00-00-000Z`;
      await Deno.rename(`${basePath}/data`, originalPath);
      // config.init() recreates an empty data/ on the next boot
      await Deno.mkdir(`${basePath}/data`);

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'applied');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'restored');
      assertEquals(readMarker(`${originalPath}/praxrr.db`), 'live');
      assertEquals(await exists(`${basePath}/${RESTORE_STAGING_DIRNAME}/${RESTORE_MANIFEST_FILENAME}`), false);
      // The empty data/ is not kept as a rollback that could displace the real copy
      const rollbacks = await listNames(basePath, ROLLBACK_PREFIX);
      assertEquals(rollbacks, [`${ROLLBACK_PREFIX}2026-01-01T00-00-00-000Z`]);
    });
  }

  testNonEmptyDataWithoutDatabaseIsSetAsideNotPruned(): void {
    this.test('live data without praxrr.db is moved aside under a never-pruned name', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await Deno.mkdir(`${basePath}/data/databases`, { recursive: true });
      await Deno.writeTextFile(`${basePath}/data/databases/keep.txt`, 'keep\n');
      const oldRollback = `${basePath}/${ROLLBACK_PREFIX}2026-01-01T00-00-00-000Z`;
      await Deno.mkdir(oldRollback);
      createSqliteDb(`${oldRollback}/praxrr.db`, 'old');
      await stageMarker(context.tempDir, basePath, 'restored');

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'applied');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'restored');
      assertEquals(readMarker(`${oldRollback}/praxrr.db`), 'old');
      const asideDirs = await listNames(basePath, 'data.no-database-');
      assertEquals(asideDirs.length, 1);
      assertEquals(await Deno.readTextFile(`${basePath}/${asideDirs[0]}/databases/keep.txt`), 'keep\n');
    });
  }

  testMarkerReportsDataMissingUntilFixed(): void {
    this.test('data-missing marker keeps refusing startup until data/praxrr.db exists', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      await stageMarker(context.tempDir, basePath, 'first');
      const realDataPath = assertDataMissing(await applyWithDoubleFailure(basePath));

      const marker = JSON.parse(await Deno.readTextFile(`${basePath}/${RESTORE_DATA_MISSING_MARKER}`));
      assertEquals(marker.rollbackPath, realDataPath);

      // No staged restore, empty data/ recreated: still refuses
      await Deno.mkdir(`${basePath}/data`, { recursive: true });
      assertEquals(assertDataMissing(await applyPendingRestore(basePath)), realDataPath);
      assertEquals(assertDataMissing(await applyPendingRestore(basePath)), realDataPath);

      // User moves the real data back: marker cleared, normal startup resumes
      await Deno.remove(`${basePath}/data`);
      await Deno.rename(realDataPath, `${basePath}/data`);
      assertEquals((await applyPendingRestore(basePath)).status, 'none');
      assertEquals(await exists(`${basePath}/${RESTORE_DATA_MISSING_MARKER}`), false);
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'live');
    });
  }

  testMarkedRollbackSurvivesNextRestorePrune(): void {
    this.test('rollback recorded in the data-missing marker is not pruned by the next restore', async (context) => {
      const basePath = `${context.tempDir}/base`;
      await buildLiveBase(basePath);
      await stageMarker(context.tempDir, basePath, 'first');
      const realDataPath = assertDataMissing(await applyWithDoubleFailure(basePath));

      // User copies (not moves) the real data back, then a new restore is staged in the same boot
      await Deno.mkdir(`${basePath}/data`, { recursive: true });
      await Deno.copyFile(`${realDataPath}/praxrr.db`, `${basePath}/data/praxrr.db`);
      await stageMarker(context.tempDir, basePath, 'second');

      const result = await applyPendingRestore(basePath);

      assertEquals(result.status, 'applied');
      assertEquals(readMarker(`${basePath}/data/praxrr.db`), 'second');
      assertEquals(readMarker(`${realDataPath}/praxrr.db`), 'live');
    });
  }

  runTests(): void {
    this.testDoubleFailureThenSecondRestoreKeepsRealData();
    this.testKillBetweenRenamesRecovers();
    this.testMarkedRollbackSurvivesNextRestorePrune();
    this.testNonEmptyDataWithoutDatabaseIsSetAsideNotPruned();
    this.testMarkerReportsDataMissingUntilFixed();
  }
}

const test = new RestoreDataSafetyTest();
await test.runTests();
