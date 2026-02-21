import { assertEquals } from '@std/assert';
import type { ArrDelayProfile, SonarrNamingConfig } from '$arr/types.ts';
import type { DelayProfilesRow, SonarrNamingRow } from '$shared/pcd/display.ts';
import {
	buildDelayProfileFingerprintFromArr,
	buildDelayProfileFingerprintFromLocal,
} from '$lib/server/pull/startup/profileMatching.ts';
import {
	buildStartupNamingFingerprintFromArr,
	buildStartupNamingFingerprintFromLocal,
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
