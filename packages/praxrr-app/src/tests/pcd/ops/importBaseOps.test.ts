import { assertEquals, assertThrows } from '@std/assert';
import { config } from '$config';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import * as importBaseOpsModule from '$pcd/ops/importBaseOps.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import type { MigrationEntityCandidate, MigrationEntityStableIdentity } from '$pcd/migration/reader.ts';

type Restore = () => void;

type TestStableIdentity = MigrationEntityStableIdentity;

const duplicateIdentity: TestStableIdentity = {
  key: 'quality_profile_name',
  value: 'Existing Profile',
  kind: 'stable',
};

const migrationEntry = (identity: TestStableIdentity | null, sourcePath: string) => ({
  stableIdentity: identity,
  sourcePath,
});

const sqlEntry = (identity: TestStableIdentity | null, name: string) => ({
  name,
  filepath: `/tmp/${name}`,
  opNumber: 1,
  sequence: 100,
  cleanedSql: 'SELECT 1',
  metadataJson: null,
  contentHash: 'hash',
  stableIdentity: identity,
});

const { __testOnly_validateStableIdentityConflicts, __testOnly_parseMetadata, __testOnly_parseStableIdentityFromText } =
  importBaseOpsModule;

const { __testOnly_parseStableIdentityFromObject, __testOnly_deriveSqlStableIdentity, importBaseOps } =
  importBaseOpsModule;
const {
  __testOnly_setReadMigrationEntitySources,
  __testOnly_resetReadMigrationEntitySources,
  __testOnly_setCompile,
  __testOnly_resetCompile,
  __testOnly_setWithRepoImportWriteContext,
  __testOnly_resetWithRepoImportWriteContext,
  __testOnly_setGetCache,
  __testOnly_resetGetCache,
} = importBaseOpsModule;

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('importBaseOps: validateStableIdentityConflicts detects SQL/SQL duplicates', () => {
  assertThrows(
    () =>
      __testOnly_validateStableIdentityConflicts(
        [sqlEntry(duplicateIdentity, '001-base.sql'), sqlEntry(duplicateIdentity, '002-base.sql')],
        []
      ),
    Error,
    'sql/duplicate'
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts detects migration/migration duplicates', () => {
  assertThrows(
    () =>
      __testOnly_validateStableIdentityConflicts(
        [],
        [
          migrationEntry(duplicateIdentity, '/path/entity-1.yaml'),
          migrationEntry(duplicateIdentity, '/path/entity-2.yaml'),
        ]
      ),
    Error,
    'migration/duplicate'
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts allows cross-source duplicates', () => {
  __testOnly_validateStableIdentityConflicts(
    [sqlEntry(duplicateIdentity, '001-base.sql')],
    [migrationEntry(duplicateIdentity, '/path/entity.yaml')]
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts allows distinct identities', () => {
  const migrationIdentity: TestStableIdentity = { key: 'radarr_naming_name', value: 'Radarr naming', kind: 'stable' };
  const sqlIdentity: TestStableIdentity = { key: 'sonarr_naming_name', value: 'Sonarr naming', kind: 'stable' };

  __testOnly_validateStableIdentityConflicts(
    [sqlEntry(sqlIdentity, '001-base.sql')],
    [migrationEntry(migrationIdentity, '/path/entity.yaml')]
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts ignores null stable identities', () => {
  __testOnly_validateStableIdentityConflicts(
    [sqlEntry(null, '001-base.sql')],
    [migrationEntry(null, '/path/entity.yaml')]
  );
});

Deno.test('importBaseOps: parseMetadata extracts known migration metadata and strips annotation comments', () => {
  const sql = [
    '-- @operation: create',
    '-- @entity: custom_format',
    '-- @name: Custom Format',
    '-- @stable_key: custom_format_name=Custom Format',
    "INSERT INTO custom_formats (name) VALUES ('Custom Format');",
    '-- not a metadata comment',
  ].join('\n');

  const result = __testOnly_parseMetadata(sql);
  const metadata = result.metadataJson ? JSON.parse(result.metadataJson) : null;

  assertEquals(
    result.cleanedSql,
    "INSERT INTO custom_formats (name) VALUES ('Custom Format');\n-- not a metadata comment"
  );
  assertEquals(metadata, {
    operation: 'create',
    entity: 'custom_format',
    name: 'Custom Format',
    stable_key: 'custom_format_name=Custom Format',
  });
});

Deno.test('importBaseOps: parseMetadata returns null metadata when required fields are missing', () => {
  const sql = ['-- @operation: create', "INSERT INTO custom_formats (name) VALUES ('Custom Format');"].join('\n');

  const result = __testOnly_parseMetadata(sql);

  assertEquals(result.metadataJson, null);
  assertEquals(result.cleanedSql, "INSERT INTO custom_formats (name) VALUES ('Custom Format');");
});

Deno.test('importBaseOps: parseStableIdentityFromText supports json and key=value fallbacks', () => {
  assertEquals(__testOnly_parseStableIdentityFromText('{"key":"custom_format_name","value":"Custom Format"}'), {
    key: 'custom_format_name',
    value: 'Custom Format',
    kind: 'stable',
  });

  assertEquals(__testOnly_parseStableIdentityFromText('custom_format_name=Custom Format'), {
    key: 'custom_format_name',
    value: 'Custom Format',
    kind: 'stable',
  });

  assertEquals(__testOnly_parseStableIdentityFromText('not-a-valid-identity'), null);
});

Deno.test('importBaseOps: parseStableIdentityFromObject resolves key/value and stable_key object values', () => {
  assertEquals(__testOnly_parseStableIdentityFromObject({ key: 'custom_format_name', value: 'Custom Format' }), {
    key: 'custom_format_name',
    value: 'Custom Format',
    kind: 'stable',
  });

  assertEquals(
    __testOnly_parseStableIdentityFromObject({
      stable_key: { key: 'quality_profile_name', value: 'Quality A' },
      entity: 'radarr_quality_profiles',
      name: 'Profile A',
    } as unknown as Record<string, unknown>),
    { key: 'quality_profile_name', value: 'Quality A', kind: 'stable' }
  );

  assertEquals(
    __testOnly_parseStableIdentityFromObject({ entity: 'custom_format', name: 'Legacy Format' } as Record<
      string,
      unknown
    >),
    null
  );
});

Deno.test('importBaseOps: deriveSqlStableIdentity parses metadata json and throws on malformed JSON', () => {
  assertEquals(
    __testOnly_deriveSqlStableIdentity(
      JSON.stringify({
        stable_key: 'custom_format_name=Custom Format',
        operation: 'create',
        entity: 'custom_format',
        name: 'Custom Format',
      }),
      '/tmp/valid.sql'
    ),
    { key: 'custom_format_name', value: 'Custom Format', kind: 'stable' }
  );

  assertEquals(
    __testOnly_deriveSqlStableIdentity(
      JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Fallback Format' }),
      '/tmp/fallback.sql'
    ),
    { key: 'custom_format_name', value: 'Fallback Format', kind: 'stable' }
  );

  assertThrows(
    () => __testOnly_deriveSqlStableIdentity('{invalid-json', '/tmp/bad.sql'),
    Error,
    'Malformed SQL metadata JSON for /tmp/bad.sql'
  );
});

Deno.test('importBaseOps: hybrid mode suppresses SQL entries when migration identity overlaps', async () => {
  const restores: Restore[] = [];
  const databaseId = 9201;
  const createdFromSql: string[] = [];
  const deserializeCalls: string[] = [];
  const tempDir = await Deno.makeTempDir({ prefix: 'importBaseOps-hybrid-' });

  try {
    const basePath = `${tempDir}/base`;
    const entitiesPath = `${tempDir}/entities`;
    await Deno.mkdir(basePath, { recursive: true });
    await Deno.mkdir(entitiesPath, { recursive: true });

    const stableName = 'Shared Custom Format';
    const stableIdentity: TestStableIdentity = {
      key: 'custom_format_name',
      value: stableName,
      kind: 'stable',
    };

    const candidate = {
      stableIdentity,
      sourcePath: `${entitiesPath}/custom-formats/shared.yaml`,
      relativePath: 'custom-formats/shared.yaml',
      portable: {},
      deserialize: async () => {
        deserializeCalls.push(stableName);
        return { success: true };
      },
    } as unknown as MigrationEntityCandidate;

    await Deno.writeTextFile(
      `${basePath}/001-base.sql`,
      [
        '-- @operation: create',
        '-- @entity: custom_format',
        `-- @name: ${stableName}`,
        '-- @stable_key: custom_format_name=Shared Custom Format',
      ].join('\n') + '\nINSERT INTO custom_formats (name) VALUES ("Shared Custom Format");'
    );

    const configMutable = config as unknown as { pcdMigrationAllowLegacyFallback: boolean };
    patch(configMutable, 'pcdMigrationAllowLegacyFallback', true, restores);

    __testOnly_setGetCache(
      () => ({ getRawDb: (() => ({})) as unknown as PCDCache['getRawDb'] }) as unknown as PCDCache
    );
    restores.push(__testOnly_resetGetCache);
    __testOnly_setReadMigrationEntitySources(async () => ({ candidates: [candidate], issues: [] }));
    restores.push(__testOnly_resetReadMigrationEntitySources);
    patch(
      pcdOpsQueries,
      'create',
      (input) => {
        createdFromSql.push(input.filename ?? '');
        return createdFromSql.length;
      },
      restores
    );
    patch(pcdOpsQueries, 'getBaseByFilename', () => undefined, restores);
    patch(pcdOpsQueries, 'listByDatabaseAndOrigin', () => [], restores);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0, restores);
    patch(pcdOpsQueries, 'update', () => true, restores);
    __testOnly_setCompile(async () => ({ schema: 0, base: 0, tweaks: 0, user: 0, timing: 0 }));
    restores.push(__testOnly_resetCompile);
    __testOnly_setWithRepoImportWriteContext(
      async (
        _context: {
          filenamePrefix: string;
          sequenceStart: number;
          maxOperations: number;
          lastSeenInRepoAt: string;
        },
        callback: () => Promise<unknown>
      ) => {
        return await callback();
      }
    );
    restores.push(__testOnly_resetWithRepoImportWriteContext);

    const result = await importBaseOps(databaseId, tempDir, { pcdMigrationIngestionMode: 'hybrid' });

    assertEquals(result.created, 0);
    assertEquals(createdFromSql.length, 0);
    assertEquals(deserializeCalls, [stableName]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});
