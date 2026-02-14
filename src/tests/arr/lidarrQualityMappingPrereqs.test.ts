import { assert, assertEquals, assertExists } from "@std/assert";
import { Database } from "@jsr/db__sqlite";
import { Kysely } from "kysely";
import { DenoSqlite3Dialect } from "@soapbox/kysely-deno-sqlite";
import type { PCDDatabase } from "$shared/pcd/types.ts";
import type { PCDCache } from "$pcd/index.ts";
import { deleteCache, setCache } from "$pcd/database/registry.ts";
import {
  arrSyncQueries,
  type MediaManagementSyncData,
} from "$db/queries/arrSync.ts";
import { logger } from "$logger/logger.ts";
import type { LogOptions } from "$logger/types.ts";
import { BaseArrClient } from "$arr/base.ts";
import type { ArrQualityDefinition } from "$arr/types.ts";
import { MediaManagementSyncer } from "$sync/mediaManagement/syncer.ts";
import {
  getQualityApiMappings,
  list,
} from "$pcd/entities/mediaManagement/quality-definitions/read.ts";

const QUALITY_LOOKUP_MISSING_WARNING_REASON =
  "Quality entries are filtered out when quality_api_mappings reference unknown API quality names";
const LIDARR_REUSE_ENTITY_REASON =
  "Lidarr v1 reuses Sonarr media-management entities; Lidarr-only fields stay unchanged";
const LIDARR_QUALITY_SKIP_REASON =
  "Lidarr quality definition sync applies only to entries with Lidarr mappings and matching Lidarr definitions";

interface CacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface CapturedLog {
  message: string;
  options?: LogOptions;
}

function createCacheFixture(schemaAndDataSql: string): CacheFixture {
  const db = new Database(":memory:", { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  db.exec(schemaAndDataSql);

  return {
    cache: { kb } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      db.close();
    },
  };
}

function cloneQualityDefinitions(
  definitions: ArrQualityDefinition[],
): ArrQualityDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    quality: { ...definition.quality },
  }));
}

function getMeta(log: CapturedLog): Record<string, unknown> {
  if (
    !log.options?.meta || typeof log.options.meta !== "object" ||
    log.options.meta === null
  ) {
    return {};
  }

  return log.options.meta as Record<string, unknown>;
}

class MockQualityDefinitionsClient extends BaseArrClient {
  private currentDefinitions: ArrQualityDefinition[];
  readonly updatedPayloads: ArrQualityDefinition[][] = [];

  constructor(initialDefinitions: ArrQualityDefinition[]) {
    super("http://127.0.0.1:8686", "test-key");
    this.currentDefinitions = cloneQualityDefinitions(initialDefinitions);
  }

  override async getQualityDefinitions(): Promise<ArrQualityDefinition[]> {
    return cloneQualityDefinitions(this.currentDefinitions);
  }

  override async updateQualityDefinitions(
    definitions: ArrQualityDefinition[],
  ): Promise<ArrQualityDefinition[]> {
    const cloned = cloneQualityDefinitions(definitions);
    this.updatedPayloads.push(cloned);
    this.currentDefinitions = cloned;
    return cloned;
  }
}

Deno.test("issue #17: quality mapping lookup is deterministic per arr type and preserves radarr/sonarr mappings", async () => {
  const fixture = createCacheFixture(`
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
  ('Lossless', 'lidarr', 'FLAC'),
  ('Lossless', 'sonarr', 'Unknown'),
  ('Lossless', 'radarr', 'Unknown'),
  ('Cinema', 'radarr', 'Bluray-1080p'),
  ('TV', 'sonarr', 'HDTV-720p');
  `);

  try {
    const lidarr = await getQualityApiMappings(fixture.cache, "lidarr");
    const sonarr = await getQualityApiMappings(fixture.cache, "sonarr");
    const radarr = await getQualityApiMappings(fixture.cache, "radarr");

    assertEquals(lidarr.qualityToApiName.get("lossless"), "FLAC");
    assertEquals(lidarr.qualityToApiName.has("tv"), false);

    assertEquals(sonarr.qualityToApiName.get("lossless"), "Unknown");
    assertEquals(sonarr.qualityToApiName.get("tv"), "HDTV-720p");

    assertEquals(radarr.qualityToApiName.get("lossless"), "Unknown");
    assertEquals(radarr.qualityToApiName.get("cinema"), "Bluray-1080p");
  } finally {
    await fixture.destroy();
  }
});

Deno.test({
  name:
    "issue #17: lidarr read/list and sync skip unmapped entries with explicit reasons",
  sanitizeResources: false,
  fn: async () => {
    const warnLogs: CapturedLog[] = [];
    const debugLogs: CapturedLog[] = [];
    const originalWarn = logger.warn;
    const originalDebug = logger.debug;
    const originalInfo = logger.info;
    const originalGetMediaManagementSync =
      arrSyncQueries.getMediaManagementSync;

    let activeDatabaseId = 1701;
    let activeConfigName = "Lidarr-Sync-Mixed";

    logger.warn = async (message: string, options?: LogOptions) => {
      warnLogs.push({ message, options });
    };
    logger.debug = async (message: string, options?: LogOptions) => {
      debugLogs.push({ message, options });
    };
    logger.info = async (_message: string, _options?: LogOptions) => {
      void _message;
      void _options;
    };
    arrSyncQueries.getMediaManagementSync = (
      _instanceId: number,
    ): MediaManagementSyncData => ({
      namingDatabaseId: null,
      namingConfigName: null,
      qualityDefinitionsDatabaseId: activeDatabaseId,
      qualityDefinitionsConfigName: activeConfigName,
      mediaSettingsDatabaseId: null,
      mediaSettingsConfigName: null,
      trigger: "manual",
      cron: null,
    });

    const mappedFixture = createCacheFixture(`
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE radarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
  ('Unknown', 'lidarr', 'Unknown'),
  ('FLAC', 'lidarr', 'FLAC'),
  ('Missing Arr', 'lidarr', 'AAC-192'),
  ('Unknown', 'sonarr', 'Unknown'),
  ('HDTV', 'sonarr', 'HDTV-720p'),
  ('Cinema', 'radarr', 'Bluray-1080p');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size) VALUES
  ('Lidarr-List-Mixed', 'Unknown', 0, 900, 300),
  ('Lidarr-List-Mixed', 'Unmapped-Audio', 0, 700, 200),
  ('Lidarr-Sync-Mixed', 'FLAC', 64, 1024, 320),
  ('Lidarr-Sync-Mixed', 'Missing Arr', 32, 800, 200),
  ('Lidarr-Sync-Mixed', 'Unmapped Entry', 16, 400, 128);

INSERT INTO radarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size) VALUES
  ('Radarr-QD', 'Cinema', 10, 1000, 300);
    `);

    const noMappingFixture = createCacheFixture(`
CREATE TABLE quality_api_mappings (
  quality_name TEXT NOT NULL,
  arr_type TEXT NOT NULL,
  api_name TEXT NOT NULL,
  PRIMARY KEY (quality_name, arr_type)
);

CREATE TABLE radarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sonarr_quality_definitions (
  name TEXT NOT NULL,
  quality_name TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  preferred_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name) VALUES
  ('Unknown', 'sonarr', 'Unknown');

INSERT INTO sonarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size) VALUES
  ('Lidarr-No-Mappings', 'Unknown', 8, 80, 20);
    `);

    try {
      const listed = await list(mappedFixture.cache);
      const lidarrMixed = listed.find((config) =>
        config.arr_type === "lidarr" && config.name === "Lidarr-List-Mixed"
      );
      assertExists(lidarrMixed);
      assertEquals(lidarrMixed.quality_count, 1);

      const listSkipWarn = warnLogs.find((entry) => {
        if (
          entry.message !==
            "Skipping unmapped quality definition rows in quality definitions list"
        ) {
          return false;
        }
        const meta = getMeta(entry);
        return meta.arrType === "lidarr" &&
          meta.configName === "Lidarr-List-Mixed";
      });
      assertExists(listSkipWarn);
      assertEquals(
        getMeta(listSkipWarn).reason,
        QUALITY_LOOKUP_MISSING_WARNING_REASON,
      );

      setCache(1701, mappedFixture.cache);

      const client = new MockQualityDefinitionsClient([
        {
          id: 6,
          quality: { id: 6, name: "FLAC", source: "audio", resolution: 0 },
          title: "FLAC",
          weight: 1,
          minSize: 0,
          maxSize: 0,
          preferredSize: 0,
        },
        {
          id: 0,
          quality: { id: 0, name: "Unknown", source: "audio", resolution: 0 },
          title: "Unknown",
          weight: 0,
          minSize: 0,
          maxSize: null,
          preferredSize: null,
        },
      ]);

      const mappedSyncer = new MediaManagementSyncer(
        client,
        555,
        "Lidarr Main",
        "lidarr",
      );
      const mappedResult = await mappedSyncer.sync();
      assertEquals(mappedResult.success, true);
      assertEquals(mappedResult.itemsSynced, 1);
      assertEquals(client.updatedPayloads.length, 1);

      const updatedFlac = client.updatedPayloads[0].find((definition) =>
        definition.quality.name === "FLAC"
      );
      assertExists(updatedFlac);
      assertEquals(updatedFlac.minSize, 64);
      assertEquals(updatedFlac.maxSize, 1024);
      assertEquals(updatedFlac.preferredSize, 320);

      const skippedEntriesWarn = warnLogs.find(
        (entry) =>
          entry.message ===
            "Skipped unsupported Lidarr quality definitions entries",
      );
      assertExists(skippedEntriesWarn);
      const skippedMeta = getMeta(skippedEntriesWarn);
      assertEquals(skippedMeta.reason, LIDARR_QUALITY_SKIP_REASON);
      assertEquals(skippedMeta.missingMappings, ["Unmapped Entry"]);
      assertEquals(skippedMeta.missingArrDefinitions, ["Missing Arr"]);

      const reuseEntityDebug = debugLogs.find(
        (entry) =>
          entry.message ===
            "Using reused quality definitions entity for Lidarr sync",
      );
      assertExists(reuseEntityDebug);
      assertEquals(
        getMeta(reuseEntityDebug).reason,
        LIDARR_REUSE_ENTITY_REASON,
      );

      setCache(1702, noMappingFixture.cache);
      activeDatabaseId = 1702;
      activeConfigName = "Lidarr-No-Mappings";

      const noMappingClient = new MockQualityDefinitionsClient([
        {
          id: 0,
          quality: { id: 0, name: "Unknown", source: "audio", resolution: 0 },
          title: "Unknown",
          weight: 0,
          minSize: 0,
          maxSize: null,
          preferredSize: null,
        },
      ]);

      const noMappingSyncer = new MediaManagementSyncer(
        noMappingClient,
        556,
        "Lidarr Backup",
        "lidarr",
      );
      const noMappingResult = await noMappingSyncer.sync();
      assertEquals(noMappingResult.success, true);
      assertEquals(noMappingResult.itemsSynced, 0);
      assertEquals(noMappingClient.updatedPayloads.length, 0);

      const missingMappingsWarn = warnLogs.find(
        (entry) =>
          entry.message ===
            "Skipping Lidarr quality definitions sync due missing mappings",
      );
      assertExists(missingMappingsWarn);
      assertEquals(
        getMeta(missingMappingsWarn).reason,
        LIDARR_QUALITY_SKIP_REASON,
      );
    } finally {
      logger.warn = originalWarn;
      logger.debug = originalDebug;
      logger.info = originalInfo;
      arrSyncQueries.getMediaManagementSync = originalGetMediaManagementSync;

      deleteCache(1701);
      deleteCache(1702);

      await mappedFixture.destroy();
      await noMappingFixture.destroy();
    }

    assert(warnLogs.length > 0);
  },
});
