/**
 * Types for the upgrade processing system
 */

import type { RadarrMovie } from '$lib/server/utils/arr/types.ts';
import type { FilterGroup } from '$shared/upgrades/filters.ts';

/**
 * Normalized item interface that matches filter field names
 * Used for evaluating filter rules against library items
 */
export interface UpgradeItem {
  // Core fields
  id: number;
  title: string;
  year: number;
  monitored: boolean;
  cutoff_met: boolean;
  minimum_availability: string;
  quality_profile: string;
  collection: string;
  studio: string;
  original_language: string;
  genres: string;
  keywords: string;
  release_group: string;
  tags: string;
  popularity: number;
  runtime: number;
  size_on_disk: number;
  tmdb_rating: number;
  imdb_rating: number;
  tomato_rating: number;
  trakt_rating: number;
  date_added: string;
  digital_release: string | null;
  physical_release: string | null;

  // For selectors (camelCase versions)
  dateAdded: string;
  score: number;

  // Original data for API calls
  _raw: RadarrMovie;
  _tags: number[];
}

/**
 * Original file info for upgrade comparison
 */
export interface UpgradeOriginalFile {
  fileName: string;
  formats: string[];
  score: number;
}

/**
 * Upgrade/new release info
 */
export interface UpgradeNewRelease {
  release: string; // release title
  formats: string[];
  score: number;
}

/**
 * Selection item with score comparison details
 */
export interface UpgradeSelectionItem {
  id: number;
  title: string;
  original: UpgradeOriginalFile;
  upgrade: UpgradeNewRelease | null; // null = no upgrade found
  scoreDelta: number | null;
}

/**
 * Structured log for each upgrade run
 * Contains all metrics and details about what happened
 */
export interface UpgradeJobLog {
  id: string; // UUID
  configId: number;
  instanceId: number;
  instanceName: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';

  config: {
    schedule: number;
    filterMode: string;
    selectedFilter: string;
    dryRun: boolean;
  };

  library: {
    totalItems: number;
    fetchedFromCache: boolean;
    fetchDurationMs: number;
  };

  filter: {
    id: string;
    name: string;
    rules: FilterGroup;
    matchedCount: number;
    afterCooldown: number;
    dryRunExcluded: number;
  };

  selection: {
    method: string;
    requestedCount: number;
    actualCount: number;
    items: UpgradeSelectionItem[];
  };

  results: {
    searchesTriggered: number;
    successful: number;
    failed: number;
    errors: string[];
  };
}

/**
 * Result from processing a single upgrade config
 */
export interface UpgradeProcessResult {
  success: boolean;
  log: UpgradeJobLog;
  error?: string;
}
