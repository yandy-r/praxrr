/**
 * Compatibility smoke check for monorepo schema/DB contract sync.
 *
 * Usage:
 *   deno run -A scripts/compat-check.ts
 */

import { Database } from '@jsr/db__sqlite';
import path from 'node:path';

type CompatibilityError = {
  stage: FailureStage;
  message: string;
  details?: string;
};

type FailureStage = 'schema_apply' | 'ops_layering' | 'types_drift' | 'ops_missing';

const SCHEMA_SQL_PATH = 'packages/praxrr-schema/ops/0.schema.sql';
const DB_OPS_DIR_PATH = 'packages/praxrr-db/ops';
const TYPES_FILE_PATH = 'packages/praxrr-app/src/lib/shared/pcd/types.ts';
const GENERATOR_SCRIPT_PATH = 'scripts/generate-pcd-types.ts';

function formatError(error: unknown): string {
  const details = error instanceof Error ? error.message : String(error);
  return details;
}

function fail(stage: FailureStage, message: string, error?: unknown): never {
  const details = error === undefined ? undefined : formatError(error);
  throw {
    stage,
    message,
    details,
  } satisfies CompatibilityError;
}

async function ensureOpsFiles(opsDir: string): Promise<string[]> {
  try {
    const stat = await Deno.stat(opsDir);
    if (!stat.isDirectory) {
      fail('ops_missing', `Ops path is not a directory: ${opsDir}`);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail('ops_missing', `Missing DB ops directory: ${opsDir}`);
    }
    fail('ops_missing', `Cannot access DB ops directory: ${opsDir}`, error);
  }

  const sqlFiles: string[] = [];
  for await (const entry of Deno.readDir(opsDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      sqlFiles.push(entry.name);
    }
  }

  if (sqlFiles.length === 0) {
    fail('ops_missing', `No .sql files found in DB ops directory: ${opsDir}`);
  }

  return sqlFiles.sort();
}

async function applySqlFile(database: Database, source: string): Promise<void> {
  const sql = await Deno.readTextFile(source);
  database.exec(sql);
}

async function runCommand(args: string[], cwd: string, stage: FailureStage): Promise<void> {
  const command = new Deno.Command('deno', {
    args,
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  if (code !== 0) {
    fail(stage, `Command failed (exit ${code}): deno ${args.join(' ')}`);
  }
}

async function runGitDiffCheck(filePath: string, cwd: string): Promise<void> {
  const command = new Deno.Command('git', {
    args: ['diff', '--exit-code', filePath],
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  if (code === 1) {
    fail('types_drift', `Type drift detected in ${filePath}`);
  }
  if (code !== 0) {
    fail('types_drift', `Git diff check failed for ${filePath} with exit code ${code}`);
  }
}

async function main(): Promise<void> {
  const repoRoot = Deno.cwd();
  const schemaPath = path.join(repoRoot, SCHEMA_SQL_PATH);
  const opsDir = path.join(repoRoot, DB_OPS_DIR_PATH);
  const generatorPath = path.join(repoRoot, GENERATOR_SCRIPT_PATH);

  const tempDir = await Deno.makeTempDir({ prefix: 'compat-check-' });
  const tempDbPath = path.join(tempDir, 'compat-check.sqlite');
  let database: Database | null = null;

  try {
    database = new Database(tempDbPath);
    try {
      await applySqlFile(database, schemaPath);
    } catch (error) {
      fail('schema_apply', `Failed to apply schema SQL from ${SCHEMA_SQL_PATH}`, error);
    }

    const opFiles = await ensureOpsFiles(opsDir);
    try {
      for (const fileName of opFiles) {
        await applySqlFile(database, path.join(opsDir, fileName));
      }
    } catch (error) {
      fail('ops_layering', `Failed to layer DB ops from ${DB_OPS_DIR_PATH}`, error);
    }

    await runCommand(['run', '-A', generatorPath], repoRoot, 'types_drift');
    await runGitDiffCheck(TYPES_FILE_PATH, repoRoot);
  } finally {
    database?.close();
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch (error) {
      console.error('[compat-check] Temporary artifact cleanup failed:', error);
      // Cleanup failure should not mask a prior failure.
    }
  }

  console.log('[compat-check] All checks passed');
}

try {
  await main();
} catch (error) {
  const failure = error as CompatibilityError;
  if (typeof failure?.stage === 'string' && typeof failure?.message === 'string') {
    console.error(`[compat-check] ${failure.stage}`);
    console.error(failure.message);
    if (failure.details) {
      console.error(failure.details);
    }
  } else {
    console.error('[compat-check] Failure');
    console.error(error);
  }
  Deno.exit(1);
}
