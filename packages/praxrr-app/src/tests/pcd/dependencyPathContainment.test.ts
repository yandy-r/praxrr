import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { processDependencies, syncDependencies, validateDependencies } from '$pcd/git/dependencies.ts';
import { getDependencyDirName, validateManifest } from '$pcd/manifest/manifest.ts';
import { DependencyError, ManifestValidationError } from '$pcd/core/errors.ts';
import { logger } from '$logger/logger.ts';

const SCHEMA_DEPENDENCY_URL = 'https://github.com/yandy-r/praxrr-schema';
const SCHEMA_PATH_OVERRIDE_ENV = 'PRAXRR_SCHEMA_LOCAL_PATH';

function manifestWith(dependencies: Record<string, string>) {
  return {
    name: 'Containment Fixture',
    version: '1.0.0',
    description: 'fixture',
    dependencies: { [SCHEMA_DEPENDENCY_URL]: '1.0.0', ...dependencies },
    praxrr: { minimum_version: '2.1.0' },
  };
}

async function withTempPcd(
  dependencies: Record<string, string>,
  run: (pcdPath: string, root: string) => Promise<void>
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'praxrr-dep-containment-' });
  const pcdPath = `${root}/pcd`;
  const previousOverride = Deno.env.get(SCHEMA_PATH_OVERRIDE_ENV);
  const originalLogger = { info: logger.info, debug: logger.debug, warn: logger.warn, error: logger.error };
  try {
    logger.info = (async () => {}) as typeof logger.info;
    logger.debug = (async () => {}) as typeof logger.debug;
    logger.warn = (async () => {}) as typeof logger.warn;
    logger.error = (async () => {}) as typeof logger.error;
    Deno.env.delete(SCHEMA_PATH_OVERRIDE_ENV);

    await Deno.mkdir(pcdPath, { recursive: true });
    await Deno.writeTextFile(`${pcdPath}/pcd.json`, JSON.stringify(manifestWith(dependencies)));
    await Deno.writeTextFile(`${pcdPath}/sentinel.txt`, 'user data');
    await run(pcdPath, root);
  } finally {
    Object.assign(logger, originalLogger);
    if (previousOverride === undefined) Deno.env.delete(SCHEMA_PATH_OVERRIDE_ENV);
    else Deno.env.set(SCHEMA_PATH_OVERRIDE_ENV, previousOverride);
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function snapshotTree(path: string, prefix = ''): Promise<string[]> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    const rel = `${prefix}${entry.name}`;
    entries.push(rel);
    if (entry.isDirectory) entries.push(...(await snapshotTree(`${path}/${entry.name}`, `${rel}/`)));
  }
  return entries.sort();
}

// Keys whose derived directory would be `.`, `..`, empty, nested, or not a plain name,
// plus non-https keys that would make the manifest pick a local filesystem source.
const REJECTED_KEYS = [
  'foo/..',
  '..',
  'a/b/../..',
  '.',
  'https://github.com/org/..',
  'https://github.com/org/%2e%2e',
  'https://github.com/org/...git',
  'https://github.com/org/foo/..git',
  'https://github.com/org/...',
  'https://github.com/org/foo.. ',
  'https://github.com/org/a%5C..',
  'https://github.com/',
  '/usr/share/doc',
  'file:///usr/share/doc',
  '../praxrr-schema',
  'git@github.com:org/extra.git',
];

for (const key of REJECTED_KEYS) {
  Deno.test(
    `dependency key ${JSON.stringify(key)} fails process/sync/validate closed and touches no files`,
    async () => {
      await withTempPcd({ [key]: 'main' }, async (pcdPath) => {
        const before = await snapshotTree(pcdPath);

        await assertRejects(() => syncDependencies(pcdPath), ManifestValidationError);
        await assertRejects(() => processDependencies(pcdPath), ManifestValidationError);
        assertEquals(await validateDependencies(pcdPath), false);

        assertEquals(await snapshotTree(pcdPath), before);
        assertEquals(await Deno.readTextFile(`${pcdPath}/sentinel.txt`), 'user data');
      });
    }
  );
}

Deno.test('manifest validation rejects unsafe dependency keys before a config save writes pcd.json', () => {
  for (const key of REJECTED_KEYS) {
    assertThrows(() => validateManifest(manifestWith({ [key]: 'main' })), ManifestValidationError);
  }
});

Deno.test('manifest validation rejects option-like refs and colliding dependency directories', () => {
  assertThrows(
    () => validateManifest(manifestWith({ 'https://github.com/org/extra': '--orphan=x' })),
    ManifestValidationError
  );
  assertThrows(() => validateManifest(manifestWith({ 'https://github.com/org/extra': '' })), ManifestValidationError);
  assertThrows(
    () =>
      validateManifest(
        manifestWith({ 'https://github.com/a/extra': 'main', 'https://github.com/b/Extra.git': 'main' })
      ),
    ManifestValidationError
  );
});

Deno.test('dependency errors do not echo URL credentials', () => {
  for (const key of ['https://ghp_secret@github.com/org/..', 'https://user:pa@ss_secret@github.com/org/..']) {
    const error = assertThrows(() => getDependencyDirName(key), ManifestValidationError);
    assertEquals(/secret/.test(error.message), false, error.message);
  }
});

Deno.test('legitimate https dependency keys keep their directory names', () => {
  assertEquals(getDependencyDirName('https://github.com/yandy-r/praxrr-schema'), 'praxrr-schema');
  assertEquals(getDependencyDirName('https://github.com/yandy-r/praxrr-schema.git'), 'praxrr-schema');
  assertEquals(getDependencyDirName('https://github.com/yandy-r/praxrr-schema/'), 'praxrr-schema');
  assertEquals(getDependencyDirName(' https://github.com/org/schema.v2 '), 'schema.v2');
  validateManifest(manifestWith({ 'https://github.com/org/extra_dep': 'v1.2.3' }));
});

const SYMLINK_CASES: Array<[string, (pcdPath: string, outside: string) => Promise<void>]> = [
  ['deps/', (pcdPath, outside) => Deno.symlink(outside, `${pcdPath}/deps`)],
  [
    'deps/<name>',
    async (pcdPath, outside) => {
      await Deno.mkdir(`${pcdPath}/deps`);
      await Deno.symlink(outside, `${pcdPath}/deps/extra`);
    },
  ],
];

for (const [label, plant] of SYMLINK_CASES) {
  Deno.test(`a symlinked ${label} fails process/sync/validate closed`, async () => {
    await withTempPcd({ 'https://github.com/org/extra': 'main' }, async (pcdPath, root) => {
      const outside = `${root}/outside`;
      await Deno.mkdir(outside);
      await Deno.writeTextFile(`${outside}/keep.txt`, 'outside data');
      await plant(pcdPath, outside);

      await assertRejects(() => syncDependencies(pcdPath), DependencyError);
      await assertRejects(() => processDependencies(pcdPath), DependencyError);
      assertEquals(await validateDependencies(pcdPath), false);
      assertEquals(await snapshotTree(outside), ['keep.txt']);
    });
  });
}
