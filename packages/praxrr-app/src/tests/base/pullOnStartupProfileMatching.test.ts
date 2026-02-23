import { assertEquals } from '@std/assert';
import type {
  ArrDelayProfile,
  ArrMediaManagementConfig,
  ArrQualityDefinition,
  LidarrNamingConfig,
  RadarrNamingConfig,
  SonarrNamingConfig,
} from '$arr/types.ts';
import type {
  DelayProfilesRow,
  LidarrNamingRow,
  RadarrNamingRow,
  RadarrMediaSettingsRow,
  SonarrNamingRow,
  QualityDefinitionsConfig,
} from '$shared/pcd/display.ts';
import {
  buildDelayProfileFingerprintFromArr,
  buildDelayProfileFingerprintFromLocal,
} from '$lib/server/pull/startup/profileMatching.ts';
import {
  buildStartupNamingFingerprintFromArr,
  buildStartupNamingFingerprintFromLocal,
  buildStartupMediaSettingsFingerprintFromArr,
  buildStartupMediaSettingsFingerprintFromLocal,
  buildStartupQualityDefinitionsFingerprintFromLocal,
  buildStartupQualityDefinitionsFingerprintFromArr,
} from '$lib/server/pull/startup/mediaManagement.ts';

Deno.test('delay fingerprint: local prefer_usenet matches remote usenet-preferred default payload', () => {
  const local: DelayProfilesRow = {
    id: 10,
    name: 'Default',
    preferred_protocol: 'prefer_usenet',
    usenet_delay: 0,
    torrent_delay: 0,
    bypass_if_highest_quality: true,
    bypass_if_above_custom_format_score: false,
    minimum_custom_format_score: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: ArrDelayProfile = {
    id: 1,
    enableUsenet: true,
    enableTorrent: true,
    preferredProtocol: 'usenet',
    usenetDelay: 0,
    torrentDelay: 0,
    bypassIfHighestQuality: true,
    bypassIfAboveCustomFormatScore: false,
    minimumCustomFormatScore: 0,
    order: 1,
    tags: [],
  };

  assertEquals(buildDelayProfileFingerprintFromLocal(local), buildDelayProfileFingerprintFromArr(remote));
});

Deno.test('delay fingerprint: local only_torrent matches remote torrent-only default payload', () => {
  const local: DelayProfilesRow = {
    id: 11,
    name: 'Torrent Only',
    preferred_protocol: 'only_torrent',
    usenet_delay: 0,
    torrent_delay: 15,
    bypass_if_highest_quality: false,
    bypass_if_above_custom_format_score: true,
    minimum_custom_format_score: 10,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: ArrDelayProfile = {
    id: 1,
    enableUsenet: false,
    enableTorrent: true,
    preferredProtocol: 'torrent',
    usenetDelay: 0,
    torrentDelay: 15,
    bypassIfHighestQuality: false,
    bypassIfAboveCustomFormatScore: true,
    minimumCustomFormatScore: 10,
    order: 1,
    tags: [],
  };

  assertEquals(buildDelayProfileFingerprintFromLocal(local), buildDelayProfileFingerprintFromArr(remote));
});

Deno.test('naming fingerprint: sonarr token casing and null/empty optional fields normalize equivalently', () => {
  const local: SonarrNamingRow = {
    name: 'Sonarr Default',
    rename: true,
    standard_episode_format: '{Series Title} - {Mediainfo AudioCodec} {Mediainfo AudioChannels}',
    daily_episode_format: '{Series Title} - {Air-Date}',
    anime_episode_format: '{Series Title} - {absolute:00}',
    series_folder_format: '{Series Title}',
    season_folder_format: 'Season {season:00}',
    replace_illegal_characters: true,
    colon_replacement_format: 'smart',
    custom_colon_replacement_format: null,
    multi_episode_style: 'extend',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: SonarrNamingConfig = {
    id: 1,
    renameEpisodes: true,
    replaceIllegalCharacters: true,
    colonReplacementFormat: 4,
    customColonReplacementFormat: '',
    multiEpisodeStyle: 0,
    standardEpisodeFormat: '{Series Title} - {MediaInfo AudioCodec} {MediaInfo AudioChannels}',
    dailyEpisodeFormat: '{Series Title} - {Air-Date}',
    animeEpisodeFormat: '{Series Title} - {absolute:00}',
    seriesFolderFormat: '{Series Title}',
    seasonFolderFormat: 'Season {season:00}',
    specialsFolderFormat: 'Specials',
  };

  const localFingerprint = buildStartupNamingFingerprintFromLocal('naming', 'sonarr', local);
  const remoteFingerprint = buildStartupNamingFingerprintFromArr('naming', 'sonarr', remote);

  assertEquals(localFingerprint, remoteFingerprint);
});

Deno.test('naming fingerprint: radarr token casing and punctuation normalize equivalently', () => {
  const local: RadarrNamingRow = {
    name: 'Radarr Default',
    rename: true,
    movie_format: '{Movie Title} - {Mediainfo AudioCodec} {air-date}',
    movie_folder_format: '{Movie Title} ({Release Year})',
    replace_illegal_characters: true,
    colon_replacement_format: 'smart',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: RadarrNamingConfig = {
    id: 1,
    renameMovies: true,
    replaceIllegalCharacters: true,
    colonReplacementFormat: 'smart',
    standardMovieFormat: '{movie title} - {MediaInfo AudioCodec} {air-date}',
    movieFolderFormat: '{movie title} ({release year})',
  };

  assertEquals(
    buildStartupNamingFingerprintFromLocal('naming', 'radarr', local),
    buildStartupNamingFingerprintFromArr('naming', 'radarr', remote)
  );
});

Deno.test('naming fingerprint: lidarr token casing and whitespace normalize equivalently', () => {
  const local: LidarrNamingRow = {
    name: 'Lidarr Default',
    rename: true,
    standard_track_format: '{Album Title} {MediaInfo  Bitrate}',
    artist_name: '{artist}',
    multi_disc_track_format: '{Track Title} {mediainfo audiochannels}',
    artist_folder_format: '{Artist Name}',
    replace_illegal_characters: true,
    colon_replacement_format: 'smart',
    custom_colon_replacement_format: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: LidarrNamingConfig = {
    id: 1,
    renameTracks: true,
    standardTrackFormat: '{album title} {MediaInfo Bitrate}',
    multiDiscTrackFormat: '{Track Title} {mediaInfo audioChannels}',
    artistFolderFormat: '{artist name}',
    replaceIllegalCharacters: true,
    colonReplacementFormat: 4,
  };

  assertEquals(
    buildStartupNamingFingerprintFromLocal('naming', 'lidarr', local),
    buildStartupNamingFingerprintFromArr('naming', 'lidarr', remote)
  );
});

Deno.test('naming fingerprint ignores mixed-case and punctuation inside token identifiers', () => {
  const local: RadarrNamingRow = {
    name: 'Rough Mix',
    rename: true,
    movie_format: '{Movie Title} - {mediainfo  bItRaTe} {Air-Date}',
    movie_folder_format: '{Movie Title} ({Release   Year})',
    replace_illegal_characters: true,
    colon_replacement_format: 'spaceDash',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: RadarrNamingConfig = {
    id: 2,
    renameMovies: true,
    replaceIllegalCharacters: true,
    colonReplacementFormat: 'spaceDash',
    standardMovieFormat: '{movie title} - {MediaInfo bitrate} {Air-Date}',
    movieFolderFormat: '{movie title} ({release year})',
  };

  assertEquals(
    buildStartupNamingFingerprintFromLocal('naming', 'radarr', local),
    buildStartupNamingFingerprintFromArr('naming', 'radarr', remote)
  );
});

Deno.test('media management settings fingerprint equivalence', () => {
  const local: RadarrMediaSettingsRow = {
    name: 'Radarr Media',
    propers_repacks: 'doNotUpgradeAutomatically',
    enable_media_info: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const remote: ArrMediaManagementConfig = {
    id: 12,
    downloadPropersAndRepacks: 'doNotUpgrade',
    enableMediaInfo: false,
  };

  assertEquals(
    buildStartupMediaSettingsFingerprintFromLocal('mediaSettings', local),
    buildStartupMediaSettingsFingerprintFromArr('mediaSettings', remote)
  );
});

Deno.test('quality definitions fingerprint equivalence with mapping and order normalization', () => {
  const local: QualityDefinitionsConfig = {
    name: 'Definition Group',
    entries: [
      {
        quality_name: 'weB DL',
        min_size: 4000,
        max_size: 0,
        preferred_size: 0,
      },
      {
        quality_name: 'hdTV',
        min_size: 1200,
        max_size: 7000,
        preferred_size: 1500,
      },
    ],
  };

  const remote: ArrQualityDefinition[] = [
    {
      id: 20,
      quality: { id: 20, name: 'HDTV' },
      title: 'HDTV',
      weight: 30,
      minSize: 1200,
      maxSize: 7000,
      preferredSize: 1500,
    },
    {
      id: 10,
      quality: { id: 10, name: 'WEB DL' },
      title: 'WEB DL',
      weight: 10,
      minSize: 4000,
      maxSize: null,
      preferredSize: null,
    },
  ];

  const qualityApiMappings = new Map([
    ['web dl', 'WEB DL'],
    ['hdtv', 'HDTV'],
  ]);

  assertEquals(
    buildStartupQualityDefinitionsFingerprintFromLocal('qualityDefinitions', local, qualityApiMappings),
    buildStartupQualityDefinitionsFingerprintFromArr('qualityDefinitions', remote)
  );
});
