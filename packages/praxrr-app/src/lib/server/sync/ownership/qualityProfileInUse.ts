/**
 * Load which quality profile ids an Arr instance still has assigned to media.
 *
 * Dispatch is per `arrType` onto the concrete client class only — a sibling
 * app's client is never used as a fallback, because the media-list endpoints
 * are not cross-Arr compatible. Any failure (or an unknown type) returns null
 * so the prune planner fails closed and blocks every QP candidate.
 */

import type { BaseArrClient } from '$arr/base.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { RadarrClient } from '$arr/clients/radarr.ts';
import { SonarrClient } from '$arr/clients/sonarr.ts';
import { logger } from '$logger/logger.ts';

export async function loadInUseQualityProfileIds(client: BaseArrClient, arrType: string): Promise<Set<number> | null> {
  try {
    if (arrType === 'radarr') {
      if (!(client instanceof RadarrClient)) return null;
      const movies = await client.getMovies();
      return collectProfileIds(movies.map((movie) => movie.qualityProfileId));
    }
    if (arrType === 'sonarr') {
      if (!(client instanceof SonarrClient)) return null;
      const series = await client.getAllSeries();
      return collectProfileIds(series.map((show) => show.qualityProfileId));
    }
    if (arrType === 'lidarr') {
      if (!(client instanceof LidarrClient)) return null;
      const artists = await client.getArtists();
      return collectProfileIds(artists.map((artist) => artist.qualityProfileId));
    }
    return null;
  } catch (error) {
    void logger.warn('Failed to load in-use quality profile ids; blocking quality profile prunes', {
      source: 'Sync:Ownership',
      meta: {
        arrType,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}

function collectProfileIds(ids: number[]): Set<number> {
  const inUse = new Set<number>();
  for (const id of ids) {
    if (Number.isInteger(id) && id > 0) inUse.add(id);
  }
  return inUse;
}
