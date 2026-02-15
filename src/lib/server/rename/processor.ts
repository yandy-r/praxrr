/**
 * Main orchestrator for processing rename configs
 * Coordinates fetching, filtering, and renaming files/folders
 */

import { RadarrClient } from '$lib/server/utils/arr/clients/radarr.ts';
import { SonarrClient } from '$lib/server/utils/arr/clients/sonarr.ts';
import type { ArrInstance } from '$lib/server/db/queries/arrInstances.ts';
import type { RenameSettings } from '$lib/server/db/queries/arrRenameSettings.ts';
import type { RenameJobLog, RenameItem } from './types.ts';
import { logRenameRun, logRenameStart, logRenameError, logRenameSkipped } from './logger.ts';
import { notifications } from '$lib/server/notifications/definitions/index.ts';
import { notificationServicesQueries } from '$lib/server/db/queries/notificationServices.ts';

/**
 * Create an empty/skipped job log
 */
function createSkippedLog(
  settings: RenameSettings,
  instance: ArrInstance,
  reason: string,
  manual: boolean = false
): RenameJobLog {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    instanceId: instance.id,
    instanceName: instance.name,
    instanceType: instance.type as 'radarr' | 'sonarr',
    startedAt: now,
    completedAt: now,
    status: 'skipped',
    config: {
      dryRun: settings.dryRun,
      renameFolders: settings.renameFolders,
      ignoreTag: settings.ignoreTag,
      manual,
    },
    library: {
      totalItems: 0,
      fetchDurationMs: 0,
    },
    filtering: {
      afterIgnoreTag: 0,
      skippedByTag: 0,
    },
    results: {
      filesNeedingRename: 0,
      filesRenamed: 0,
      foldersRenamed: 0,
      commandsTriggered: 0,
      commandsCompleted: 0,
      commandsFailed: 0,
      errors: [reason],
    },
    renamedItems: [],
  };
}

/**
 * Send rename notification
 */
async function sendRenameNotification(log: RenameJobLog, summaryNotifications: boolean): Promise<void> {
  // Only notify if there were files to rename
  if (log.results.filesNeedingRename > 0) {
    const { DiscordNotifier } = await import('$lib/server/notifications/notifiers/discord/index.ts');

    // Get all enabled services that have this notification type enabled
    const services = notificationServicesQueries.getAllEnabled();
    const notificationType = `rename.${log.status}`;

    for (const service of services) {
      try {
        const enabledTypes = JSON.parse(service.enabled_types) as string[];
        if (!enabledTypes.includes(notificationType)) {
          continue;
        }

        const config = JSON.parse(service.config);

        if (service.service_type === 'discord') {
          const notifier = new DiscordNotifier(config);
          const notification = notifications.rename({ log, config, summaryNotifications }).build();
          await notifier.notify(notification);
        }
      } catch {
        // Errors are logged by the notifier
      }
    }
  }
}

/**
 * Process rename for a Radarr instance
 */
async function processRadarrRename(
  client: RadarrClient,
  settings: RenameSettings,
  instance: ArrInstance,
  startedAt: Date,
  logId: string,
  manual: boolean
): Promise<RenameJobLog> {
  const fetchStart = Date.now();

  // Fetch movies and tags
  const [movies, tags] = await Promise.all([client.getMovies(), client.getTags()]);
  const fetchDurationMs = Date.now() - fetchStart;

  // Find the ignore tag ID if configured
  let ignoreTagId: number | null = null;
  if (settings.ignoreTag) {
    const ignoreTag = tags.find((t) => t.label.toLowerCase() === settings.ignoreTag!.toLowerCase());
    ignoreTagId = ignoreTag?.id ?? null;
  }

  // Filter out items with the ignore tag
  const filteredMovies = ignoreTagId ? movies.filter((m) => !m.tags?.includes(ignoreTagId!)) : movies;

  // Get rename previews for each movie that has a file
  const moviesWithFiles = filteredMovies.filter((m) => m.hasFile);
  const renameItems: RenameItem[] = [];

  for (const movie of moviesWithFiles) {
    const previews = await client.getRenamePreview(movie.id);
    if (previews.length > 0) {
      renameItems.push({
        id: movie.id,
        title: movie.title,
        previews,
      });
    }
  }

  const filesNeedingRename = renameItems.reduce((sum, item) => sum + item.previews.length, 0);

  // If dry run, just return the preview info
  if (settings.dryRun) {
    const log: RenameJobLog = {
      id: logId,
      instanceId: instance.id,
      instanceName: instance.name,
      instanceType: 'radarr',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'success',
      config: {
        dryRun: true,
        renameFolders: settings.renameFolders,
        ignoreTag: settings.ignoreTag,
        manual,
      },
      library: {
        totalItems: movies.length,
        fetchDurationMs,
      },
      filtering: {
        afterIgnoreTag: filteredMovies.length,
        skippedByTag: movies.length - filteredMovies.length,
      },
      results: {
        filesNeedingRename,
        filesRenamed: 0,
        foldersRenamed: 0,
        commandsTriggered: 0,
        commandsCompleted: 0,
        commandsFailed: 0,
        errors: ['[DRY RUN] Rename skipped'],
      },
      renamedItems: renameItems.map((item) => ({
        id: item.id,
        title: item.title,
        files: item.previews.map((p) => ({ existingPath: p.existingPath, newPath: p.newPath })),
      })),
    };

    await logRenameRun(log);
    sendRenameNotification(log, settings.summaryNotifications);
    return log;
  }

  // Execute renames
  let filesRenamed = 0;
  let commandsTriggered = 0;
  let commandsCompleted = 0;
  let commandsFailed = 0;
  const errors: string[] = [];
  const renamedItems: {
    id: number;
    title: string;
    files: { existingPath: string; newPath: string }[];
  }[] = [];

  if (renameItems.length > 0) {
    const movieIds = renameItems.map((item) => item.id);

    try {
      // Fire rename command without waiting - Radarr processes in background
      await client.renameMovies(movieIds);
      commandsTriggered++;
      commandsCompleted++;

      for (const item of renameItems) {
        filesRenamed += item.previews.length;
        renamedItems.push({
          id: item.id,
          title: item.title,
          files: item.previews.map((p) => ({ existingPath: p.existingPath, newPath: p.newPath })),
        });
      }
    } catch (error) {
      commandsFailed++;
      errors.push(`Failed to rename movies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Rename folders if enabled
  let foldersRenamed = 0;
  if (settings.renameFolders && renamedItems.length > 0) {
    // Group movies by root folder path for batch operation
    const movieIds = renamedItems.map((item) => item.id);

    // Get movies to find their root folder paths
    const moviesToRename = movies.filter((m) => movieIds.includes(m.id));
    const rootFolderPaths = [...new Set(moviesToRename.map((m) => m.rootFolderPath).filter(Boolean))];

    for (const rootPath of rootFolderPaths) {
      const movieIdsInPath = moviesToRename.filter((m) => m.rootFolderPath === rootPath).map((m) => m.id);

      try {
        await client.renameMovieFolders(movieIdsInPath, rootPath!);
        foldersRenamed += movieIdsInPath.length;

        // Fire refresh without waiting - Radarr processes in background
        await client.refreshMovies(movieIdsInPath);
      } catch (error) {
        errors.push(
          `Failed to rename folders in ${rootPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const log: RenameJobLog = {
    id: logId,
    instanceId: instance.id,
    instanceName: instance.name,
    instanceType: 'radarr',
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: commandsFailed > 0 && commandsCompleted === 0 ? 'failed' : commandsFailed > 0 ? 'partial' : 'success',
    config: {
      dryRun: false,
      renameFolders: settings.renameFolders,
      ignoreTag: settings.ignoreTag,
      manual,
    },
    library: {
      totalItems: movies.length,
      fetchDurationMs,
    },
    filtering: {
      afterIgnoreTag: filteredMovies.length,
      skippedByTag: movies.length - filteredMovies.length,
    },
    results: {
      filesNeedingRename,
      filesRenamed,
      foldersRenamed,
      commandsTriggered,
      commandsCompleted,
      commandsFailed,
      errors,
    },
    renamedItems,
  };

  await logRenameRun(log);
  sendRenameNotification(log, settings.summaryNotifications);
  return log;
}

/**
 * Process rename for a Sonarr instance
 */
async function processSonarrRename(
  client: SonarrClient,
  settings: RenameSettings,
  instance: ArrInstance,
  startedAt: Date,
  logId: string,
  manual: boolean
): Promise<RenameJobLog> {
  const fetchStart = Date.now();

  // Fetch series and tags
  const [series, tags] = await Promise.all([client.getAllSeries(), client.getTags()]);
  const fetchDurationMs = Date.now() - fetchStart;

  // Find the ignore tag ID if configured
  let ignoreTagId: number | null = null;
  if (settings.ignoreTag) {
    const ignoreTag = tags.find((t) => t.label.toLowerCase() === settings.ignoreTag!.toLowerCase());
    ignoreTagId = ignoreTag?.id ?? null;
  }

  // Filter out items with the ignore tag
  const filteredSeries = ignoreTagId ? series.filter((s) => !s.tags?.includes(ignoreTagId!)) : series;

  // Get rename previews for each series that has files
  const seriesWithFiles = filteredSeries.filter((s) => s.statistics && s.statistics.episodeFileCount > 0);
  const renameItems: RenameItem[] = [];

  for (const show of seriesWithFiles) {
    const previews = await client.getRenamePreview(show.id);
    if (previews.length > 0) {
      renameItems.push({
        id: show.id,
        title: show.title,
        previews,
      });
    }
  }

  const filesNeedingRename = renameItems.reduce((sum, item) => sum + item.previews.length, 0);

  // If dry run, just return the preview info
  if (settings.dryRun) {
    const log: RenameJobLog = {
      id: logId,
      instanceId: instance.id,
      instanceName: instance.name,
      instanceType: 'sonarr',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'success',
      config: {
        dryRun: true,
        renameFolders: settings.renameFolders,
        ignoreTag: settings.ignoreTag,
        manual,
      },
      library: {
        totalItems: series.length,
        fetchDurationMs,
      },
      filtering: {
        afterIgnoreTag: filteredSeries.length,
        skippedByTag: series.length - filteredSeries.length,
      },
      results: {
        filesNeedingRename,
        filesRenamed: 0,
        foldersRenamed: 0,
        commandsTriggered: 0,
        commandsCompleted: 0,
        commandsFailed: 0,
        errors: ['[DRY RUN] Rename skipped'],
      },
      renamedItems: renameItems.map((item) => ({
        id: item.id,
        title: item.title,
        files: item.previews.map((p) => ({ existingPath: p.existingPath, newPath: p.newPath })),
      })),
    };

    await logRenameRun(log);
    sendRenameNotification(log, settings.summaryNotifications);
    return log;
  }

  // Execute renames
  let filesRenamed = 0;
  let commandsTriggered = 0;
  let commandsCompleted = 0;
  let commandsFailed = 0;
  const errors: string[] = [];
  const renamedItems: {
    id: number;
    title: string;
    files: { existingPath: string; newPath: string }[];
  }[] = [];

  if (renameItems.length > 0) {
    const seriesIds = renameItems.map((item) => item.id);

    try {
      // Fire rename command without waiting - Sonarr processes in background
      await client.renameSeries(seriesIds);
      commandsTriggered++;
      commandsCompleted++;

      for (const item of renameItems) {
        filesRenamed += item.previews.length;
        renamedItems.push({
          id: item.id,
          title: item.title,
          files: item.previews.map((p) => ({ existingPath: p.existingPath, newPath: p.newPath })),
        });
      }
    } catch (error) {
      commandsFailed++;
      errors.push(`Failed to rename series: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Rename folders if enabled
  let foldersRenamed = 0;
  if (settings.renameFolders && renamedItems.length > 0) {
    // Group series by root folder path for batch operation
    const seriesIds = renamedItems.map((item) => item.id);

    // Get series to find their root folder paths
    const seriesToRename = series.filter((s) => seriesIds.includes(s.id));
    const rootFolderPaths = [
      ...new Set(
        seriesToRename
          .map((s) => {
            // Extract root folder from path (path minus last segment)
            if (s.path) {
              const parts = s.path.split('/');
              parts.pop();
              return parts.join('/');
            }
            return null;
          })
          .filter(Boolean)
      ),
    ];

    for (const rootPath of rootFolderPaths) {
      const seriesIdsInPath = seriesToRename.filter((s) => s.path?.startsWith(rootPath!)).map((s) => s.id);

      try {
        await client.renameSeriesFolders(seriesIdsInPath, rootPath!);
        foldersRenamed += seriesIdsInPath.length;

        // Fire refresh without waiting - Sonarr processes in background
        await client.refreshSeries(seriesIdsInPath);
      } catch (error) {
        errors.push(
          `Failed to rename folders in ${rootPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const log: RenameJobLog = {
    id: logId,
    instanceId: instance.id,
    instanceName: instance.name,
    instanceType: 'sonarr',
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: commandsFailed > 0 && commandsCompleted === 0 ? 'failed' : commandsFailed > 0 ? 'partial' : 'success',
    config: {
      dryRun: false,
      renameFolders: settings.renameFolders,
      ignoreTag: settings.ignoreTag,
      manual,
    },
    library: {
      totalItems: series.length,
      fetchDurationMs,
    },
    filtering: {
      afterIgnoreTag: filteredSeries.length,
      skippedByTag: series.length - filteredSeries.length,
    },
    results: {
      filesNeedingRename,
      filesRenamed,
      foldersRenamed,
      commandsTriggered,
      commandsCompleted,
      commandsFailed,
      errors,
    },
    renamedItems,
  };

  await logRenameRun(log);
  sendRenameNotification(log, settings.summaryNotifications);
  return log;
}

/**
 * Process a single rename config for an arr instance
 */
export async function processRenameConfig(
  settings: RenameSettings,
  instance: ArrInstance,
  manual: boolean = false
): Promise<RenameJobLog> {
  const startedAt = new Date();
  const logId = crypto.randomUUID();

  await logRenameStart(instance.id, instance.name, settings.dryRun, manual);

  try {
    if (instance.type === 'radarr') {
      const client = new RadarrClient(instance.url, instance.api_key);
      try {
        return await processRadarrRename(client, settings, instance, startedAt, logId, manual);
      } finally {
        client.close();
      }
    } else if (instance.type === 'sonarr') {
      const client = new SonarrClient(instance.url, instance.api_key);
      try {
        return await processSonarrRename(client, settings, instance, startedAt, logId, manual);
      } finally {
        client.close();
      }
    } else {
      const log = createSkippedLog(settings, instance, `Rename not supported for ${instance.type}`, manual);
      await logRenameSkipped(instance.id, instance.name, `Rename not supported for ${instance.type}`);
      return log;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logRenameError(instance.id, instance.name, errorMessage);

    const log = createSkippedLog(settings, instance, errorMessage, manual);
    log.id = logId;
    log.startedAt = startedAt.toISOString();
    log.completedAt = new Date().toISOString();
    log.status = 'failed';

    return log;
  }
}
