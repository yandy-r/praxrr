/**
 * PCD Manager - High-level orchestration for PCD lifecycle
 */

import {
  checkForUpdates,
  checkout,
  clone,
  refreshLocalRepositoryClone,
  getStatus,
  isLocalRepositorySource,
  type GitStatus,
  pull,
  type UpdateInfo,
} from '$utils/git/index.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { loadManifest, type Manifest } from '../manifest/manifest.ts';
import { getPCDPath } from '../utils/operations.ts';
import { processDependencies, syncDependencies, validateDependencies } from '../git/dependencies.ts';
import { compile, invalidate } from '../database/compiler.ts';
import { getCache } from '../database/registry.ts';
import { logger } from '$logger/logger.ts';
import { triggerSyncs } from '$sync/processor.ts';
import type { CacheBuildStats, LinkOptions, SyncResult } from './types.ts';
import { importBaseOps } from '../ops/importBaseOps.ts';
import { seedBuiltInBaseOps } from '../ops/seedBuiltInBaseOps.ts';
import { cleanupJobsForDatabase } from '$lib/server/jobs/cleanup.ts';
import {
  encryptDatabasePersonalAccessToken,
  getDecryptedDatabasePersonalAccessToken,
} from '$server/utils/encryption/database-credentials.ts';
import { snapshotService } from '../snapshots/service.ts';

/**
 * PCD Manager - Manages the lifecycle of Praxrr Compliant Databases
 */
class PCDManager {
  /**
   * Link a new PCD repository
   */
  async link(options: LinkOptions): Promise<DatabaseInstance> {
    await logger.debug('Starting database link operation', {
      source: 'PCDManager',
      meta: {
        name: options.name,
        repositoryUrl: options.repositoryUrl,
        branch: options.branch,
      },
    });

    // Generate UUID for storage
    const uuid = crypto.randomUUID();
    const localPath = getPCDPath(uuid);
    let createdDatabaseId: number | null = null;

    try {
      // Clone the repository and detect if it's private
      const isPrivate = await clone(options.repositoryUrl, localPath, options.branch, options.personalAccessToken);

      // Validate manifest (loadManifest throws if invalid)
      await loadManifest(localPath);

      // Process dependencies (clone and validate)
      await processDependencies(localPath, options.personalAccessToken);

      let encryptedPersonalAccessToken: Awaited<ReturnType<typeof encryptDatabasePersonalAccessToken>> | undefined;
      if (options.personalAccessToken) {
        encryptedPersonalAccessToken = await encryptDatabasePersonalAccessToken(options.personalAccessToken);
      }

      // Insert into database
      const id = databaseInstancesQueries.create(
        {
          uuid,
          name: options.name,
          repositoryUrl: options.repositoryUrl,
          localPath,
          syncStrategy: options.syncStrategy,
          autoPull: options.autoPull,
          personalAccessToken: options.personalAccessToken,
          isPrivate,
          localOpsEnabled: options.localOpsEnabled,
          gitUserName: options.gitUserName,
          gitUserEmail: options.gitUserEmail,
          conflictStrategy: options.conflictStrategy as 'override' | 'align' | 'ask' | undefined,
        },
        encryptedPersonalAccessToken
          ? {
              ciphertext: encryptedPersonalAccessToken.credential.ciphertext,
              nonce: encryptedPersonalAccessToken.credential.nonce,
              keyVersion: encryptedPersonalAccessToken.credential.keyVersion,
            }
          : undefined
      );
      createdDatabaseId = id;

      // Get and return the created instance
      const instance = databaseInstancesQueries.getById(id);
      if (!instance) {
        throw new Error('Failed to retrieve created database instance');
      }

      await importBaseOps(id, localPath);
      await this.seedBuiltInBaseOpsWithOrchestration(id, 'link');

      // Compile cache (only if enabled)
      await this.compileIfEnabled(instance, localPath, 'link');

      return instance;
    } catch (error) {
      if (createdDatabaseId !== null) {
        try {
          databaseInstancesQueries.delete(createdDatabaseId);
        } catch (cleanupError) {
          await logger.warn('Failed to rollback database instance after link failure', {
            source: 'PCDManager',
            meta: {
              databaseId: createdDatabaseId,
              error: String(cleanupError),
            },
          });
        }
      }
      // Cleanup on failure - remove cloned directory
      try {
        await Deno.remove(localPath, { recursive: true });
      } catch (cleanupError) {
        console.error(`Failed to remove cloned PCD directory ${localPath} after link failure:`, cleanupError);
      }
      throw error;
    }
  }

  /**
   * Unlink a PCD repository
   */
  async unlink(id: number): Promise<void> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    // Invalidate cache first
    invalidate(id);

    // Remove queued/scheduled jobs for this database
    cleanupJobsForDatabase(id);

    // Delete from database
    databaseInstancesQueries.delete(id);

    // Then cleanup filesystem
    try {
      await Deno.remove(instance.local_path, { recursive: true });
    } catch (error) {
      // Log but don't throw - database entry is already deleted
      console.error(`Failed to remove PCD directory ${instance.local_path}:`, error);
    }
  }

  /**
   * Sync a PCD repository (pull updates)
   */
  async sync(id: number): Promise<SyncResult> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    try {
      if (isLocalRepositorySource(instance.repository_url)) {
        // Pre-pull snapshot for local-path sources (best-effort, non-blocking)
        try {
          await snapshotService.createAutoSnapshot({
            databaseId: id,
            trigger: 'pull',
            targetInstanceIds: null,
          });
        } catch (snapshotError) {
          await logger.warn('Pre-pull snapshot failed', {
            source: 'PCDManager',
            meta: { databaseId: id, error: String(snapshotError) },
          });
        }

        await refreshLocalRepositoryClone(instance.repository_url, instance.local_path);

        const personalAccessToken = await getDecryptedDatabasePersonalAccessToken(instance.id);
        await syncDependencies(instance.local_path, personalAccessToken);

        let importedBaseOps = true;
        let baseOpsError: string | undefined;
        try {
          await importBaseOps(id, instance.local_path);
        } catch (error) {
          importedBaseOps = false;
          baseOpsError = error instanceof Error ? error.message : String(error);
          await logger.error('Failed to import base ops after local-path sync', {
            source: 'PCDManager',
            meta: { error: String(error), databaseId: id },
          });
        }

        if (!importedBaseOps) {
          return {
            success: false,
            commitsBehind: 0,
            error: `Base op import failed: ${baseOpsError ?? 'unknown error'}`,
          };
        }

        await this.seedBuiltInBaseOpsWithOrchestration(id, 'sync');
        databaseInstancesQueries.updateSyncedAt(id);
        await this.compileIfEnabled(instance, instance.local_path, 'sync');
        await this.triggerPullSync(id);

        await logger.info('Synchronized local-path database source', {
          source: 'PCDManager',
          meta: {
            databaseId: id,
            repositoryUrl: instance.repository_url,
          },
        });

        return {
          success: true,
          commitsBehind: 0,
        };
      }

      // Check for updates first
      const updateInfo = await checkForUpdates(instance.local_path);

      if (!updateInfo.hasUpdates) {
        // Already up to date
        databaseInstancesQueries.updateSyncedAt(id);
        return {
          success: true,
          commitsBehind: 0,
        };
      }

      // Pre-pull snapshot for remote sources (best-effort, non-blocking)
      try {
        await snapshotService.createAutoSnapshot({
          databaseId: id,
          trigger: 'pull',
          targetInstanceIds: null,
        });
      } catch (snapshotError) {
        await logger.warn('Pre-pull snapshot failed', {
          source: 'PCDManager',
          meta: { databaseId: id, error: String(snapshotError) },
        });
      }

      // Pull updates
      await pull(instance.local_path);

      // Sync dependencies (schema, etc.) if versions changed
      const personalAccessToken = await getDecryptedDatabasePersonalAccessToken(instance.id);
      await syncDependencies(instance.local_path, personalAccessToken);

      let importedBaseOps = true;
      let baseOpsError: string | undefined;
      try {
        await importBaseOps(id, instance.local_path);
      } catch (error) {
        importedBaseOps = false;
        baseOpsError = error instanceof Error ? error.message : String(error);
        await logger.error('Failed to import base ops after sync', {
          source: 'PCDManager',
          meta: { error: String(error), databaseId: id },
        });
      }

      if (!importedBaseOps) {
        return {
          success: false,
          commitsBehind: updateInfo.commitsBehind,
          error: `Base op import failed: ${baseOpsError ?? 'unknown error'}`,
        };
      }

      await this.seedBuiltInBaseOpsWithOrchestration(id, 'sync');

      // Update last_synced_at
      databaseInstancesQueries.updateSyncedAt(id);

      // Recompile cache (only if enabled)
      await this.compileIfEnabled(instance, instance.local_path, 'sync');

      // Trigger arr syncs for configs with on_pull trigger
      await this.triggerPullSync(id);

      return {
        success: true,
        commitsBehind: updateInfo.commitsBehind,
      };
    } catch (error) {
      return {
        success: false,
        commitsBehind: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check for available updates without pulling
   */
  async checkForUpdates(id: number): Promise<UpdateInfo> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    if (isLocalRepositorySource(instance.repository_url)) {
      return {
        hasUpdates: false,
        commitsBehind: 0,
        commitsAhead: 0,
        latestRemoteCommit: 'local',
        currentLocalCommit: 'local',
      };
    }

    return await checkForUpdates(instance.local_path);
  }

  /**
   * Get parsed manifest for a PCD
   */
  async getManifest(id: number): Promise<Manifest> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    return await loadManifest(instance.local_path);
  }

  /**
   * Switch branch for a PCD
   */
  async switchBranch(id: number, branch: string): Promise<boolean> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    await checkout(instance.local_path, branch);
    await pull(instance.local_path);
    try {
      await importBaseOps(id, instance.local_path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error('Failed to import base ops after branch switch', {
        source: 'PCDManager',
        meta: { error: message, databaseId: id },
      });
      throw new Error(`Failed to import base ops after branch switch: ${message}`);
    }

    await this.seedBuiltInBaseOpsWithOrchestration(id, 'switchBranch');
    databaseInstancesQueries.updateSyncedAt(id);

    return true;
  }

  /**
   * Get git status for a PCD
   */
  async getStatus(id: number): Promise<GitStatus> {
    const instance = databaseInstancesQueries.getById(id);
    if (!instance) {
      throw new Error(`Database instance ${id} not found`);
    }

    return await getStatus(instance.local_path);
  }

  /**
   * Get all PCDs
   */
  getAll(): DatabaseInstance[] {
    return databaseInstancesQueries.getAll();
  }

  /**
   * Get PCD by ID
   */
  getById(id: number): DatabaseInstance | undefined {
    return databaseInstancesQueries.getById(id);
  }

  /**
   * Get PCDs that need auto-sync
   */
  getDueForSync(): DatabaseInstance[] {
    return databaseInstancesQueries.getDueForSync();
  }

  /**
   * Initialize PCD caches for all enabled databases
   * Should be called on application startup
   */
  async initialize(): Promise<void> {
    const startTime = performance.now();

    await logger.debug('Initialize caches', { source: 'PCDManager' });

    const instances = databaseInstancesQueries.getAll();
    const enabledInstances = instances.filter((instance) => instance.enabled);

    // Seed built-in local base ops for all databases so newly linked instances
    // receive migration-backed scaffolding even when migrations are not rerun.
    for (const instance of instances) {
      await this.seedBuiltInBaseOpsWithOrchestration(instance.id, `initialize:${instance.name}`);
    }

    // Validate dependencies for all instances first
    for (const instance of enabledInstances) {
      try {
        const personalAccessToken = await getDecryptedDatabasePersonalAccessToken(instance.id);
        await validateDependencies(instance.local_path, personalAccessToken);
      } catch (error) {
        await logger.error(`Failed to validate dependencies for "${instance.name}"`, {
          source: 'PCDManager',
          meta: { error: String(error), databaseId: instance.id },
        });
      }
    }

    // Import base ops from repo for all enabled instances
    for (const instance of enabledInstances) {
      try {
        await importBaseOps(instance.id, instance.local_path);
      } catch (error) {
        await logger.error(`Failed to import base ops for "${instance.name}"`, {
          source: 'PCDManager',
          meta: { error: String(error), databaseId: instance.id },
        });
      }
    }

    // Collect results for aggregate logging
    const results: Array<{
      name: string;
      schema: number;
      base: number;
      tweaks: number;
      user: number;
      error?: string;
    }> = [];

    // Compile all enabled instances
    for (const instance of enabledInstances) {
      try {
        const stats = await this.compileIfEnabled(instance, instance.local_path, 'initialize', true);

        results.push({
          name: instance.name,
          schema: stats.schema,
          base: stats.base,
          tweaks: stats.tweaks,
          user: stats.user,
        });
      } catch (error) {
        results.push({
          name: instance.name,
          schema: 0,
          base: 0,
          tweaks: 0,
          user: 0,
          error: String(error),
        });

        await logger.error(`Cache failed "${instance.name}"`, {
          source: 'PCDManager',
          meta: { error: String(error), databaseId: instance.id },
        });
      }
    }

    const timing = Math.round(performance.now() - startTime);
    const successful = results.filter((r) => !r.error);

    await logger.info('Caches ready', {
      source: 'PCDManager',
      meta: {
        databases: successful.map((r) => ({
          name: r.name,
          schema: r.schema,
          base: r.base,
          tweaks: r.tweaks,
          user: r.user,
        })),
        timing: `${timing}ms`,
      },
    });
  }

  /**
   * Get the cache for a database instance
   */
  getCache(id: number) {
    return getCache(id);
  }

  private async seedBuiltInBaseOpsWithOrchestration(databaseId: number, contextLabel = 'operation'): Promise<void> {
    try {
      await seedBuiltInBaseOps(databaseId);
    } catch (error) {
      await logger.error(`Failed to seed built-in base ops during ${contextLabel}`, {
        source: 'PCDManager',
        meta: { error: String(error), databaseId },
      });
      throw error;
    }
  }

  private async compileIfEnabled(
    instance: DatabaseInstance,
    localPath: string,
    context: string,
    failOnError = true
  ): Promise<CacheBuildStats> {
    if (!instance.enabled) {
      return {
        schema: 0,
        base: 0,
        tweaks: 0,
        user: 0,
        timing: 0,
      };
    }

    try {
      const stats = await compile(localPath, instance.id);
      await logger.debug(`Cache compiled for "${instance.name}"`, {
        source: 'PCDManager',
        meta: {
          databaseId: instance.id,
          context,
          schema: stats.schema,
          base: stats.base,
          tweaks: stats.tweaks,
          user: stats.user,
        },
      });
      return stats;
    } catch (error) {
      // Log the error, then either re-throw (failOnError=true) or return zero stats.
      await logger.error(`Failed to compile PCD cache (${context})`, {
        source: 'PCDManager',
        meta: { error: String(error), databaseId: instance.id },
      });
      if (failOnError) {
        throw error;
      }

      return {
        schema: 0,
        base: 0,
        tweaks: 0,
        user: 0,
        timing: 0,
      };
    }
  }

  private async triggerPullSync(databaseId: number): Promise<void> {
    await triggerSyncs({ event: 'on_pull', databaseId });
  }
}

// Export singleton instance
export const pcdManager = new PCDManager();
