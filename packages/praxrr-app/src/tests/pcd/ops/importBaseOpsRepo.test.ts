/**
 * `importBaseOps` over real entity files: the path a first-run link and every sync take.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
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
async function writeRepoEntity(localPath: string, entityType: EntityType, data: PortableEntityData): Promise<void> {
  const dir = `${localPath}/entities/${ENTITY_DIRS[entityType]}`;
  await Deno.mkdir(dir, { recursive: true });
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const payload = { migration: { format: 'yaml', version: 1, source: 'pcd-export' }, ...data };
  await Deno.writeTextFile(`${dir}/${slug}.yaml`, JSON.stringify(payload, null, 2));
}

bundleTest('importBaseOps: the bundled praxrr-db imports every entity with its full ladder', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  const files = await copyTree(PRAXRR_DB_ENTITIES, `${localPath}/entities`);
  assert(files > 0, 'praxrr-db entities were copied');

  const result = await importBaseOps(databaseId, localPath);
  assert(result.imported > 0);

  // 720p Quality's new upgrade-until group must replace the default Bluray-1080p cutoff.
  const cutoff = liveCache(databaseId).query<{ quality_group_name: string | null; quality_name: string | null }>(
    `SELECT quality_name, quality_group_name FROM quality_profile_qualities
     WHERE quality_profile_name = '720p Quality' AND upgrade_until = 1`
  );
  assertEquals(cutoff, [{ quality_name: null, quality_group_name: '720p Quality' }]);
});

bundleTest('importBaseOps: references to user-only entities are dropped, never block the sync', async () => {
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

  await importBaseOps(databaseId, localPath);

  const cache = liveCache(databaseId);
  assertEquals(namesIn(cache, 'custom_formats'), ['CF Shared', 'CF Upstream']);
  // Only the condition on the user-only regex is dropped; the resolvable one is written.
  assertEquals(
    cache
      .query<{ name: string }>(
        "SELECT name FROM custom_format_conditions WHERE custom_format_name = 'CF Upstream' ORDER BY name"
      )
      .map((row) => row.name),
    ['kept']
  );
  // Only the score for the user-only CF is dropped.
  assertEquals(scoredFormatNames(cache, 'QP Upstream'), ['CF Upstream']);
});

bundleTest('importBaseOps: a repo reference differing only in case fails on sync as on link', async () => {
  const databaseId = await createPcd();
  const localPath = localPathOf(databaseId);
  // Link: upstream ships regex "Rx One". Sync: it adds a CF that misspells it as "rx one". The
  // registered cache now holds "Rx One", but so does the import cache, so this is a repo typo, not
  // a user-only reference: the sync fails exactly as a fresh link of the same repo would.
  await writeRepoEntity(localPath, 'regular_expression', regexData('Rx One'));
  await importBaseOps(databaseId, localPath);
  await writeRepoEntity(localPath, 'custom_format', customFormatData('CF Typo', 'rx one'));
  const before = snapshotOps(databaseId);

  const error = await assertRejects(() => importBaseOps(databaseId, localPath));
  assert(error instanceof Error);
  assert(error.message.includes('missing regular expression "rx one"'), error.message);
  // The failed import rolls back (and invalidates the cache): no op survives.
  assertEquals(snapshotOps(databaseId).ops, before.ops);
});
