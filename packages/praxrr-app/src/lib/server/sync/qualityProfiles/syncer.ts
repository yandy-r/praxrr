/**
 * Quality profile syncer
 * Syncs quality profiles from PCD to arr instances
 *
 * Each database's CFs and QPs are synced with an invisible namespace suffix
 * so multiple databases can coexist in the same arr instance.
 *
 * Sync order:
 * 1. Group sync selections by database, assign namespace suffixes
 * 2. For each database: sync its custom formats (suffixed) → build per-DB formatIdMap
 * 3. Refresh full CF list from arr → build allFormatIdMap
 * 4. For each database: sync its quality profiles (suffixed) using both maps
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { arrNamespaceQueries } from '$db/queries/arrNamespaces.ts';
import { getCache, getCachedDatabaseIds } from '$pcd/index.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { logger } from '$logger/logger.ts';
import type { SyncArrType } from '../mappings.ts';
import { getNamespaceSuffix } from '../namespace.ts';

// Custom formats
import { fetchCustomFormatFromPcd, syncCustomFormats, type PcdCustomFormat } from '../customFormats/index.ts';
import {
  fetchQualityProfileFromPcd,
  getQualityApiMappings,
  getReferencedCustomFormatNames,
  transformQualityProfile,
  type PcdQualityProfile,
} from './transformer.ts';

// Internal types for sync data
interface ProfileSyncData {
  pcdProfile: PcdQualityProfile;
  referencedFormatNames: string[];
}

/** Per-database batch of profiles and CFs to sync. */
interface DatabaseSyncBatch {
  databaseId: number;
  suffix: string;
  profiles: ProfileSyncData[];
  customFormats: Map<string, PcdCustomFormat>;
  /** Populated after CF sync: PCD format name (unsuffixed) → arr ID */
  pcdFormatIdMap: Map<string, number>;
}

interface SyncedProfileSummary {
  name: string;
  action: 'created' | 'updated';
  language: string;
  cutoffFormatScore: number;
  minFormatScore: number;
  formats: { name: string; score: number }[];
}

export class QualityProfileSyncer extends BaseSyncer {
  private instanceType: SyncArrType;

  constructor(
    client: ConstructorParameters<typeof BaseSyncer>[0],
    instanceId: number,
    instanceName: string,
    instanceType: SyncArrType
  ) {
    super(client, instanceId, instanceName);
    this.instanceType = instanceType;
  }

  protected get syncType(): string {
    return 'quality profiles';
  }

  /**
   * Override sync to handle the complex quality profile sync flow
   */
  override async sync(): Promise<SyncResult> {
    try {
      await logger.info(`Starting quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, instanceType: this.instanceType },
      });

      // 1. Fetch profiles and CFs grouped by database
      const batches = await this.fetchSyncBatchByDatabase();

      const totalProfiles = batches.reduce((sum, b) => sum + b.profiles.length, 0);
      if (totalProfiles === 0) {
        await logger.debug(`No quality profiles to sync for "${this.instanceName}"`, {
          source: 'Sync:QualityProfiles',
          meta: { instanceId: this.instanceId },
        });
        return { success: true, itemsSynced: 0 };
      }

      // 2. Sync custom formats per-database (each with its namespace suffix)
      let totalFormatsSynced = 0;
      for (const batch of batches) {
        batch.pcdFormatIdMap = await syncCustomFormats(
          this.client,
          this.instanceId,
          this.instanceType,
          batch.customFormats,
          batch.suffix
        );
        totalFormatsSynced += batch.customFormats.size;
      }

      // 3. Refresh full CF list from arr (all databases' suffixed CFs)
      const allArrFormats = await this.client.getCustomFormats();
      const allFormatIdMap = new Map(allArrFormats.map((f) => [f.name, f.id!]));

      // 4. Get quality API mappings (use first available database's cache)
      const qualityMappings = await this.getQualityMappings(batches);

      // 5. Sync quality profiles per-database
      const existingProfiles = await this.client.getQualityProfiles();
      const existingMap = new Map(existingProfiles.map((p) => [p.name, p.id]));

      const allSyncedProfiles: SyncedProfileSummary[] = [];
      for (const batch of batches) {
        const synced = await this.syncQualityProfiles(
          batch.profiles,
          batch.suffix,
          batch.pcdFormatIdMap,
          allFormatIdMap,
          qualityMappings,
          existingMap
        );
        allSyncedProfiles.push(...synced);
      }

      await logger.info(`Completed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: {
          instanceId: this.instanceId,
          databases: batches.length,
          profiles: allSyncedProfiles.map((p) => ({
            name: p.name,
            action: p.action,
            formats: p.formats.length,
          })),
        },
      });

      return { success: true, itemsSynced: allSyncedProfiles.length };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed quality profile sync for "${this.instanceName}"`, {
        source: 'Sync:QualityProfiles',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      return { success: false, itemsSynced: 0, error: errorMsg };
    }
  }

  /**
   * Fetch profiles and CFs grouped by database, each with a namespace suffix.
   */
  private async fetchSyncBatchByDatabase(): Promise<DatabaseSyncBatch[]> {
    const syncConfig = arrSyncQueries.getQualityProfilesSync(this.instanceId);

    if (syncConfig.selections.length === 0) return [];

    // Group selections by database
    const byDatabase = new Map<number, typeof syncConfig.selections>();
    for (const selection of syncConfig.selections) {
      const existing = byDatabase.get(selection.databaseId) || [];
      existing.push(selection);
      byDatabase.set(selection.databaseId, existing);
    }

    const batches: DatabaseSyncBatch[] = [];

    for (const [databaseId, selections] of byDatabase) {
      // Skip stale references to deleted databases
      const dbInstance = databaseInstancesQueries.getById(databaseId);
      if (!dbInstance) {
        await logger.warn(`Skipping sync for deleted database ${databaseId}`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            databaseId,
            profileCount: selections.length,
          },
        });
        continue;
      }

      // Get or create namespace index for this (arr, database) pair
      const namespaceIndex = arrNamespaceQueries.getOrCreate(this.instanceId, databaseId);
      const suffix = getNamespaceSuffix(namespaceIndex);

      await logger.debug(`Database "${dbInstance?.name ?? databaseId}" assigned namespace index ${namespaceIndex}`, {
        source: 'Sync:Namespace',
        meta: {
          instanceId: this.instanceId,
          databaseId,
          databaseName: dbInstance?.name ?? null,
          namespaceIndex,
          suffixCodepoints: [...suffix].map(
            (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
          ),
          profileCount: selections.length,
        },
      });

      const cache = getCache(databaseId);
      if (!cache) {
        const cachedIds = getCachedDatabaseIds();

        await logger.warn(`PCD cache not found for database ${databaseId}`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            requestedDatabaseId: databaseId,
            cachedDatabaseIds: cachedIds,
            databaseExists: !!dbInstance,
            databaseEnabled: dbInstance?.enabled ?? null,
            databaseName: dbInstance?.name ?? null,
          },
        });
        continue;
      }

      const profiles: ProfileSyncData[] = [];
      const customFormats = new Map<string, PcdCustomFormat>();

      for (const selection of selections) {
        // Fetch the quality profile
        const pcdProfile = await fetchQualityProfileFromPcd(cache, selection.profileName, this.instanceType);
        if (!pcdProfile) {
          await logger.warn(`Quality profile "${selection.profileName}" not found in database ${databaseId}`, {
            source: 'Sync:QualityProfiles',
            meta: { instanceId: this.instanceId, profileName: selection.profileName },
          });
          continue;
        }

        // Get referenced custom format names
        const referencedFormatNames = await getReferencedCustomFormatNames(
          cache,
          selection.profileName,
          this.instanceType
        );

        profiles.push({ pcdProfile, referencedFormatNames });

        // Fetch custom formats (dedupe by name within this database)
        for (const formatName of referencedFormatNames) {
          if (!customFormats.has(formatName)) {
            const pcdFormat = await fetchCustomFormatFromPcd(cache, formatName);
            if (pcdFormat) {
              customFormats.set(formatName, pcdFormat);
            }
          }
        }
      }

      if (profiles.length > 0) {
        batches.push({
          databaseId,
          suffix,
          profiles,
          customFormats,
          pcdFormatIdMap: new Map(),
        });
      }
    }

    return batches;
  }

  /**
   * Get quality API mappings from the first available database cache.
   * All databases should have the same quality mappings from the schema PCD.
   */
  private async getQualityMappings(batches: DatabaseSyncBatch[]): Promise<Map<string, string>> {
    for (const batch of batches) {
      const cache = getCache(batch.databaseId);
      if (cache) {
        return getQualityApiMappings(cache, this.instanceType);
      }
    }

    throw new Error('No PCD cache available for quality API mappings');
  }

  /**
   * Sync quality profiles for a single database batch.
   */
  private async syncQualityProfiles(
    profiles: ProfileSyncData[],
    suffix: string,
    pcdFormatIdMap: Map<string, number>,
    allFormatIdMap: Map<string, number>,
    qualityMappings: Map<string, string>,
    existingMap: Map<string, number>
  ): Promise<SyncedProfileSummary[]> {
    const syncedProfiles: SyncedProfileSummary[] = [];

    for (const { pcdProfile } of profiles) {
      const arrProfile = transformQualityProfile(
        pcdProfile,
        this.instanceType,
        qualityMappings,
        pcdFormatIdMap,
        allFormatIdMap
      );

      // Apply namespace suffix to profile name
      const suffixedName = pcdProfile.name + suffix;
      arrProfile.name = suffixedName;

      await logger.debug(`Compiled quality profile "${pcdProfile.name}" (suffixed)`, {
        source: 'Compile:QualityProfile',
        meta: {
          instanceId: this.instanceId,
          pcdName: pcdProfile.name,
          profile: arrProfile,
        },
      });

      try {
        const isUpdate = existingMap.has(suffixedName);
        if (isUpdate) {
          // Update existing
          const existingId = existingMap.get(suffixedName)!;
          arrProfile.id = existingId;
          await this.client.updateQualityProfile(existingId, arrProfile);
          await logger.debug(`Updated quality profile "${pcdProfile.name}"`, {
            source: 'Sync:QualityProfiles',
            meta: { instanceId: this.instanceId, profileId: existingId, pcdName: pcdProfile.name, suffixedName },
          });
        } else {
          // Create new
          const response = await this.client.createQualityProfile(arrProfile);
          existingMap.set(suffixedName, response.id);
          await logger.debug(`Created quality profile "${pcdProfile.name}"`, {
            source: 'Sync:QualityProfiles',
            meta: { instanceId: this.instanceId, profileId: response.id, pcdName: pcdProfile.name, suffixedName },
          });
        }

        // Build summary for completion log
        const scoredFormats = arrProfile.formatItems
          .filter((f) => f.score !== 0)
          .map((f) => ({ name: f.name, score: f.score }));

        syncedProfiles.push({
          name: pcdProfile.name,
          action: isUpdate ? 'updated' : 'created',
          language: arrProfile.language?.name ?? 'N/A',
          cutoffFormatScore: arrProfile.cutoffFormatScore,
          minFormatScore: arrProfile.minFormatScore,
          formats: scoredFormats,
        });
      } catch (error) {
        const errorDetails = this.extractErrorDetails(error);
        await logger.error(`Failed to sync quality profile "${pcdProfile.name}"`, {
          source: 'Sync:QualityProfiles',
          meta: {
            instanceId: this.instanceId,
            pcdName: pcdProfile.name,
            suffixedName,
            request: arrProfile,
            ...errorDetails,
          },
        });
      }
    }

    return syncedProfiles;
  }

  /**
   * Extract error details from HTTP errors for logging
   * Attempts to get response body, status, etc.
   */
  private extractErrorDetails(error: unknown): Record<string, unknown> {
    const details: Record<string, unknown> = {
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    // Check if it's an HTTP error with response details
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;

      // Common HTTP client error properties
      if ('status' in err) details.status = err.status;
      if ('statusText' in err) details.statusText = err.statusText;
      if ('response' in err) details.response = err.response;
      if ('body' in err) details.responseBody = err.body;
      if ('data' in err) details.responseData = err.data;

      // If error has a cause, include it
      if (err.cause) details.cause = err.cause;
    }

    return details;
  }

  // Base class abstract methods - implemented but not used since we override sync()
  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {
    // Not used - logic is in sync()
  }
}
