import type { ArrType } from '../pcd/types.ts';

export const TRASHGUIDE_ENTITY_TYPES = ['custom_format', 'quality_profile', 'quality_size', 'naming'] as const;
export type TrashGuideEntityType = (typeof TRASHGUIDE_ENTITY_TYPES)[number];

export const TRASHGUIDE_SUPPORTED_ARR_TYPES = ['radarr', 'sonarr'] as const;
export type TrashGuideSupportedArrType = (typeof TRASHGUIDE_SUPPORTED_ARR_TYPES)[number];
export type TrashGuideSourceArrType = TrashGuideSupportedArrType;

/**
 * Check whether a value is a supported TRaSH-Guides entity type.
 *
 * @param value - Raw entity type value.
 * @returns True when value is a valid TRaSH entity type.
 */
export function isTrashGuideEntityType(value: string): value is TrashGuideEntityType {
  return (TRASHGUIDE_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Parse and validate a TRaSH-Guides entity type.
 *
 * @param value - Raw entity type value.
 * @returns Parsed TRaSH entity type.
 * @throws Error when the value is not a valid TRaSH entity type.
 */
export function parseTrashGuideEntityType(value: string): TrashGuideEntityType {
  if (isTrashGuideEntityType(value)) {
    return value;
  }

  throw new Error(`Invalid TRaSH entity type: ${value}`);
}

/**
 * Check whether a value is a supported TRaSH-Guides arr type.
 *
 * @param value - Raw arr type value.
 * @returns True when value is a valid TRaSH source arr type.
 */
export function isTrashGuideSupportedArrType(value: string): value is TrashGuideSupportedArrType {
  return (TRASHGUIDE_SUPPORTED_ARR_TYPES as readonly string[]).includes(value);
}

/**
 * Parse and validate a TRaSH source Arr type.
 *
 * @param value - Raw arr type value.
 * @returns Parsed Arr type used by TRaSH source records.
 * @throws Error when the value is invalid.
 */
export function parseTrashGuideSourceArrType(value: string): TrashGuideSourceArrType {
  if (isTrashGuideSupportedArrType(value)) {
    return value;
  }

  throw new Error(`Invalid TRaSH source arr type: ${value}`);
}

export const TRASHGUIDE_SYNC_TRIGGERS = ['none', 'manual', 'on_pull', 'on_change', 'schedule'] as const;
export type TrashGuideSyncTrigger = (typeof TRASHGUIDE_SYNC_TRIGGERS)[number];

export const TRASHGUIDE_SYNC_STATUSES = ['idle', 'pending', 'in_progress', 'failed'] as const;
export type TrashGuideSyncStatus = (typeof TRASHGUIDE_SYNC_STATUSES)[number];

export const TRASHGUIDE_SYNC_SECTION_TYPES = [
  'qualityProfiles',
  'customFormats',
  'qualityDefinitions',
  'naming',
  'mediaManagement',
] as const;
export type TrashGuideSyncSectionType = (typeof TRASHGUIDE_SYNC_SECTION_TYPES)[number];

export interface TrashGuideSyncSelection {
  instanceId: number;
  sourceId: number;
  sectionType: TrashGuideSyncSectionType;
  itemName: string;
}

export interface TrashGuideSyncSelectionInput {
  sectionType: TrashGuideSyncSectionType;
  itemName: string;
}

export interface TrashGuideSyncConfig {
  instanceId: number;
  sourceId: number;
  trigger: TrashGuideSyncTrigger;
  cron: string | null;
  nextRunAt: string | null;
  syncStatus: TrashGuideSyncStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  shouldSync: boolean;
  instanceType: ArrType;
  sourceArrType: TrashGuideSourceArrType;
}

export interface TrashGuideSyncSourceHydration {
  sourceId: number;
  sourceName: string;
  sourceArrType: TrashGuideSourceArrType;
  config: TrashGuideSyncConfig | null;
  selections: TrashGuideSyncSelection[];
}

export interface TrashGuideSyncQualityProfileSourceHydration {
  sourceId: number;
  sourceName: string;
  sourceArrType: TrashGuideSourceArrType;
  config: TrashGuideSyncConfig | null;
  selectedQualityProfiles: string[];
}
