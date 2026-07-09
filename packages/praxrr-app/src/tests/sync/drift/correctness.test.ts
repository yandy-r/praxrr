/**
 * Drift correctness tests (design §10 "Correctness tests").
 *
 * These are the load-bearing tests the drift risks demand. They live in the
 * aggregation/signature layer (`aggregateDrift`, `driftSignature`) — the code we own —
 * and deliberately treat `generatePreview` as a black box we REUSE. Wherever a property
 * actually belongs to that reused engine (namespace correlation, keyed-array reorder
 * equality) the comments call it out, and the assertion pins only the drift-layer
 * guarantee: given an engine verdict, aggregation classifies it correctly and never
 * invents/erases drift.
 */

import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { aggregateDrift, driftSignature } from '$sync/drift/check.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type {
  EntityChange,
  QualityProfilesPreview,
  SyncPreviewAction,
  SyncPreviewSection,
  SyncPreviewSectionOutcome,
} from '$sync/preview/types.ts';
import { getNamespaceIndex, getNamespaceSuffix, hasNamespaceSuffix, stripNamespaceSuffix } from '$sync/namespace.ts';

// ---------------------------------------------------------------------------
// Builders — minimal, typed GeneratePreviewResult fixtures.
// ---------------------------------------------------------------------------

const QP_SECTIONS = new Set<SyncPreviewSection>(['qualityProfiles']);

/** A `qualityProfiles` section outcome that RAN and succeeded (so `comparedAny` is true). */
const QP_OK_OUTCOME: SyncPreviewSectionOutcome = {
  section: 'qualityProfiles',
  error: null,
  skipped: false,
};

function makeEntityChange(fields: {
  name: string;
  action: SyncPreviewAction;
  entityType?: string;
  remoteId?: number | null;
  fields?: EntityChange['fields'];
}): EntityChange {
  return {
    entityType: fields.entityType ?? 'customFormat',
    name: fields.name,
    action: fields.action,
    remoteId: fields.remoteId ?? null,
    fields: fields.fields ?? [],
  };
}

function makeQualityProfilesPreview(
  customFormats: readonly EntityChange[],
  qualityProfiles: readonly EntityChange[] = []
): QualityProfilesPreview {
  return { section: 'qualityProfiles', customFormats, qualityProfiles };
}

function makePreview(qualityProfiles: QualityProfilesPreview | null): GeneratePreviewResult {
  return {
    instanceId: 1,
    instanceName: 'Test',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: ['qualityProfiles'],
    sectionOutcomes: [QP_OK_OUTCOME],
    qualityProfiles,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    errors: [],
  };
}

function makeDriftChange(fields: { name: string; remoteId: number | null; entityType?: string }): DriftEntityChange {
  return {
    section: 'qualityProfiles',
    entityType: fields.entityType ?? 'customFormat',
    name: fields.name,
    action: 'update',
    category: 'drift',
    remoteId: fields.remoteId,
    fields: [],
  };
}

// ===========================================================================
// (1) Namespace correlation.
//
// generatePreview already correlates a live namespace-suffixed entity against its
// desired counterpart (via findNamespaceMatch) BEFORE it emits an EntityChange, so a
// correlated entity arrives as action 'unchanged'. Drift REUSES that verdict verbatim
// — it does no namespace matching of its own and, critically, never re-suffixes the
// name. These two tests pin: 'unchanged' → no drift, and a genuine field change →
// drift with the name passed through untouched (exactly one suffix).
// ===========================================================================

Deno.test('drift: namespace-suffixed entity correlated as unchanged does NOT surface as drift', () => {
  const suffix = getNamespaceSuffix(1);
  const suffixedName = 'HDR10+' + suffix;

  // generatePreview matched this live CF to its desired counterpart across the
  // namespace suffix and marked it unchanged. Drift must treat it as in-sync.
  const preview = makePreview(
    makeQualityProfilesPreview([makeEntityChange({ name: suffixedName, action: 'unchanged', remoteId: 42 })])
  );

  const result = aggregateDrift(preview, QP_SECTIONS);

  assertEquals(result.changes.length, 0);
  assertEquals(result.counts, { drifted: 0, missing: 0, unmanaged: 0 });
  // The section ran and produced a successful diff — this is a real "no drift", not a
  // degraded/errored pass.
  assertEquals(result.comparedAny, true);
  assertEquals(result.allSectionsErrored, false);
  assertEquals(driftSignature(result.changes), null);
});

Deno.test('drift: genuine field change on a suffixed entity IS drift, name passed through (no double-suffix)', () => {
  const suffix = getNamespaceSuffix(1);
  const suffixedName = 'HDR10+' + suffix;

  const preview = makePreview(
    makeQualityProfilesPreview([
      makeEntityChange({
        name: suffixedName,
        action: 'update',
        remoteId: 42,
        fields: [{ field: 'score', type: 'changed', current: 100, desired: 200 }],
      }),
    ])
  );

  const result = aggregateDrift(preview, QP_SECTIONS);

  assertEquals(result.changes.length, 1);
  assertEquals(result.counts.drifted, 1);

  const change = result.changes[0];
  // Drift copies EntityChange.name verbatim; it does not append a suffix of its own.
  assertEquals(change.name, suffixedName);
  assert(hasNamespaceSuffix(change.name));
  assertEquals(stripNamespaceSuffix(change.name), 'HDR10+');
  // Index === 1 proves exactly ONE namespace char is present. A double-suffix
  // (drift re-appending getNamespaceSuffix(1)) would read back as overflow index 6.
  assertEquals(getNamespaceIndex(change.name), 1);

  // Field-level diff direction (current = LIVE, desired = PCD) is preserved verbatim.
  assertEquals(change.fields[0], { field: 'score', type: 'changed', current: 100, desired: 200 });
  assertNotEquals(driftSignature(result.changes), null);
});

// ===========================================================================
// (2) Cross-DB same display name.
//
// The signature token is remoteId-qualified: `section|entityType|name|remoteId|action`.
// Two managed entities that share an identical display name but live at different
// remoteIds (e.g. the "same" CF surfaced from two linked databases) must therefore
// produce DISTINCT tokens so the notification dedup key cannot collapse them into one.
// driftSignature only exposes a hash, so distinctness is proven by contrast: identical
// name with DIFFERING remoteIds hashes differently than the same name with EQUAL
// remoteIds — which is only possible if remoteId is part of each token.
// ===========================================================================

Deno.test('drift signature: same display name + different remoteId yields distinct, non-collapsing tokens', () => {
  const name = 'HDR10+'; // identical display name for both entities
  const a = makeDriftChange({ name, remoteId: 10 });
  const bDistinct = makeDriftChange({ name, remoteId: 20 });
  const bCollapsed = makeDriftChange({ name, remoteId: 10 }); // identical to `a`

  const sigDistinct = driftSignature([a, bDistinct]);
  const sigCollapsed = driftSignature([a, bCollapsed]);

  assertNotEquals(sigDistinct, null);
  assertNotEquals(sigCollapsed, null);
  // If remoteId were NOT part of the token these two would hash identically (both are
  // "HDR10+" updates). They differ → the two same-name entities are represented by two
  // distinct tokens and cannot collapse.
  assertNotEquals(sigDistinct, sigCollapsed);

  // And each same-name entity independently contributes to the signature.
  assertNotEquals(driftSignature([a, bDistinct]), driftSignature([a]));
  assertNotEquals(driftSignature([a, bDistinct]), driftSignature([bDistinct]));
});

// ===========================================================================
// (3) Keyed-array reorder is not a false positive.
//
// Whether a reordered-but-equal keyed array (formatItems, qualities, specifications…)
// counts as "equal" is a property of the REUSED diff engine (sectionDiffs), not the
// drift layer — the real engine emits action 'unchanged' for such an entity. Drift's
// own guarantee, pinned here, is narrower: an 'unchanged' entity NEVER becomes an
// 'update' drift, so drift can never manufacture a false positive out of a verdict the
// engine already resolved as equal.
// ===========================================================================

Deno.test('drift: an entity the diff engine resolved as unchanged (reordered-but-equal array) yields no drift', () => {
  // Stand-in for a quality profile whose keyed array was reordered on the Arr but is
  // set-equal to desired; generatePreview would emit this as 'unchanged'.
  const reorderedButEqual = makeEntityChange({
    entityType: 'qualityProfile',
    name: 'HD Bluray + WEB',
    action: 'unchanged',
    remoteId: 7,
  });

  const preview = makePreview(makeQualityProfilesPreview([], [reorderedButEqual]));

  const result = aggregateDrift(preview, QP_SECTIONS);

  assertEquals(result.changes.length, 0);
  assertEquals(result.counts, { drifted: 0, missing: 0, unmanaged: 0 });
  assertEquals(result.comparedAny, true);
  assertEquals(driftSignature(result.changes), null);
});
