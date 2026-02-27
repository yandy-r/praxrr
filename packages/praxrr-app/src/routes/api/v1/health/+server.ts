import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$db/db.ts';
import { migrationRunner } from '$db/migrations.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { getCache } from '$pcd/index.ts';
import { config } from '$config';

type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy';

// Track startup time for uptime calculation
const startupTime = Date.now();

// Thresholds
const LOG_SIZE_WARN_BYTES = 100 * 1024 * 1024; // 100MB
const LOG_SIZE_CRITICAL_BYTES = 500 * 1024 * 1024; // 500MB

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * GET /api/v1/health
 *
 * Return system health status with component-level details.
 *
 * @param {URL} url - Request URL, including optional `verbose=true` query param.
 * @returns {Promise<Response>} JSON response with health status and details.
 * @throws {Error} Throws if component checks fail unexpectedly.
 */
export const GET: RequestHandler = async ({ url }) => {
  const verbose = url.searchParams.get('verbose') === 'true';

  const sqlite = checkSqlite();
  const repos = checkRepos(verbose);
  const jobs = checkJobs(verbose);
  const backups = await checkBackups(verbose);
  const logs = await checkLogs(verbose);

  const response = {
    status: 'healthy' as ComponentStatus,
    timestamp: new Date().toISOString(),
    version: appInfoQueries.getVersion(),
    uptime: Math.floor((Date.now() - startupTime) / 1000),
    components: { sqlite, repos, jobs, backups, logs },
  };

  response.status = determineOverallStatus(response.components);

  const httpStatus = response.status === 'unhealthy' ? 503 : 200;
  return json(response, { status: httpStatus });
};

interface Components {
  sqlite: { status: ComponentStatus };
  repos: { status: ComponentStatus };
  jobs: { status: ComponentStatus };
  backups: { status: ComponentStatus };
  logs: { status: ComponentStatus };
}

function determineOverallStatus(components: Components): ComponentStatus {
  const statuses = [
    components.sqlite.status,
    components.repos.status,
    components.jobs.status,
    components.backups.status,
    components.logs.status,
  ];

  // If sqlite is unhealthy, everything is unhealthy
  if (components.sqlite.status === 'unhealthy') {
    return 'unhealthy';
  }

  // If all PCD repos are unhealthy, system is unhealthy
  if (components.repos.status === 'unhealthy') {
    return 'unhealthy';
  }

  // If any component is degraded, system is degraded
  if (statuses.some((s) => s === 'degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

function checkSqlite() {
  const start = performance.now();

  try {
    db.queryFirst('SELECT 1');
    const responseTimeMs = Math.round((performance.now() - start) * 100) / 100;
    const migration = migrationRunner.getCurrentVersion();

    return {
      status: 'healthy' as ComponentStatus,
      responseTimeMs,
      migration,
    };
  } catch (error) {
    return {
      status: 'unhealthy' as ComponentStatus,
      responseTimeMs: -1,
      migration: 0,
      message: error instanceof Error ? error.message : 'Database query failed',
    };
  }
}

function checkRepos(verbose: boolean) {
  try {
    const allDatabases = databaseInstancesQueries.getAll();
    const enabledDatabases = allDatabases.filter((d) => d.enabled === 1);
    const disabledDatabases = allDatabases.filter((d) => d.enabled === 0);

    // Check how many have compiled caches
    let cachedCount = 0;
    for (const dbInstance of enabledDatabases) {
      const cache = getCache(dbInstance.id);
      if (cache?.isBuilt()) {
        cachedCount++;
      }
    }

    const total = allDatabases.length;
    const enabled = enabledDatabases.length;
    const disabled = disabledDatabases.length;

    let status: ComponentStatus = 'healthy';
    let message: string | undefined;

    if (total === 0) {
      status = 'healthy';
      message = 'No repos configured';
    } else if (enabled === 0) {
      status = 'unhealthy';
      message = 'All repos are disabled';
    } else if (disabled > 0) {
      status = 'degraded';
      message = `${disabled} repo(s) disabled due to errors`;
    } else if (cachedCount < enabled) {
      status = 'degraded';
      message = `${enabled - cachedCount} repo(s) not cached`;
    }

    // Minimal response
    const result: Record<string, unknown> = { status };
    if (message) result.message = message;

    // Verbose adds counts
    if (verbose) {
      result.total = total;
      result.enabled = enabled;
      result.cached = cachedCount;
      result.disabled = disabled;
    }

    return result as { status: ComponentStatus; message?: string };
  } catch (error) {
    return {
      status: 'unhealthy' as ComponentStatus,
      message: error instanceof Error ? error.message : 'Failed to check repos',
    };
  }
}

function checkJobs(verbose: boolean) {
  try {
    const oldestQueued = jobQueueQueries.getOldestQueuedRunAt();
    let status: ComponentStatus = 'healthy';
    let message: string | undefined;

    if (oldestQueued) {
      const queuedAt = new Date(oldestQueued).getTime();
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

      if (queuedAt < tenMinutesAgo) {
        status = 'degraded';
        message = 'Job queue has stale entries';
      }
    }

    // Minimal response
    const result: Record<string, unknown> = { status };
    if (message) result.message = message;

    // Verbose adds oldest queued run time
    if (verbose) {
      result.oldestQueued = oldestQueued;
    }

    return result as { status: ComponentStatus; message?: string };
  } catch (error) {
    return {
      status: 'unhealthy' as ComponentStatus,
      message: error instanceof Error ? error.message : 'Failed to check jobs',
    };
  }
}

async function checkBackups(verbose: boolean) {
  try {
    const settings = backupSettingsQueries.get();
    const enabled = settings?.enabled === 1;
    const retentionDays = settings?.retention_days ?? 30;

    if (!enabled) {
      return {
        status: 'healthy' as ComponentStatus,
        enabled: false,
        message: 'Backups disabled',
      };
    }

    // Check backup directory
    const backupPath = config.paths.backups;
    let count = 0;
    let totalSizeBytes = 0;
    let lastBackup: string | null = null;
    let lastBackupTime: number | null = null;

    try {
      for await (const entry of Deno.readDir(backupPath)) {
        if (entry.isFile && entry.name.startsWith('backup-') && entry.name.endsWith('.tar.gz')) {
          count++;
          const stat = await Deno.stat(`${backupPath}/${entry.name}`);
          totalSizeBytes += stat.size;

          if (!lastBackupTime || stat.mtime!.getTime() > lastBackupTime) {
            lastBackupTime = stat.mtime!.getTime();
            lastBackup = stat.mtime!.toISOString();
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }

    let status: ComponentStatus = 'healthy';
    let message: string | undefined;

    if (count === 0) {
      status = 'degraded';
      message = 'No backups exist';
    } else if (lastBackupTime) {
      // Check if last backup is older than 2x retention period
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      if (lastBackupTime < twoDaysAgo) {
        status = 'degraded';
        message = 'Last backup is older than 2 days';
      }
    }

    // Minimal response
    const result: Record<string, unknown> = { status, enabled };
    if (message) result.message = message;

    // Verbose adds details
    if (verbose) {
      result.lastBackup = lastBackup;
      result.count = count;
      result.totalSize = formatBytes(totalSizeBytes);
      result.retentionDays = retentionDays;
    }

    return result as { status: ComponentStatus; enabled: boolean; message?: string };
  } catch (error) {
    return {
      status: 'unhealthy' as ComponentStatus,
      enabled: false,
      message: error instanceof Error ? error.message : 'Failed to check backups',
    };
  }
}

async function checkLogs(verbose: boolean) {
  try {
    const logPath = config.paths.logs;
    let totalSizeBytes = 0;
    let fileCount = 0;
    let oldestLog: string | null = null;
    let newestLog: string | null = null;

    const logDateRegex = /^(\d{4}-\d{2}-\d{2})\.log$/;

    try {
      for await (const entry of Deno.readDir(logPath)) {
        if (entry.isFile) {
          const match = entry.name.match(logDateRegex);
          if (match) {
            fileCount++;
            const stat = await Deno.stat(`${logPath}/${entry.name}`);
            totalSizeBytes += stat.size;

            const dateStr = match[1];
            if (!oldestLog || dateStr < oldestLog) {
              oldestLog = dateStr;
            }
            if (!newestLog || dateStr > newestLog) {
              newestLog = dateStr;
            }
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }

    let status: ComponentStatus = 'healthy';
    let message: string | undefined;

    if (totalSizeBytes > LOG_SIZE_CRITICAL_BYTES) {
      status = 'degraded';
      message = `Log directory is very large (${formatBytes(totalSizeBytes)})`;
    } else if (totalSizeBytes > LOG_SIZE_WARN_BYTES) {
      status = 'degraded';
      message = `Log directory is getting large (${formatBytes(totalSizeBytes)})`;
    }

    // Minimal response
    const result: Record<string, unknown> = { status };
    if (message) result.message = message;

    // Verbose adds details
    if (verbose) {
      result.totalSize = formatBytes(totalSizeBytes);
      result.fileCount = fileCount;
      result.oldestLog = oldestLog;
      result.newestLog = newestLog;
    }

    return result as { status: ComponentStatus; message?: string };
  } catch (error) {
    return {
      status: 'unhealthy' as ComponentStatus,
      message: error instanceof Error ? error.message : 'Failed to check logs',
    };
  }
}
