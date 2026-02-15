import { assert, assertEquals, assertExists } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { type PcdOp, pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { overrideConflict } from '$pcd/conflicts/override.ts';
import { defaultFieldGuardRule } from '$pcd/conflicts/autoAlign/rules/defaultFieldGuard.ts';
import { AUTO_ALIGN_ENTITIES } from '$pcd/entities/registry.ts';

function createPublishedUserOp(entity: string): PcdOp {
  const now = new Date().toISOString();
  return {
    id: 1,
    database_id: 9901,
    origin: 'user',
    state: 'published',
    source: 'local',
    filename: null,
    op_number: null,
    sequence: null,
    sql: '-- test op',
    metadata: JSON.stringify({
      operation: 'update',
      entity,
      name: 'Lidarr-Config',
    }),
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: now,
    updated_at: now,
  };
}

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): () => void {
  const original = target[key];
  target[key] = replacement;
  return () => {
    target[key] = original;
  };
}

Deno.test('overrideConflict routes lidarr entities to dedicated override handlers', async () => {
  const entitiesWithExpectedErrors: Array<[string, string]> = [
    ['lidarr_naming', 'Missing desired state for lidarr naming override'],
    ['lidarr_media_settings', 'Missing desired state for lidarr media settings override'],
    ['lidarr_quality_definitions', 'Missing desired state for lidarr quality definitions override'],
  ];

  for (const [entity, expectedError] of entitiesWithExpectedErrors) {
    const restores: Array<() => void> = [];
    try {
      restores.push(patch(pcdOpsQueries, 'getById', () => createPublishedUserOp(entity)));
      restores.push(patch(pcdOpsQueries, 'update', () => true));
      restores.push(patch(pcdOpHistoryQueries, 'create', () => 1));
      restores.push(patch(databaseInstancesQueries, 'getById', () => undefined));

      const result = await overrideConflict({ databaseId: 9901, opId: 1 });
      assertEquals(result.success, false);
      assertEquals(result.error, expectedError);
      assertEquals(result.error?.includes('Override not yet implemented'), false);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }
});

Deno.test('auto-align registry includes lidarr naming and media settings entities', () => {
  const naming = AUTO_ALIGN_ENTITIES.get('lidarr_naming');
  assertExists(naming);
  assertEquals(naming.table, 'lidarr_naming');
  assert(naming.fields.includes('artist_name'));
  assert(naming.fields.includes('standard_track_format'));

  const mediaSettings = AUTO_ALIGN_ENTITIES.get('lidarr_media_settings');
  assertExists(mediaSettings);
  assertEquals(mediaSettings.table, 'lidarr_media_settings');
  assert(mediaSettings.fields.includes('propers_repacks'));
  assert(mediaSettings.fields.includes('enable_media_info'));
});

Deno.test('default field guard auto-aligns lidarr naming and media-settings rows', () => {
  const db = new Database(':memory:', { int64: true });

  try {
    db.exec(`
CREATE TABLE lidarr_naming (
	name TEXT NOT NULL PRIMARY KEY,
	rename INTEGER NOT NULL,
	standard_track_format TEXT NOT NULL,
	artist_name TEXT NOT NULL,
	multi_disc_track_format TEXT NOT NULL,
	artist_folder_format TEXT NOT NULL,
	replace_illegal_characters INTEGER NOT NULL,
	colon_replacement_format INTEGER NOT NULL,
	custom_colon_replacement_format TEXT
);

CREATE TABLE lidarr_media_settings (
	name TEXT NOT NULL PRIMARY KEY,
	propers_repacks TEXT NOT NULL,
	enable_media_info INTEGER NOT NULL
);

INSERT INTO lidarr_naming (
	name,
	rename,
	standard_track_format,
	artist_name,
	multi_disc_track_format,
	artist_folder_format,
	replace_illegal_characters,
	colon_replacement_format,
	custom_colon_replacement_format
) VALUES (
	'Lidarr-Config',
	0,
	'{Track Title}',
	'{Artist Name}',
	'{Disc}-{Track}',
	'{Artist Name}',
	1,
	4,
	NULL
);

INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Lidarr-Config', 'preferAndUpgrade', 0);
`);

    const namingAligns = defaultFieldGuardRule.shouldAlign({
      db,
      entityName: 'lidarr_naming',
      metadata: { name: 'Lidarr-Config' },
      desiredState: {
        rename: { from: 1, to: false },
        standard_track_format: { from: '{Old Track}', to: '{Track Title}' },
        artist_name: { from: '{Old Artist}', to: '{Artist Name}' },
        multi_disc_track_format: { from: '{Old Disc}', to: '{Disc}-{Track}' },
        artist_folder_format: { from: '{Old Folder}', to: '{Artist Name}' },
        replace_illegal_characters: { from: 0, to: true },
        colon_replacement_format: { from: 3, to: 4 },
        custom_colon_replacement_format: { from: ' - ', to: null },
      },
    });
    assertEquals(namingAligns, true);

    const mediaSettingsAligns = defaultFieldGuardRule.shouldAlign({
      db,
      entityName: 'lidarr_media_settings',
      metadata: { name: 'Lidarr-Config' },
      desiredState: {
        propers_repacks: { from: 'doNotPrefer', to: 'preferAndUpgrade' },
        enable_media_info: { from: true, to: false },
      },
    });
    assertEquals(mediaSettingsAligns, true);
  } finally {
    db.close();
  }
});
