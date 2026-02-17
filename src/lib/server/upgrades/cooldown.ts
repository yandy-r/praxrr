/**
 * Tag-based cooldown tracking for upgrade searches
 *
 * Basic mode (current implementation):
 * - Uses filter-level tags: praxrr-filter-{filterId}
 * - Items are tagged when searched
 * - Tagged items are skipped on subsequent runs
 * - When filter is exhausted (no untagged items), all tags are cleared to reset
 *
 * Future: Advanced mode with adaptive backoff per scratchpad.md
 */

import type { RadarrTag, RadarrMovie } from '$lib/server/utils/arr/types.ts';
import type { RadarrClient } from '$lib/server/utils/arr/clients/radarr.ts';

const FILTER_TAG_PREFIX = 'praxrr-';

/**
 * Slugify a filter name for use in tags
 * Converts "Things I Don't Want to Upgrade" -> "things-i-dont-want-to-upgrade"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '') // Remove apostrophes
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
    .replace(/^-+|-+$/g, '') // Trim leading/trailing dashes
    .slice(0, 50); // Limit length
}

/**
 * Get the tag label for a specific filter
 */
export function getFilterTagLabel(filterName: string): string {
  return `${FILTER_TAG_PREFIX}${slugify(filterName)}`;
}

/**
 * Check if a tag label is a praxrr filter tag
 */
export function isFilterTag(label: string): boolean {
  return label.startsWith(FILTER_TAG_PREFIX);
}

/**
 * Check if an item has a specific filter's tag
 */
export function hasFilterTag(itemTagIds: number[], allTags: RadarrTag[], filterName: string): boolean {
  const targetLabel = getFilterTagLabel(filterName);
  const tagMap = new Map(allTags.map((t) => [t.id, t.label]));

  for (const tagId of itemTagIds) {
    const label = tagMap.get(tagId);
    if (label === targetLabel) {
      return true;
    }
  }

  return false;
}

/**
 * Filter items that do NOT have the filter's tag
 * Returns only items eligible for searching (not yet searched by this filter)
 */
export function filterByFilterTag<T extends { _tags: number[] }>(
  items: T[],
  allTags: RadarrTag[],
  filterName: string
): T[] {
  return items.filter((item) => !hasFilterTag(item._tags, allTags, filterName));
}

/**
 * Apply a filter's tag to a movie
 * Adds the tag to the movie's existing tags and updates via API
 */
export async function applyFilterTag(client: RadarrClient, movie: RadarrMovie, tagId: number): Promise<RadarrMovie> {
  const currentTags = movie.tags ?? [];
  if (currentTags.includes(tagId)) {
    return movie; // Already has the tag
  }

  const updatedMovie = {
    ...movie,
    tags: [...currentTags, tagId],
  };

  return await client.updateMovie(updatedMovie);
}

/**
 * Apply filter tag to multiple movies
 */
export async function applyFilterTagToMovies(
  client: RadarrClient,
  movies: RadarrMovie[],
  tagId: number
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const movie of movies) {
    try {
      await applyFilterTag(client, movie, tagId);
      success++;
    } catch (error) {
      failed++;
      errors.push(`Failed to tag "${movie.title}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { success, failed, errors };
}

/**
 * Remove a filter's tag from a single movie
 */
export async function removeFilterTag(client: RadarrClient, movie: RadarrMovie, tagId: number): Promise<RadarrMovie> {
  const currentTags = movie.tags ?? [];
  if (!currentTags.includes(tagId)) {
    return movie; // Doesn't have the tag
  }

  const updatedMovie = {
    ...movie,
    tags: currentTags.filter((id) => id !== tagId),
  };

  return await client.updateMovie(updatedMovie);
}

/**
 * Reset filter cooldown by removing the filter's tag from all movies that have it
 * Called when a filter is "exhausted" (no more untagged items to search)
 *
 * @returns Count of movies that had their tags removed
 */
export async function resetFilterCooldown(
  client: RadarrClient,
  filterName: string
): Promise<{ reset: number; failed: number; errors: string[] }> {
  const tagLabel = getFilterTagLabel(filterName);

  // Find the tag ID
  const tags = await client.getTags();
  const filterTag = tags.find((t) => t.label === tagLabel);

  if (!filterTag) {
    // No tag exists, nothing to reset
    return { reset: 0, failed: 0, errors: [] };
  }

  // Get all movies that have this tag
  const movies = await client.getMovies();
  const taggedMovies = movies.filter((m) => m.tags?.includes(filterTag.id));

  if (taggedMovies.length === 0) {
    return { reset: 0, failed: 0, errors: [] };
  }

  let reset = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const movie of taggedMovies) {
    try {
      await removeFilterTag(client, movie, filterTag.id);
      reset++;
    } catch (error) {
      failed++;
      errors.push(`Failed to untag "${movie.title}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { reset, failed, errors };
}

/**
 * Check if a filter is exhausted (all matched items are tagged)
 * When true, the filter should be reset before the next run
 */
export function isFilterExhausted<T extends { _tags: number[] }>(
  matchedItems: T[],
  allTags: RadarrTag[],
  filterName: string
): boolean {
  const untaggedItems = filterByFilterTag(matchedItems, allTags, filterName);
  return untaggedItems.length === 0 && matchedItems.length > 0;
}
