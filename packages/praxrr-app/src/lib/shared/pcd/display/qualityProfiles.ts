import type { ArrAppType } from '../../arr/capabilities.ts';
import type { QualityProfilesRow } from '../types.ts';
import type { SourcedDisplayRow } from '../../sources/types.ts';
import type { Tag } from './common.ts';

/** Quality profile option for select/dropdown */
export type QualityProfileOption = Pick<QualityProfilesRow, 'id' | 'name'>;

/** Quality/group item in the hierarchy */
export interface QualityItem {
  position: number;
  type: 'quality' | 'group';
  name: string;
  is_upgrade_until: boolean;
}

/** Language configuration */
export interface ProfileLanguage {
  name: string;
  type: 'must' | 'only' | 'not' | 'simple';
}

type RequiredCustomFormatScoreApp = Extract<ArrAppType, 'radarr' | 'sonarr'>;

export type CustomFormatCountsByArrType = Record<RequiredCustomFormatScoreApp, number> &
  Partial<Record<Exclude<ArrAppType, RequiredCustomFormatScoreApp>, number>>;

/** Custom format counts by arr type */
export interface CustomFormatCounts extends CustomFormatCountsByArrType {
  /** Shared score applied to all apps */
  all: number;
  /** Aggregate of all app-specific and shared counts */
  total: number;
}

/** Quality profile data for table/card views (with JOINed data) */
export type QualityProfileTableRow = Omit<
  QualityProfilesRow,
  'description' | 'upgrade_until_score' | 'upgrade_score_increment' | 'created_at' | 'updated_at'
> & {
  description: string; // Parsed HTML from markdown (non-nullable)
  tags: Tag[];
  upgrade_until_score?: number; // Only if upgrades_allowed
  upgrade_score_increment?: number; // Only if upgrades_allowed
  custom_formats: CustomFormatCounts;
  qualities: QualityItem[];
  language?: ProfileLanguage;
} & SourcedDisplayRow;

/** Quality profile general information */
export type QualityProfileGeneral = Pick<QualityProfilesRow, 'id' | 'name'> & {
  description: string; // Raw markdown (non-nullable for form)
  tags: Tag[];
  language: string | null; // Language name, null means "Any"
};

/** Language configuration for a quality profile */
export interface QualityProfileLanguage {
  name: string;
  type: 'must' | 'only' | 'not' | 'simple';
}

/** Quality profile languages information */
export interface QualityProfileLanguages {
  languages: QualityProfileLanguage[];
}

/** Single quality item for display */
export interface QualitySingle {
  name: string;
  position: number;
  enabled: boolean;
  isUpgradeUntil: boolean;
}

/** Quality group with members for display */
export interface QualityGroup {
  name: string;
  position: number;
  enabled: boolean;
  isUpgradeUntil: boolean;
  members: { name: string }[];
}

/** Quality profile qualities information */
export interface QualityProfileQualities {
  singles: QualitySingle[];
  groups: QualityGroup[];
}

/** Simple quality member (name only) */
export interface QualityMember {
  name: string;
}

/** Ordered quality/group item for qualities page */
export interface OrderedItem {
  type: 'quality' | 'group';
  name: string;
  position: number;
  enabled: boolean;
  upgradeUntil: boolean;
  members?: QualityMember[];
}

/** Group with members (for qualities page) */
export interface QualitiesGroup {
  name: string;
  members: QualityMember[];
}

/** Qualities page data */
export interface QualitiesPageData {
  orderedItems: OrderedItem[];
  availableQualities: QualityMember[];
  allQualities: QualityMember[];
  groups: QualitiesGroup[];
}

export type CustomFormatScoresByArrType = Record<RequiredCustomFormatScoreApp, number | null> &
  Partial<Record<Exclude<ArrAppType, RequiredCustomFormatScoreApp>, number | null>>;

/** Custom format scoring entry */
export interface CustomFormatScoring {
  name: string;
  tags: string[];
  scores: CustomFormatScoresByArrType;
}

/** Quality profile scoring data for the scoring page */
export interface QualityProfileScoring {
  databaseId: number;
  arrTypes: ArrAppType[];
  customFormats: CustomFormatScoring[];
  minimum_custom_format_score: number;
  upgrade_until_score: number;
  upgrade_score_increment: number;
}

/** CF scores for a single profile */
export interface ProfileCfScores {
  profileName: string;
  /** Map of custom format name to score (by arr type) */
  scores: Record<string, CustomFormatScoresByArrType>;
}

/** All CF scores result for entity testing */
export interface AllCfScoresResult {
  /** All custom formats with their names */
  customFormats: Array<{ name: string }>;
  /** CF scores per profile */
  profiles: ProfileCfScores[];
}
