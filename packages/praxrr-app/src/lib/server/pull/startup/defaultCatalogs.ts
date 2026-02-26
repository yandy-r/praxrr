import type { StartupPullArrType, StartupPullSection } from './types.ts';

export type StartupDefaultConfidence = 'certain' | 'uncertain';

export type StartupDefaultFieldComparator = 'eq' | 'is-empty-array';

export interface StartupDefaultFieldCriterion {
  readonly field: string;
  readonly comparator: StartupDefaultFieldComparator;
  readonly value?: unknown;
}

interface StartupDefaultCatalogRuleBase {
  readonly arrType: StartupPullArrType;
  readonly section: StartupPullSection;
  readonly confidence: StartupDefaultConfidence;
  readonly reason: string;
}

export interface StartupDefaultIdRule extends StartupDefaultCatalogRuleBase {
  readonly kind: 'ids';
  readonly ids: readonly number[];
}

export interface StartupDefaultNameRule extends StartupDefaultCatalogRuleBase {
  readonly kind: 'names';
  readonly names: readonly string[];
  readonly caseSensitive?: boolean;
}

export interface StartupDefaultFieldRule extends StartupDefaultCatalogRuleBase {
  readonly kind: 'fields';
  readonly criteria: readonly StartupDefaultFieldCriterion[];
}

export type StartupDefaultCatalogRule = StartupDefaultIdRule | StartupDefaultNameRule | StartupDefaultFieldRule;

export type StartupDefaultRulesBySection = Record<StartupPullSection, readonly StartupDefaultCatalogRule[]>;

export type StartupDefaultCatalog = Record<StartupPullArrType, StartupDefaultRulesBySection>;

const RADARR_DELAY_PROFILE_DEFAULT_IDS = [1] as const;
const SONARR_DELAY_PROFILE_DEFAULT_IDS = [1] as const;

/**
 * Policy data only. These are explicit, auditable rules per arr_type + section.
 * Keep this file free of evaluation logic so policy updates are reviewable in isolation.
 */
export const STARTUP_DEFAULT_CATALOG: StartupDefaultCatalog = {
  radarr: {
    qualityProfiles: [],
    delayProfiles: [
      {
        arrType: 'radarr',
        section: 'delayProfiles',
        kind: 'ids',
        confidence: 'certain',
        reason: 'Radarr sync default delay profile is stable as id=1 in current runtime behavior.',
        ids: RADARR_DELAY_PROFILE_DEFAULT_IDS,
      },
    ],
    metadataProfiles: [],
    naming: [],
    mediaSettings: [],
    qualityDefinitions: [],
  },
  sonarr: {
    qualityProfiles: [],
    delayProfiles: [
      {
        arrType: 'sonarr',
        section: 'delayProfiles',
        kind: 'ids',
        confidence: 'certain',
        reason: 'Sonarr sync default delay profile is stable as id=1 in current runtime behavior.',
        ids: SONARR_DELAY_PROFILE_DEFAULT_IDS,
      },
    ],
    metadataProfiles: [],
    naming: [],
    mediaSettings: [],
    qualityDefinitions: [],
  },
  lidarr: {
    qualityProfiles: [],
    delayProfiles: [
      {
        arrType: 'lidarr',
        section: 'delayProfiles',
        kind: 'fields',
        confidence: 'uncertain',
        reason:
          'Lidarr default delay profile is best detected as untagged profile with order 1; behavior can drift by version.',
        criteria: [
          { field: 'order', comparator: 'eq', value: 1 },
          { field: 'tags', comparator: 'is-empty-array' },
        ],
      },
    ],
    metadataProfiles: [],
    naming: [],
    mediaSettings: [],
    qualityDefinitions: [],
  },
} as const;

export const DEFAULT_FILTERABLE_STARTUP_SECTIONS: readonly StartupPullSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'metadataProfiles',
] as const;

/**
 * Returns the default catalog rules for a given arr type and section.
 *
 * @param arrType - The Arr application type to look up rules for
 * @param section - The startup pull section to look up rules for
 * @returns The list of catalog rules for that arr type and section
 */
export function getStartupDefaultCatalog(
  arrType: StartupPullArrType,
  section: StartupPullSection
): readonly StartupDefaultCatalogRule[] {
  return STARTUP_DEFAULT_CATALOG[arrType][section];
}
