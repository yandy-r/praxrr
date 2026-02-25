import { fail, redirect } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { canWriteToBase } from '$pcd/index.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { OperationLayer } from '$pcd/index.ts';
import type { LidarrNamingRow, RadarrNamingRow, SonarrNamingRow } from '$shared/pcd/display.ts';
import {
  createLidarrNaming,
  createRadarrNaming,
  createSonarrNaming,
  getRadarrDefaults,
  getSonarrDefaults,
  getLidarrDefaults,
} from '$pcd/entities/mediaManagement/naming/index.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import { validateNamingFormat } from '$shared/pcd/namingTokens.ts';
import { logger } from '$logger/logger.ts';

const SUPPORTED_NAMING_ARR_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;

function isSupportedNamingArrType(value: FormDataEntryValue | null): value is ArrAppType {
  return typeof value === 'string' && SUPPORTED_NAMING_ARR_TYPES.some((arrType) => arrType === value);
}

export const load: ServerLoad = async ({ params, parent }) => {
  const parentData = await parent();
  const databaseId = parseInt(params.databaseId!, 10);
  const cache = isNaN(databaseId) ? undefined : pcdManager.getCache(databaseId);
  const safeGetDefaults = async <T>(
    cache: PCDCache,
    fn: (cache: PCDCache) => Promise<T | null>,
    label: string
  ): Promise<T | null> => {
    try {
      return await fn(cache);
    } catch (err) {
      await logger.error(`Failed to load ${label} naming defaults from cache`, {
        source: 'naming-new',
        meta: {
          databaseId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }
  };

  let radarrDefaults: RadarrNamingRow | null = null;
  let sonarrDefaults: SonarrNamingRow | null = null;
  let lidarrDefaults: LidarrNamingRow | null = null;

  if (cache) {
    [radarrDefaults, sonarrDefaults, lidarrDefaults] = await Promise.all([
      safeGetDefaults(cache, getRadarrDefaults, 'radarr'),
      safeGetDefaults(cache, getSonarrDefaults, 'sonarr'),
      safeGetDefaults(cache, getLidarrDefaults, 'lidarr'),
    ]);
  }

  return {
    canWriteToBase: parentData.canWriteToBase,
    radarrDefaults,
    sonarrDefaults,
    lidarrDefaults,
  };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const { databaseId } = params;

    if (!databaseId) {
      return fail(400, { error: 'Missing database ID' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const formData = await request.formData();
    const arrTypeRaw = formData.get('arrType');
    const name = formData.get('name') as string;
    const layer = (formData.get('layer') as OperationLayer) || 'user';

    if (!name?.trim()) {
      return fail(400, { error: 'Name is required' });
    }

    if (!isSupportedNamingArrType(arrTypeRaw)) {
      return fail(400, { error: 'Invalid arr type' });
    }
    const arrType = arrTypeRaw;

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    if (arrType === 'radarr') {
      const rename = formData.get('rename') === 'true';
      const movieFormat = formData.get('movieFormat') as string;
      const movieFolderFormat = formData.get('movieFolderFormat') as string;
      const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
      const colonReplacementFormat = formData.get(
        'colonReplacementFormat'
      ) as RadarrNamingRow['colon_replacement_format'];

      const movieFormatValidation = validateNamingFormat(movieFormat || '', 'radarr');
      if (!movieFormatValidation.valid) {
        return fail(400, { error: `Movie format: ${movieFormatValidation.errors.join(', ')}` });
      }
      const folderFormatValidation = validateNamingFormat(movieFolderFormat || '', 'radarr');
      if (!folderFormatValidation.valid) {
        return fail(400, { error: `Folder format: ${folderFormatValidation.errors.join(', ')}` });
      }

      if (!colonReplacementFormat) {
        return fail(400, { error: 'Colon replacement format is required' });
      }

      let result;
      try {
        result = await createRadarrNaming({
          databaseId: currentDatabaseId,
          cache,
          layer,
          input: {
            name: name.trim(),
            rename,
            movieFormat: movieFormat || '',
            movieFolderFormat: movieFolderFormat || '',
            replaceIllegalCharacters,
            colonReplacementFormat,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create radarr naming config';
        if (message.includes('already exists')) {
          return fail(400, { error: message });
        }
        return fail(500, { error: message });
      }

      if (!result.success) {
        return fail(500, { error: result.error || 'Failed to create radarr naming config' });
      }
    } else if (arrType === 'sonarr') {
      const rename = formData.get('rename') === 'true';
      const standardEpisodeFormat = formData.get('standardEpisodeFormat') as string;
      const dailyEpisodeFormat = formData.get('dailyEpisodeFormat') as string;
      const animeEpisodeFormat = formData.get('animeEpisodeFormat') as string;
      const seriesFolderFormat = formData.get('seriesFolderFormat') as string;
      const seasonFolderFormat = formData.get('seasonFolderFormat') as string;
      const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
      const colonReplacementFormat = formData.get(
        'colonReplacementFormat'
      ) as SonarrNamingRow['colon_replacement_format'];
      const customColonReplacementFormat = formData.get('customColonReplacementFormat') as string;
      const multiEpisodeStyle = formData.get('multiEpisodeStyle') as SonarrNamingRow['multi_episode_style'];

      const formatFields = [
        { name: 'Standard episode format', value: standardEpisodeFormat },
        { name: 'Daily episode format', value: dailyEpisodeFormat },
        { name: 'Anime episode format', value: animeEpisodeFormat },
        { name: 'Series folder format', value: seriesFolderFormat },
        { name: 'Season folder format', value: seasonFolderFormat },
      ];
      for (const field of formatFields) {
        const validation = validateNamingFormat(field.value || '', 'sonarr');
        if (!validation.valid) {
          return fail(400, { error: `${field.name}: ${validation.errors.join(', ')}` });
        }
      }

      if (!colonReplacementFormat) {
        return fail(400, { error: 'Colon replacement format is required' });
      }
      if (!multiEpisodeStyle) {
        return fail(400, { error: 'Multi-episode style is required' });
      }

      let result;
      try {
        result = await createSonarrNaming({
          databaseId: currentDatabaseId,
          cache,
          layer,
          input: {
            name: name.trim(),
            rename,
            standardEpisodeFormat: standardEpisodeFormat || '',
            dailyEpisodeFormat: dailyEpisodeFormat || '',
            animeEpisodeFormat: animeEpisodeFormat || '',
            seriesFolderFormat: seriesFolderFormat || '',
            seasonFolderFormat: seasonFolderFormat || '',
            replaceIllegalCharacters,
            colonReplacementFormat,
            customColonReplacementFormat: customColonReplacementFormat || null,
            multiEpisodeStyle,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create sonarr naming config';
        if (message.includes('already exists')) {
          return fail(400, { error: message });
        }
        return fail(500, { error: message });
      }

      if (!result.success) {
        return fail(500, { error: result.error || 'Failed to create sonarr naming config' });
      }
    } else if (arrType === 'lidarr') {
      const rename = formData.get('rename') === 'true';
      const standardTrackFormat = formData.get('standardTrackFormat') as string;
      const artistName = formData.get('artistName') as string;
      const multiDiscTrackFormat = formData.get('multiDiscTrackFormat') as string;
      const artistFolderFormat = formData.get('artistFolderFormat') as string;
      const replaceIllegalCharacters = formData.get('replaceIllegalCharacters') === 'true';
      const colonReplacementFormat = formData.get(
        'colonReplacementFormat'
      ) as LidarrNamingRow['colon_replacement_format'];
      const customColonReplacementFormat = formData.get('customColonReplacementFormat') as string;

      const requiredFields = [
        { name: 'Standard track format', value: standardTrackFormat },
        { name: 'Multi-disc track format', value: multiDiscTrackFormat },
        { name: 'Artist folder format', value: artistFolderFormat },
      ];

      for (const field of requiredFields) {
        if (!field.value?.trim()) {
          return fail(400, { error: `${field.name} is required` });
        }
      }

      const artistNameValue = (artistName as string)?.trim();
      if (!colonReplacementFormat) {
        return fail(400, { error: 'Colon replacement format is required' });
      }

      let result;
      try {
        result = await createLidarrNaming({
          databaseId: currentDatabaseId,
          cache,
          layer,
          input: {
            name: name.trim(),
            rename,
            standardTrackFormat: standardTrackFormat.trim(),
            artistName: artistNameValue || undefined,
            multiDiscTrackFormat: multiDiscTrackFormat.trim(),
            artistFolderFormat: artistFolderFormat.trim(),
            replaceIllegalCharacters,
            colonReplacementFormat,
            customColonReplacementFormat: customColonReplacementFormat || null,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create lidarr naming config';
        if (message.includes('already exists')) {
          return fail(400, { error: message });
        }
        return fail(500, { error: message });
      }

      if (!result.success) {
        return fail(500, { error: result.error || 'Failed to create lidarr naming config' });
      }
    }

    throw redirect(303, `/media-management/${databaseId}/naming`);
  },
};
