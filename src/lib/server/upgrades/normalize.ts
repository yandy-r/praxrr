/**
 * Normalization logic for converting arr library items to UpgradeItem
 * Maps raw API responses to the normalized interface used by filter evaluation
 */

import type { RadarrMovie, RadarrMovieFile, RadarrQualityProfile } from '$lib/server/utils/arr/types.ts';
import type { UpgradeItem } from './types.ts';

/**
 * Normalize a Radarr movie to an UpgradeItem for filter evaluation
 *
 * @param movie - The raw movie from Radarr API
 * @param movieFile - The movie file (if exists)
 * @param profile - The quality profile
 * @param cutoffPercent - The cutoff percentage from filter config (0-100)
 * @param tagMap - Map of tag IDs to labels for resolving tag names
 */
export function normalizeRadarrItem(
  movie: RadarrMovie,
  movieFile: RadarrMovieFile | undefined,
  profile: RadarrQualityProfile | undefined,
  cutoffPercent: number,
  tagMap?: Map<number, string>
): UpgradeItem {
  // Calculate current score
  const currentScore = movieFile?.customFormatScore ?? 0;

  // Calculate cutoff threshold based on profile and filter's cutoff percent
  const profileCutoff = profile?.cutoffFormatScore ?? 0;
  const cutoffThreshold = (profileCutoff * cutoffPercent) / 100;

  // Determine if cutoff is met
  const cutoffMet = currentScore >= cutoffThreshold;

  // Convert size to GB
  const sizeOnDiskGB = (movie.sizeOnDisk ?? 0) / (1024 * 1024 * 1024);

  // Extract ratings with fallbacks
  const tmdbRating = movie.ratings?.tmdb?.value ?? 0;
  const imdbRating = movie.ratings?.imdb?.value ?? 0;
  const tomatoRating = movie.ratings?.rottenTomatoes?.value ?? 0;
  const traktRating = movie.ratings?.trakt?.value ?? 0;

  // Date added - use movie's added date
  const dateAdded = movie.added ?? new Date().toISOString();

  // Release dates (null if not available)
  const digitalRelease = movie.digitalRelease ?? null;
  const physicalRelease = movie.physicalRelease ?? null;

  // Convert tag IDs to labels
  const tags = (movie.tags ?? [])
    .map((tagId) => tagMap?.get(tagId) ?? '')
    .filter(Boolean)
    .join(', ');

  return {
    // Core fields (snake_case for filter matching)
    id: movie.id,
    title: movie.title,
    year: movie.year ?? 0,
    monitored: movie.monitored ?? false,
    cutoff_met: cutoffMet,
    minimum_availability: movie.minimumAvailability ?? 'released',
    quality_profile: profile?.name ?? 'Unknown',
    collection: movie.collection?.title ?? movie.collection?.name ?? '',
    studio: movie.studio ?? '',
    original_language: movie.originalLanguage?.name ?? '',
    genres: movie.genres?.join(', ') ?? '',
    keywords: movie.keywords?.join(', ') ?? '',
    release_group: movieFile?.releaseGroup ?? '',
    tags,
    popularity: movie.popularity ?? 0,
    runtime: movie.runtime ?? 0,
    size_on_disk: sizeOnDiskGB,
    tmdb_rating: tmdbRating,
    imdb_rating: imdbRating,
    tomato_rating: tomatoRating,
    trakt_rating: traktRating,
    date_added: dateAdded,
    digital_release: digitalRelease,
    physical_release: physicalRelease,

    // For selectors (camelCase)
    dateAdded: dateAdded,
    score: currentScore,

    // Original data
    _raw: movie,
    _tags: movie.tags ?? [],
  };
}

/**
 * Normalize a batch of Radarr movies
 */
export function normalizeRadarrItems(
  movies: RadarrMovie[],
  movieFileMap: Map<number, RadarrMovieFile>,
  profileMap: Map<number, RadarrQualityProfile>,
  cutoffPercent: number,
  tagMap?: Map<number, string>
): UpgradeItem[] {
  return movies.map((movie) => {
    const movieFile = movieFileMap.get(movie.id);
    const profile = profileMap.get(movie.qualityProfileId);
    return normalizeRadarrItem(movie, movieFile, profile, cutoffPercent, tagMap);
  });
}
