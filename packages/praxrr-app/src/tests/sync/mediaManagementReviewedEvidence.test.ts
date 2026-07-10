import { assert, assertEquals } from '@std/assert';
import { MediaManagementSyncer } from '../../lib/server/sync/mediaManagement/syncer.ts';
import type {
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
} from '../../lib/server/sync/preview/types.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrQualityDefinition } from '$arr/types.ts';
import type { PCDCache } from '$pcd/index.ts';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';

type Row = Record<string, unknown>;

class EvidenceRecorder implements SyncPreviewEvidenceRecorder {
  readonly evidence: Record<SyncPreviewEvidenceClass, Record<string, unknown>> = {
    pcd: {},
    arr: {},
  };
  prepared: SyncPreviewPreparedExecutionContext | null = null;

  record(_section: 'mediaManagement', source: SyncPreviewEvidenceClass, key: string, value: unknown): void {
    this.evidence[source][key] = value;
  }

  prepare(context: SyncPreviewPreparedExecutionContext): void {
    this.prepared = context;
  }
}

function fakeCache(rowsByTable: Record<string, Row[]>): PCDCache {
  const kb = {
    selectFrom(table: string) {
      let whereColumn: string | null = null;
      let whereValue: unknown;
      const builder = {
        where(column: string, _operator: string, value: unknown) {
          whereColumn = column;
          whereValue = value;
          return builder;
        },
        selectAll() {
          return builder;
        },
        select(_columns: unknown) {
          return builder;
        },
        execute() {
          const rows = rowsByTable[table] ?? [];
          return Promise.resolve(
            rows.filter((row) => whereColumn === null || row[whereColumn] === whereValue).map((row) => ({ ...row }))
          );
        },
        async executeTakeFirst() {
          return (await builder.execute())[0];
        },
      };
      return builder;
    },
  };

  return { kb, close() {} } as unknown as PCDCache;
}

function qualityDefinition(id: number, name: string, minSize = 0): ArrQualityDefinition {
  return {
    id,
    quality: { id, name },
    title: name,
    weight: id,
    minSize,
    maxSize: 100,
    preferredSize: 50,
  };
}

function patchTrashSelectionsEmpty(): () => void {
  const original = trashGuideSyncQueries.getSelectionsByInstance;
  trashGuideSyncQueries.getSelectionsByInstance = () => [];
  return () => {
    trashGuideSyncQueries.getSelectionsByInstance = original;
  };
}

Deno.test(
  'reviewed media-management freezes independent PCD sources, mappings, order, live guards and payloads',
  async () => {
    const databaseId = 23401;
    const rows: Record<string, Row[]> = {
      radarr_media_settings: [
        {
          name: ' Media Exact ',
          propers_repacks: 'preferAndUpgrade',
          enable_media_info: 1,
          created_at: 'one',
          updated_at: 'one',
        },
      ],
      radarr_naming: [
        {
          name: ' Naming Exact ',
          rename: 1,
          movie_format: 'reviewed movie',
          movie_folder_format: 'reviewed folder',
          replace_illegal_characters: 1,
          colon_replacement_format: 'smart',
          created_at: 'one',
          updated_at: 'one',
        },
      ],
      radarr_quality_definitions: [
        { name: ' Quality Exact ', quality_name: 'Web', min_size: 11, max_size: 111, preferred_size: 61 },
        { name: ' Quality Exact ', quality_name: 'Bluray', min_size: 22, max_size: 222, preferred_size: 72 },
      ],
      quality_api_mappings: [
        { quality_name: 'Web', arr_type: 'radarr', api_name: 'WEBDL-1080p' },
        { quality_name: 'Bluray', arr_type: 'radarr', api_name: 'Bluray-1080p' },
      ],
    };
    setCache(databaseId, fakeCache(rows));
    const restoreTrash = patchTrashSelectionsEmpty();

    const liveMedia = { id: 41, downloadPropersAndRepacks: 'doNotPrefer', enableMediaInfo: false, preserve: 'media' };
    const liveNaming = {
      id: 42,
      renameMovies: false,
      replaceIllegalCharacters: false,
      colonReplacementFormat: 'delete',
      standardMovieFormat: 'old',
      movieFolderFormat: 'old folder',
      preserve: 'naming',
    };
    const liveQuality = [qualityDefinition(9, 'Bluray-1080p'), qualityDefinition(3, 'WEBDL-1080p')];
    let reads = 0;
    const client = {
      getMediaManagementConfig: () => {
        reads++;
        return Promise.resolve(structuredClone(liveMedia));
      },
      getNamingConfig: () => {
        reads++;
        return Promise.resolve(structuredClone(liveNaming));
      },
      getQualityDefinitions: () => {
        reads++;
        return Promise.resolve(structuredClone(liveQuality));
      },
      updateMediaManagementConfig: () => Promise.reject(new Error('preview must not write')),
      updateNamingConfig: () => Promise.reject(new Error('preview must not write')),
      updateQualityDefinitions: () => Promise.reject(new Error('preview must not write')),
    } as unknown as BaseArrClient;

    try {
      const syncer = new MediaManagementSyncer(client, 801, 'radarr reviewed', 'radarr');
      syncer.setPreviewConfig({
        namingDatabaseId: databaseId,
        namingConfigName: ' Naming Exact ',
        qualityDefinitionsDatabaseId: databaseId,
        qualityDefinitionsConfigName: ' Quality Exact ',
        mediaSettingsDatabaseId: databaseId,
        mediaSettingsConfigName: ' Media Exact ',
      });
      const recorder = new EvidenceRecorder();
      syncer.setPreviewEvidenceRecorder(recorder);
      const preview = await syncer.generatePreview();

      assertEquals(reads, 3);
      assertEquals(
        preview.qualityDefinitions.map((change) => change.name),
        ['Web', 'Bluray']
      );
      const namingSource = recorder.evidence.pcd.namingSource;
      assertEquals(namingSource, {
        sourceKind: 'pcd',
        databaseId,
        entityType: 'radarr_naming',
        configName: ' Naming Exact ',
        row: {
          name: ' Naming Exact ',
          rename: true,
          movie_format: 'reviewed movie',
          movie_folder_format: 'reviewed folder',
          replace_illegal_characters: true,
          colon_replacement_format: 'smart',
          created_at: 'one',
          updated_at: 'one',
        },
      });
      assertEquals(recorder.evidence.pcd.qualityApiMappings, [
        ['bluray', 'Bluray-1080p'],
        ['web', 'WEBDL-1080p'],
      ]);
      assert(recorder.prepared);

      rows.radarr_naming[0].movie_format = 'mutated after review';
      rows.radarr_quality_definitions.reverse();
      liveNaming.standardMovieFormat = 'mutated live';
      const writes: Array<{ type: string; payload: unknown }> = [];
      const writerClient = {
        getMediaManagementConfig: () => Promise.reject(new Error('prepared writer reread Arr')),
        getNamingConfig: () => Promise.reject(new Error('prepared writer reread Arr')),
        getQualityDefinitions: () => Promise.reject(new Error('prepared writer reread Arr')),
        updateMediaManagementConfig: (payload: unknown) => {
          writes.push({ type: 'mediaSettings', payload });
          return Promise.resolve(payload);
        },
        updateNamingConfig: (payload: unknown) => {
          writes.push({ type: 'naming', payload });
          return Promise.resolve(payload);
        },
        updateQualityDefinitions: (payload: unknown) => {
          writes.push({ type: 'qualityDefinitions', payload });
          return Promise.resolve(payload);
        },
      } as unknown as BaseArrClient;
      const writer = new MediaManagementSyncer(writerClient, 801, 'radarr reviewed', 'radarr');
      writer.setPreparedExecutionContext(recorder.prepared);
      const result = await writer.sync();

      assertEquals(result.success, true);
      assertEquals(
        writes.map((write) => write.type),
        ['mediaSettings', 'naming', 'qualityDefinitions']
      );
      assertEquals((writes[1].payload as Row).standardMovieFormat, 'reviewed movie');
      assertEquals(
        (writes[2].payload as ArrQualityDefinition[]).map((definition) => [definition.id, definition.minSize]),
        [
          [9, 22],
          [3, 11],
        ]
      );
    } finally {
      restoreTrash();
      clearAllCaches();
    }
  }
);

Deno.test('media-management source dispatch stays explicit for Radarr, Sonarr and Lidarr', () => {
  type SourceResolver = () => { entityType: string } | null;
  type SourceResolvers = {
    resolveNamingSource: SourceResolver;
    resolveMediaSettingsSource: SourceResolver;
    resolveQualityDefinitionsSource: SourceResolver;
  };
  const expected: Record<'radarr' | 'sonarr' | 'lidarr', readonly (string | undefined)[]> = {
    radarr: ['radarr_naming', 'radarr_media_settings', 'radarr_quality_definitions'],
    sonarr: ['sonarr_naming', 'sonarr_media_settings', 'sonarr_quality_definitions'],
    lidarr: ['lidarr_naming', 'lidarr_media_settings', 'lidarr_quality_definitions'],
  };

  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const syncer = new MediaManagementSyncer({} as BaseArrClient, 900, arrType, arrType) as unknown as SourceResolvers;
    assertEquals(
      [
        syncer.resolveNamingSource()?.entityType,
        syncer.resolveMediaSettingsSource()?.entityType,
        syncer.resolveQualityDefinitionsSource()?.entityType,
      ],
      expected[arrType]
    );
  }
});

Deno.test(
  'reviewed media-management records missing subsections without touching Arr and preserves transient config',
  async () => {
    const restoreTrash = patchTrashSelectionsEmpty();
    let reads = 0;
    const client = {
      getMediaManagementConfig: () => {
        reads++;
        return Promise.resolve({});
      },
      getNamingConfig: () => {
        reads++;
        return Promise.resolve({});
      },
      getQualityDefinitions: () => {
        reads++;
        return Promise.resolve([]);
      },
    } as unknown as BaseArrClient;

    try {
      const syncer = new MediaManagementSyncer(client, 802, 'missing selections', 'sonarr');
      const config = {
        namingDatabaseId: null,
        namingConfigName: null,
        qualityDefinitionsDatabaseId: null,
        qualityDefinitionsConfigName: null,
        mediaSettingsDatabaseId: null,
        mediaSettingsConfigName: null,
      };
      syncer.setPreviewConfig(config);
      const recorder = new EvidenceRecorder();
      syncer.setPreviewEvidenceRecorder(recorder);
      const preview = await syncer.generatePreview();

      assertEquals(reads, 0);
      assertEquals(preview, {
        section: 'mediaManagement',
        mediaSettings: null,
        naming: null,
        qualityDefinitions: [],
      });
      assertEquals(recorder.evidence.pcd.selection, config);
      assertEquals(recorder.prepared?.config, config);
    } finally {
      restoreTrash();
    }
  }
);

Deno.test(
  'Lidarr reviewed naming captures unsupported target fields and never adds them to the frozen payload',
  async () => {
    const databaseId = 23402;
    setCache(
      databaseId,
      fakeCache({
        lidarr_naming: [
          {
            name: 'Lidarr Exact',
            rename: 1,
            standard_track_format: 'track',
            artist_name: 'unsupported source',
            multi_disc_track_format: 'disc',
            artist_folder_format: 'artist',
            replace_illegal_characters: 1,
            colon_replacement_format: 4,
            custom_colon_replacement_format: null,
            created_at: 'one',
            updated_at: 'one',
          },
        ],
      })
    );
    const restoreTrash = patchTrashSelectionsEmpty();
    const client = {
      getNamingConfig: () => Promise.resolve({ id: 77, renameTracks: false, opaque: 'preserve' }),
    } as unknown as BaseArrClient;

    try {
      const syncer = new MediaManagementSyncer(client, 803, 'lidarr reviewed', 'lidarr');
      syncer.setPreviewConfig({
        namingDatabaseId: databaseId,
        namingConfigName: 'Lidarr Exact',
        qualityDefinitionsDatabaseId: null,
        qualityDefinitionsConfigName: null,
        mediaSettingsDatabaseId: null,
        mediaSettingsConfigName: null,
      });
      const recorder = new EvidenceRecorder();
      syncer.setPreviewEvidenceRecorder(recorder);
      await syncer.generatePreview();

      const capabilities = recorder.evidence.arr.capabilities as {
        naming: { appliedFields: string[]; missingFields: string[]; unsupportedSourceFields: string[] };
      };
      assertEquals(capabilities.naming.appliedFields, ['renameTracks']);
      assertEquals(capabilities.naming.missingFields, [
        'artistFolderFormat',
        'colonReplacementFormat',
        'multiDiscTrackFormat',
        'replaceIllegalCharacters',
        'standardTrackFormat',
      ]);
      assertEquals(capabilities.naming.unsupportedSourceFields, ['artist_name']);
      const desired = recorder.prepared?.desired as { naming: { payload: Row } };
      assertEquals(desired.naming.payload, { id: 77, renameTracks: true, opaque: 'preserve' });
    } finally {
      restoreTrash();
      clearAllCaches();
    }
  }
);
