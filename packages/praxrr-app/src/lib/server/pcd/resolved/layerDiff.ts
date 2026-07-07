/**
 * Resolved Config Layer Diff
 *
 * Answers "what did user overrides change on top of base?" and "what does this entity
 * look like at layer X?" by composing the readers dispatch table (`readers.ts`), the
 * ephemeral base-only cache builder (`layers.ts`), and the sync-preview diff engine
 * (`$sync/preview/diff.ts`) verbatim -- no `diffEntityCollection`/`diffSingletonEntity`,
 * since those add create/update/delete action semantics that don't apply to a
 * same-entity, same-name layer comparison; a direct `diffToFieldChanges` call is enough.
 *
 * IMPORTANT: the `*_ARRAY_KEY_STRATEGIES` constants exported by
 * `$sync/preview/sectionDiffs.ts` target **live-Arr-API field names** (e.g.
 * `primaryAlbumTypes`), not `Portable*` field names (e.g.
 * `PortableLidarrMetadataProfile.primaryTypes`). `PORTABLE_ARRAY_KEY_STRATEGIES` below
 * is a net-new, Portable-field-named strategy set built specifically for diffing
 * `Portable*` payloads -- reusing the sectionDiffs.ts constants here would silently
 * fail to key anything (the field names never match) and every reorder would read as a
 * false-positive N-adds + N-removes.
 */

import type { ArrAppType } from '$shared/pcd/types.ts';
import { diffToFieldChanges, type PreviewArrayKeyStrategy } from '$sync/preview/diff.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { getCache } from '../database/registry.ts';
import { withBaseOnlyCache } from './layers.ts';
import { isResolvedEntityNotFoundError, ResolvedEntityNotFoundError, readResolvedEntity } from './readers.ts';
import type { PCDCache } from '../database/cache.ts';
import type { ResolvedEntityPayload, ResolvedEntityType, ResolvedLayer } from './types.ts';

// ============================================================================
// PORTABLE-FIELD ARRAY KEY STRATEGIES
// ============================================================================

/**
 * Array-key strategies for diffing `Portable*` payloads (as opposed to live-Arr-API
 * payloads -- see module doc above). Each entry documents which `Portable*` type(s) it
 * targets and why the chosen field is a stable key.
 *
 * Known limitation shared with `sectionDiffs.ts`'s `items.items` entry: the diff
 * engine's array-key lookup is an exact string match against the literal computed path
 * (`context.arrayKeyStrategies.get(path)`), and a keyed array's items are diffed under
 * a per-key bracketed path (e.g. `orderedItems["Bluray-1080p"]`). A nested array
 * *inside* a keyed item -- for example `OrderedItem.members` -- therefore gets a
 * distinct composed path per parent key (`orderedItems["Bluray-1080p"].members`), which
 * no single fixed strategy path can match. Reordering a group's `members` list can
 * still read as spurious index-based changes; this is a pre-existing limitation of the
 * shared diff engine (`$sync/preview/diff.ts`), not something introduced here.
 */
export const PORTABLE_ARRAY_KEY_STRATEGIES: readonly PreviewArrayKeyStrategy[] = [
  // PortableCustomFormat.conditions: ConditionData[] -- each condition is uniquely
  // named within a custom format.
  {
    path: 'conditions',
    selectKey: (item) => {
      const typed = item as { name?: unknown };
      return typeof typed.name === 'string' ? typed.name : '';
    },
  },
  // PortableCustomFormat.tests: PortableCustomFormatTest[] -- `title` is the only
  // stable identifier a test case carries.
  {
    path: 'tests',
    selectKey: (item) => {
      const typed = item as { title?: unknown };
      return typeof typed.title === 'string' ? typed.title : '';
    },
  },
  // PortableQualityProfile.orderedItems: OrderedItem[] -- one array holding both
  // quality and group entries (discriminated by `type`), keyed by `name`, which is
  // unique across the profile's combined quality+group namespace.
  {
    path: 'orderedItems',
    selectKey: (item) => {
      const typed = item as { name?: unknown };
      return typeof typed.name === 'string' ? typed.name : '';
    },
  },
  // PortableQualityProfile.customFormatScores: PortableCustomFormatScore[] -- one score
  // row per (customFormatName, arrType) pair, so the key must be composite.
  {
    path: 'customFormatScores',
    selectKey: (item) => {
      const typed = item as { customFormatName?: unknown; arrType?: unknown };
      const name = typeof typed.customFormatName === 'string' ? typed.customFormatName : '';
      const arrType = typeof typed.arrType === 'string' ? typed.arrType : '';
      return `${name}:${arrType}`;
    },
  },
  // PortableQualityDefinitions.entries / PortableLidarrQualityDefinitions.entries:
  // QualityDefinitionEntry[] -- keyed by `quality_name`, the row's only stable
  // identifier (snake_case -- matches the field as declared on the Portable type).
  {
    path: 'entries',
    selectKey: (item) => {
      const typed = item as { quality_name?: unknown };
      return typeof typed.quality_name === 'string' ? typed.quality_name : '';
    },
  },
  // PortableLidarrMetadataProfile.primaryTypes / .secondaryTypes / .releaseStatuses:
  // PortableMetadataProfileType[] -- each type array keyed by `name`.
  {
    path: 'primaryTypes',
    selectKey: (item) => {
      const typed = item as { name?: unknown };
      return typeof typed.name === 'string' ? typed.name : '';
    },
  },
  {
    path: 'secondaryTypes',
    selectKey: (item) => {
      const typed = item as { name?: unknown };
      return typeof typed.name === 'string' ? typed.name : '';
    },
  },
  {
    path: 'releaseStatuses',
    selectKey: (item) => {
      const typed = item as { name?: unknown };
      return typeof typed.name === 'string' ? typed.name : '';
    },
  },
];

// ============================================================================
// USER OVERRIDES DIFF
// ============================================================================

/**
 * Pure diff of a resolved entity against its base-layer counterpart. `baseEntity` is
 * `null` when the entity does not exist in the base layer at all -- an entity that
 * exists only via user ops (created outside the base/tweaks layers). In that case
 * `diffToFieldChanges(null, resolvedEntity, ...)` naturally produces an `'added'`
 * `FieldChange` for every field on `resolvedEntity`, which is the desired behavior:
 * the whole entity reads as a user override rather than a diff-engine crash or an
 * empty result. See `layerDiff.test.ts` for the base-absent -> resolved-present case.
 */
export function computeUserOverrides(
  baseEntity: ResolvedEntityPayload | null,
  resolvedEntity: ResolvedEntityPayload | null
): FieldChange[] {
  return diffToFieldChanges(baseEntity, resolvedEntity, { arrayKeyStrategies: PORTABLE_ARRAY_KEY_STRATEGIES });
}

// ============================================================================
// PENDING CONFLICT CORRELATION
// ============================================================================

/**
 * `pcd_ops.metadata` values written by the entity CRUD modules under `pcd/entities/**`
 * (see e.g. `entities/customFormats/create.ts`, `entities/mediaManagement/naming/create.ts`).
 * This mirrors the entity-name vocabulary `draftChanges.ts` already correlates against
 * (`ENTITY_BY_STABLE_KEY`), extended with the per-arr media-management/metadata-profile
 * variants resolved-config also serves.
 */
function resolveOpMetadataEntity(entityType: ResolvedEntityType, arrType: ArrAppType | undefined): string | null {
  switch (entityType) {
    case 'delayProfile':
      return 'delay_profile';
    case 'regularExpression':
      return 'regular_expression';
    case 'customFormat':
      return 'custom_format';
    case 'qualityProfile':
      return 'quality_profile';
    case 'naming':
      if (arrType === 'radarr') return 'radarr_naming';
      if (arrType === 'sonarr') return 'sonarr_naming';
      if (arrType === 'lidarr') return 'lidarr_naming';
      return null;
    case 'mediaSettings':
      if (arrType === 'radarr') return 'radarr_media_settings';
      if (arrType === 'sonarr') return 'sonarr_media_settings';
      if (arrType === 'lidarr') return 'lidarr_media_settings';
      return null;
    case 'qualityDefinitions':
      if (arrType === 'radarr') return 'radarr_quality_definitions';
      if (arrType === 'sonarr') return 'sonarr_quality_definitions';
      if (arrType === 'lidarr') return 'lidarr_quality_definitions';
      return null;
    case 'lidarrMetadataProfile':
      return arrType === 'lidarr' ? 'metadata_profile' : null;
    default: {
      const exhaustiveCheck: never = entityType;
      return exhaustiveCheck;
    }
  }
}

interface ParsedOpMetadata {
  entity?: string;
  name?: string;
}

/** Defensive JSON parse mirroring `draftChanges.ts::parseJson` -- unknown/malformed metadata is not an error, just uncorrelated. */
function parseOpMetadata(raw: string | null): ParsedOpMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ParsedOpMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

/** `(entityType, arrType, name) -> hasPendingConflict` lookup returned by `buildPendingConflictIndex`. */
export type PendingConflictLookup = (
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
) => boolean;

/**
 * Runs `pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId)` ONCE and returns a
 * lookup closure over the parsed result, instead of re-running that query on every
 * `computeHasPendingConflict` call (an O(n) query pattern when checking many entities for
 * the same `databaseId`, e.g. the list endpoint's per-entity loop). Callers that need to
 * check many `(entityType, arrType, name)` combinations for the same `databaseId` should
 * call this once and reuse the returned closure.
 *
 * Preserves `computeHasPendingConflict`'s exact matching semantics (Business Rule 6): an
 * unmapped `(entityType, arrType)` combination or unparsable op metadata resolves to
 * `false`; a match requires `metadata.entity === resolveOpMetadataEntity(entityType,
 * arrType)` AND `metadata.name === name` on at least one `conflicted`/`conflicted_pending`
 * op, per `draftChanges.ts`'s correlation precedent.
 */
export function buildPendingConflictIndex(databaseId: number): PendingConflictLookup {
  const conflicts = pcdOpHistoryQueries.listLatestConflictsByDatabase(databaseId);
  const parsedMetadata: ParsedOpMetadata[] = [];
  for (const conflict of conflicts) {
    const metadata = parseOpMetadata(conflict.op.metadata);
    if (metadata) {
      parsedMetadata.push(metadata);
    }
  }

  return (entityType, arrType, name) => {
    const metadataEntity = resolveOpMetadataEntity(entityType, arrType);
    if (!metadataEntity) return false;

    return parsedMetadata.some((metadata) => metadata.entity === metadataEntity && metadata.name === name);
  };
}

/**
 * Business Rule 6: an entity with a pending value-guard conflict must never present an
 * unambiguous resolved value. Thin per-call wrapper around `buildPendingConflictIndex`
 * (see its doc for matching semantics) -- callers checking a SINGLE entity (e.g.
 * `resolveLayerState`) use this; callers checking MANY entities for the same
 * `databaseId` (e.g. a list endpoint) should call `buildPendingConflictIndex` once
 * instead, to avoid re-running the underlying query per entity.
 *
 * Exported (in addition to being used internally by `resolveLayerState`) so the named
 * endpoint (`routes/.../resolved/[entityType]/[name]/+server.ts`) can compute this
 * directly.
 */
export function computeHasPendingConflict(
  databaseId: number,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): boolean {
  return buildPendingConflictIndex(databaseId)(entityType, arrType, name);
}

// ============================================================================
// LAYER STATE RESOLUTION
// ============================================================================

export interface ResolveLayerStateInput {
  readonly databaseId: number;
  readonly entityType: ResolvedEntityType;
  readonly arrType: ArrAppType | undefined;
  readonly name: string;
  readonly layer: ResolvedLayer;
}

export interface ResolvedLayerResolvedState {
  readonly layer: 'resolved';
  readonly present: true;
  readonly entity: ResolvedEntityPayload;
  readonly hasPendingConflict: boolean;
}

export interface ResolvedLayerBaseState {
  readonly layer: 'base';
  readonly present: boolean;
  readonly entity: ResolvedEntityPayload | null;
  readonly hasPendingConflict: boolean;
}

export interface ResolvedLayerUserState {
  readonly layer: 'user';
  readonly present: boolean;
  readonly overrides: FieldChange[];
  readonly hasPendingConflict: boolean;
}

/** Discriminated (by `layer`) result of `resolveLayerState`. */
export type ResolvedLayerState = ResolvedLayerResolvedState | ResolvedLayerBaseState | ResolvedLayerUserState;

/**
 * Reads a resolved-config entity by name via `cache`, returning `null` ONLY on a typed
 * `ResolvedEntityNotFoundError` miss (`readResolvedEntity`'s `invokeReader` rewraps a
 * `serialize.ts` by-name miss into this type -- see `readers.ts`). Every OTHER error --
 * `ResolvedConfigValidationError` (bad/missing arrType, unmapped entityType) as well as
 * any other failure (e.g. a genuine PCD cache/schema failure) -- is rethrown unchanged.
 * Swallowing anything broader than `ResolvedEntityNotFoundError` here would mask a real
 * cache failure as "entity absent", which is the bug this narrow catch fixes.
 */
export async function readEntityOrNull(
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): Promise<ResolvedEntityPayload | null> {
  try {
    return await readResolvedEntity(cache, entityType, arrType, name);
  } catch (error) {
    if (isResolvedEntityNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolves a single entity's state at the requested `layer`, composing the readers
 * dispatch table, the base-only ephemeral cache, and the Portable-field diff above.
 *
 * - `layer: 'resolved'` reads from the registered (fully-resolved) cache via the
 *   registry -- a hard not-found miss propagates unwrapped so the caller (route) can
 *   map it to 404, matching `layer=resolved`'s existing 404 semantics.
 * - `layer: 'base'` reads from an ephemeral base-only cache (`withBaseOnlyCache`);
 *   absence there is not an error -- it's `{ present: false, entity: null }`.
 * - `layer: 'user'` reads BOTH caches and diffs them. An entity absent from base but
 *   present in resolved is a pure user-created entity: `present: true` with overrides
 *   computed against an absent (`null`) base (see `computeUserOverrides`'s doc). An
 *   entity absent from BOTH layers is a genuine not-found miss and propagates
 *   unwrapped, same as `layer: 'resolved'`.
 *
 * Every branch carries `hasPendingConflict` (Business Rule 6), computed once per call.
 */
export async function resolveLayerState(input: ResolveLayerStateInput): Promise<ResolvedLayerState> {
  const { databaseId, entityType, arrType, name, layer } = input;
  const hasPendingConflict = computeHasPendingConflict(databaseId, entityType, arrType, name);

  if (layer === 'resolved') {
    const cache = getCache(databaseId);
    if (!cache?.isBuilt()) {
      throw new Error(`Database ${databaseId} cache is not built`);
    }

    const entity = await readResolvedEntity(cache, entityType, arrType, name);
    return { layer: 'resolved', present: true, entity, hasPendingConflict };
  }

  if (layer === 'base') {
    return withBaseOnlyCache(databaseId, async (baseCache) => {
      const entity = await readEntityOrNull(baseCache, entityType, arrType, name);
      return { layer: 'base', present: entity !== null, entity, hasPendingConflict };
    });
  }

  const cache = getCache(databaseId);
  if (!cache?.isBuilt()) {
    throw new Error(`Database ${databaseId} cache is not built`);
  }
  const resolvedEntity = await readEntityOrNull(cache, entityType, arrType, name);

  return withBaseOnlyCache(databaseId, async (baseCache) => {
    const baseEntity = await readEntityOrNull(baseCache, entityType, arrType, name);

    if (resolvedEntity === null && baseEntity === null) {
      throw new ResolvedEntityNotFoundError(entityType, arrType, name);
    }

    return {
      layer: 'user',
      present: resolvedEntity !== null,
      overrides: computeUserOverrides(baseEntity, resolvedEntity),
      hasPendingConflict,
    };
  });
}
