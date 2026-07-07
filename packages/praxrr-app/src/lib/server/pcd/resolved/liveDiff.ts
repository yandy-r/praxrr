/**
 * Resolved Config Live Diff
 *
 * Read-only wrapper around `$sync/preview/orchestrator.ts`'s `generatePreview()` that
 * answers a single question: "for this one resolved-config entity, does the live Arr
 * instance already match the desired (resolved) state?" It reuses the existing preview
 * diff engine verbatim -- `EntityChange.fields` is already the answer, so this module
 * never re-diffs -- and only adds entity-type -> sync-section mapping plus per-entity
 * lookup inside the returned section payload.
 *
 * Sanitized-reason discipline (mirrors `testConnectionReason.ts`): raw `error.message`
 * text never appears in a `computeLiveDiff` result. Full detail is logged server-side
 * via `logger.error`; callers only ever see a closed `LiveDiffReason` string.
 *
 * Pure given inputs: takes the already-fetched `ArrInstance` row, performs no DB
 * writes, and never calls `arrNamespaceQueries.getOrCreate` (namespace matching here is
 * the pure, read-only `findNamespaceMatch`).
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { findNamespaceMatch } from '$sync/namespace.ts';
import { isSyncSectionSupported, type SyncArrType } from '$sync/mappings.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange, SyncPreviewSectionResult } from '$sync/preview/types.ts';
import type { SectionType } from '$sync/types.ts';
import type { ResolvedEntityType } from './types.ts';

const SOURCE = 'LiveDiff';

// ============================================================================
// RESULT SHAPE
// ============================================================================

/**
 * Closed, sanitized failure-reason union. Follows `testConnectionReason.ts`'s shape:
 * network/HTTP-derived reasons from a pure mapping helper, plus two live-diff-specific
 * values -- `unsupported` (entity type has no sync section, or the section/arr-type
 * combination is unsupported) and `not_found` (the preview ran successfully but the
 * requested entity is absent from the returned section payload).
 */
export type LiveDiffReason =
  'unreachable' | 'timeout' | 'unauthorized' | 'invalid_response' | 'unsupported' | 'not_found' | 'error';

/** Discriminated result: either the located `EntityChange`, or a sanitized failure reason. */
export type LiveDiffResult =
  { readonly found: true; readonly change: EntityChange } | { readonly found: false; readonly reason: LiveDiffReason };

/**
 * Injectable preview generator. `generatePreview` is a bare named function export (not
 * a property of an exported const object), so it cannot be monkey-patched from a test
 * file the way `logger.error`/`db.query` are in `tests/pcd/snapshots/service.test.ts` --
 * ESM import bindings are read-only for importers. Tests instead pass a stub via
 * `deps.generatePreview`.
 */
export interface LiveDiffDeps {
  readonly generatePreview: typeof generatePreview;
}

const defaultDeps: LiveDiffDeps = { generatePreview };

export interface ComputeLiveDiffInput {
  readonly instance: ArrInstance;
  readonly entityType: ResolvedEntityType;
  readonly name: string;
  readonly nowMs?: number;
  readonly deps?: LiveDiffDeps;
}

// ============================================================================
// ENTITY TYPE -> SYNC SECTION MAPPING
// ============================================================================

/**
 * `regularExpression` has no sync-preview section counterpart -- there is nothing to
 * check it against live, so it maps to `null` and callers must short-circuit to the
 * `unsupported` reason before any gating or preview call.
 */
function mapEntityTypeToSection(entityType: ResolvedEntityType): SectionType | null {
  switch (entityType) {
    case 'qualityProfile':
    case 'customFormat':
      return 'qualityProfiles';
    case 'delayProfile':
      return 'delayProfiles';
    case 'naming':
    case 'mediaSettings':
    case 'qualityDefinitions':
      return 'mediaManagement';
    case 'lidarrMetadataProfile':
      return 'metadataProfiles';
    case 'regularExpression':
      return null;
    default: {
      const exhaustiveCheck: never = entityType;
      return exhaustiveCheck;
    }
  }
}

/** Narrows the loosely-typed `ArrInstance.type` column to a sync-capable arr type. */
function narrowSyncArrType(type: string): SyncArrType | null {
  if (type === 'radarr' || type === 'sonarr' || type === 'lidarr') {
    return type;
  }

  return null;
}

// ============================================================================
// REASON MAPPING
// ============================================================================

/** Pure error -> sanitized reason mapping, mirroring `testConnectionReason.ts::toFailureReason`. */
function mapErrorToLiveDiffReason(error: unknown): LiveDiffReason {
  const message = error instanceof Error ? error.message : '';

  if (/timeout/i.test(message)) return 'timeout';
  if (/HTTP 401|HTTP 403/i.test(message)) return 'unauthorized';
  if (/HTTP \d/i.test(message)) return 'invalid_response';
  return 'unreachable';
}

/** Same mapping, applied to a section-outcome error string (already extracted from an Error). */
function reasonForFailedSection(errorMessage: string): LiveDiffReason {
  return mapErrorToLiveDiffReason(new Error(errorMessage));
}

// ============================================================================
// SECTION PAYLOAD ACCESS
// ============================================================================

function getSectionResult(preview: GeneratePreviewResult, section: SectionType): SyncPreviewSectionResult | null {
  switch (section) {
    case 'qualityProfiles':
      return preview.qualityProfiles;
    case 'delayProfiles':
      return preview.delayProfiles;
    case 'mediaManagement':
      return preview.mediaManagement;
    case 'metadataProfiles':
      return preview.metadataProfiles;
  }
}

/** Namespace-aware array lookup shared by every collection-shaped section payload. */
function findByNamespace(entities: readonly EntityChange[], name: string): EntityChange | null {
  const match = findNamespaceMatch(
    name,
    entities.map((entity) => entity.name)
  );
  if (!match) {
    return null;
  }

  return entities[match.index];
}

/**
 * Locates the requested entity's `EntityChange` inside the section payload returned by
 * `generatePreview`. Arrays (`qualityProfiles.qualityProfiles`/`.customFormats`,
 * `mediaManagement.qualityDefinitions`) use namespace-aware `.find()`; singletons
 * (`delayProfiles.profile`, `mediaManagement.naming`/`.mediaSettings`,
 * `metadataProfiles.profile`) are direct field access -- there is exactly one such
 * entity per instance, so no name matching applies. The `EntityChange` is returned
 * as-is; its `.fields` is already the diff.
 */
function locateEntityChange(
  entityType: ResolvedEntityType,
  sectionResult: SyncPreviewSectionResult,
  name: string
): EntityChange | null {
  switch (sectionResult.section) {
    case 'qualityProfiles':
      if (entityType === 'customFormat') return findByNamespace(sectionResult.customFormats, name);
      if (entityType === 'qualityProfile') return findByNamespace(sectionResult.qualityProfiles, name);
      return null;
    case 'delayProfiles':
      return sectionResult.profile;
    case 'mediaManagement':
      if (entityType === 'naming') return sectionResult.naming;
      if (entityType === 'mediaSettings') return sectionResult.mediaSettings;
      if (entityType === 'qualityDefinitions') return findByNamespace(sectionResult.qualityDefinitions, name);
      return null;
    case 'metadataProfiles':
      return sectionResult.profile;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Computes the live diff for a single resolved-config entity against one Arr instance.
 *
 * Order of operations: (1) map `entityType` to a sync `SectionType`, short-circuiting
 * unmapped types (`regularExpression`) to `{ reason: 'unsupported' }` before touching
 * the network; (2) narrow `instance.type` to a `SyncArrType`, rejecting `'all'`-style
 * values as unsupported; (3) gate with `isSyncSectionSupported` -- an unsupported
 * (arrType, section) combination never produces a misleading empty diff; (4) call
 * `generatePreview` for just that one section; (5) locate the entity inside the
 * returned section payload and return its `EntityChange` unchanged.
 */
export async function computeLiveDiff(input: ComputeLiveDiffInput): Promise<LiveDiffResult> {
  const { instance, entityType, name, nowMs, deps = defaultDeps } = input;

  const section = mapEntityTypeToSection(entityType);
  if (!section) {
    return { found: false, reason: 'unsupported' };
  }

  const arrType = narrowSyncArrType(instance.type);
  if (!arrType) {
    return { found: false, reason: 'unsupported' };
  }

  if (!isSyncSectionSupported(arrType, section)) {
    return { found: false, reason: 'unsupported' };
  }

  let preview: GeneratePreviewResult;
  try {
    preview = await deps.generatePreview({ instance, sections: [section], nowMs });
  } catch (error) {
    await logger.error('Live diff preview generation failed', {
      source: SOURCE,
      meta: {
        instanceId: instance.id,
        instanceName: instance.name,
        entityType,
        name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { found: false, reason: mapErrorToLiveDiffReason(error) };
  }

  const outcome = preview.sectionOutcomes.find((sectionOutcome) => sectionOutcome.section === section);
  const sectionResult = getSectionResult(preview, section);

  if (!sectionResult) {
    if (outcome?.error) {
      await logger.error('Live diff section failed', {
        source: SOURCE,
        meta: {
          instanceId: instance.id,
          instanceName: instance.name,
          section,
          error: outcome.error,
        },
      });
      return { found: false, reason: reasonForFailedSection(outcome.error) };
    }

    return { found: false, reason: 'error' };
  }

  const change = locateEntityChange(entityType, sectionResult, name);
  if (!change) {
    return { found: false, reason: 'not_found' };
  }

  return { found: true, change };
}
