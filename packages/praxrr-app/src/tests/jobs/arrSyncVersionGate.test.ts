import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import { getSection } from '$lib/server/sync/registry.ts';
import { resolveSyncSectionAvailability } from '$lib/server/sync/mappings.ts';
import type { BaseSyncer, SectionType } from '$lib/server/sync/types.ts';
import { BaseArrClient } from '$arr/base.ts';

// Registers arrSyncHandler ('arr.sync') plus every section handler.
import '$jobs/handlers/arrSync.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path
 * and run the full migration chain (so arr_instances carries the
 * detected_version/detected_at columns the run-start detection persists into),
 * invoke the test body, then tear the connection down. Mirrors the DB bootstrap
 * used by the arrInstanceVersion / setup-wizard suites.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-sync-version-gate-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

type Restore = () => void;

function createRadarrInstanceRow(name: string): number {
  return arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://127.0.0.1:8989',
    apiKey: 'radarr-key',
  });
}

function baselineSyncConfigStatus() {
  const section = { trigger: 'manual' as const, cron: null, nextRunAt: null, syncStatus: 'idle' };
  return {
    qualityProfiles: { ...section },
    delayProfiles: { ...section },
    mediaManagement: { ...section },
    metadataProfiles: { ...section },
  };
}

function createQualityProfilesSyncJob(instanceId: number, source: JobSource): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    jobType: 'arr.sync',
    status: 'queued',
    runAt: now,
    payload: {
      instanceId,
      section: 'qualityProfiles' as SectionType,
    },
    source,
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Patch the shared singletons the LIVE arrSyncHandler touches so a single
 * qualityProfiles section can be driven deterministically:
 *  - `getSystemStatus` is the network seam that feeds run-start detection.
 *  - `getById` injects a non-empty api_key so getArrInstanceClient's
 *    no-credentials fallback builds a real (but never-networked) client, while
 *    still reading the persisted detected_version back from the real row.
 *  - the qualityProfiles section handler is stubbed with a sync() spy.
 *
 * Returns the observable state plus a single restore() that unwinds every patch.
 */
function driveHandlerHarness(version: string): {
  observed: { syncCalled: boolean };
  restore: Restore;
} {
  const restores: Restore[] = [];
  const observed = { syncCalled: false };

  const originalGetById = arrInstancesQueries.getById;
  arrInstancesQueries.getById = (id: number) => {
    const row = originalGetById(id);
    return row ? ({ ...row, api_key: 'radarr-key' } as ArrInstance) : row;
  };
  restores.push(() => {
    arrInstancesQueries.getById = originalGetById;
  });

  const originalGetSystemStatus = BaseArrClient.prototype.getSystemStatus;
  BaseArrClient.prototype.getSystemStatus = () => Promise.resolve({ ok: true as const, appName: 'Radarr', version });
  restores.push(() => {
    BaseArrClient.prototype.getSystemStatus = originalGetSystemStatus;
  });

  const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
  arrSyncQueries.getSyncConfigStatus = () => baselineSyncConfigStatus();
  restores.push(() => {
    arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
  });

  const originalGetQualityProfilesSync = arrSyncQueries.getQualityProfilesSync;
  arrSyncQueries.getQualityProfilesSync = () => ({
    selections: [],
    config: { trigger: 'manual', cron: null },
  });
  restores.push(() => {
    arrSyncQueries.getQualityProfilesSync = originalGetQualityProfilesSync;
  });

  const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;
  arrSyncQueries.getNextScheduledRunAt = () => null;
  restores.push(() => {
    arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
  });

  const qpHandler = getSection('qualityProfiles');
  const originalHasConfig = qpHandler.hasConfig;
  const originalSetStatusPending = qpHandler.setStatusPending;
  const originalClaimSync = qpHandler.claimSync;
  const originalCompleteSync = qpHandler.completeSync;
  const originalFailSync = qpHandler.failSync;
  const originalSetNextRunAt = qpHandler.setNextRunAt;
  const originalCreateSyncer = qpHandler.createSyncer;

  qpHandler.hasConfig = () => true;
  qpHandler.setStatusPending = () => undefined;
  qpHandler.claimSync = () => true;
  qpHandler.completeSync = () => undefined;
  qpHandler.failSync = () => undefined;
  qpHandler.setNextRunAt = () => undefined;
  qpHandler.createSyncer = (_client, _instance) =>
    ({
      sync: async () => {
        observed.syncCalled = true;
        return { success: true, itemsSynced: 3 };
      },
      generatePreview: async () => ({ section: 'qualityProfiles', profile: null }),
      setPreviewConfig: () => undefined,
      clearPreviewConfig: () => undefined,
    }) as unknown as BaseSyncer;

  restores.push(() => {
    qpHandler.hasConfig = originalHasConfig;
    qpHandler.setStatusPending = originalSetStatusPending;
    qpHandler.claimSync = originalClaimSync;
    qpHandler.completeSync = originalCompleteSync;
    qpHandler.failSync = originalFailSync;
    qpHandler.setNextRunAt = originalSetNextRunAt;
    qpHandler.createSyncer = originalCreateSyncer;
  });

  return {
    observed,
    restore: () => {
      for (const restore of restores.reverse()) {
        restore();
      }
    },
  };
}

// =============================================================================
// (A) LIVE arrSyncHandler: run-start detection + version gate
// =============================================================================

migratedTest(
  'arrSyncHandler: run-start detection persists a healthy version and a compatible section syncs',
  async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const id = createRadarrInstanceRow('Radarr Healthy');
    const readById = arrInstancesQueries.getById;
    // Freshly created row has never been detected.
    assertEquals(readById(id)?.detected_version ?? null, null);

    const { observed, restore } = driveHandlerHarness('5.14.0.9383');
    try {
      const result = await handler(createQualityProfilesSyncJob(id, 'manual'));

      // (a) run-start detection persisted the reported version onto the row.
      const persisted = readById(id);
      assertExists(persisted);
      assertEquals(persisted.detected_version, '5.14.0.9383');
      assertExists(persisted.detected_at);

      // (c) a version-compatible section runs its syncer normally.
      assertEquals(observed.syncCalled, true);
      assertEquals(result.status, 'success');
      assertEquals(result.output, 'qualityProfiles: 3 item(s)');
    } finally {
      restore();
    }
  }
);

migratedTest(
  'arrSyncHandler: a below-minimum version skips the section without failing and never calls sync()',
  async () => {
    const handler = jobQueueRegistry.get('arr.sync');
    assertExists(handler);

    const id = createRadarrInstanceRow('Radarr Ancient');

    // radarr minimumSupported is 4.0.0.0 -> 3.2.2.0 resolves to the unsupported tier.
    const { observed, restore } = driveHandlerHarness('3.2.2.0');
    try {
      const result = await handler(createQualityProfilesSyncJob(id, 'manual'));

      // (b) the gate withheld the section: the syncer was never constructed/run,
      // the run is not a failure, and detection still persisted the raw version.
      assertEquals(observed.syncCalled, false);
      assert(result.status !== 'failure', `expected non-failure, got ${result.status}`);
      assertEquals(result.status, 'skipped');
      assertExists(result.output);
      assertStringIncludes(result.output, 'qualityProfiles: skipped (version');

      assertEquals(arrInstancesQueries.getById(id)?.detected_version, '3.2.2.0');
    } finally {
      restore();
    }
  }
);

// =============================================================================
// Focused unit coverage of the section -> capability version gate.
// =============================================================================

Deno.test('resolveSyncSectionAvailability: gates sections across versions x tiers', () => {
  // Healthy / newer / null(unknown) -> available for a base-supported section.
  assertEquals(resolveSyncSectionAvailability('radarr', 'qualityProfiles', '5.14.0.9383').status, 'available');
  assertEquals(resolveSyncSectionAvailability('radarr', 'qualityProfiles', null).status, 'available');
  assertEquals(resolveSyncSectionAvailability('sonarr', 'delayProfiles', '4.0.15.2941').status, 'available');
  assertEquals(resolveSyncSectionAvailability('lidarr', 'metadataProfiles', '2.9.6.4552').status, 'available');

  // Below-minimum (unsupported tier) -> write-heavy sync surfaces become unavailable.
  assertEquals(resolveSyncSectionAvailability('radarr', 'qualityProfiles', '3.2.2.0').status, 'unavailable');
  assertEquals(resolveSyncSectionAvailability('sonarr', 'delayProfiles', '2.0.0.0').status, 'unavailable');
  assertEquals(resolveSyncSectionAvailability('lidarr', 'metadataProfiles', '1.9.9.9').status, 'unavailable');

  // Base-unsupported section is a hard floor regardless of a healthy version.
  const radarrMetadata = resolveSyncSectionAvailability('radarr', 'metadataProfiles', '5.14.0.9383');
  assertEquals(radarrMetadata.status, 'unavailable');
  assertEquals(radarrMetadata.reason, 'base_unsupported');
});
