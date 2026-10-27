/**
 * Shared real-DB fixture for local-overrides tests (read, revert, routes).
 *
 * Builds a temp PCD directory with the real schema files, a migrated scratch app DB, a
 * `database_instances` row pointing at it, seeds BASE ops, compiles, and exposes
 * `writeUserEdit` to drive the real entity modules at `layer: 'user'`.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { getCache } from '$pcd/database/registry.ts';
import { withUserOpAction } from '$pcd/ops/actionContext.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { createTestDatabase, migratedTest } from '../snapshots/rollbackTestHelpers.ts';

const SCHEMA_FILES = ['0.schema.sql', '1.languages.sql', '2.qualities.sql'] as const;

export const BASE_REGEX_NAME = 'Base Regex';
export const BASE_REGEX_PATTERN = 'base-pattern';
export const BASE_DELAY_PROFILE_NAME = 'Base Delay';
export const BASE_CUSTOM_FORMAT_NAME = 'Base CF';
export const BASE_QUALITY_PROFILE_NAME = 'Base QP';
/** A second, never-touched base regex used to prove untouched entities are not flagged. */
export const UNTOUCHED_REGEX_NAME = 'Untouched Regex';
/** A base regex the read tests delete as a user override. */
export const DOOMED_REGEX_NAME = 'Doomed Regex';

/** Default BASE ops: one entity of each commonly exercised type. */
export const DEFAULT_BASE_OPS: readonly string[] = [
  `INSERT INTO regular_expressions (name, pattern, description) VALUES ('${BASE_REGEX_NAME}', '${BASE_REGEX_PATTERN}', 'base description');`,
  `INSERT INTO regular_expressions (name, pattern) VALUES ('${UNTOUCHED_REGEX_NAME}', 'untouched-pattern');`,
  `INSERT INTO regular_expressions (name, pattern) VALUES ('${DOOMED_REGEX_NAME}', 'doomed-pattern');`,
  `INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay, bypass_if_highest_quality, bypass_if_above_custom_format_score, minimum_custom_format_score) VALUES ('${BASE_DELAY_PROFILE_NAME}', 'prefer_usenet', 100, 100, 0, 0, NULL);`,
  `INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('${BASE_CUSTOM_FORMAT_NAME}', 'cf description', 0);`,
  `INSERT INTO quality_profiles (name, description) VALUES ('${BASE_QUALITY_PROFILE_NAME}', 'qp description');`,
];

export interface PcdFixture {
  databaseId: number;
  pcdPath: string;
  /** The currently registered (resolved) cache. Re-read after every write: compile swaps it. */
  cache: () => PCDCache;
  /**
   * Runs `fn` (typically an entity module's create/update/remove at `layer: 'user'`) inside
   * one user action, so every op it writes shares one `action_id`. Throws when the write
   * result reports `success: false`.
   */
  writeUserEdit: <T>(fn: (cache: PCDCache, databaseId: number) => Promise<T>) => Promise<T>;
  /** Inserts a published user op directly (no SQL effect beyond `sql`, default `SELECT 1;`). */
  insertUserOp: (input: { metadata: Record<string, unknown> | null; sql?: string }) => number;
  cleanup: () => Promise<void>;
}

export interface SetUpPcdOptions {
  /** Replaces `DEFAULT_BASE_OPS`. */
  baseOps?: readonly string[];
}

type LoggerLevel = 'debug' | 'info' | 'warn' | 'error' | 'errorWithTrace';
const LOGGER_LEVELS: readonly LoggerLevel[] = ['debug', 'info', 'warn', 'error', 'errorWithTrace'];

function silenceLogger(): () => void {
  const target = logger as unknown as Record<LoggerLevel, unknown>;
  const originals = LOGGER_LEVELS.map((level) => [level, target[level]] as const);
  for (const level of LOGGER_LEVELS) {
    target[level] = async () => undefined;
  }
  return () => {
    for (const [level, original] of originals) {
      target[level] = original;
    }
  };
}

async function copyRealSchema(pcdPath: string): Promise<void> {
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.mkdir(`${pcdPath}/tweaks`, { recursive: true });
  for (const file of SCHEMA_FILES) {
    // tests/pcd/overrides -> packages/praxrr-schema/ops
    const source = new URL(`../../../../../praxrr-schema/ops/${file}`, import.meta.url);
    await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/${file}`, await Deno.readTextFile(source));
  }
}

/** Must run inside `migratedTest` (needs the migrated app DB). Prefer `overridesTest`. */
export async function setUpPcd(options: SetUpPcdOptions = {}): Promise<PcdFixture> {
  const restoreLogger = silenceLogger();
  const pcdPath = await Deno.makeTempDir({ prefix: 'overrides-test-pcd-' });
  let databaseId = 0;

  try {
    await copyRealSchema(pcdPath);
    databaseId = createTestDatabase(pcdPath);

    (options.baseOps ?? DEFAULT_BASE_OPS).forEach((sql, index) => {
      pcdOpsQueries.create({
        databaseId,
        origin: 'base',
        state: 'published',
        source: 'repo',
        sequence: index + 1,
        sql,
        metadata: null,
      });
    });

    await compile(pcdPath, databaseId);
  } catch (error) {
    restoreLogger();
    await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
    throw error;
  }

  const cache = (): PCDCache => {
    const registered = getCache(databaseId);
    if (!registered?.isBuilt()) throw new Error(`Database ${databaseId} cache is not built`);
    return registered;
  };

  return {
    databaseId,
    pcdPath,
    cache,
    writeUserEdit: async (fn) => {
      const result = await withUserOpAction(() => fn(cache(), databaseId));
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        const detail = 'error' in result ? String(result.error) : 'unknown error';
        throw new Error(`User edit failed: ${detail}`);
      }
      return result;
    },
    insertUserOp: ({ metadata, sql }) =>
      pcdOpsQueries.create({
        databaseId,
        origin: 'user',
        state: 'published',
        source: 'local',
        sql: sql ?? 'SELECT 1;',
        metadata: metadata ? JSON.stringify(metadata) : null,
      }),
    cleanup: async () => {
      invalidate(databaseId);
      restoreLogger();
      await Deno.remove(pcdPath, { recursive: true }).catch(() => {});
    },
  };
}

/** `migratedTest` + `setUpPcd` + guaranteed cleanup. */
export function overridesTest(
  name: string,
  fn: (fixture: PcdFixture) => Promise<void>,
  options: SetUpPcdOptions = {}
): void {
  migratedTest(name, async () => {
    const fixture = await setUpPcd(options);
    try {
      await fn(fixture);
    } finally {
      await fixture.cleanup();
    }
  });
}
