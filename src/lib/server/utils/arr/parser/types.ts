/**
 * Parser Types
 * Matches the C# parser microservice types
 */

export enum QualitySource {
  Unknown = 0,
  Cam = 1,
  Telesync = 2,
  Telecine = 3,
  Workprint = 4,
  DVD = 5,
  TV = 6,
  WebDL = 7,
  WebRip = 8,
  Bluray = 9,
}

export enum QualityModifier {
  None = 0,
  Regional = 1,
  Screener = 2,
  RawHD = 3,
  BRDisk = 4,
  Remux = 5,
}

export enum Resolution {
  Unknown = 0,
  R360p = 360,
  R480p = 480,
  R540p = 540,
  R576p = 576,
  R720p = 720,
  R1080p = 1080,
  R2160p = 2160,
}

export enum Language {
  Unknown = 0,
  English = 1,
  French = 2,
  Spanish = 3,
  German = 4,
  Italian = 5,
  Danish = 6,
  Dutch = 7,
  Japanese = 8,
  Icelandic = 9,
  Chinese = 10,
  Russian = 11,
  Polish = 12,
  Vietnamese = 13,
  Swedish = 14,
  Norwegian = 15,
  Finnish = 16,
  Turkish = 17,
  Portuguese = 18,
  Flemish = 19,
  Greek = 20,
  Korean = 21,
  Hungarian = 22,
  Hebrew = 23,
  Lithuanian = 24,
  Czech = 25,
  Hindi = 26,
  Romanian = 27,
  Thai = 28,
  Bulgarian = 29,
  PortugueseBR = 30,
  Arabic = 31,
  Ukrainian = 32,
  Persian = 33,
  Bengali = 34,
  Slovak = 35,
  Latvian = 36,
  SpanishLatino = 37,
  Catalan = 38,
  Croatian = 39,
  Serbian = 40,
  Bosnian = 41,
  Estonian = 42,
  Tamil = 43,
  Indonesian = 44,
  Telugu = 45,
  Macedonian = 46,
  Slovenian = 47,
  Malayalam = 48,
  Kannada = 49,
  Albanian = 50,
  Afrikaans = 51,
  Marathi = 52,
  Tagalog = 53,
  Urdu = 54,
  Romansh = 55,
  Mongolian = 56,
  Georgian = 57,
  Original = 58,
}

export enum ReleaseType {
  Unknown = 0,
  SingleEpisode = 1,
  MultiEpisode = 2,
  SeasonPack = 3,
}

export interface Revision {
  version: number;
  real: number;
  isRepack: boolean;
}

export interface QualityInfo {
  source: QualitySource;
  resolution: Resolution;
  modifier: QualityModifier;
  revision: Revision;
}

export interface EpisodeInfo {
  seriesTitle: string | null;
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteEpisodeNumbers: number[];
  airDate: string | null;
  fullSeason: boolean;
  isPartialSeason: boolean;
  isMultiSeason: boolean;
  isMiniSeries: boolean;
  special: boolean;
  releaseType: ReleaseType;
}

export type MediaType = 'movie' | 'series';

export interface ParseResult {
  title: string;
  type: MediaType;
  source: QualitySource;
  resolution: Resolution;
  modifier: QualityModifier;
  revision: Revision;
  languages: Language[];
  releaseGroup: string | null;
  movieTitles: string[];
  year: number;
  edition: string | null;
  imdbId: string | null;
  tmdbId: number;
  hardcodedSubs: string | null;
  releaseHash: string | null;
  episode: EpisodeInfo | null;
}
