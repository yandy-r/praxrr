import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import type { EntityType } from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import { enumerateMigrationEntities, enumerateMigrationEntityFamily } from '$pcd/migration/enumerateEntities.ts';

interface RowCatalog {
  readonly regularExpressions?: readonly string[];
  readonly customFormats?: readonly string[];
  readonly qualityProfiles?: readonly string[];
  readonly delayProfiles?: readonly string[];
  readonly radarrNaming?: readonly string[];
  readonly sonarrNaming?: readonly string[];
  readonly lidarrNaming?: readonly string[];
  readonly radarrMediaSettings?: readonly string[];
  readonly sonarrMediaSettings?: readonly string[];
  readonly lidarrMediaSettings?: readonly string[];
  readonly radarrQualityDefinitions?: readonly string[];
  readonly sonarrQualityDefinitions?: readonly string[];
  readonly lidarrQualityDefinitions?: readonly string[];
  readonly lidarrMetadataProfiles?: readonly string[];
}

function buildEnumerateFixture(catalog: RowCatalog = {}, queryLog: string[] = []): PCDCache {
  const rowsByTable = {
    regular_expressions: catalog.regularExpressions ?? [],
    custom_formats: catalog.customFormats ?? [],
    quality_profiles: catalog.qualityProfiles ?? [],
    delay_profiles: catalog.delayProfiles ?? [],
    radarr_naming: catalog.radarrNaming ?? [],
    sonarr_naming: catalog.sonarrNaming ?? [],
    lidarr_naming: catalog.lidarrNaming ?? [],
    radarr_media_settings: catalog.radarrMediaSettings ?? [],
    sonarr_media_settings: catalog.sonarrMediaSettings ?? [],
    lidarr_media_settings: catalog.lidarrMediaSettings ?? [],
    radarr_quality_definitions: catalog.radarrQualityDefinitions ?? [],
    sonarr_quality_definitions: catalog.sonarrQualityDefinitions ?? [],
    lidarr_quality_definitions: catalog.lidarrQualityDefinitions ?? [],
    lidarr_metadata_profiles: catalog.lidarrMetadataProfiles ?? [],
  };

  const query = ((sql: string): Array<{ name: string }> => {
    queryLog.push(sql);

    const entries = Object.entries(rowsByTable);
    for (const [table, names] of entries) {
      if (sql.includes(`FROM ${table}`)) {
        return names.map((name) => ({ name }));
      }
    }

    return [];
  }) as PCDCache['query'];

  const queryOne = (() => undefined) as PCDCache['queryOne'];

  return {
    isBuilt: () => true,
    query,
    queryOne,
  } as PCDCache;
}

Deno.test('enumerateEntities: supports filtering by selected entity types', () => {
  const queryLog: string[] = [];

  const descriptors = enumerateMigrationEntities(
    buildEnumerateFixture(
      {
        regularExpressions: ['Alpha Regex'],
        qualityProfiles: ['Quality Profile'],
        customFormats: ['Custom Format'],
      },
      queryLog
    ),
    {
      entityTypes: ['regular_expression', 'quality_profile'],
    }
  );

  assertEquals(
    descriptors.map((descriptor) => descriptor.entityType),
    ['regular_expression', 'quality_profile']
  );
  assertEquals(queryLog.length, 2);
  assertStringIncludes(queryLog[0] ?? '', 'FROM regular_expressions');
  assertStringIncludes(queryLog[1] ?? '', 'FROM quality_profiles');
});

Deno.test('enumerateEntities: throws for unsupported entity family', () => {
  const fixtures = buildEnumerateFixture({ regularExpressions: ['Alpha Regex'] });
  assertThrows(
    () => {
      enumerateMigrationEntityFamily(fixtures, 'not-an-entity' as EntityType);
    },
    Error,
    'Unsupported migration entity type for enumeration'
  );
});

Deno.test('enumerateEntities: uses SELECT DISTINCT for quality-definition family names', () => {
  const queryLog: string[] = [];

  enumerateMigrationEntityFamily(
    buildEnumerateFixture(
      {
        radarrQualityDefinitions: ['1080p', '1080p', '2160p'],
      },
      queryLog
    ),
    'radarr_quality_definitions'
  );

  enumerateMigrationEntityFamily(
    buildEnumerateFixture(
      {
        regularExpressions: ['Alpha', 'Alpha'],
      },
      queryLog
    ),
    'regular_expression'
  );

  assertStringIncludes(queryLog[0] ?? '', 'SELECT DISTINCT name FROM radarr_quality_definitions');
  assertStringIncludes(queryLog[1] ?? '', 'SELECT name FROM regular_expressions');
});

Deno.test('enumerateEntities: returns empty list when cache tables contain no names', () => {
  const descriptors = enumerateMigrationEntities(buildEnumerateFixture());
  assertEquals(descriptors.length, 0);
});
