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
 * Distinct from `ResolvedEntityNotFoundError` (a by-name miss, 404) -- see
 * `isResolvedConfigValidationError`.
 */
export class ResolvedConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolvedConfigValidationError';
  }
}

/** Distinguishes a `ResolvedConfigValidationError` (400) from any other error. */
export function isResolvedConfigValidationError(error: unknown): error is ResolvedConfigValidationError {
  return error instanceof ResolvedConfigValidationError;
}

/**
 * Thrown when a resolved-config entity read misses by name -- the requested
 * (entityType, arrType, name) combination is well-formed but no such entity exists.
 * Routes map this to 404.
 *
 * Distinct from `ResolvedConfigValidationError` (400 -- bad/missing arrType, unknown
 * entityType) AND from every other `Error` that can propagate out of
 * `readResolvedEntity` -- e.g. `ResolvedConfigDatabaseNotFoundError` (`layers.ts`) or a
 * PCDCache SQL-helper miss like `Tag not found: X` (`database/cache.ts`'s
 * `registerHelperFunctions`). Those are NOT this type and must keep propagating as
 * generic errors so routes map them to 500, not a misleading 404 -- see
 * `isReaderNotFoundMessage` for the exact-shape gate that decides which caught errors
 * get rewrapped as `ResolvedEntityNotFoundError`.
 */
export class ResolvedEntityNotFoundError extends Error {
  constructor(entityType: ResolvedEntityType, arrType: ArrAppType | undefined, name: string) {
    super(`${entityType}${arrType ? ` (${arrType})` : ''} "${name}" not found`);
    this.name = 'ResolvedEntityNotFoundError';
  }
}

/** Distinguishes a `ResolvedEntityNotFoundError` (404) from a `ResolvedConfigValidationError` (400) or any other error (500). */
export function isResolvedEntityNotFoundError(error: unknown): error is ResolvedEntityNotFoundError {
  return error instanceof ResolvedEntityNotFoundError;
}

/**
 * Matches the exact `<Label> "<name>" not found` shape every `serialize*` reader in
 * `pcd/entities/serialize.ts` throws on its own top-level by-name miss (see e.g.
 * `serializeRegularExpression`'s `Regular expression "${name}" not found`).
 * Deliberately narrow: PCDCache's SQL helper functions
 * (`database/cache.ts::registerHelperFunctions`) throw a DIFFERENT shape on their own
 * by-name misses (`Tag not found: ${name}` -- no quotes, "not found" mid-sentence rather
 * than a trailing clause), and `ResolvedConfigDatabaseNotFoundError` (`layers.ts`)
 * throws yet another shape (`Database instance ${id} not found`) -- neither must be
 * reclassified as a `ResolvedEntityNotFoundError`, since both indicate a genuine
 * cache/data-integrity or caller-databaseId problem, not a by-name miss on this read.
 * Exported (mirrors `testConnectionReason.ts`'s pure-mapping-function convention) so it
 * is independently testable without needing to trigger every miss shape through a real
 * `serialize*` call.
 */
export function isReaderNotFoundMessage(message: string, name: string): boolean {
  return message.endsWith(`"${name}" not found`);
}

/** Dispatches to `reader`, rewrapping ONLY its own top-level by-name miss as `ResolvedEntityNotFoundError`. */
async function invokeReader(
  reader: ResolvedReaderFn,
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): Promise<ResolvedEntityPayload> {
  try {
    return await reader(cache, name);
  } catch (error) {
    if (error instanceof Error && isReaderNotFoundMessage(error.message, name)) {
      throw new ResolvedEntityNotFoundError(entityType, arrType, name);
    }
    throw error;
  }
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
 * - A not-found-by-name miss throws `ResolvedEntityNotFoundError` (see
 *   `isReaderNotFoundMessage`), for routes to map to 404.
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

    return invokeReader(ARR_AGNOSTIC_READERS[entityType], cache, entityType, arrType, name);
  }

  if (isPerArrEntityType(entityType)) {
    if (arrType === undefined) {
      throw new ResolvedConfigValidationError(`Entity type "${entityType}" requires an arrType`);
    }

    const reader = PER_ARR_READERS[entityType][arrType];
    if (!reader) {
      throw new ResolvedConfigValidationError(`Entity type "${entityType}" is not supported for arrType "${arrType}"`);
    }

    return invokeReader(reader, cache, entityType, arrType, name);
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
