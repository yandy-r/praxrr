import { assertEquals } from '@std/assert';
import { __testOnly as arrSyncTestOnly } from '$jobs/handlers/arrSync.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';

type Restore = () => void;
type Restores = Restore[];

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restores
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('collectSnapshotDatabaseIds ignores malformed quality selections', () => {
  const restores: Restores = [];
  const getQualityProfilesSync = (() => ({
    selections: null,
    config: {
      trigger: 'manual',
      cron: null,
    },
  })) as unknown as typeof arrSyncQueries.getQualityProfilesSync;
  const getDelayProfilesSync = (() => ({
    databaseId: 11,
    profileName: 'Delay',
    trigger: 'manual',
    cron: null,
  })) as typeof arrSyncQueries.getDelayProfilesSync;
  const getMediaManagementSync = (() => ({
    namingDatabaseId: 21,
    namingConfigName: 'Name',
    qualityDefinitionsDatabaseId: null,
    qualityDefinitionsConfigName: null,
    mediaSettingsDatabaseId: 31,
    mediaSettingsConfigName: null,
    trigger: 'manual',
    cron: null,
  })) as typeof arrSyncQueries.getMediaManagementSync;
  const getMetadataProfilesSync = (() => ({
    databaseId: 41,
    profileName: 'Metadata',
    trigger: 'manual',
    cron: null,
  })) as typeof arrSyncQueries.getMetadataProfilesSync;

  patchTarget(
    arrSyncQueries,
    'getQualityProfilesSync',
    getQualityProfilesSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'getDelayProfilesSync',
    getDelayProfilesSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'getMediaManagementSync',
    getMediaManagementSync,
    restores
  );
  patchTarget(
    arrSyncQueries,
    'getMetadataProfilesSync',
    getMetadataProfilesSync,
    restores
  );

  patchTarget(
    logger,
    'warn',
    (async () => undefined) as typeof logger.warn,
    restores
  );

  try {
    const databaseIds = arrSyncTestOnly
      .collectSnapshotDatabaseIds(12, ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'])
      .sort((a, b) => a - b);

    assertEquals(databaseIds, [11, 21, 31, 41]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('collectSnapshotDatabaseIds continues when a section query throws', () => {
  const restores: Restores = [];

  patchTarget(
    arrSyncQueries,
    'getQualityProfilesSync',
    (() => {
      throw new Error('quality query failed');
    }) as typeof arrSyncQueries.getQualityProfilesSync,
    restores
  );

  patchTarget(
    arrSyncQueries,
    'getDelayProfilesSync',
    (() => ({
      databaseId: 52,
      profileName: 'Delay',
      trigger: 'manual',
      cron: null,
    })) as typeof arrSyncQueries.getDelayProfilesSync,
    restores
  );

  patchTarget(
    logger,
    'warn',
    (async () => undefined) as typeof logger.warn,
    restores
  );

  try {
    const databaseIds = arrSyncTestOnly
      .collectSnapshotDatabaseIds(12, ['qualityProfiles', 'delayProfiles'])
      .sort((a, b) => a - b);

    assertEquals(databaseIds, [52]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('collectSnapshotDatabaseIds deduplicates database IDs across sections', () => {
  const restores: Restores = [];

  patchTarget(
    arrSyncQueries,
    'getQualityProfilesSync',
    (() => ({
      selections: [
        { databaseId: 11, profileName: 'Profile A' },
        { databaseId: 11, profileName: 'Profile B' },
        { databaseId: 14, profileName: 'Profile C' },
      ],
      config: {
        trigger: 'manual',
        cron: null,
      },
    })) as typeof arrSyncQueries.getQualityProfilesSync,
    restores
  );

  patchTarget(
    arrSyncQueries,
    'getDelayProfilesSync',
    (() => ({
      databaseId: 14,
      profileName: 'Delay',
      trigger: 'manual',
      cron: null,
    })) as typeof arrSyncQueries.getDelayProfilesSync,
    restores
  );

  patchTarget(
    arrSyncQueries,
    'getMediaManagementSync',
    (() => ({
      namingDatabaseId: 11,
      namingConfigName: 'Name',
      qualityDefinitionsDatabaseId: 31,
      qualityDefinitionsConfigName: null,
      mediaSettingsDatabaseId: null,
      mediaSettingsConfigName: null,
      trigger: 'manual',
      cron: null,
    })) as typeof arrSyncQueries.getMediaManagementSync,
    restores
  );

  patchTarget(
    arrSyncQueries,
    'getMetadataProfilesSync',
    (() => ({
      databaseId: null,
      profileName: null,
      trigger: 'manual',
      cron: null,
    })) as typeof arrSyncQueries.getMetadataProfilesSync,
    restores
  );

  patchTarget(
    logger,
    'warn',
    (async () => undefined) as typeof logger.warn,
    restores
  );

  try {
    const databaseIds = arrSyncTestOnly
      .collectSnapshotDatabaseIds(12, ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'])
      .sort((a, b) => a - b);

    assertEquals(databaseIds, [11, 14, 31]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
