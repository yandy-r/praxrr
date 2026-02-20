import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { cache } from '$cache/cache.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { SonarrClient } from '$utils/arr/clients/sonarr.ts';
import { logger } from '$logger/logger.ts';

type EpisodesResponse = components['schemas']['EpisodesResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

const EPISODE_CACHE_TTL = 300; // 5 minutes

/**
 * GET /api/v1/arr/library/episodes
 *
 * Get episode details for a Sonarr series (lazy-loaded on expand).
 * Returns episodes with quality, score, and progress information.
 *
 * Query params:
 * - instanceId: Arr instance ID (required, must be Sonarr)
 * - seriesId: Sonarr series ID (required)
 */
export const GET: RequestHandler = async ({ url }) => {
  const instanceId = url.searchParams.get('instanceId');
  const seriesIdParam = url.searchParams.get('seriesId');

  if (!instanceId) {
    return json({ error: 'instanceId is required' } satisfies ErrorResponse, { status: 400 });
  }

  if (!seriesIdParam) {
    return json({ error: 'seriesId is required' } satisfies ErrorResponse, { status: 400 });
  }

  const id = parseInt(instanceId, 10);
  if (isNaN(id)) {
    return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });
  }

  const seriesId = parseInt(seriesIdParam, 10);
  if (isNaN(seriesId)) {
    return json({ error: 'Invalid seriesId' } satisfies ErrorResponse, { status: 400 });
  }

  const instance = arrInstancesQueries.getById(id);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }

  if (instance.type !== 'sonarr') {
    return json({ error: 'Episode details are only available for Sonarr instances' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const cacheKey = `library-episodes:${id}:${seriesId}`;

  const cached = cache.get<components['schemas']['SonarrEpisodeItem'][]>(cacheKey);
  if (cached) {
    return json({ episodes: cached } satisfies EpisodesResponse);
  }

  try {
    const client = (await getArrInstanceClient(instance.type, instance.id, instance.url)) as SonarrClient;
    try {
      const profiles = await client.getQualityProfiles();
      const series = await client.getSeries(seriesId);
      const profile = profiles.find((p) => p.id === series.qualityProfileId);

      if (!profile) {
        return json(
          {
            error: `Quality profile not found for series ${seriesId}`,
          } satisfies ErrorResponse,
          { status: 500 }
        );
      }

      const episodes = await client.getSeriesEpisodeDetails(seriesId, profile);
      cache.set(cacheKey, episodes, EPISODE_CACHE_TTL);

      await logger.info(`Fetched episode details for series ${seriesId}`, {
        source: 'arr/library/episodes',
        meta: { instanceId: id, seriesId, episodeCount: episodes.length },
      });

      return json({ episodes } satisfies EpisodesResponse);
    } finally {
      client.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch episode details';

    await logger.error(`Failed to fetch episode details for series ${seriesId}`, {
      source: 'arr/library/episodes',
      meta: { instanceId: id, seriesId, error: message },
    });

    return json({ error: message } satisfies ErrorResponse, { status: 500 });
  }
};
