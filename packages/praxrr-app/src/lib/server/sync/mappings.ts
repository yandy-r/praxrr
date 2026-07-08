/**
 * Arr API mappings
 * Constants for transforming PCD data to arr API format
 * Based on Radarr/Sonarr/Lidarr API specifications
 */

import type { ArrType } from '$shared/pcd/types.ts';
import type { ArrSyncSurface } from '$shared/arr/capabilities.ts';
import { type ArrFeatureAvailability, resolveArrCapability } from '$shared/arr/compatibility.ts';
import type { SectionType } from './types.ts';

// Sync runtime supports all concrete Arr instance types.
export type SyncArrType = Exclude<ArrType, 'all'>;

const BASE_SYNC_SECTION_ORDER: Exclude<SectionType, 'metadataProfiles'>[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
];

export const SYNC_SECTION_ORDER: SectionType[] = [...BASE_SYNC_SECTION_ORDER, 'metadataProfiles'];

const SUPPORTED_SYNC_SECTIONS: Record<SyncArrType, readonly SectionType[]> = {
  radarr: BASE_SYNC_SECTION_ORDER,
  sonarr: BASE_SYNC_SECTION_ORDER,
  lidarr: SYNC_SECTION_ORDER,
};

const BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS = ['mediaSettings', 'naming', 'qualityDefinitions'] as const;

export type MediaManagementSubsection = (typeof BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS)[number];

const SUPPORTED_MEDIA_MANAGEMENT_SUBSECTIONS: Record<SyncArrType, readonly MediaManagementSubsection[]> = {
  radarr: BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS,
  sonarr: BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS,
  lidarr: BASE_SYNC_MEDIA_MANAGEMENT_SUBSECTIONS,
};

const UNSUPPORTED_SYNC_SECTION_REASONS: Partial<Record<SyncArrType, Partial<Record<SectionType, string>>>> = {};

const UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS: Partial<
  Record<SyncArrType, Partial<Record<MediaManagementSubsection, string>>>
> = {};

export function isSyncSectionSupported(arrType: SyncArrType, section: SectionType): boolean {
  return SUPPORTED_SYNC_SECTIONS[arrType].includes(section);
}

export function isMediaManagementSubsectionSupported(
  arrType: SyncArrType,
  subsection: MediaManagementSubsection
): boolean {
  return SUPPORTED_MEDIA_MANAGEMENT_SUBSECTIONS[arrType].includes(subsection);
}

export function getUnsupportedSyncSectionReason(arrType: SyncArrType, section: SectionType): string | null {
  if (isSyncSectionSupported(arrType, section)) {
    return null;
  }

  return UNSUPPORTED_SYNC_SECTION_REASONS[arrType]?.[section] ?? `Section ${section} is not supported for ${arrType}`;
}

/**
 * Bridge from a sync section to the capability sync surface that gates it. A
 * total Record forces a compile-time error if a new SectionType is added
 * without wiring it to a surface (mirrors PARITY_ENTITY_TO_SYNC_SURFACE).
 */
const SECTION_TO_SYNC_SURFACE: Record<SectionType, ArrSyncSurface> = {
  qualityProfiles: 'quality_profiles',
  delayProfiles: 'delay_profiles',
  mediaManagement: 'media_management',
  metadataProfiles: 'metadata_profiles',
};

/**
 * Resolve a sync section's availability for a detected application version,
 * layering the version dimension on top of the static section-support check.
 * The base capability is a hard floor — an app that never supports the section
 * resolves to `unavailable` regardless of version.
 */
export function resolveSyncSectionAvailability(
  arrType: SyncArrType,
  section: SectionType,
  detectedVersion: string | null | undefined
): ArrFeatureAvailability {
  return resolveArrCapability(arrType, SECTION_TO_SYNC_SURFACE[section], detectedVersion);
}

export function getUnsupportedMediaManagementSubsectionReason(
  arrType: SyncArrType,
  subsection: MediaManagementSubsection
): string | null {
  if (isMediaManagementSubsectionSupported(arrType, subsection)) {
    return null;
  }

  return (
    UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS[arrType]?.[subsection] ??
    `Media management subsection ${subsection} is not supported for ${arrType}`
  );
}

type MappedSyncArrType = SyncArrType;

function requireMappedSyncArrType(arrType: SyncArrType): MappedSyncArrType {
  return arrType;
}

// =============================================================================
// Indexer Flags
// =============================================================================

export const INDEXER_FLAGS = {
  radarr: {
    freeleech: 1,
    halfleech: 2,
    double_upload: 4,
    internal: 32,
    scene: 128,
    freeleech_75: 256,
    freeleech_25: 512,
    nuked: 2048,
    ptp_golden: 8,
    ptp_approved: 16,
  },
  sonarr: {
    freeleech: 1,
    halfleech: 2,
    double_upload: 4,
    internal: 8,
    scene: 16,
    freeleech_75: 32,
    freeleech_25: 64,
    nuked: 128,
  },
  lidarr: {
    freeleech: 1,
    halfleech: 2,
    double_upload: 4,
    internal: 8,
    scene: 16,
    freeleech_75: 32,
    freeleech_25: 64,
  },
} as const;

// =============================================================================
// Sources
// =============================================================================

export const SOURCES = {
  radarr: {
    cam: 1,
    telesync: 2,
    telecine: 3,
    workprint: 4,
    dvd: 5,
    tv: 6,
    web_dl: 7,
    webrip: 8,
    bluray: 9,
  },
  sonarr: {
    television: 1,
    television_raw: 2,
    web_dl: 3,
    webrip: 4,
    dvd: 5,
    bluray: 6,
    bluray_raw: 7,
  },
  lidarr: {
    television: 1,
    television_raw: 2,
    web_dl: 3,
    webrip: 4,
    dvd: 5,
    bluray: 6,
    bluray_raw: 7,
  },
} as const;

// =============================================================================
// Quality Modifiers (Radarr only)
// =============================================================================

export const QUALITY_MODIFIERS = {
  none: 0,
  regional: 1,
  screener: 2,
  rawhd: 3,
  brdisk: 4,
  remux: 5,
} as const;

// =============================================================================
// Release Types (Sonarr only)
// =============================================================================

export const RELEASE_TYPES = {
  none: 0,
  single_episode: 1,
  multi_episode: 2,
  season_pack: 3,
} as const;

// =============================================================================
// Resolutions
// =============================================================================

export const RESOLUTIONS: Record<string, number> = {
  '360p': 360,
  '480p': 480,
  '540p': 540,
  '576p': 576,
  '720p': 720,
  '1080p': 1080,
  '2160p': 2160,
};

// =============================================================================
// Quality Definitions
// =============================================================================

export interface QualityDefinition {
  id: number;
  name: string;
  source: string;
  resolution: number;
}

export const QUALITIES: Record<MappedSyncArrType, Record<string, QualityDefinition>> = {
  radarr: {
    Unknown: { id: 0, name: 'Unknown', source: 'unknown', resolution: 0 },
    SDTV: { id: 1, name: 'SDTV', source: 'tv', resolution: 480 },
    DVD: { id: 2, name: 'DVD', source: 'dvd', resolution: 480 },
    'WEBDL-1080p': { id: 3, name: 'WEBDL-1080p', source: 'webdl', resolution: 1080 },
    'HDTV-720p': { id: 4, name: 'HDTV-720p', source: 'tv', resolution: 720 },
    'WEBDL-720p': { id: 5, name: 'WEBDL-720p', source: 'webdl', resolution: 720 },
    'Bluray-720p': { id: 6, name: 'Bluray-720p', source: 'bluray', resolution: 720 },
    'Bluray-1080p': { id: 7, name: 'Bluray-1080p', source: 'bluray', resolution: 1080 },
    'WEBDL-480p': { id: 8, name: 'WEBDL-480p', source: 'webdl', resolution: 480 },
    'HDTV-1080p': { id: 9, name: 'HDTV-1080p', source: 'tv', resolution: 1080 },
    'Raw-HD': { id: 10, name: 'Raw-HD', source: 'tv', resolution: 1080 },
    'WEBRip-480p': { id: 12, name: 'WEBRip-480p', source: 'webrip', resolution: 480 },
    'WEBRip-720p': { id: 14, name: 'WEBRip-720p', source: 'webrip', resolution: 720 },
    'WEBRip-1080p': { id: 15, name: 'WEBRip-1080p', source: 'webrip', resolution: 1080 },
    'HDTV-2160p': { id: 16, name: 'HDTV-2160p', source: 'tv', resolution: 2160 },
    'WEBRip-2160p': { id: 17, name: 'WEBRip-2160p', source: 'webrip', resolution: 2160 },
    'WEBDL-2160p': { id: 18, name: 'WEBDL-2160p', source: 'webdl', resolution: 2160 },
    'Bluray-2160p': { id: 19, name: 'Bluray-2160p', source: 'bluray', resolution: 2160 },
    'Bluray-480p': { id: 20, name: 'Bluray-480p', source: 'bluray', resolution: 480 },
    'Bluray-576p': { id: 21, name: 'Bluray-576p', source: 'bluray', resolution: 576 },
    'BR-DISK': { id: 22, name: 'BR-DISK', source: 'bluray', resolution: 1080 },
    'DVD-R': { id: 23, name: 'DVD-R', source: 'dvd', resolution: 480 },
    WORKPRINT: { id: 24, name: 'WORKPRINT', source: 'workprint', resolution: 0 },
    CAM: { id: 25, name: 'CAM', source: 'cam', resolution: 0 },
    TELESYNC: { id: 26, name: 'TELESYNC', source: 'telesync', resolution: 0 },
    TELECINE: { id: 27, name: 'TELECINE', source: 'telecine', resolution: 0 },
    DVDSCR: { id: 28, name: 'DVDSCR', source: 'dvd', resolution: 480 },
    REGIONAL: { id: 29, name: 'REGIONAL', source: 'dvd', resolution: 480 },
    'Remux-1080p': { id: 30, name: 'Remux-1080p', source: 'bluray', resolution: 1080 },
    'Remux-2160p': { id: 31, name: 'Remux-2160p', source: 'bluray', resolution: 2160 },
  },
  sonarr: {
    Unknown: { id: 0, name: 'Unknown', source: 'unknown', resolution: 0 },
    SDTV: { id: 1, name: 'SDTV', source: 'television', resolution: 480 },
    DVD: { id: 2, name: 'DVD', source: 'dvd', resolution: 480 },
    'WEBDL-1080p': { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080 },
    'HDTV-720p': { id: 4, name: 'HDTV-720p', source: 'television', resolution: 720 },
    'WEBDL-720p': { id: 5, name: 'WEBDL-720p', source: 'web', resolution: 720 },
    'Bluray-720p': { id: 6, name: 'Bluray-720p', source: 'bluray', resolution: 720 },
    'Bluray-1080p': { id: 7, name: 'Bluray-1080p', source: 'bluray', resolution: 1080 },
    'WEBDL-480p': { id: 8, name: 'WEBDL-480p', source: 'web', resolution: 480 },
    'HDTV-1080p': { id: 9, name: 'HDTV-1080p', source: 'television', resolution: 1080 },
    'Raw-HD': { id: 10, name: 'Raw-HD', source: 'televisionRaw', resolution: 1080 },
    'WEBRip-480p': { id: 12, name: 'WEBRip-480p', source: 'webRip', resolution: 480 },
    'Bluray-480p': { id: 13, name: 'Bluray-480p', source: 'bluray', resolution: 480 },
    'WEBRip-720p': { id: 14, name: 'WEBRip-720p', source: 'webRip', resolution: 720 },
    'WEBRip-1080p': { id: 15, name: 'WEBRip-1080p', source: 'webRip', resolution: 1080 },
    'HDTV-2160p': { id: 16, name: 'HDTV-2160p', source: 'television', resolution: 2160 },
    'WEBRip-2160p': { id: 17, name: 'WEBRip-2160p', source: 'webRip', resolution: 2160 },
    'WEBDL-2160p': { id: 18, name: 'WEBDL-2160p', source: 'web', resolution: 2160 },
    'Bluray-2160p': { id: 19, name: 'Bluray-2160p', source: 'bluray', resolution: 2160 },
    'Bluray-1080p Remux': {
      id: 20,
      name: 'Bluray-1080p Remux',
      source: 'blurayRaw',
      resolution: 1080,
    },
    'Bluray-2160p Remux': {
      id: 21,
      name: 'Bluray-2160p Remux',
      source: 'blurayRaw',
      resolution: 2160,
    },
    'Bluray-576p': { id: 22, name: 'Bluray-576p', source: 'bluray', resolution: 576 },
  },
  lidarr: {
    Unknown: { id: 0, name: 'Unknown', source: 'audio', resolution: 0 },
    'MP3-192': { id: 1, name: 'MP3-192', source: 'audio', resolution: 0 },
    'MP3-VBR-V0': { id: 2, name: 'MP3-VBR-V0', source: 'audio', resolution: 0 },
    'MP3-256': { id: 3, name: 'MP3-256', source: 'audio', resolution: 0 },
    'MP3-320': { id: 4, name: 'MP3-320', source: 'audio', resolution: 0 },
    'MP3-160': { id: 5, name: 'MP3-160', source: 'audio', resolution: 0 },
    FLAC: { id: 6, name: 'FLAC', source: 'audio', resolution: 0 },
    ALAC: { id: 7, name: 'ALAC', source: 'audio', resolution: 0 },
    'MP3-VBR-V2': { id: 8, name: 'MP3-VBR-V2', source: 'audio', resolution: 0 },
    'AAC-192': { id: 9, name: 'AAC-192', source: 'audio', resolution: 0 },
    'AAC-256': { id: 10, name: 'AAC-256', source: 'audio', resolution: 0 },
    'AAC-320': { id: 11, name: 'AAC-320', source: 'audio', resolution: 0 },
    'AAC-VBR': { id: 12, name: 'AAC-VBR', source: 'audio', resolution: 0 },
    WAV: { id: 13, name: 'WAV', source: 'audio', resolution: 0 },
    'OGG Vorbis Q10': { id: 14, name: 'OGG Vorbis Q10', source: 'audio', resolution: 0 },
    'OGG Vorbis Q9': { id: 15, name: 'OGG Vorbis Q9', source: 'audio', resolution: 0 },
    'OGG Vorbis Q8': { id: 16, name: 'OGG Vorbis Q8', source: 'audio', resolution: 0 },
    'OGG Vorbis Q7': { id: 17, name: 'OGG Vorbis Q7', source: 'audio', resolution: 0 },
    'OGG Vorbis Q6': { id: 18, name: 'OGG Vorbis Q6', source: 'audio', resolution: 0 },
    'OGG Vorbis Q5': { id: 19, name: 'OGG Vorbis Q5', source: 'audio', resolution: 0 },
    WMA: { id: 20, name: 'WMA', source: 'audio', resolution: 0 },
    'FLAC 24bit': { id: 21, name: 'FLAC 24bit', source: 'audio', resolution: 0 },
    'MP3-128': { id: 22, name: 'MP3-128', source: 'audio', resolution: 0 },
    'MP3-96': { id: 23, name: 'MP3-96', source: 'audio', resolution: 0 },
    'MP3-80': { id: 24, name: 'MP3-80', source: 'audio', resolution: 0 },
    'MP3-64': { id: 25, name: 'MP3-64', source: 'audio', resolution: 0 },
    'MP3-56': { id: 26, name: 'MP3-56', source: 'audio', resolution: 0 },
    'MP3-48': { id: 27, name: 'MP3-48', source: 'audio', resolution: 0 },
    'MP3-40': { id: 28, name: 'MP3-40', source: 'audio', resolution: 0 },
    'MP3-32': { id: 29, name: 'MP3-32', source: 'audio', resolution: 0 },
    'MP3-24': { id: 30, name: 'MP3-24', source: 'audio', resolution: 0 },
    'MP3-16': { id: 31, name: 'MP3-16', source: 'audio', resolution: 0 },
    'MP3-8': { id: 32, name: 'MP3-8', source: 'audio', resolution: 0 },
    'MP3-112': { id: 33, name: 'MP3-112', source: 'audio', resolution: 0 },
    'MP3-224': { id: 34, name: 'MP3-224', source: 'audio', resolution: 0 },
    APE: { id: 35, name: 'APE', source: 'audio', resolution: 0 },
    WavPack: { id: 36, name: 'WavPack', source: 'audio', resolution: 0 },
    'ALAC 24bit': { id: 37, name: 'ALAC 24bit', source: 'audio', resolution: 0 },
  },
};

// =============================================================================
// Languages
// =============================================================================

export interface LanguageDefinition {
  id: number;
  name: string;
}

export const LANGUAGES: Record<MappedSyncArrType, Record<string, LanguageDefinition>> = {
  radarr: {
    any: { id: -1, name: 'Any' },
    original: { id: -2, name: 'Original' },
    unknown: { id: 0, name: 'Unknown' },
    english: { id: 1, name: 'English' },
    french: { id: 2, name: 'French' },
    spanish: { id: 3, name: 'Spanish' },
    german: { id: 4, name: 'German' },
    italian: { id: 5, name: 'Italian' },
    danish: { id: 6, name: 'Danish' },
    dutch: { id: 7, name: 'Dutch' },
    japanese: { id: 8, name: 'Japanese' },
    icelandic: { id: 9, name: 'Icelandic' },
    chinese: { id: 10, name: 'Chinese' },
    russian: { id: 11, name: 'Russian' },
    polish: { id: 12, name: 'Polish' },
    vietnamese: { id: 13, name: 'Vietnamese' },
    swedish: { id: 14, name: 'Swedish' },
    norwegian: { id: 15, name: 'Norwegian' },
    finnish: { id: 16, name: 'Finnish' },
    turkish: { id: 17, name: 'Turkish' },
    portuguese: { id: 18, name: 'Portuguese' },
    flemish: { id: 19, name: 'Flemish' },
    greek: { id: 20, name: 'Greek' },
    korean: { id: 21, name: 'Korean' },
    hungarian: { id: 22, name: 'Hungarian' },
    hebrew: { id: 23, name: 'Hebrew' },
    lithuanian: { id: 24, name: 'Lithuanian' },
    czech: { id: 25, name: 'Czech' },
    hindi: { id: 26, name: 'Hindi' },
    romanian: { id: 27, name: 'Romanian' },
    thai: { id: 28, name: 'Thai' },
    bulgarian: { id: 29, name: 'Bulgarian' },
    'portuguese (brazil)': { id: 30, name: 'Portuguese (Brazil)' },
    arabic: { id: 31, name: 'Arabic' },
    ukrainian: { id: 32, name: 'Ukrainian' },
    persian: { id: 33, name: 'Persian' },
    bengali: { id: 34, name: 'Bengali' },
    slovak: { id: 35, name: 'Slovak' },
    latvian: { id: 36, name: 'Latvian' },
    'spanish (latino)': { id: 37, name: 'Spanish (Latino)' },
    catalan: { id: 38, name: 'Catalan' },
    croatian: { id: 39, name: 'Croatian' },
    serbian: { id: 40, name: 'Serbian' },
    bosnian: { id: 41, name: 'Bosnian' },
    estonian: { id: 42, name: 'Estonian' },
    tamil: { id: 43, name: 'Tamil' },
    indonesian: { id: 44, name: 'Indonesian' },
    telugu: { id: 45, name: 'Telugu' },
    macedonian: { id: 46, name: 'Macedonian' },
    slovenian: { id: 47, name: 'Slovenian' },
    malayalam: { id: 48, name: 'Malayalam' },
    kannada: { id: 49, name: 'Kannada' },
    albanian: { id: 50, name: 'Albanian' },
    afrikaans: { id: 51, name: 'Afrikaans' },
    marathi: { id: 52, name: 'Marathi' },
    tagalog: { id: 53, name: 'Tagalog' },
    urdu: { id: 54, name: 'Urdu' },
    romansh: { id: 55, name: 'Romansh' },
    mongolian: { id: 56, name: 'Mongolian' },
    georgian: { id: 57, name: 'Georgian' },
  },
  sonarr: {
    unknown: { id: 0, name: 'Unknown' },
    english: { id: 1, name: 'English' },
    french: { id: 2, name: 'French' },
    spanish: { id: 3, name: 'Spanish' },
    german: { id: 4, name: 'German' },
    italian: { id: 5, name: 'Italian' },
    danish: { id: 6, name: 'Danish' },
    dutch: { id: 7, name: 'Dutch' },
    japanese: { id: 8, name: 'Japanese' },
    icelandic: { id: 9, name: 'Icelandic' },
    chinese: { id: 10, name: 'Chinese' },
    russian: { id: 11, name: 'Russian' },
    polish: { id: 12, name: 'Polish' },
    vietnamese: { id: 13, name: 'Vietnamese' },
    swedish: { id: 14, name: 'Swedish' },
    norwegian: { id: 15, name: 'Norwegian' },
    finnish: { id: 16, name: 'Finnish' },
    turkish: { id: 17, name: 'Turkish' },
    portuguese: { id: 18, name: 'Portuguese' },
    flemish: { id: 19, name: 'Flemish' },
    greek: { id: 20, name: 'Greek' },
    korean: { id: 21, name: 'Korean' },
    hungarian: { id: 22, name: 'Hungarian' },
    hebrew: { id: 23, name: 'Hebrew' },
    lithuanian: { id: 24, name: 'Lithuanian' },
    czech: { id: 25, name: 'Czech' },
    arabic: { id: 26, name: 'Arabic' },
    hindi: { id: 27, name: 'Hindi' },
    bulgarian: { id: 28, name: 'Bulgarian' },
    malayalam: { id: 29, name: 'Malayalam' },
    ukrainian: { id: 30, name: 'Ukrainian' },
    slovak: { id: 31, name: 'Slovak' },
    thai: { id: 32, name: 'Thai' },
    'portuguese (brazil)': { id: 33, name: 'Portuguese (Brazil)' },
    'spanish (latino)': { id: 34, name: 'Spanish (Latino)' },
    romanian: { id: 35, name: 'Romanian' },
    latvian: { id: 36, name: 'Latvian' },
    persian: { id: 37, name: 'Persian' },
    catalan: { id: 38, name: 'Catalan' },
    croatian: { id: 39, name: 'Croatian' },
    serbian: { id: 40, name: 'Serbian' },
    bosnian: { id: 41, name: 'Bosnian' },
    estonian: { id: 42, name: 'Estonian' },
    tamil: { id: 43, name: 'Tamil' },
    indonesian: { id: 44, name: 'Indonesian' },
    macedonian: { id: 45, name: 'Macedonian' },
    slovenian: { id: 46, name: 'Slovenian' },
    original: { id: -2, name: 'Original' },
  },
  lidarr: {
    unknown: { id: 0, name: 'Unknown' },
    english: { id: 1, name: 'English' },
    french: { id: 2, name: 'French' },
    spanish: { id: 3, name: 'Spanish' },
    german: { id: 4, name: 'German' },
    italian: { id: 5, name: 'Italian' },
    danish: { id: 6, name: 'Danish' },
    dutch: { id: 7, name: 'Dutch' },
    japanese: { id: 8, name: 'Japanese' },
    icelandic: { id: 9, name: 'Icelandic' },
    chinese: { id: 10, name: 'Chinese' },
    russian: { id: 11, name: 'Russian' },
    polish: { id: 12, name: 'Polish' },
    vietnamese: { id: 13, name: 'Vietnamese' },
    swedish: { id: 14, name: 'Swedish' },
    norwegian: { id: 15, name: 'Norwegian' },
    finnish: { id: 16, name: 'Finnish' },
    turkish: { id: 17, name: 'Turkish' },
    portuguese: { id: 18, name: 'Portuguese' },
    flemish: { id: 19, name: 'Flemish' },
    greek: { id: 20, name: 'Greek' },
    korean: { id: 21, name: 'Korean' },
    hungarian: { id: 22, name: 'Hungarian' },
    hebrew: { id: 23, name: 'Hebrew' },
    lithuanian: { id: 24, name: 'Lithuanian' },
    czech: { id: 25, name: 'Czech' },
    hindi: { id: 26, name: 'Hindi' },
    romanian: { id: 27, name: 'Romanian' },
    thai: { id: 28, name: 'Thai' },
    bulgarian: { id: 29, name: 'Bulgarian' },
    'portuguese (brazil)': { id: 30, name: 'Portuguese (Brazil)' },
    arabic: { id: 31, name: 'Arabic' },
    any: { id: -1, name: 'Any' },
    original: { id: -2, name: 'Original' },
  },
};

// =============================================================================
// Name Mapping Utilities
// =============================================================================

/**
 * Maps quality names between PCD and arr API formats
 * Handles Remux naming differences and alternate spellings
 */
const REMUX_MAPPINGS: Record<MappedSyncArrType, Record<string, string>> = {
  sonarr: {
    'Remux-1080p': 'Bluray-1080p Remux',
    'Remux-2160p': 'Bluray-2160p Remux',
  },
  radarr: {
    'Remux-1080p': 'Remux-1080p',
    'Remux-2160p': 'Remux-2160p',
  },
  lidarr: {},
};

const ALTERNATE_QUALITY_NAMES: Record<string, string> = {
  'BR-Disk': 'BR-DISK',
  BRDISK: 'BR-DISK',
  BR_DISK: 'BR-DISK',
  'BLURAY-DISK': 'BR-DISK',
  BLURAY_DISK: 'BR-DISK',
  BLURAYDISK: 'BR-DISK',
  Telecine: 'TELECINE',
  TeleCine: 'TELECINE',
  Telesync: 'TELESYNC',
  TeleSync: 'TELESYNC',
};

/**
 * Map a quality name to the arr API format
 */
export function mapQualityName(name: string, arrType: SyncArrType): string {
  if (!name) return name;
  const mappedArrType = requireMappedSyncArrType(arrType);

  // Check remux mappings first
  if (REMUX_MAPPINGS[mappedArrType][name]) {
    return REMUX_MAPPINGS[mappedArrType][name];
  }

  // Check alternate spellings
  const normalized = name.toUpperCase().replace(/-/g, '').replace(/_/g, '');
  for (const [alt, standard] of Object.entries(ALTERNATE_QUALITY_NAMES)) {
    if (normalized === alt.toUpperCase().replace(/-/g, '').replace(/_/g, '')) {
      return standard;
    }
  }

  return name;
}

/**
 * Normalize language name for lookup
 */
export function normalizeLanguageName(name: string): string {
  if (!name) return name;
  return name.toLowerCase().replace(/-/g, ' ').replace(/_/g, ' ');
}

// =============================================================================
// Source Name Aliases (normalize YAML source names to API keys)
// =============================================================================

const SOURCE_ALIASES: Record<MappedSyncArrType, Record<string, string>> = {
  radarr: {
    // YAML uses "television", Radarr API uses "tv"
    television: 'tv',
    hdtv: 'tv',
    // Common variations
    webdl: 'web_dl',
    'web-dl': 'web_dl',
    web: 'web_dl',
    web_rip: 'webrip',
    'web-rip': 'webrip',
  },
  sonarr: {
    // Sonarr uses "television" directly, but add common aliases
    hdtv: 'television',
    tv: 'television',
    webdl: 'web_dl',
    'web-dl': 'web_dl',
    web: 'web_dl',
    web_rip: 'webrip',
    'web-rip': 'webrip',
  },
  lidarr: {
    hdtv: 'television',
    tv: 'television',
    webdl: 'web_dl',
    'web-dl': 'web_dl',
    web: 'web_dl',
    web_rip: 'webrip',
    'web-rip': 'webrip',
  },
};

// =============================================================================
// Value Resolvers
// =============================================================================

/**
 * Get indexer flag value
 */
export function getIndexerFlag(flag: string, arrType: SyncArrType): number {
  const mappedArrType = requireMappedSyncArrType(arrType);
  const flags = INDEXER_FLAGS[mappedArrType];
  return flags[flag.toLowerCase() as keyof typeof flags] ?? 0;
}

/**
 * Normalize source name using aliases
 */
function normalizeSourceName(source: string, arrType: MappedSyncArrType): string {
  const normalized = source.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
  return SOURCE_ALIASES[arrType][normalized] ?? normalized;
}

/**
 * Get source value
 */
export function getSource(source: string, arrType: SyncArrType): number {
  const mappedArrType = requireMappedSyncArrType(arrType);
  const normalizedSource = normalizeSourceName(source, mappedArrType);
  const sources = SOURCES[mappedArrType];
  return sources[normalizedSource as keyof typeof sources] ?? 0;
}

/**
 * Get resolution value
 */
export function getResolution(resolution: string): number {
  return RESOLUTIONS[resolution.toLowerCase()] ?? 0;
}

/**
 * Get quality modifier value (Radarr only)
 */
export function getQualityModifier(modifier: string): number {
  return QUALITY_MODIFIERS[modifier.toLowerCase() as keyof typeof QUALITY_MODIFIERS] ?? 0;
}

/**
 * Get release type value (Sonarr only)
 */
export function getReleaseType(releaseType: string): number {
  return RELEASE_TYPES[releaseType.toLowerCase() as keyof typeof RELEASE_TYPES] ?? 0;
}

/**
 * Get quality definition
 */
export function getQuality(name: string, arrType: SyncArrType): QualityDefinition | undefined {
  const mappedArrType = requireMappedSyncArrType(arrType);
  const mappedName = mapQualityName(name, mappedArrType);
  return QUALITIES[mappedArrType][mappedName];
}

/**
 * Get all qualities for an arr type
 */
export function getAllQualities(arrType: SyncArrType): Record<string, QualityDefinition> {
  const mappedArrType = requireMappedSyncArrType(arrType);
  return QUALITIES[mappedArrType];
}

/**
 * Get language definition
 */
export function getLanguage(name: string, arrType: SyncArrType): LanguageDefinition {
  const mappedArrType = requireMappedSyncArrType(arrType);
  const normalized = normalizeLanguageName(name);
  const languages = LANGUAGES[mappedArrType];
  return languages[normalized] ?? languages['unknown'];
}

/**
 * Get language for profile (Sonarr/Lidarr always use Original)
 */
export function getLanguageForProfile(name: string, arrType: SyncArrType): LanguageDefinition {
  const mappedArrType = requireMappedSyncArrType(arrType);

  // Sonarr/Lidarr profiles don't use language settings
  if (mappedArrType === 'sonarr' || mappedArrType === 'lidarr') {
    return { id: -2, name: 'Original' };
  }

  if (name === 'any' || !name) {
    return LANGUAGES.radarr['any'];
  }

  return getLanguage(name, mappedArrType);
}

/**
 * Get all Radarr languages as an array (for UI dropdowns)
 * Returns languages sorted by name, with Any and Original at the top
 */
export function getRadarrLanguages(): LanguageDefinition[] {
  const languages = Object.values(LANGUAGES.radarr);
  // Sort: Any first, Original second, then alphabetically
  return languages.sort((a, b) => {
    if (a.id === -1) return -1;
    if (b.id === -1) return 1;
    if (a.id === -2) return -1;
    if (b.id === -2) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Language with arr type support information (for conditions UI)
 */
export interface LanguageWithSupport {
  name: string;
  radarr: boolean;
  sonarr: boolean;
  /**
   * Lidarr quality-profile parity is supported, but Lidarr custom-format language
   * specifications are still unsupported and are deterministically skipped.
   */
  lidarr: boolean;
}

/**
 * Get all languages with their arr type support (for conditions page)
 * Returns sorted array with Original first, then alphabetically
 */
export function getLanguagesWithSupport(): LanguageWithSupport[] {
  const radarrLangs = new Set(Object.values(LANGUAGES.radarr).map((l) => l.name));
  const sonarrLangs = new Set(Object.values(LANGUAGES.sonarr).map((l) => l.name));

  // Combine all language names
  const allNames = new Set([...radarrLangs, ...sonarrLangs]);

  // Build result with support flags
  const result: LanguageWithSupport[] = [];
  for (const name of allNames) {
    result.push({
      name,
      radarr: radarrLangs.has(name),
      sonarr: sonarrLangs.has(name),
      lidarr: false,
    });
  }

  // Sort: Any first, Original second, then alphabetically
  return result.sort((a, b) => {
    if (a.name === 'Any') return -1;
    if (b.name === 'Any') return 1;
    if (a.name === 'Original') return -1;
    if (b.name === 'Original') return 1;
    return a.name.localeCompare(b.name);
  });
}
