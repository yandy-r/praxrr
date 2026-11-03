/**
 * `importBaseOps` over real entity files: the path a first-run link and every sync take.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import { importBaseOps } from '$pcd/ops/importBaseOps.ts';
import type { EntityType, PortableCustomFormat, PortableEntityData } from '$shared/pcd/portable.ts';
import type { ConditionData } from '$shared/pcd/display.ts';
import {
  bundleTest,
  createPcd,
  customFormatData,
  liveCache,
  namesIn,
  qualityProfileData,
  regexData,
  scoredFormatNames,
  seedEntity,
  snapshotOps,
} from '../bundles/bundleTestHelpers.ts';

const PRAXRR_DB_ENTITIES = new URL('../../../../../praxrr-db/entities/', import.meta.url);

const ENTITY_DIRS: Partial<Record<EntityType, string>> = {
  regular_expression: 'regular-expressions',
  custom_format: 'custom-formats',
  quality_profile: 'quality-profiles',
};

function localPathOf(databaseId: number): string {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) throw new Error(`database ${databaseId} missing`);
  return instance.local_path;
}

async function copyTree(source: URL, target: string): Promise<number> {
  let files = 0;
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (entry.isDirectory) {
      files += await copyTree(new URL(`${entry.name}/`, source), `${target}/${entry.name}`);
    } else if (entry.isFile) {
      await Deno.copyFile(new URL(entry.name, source), `${target}/${entry.name}`);
      files += 1;
    }
  }
  return files;
}

function titleCondition(name: string, regexName: string): ConditionData {
  return {
    name,
    type: 'release_title',
    arrType: 'all',
    negate: false,
    required: true,
    patterns: [{ name: regexName, pattern: 'ignored-by-write' }],
  };
}

/** Write one repo entity file (JSON is valid YAML) the way an export lays it out. */
async function writeRepoEntity(
  localPath: string,
  entityType: EntityType,
  data: PortableEntityData,
  slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
): Promise<void> {
  const dir = `${localPath}/entities/${ENTITY_DIRS[entityType]}`;
  await Deno.mkdir(dir, { recursive: true });
  const payload = { migration: { format: 'yaml', version: 1, source: 'pcd-export' }, ...data };
  await Deno.writeTextFile(`${dir}/${slug}.yaml`, JSON.stringify(payload, null, 2));
}

bundleTest('importBaseOps: the bundled praxrr-db imports every entity with its full ladder', async () => {
  const started = performance.now();
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  const files = await copyTree(PRAXRR_DB_ENTITIES, `${localPath}/entities`);
  assert(files > 0, 'praxrr-db entities were copied');

  const result = await importBaseOps(databaseId, localPath);
  // Every entity file imports into an empty database; none is skipped, none is orphaned.
  assertEquals(result.imported, files, 'every praxrr-db/entities file must import');
  assertEquals(result.orphaned, 0);

  // 720p Quality's new upgrade-until group must replace the default Bluray-1080p cutoff.
  const cutoff = liveCache(databaseId).query<{ quality_group_name: string | null; quality_name: string | null }>(
    `SELECT quality_name, quality_group_name FROM quality_profile_qualities
     WHERE quality_profile_name = '720p Quality' AND upgrade_until = 1`
  );
  assertEquals(
    cutoff,
    [{ quality_name: null, quality_group_name: '720p Quality' }],
    'praxrr-db/entities/quality-profiles/720p-quality.yaml: its upgrade-until group must be the only cutoff'
  );
  console.log(`praxrr-db import: ${files} entities in ${Math.round(performance.now() - started)}ms`);
});

bundleTest('importBaseOps: references to skipped user-held entities are dropped and logged', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  // The user created these locally; upstream later ships entities with the same names, which the
  // import skips, plus a CF and a QP that reference them.
  await seedEntity(databaseId, 'regular_expression', regexData('Rx Shared'));
  await seedEntity(databaseId, 'custom_format', { ...customFormatData('CF Shared', 'Rx Shared'), conditions: [] });

  await writeRepoEntity(localPath, 'regular_expression', regexData('Rx Shared'));
  await writeRepoEntity(localPath, 'regular_expression', regexData('Rx Upstream'));
  const upstreamCf: PortableCustomFormat = {
    name: 'CF Upstream',
    description: null,
    includeInRename: false,
    tags: [],
    conditions: [titleCondition('dropped', 'Rx Shared'), titleCondition('kept', 'Rx Upstream')],
    tests: [],
  };
  await writeRepoEntity(localPath, 'custom_format', upstreamCf);
  await writeRepoEntity(localPath, 'custom_format', customFormatData('CF Shared', 'Rx Upstream'));
  await writeRepoEntity(localPath, 'quality_profile', qualityProfileData('QP Upstream', ['CF Shared', 'CF Upstream']));

  const warnings: Array<{ message: string; meta: unknown }> = [];
  const originalWarn = logger.warn;
  logger.warn = async (message, options) => {
    warnings.push({ message, meta: options?.meta });
  };
  try {
    await importBaseOps(databaseId, localPath);
  } finally {
    logger.warn = originalWarn;
  }

  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF Shared', 'CF Upstream']);
  // Only the condition on the skipped regex is dropped; the resolvable one is written.
  assertEquals(
    cache
      .query<{ name: string }>(
        "SELECT name FROM custom_format_conditions WHERE custom_format_name = 'CF Upstream' ORDER BY name"
      )
      .map((row) => row.name),
    ['kept']
  );
  // Only the score for the skipped CF is dropped.
  assertEquals(scoredFormatNames(cache, 'QP Upstream'), ['CF Upstream']);

  const dropWarnings = warnings.filter((warning) => warning.message.startsWith('Dropping'));
  assertEquals(dropWarnings, [
    {
      message: 'Dropping custom format conditions on skipped regular expressions',
      meta: {
        databaseId,
        entity: 'CF Upstream',
        regularExpressions: ['Rx Shared'],
        droppedConditions: ['dropped'],
      },
    },
    {
      message: 'Dropping quality profile scores for skipped custom formats',
      meta: { databaseId, entity: 'QP Upstream', customFormats: ['CF Shared'], droppedScores: ['CF Shared:radarr'] },
    },
  ]);
});

bundleTest('importBaseOps: a reference to a user entity the repo never ships fails the import', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  // Only names the import skipped are dropped. "Rx Mine" exists only as a user entity and upstream
  // never ships it, so the reference fails as it would on a fresh link.
  await seedEntity(databaseId, 'regular_expression', regexData('Rx Mine'));
  await writeRepoEntity(localPath, 'custom_format', customFormatData('CF Upstream', 'Rx Mine'));
  const before = snapshotOps(databaseId);

  const error = await assertRejects(() => importBaseOps(databaseId, localPath));
  assert(error instanceof Error);
  assert(error.message.includes('missing regular expression "Rx Mine"'), error.message);
  assertEquals(snapshotOps(databaseId), before);
});

bundleTest('importBaseOps: a repo reference differing only in case fails on sync as on link', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  // Link: upstream ships regex "Rx One". Sync: it adds a CF that misspells it as "rx one". The
  // registered cache now holds "Rx One", but so does the import cache, so this is a repo typo, not
  // a skipped user-held name: the sync fails exactly as a fresh link of the same repo would.
  await writeRepoEntity(localPath, 'regular_expression', regexData('Rx One'));
  await importBaseOps(databaseId, localPath);
  await writeRepoEntity(localPath, 'custom_format', customFormatData('CF Typo', 'rx one'));
  const before = snapshotOps(databaseId);

  const error = await assertRejects(() => importBaseOps(databaseId, localPath));
  assert(error instanceof Error);
  assert(error.message.includes('missing regular expression "rx one"'), error.message);
  // The failed import rolls back every op and history row it created (and invalidates the cache).
  assertEquals(snapshotOps(databaseId), before);
});

bundleTest('importBaseOps: a name differing only in non-ASCII case is never silently skipped on sync', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  // Link ships "éa"; a later sync adds "Éa". SQLite lower() folds ASCII only, so the conflict check
  // and the skip rule both treat them as distinct: the sync must not silently skip "Éa" as already
  // present. Entity create still rejects it as a duplicate (it compares lower(name) with JS
  // toLowerCase(), tracked as YAN-467), so the sync fails loudly and persists nothing.
  await writeRepoEntity(localPath, 'regular_expression', regexData('éa'), 'e-acute-lower');
  await importBaseOps(databaseId, localPath);
  await writeRepoEntity(localPath, 'regular_expression', regexData('Éa'), 'e-acute-upper');
  const before = snapshotOps(databaseId);

  const error = await assertRejects(() => importBaseOps(databaseId, localPath));
  assert(error instanceof Error);
  assert(error.message.includes('already exists'), error.message);
  assertEquals(snapshotOps(databaseId), before);
});
