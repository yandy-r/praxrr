import type {
  ArrMediaManagementConfig,
  ArrNamingConfig,
  ArrPropersAndRepacks,
  ArrQualityDefinition,
} from '$arr/types.ts';
import { type PCDCache } from '$pcd/index.ts';
import {
  type LidarrMediaSettingsRow,
  type LidarrNamingRow,
  type QualityDefinitionsConfig,
  type RadarrMediaSettingsRow,
  type RadarrNamingRow,
  type SonarrMediaSettingsRow,
  type SonarrNamingRow,
} from '$shared/pcd/display.ts';
import { colonReplacementFromDb, multiEpisodeStyleFromDb } from '$shared/pcd/mediaManagement.ts';
import {
  type StartupPullArrType,
  type StartupPullEntityDescriptor,
  type StartupPullMatchRequest,
  type StartupPullMatchResult,
  type StartupPullMatchReason,
  type StartupPullSection,
} from './types.ts';
import { createStartupMetadataFingerprint } from './fingerprints.ts';
import { shouldSkipStartupDefault } from './defaultFilters.ts';
import { matchStartupEntity, makeStartupMatchNoMatchResult } from './matching.ts';
import * as namingQueries from '$pcd/entities/mediaManagement/naming/read.ts';
import * as mediaSettingsQueries from '$pcd/entities/mediaManagement/media-settings/read.ts';
import {
  getLidarrByName as getLidarrQualityDefinitionsByName,
  getQualityApiMappings,
  getRadarrByName as getRadarrQualityDefinitionsByName,
  getSonarrByName as getSonarrQualityDefinitionsByName,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';
import * as qualityDefinitionsQueries from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

type MediaManagementSection = Extract<StartupPullSection, 'naming' | 'mediaSettings' | 'qualityDefinitions'>;

type LocalPropersRepacks = LidarrMediaSettingsRow['propers_repacks'];

function resolveNamingByName(
  cache: PCDCache,
  arrType: StartupPullArrType,
  name: string
): Promise<RadarrNamingRow | SonarrNamingRow | LidarrNamingRow | null> {
  if (arrType === 'radarr') {
    return namingQueries.getRadarrByName(cache, name);
  }

  if (arrType === 'sonarr') {
    return namingQueries.getSonarrByName(cache, name);
  }

  return namingQueries.getLidarrByName(cache, name);
}

function resolveMediaSettingsByName(
  cache: PCDCache,
  arrType: StartupPullArrType,
  name: string
): Promise<RadarrMediaSettingsRow | SonarrMediaSettingsRow | LidarrMediaSettingsRow | null> {
  if (arrType === 'radarr') {
    return mediaSettingsQueries.getRadarrByName(cache, name);
  }

  if (arrType === 'sonarr') {
    return mediaSettingsQueries.getSonarrByName(cache, name);
  }

  return mediaSettingsQueries.getLidarrByName(cache, name);
}
// Arr and PCD naming enums diverge for this field; maintain two directional mapping tables to avoid silent mismatches.
const PROPER_REPACKS_TO_ARR: Record<LocalPropersRepacks, ArrPropersAndRepacks> = {
  doNotPrefer: 'doNotPrefer',
  preferAndUpgrade: 'preferAndUpgrade',
  doNotUpgradeAutomatically: 'doNotUpgrade',
};

const PROPER_REPACKS_FROM_ARR: Record<ArrPropersAndRepacks, LocalPropersRepacks> = {
  doNotPrefer: 'doNotPrefer',
  preferAndUpgrade: 'preferAndUpgrade',
  doNotUpgrade: 'doNotUpgradeAutomatically',
};

interface QualityDefinitionFingerprintEntry {
  readonly qualityName: string;
  readonly minSize: number;
  readonly maxSize: number | null;
  readonly preferredSize: number | null;
}

type StartupPullEntityDescriptorOrNull = StartupPullEntityDescriptor | null;

function isStartupPullEntityDescriptor(
  candidate: StartupPullEntityDescriptorOrNull
): candidate is StartupPullEntityDescriptor {
  return candidate !== null;
}

function normalizeUnboundedQualitySize(size: number): number | null {
  return size === 0 ? null : size;
}

function buildMediaSettingsFingerprintFromLocal(mediaSettings: {
  readonly propers_repacks: LocalPropersRepacks;
  readonly enable_media_info: boolean;
}): Record<string, unknown> {
  return {
    propers_repacks: mediaSettings.propers_repacks,
    enable_media_info: mediaSettings.enable_media_info,
  } as const;
}

function buildMediaSettingsFingerprintFromArr(config: ArrMediaManagementConfig): Record<string, unknown> {
  return {
    propers_repacks: PROPER_REPACKS_FROM_ARR[config.downloadPropersAndRepacks],
    enable_media_info: config.enableMediaInfo,
  } as const;
}
// NAMING_TOKEN_REGEX captures placeholders while preserving surrounding punctuation and spacing so only token identifiers are normalized.
const NAMING_TOKEN_REGEX = /\{(?<prefix>[-\[( ._]*)(?<token>[A-Za-z][A-Za-z0-9 :+-]*)(?<suffix>[-\]) ._]*)\}/g;

function normalizeTokenIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeNamingTemplate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.length === 0) {
    return null;
  }

  return value.replace(
    NAMING_TOKEN_REGEX,
    (_match, prefix: string, token: string, suffix: string) => `{${prefix}${normalizeTokenIdentifier(token)}${suffix}}`
  );
}

function normalizeRequiredNamingTemplate(value: string | null | undefined): string {
  return normalizeNamingTemplate(value) ?? '';
}

function buildNamingFingerprintFromLocal(
  arrType: StartupPullArrType,
  naming: RadarrNamingRow | SonarrNamingRow | LidarrNamingRow
): Record<string, unknown> {
  if (arrType === 'radarr') {
    const radarrNaming = naming as RadarrNamingRow;
    return {
      renameMovies: radarrNaming.rename,
      replaceIllegalCharacters: radarrNaming.replace_illegal_characters,
      colonReplacementFormat: radarrNaming.colon_replacement_format,
      standardMovieFormat: normalizeRequiredNamingTemplate(radarrNaming.movie_format),
      movieFolderFormat: normalizeRequiredNamingTemplate(radarrNaming.movie_folder_format),
    } as const;
  }

  if (arrType === 'sonarr') {
    const sonarrNaming = naming as SonarrNamingRow;
    return {
      renameEpisodes: sonarrNaming.rename,
      replaceIllegalCharacters: sonarrNaming.replace_illegal_characters,
      colonReplacementFormat: sonarrNaming.colon_replacement_format,
      customColonReplacementFormat: normalizeNamingTemplate(sonarrNaming.custom_colon_replacement_format),
      multiEpisodeStyle: sonarrNaming.multi_episode_style,
      standardEpisodeFormat: normalizeRequiredNamingTemplate(sonarrNaming.standard_episode_format),
      dailyEpisodeFormat: normalizeRequiredNamingTemplate(sonarrNaming.daily_episode_format),
      animeEpisodeFormat: normalizeRequiredNamingTemplate(sonarrNaming.anime_episode_format),
      seriesFolderFormat: normalizeRequiredNamingTemplate(sonarrNaming.series_folder_format),
      seasonFolderFormat: normalizeRequiredNamingTemplate(sonarrNaming.season_folder_format),
    } as const;
  }

  const lidarrNaming = naming as LidarrNamingRow;
  return {
    renameTracks: lidarrNaming.rename,
    standardTrackFormat: normalizeRequiredNamingTemplate(lidarrNaming.standard_track_format),
    multiDiscTrackFormat: normalizeRequiredNamingTemplate(lidarrNaming.multi_disc_track_format),
    artistFolderFormat: normalizeRequiredNamingTemplate(lidarrNaming.artist_folder_format),
    replaceIllegalCharacters: lidarrNaming.replace_illegal_characters,
    colonReplacementFormat: lidarrNaming.colon_replacement_format,
  } as const;
}

function buildNamingFingerprintFromArr(arrType: StartupPullArrType, config: ArrNamingConfig): Record<string, unknown> {
  if (arrType === 'radarr') {
    const radarrConfig = config as {
      renameMovies: boolean;
      replaceIllegalCharacters: boolean;
      colonReplacementFormat: string | null;
      standardMovieFormat: string | null;
      movieFolderFormat: string | null;
    };
    return {
      renameMovies: radarrConfig.renameMovies,
      replaceIllegalCharacters: radarrConfig.replaceIllegalCharacters,
      colonReplacementFormat: radarrConfig.colonReplacementFormat,
      standardMovieFormat: normalizeRequiredNamingTemplate(radarrConfig.standardMovieFormat),
      movieFolderFormat: normalizeRequiredNamingTemplate(radarrConfig.movieFolderFormat),
    } as const;
  }

  if (arrType === 'sonarr') {
    const sonarrConfig = config as {
      renameEpisodes: boolean;
      replaceIllegalCharacters: boolean;
      colonReplacementFormat: number;
      customColonReplacementFormat: string | null;
      multiEpisodeStyle: number;
      standardEpisodeFormat: string | null;
      dailyEpisodeFormat: string | null;
      animeEpisodeFormat: string | null;
      seriesFolderFormat: string | null;
      seasonFolderFormat: string | null;
    };
    return {
      renameEpisodes: sonarrConfig.renameEpisodes,
      replaceIllegalCharacters: sonarrConfig.replaceIllegalCharacters,
      colonReplacementFormat: colonReplacementFromDb(sonarrConfig.colonReplacementFormat),
      customColonReplacementFormat: normalizeNamingTemplate(sonarrConfig.customColonReplacementFormat),
      multiEpisodeStyle: multiEpisodeStyleFromDb(sonarrConfig.multiEpisodeStyle),
      standardEpisodeFormat: normalizeRequiredNamingTemplate(sonarrConfig.standardEpisodeFormat),
      dailyEpisodeFormat: normalizeRequiredNamingTemplate(sonarrConfig.dailyEpisodeFormat),
      animeEpisodeFormat: normalizeRequiredNamingTemplate(sonarrConfig.animeEpisodeFormat),
      seriesFolderFormat: normalizeRequiredNamingTemplate(sonarrConfig.seriesFolderFormat),
      seasonFolderFormat: normalizeRequiredNamingTemplate(sonarrConfig.seasonFolderFormat),
    } as const;
  }

  const lidarrConfig = config as {
    renameTracks: boolean;
    standardTrackFormat: string | null;
    multiDiscTrackFormat: string | null;
    artistFolderFormat: string | null;
    replaceIllegalCharacters: boolean;
    colonReplacementFormat: number;
  };
  return {
    renameTracks: lidarrConfig.renameTracks,
    standardTrackFormat: normalizeRequiredNamingTemplate(lidarrConfig.standardTrackFormat),
    multiDiscTrackFormat: normalizeRequiredNamingTemplate(lidarrConfig.multiDiscTrackFormat),
    artistFolderFormat: normalizeRequiredNamingTemplate(lidarrConfig.artistFolderFormat),
    replaceIllegalCharacters: lidarrConfig.replaceIllegalCharacters,
    colonReplacementFormat: colonReplacementFromDb(lidarrConfig.colonReplacementFormat),
  } as const;
}

function buildQualityDefinitionsFingerprintFromLocal(
  config: QualityDefinitionsConfig,
  qualityApiMappings: ReadonlyMap<string, string>
): string | null {
  const normalizedEntries: QualityDefinitionFingerprintEntry[] = [];
  for (const entry of config.entries) {
    const apiName = qualityApiMappings.get(entry.quality_name.toLowerCase());
    if (!apiName) {
      continue;
    }

    normalizedEntries.push({
      qualityName: apiName,
      minSize: entry.min_size,
      maxSize: normalizeUnboundedQualitySize(entry.max_size),
      preferredSize: normalizeUnboundedQualitySize(entry.preferred_size),
    });
  }

  normalizedEntries.sort((left, right) => left.qualityName.localeCompare(right.qualityName));
  if (normalizedEntries.length === 0) {
    return null;
  }

  return createStartupMetadataFingerprint(
    {
      entries: normalizedEntries,
    },
    {
      sortArrayValues: true,
    }
  );
}

function buildQualityDefinitionsFingerprintFromArr(definitions: readonly ArrQualityDefinition[]): string | null {
  const normalizedEntries: QualityDefinitionFingerprintEntry[] = [];
  for (const definition of definitions) {
    const qualityName = definition.quality?.name;
    if (typeof qualityName !== 'string' || qualityName.length === 0) {
      continue;
    }

    normalizedEntries.push({
      qualityName,
      minSize: definition.minSize ?? 0,
      maxSize: definition.maxSize,
      preferredSize: definition.preferredSize,
    });
  }

  normalizedEntries.sort((left, right) => left.qualityName.localeCompare(right.qualityName));
  if (normalizedEntries.length === 0) {
    return null;
  }

  return createStartupMetadataFingerprint(
    {
      entries: normalizedEntries,
    },
    {
      sortArrayValues: true,
    }
  );
}

export function buildStartupNamingFingerprintFromLocal(
  section: MediaManagementSection,
  arrType: StartupPullArrType,
  naming: RadarrNamingRow | SonarrNamingRow | LidarrNamingRow
): string | null {
  if (section !== 'naming') {
    return null;
  }

  return createStartupMetadataFingerprint(buildNamingFingerprintFromLocal(arrType, naming));
}

export function buildStartupMediaSettingsFingerprintFromLocal(
  section: MediaManagementSection,
  mediaSettings: RadarrMediaSettingsRow | SonarrMediaSettingsRow | LidarrMediaSettingsRow
): string | null {
  if (section !== 'mediaSettings') {
    return null;
  }

  return createStartupMetadataFingerprint(buildMediaSettingsFingerprintFromLocal(mediaSettings));
}

export function buildStartupNamingFingerprintFromArr(
  section: MediaManagementSection,
  arrType: StartupPullArrType,
  config: ArrNamingConfig
): string | null {
  if (section !== 'naming') {
    return null;
  }

  return createStartupMetadataFingerprint(buildNamingFingerprintFromArr(arrType, config));
}

export function buildStartupMediaSettingsFingerprintFromArr(
  section: MediaManagementSection,
  config: ArrMediaManagementConfig
): string | null {
  if (section !== 'mediaSettings') {
    return null;
  }

  return createStartupMetadataFingerprint(buildMediaSettingsFingerprintFromArr(config));
}

export function buildStartupQualityDefinitionsFingerprintFromLocal(
  section: MediaManagementSection,
  config: QualityDefinitionsConfig,
  qualityApiMappings: ReadonlyMap<string, string>
): string | null {
  if (section !== 'qualityDefinitions') {
    return null;
  }

  return buildQualityDefinitionsFingerprintFromLocal(config, qualityApiMappings);
}

export function buildStartupQualityDefinitionsFingerprintFromArr(
  section: MediaManagementSection,
  config: readonly ArrQualityDefinition[]
): string | null {
  if (section !== 'qualityDefinitions') {
    return null;
  }

  return buildQualityDefinitionsFingerprintFromArr(config);
}

function resolveQualityDefinitionsByName(
  cache: PCDCache,
  arrType: StartupPullArrType,
  name: string
): Promise<QualityDefinitionsConfig | null> {
  if (arrType === 'radarr') {
    return getRadarrQualityDefinitionsByName(cache, name);
  }

  if (arrType === 'sonarr') {
    return getSonarrQualityDefinitionsByName(cache, name);
  }

  return getLidarrQualityDefinitionsByName(cache, name);
}

export async function collectStartupNamingCandidates(
  cache: PCDCache,
  databaseId: number,
  arrType: StartupPullArrType
): Promise<readonly StartupPullEntityDescriptor[]> {
  const rows = await namingQueries.list(cache);
  const candidates = await Promise.all(
    rows
      .filter((row) => row.arr_type === arrType)
      .map(async (row) => {
        const localConfig = await resolveNamingByName(cache, arrType, row.name);

        return {
          id: row.name,
          name: row.name,
          section: 'naming',
          arrType,
          databaseId,
          fingerprint: localConfig ? buildStartupNamingFingerprintFromLocal('naming', arrType, localConfig) : null,
        } satisfies StartupPullEntityDescriptor;
      })
  );

  return candidates;
}

export async function collectStartupMediaSettingsCandidates(
  cache: PCDCache,
  databaseId: number,
  arrType: StartupPullArrType
): Promise<readonly StartupPullEntityDescriptor[]> {
  const rows = await mediaSettingsQueries.list(cache);
  const candidates: StartupPullEntityDescriptorOrNull[] = await Promise.all(
    rows
      .filter((row) => row.arr_type === arrType)
      .map(async (row) => {
        const localConfig = await resolveMediaSettingsByName(cache, arrType, row.name);
        if (!localConfig) {
          return null;
        }

        return {
          id: row.name,
          name: row.name,
          section: 'mediaSettings',
          arrType,
          databaseId,
          fingerprint: buildStartupMediaSettingsFingerprintFromLocal('mediaSettings', localConfig),
        } satisfies StartupPullEntityDescriptor;
      })
  );

  return candidates.filter(isStartupPullEntityDescriptor);
}

export async function collectStartupQualityDefinitionsCandidates(
  cache: PCDCache,
  databaseId: number,
  arrType: StartupPullArrType
): Promise<readonly StartupPullEntityDescriptor[]> {
  const [rows, qualityApiMappings] = await Promise.all([
    qualityDefinitionsQueries.list(cache),
    getQualityApiMappings(cache, arrType).then((lookups) => lookups.qualityToApiName),
  ]);

  const filtered = rows.filter((row) => row.arr_type === arrType);
  const candidates: StartupPullEntityDescriptorOrNull[] = await Promise.all(
    filtered.map(async (row) => {
      const fullConfig = await resolveQualityDefinitionsByName(cache, arrType, row.name);
      if (!fullConfig) {
        return null;
      }

      const fingerprint = buildStartupQualityDefinitionsFingerprintFromLocal(
        'qualityDefinitions',
        fullConfig,
        qualityApiMappings
      );
      if (!fingerprint) {
        return null;
      }

      return {
        id: fullConfig.name,
        name: fullConfig.name,
        section: 'qualityDefinitions',
        arrType,
        databaseId,
        fingerprint,
      } satisfies StartupPullEntityDescriptor;
    })
  );

  return candidates.filter(isStartupPullEntityDescriptor);
}

export async function collectStartupMediaManagementCandidates(
  cache: PCDCache,
  databaseId: number,
  arrType: StartupPullArrType
): Promise<{
  naming: readonly StartupPullEntityDescriptor[];
  mediaSettings: readonly StartupPullEntityDescriptor[];
  qualityDefinitions: readonly StartupPullEntityDescriptor[];
}> {
  const [naming, mediaSettings, qualityDefinitions] = await Promise.all([
    collectStartupNamingCandidates(cache, databaseId, arrType),
    collectStartupMediaSettingsCandidates(cache, databaseId, arrType),
    collectStartupQualityDefinitionsCandidates(cache, databaseId, arrType),
  ]);

  return {
    naming,
    mediaSettings,
    qualityDefinitions,
  };
}

export function buildMatchRequestFromRemoteSnapshot(
  instanceId: number,
  databaseId: number,
  section: MediaManagementSection,
  arrType: StartupPullArrType,
  remote: Omit<StartupPullEntityDescriptor, 'databaseId'>,
  candidates: readonly StartupPullEntityDescriptor[]
): StartupPullMatchRequest {
  return {
    instanceId,
    databaseId,
    section,
    arrType,
    remote: {
      ...remote,
      databaseId,
    },
    candidates,
  };
}

export function buildRemoteNamingSnapshot(
  arrType: StartupPullArrType,
  config: ArrNamingConfig,
  fallbackId = 'naming'
): Omit<StartupPullEntityDescriptor, 'databaseId'> {
  return {
    id: config.id,
    name: fallbackId,
    section: 'naming',
    arrType,
    fingerprint: buildStartupNamingFingerprintFromArr('naming', arrType, config),
  };
}

export function buildRemoteMediaSettingsSnapshot(
  config: ArrMediaManagementConfig,
  arrType: StartupPullArrType
): Omit<StartupPullEntityDescriptor, 'databaseId'> {
  return {
    id: config.id,
    name: 'mediaManagement',
    section: 'mediaSettings',
    arrType,
    fingerprint: buildStartupMediaSettingsFingerprintFromArr('mediaSettings', config),
  };
}

export function buildRemoteQualityDefinitionsSnapshot(
  definitions: readonly ArrQualityDefinition[],
  arrType: StartupPullArrType
): Omit<StartupPullEntityDescriptor, 'databaseId'> {
  return {
    id: 'qualityDefinitions',
    name: 'qualityDefinitions',
    section: 'qualityDefinitions',
    arrType,
    fingerprint: buildStartupQualityDefinitionsFingerprintFromArr('qualityDefinitions', definitions),
  };
}

export function classifyMediaManagementMatch(request: StartupPullMatchRequest): StartupPullMatchResult {
  const skipDefault = shouldSkipStartupDefault(request.arrType, request.section, request.remote);
  if (skipDefault.skip) {
    return makeStartupMatchNoMatchResult(request, 'default_skip' satisfies StartupPullMatchReason, {
      hasFingerprintAttempt: request.remote.fingerprint !== null,
    });
  }

  const result = matchStartupEntity(request, {
    normalizeName: (name) => name,
  });

  if (result.status !== 'matched') {
    return result;
  }

  const matchedCandidate = request.candidates.find((candidate) => candidate.id === result.matchedEntityId);
  if (!matchedCandidate) {
    return result;
  }

  if (matchedCandidate.databaseId === request.databaseId) {
    return result;
  }

  return {
    ...result,
    databaseId: matchedCandidate.databaseId,
    matchedEntityId: matchedCandidate.id,
    matchedEntityName: matchedCandidate.name,
  };
}
