import { assertEquals } from '@std/assert';

import {
  __testOnly_inferFormatFromPath,
  __testOnly_isolatePortablePayload,
  __testOnly_listEntityFiles,
  __testOnly_resolveEntityType,
  readMigrationEntitySources,
  __testOnly_extractEntityName,
} from '$pcd/migration/reader.ts';

Deno.test('reader: resolveEntityType maps top-level directories and media subdirectories', () => {
  assertEquals(__testOnly_resolveEntityType('regular-expressions/file.json'), {
    entityType: 'regular_expression',
    kind: 'top-level',
  });
  assertEquals(__testOnly_resolveEntityType('custom-formats/file.json'), {
    entityType: 'custom_format',
    kind: 'top-level',
  });
  assertEquals(__testOnly_resolveEntityType('quality-profiles/file.json'), {
    entityType: 'quality_profile',
    kind: 'top-level',
  });
  assertEquals(__testOnly_resolveEntityType('delay-profiles/file.json'), {
    entityType: 'delay_profile',
    kind: 'top-level',
  });

  assertEquals(__testOnly_resolveEntityType('media-management/radarr-naming/file.yaml'), {
    entityType: 'radarr_naming',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/sonarr-naming/file.yaml'), {
    entityType: 'sonarr_naming',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/lidarr-naming/file.yaml'), {
    entityType: 'lidarr_naming',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/radarr-media-settings/file.yaml'), {
    entityType: 'radarr_media_settings',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/sonarr-media-settings/file.yaml'), {
    entityType: 'sonarr_media_settings',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/lidarr-media-settings/file.yaml'), {
    entityType: 'lidarr_media_settings',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/radarr-quality-definitions/file.yaml'), {
    entityType: 'radarr_quality_definitions',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/sonarr-quality-definitions/file.yaml'), {
    entityType: 'sonarr_quality_definitions',
    kind: 'media-management',
  });
  assertEquals(__testOnly_resolveEntityType('media-management/lidarr-quality-definitions/file.yaml'), {
    entityType: 'lidarr_quality_definitions',
    kind: 'media-management',
  });

  assertEquals(
    __testOnly_resolveEntityType('metadata-profiles/lidarr/file.json')?.entityType,
    'lidarr_metadata_profile'
  );
  assertEquals(__testOnly_resolveEntityType('metadata-profiles/radarr/file.json'), null);
});

Deno.test('reader: inferFormatFromPath accepts json/yaml extensions and rejects unsupported formats', () => {
  assertEquals(__testOnly_inferFormatFromPath('/tmp/entity.json'), 'json');
  assertEquals(__testOnly_inferFormatFromPath('/tmp/entity.yaml'), 'yaml');
  assertEquals(__testOnly_inferFormatFromPath('/tmp/entity.yml'), 'yaml');
  assertEquals(__testOnly_inferFormatFromPath('/tmp/entity.txt'), null);
  assertEquals(__testOnly_inferFormatFromPath('/tmp/entity.xml'), null);
});

Deno.test('reader: extractEntityName requires non-empty string', () => {
  assertEquals(__testOnly_extractEntityName({ name: 'Example' }), 'Example');
  assertEquals(__testOnly_extractEntityName({ name: '' }), null);
  assertEquals(__testOnly_extractEntityName({ name: '   ' }), null);
  assertEquals(__testOnly_extractEntityName({ name: 123 as unknown as string }), null);
  assertEquals(__testOnly_extractEntityName({ name: null as unknown as string }), null);
  assertEquals(__testOnly_extractEntityName({} as unknown as { name: unknown }), null);
});

Deno.test('reader: isolatePortablePayload drops migration wrapper and rejects non-object payloads', () => {
  assertEquals(__testOnly_isolatePortablePayload([] as unknown as object), null);
  assertEquals(__testOnly_isolatePortablePayload(null), null);
  assertEquals(__testOnly_isolatePortablePayload(123), null);
  assertEquals(__testOnly_isolatePortablePayload('portable'), null);

  const payload = {
    migration: { source: 1 },
    name: 'Example',
    pattern: 'abc',
  };

  assertEquals(__testOnly_isolatePortablePayload(payload), {
    name: 'Example',
    pattern: 'abc',
  });
});

Deno.test('reader: listEntityFiles recursively traverses nested directories', async () => {
  const tempDir = `/tmp/praxrr-tests/reader-list-files-${crypto.randomUUID()}`;
  const files = [
    `${tempDir}/level1/nested.yaml`,
    `${tempDir}/level1/level2/deep.json`,
    `${tempDir}/level1/level2/level3/deepest.yml`,
  ];

  try {
    await Deno.mkdir(`${tempDir}/level1/level2/level3`, { recursive: true });
    await Promise.all(files.map((filePath) => Deno.writeTextFile(filePath, 'content')));

    const discovered = await __testOnly_listEntityFiles(tempDir);
    const relative = discovered.map((filePath) => filePath.replace(`${tempDir}/`, ''));
    assertEquals(relative.sort(), files.map((filePath) => filePath.replace(`${tempDir}/`, '')).sort());
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('reader: readMigrationEntitySources parses supported migration entities', async () => {
  const tempDir = `/tmp/praxrr-tests/reader-read-sources-${crypto.randomUUID()}`;
  const entitiesPath = `${tempDir}/entities`;
  const entityFile = `${entitiesPath}/regular-expressions/r1.json`;
  const payload = {
    name: 'Regex-One',
    pattern: '^abc$',
    tags: [],
    description: null,
    regex101Id: null,
  };

  try {
    await Deno.mkdir(`${entitiesPath}/regular-expressions`, { recursive: true });
    await Deno.writeTextFile(entityFile, JSON.stringify(payload));

    const result = await readMigrationEntitySources(tempDir);

    assertEquals(result.issues, []);
    assertEquals(result.candidates.length, 1);
    assertEquals(result.candidates[0].relativePath, 'regular-expressions/r1.json');
    assertEquals(result.candidates[0].entityType, 'regular_expression');
    assertEquals(result.candidates[0].entityName, 'Regex-One');
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('reader: praxrr-db includes first-class Lidarr entity YAML coverage', async () => {
  const repoRoot = new URL('../../../../../../', import.meta.url);
  const entitiesDir = new URL('packages/praxrr-db/entities/', repoRoot);
  const requiredFiles = [
    'media-management/lidarr-naming/lidarr.yaml',
    'media-management/lidarr-media-settings/lidarr.yaml',
    'media-management/lidarr-quality-definitions/lidarr.yaml',
    'metadata-profiles/lidarr/lidarr-praxrr.yaml',
  ] as const;

  for (const relativePath of requiredFiles) {
    const stat = await Deno.stat(new URL(relativePath, entitiesDir));
    assertEquals(stat.isFile, true, `Expected Lidarr migration source file to exist: entities/${relativePath}`);
  }
});
