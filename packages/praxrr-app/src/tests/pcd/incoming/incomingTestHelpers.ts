/**
 * Shared real-git fixture for the incoming-preview tests (YAN-570).
 *
 * Builds a bare remote, a seeded clone (the linked database's `local_path`) and a second
 * "upstream" clone used to push new commits. The database row points at a non-local
 * repository URL so `isLocalRepositorySource` is false (the clone's `origin` is the bare repo).
 * The schema dependency is installed from the repo's own `packages/praxrr-schema` through
 * `PRAXRR_SCHEMA_LOCAL_PATH`, exactly as a real pull's `syncDependencies` would resolve it.
 */

import { db } from '$db/db.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { ConflictStrategy } from '$pcd/conflicts/autoAlign/types.ts';
import { logger } from '$logger/logger.ts';
import { getCache, deleteCache } from '$pcd/database/registry.ts';
import * as customFormats from '$pcd/entities/customFormats/index.ts';
import { processDependencies } from '$pcd/git/dependencies.ts';
import { withUserOpAction } from '$pcd/ops/actionContext.ts';
import { importBaseOps } from '$pcd/ops/importBaseOps.ts';
import { compile } from '$pcd/database/compiler.ts';

export const SCHEMA_ENV = 'PRAXRR_SCHEMA_LOCAL_PATH';
export const SCHEMA_PACKAGE_PATH = new URL('../../../../../praxrr-schema', import.meta.url).pathname;

export const MANIFEST = JSON.stringify(
  {
    name: 'Incoming Preview Test DB',
    version: '1.0.0',
    description: 'Incoming preview fixture',
    dependencies: { 'https://github.com/yandy-r/praxrr-schema': '1.0.0' },
    praxrr: { minimum_version: '2.1.0' },
  },
  null,
  2
);

export async function git(args: string[], cwd?: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      // Isolate from the developer's global/system git config in tests.
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

/** Names of leftover praxrr-incoming-preview-* temp dirs (probe dir closed before listing). */
export function leakedTempDirs(): string[] {
  const probe = Deno.makeTempDirSync();
  const parent = probe.replace(/\/[^/]+$/, '');
  Deno.removeSync(probe);
  return [...Deno.readDirSync(parent)]
    .filter((entry) => entry.name.startsWith('praxrr-incoming-preview-'))
    .map((entry) => entry.name)
    .sort();
}

export function silenceLogger(): () => void {
  const target = logger as unknown as Record<string, unknown>;
  const levels = ['debug', 'info', 'warn', 'error', 'errorWithTrace'];
  const originals = levels.map((level) => [level, target[level]] as const);
  for (const level of levels) target[level] = async () => undefined;
  return () => {
    for (const [level, original] of originals) target[level] = original;
  };
}

export function cfYaml(name: string, description: string): string {
  return `name: ${name}\ndescription: ${description}\nincludeInRename: false\ntags: []\nconditions: []\ntests: []\n`;
}

export function regexYaml(name: string, pattern: string): string {
  return `name: ${name}\npattern: ${pattern}\ntags: []\ndescription: null\nregex101Id: null\n`;
}

export function qpYaml(name: string, description: string): string {
  return [
    `name: ${name}`,
    `description: ${description}`,
    'tags: []',
    'language: Any',
    'orderedItems: []',
    'minimumScore: 0',
    'upgradeUntilScore: 0',
    'upgradeScoreIncrement: 1',
    'customFormatScores: []',
    '',
  ].join('\n');
}

export async function writeEntity(root: string, relativePath: string, content: string): Promise<void> {
  const full = `${root}/entities/${relativePath}`;
  await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  await Deno.writeTextFile(full, content);
}

export interface GitFixture {
  root: string;
  remote: string;
  localPath: string;
  upstreamPath: string;
  databaseId: number;
  /** Commit + push everything currently staged in the upstream clone. */
  pushUpstream: (message: string) => Promise<string>;
  /** Set the database's conflict strategy. */
  setStrategy: (strategy: ConflictStrategy) => void;
  cleanup: () => Promise<void>;
}

/**
 * Must run inside `migratedTest`. `seed` writes the initial entity files into the clone before
 * the first commit; the database is then imported and compiled (a real post-link state).
 */
export async function setUpGitFixture(seed: (localPath: string) => Promise<void>): Promise<GitFixture> {
  const restoreLogger = silenceLogger();
  const previousSchemaEnv = Deno.env.get(SCHEMA_ENV);
  Deno.env.set(SCHEMA_ENV, SCHEMA_PACKAGE_PATH);

  const root = `/tmp/praxrr-tests/incoming-${crypto.randomUUID()}`;
  const remote = `${root}/remote.git`;
  const localPath = `${root}/local`;
  const upstreamPath = `${root}/upstream`;
  let databaseId = 0;

  const cleanup = async (): Promise<void> => {
    deleteCache(databaseId);
    restoreLogger();
    if (previousSchemaEnv === undefined) Deno.env.delete(SCHEMA_ENV);
    else Deno.env.set(SCHEMA_ENV, previousSchemaEnv);
    await Deno.remove(root, { recursive: true }).catch(() => {});
  };

  try {
    await Deno.mkdir(remote, { recursive: true });
    await git(['init', '--bare', '--initial-branch=main'], remote);
    await git(['clone', remote, localPath], root);
    for (const repo of [localPath]) {
      await git(['config', 'user.name', 'Praxrr Test'], repo);
      await git(['config', 'user.email', 'praxrr@example.invalid'], repo);
    }
    await Deno.writeTextFile(`${localPath}/pcd.json`, MANIFEST);
    await seed(localPath);
    await git(['add', '-A'], localPath);
    await git(['commit', '-m', 'seed'], localPath);
    await git(['push', 'origin', 'HEAD:main'], localPath);

    await git(['clone', remote, upstreamPath], root);
    await git(['config', 'user.name', 'Praxrr Upstream'], upstreamPath);
    await git(['config', 'user.email', 'upstream@example.invalid'], upstreamPath);

    // Installs deps/praxrr-schema into the clone (untracked), as linking a database does.
    await processDependencies(localPath);

    databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `incoming-${crypto.randomUUID()}`,
      repositoryUrl: 'https://example.invalid/praxrr/test-db',
      localPath,
    });
    db.execute('UPDATE database_instances SET enabled = 1 WHERE id = ?', databaseId);

    await importBaseOps(databaseId, localPath);
    await compile(localPath, databaseId);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    root,
    remote,
    localPath,
    upstreamPath,
    databaseId,
    pushUpstream: async (message) => {
      await git(['add', '-A'], upstreamPath);
      await git(['commit', '-m', message], upstreamPath);
      await git(['push', 'origin', 'HEAD:main'], upstreamPath);
      return await git(['rev-parse', 'HEAD'], upstreamPath);
    },
    setStrategy: (strategy) => {
      databaseInstancesQueries.update(databaseId, { conflictStrategy: strategy });
    },
    cleanup,
  };
}

/** Write a user-layer description edit for a custom format through the real entity module. */
export async function userSetCfDescription(databaseId: number, name: string, description: string): Promise<void> {
  const cache = getCache(databaseId);
  if (!cache) throw new Error('no registered cache');
  const row = await cache.kb
    .selectFrom('custom_formats')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  const current = await customFormats.general(cache, row.id);
  if (!current) throw new Error(`custom format ${name} missing`);
  const result = await withUserOpAction(() =>
    customFormats.updateGeneral({
      databaseId,
      cache,
      layer: 'user',
      current,
      input: { name, description, includeInRename: current.include_in_rename, tags: [] },
    })
  );
  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    throw new Error(`user edit failed: ${'error' in result ? String(result.error) : 'unknown'}`);
  }
}

export async function cfDescription(databaseId: number, name: string): Promise<string | null | undefined> {
  const cache = getCache(databaseId);
  if (!cache) throw new Error('no registered cache');
  const row = await cache.kb
    .selectFrom('custom_formats')
    .select('description')
    .where('name', '=', name)
    .executeTakeFirst();
  return row?.description;
}
