/**
 * Resolved Config Cross-Instance Comparison
 *
 * Answers "how does this resolved-config entity's desired (transformed) payload compare
 * across multiple Arr instances, and optionally, how does each instance's live state
 * compare to that desired payload?" It composes the readers dispatch table
 * (`readers.ts`), the sync-section support gate (`$sync/mappings.ts`), the live-diff
 * wrapper (`liveDiff.ts`), and the Portable-field diff engine (`layerDiff.ts`'s
 * `PORTABLE_ARRAY_KEY_STRATEGIES`) -- it never re-implements any of them.
 *
 * Design decisions (see feature-spec.md's `CrossInstanceComparisonResponse` contract):
 *
 * 1. `compatible` reflects BOTH reader-table support (can this arr_type even produce a
 *    desired payload for this entity type?) AND sync-section support (does the arr_type
 *    support the section this entity type maps to?). `regularExpression` has no sync
 *    section at all (see `liveDiff.ts`'s `mapEntityTypeToSection`) -- it is treated as an
 *    explicit exception: reader support alone makes it `compatible`, since its desired
 *    payload is read straight from the PCD cache and never depends on sync-preview
 *    machinery. Live checks against it still resolve to `unsupported` per-instance (see
 *    `computeLiveDiff`'s own short-circuit), which is a normal `includeLive` outcome, not
 *    a `compatible: false` gate.
 * 2. `CompareReason` is a LOCAL closed union, deliberately duplicated rather than
 *    imported from `liveDiff.ts` (per the parallel-plan's task-independence mandate). It
 *    is a superset of the already-authored OpenAPI `ResolvedInstanceState.error` enum
 *    (`unreachable|timeout|unauthorized|invalid_response|unsupported|not_found`) plus
 *    `not_configured` (mirrors `liveDiff.ts`'s `LiveDiffReason` -- a live section with no
 *    sync configuration on the instance) and three comparison-specific values this module
 *    also needs (`incompatible` -- unrecognized `arr_type`; `rate-limited` -- per-instance
 *    live fetch throttled; `error` -- unexpected failure, detail logged not surfaced). The
 *    route layer (Task 3.3) owns reconciling this superset with the wire enum.
 * 3. `actual` on a compatible+present instance is the located `EntityChange` returned by
 *    `computeLiveDiff` (its `.fields` is already the live-vs-desired diff) -- NOT the raw
 *    upstream Arr payload the OpenAPI schema's free-form `additionalProperties: true`
 *    shape implies. `computeLiveDiff` never exposes raw entity state, only the diff, so
 *    this is the most information-preserving mapping available without redesigning
 *    `liveDiff.ts`.
 * 4. Desired-payload reads are memoized: arr-agnostic entity types read the shared cache
 *    exactly once (their payload does not depend on `arr_type`); per-arr entity types
 *    read once per distinct `arr_type` present in `instances` and share the result across
 *    same-`arr_type` instances.
 * 5. Per-instance failures are always inline `error`/`compatible` statuses -- this
 *    function never throws for a single bad instance. Raw error text never escapes; full
 *    detail goes to `logger.error` only.
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { isArrAppType, type ArrAppType } from '$shared/arr/capabilities.ts';
import { isSyncSectionSupported } from '$sync/mappings.ts';
import { diffToFieldChanges } from '$sync/preview/diff.ts';
import type { EntityChange, FieldChange } from '$sync/preview/types.ts';
import { registerPreviewCreateAttempt } from '$sync/preview/limits.ts';
import type { SectionType } from '$sync/types.ts';
import type { PCDCache } from '../database/cache.ts';
import { computeLiveDiff, type LiveDiffReason } from './liveDiff.ts';
import { PORTABLE_ARRAY_KEY_STRATEGIES } from './layerDiff.ts';
import {
  ARR_AGNOSTIC_READERS,
  isResolvedConfigValidationError,
  PER_ARR_READERS,
  readResolvedEntity,
} from './readers.ts';
import type { PerArrEntityType, ResolvedEntityPayload, ResolvedEntityType } from './types.ts';

const SOURCE = 'ResolvedConfigCompare';

// ============================================================================
// RESULT SHAPE
// ============================================================================

/**
 * Closed, sanitized failure/incompatibility reason union -- see module doc point 2 for
 * why this duplicates rather than imports `liveDiff.ts`'s `LiveDiffReason`.
 */
export type CompareReason =
  | 'incompatible'
  | 'unsupported'
  | 'not_configured'
  | 'rate-limited'
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'invalid_response'
  | 'error'
  | 'not_found';

/**
 * Per-instance desired (and optionally live) state -- maps to `ResolvedInstanceState`.
 *
 * `arrType` is narrowed to `ArrAppType | null`: `null` only for the `incompatible` case
 * (an unrecognized `arr_type` value on the instance row), with the original raw value
 * preserved separately on `rawArrType` for logging/diagnostics -- the wire schema's
 * `arrType` is a closed `radarr|sonarr|lidarr` enum, so an unrecognized value must never
 * flow through as a plain `string`.
 */
export interface CompareInstanceResult {
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: ArrAppType | null;
  readonly rawArrType?: string;
  readonly compatible: boolean;
  readonly present: boolean;
  readonly desired: ResolvedEntityPayload | null;
  readonly actual: EntityChange | null;
  readonly error: CompareReason | null;
}

/** Pairwise diff of one compatible+present instance's desired payload against the baseline. */
export interface CompareDiffRow {
  readonly instanceId: number;
  readonly changes: readonly EntityChange[];
}

export interface CompareAcrossInstancesResult {
  readonly databaseId: number;
  readonly entityType: ResolvedEntityType;
  readonly name: string;
  readonly instances: readonly CompareInstanceResult[];
  readonly diffs: readonly CompareDiffRow[];
}

/**
 * Injectable dependencies. `computeLiveDiff` and `registerPreviewCreateAttempt` are bare
 * named function exports (not properties of an exported const object), so they cannot be
 * monkey-patched from a test file the way `logger.error` is -- ESM import bindings are
 * read-only for importers. Tests supply stubs via `deps`.
 */
export interface CompareDeps {
  readonly computeLiveDiff: typeof computeLiveDiff;
  readonly registerPreviewCreateAttempt: typeof registerPreviewCreateAttempt;
}

const defaultDeps: CompareDeps = { computeLiveDiff, registerPreviewCreateAttempt };

export interface CompareAcrossInstancesInput {
  readonly cache: PCDCache;
  readonly databaseId: number;
  readonly entityType: ResolvedEntityType;
  readonly name: string;
  readonly instances: readonly ArrInstance[];
  readonly includeLive: boolean;
  readonly nowMs?: number;
  readonly deps?: CompareDeps;
}

// ============================================================================
// ENTITY TYPE -> SYNC SECTION MAPPING (duplicated from liveDiff.ts -- module-private there)
// ============================================================================

/**
 * `regularExpression` intentionally has no entry -- see module doc point 1: its desired
 * payload is comparable without any sync-section counterpart.
 */
const ENTITY_TYPE_TO_SYNC_SECTION: Partial<Record<ResolvedEntityType, SectionType>> = {
  qualityProfile: 'qualityProfiles',
  customFormat: 'qualityProfiles',
  delayProfile: 'delayProfiles',
  naming: 'mediaManagement',
  mediaSettings: 'mediaManagement',
  qualityDefinitions: 'mediaManagement',
  lidarrMetadataProfile: 'metadataProfiles',
};

function isSectionSupportedForEntityType(entityType: ResolvedEntityType, arrType: ArrAppType): boolean {
  const section = ENTITY_TYPE_TO_SYNC_SECTION[entityType];
  if (!section) return true;
  return isSyncSectionSupported(arrType, section);
}

function isPerArrEntityType(entityType: ResolvedEntityType): entityType is PerArrEntityType {
  return Object.hasOwn(PER_ARR_READERS, entityType);
}

/** Combines reader-table support and sync-section support -- see module doc point 1. */
function isEntityCompatibleWithArrType(
  entityType: ResolvedEntityType,
  arrType: ArrAppType,
  isArrAgnostic: boolean
): boolean {
  const readerSupported = isArrAgnostic
    ? true
    : isPerArrEntityType(entityType) && Boolean(PER_ARR_READERS[entityType][arrType]);

  return readerSupported && isSectionSupportedForEntityType(entityType, arrType);
}

// ============================================================================
// REASON MAPPING
// ============================================================================

function mapLiveDiffReasonToCompareReason(reason: LiveDiffReason): CompareReason {
  switch (reason) {
    case 'unreachable':
      return 'unreachable';
    case 'timeout':
      return 'timeout';
    case 'unauthorized':
      return 'unauthorized';
    case 'invalid_response':
      return 'invalid_response';
    case 'unsupported':
      return 'unsupported';
    case 'not_found':
      return 'not_found';
    case 'not_configured':
      return 'not_configured';
    case 'error':
      return 'error';
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}

// ============================================================================
// RESULT BUILDERS
// ============================================================================

/**
 * Shared `compatible: false, error: 'unsupported'` result shape -- both the
 * reader/sync-section compatibility gate and the `'validation-error'` desired-read
 * outcome push this exact shape (see the two call sites in `compareAcrossInstances`);
 * factored out to avoid the duplicate literal.
 */
function buildUnsupportedInstanceResult(instance: ArrInstance, arrType: ArrAppType): CompareInstanceResult {
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType,
    compatible: false,
    present: false,
    desired: null,
    actual: null,
    error: 'unsupported',
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Compares one resolved-config entity's desired (and optionally live) state across
 * multiple Arr instances. Never throws for a single bad instance -- arr_type validation
 * failures, unsupported entity-type/arr combinations, not-found entities, rate-limited or
 * failed live fetches all degrade to an inline `CompareInstanceResult.error`/`compatible`
 * status rather than rejecting the whole comparison.
 */
export async function compareAcrossInstances(
  input: CompareAcrossInstancesInput
): Promise<CompareAcrossInstancesResult> {
  const { cache, databaseId, entityType, name, instances, includeLive, deps = defaultDeps } = input;
  const nowMs = input.nowMs ?? Date.now();

  const isArrAgnostic = Object.hasOwn(ARR_AGNOSTIC_READERS, entityType);

  // Desired-payload memoization -- see module doc point 4. Arr-agnostic types share one
  // cache slot; per-arr types share one slot per distinct arrType.
  const desiredCache = new Map<string, ResolvedEntityPayload | null | 'validation-error'>();

  async function getDesiredForArrType(arrType: ArrAppType): Promise<ResolvedEntityPayload | null | 'validation-error'> {
    const cacheKey = isArrAgnostic ? '__agnostic__' : arrType;
    const cached = desiredCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const payload = await readResolvedEntity(cache, entityType, isArrAgnostic ? undefined : arrType, name);
      desiredCache.set(cacheKey, payload);
      return payload;
    } catch (error) {
      if (isResolvedConfigValidationError(error)) {
        // Defensive only -- isEntityCompatibleWithArrType should have already gated this
        // combination out before getDesiredForArrType is ever called.
        await logger.error('Unexpected resolved-config validation error during compare desired read', {
          source: SOURCE,
          meta: { databaseId, entityType, arrType, name, error: error.message },
        });
        desiredCache.set(cacheKey, 'validation-error');
        return 'validation-error';
      }

      desiredCache.set(cacheKey, null);
      return null;
    }
  }

  const instanceResults: CompareInstanceResult[] = [];
  let baselineDesired: ResolvedEntityPayload | null = null;

  for (const instance of instances) {
    const rawArrType = instance.type;

    if (!isArrAppType(rawArrType)) {
      instanceResults.push({
        instanceId: instance.id,
        instanceName: instance.name,
        arrType: null,
        rawArrType,
        compatible: false,
        present: false,
        desired: null,
        actual: null,
        error: 'incompatible',
      });
      continue;
    }

    const arrType = rawArrType;

    if (!isEntityCompatibleWithArrType(entityType, arrType, isArrAgnostic)) {
      instanceResults.push(buildUnsupportedInstanceResult(instance, arrType));
      continue;
    }

    const desired = await getDesiredForArrType(arrType);

    if (desired === 'validation-error') {
      instanceResults.push(buildUnsupportedInstanceResult(instance, arrType));
      continue;
    }

    if (desired === null) {
      instanceResults.push({
        instanceId: instance.id,
        instanceName: instance.name,
        arrType,
        compatible: true,
        present: false,
        desired: null,
        actual: null,
        error: 'not_found',
      });
      continue;
    }

    if (baselineDesired === null) {
      baselineDesired = desired;
    }

    let actual: EntityChange | null = null;
    let liveError: CompareReason | null = null;

    if (includeLive) {
      try {
        const allowed = deps.registerPreviewCreateAttempt(instance.id, nowMs);
        if (!allowed) {
          liveError = 'rate-limited';
        } else {
          const liveResult = await deps.computeLiveDiff({ instance, entityType, name, nowMs });
          if (liveResult.found) {
            actual = liveResult.change;
          } else {
            liveError = mapLiveDiffReasonToCompareReason(liveResult.reason);
          }
        }
      } catch (error) {
        await logger.error('Unexpected error computing live diff during compare', {
          source: SOURCE,
          meta: {
            databaseId,
            instanceId: instance.id,
            entityType,
            name,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        liveError = 'error';
      }
    }

    instanceResults.push({
      instanceId: instance.id,
      instanceName: instance.name,
      arrType,
      compatible: true,
      present: true,
      desired,
      actual,
      error: liveError,
    });
  }

  const diffs: CompareDiffRow[] = [];

  if (baselineDesired !== null) {
    for (const result of instanceResults) {
      if (!result.compatible || !result.present || result.desired === null) continue;

      const fields: FieldChange[] = diffToFieldChanges(baselineDesired, result.desired, {
        arrayKeyStrategies: PORTABLE_ARRAY_KEY_STRATEGIES,
      });

      diffs.push({
        instanceId: result.instanceId,
        changes: [
          {
            entityType,
            name,
            action: fields.length > 0 ? 'update' : 'unchanged',
            remoteId: null,
            fields,
          },
        ],
      });
    }
  }

  return { databaseId, entityType, name, instances: instanceResults, diffs };
}
