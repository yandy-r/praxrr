/**
 * Resolved Config Readers
 *
 * Dispatch table mapping (entityType, arrType) -> the matching `serialize*` reader in
 * `pcd/entities/serialize.ts`, plus a name-listing helper backed by the PCD cache
 * tables. This is the single source of truth for which resolved-config entity types
 * are arr-agnostic vs per-arr-app.
 *
 * Per the repo's Cross-Arr Semantic Validation Policy: there is no sibling-app
 * fallback anywhere in this module. An unmapped (entityType, arrType) combination
 * (for example `lidarrMetadataProfile` + `radarr`) always throws
 * `ResolvedConfigValidationError` rather than silently resolving to a different arr's
 * reader.
 */

import type { PCDCache } from '$pcd/index.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import {
  serializeCustomFormat,
  serializeDelayProfile,
  serializeLidarrMediaSettings,
  serializeLidarrMetadataProfile,
  serializeLidarrNaming,
  serializeLidarrQualityDefinitions,
  serializeQualityProfile,
  serializeRadarrMediaSettings,
  serializeRadarrNaming,
  serializeRadarrQualityDefinitions,
  serializeRegularExpression,
  serializeSonarrMediaSettings,
  serializeSonarrNaming,
  serializeSonarrQualityDefinitions,
} from '../entities/serialize.ts';
import type {
  ArrAgnosticEntityType,
  PerArrEntityType,
  ResolvedEntityPayload,
  ResolvedEntityType,
  ResolvedReaderFn,
} from './types.ts';

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Thrown for caller-input problems: missing/unmapped arrType for a per-arr entity
 * type, an arrType supplied for an arr-agnostic entity type, or an unknown
 * entityType/arrType combination. Routes map this to 400.
 *
 * Distinct from the plain `Error` thrown by `serialize.ts` readers on a by-name miss
 * (propagated unwrapped here), which routes map to 404 -- see
 * `isResolvedConfigValidationError`.
 */
export class ResolvedConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolvedConfigValidationError';
  }
}

/** Distinguishes a `ResolvedConfigValidationError` (400) from a not-found `Error` (404). */
export function isResolvedConfigValidationError(error: unknown): error is ResolvedConfigValidationError {
  return error instanceof ResolvedConfigValidationError;
}

// ============================================================================
// DISPATCH TABLES
// ============================================================================

export const ARR_AGNOSTIC_READERS: Readonly<Record<ArrAgnosticEntityType, ResolvedReaderFn>> = {
  delayProfile: serializeDelayProfile,
  regularExpression: serializeRegularExpression,
  customFormat: serializeCustomFormat,
  qualityProfile: serializeQualityProfile,
};

export const PER_ARR_READERS: Readonly<
  Record<PerArrEntityType, Partial<Readonly<Record<ArrAppType, ResolvedReaderFn>>>>
> = {
  naming: {
    radarr: serializeRadarrNaming,
    sonarr: serializeSonarrNaming,
    lidarr: serializeLidarrNaming,
  },
  mediaSettings: {
    radarr: serializeRadarrMediaSettings,
    sonarr: serializeSonarrMediaSettings,
    lidarr: serializeLidarrMediaSettings,
  },
  qualityDefinitions: {
    radarr: serializeRadarrQualityDefinitions,
    sonarr: serializeSonarrQualityDefinitions,
    lidarr: serializeLidarrQualityDefinitions,
  },
  lidarrMetadataProfile: {
    lidarr: serializeLidarrMetadataProfile,
    // radarr/sonarr keys intentionally absent -- lidarr-only entity type, no sibling fallback.
  },
};

const ARR_AGNOSTIC_ENTITY_TYPES: ReadonlySet<string> = new Set<ArrAgnosticEntityType>([
  'delayProfile',
  'regularExpression',
  'customFormat',
  'qualityProfile',
]);

const PER_ARR_ENTITY_TYPES: ReadonlySet<string> = new Set<PerArrEntityType>([
  'naming',
  'mediaSettings',
  'qualityDefinitions',
  'lidarrMetadataProfile',
]);

function isArrAgnosticEntityType(entityType: string): entityType is ArrAgnosticEntityType {
  return ARR_AGNOSTIC_ENTITY_TYPES.has(entityType);
}

function isPerArrEntityType(entityType: string): entityType is PerArrEntityType {
  return PER_ARR_ENTITY_TYPES.has(entityType);
}

// ============================================================================
// READ DISPATCH
// ============================================================================

/**
 * Reads a single resolved entity by dispatching to the matching `serialize*` reader.
 *
 * - Arr-agnostic entity types (`delayProfile`, `regularExpression`, `customFormat`,
 *   `qualityProfile`) reject a supplied `arrType`.
 * - Per-arr entity types (`naming`, `mediaSettings`, `qualityDefinitions`,
 *   `lidarrMetadataProfile`) require `arrType` and throw when it is missing or
 *   unmapped for that entity type (no sibling-app fallback).
 * - A not-found-by-name miss propagates the plain `Error` thrown by the underlying
 *   `serialize*` function unchanged, for routes to map to 404.
 */
export async function readResolvedEntity(
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): Promise<ResolvedEntityPayload> {
  if (isArrAgnosticEntityType(entityType)) {
    if (arrType !== undefined) {
      throw new ResolvedConfigValidationError(
        `Entity type "${entityType}" is arr-agnostic and does not accept an arrType`
      );
    }

    return ARR_AGNOSTIC_READERS[entityType](cache, name);
  }

  if (isPerArrEntityType(entityType)) {
    if (arrType === undefined) {
      throw new ResolvedConfigValidationError(`Entity type "${entityType}" requires an arrType`);
    }

    const reader = PER_ARR_READERS[entityType][arrType];
    if (!reader) {
      throw new ResolvedConfigValidationError(`Entity type "${entityType}" is not supported for arrType "${arrType}"`);
    }

    return reader(cache, name);
  }

  throw new ResolvedConfigValidationError(`Unknown resolved entity type "${entityType}"`);
}

// ============================================================================
// NAME LISTING
// ============================================================================

function assertNoArrType(entityType: ArrAgnosticEntityType, arrType: ArrAppType | undefined): void {
  if (arrType !== undefined) {
    throw new ResolvedConfigValidationError(
      `Entity type "${entityType}" is arr-agnostic and does not accept an arrType`
    );
  }
}

function assertArrType(entityType: PerArrEntityType, arrType: ArrAppType | undefined): ArrAppType {
  if (arrType === undefined) {
    throw new ResolvedConfigValidationError(`Entity type "${entityType}" requires an arrType`);
  }

  return arrType;
}

/**
 * Lists entity names for the given (entityType, arrType) from the PCD cache tables --
 * the source for the list endpoint. Same arrType requirements as `readResolvedEntity`.
 */
export async function listResolvedEntityNames(
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType?: ArrAppType
): Promise<string[]> {
  const db = cache.kb;

  switch (entityType) {
    case 'delayProfile': {
      assertNoArrType(entityType, arrType);
      const rows = await db.selectFrom('delay_profiles').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'regularExpression': {
      assertNoArrType(entityType, arrType);
      const rows = await db.selectFrom('regular_expressions').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'customFormat': {
      assertNoArrType(entityType, arrType);
      const rows = await db.selectFrom('custom_formats').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'qualityProfile': {
      assertNoArrType(entityType, arrType);
      const rows = await db.selectFrom('quality_profiles').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'naming': {
      const resolvedArrType = assertArrType(entityType, arrType);
      if (resolvedArrType === 'radarr') {
        const rows = await db.selectFrom('radarr_naming').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      if (resolvedArrType === 'sonarr') {
        const rows = await db.selectFrom('sonarr_naming').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      const rows = await db.selectFrom('lidarr_naming').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'mediaSettings': {
      const resolvedArrType = assertArrType(entityType, arrType);
      if (resolvedArrType === 'radarr') {
        const rows = await db.selectFrom('radarr_media_settings').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      if (resolvedArrType === 'sonarr') {
        const rows = await db.selectFrom('sonarr_media_settings').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      const rows = await db.selectFrom('lidarr_media_settings').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'qualityDefinitions': {
      const resolvedArrType = assertArrType(entityType, arrType);
      if (resolvedArrType === 'radarr') {
        const rows = await db.selectFrom('radarr_quality_definitions').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      if (resolvedArrType === 'sonarr') {
        const rows = await db.selectFrom('sonarr_quality_definitions').select('name').orderBy('name').execute();
        return rows.map((row) => row.name);
      }
      const rows = await db.selectFrom('lidarr_quality_definitions').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    case 'lidarrMetadataProfile': {
      const resolvedArrType = assertArrType(entityType, arrType);
      if (resolvedArrType !== 'lidarr') {
        throw new ResolvedConfigValidationError(
          `Entity type "lidarrMetadataProfile" is not supported for arrType "${resolvedArrType}"`
        );
      }
      const rows = await db.selectFrom('lidarr_metadata_profiles').select('name').orderBy('name').execute();
      return rows.map((row) => row.name);
    }
    default: {
      const exhaustiveCheck: never = entityType;
      throw new ResolvedConfigValidationError(`Unknown resolved entity type "${String(exhaustiveCheck)}"`);
    }
  }
}
