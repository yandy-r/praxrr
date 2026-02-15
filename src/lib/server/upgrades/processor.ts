/**
 * Main orchestrator for processing upgrade configs
 * Coordinates fetching, filtering, selection, and searching
 */

import { RadarrClient } from '$lib/server/utils/arr/clients/radarr.ts';
import type { ArrInstance } from '$lib/server/db/queries/arrInstances.ts';
import type { UpgradeConfig, FilterConfig } from '$shared/upgrades/filters.ts';
import { evaluateGroup } from '$shared/upgrades/filters.ts';
import { getSelector } from '$shared/upgrades/selectors.ts';
import type { UpgradeItem, UpgradeJobLog, UpgradeSelectionItem } from './types.ts';
import { normalizeRadarrItems } from './normalize.ts';
import {
  filterByFilterTag,
  getFilterTagLabel,
  applyFilterTagToMovies,
  isFilterExhausted,
  resetFilterCooldown,
} from './cooldown.ts';
import { logUpgradeRun, logUpgradeError, logUpgradeSkipped } from './logger.ts';
import { notifications } from '$lib/server/notifications/definitions/index.ts';
import { notificationServicesQueries } from '$lib/server/db/queries/notificationServices.ts';

/**
 * In-memory cache for dry run exclusions
 * Tracks items "searched" in dry run mode to avoid selecting the same items repeatedly
 * Map<instanceId, { items: Set<itemId>, timestamp: number }>
 */
const dryRunExclusions = new Map<number, { items: Set<number>; timestamp: number }>();
const DRY_RUN_EXCLUSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get excluded item IDs for dry run, auto-clearing stale entries
 */
function getDryRunExclusions(instanceId: number): Set<number> {
  const entry = dryRunExclusions.get(instanceId);
  if (!entry) return new Set();

  // Clear if expired
  if (Date.now() - entry.timestamp > DRY_RUN_EXCLUSION_TTL_MS) {
    dryRunExclusions.delete(instanceId);
    return new Set();
  }

  return entry.items;
}

/**
 * Add items to dry run exclusion cache
 */
function addDryRunExclusions(instanceId: number, itemIds: number[]): void {
  const existing = getDryRunExclusions(instanceId);
  for (const id of itemIds) {
    existing.add(id);
  }
  dryRunExclusions.set(instanceId, { items: existing, timestamp: Date.now() });
}

/**
 * Clear dry run exclusions for an instance
 * @returns Array of item IDs that were cleared
 */
export function clearDryRunExclusions(instanceId: number): number[] {
  const entry = dryRunExclusions.get(instanceId);
  const clearedIds = entry ? Array.from(entry.items) : [];
  dryRunExclusions.delete(instanceId);
  return clearedIds;
}

/**
 * Send upgrade notification
 */
async function sendUpgradeNotification(log: UpgradeJobLog, manual: boolean): Promise<void> {
  // Only notify if there were items searched
  if (log.selection.actualCount > 0) {
    const { DiscordNotifier } = await import('$lib/server/notifications/notifiers/discord/index.ts');

    // Get all enabled services that have this notification type enabled
    const services = notificationServicesQueries.getAllEnabled();
    const notificationType = `upgrade.${log.status}`;

    for (const service of services) {
      try {
        const enabledTypes = JSON.parse(service.enabled_types) as string[];
        if (!enabledTypes.includes(notificationType)) {
          continue;
        }

        const config = JSON.parse(service.config);

        if (service.service_type === 'discord') {
          const notifier = new DiscordNotifier(config);
          const notification = notifications.upgrade({ log, config, manual }).build();
          await notifier.notify(notification);
        }
      } catch {
        // Errors are logged by the notifier
      }
    }
  }
}

/**
 * Get the next filter to run based on the config's mode
 */
function getNextFilter(config: UpgradeConfig): FilterConfig | null {
  const enabledFilters = config.filters.filter((f) => f.enabled);

  if (enabledFilters.length === 0) {
    return null;
  }

  if (config.filterMode === 'random') {
    const randomIndex = Math.floor(Math.random() * enabledFilters.length);
    return enabledFilters[randomIndex];
  }

  // Round robin
  const index = config.currentFilterIndex % enabledFilters.length;
  return enabledFilters[index];
}

/**
 * Create an empty/skipped job log
 */
function createSkippedLog(config: UpgradeConfig, instance: ArrInstance, reason: string): UpgradeJobLog {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    configId: config.id ?? 0,
    instanceId: instance.id,
    instanceName: instance.name,
    startedAt: now,
    completedAt: now,
    status: 'skipped',
    config: {
      schedule: config.schedule,
      filterMode: config.filterMode,
      selectedFilter: '',
      dryRun: config.dryRun,
    },
    library: {
      totalItems: 0,
      fetchedFromCache: false,
      fetchDurationMs: 0,
    },
    filter: {
      id: '',
      name: '',
      rules: { type: 'group', match: 'all', children: [] },
      matchedCount: 0,
      afterCooldown: 0,
      dryRunExcluded: 0,
    },
    selection: {
      method: '',
      requestedCount: 0,
      actualCount: 0,
      items: [] as UpgradeSelectionItem[],
    },
    results: {
      searchesTriggered: 0,
      successful: 0,
      failed: 0,
      errors: [reason],
    },
  };
}

/**
 * Process a single upgrade config for an arr instance
 */
export async function processUpgradeConfig(
  config: UpgradeConfig,
  instance: ArrInstance,
  manual: boolean = false
): Promise<UpgradeJobLog> {
  const startedAt = new Date();
  const logId = crypto.randomUUID();

  // Get the filter to run
  const filter = getNextFilter(config);

  if (!filter) {
    const log = createSkippedLog(config, instance, 'No enabled filters');
    await logUpgradeSkipped(instance.id, instance.name, 'No enabled filters');
    return log;
  }

  // Create client
  const client = new RadarrClient(instance.url, instance.api_key);

  try {
    // Step 1: Fetch library data
    const fetchStart = Date.now();
    const [movies, profiles] = await Promise.all([client.getMovies(), client.getQualityProfiles()]);

    // Get movie files for movies with files
    const movieIdsWithFiles = movies.filter((m) => m.hasFile).map((m) => m.id);
    const movieFiles = await client.getMovieFiles(movieIdsWithFiles);
    const fetchDurationMs = Date.now() - fetchStart;

    // Create lookup maps
    const movieFileMap = new Map(movieFiles.map((mf) => [mf.movieId, mf]));
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    // Fetch tags for normalization and cooldown
    const tags = await client.getTags();
    const tagMap = new Map(tags.map((t) => [t.id, t.label]));

    // Step 2: Normalize items
    const normalizedItems = normalizeRadarrItems(movies, movieFileMap, profileMap, filter.cutoff, tagMap);

    // Step 3: Apply filter rules
    const matchedItems = normalizedItems.filter((item) =>
      evaluateGroup(item as unknown as Record<string, unknown>, filter.group)
    );

    // Step 4: Filter by filter-level tag (items already searched by this filter)
    // First check if filter is exhausted - if so, reset the cooldown
    if (isFilterExhausted(matchedItems, tags, filter.name)) {
      const resetResult = await resetFilterCooldown(client, filter.name);
      if (resetResult.reset > 0) {
        // Re-fetch tags after reset
        const updatedTags = await client.getTags();
        tags.length = 0;
        tags.push(...updatedTags);
      }
    }

    const afterCooldownItems = filterByFilterTag(matchedItems, tags, filter.name);
    const afterCooldownCount = afterCooldownItems.length;

    // Step 4b: If dry run, also exclude items from previous dry runs
    let availableItems = afterCooldownItems;
    let dryRunExcludedCount = 0;
    if (config.dryRun) {
      const excluded = getDryRunExclusions(instance.id);
      if (excluded.size > 0) {
        availableItems = afterCooldownItems.filter((item) => !excluded.has(item.id));
        dryRunExcludedCount = afterCooldownCount - availableItems.length;
      }
    }

    // Step 5: Apply selector
    const selector = getSelector(filter.selector);
    const selectedItems: UpgradeItem[] = selector
      ? selector.select(availableItems, filter.count)
      : availableItems.slice(0, filter.count);

    // Step 6: Trigger search if we have items (skip if dry run)
    let searchesTriggered = 0;
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];
    const isDryRun = config.dryRun;
    const selectionItems: UpgradeSelectionItem[] = [];

    // Helper to get original file info
    const getOriginalFile = (item: UpgradeItem) => {
      const movieFile = movieFileMap.get(item.id);
      return {
        fileName: movieFile?.relativePath?.split('/').pop() ?? 'Unknown',
        formats: movieFile?.customFormats.map((cf) => cf.name) ?? [],
        score: item.score,
      };
    };

    if (selectedItems.length > 0) {
      if (isDryRun) {
        // Dry run - use interactive search to preview what WOULD be grabbed

        // Track selected items to exclude from future dry runs
        addDryRunExclusions(
          instance.id,
          selectedItems.map((item) => item.id)
        );

        // Get score comparisons using interactive search (dry run preview)
        for (const item of selectedItems) {
          const original = getOriginalFile(item);
          try {
            const releases = await client.getReleases(item.id);
            // Find best approved release (not rejected)
            const bestRelease = releases.find((r) => r.approved && !r.rejected);

            if (bestRelease && bestRelease.customFormatScore > item.score) {
              selectionItems.push({
                id: item.id,
                title: item.title,
                original,
                upgrade: {
                  release: bestRelease.title,
                  formats: bestRelease.customFormats.map((cf) => cf.name),
                  score: bestRelease.customFormatScore,
                },
                scoreDelta: bestRelease.customFormatScore - item.score,
              });
              successful++;
            } else {
              // No upgrade available
              selectionItems.push({
                id: item.id,
                title: item.title,
                original,
                upgrade: null,
                scoreDelta: null,
              });
            }
            searchesTriggered++;
          } catch (error) {
            // If getReleases fails for an item, still record it without upgrade info
            selectionItems.push({
              id: item.id,
              title: item.title,
              original,
              upgrade: null,
              scoreDelta: null,
            });
            failed++;
            errors.push(
              `Failed to get releases for ${item.title}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        // Live mode - trigger search, wait for completion, check queue
        try {
          const movieIds = selectedItems.map((item) => item.id);

          // Trigger search and wait for completion
          const searchCommand = await client.searchMovies(movieIds);
          await client.waitForCommand(searchCommand.id);
          searchesTriggered = movieIds.length;

          // Small delay for queue to populate
          await new Promise((r) => setTimeout(r, 2000));

          // Check queue for grabs
          const queue = await client.getQueue(movieIds);
          const queueMap = new Map(queue.map((q) => [q.movieId, q]));

          // Build selection items with comparisons
          for (const item of selectedItems) {
            const original = getOriginalFile(item);
            const grabbed = queueMap.get(item.id);
            if (grabbed) {
              selectionItems.push({
                id: item.id,
                title: item.title,
                original,
                upgrade: {
                  release: grabbed.title,
                  formats: grabbed.customFormats.map((cf) => cf.name),
                  score: grabbed.customFormatScore,
                },
                scoreDelta: grabbed.customFormatScore - original.score,
              });
              successful++;
            } else {
              selectionItems.push({
                id: item.id,
                title: item.title,
                original,
                upgrade: null,
                scoreDelta: null,
              });
            }
          }

          // Apply filter tag to mark items as searched by this filter
          const tagLabel = getFilterTagLabel(filter.name);
          const filterTag = await client.getOrCreateTag(tagLabel);
          const tagResult = await applyFilterTagToMovies(
            client,
            selectedItems.map((item) => item._raw),
            filterTag.id
          );

          failed = tagResult.failed;
          errors.push(...tagResult.errors);
        } catch (error) {
          failed = selectedItems.length;
          errors.push(`Search failed: ${error instanceof Error ? error.message : String(error)}`);

          // Still populate selection items even on failure
          for (const item of selectedItems) {
            selectionItems.push({
              id: item.id,
              title: item.title,
              original: getOriginalFile(item),
              upgrade: null,
              scoreDelta: null,
            });
          }
        }
      }
    }

    // Build the log
    const completedAt = new Date();
    const log: UpgradeJobLog = {
      id: logId,
      configId: config.id ?? 0,
      instanceId: instance.id,
      instanceName: instance.name,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: failed > 0 && successful === 0 ? 'failed' : failed > 0 ? 'partial' : 'success',
      config: {
        schedule: config.schedule,
        filterMode: config.filterMode,
        selectedFilter: filter.name,
        dryRun: isDryRun,
      },
      library: {
        totalItems: movies.length,
        fetchedFromCache: false, // TODO: implement caching
        fetchDurationMs,
      },
      filter: {
        id: filter.id,
        name: filter.name,
        rules: filter.group,
        matchedCount: matchedItems.length,
        afterCooldown: afterCooldownCount,
        dryRunExcluded: dryRunExcludedCount,
      },
      selection: {
        method: filter.selector,
        requestedCount: filter.count,
        actualCount: selectedItems.length,
        items: selectionItems,
      },
      results: {
        searchesTriggered,
        successful,
        failed,
        errors,
      },
    };

    await logUpgradeRun(log);

    // Send notification
    await sendUpgradeNotification(log, manual);

    return log;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logUpgradeError(instance.id, instance.name, errorMessage);

    const log = createSkippedLog(config, instance, errorMessage);
    log.id = logId;
    log.startedAt = startedAt.toISOString();
    log.completedAt = new Date().toISOString();
    log.status = 'failed';
    log.config.selectedFilter = filter?.name ?? '';
    log.filter.id = filter?.id ?? '';
    log.filter.name = filter?.name ?? '';

    return log;
  } finally {
    client.close();
  }
}
