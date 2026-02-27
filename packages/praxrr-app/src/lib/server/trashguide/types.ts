/**
 * TRaSH Guide domain types
 */

import type { ArrAppType } from '$shared/pcd/types.ts';
import {
  isTrashGuideEntityType,
  isTrashGuideSupportedArrType,
  parseTrashGuideEntityType,
  parseTrashGuideSourceArrType,
  TRASHGUIDE_ENTITY_TYPES,
  TRASHGUIDE_SUPPORTED_ARR_TYPES,
  TRASHGUIDE_SYNC_SECTION_TYPES,
  type TrashGuideEntityType,
  type TrashGuideSyncConfig,
  type TrashGuideSyncQualityProfileSourceHydration,
  type TrashGuideSyncSectionType,
  type TrashGuideSyncSelection,
  type TrashGuideSyncSelectionInput,
  type TrashGuideSyncSourceHydration,
  type TrashGuideSyncStatus,
  type TrashGuideSyncTrigger,
} from '$shared/trashguide/types.ts';

export {
  isTrashGuideEntityType,
  isTrashGuideSupportedArrType,
  parseTrashGuideEntityType,
  parseTrashGuideSourceArrType,
  TRASHGUIDE_ENTITY_TYPES,
  TRASHGUIDE_SUPPORTED_ARR_TYPES,
  TRASHGUIDE_SYNC_SECTION_TYPES,
  type TrashGuideEntityType,
  type TrashGuideSyncConfig,
  type TrashGuideSyncQualityProfileSourceHydration,
  type TrashGuideSyncSectionType,
  type TrashGuideSyncSelection,
  type TrashGuideSyncSelectionInput,
  type TrashGuideSyncSourceHydration,
  type TrashGuideSyncStatus,
  type TrashGuideSyncTrigger,
};

/** Arr type values supported for TRaSH entities. */
export type TrashGuideSupportedArrType = (typeof TRASHGUIDE_SUPPORTED_ARR_TYPES)[number];
export type TrashGuideSourceArrType = TrashGuideSupportedArrType;

export type TrashGuideArrType = ArrAppType;

/** TRaSH stable identity key. */
export type TrashGuideId = string & {
  readonly __brand: 'TrashGuideId';
};

export interface TrashGuideEntityIdentity {
  readonly trash_id: TrashGuideId;
  readonly arr_type: TrashGuideSupportedArrType;
  readonly entity_type: TrashGuideEntityType;
}

export function isTrashGuideId(value: string): value is TrashGuideId {
  return /^[a-f0-9]{32}$/i.test(value.trim());
}

export function toTrashGuideId(value: string): TrashGuideId {
  const normalized = value.trim().toLowerCase();
  if (!isTrashGuideId(normalized)) {
    throw new Error(`Invalid Trash Guide ID: ${value}`);
  }

  return normalized as TrashGuideId;
}

export function asTrashGuideId(value: string): TrashGuideId {
  return value as TrashGuideId;
}

export const TRASHGUIDE_METADATA_ENTITY_PATH_KEYS = {
  custom_formats: 'custom_format',
  quality_profiles: 'quality_profile',
  qualities: 'quality_size',
  naming: 'naming',
} as const;

export type TrashGuideMetadataEntityPathKey = keyof typeof TRASHGUIDE_METADATA_ENTITY_PATH_KEYS;

export interface TrashGuideMetadataArrPaths {
  readonly custom_formats?: readonly string[];
  readonly quality_profiles?: readonly string[];
  readonly qualities?: readonly string[];
  readonly naming?: readonly string[];
  readonly custom_format_groups?: readonly string[];
  readonly quality_profile_groups?: readonly string[];
}

export interface TrashGuideMetadataDocument {
  readonly $schema?: string;
  readonly json_paths: Record<string, TrashGuideMetadataArrPaths>;
}

export interface TrashGuideSourceFile {
  readonly entity_type: TrashGuideEntityType;
  readonly relative_path: string;
  readonly absolute_path: string;
}

export type TrashGuideDiscoveredFilesByEntity = {
  readonly [K in TrashGuideEntityType]: readonly TrashGuideSourceFile[];
};

export interface TrashGuideDiscoveryResult {
  readonly arr_type: TrashGuideSupportedArrType;
  readonly metadata_path: string;
  readonly files_by_entity: TrashGuideDiscoveredFilesByEntity;
  readonly total_files: number;
}

export interface TrashGuideFetchOptions {
  readonly repository_url: string;
  readonly local_path: string;
  readonly branch?: string;
  readonly personal_access_token?: string;
  readonly arr_type: TrashGuideArrType;
}

export type TrashGuideFetchAction = 'cloned' | 'updated';

export interface TrashGuideFetchResult {
  readonly repository_url: string;
  readonly local_path: string;
  readonly branch: string;
  readonly arr_type: TrashGuideSupportedArrType;
  readonly action: TrashGuideFetchAction;
  readonly discovery: TrashGuideDiscoveryResult;
}

export type TrashGuideFetcherErrorCode =
  | 'arr_type_unsupported'
  | 'repository_url_invalid'
  | 'local_path_invalid'
  | 'git_ref_error'
  | 'git_auth_error'
  | 'git_network_error'
  | 'git_pull_error'
  | 'git_operation_failed'
  | 'metadata_missing'
  | 'metadata_invalid'
  | 'metadata_path_missing';

export interface TrashGuideFetcherErrorDetails {
  readonly operation?: 'clone' | 'checkout' | 'pull' | 'metadata' | 'discover';
  readonly repository_url?: string;
  readonly local_path?: string;
  readonly branch?: string;
  readonly metadata_key?: TrashGuideMetadataEntityPathKey;
  readonly metadata_path?: string;
  readonly arr_type?: string;
}

export class TrashGuideFetcherError extends Error {
  readonly code: TrashGuideFetcherErrorCode;
  readonly retryable: boolean;
  readonly details?: TrashGuideFetcherErrorDetails;

  constructor(
    code: TrashGuideFetcherErrorCode,
    message: string,
    retryable: boolean,
    details?: TrashGuideFetcherErrorDetails,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'TrashGuideFetcherError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export type TrashGuideParseIssueCode = 'file_read_error' | 'json_parse_error' | 'validation_error';

export interface TrashGuideParseIssue {
  readonly code: TrashGuideParseIssueCode;
  readonly retryable: false;
  readonly entity_type: TrashGuideEntityType;
  readonly file_path: string;
  readonly message: string;
}

export interface TrashGuideCustomFormatSpecification {
  readonly name: string;
  readonly implementation: string;
  readonly negate: boolean;
  readonly required: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface TrashGuideCustomFormatEntity extends TrashGuideEntityIdentity {
  readonly entity_type: 'custom_format';
  readonly file_path: string;
  readonly name: string;
  readonly description: string | null;
  readonly regex_url: string | null;
  readonly include_in_rename: boolean;
  readonly scores: Readonly<Record<string, number>>;
  readonly specifications: readonly TrashGuideCustomFormatSpecification[];
}

export interface TrashGuideQualityProfileItem {
  readonly name: string;
  readonly allowed: boolean;
  readonly qualities: readonly string[];
}

export interface TrashGuideQualityProfileFormatItem {
  readonly name: string;
  readonly score: number | null;
  readonly custom_format_trash_id: TrashGuideId | null;
}

export interface TrashGuideQualityProfileEntity extends TrashGuideEntityIdentity {
  readonly entity_type: 'quality_profile';
  readonly file_path: string;
  readonly name: string;
  readonly description: string | null;
  readonly source_url: string | null;
  readonly score_set: string | null;
  readonly group: number | null;
  readonly upgrade_allowed: boolean;
  readonly cutoff: string;
  readonly min_format_score: number;
  readonly cutoff_format_score: number;
  readonly min_upgrade_format_score: number;
  readonly language: string | null;
  readonly items: readonly TrashGuideQualityProfileItem[];
  readonly format_items: readonly TrashGuideQualityProfileFormatItem[];
}

export interface TrashGuideQualitySizeEntry {
  readonly quality: string;
  readonly min: number;
  readonly preferred: number;
  readonly max: number;
}

export interface TrashGuideQualitySizeEntity extends TrashGuideEntityIdentity {
  readonly entity_type: 'quality_size';
  readonly file_path: string;
  readonly name: string;
  readonly profile_type: string;
  readonly qualities: readonly TrashGuideQualitySizeEntry[];
}

export interface TrashGuideNamingEntity extends TrashGuideEntityIdentity {
  readonly entity_type: 'naming';
  readonly file_path: string;
  readonly name: string;
  readonly templates: Readonly<Record<string, unknown>>;
}

export interface TrashGuideParsedEntities {
  readonly custom_formats: readonly TrashGuideCustomFormatEntity[];
  readonly quality_profiles: readonly TrashGuideQualityProfileEntity[];
  readonly quality_sizes: readonly TrashGuideQualitySizeEntity[];
  readonly naming: readonly TrashGuideNamingEntity[];
}

export type TrashGuideParsedEntity =
  | TrashGuideCustomFormatEntity
  | TrashGuideQualityProfileEntity
  | TrashGuideQualitySizeEntity
  | TrashGuideNamingEntity;

export type TrashGuideParseStatus = 'success' | 'partial' | 'failed';

export interface TrashGuideParseInput {
  readonly arr_type: TrashGuideArrType;
  readonly discovery: TrashGuideDiscoveryResult;
}

export interface TrashGuideParseResult {
  readonly arr_type: TrashGuideSupportedArrType;
  readonly status: TrashGuideParseStatus;
  readonly entities: TrashGuideParsedEntities;
  readonly ordered_entities: readonly TrashGuideParsedEntity[];
  readonly issues: readonly TrashGuideParseIssue[];
  readonly parsed_files: number;
  readonly failed_files: number;
}

export type TrashGuideParserErrorCode = 'arr_type_mismatch' | 'unsupported_arr_type';

export class TrashGuideParserError extends Error {
  readonly code: TrashGuideParserErrorCode;
  readonly retryable: false;

  constructor(code: TrashGuideParserErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TrashGuideParserError';
    this.code = code;
    this.retryable = false;
  }
}
