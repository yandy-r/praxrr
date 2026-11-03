// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { getCache } from '$pcd/database/registry.ts';
import type { SearchResponse, SearchResult } from '$shared/search/types.ts';
import { GET } from '../../routes/api/v1/search/+server.ts';

type SearchGetEvent = Parameters<typeof GET>[0];

const SCHEMA_OPS_DIR = new URL('../../../../praxrr-schema/ops/', import.meta.url);

let createdPcdIds: number[] = [];

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/search-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);
      createdPcdIds = [];

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        for (const id of createdPcdIds) invalidate(id);
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

/** Link a PCD database backed by the real schema ops, compile its cache, and seed rows via SQL. */
async function createPcd(name: string, seedSql = ''): Promise<number> {
  const localPath = `${config.paths.base}/pcd-${crypto.randomUUID()}`;
  const schemaDir = `${localPath}/deps/schema/ops`;
  await Deno.mkdir(schemaDir, { recursive: true });
  for await (const entry of Deno.readDir(SCHEMA_OPS_DIR)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      await Deno.copyFile(new URL(entry.name, SCHEMA_OPS_DIR), `${schemaDir}/${entry.name}`);
    }
  }
  const id = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name,
    repositoryUrl: 'https://example.com/db.git',
    localPath,
    localOpsEnabled: false,
  });
  createdPcdIds.push(id);
  await compile(localPath, id);
  if (seedSql) {
    const raw = getCache(id)?.getRawDb();
    assertExists(raw, `cache for ${name} must be built`);
    raw.exec(seedSql);
  }
  return id;
}

function createTrashSource(name: string, arrType: 'radarr' | 'sonarr'): number {
  return trashGuideSourcesQueries.create({
    name,
    repositoryUrl: `https://example.com/${name}.git`,
    localPath: `${config.paths.base}/trash-${crypto.randomUUID()}`,
    arrType,
  });
}

function seedTrashEntity(
  sourceId: number,
  entityType: 'custom_format' | 'quality_profile',
  trashId: string,
  name: string
): void {
  trashGuideEntityCacheQueries.upsert({
    sourceId,
    trashId,
    entityType,
    name,
    jsonData: '{}',
    filePath: `${trashId}.json`,
    contentHash: trashId,
  });
}

function event(query: string): SearchGetEvent {
  return { url: new URL(`http://localhost/api/v1/search?${query}`) } as unknown as SearchGetEvent;
}

async function searchOk(query: string): Promise<SearchResponse> {
  const response = await GET(event(query));
  assertEquals(response.status, 200, await response.clone().text());
  assertEquals(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as SearchResponse;
}

async function expectBadRequest(query: string): Promise<void> {
  const response = await GET(event(query));
  assertEquals(response.status, 400, `expected 400 for "${query}"`);
  const body = (await response.json()) as { error: unknown };
  assertEquals(typeof body.error, 'string');
}

const names = (results: SearchResult[]): string[] => results.map((result) => result.name);

const sql = (value: string): string => `'${value.replaceAll("'", "''")}'`;

function customFormatsSql(...formatNames: string[]): string {
  return formatNames.map((name) => `INSERT INTO custom_formats (name) VALUES (${sql(name)});`).join('\n');
}

function qualityProfileSql(name: string, qualityName: string): string {
  return `
    INSERT INTO quality_profiles (name) VALUES (${sql(name)});
    INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, position, enabled)
      VALUES (${sql(name)}, ${sql(qualityName)}, 0, 1);
  `;
}

migratedTest('search ranks exact > prefix > word-prefix > substring, then name, case-insensitively', async () => {
  // Arrange
  await createPcd(
    'Main DB',
    customFormatsSql('xHDRx', 'Dolby HDR Plus', 'HDR10', 'hdr', 'HDR', 'Unrelated', 'Atmos HDR')
  );

  // Act
  const body = await searchOk('q=HdR&types=custom_format');

  // Assert
  assertEquals(body.query, 'HdR');
  assertEquals(names(body.results), ['hdr', 'HDR', 'HDR10', 'Atmos HDR', 'Dolby HDR Plus', 'xHDRx']);
  assertEquals(body.truncated, false);
});

migratedTest('search treats % and _ literally and trims the query', async () => {
  // Arrange
  await createPcd('Main DB', customFormatsSql('100% Real', '100 Real', 'snake_case', 'snakeXcase'));

  // Act
  const percent = await searchOk(`q=${encodeURIComponent('  100%  ')}&types=custom_format`);
  const underscore = await searchOk(`q=${encodeURIComponent('e_c')}&types=custom_format`);
  const wildcardOnly = await searchOk(`q=${encodeURIComponent('%')}&types=custom_format`);

  // Assert
  assertEquals(percent.query, '100%');
  assertEquals(names(percent.results), ['100% Real']);
  assertEquals(names(underscore.results), ['snake_case']);
  assertEquals(names(wildcardOnly.results), ['100% Real']);
});

migratedTest('search builds edit hrefs and stable ids for every PCD entity type', async () => {
  // Arrange
  const databaseId = await createPcd(
    'Main DB',
    `
      ${customFormatsSql('Alpha CF')}
      ${qualityProfileSql('Alpha QP', 'Bluray-1080p')}
      INSERT INTO regular_expressions (name, pattern) VALUES ('Alpha Regex', 'x264');
      INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay)
        VALUES ('Alpha Delay/1 & 2', 'prefer_usenet', 0, 0);
      INSERT INTO lidarr_metadata_profiles (name) VALUES ('Alpha Meta #1');
    `
  );

  // Act
  const body = await searchOk('q=alpha');
  const byType = new Map(body.results.map((result) => [result.type, result]));

  // Assert
  const cf = byType.get('custom_format');
  assertExists(cf);
  assert(/^pcd:\d+:custom_format:\d+$/.test(cf.id));
  assertEquals(cf.href, `/custom-formats/${databaseId}/${cf.id.split(':')[3]}`);
  assertEquals(cf.source, { type: 'pcd', id: databaseId, name: 'Main DB' });

  const qp = byType.get('quality_profile');
  assertExists(qp);
  assertEquals(qp.href, `/quality-profiles/${databaseId}/${qp.id.split(':')[3]}/general`);

  const regex = byType.get('regular_expression');
  assertExists(regex);
  assertEquals(regex.href, `/regular-expressions/${databaseId}/${regex.id.split(':')[3]}`);

  assertEquals(byType.get('delay_profile')?.href, `/delay-profiles/${databaseId}/Alpha%20Delay%2F1%20%26%202`);
  assertEquals(byType.get('metadata_profile')?.href, `/metadata-profiles/${databaseId}/Alpha%20Meta%20%231`);
});

migratedTest(
  'search arrType filter applies quality compatibility and hides metadata profiles outside Lidarr',
  async () => {
    // Arrange
    await createPcd(
      'Main DB',
      `
      ${qualityProfileSql('Movie HD', 'Bluray-1080p')}
      ${qualityProfileSql('Music Lossless', 'FLAC')}
      INSERT INTO lidarr_metadata_profiles (name) VALUES ('Music Standard');
    `
    );

    // Act
    const radarr = await searchOk('q=m&types=quality_profile,metadata_profile&arrType=radarr');
    const lidarr = await searchOk('q=m&types=quality_profile,metadata_profile&arrType=lidarr');
    const all = await searchOk('q=m&types=quality_profile,metadata_profile');

    // Assert
    assertEquals(names(radarr.results), ['Movie HD']);
    assertEquals(
      lidarr.results.map((result) => `${result.type}:${result.name}`),
      ['quality_profile:Music Lossless', 'metadata_profile:Music Standard']
    );
    assertEquals(names(all.results), ['Movie HD', 'Music Lossless', 'Music Standard']);
  }
);

migratedTest('search types and databaseId filters scope results', async () => {
  // Arrange
  const firstId = await createPcd('First DB', customFormatsSql('Shared Name'));
  const secondId = await createPcd(
    'Second DB',
    `${customFormatsSql('Shared Name')} INSERT INTO regular_expressions (name, pattern) VALUES ('Shared Regex', 'x');`
  );
  const trashId = createTrashSource('TRaSH Radarr', 'radarr');
  seedTrashEntity(trashId, 'custom_format', 'abc123', 'Shared Trash');

  // Act
  const scoped = await searchOk(`q=shared&databaseId=${secondId}`);
  const typed = await searchOk('q=shared&types=regular_expression');
  const unknownDb = await searchOk(`q=shared&databaseId=${firstId + secondId + 100}`);

  // Assert
  assertEquals(
    scoped.results.map((result) => [result.type, result.source?.id]),
    [
      ['custom_format', secondId],
      ['regular_expression', secondId],
    ]
  );
  assertEquals(
    typed.results.map((result) => result.name),
    ['Shared Regex']
  );
  assertEquals(unknownDb.results, []);
});

migratedTest('search returns TRaSH entities with source badge data and respects arrType', async () => {
  // Arrange
  const radarrSource = createTrashSource('TRaSH Radarr', 'radarr');
  const sonarrSource = createTrashSource('TRaSH Sonarr', 'sonarr');
  seedTrashEntity(radarrSource, 'custom_format', 'aaa111', 'Remux Tier 01');
  seedTrashEntity(radarrSource, 'quality_profile', 'bbb222', 'Remux + WEB 1080p');
  seedTrashEntity(sonarrSource, 'custom_format', 'ccc333', 'Remux Tier 02');

  // Act
  const radarr = await searchOk('q=remux&arrType=radarr');
  const lidarr = await searchOk('q=remux&arrType=lidarr');
  const all = await searchOk('q=remux');

  // Assert
  assertEquals(names(radarr.results), ['Remux + WEB 1080p', 'Remux Tier 01']);
  const cf = radarr.results.find((result) => result.type === 'custom_format');
  assertExists(cf);
  assertEquals(cf.id, `trash:${radarrSource}:custom_format:aaa111`);
  assertEquals(cf.href, `/databases/trash/${radarrSource}/custom-formats/aaa111/`);
  assertEquals(cf.source, { type: 'trash', id: radarrSource, name: 'TRaSH Radarr', arrType: 'radarr' });
  assertEquals(cf.arrType, 'radarr');
  assertEquals(
    radarr.results.find((result) => result.type === 'quality_profile')?.href,
    `/databases/trash/${radarrSource}/quality-profiles/bbb222/`
  );
  assertEquals(lidarr.results, []);
  assertEquals(names(all.results), ['Remux + WEB 1080p', 'Remux Tier 01', 'Remux Tier 02']);
});

migratedTest('search returns Arr instances and databases without credentials or URLs', async () => {
  // Arrange
  const databaseId = await createPcd('Living Room DB');
  const radarrId = arrInstancesQueries.create({
    name: 'Living Room Radarr',
    type: 'radarr',
    url: 'http://radarr.internal:7878',
    apiKey: 'super-secret-api-key',
  });
  arrInstancesQueries.create({
    name: 'Living Room Sonarr',
    type: 'sonarr',
    url: 'http://sonarr.internal:8989',
    apiKey: 'another-secret',
  });

  // Act
  const response = await GET(event('q=living'));
  const raw = await response.clone().text();
  const body = (await response.json()) as SearchResponse;
  const radarrOnly = await searchOk('q=living&types=arr_instance&arrType=radarr');

  // Assert
  assertEquals(response.status, 200);
  assert(!raw.includes('secret'), 'api keys must never appear in search output');
  assert(!raw.includes('internal'), 'instance URLs must never appear in search output');
  const radarr = body.results.find((result) => result.id === `arr:${radarrId}`);
  assertExists(radarr);
  assertEquals(Object.keys(radarr).sort(), ['arrType', 'href', 'id', 'name', 'source', 'type']);
  assertEquals(radarr, {
    type: 'arr_instance',
    id: `arr:${radarrId}`,
    name: 'Living Room Radarr',
    href: `/arr/${radarrId}`,
    source: null,
    arrType: 'radarr',
  });
  assertEquals(
    body.results.find((result) => result.type === 'database'),
    {
      type: 'database',
      id: `database:${databaseId}`,
      name: 'Living Room DB',
      href: `/databases/${databaseId}`,
      source: null,
    }
  );
  assertEquals(names(radarrOnly.results), ['Living Room Radarr']);
});

migratedTest('search caps results at limit and reports truncation', async () => {
  // Arrange
  await createPcd('Main DB', customFormatsSql('Item 10', 'Item 2', 'Item 1', 'Item 3'));

  // Act
  const limited = await searchOk('q=item&types=custom_format&limit=2');
  const exact = await searchOk('q=item&types=custom_format&limit=4');

  // Assert
  assertEquals(names(limited.results), ['Item 1', 'Item 2']);
  assertEquals(limited.truncated, true);
  assertEquals(names(exact.results), ['Item 1', 'Item 2', 'Item 3', 'Item 10']);
  assertEquals(exact.truncated, false);
});

migratedTest('search reserves per-type slots so a dense type cannot crowd out others', async () => {
  // Arrange: 30 custom formats rank ahead of the single Arr instance by name.
  const formatNames = Array.from({ length: 30 }, (_, index) => `Match ${String(index + 1).padStart(2, '0')}`);
  await createPcd('Main DB', customFormatsSql(...formatNames));
  const instanceId = arrInstancesQueries.create({
    name: 'Match Radarr',
    type: 'radarr',
    url: 'http://radarr.internal:7878',
    apiKey: 'key',
  });

  // Act
  const body = await searchOk('q=match&limit=20');

  // Assert: 7 requested types -> cap max(3, ceil(20 / 7)) = 3, then backfilled in rank order.
  assertEquals(body.results.length, 20);
  assertEquals(names(body.results), [...formatNames.slice(0, 19), 'Match Radarr']);
  assertEquals(body.results.at(-1)?.id, `arr:${instanceId}`);
  assertEquals(body.truncated, true);
});

migratedTest('search skips databases whose cache is not built', async () => {
  // Arrange
  const loadedId = await createPcd('Loaded DB', customFormatsSql('Found Me'));
  const missingId = await createPcd('Missing DB', customFormatsSql('Found Me Too'));
  invalidate(missingId);

  // Act
  const body = await searchOk('q=found&types=custom_format');

  // Assert
  assertEquals(
    body.results.map((result) => result.source?.id),
    [loadedId]
  );
});

migratedTest('search skips a database whose cache fails mid-query and still answers 200', async () => {
  // Arrange: one cache throws on access (as when invalidated between isBuilt() and the query).
  const healthyId = await createPcd('Healthy DB', customFormatsSql('Shared Name'));
  const brokenId = await createPcd('Broken DB', customFormatsSql('Shared Name Broken'));
  const broken = getCache(brokenId);
  assertExists(broken);
  Object.defineProperty(broken, 'kb', {
    configurable: true,
    get() {
      throw new Error('Cache not built');
    },
  });
  const instanceId = arrInstancesQueries.create({
    name: 'Shared Radarr',
    type: 'radarr',
    url: 'http://radarr.internal:7878',
    apiKey: 'key',
  });

  // Act
  const response = await GET(event('q=shared&types=custom_format,arr_instance'));
  const body = (await response.json()) as SearchResponse;

  // Assert
  assertEquals(response.status, 200);
  assertEquals(
    body.results.map((result) => [result.type, result.name, result.source?.id ?? null]),
    [
      ['custom_format', 'Shared Name', healthyId],
      ['arr_instance', 'Shared Radarr', null],
    ]
  );
  assertEquals(body.results[1].id, `arr:${instanceId}`);
  assertEquals(body.truncated, false);
});

migratedTest('search rejects invalid parameters with 400', async () => {
  // Arrange
  const tooLong = 'a'.repeat(101);

  // Act + Assert
  await expectBadRequest('');
  await expectBadRequest('q=');
  await expectBadRequest(`q=${encodeURIComponent('   ')}`);
  await expectBadRequest(`q=${tooLong}`);
  await expectBadRequest('q=a&limit=0');
  await expectBadRequest('q=a&limit=51');
  await expectBadRequest('q=a&limit=abc');
  await expectBadRequest('q=a&limit=2.5');
  await expectBadRequest('q=a&types=custom_format,bogus');
  await expectBadRequest('q=a&types=');
  await expectBadRequest('q=a&arrType=whisparr');
  await expectBadRequest('q=a&databaseId=0');
  await expectBadRequest('q=a&databaseId=-1');
  await expectBadRequest('q=a&databaseId=x');
  const accepted = await searchOk(`q=${'a'.repeat(100)}&limit=50`);
  assertEquals(accepted.results, []);
});
