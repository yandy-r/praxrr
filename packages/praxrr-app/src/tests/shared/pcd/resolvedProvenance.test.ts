import { assertEquals, assertFalse } from '@std/assert';

import { explainResolvedProvenance } from '$shared/pcd/resolvedProvenance.ts';

Deno.test('resolved provenance identifies base-side evidence and zero overrides', () => {
  assertEquals(
    explainResolvedProvenance({
      basePresent: true,
      resolvedPresent: true,
      overrides: null,
      hasPendingConflict: false,
    }).kind,
    'base-side'
  );
  assertEquals(
    explainResolvedProvenance({
      basePresent: null,
      resolvedPresent: true,
      overrides: [],
      hasPendingConflict: false,
    }).kind,
    'base-side'
  );
});

Deno.test('resolved provenance identifies a user-created entity only from base absence', () => {
  const explanation = explainResolvedProvenance({
    basePresent: false,
    resolvedPresent: true,
    overrides: [{ field: 'name', type: 'added' }],
    hasPendingConflict: false,
  });

  assertEquals(explanation.kind, 'user-created');
  assertEquals(explanation.label, 'User-created');
});

Deno.test('resolved provenance preserves nested field override evidence', () => {
  const explanation = explainResolvedProvenance({
    basePresent: null,
    resolvedPresent: true,
    overrides: [{ field: 'orderedItems["Bluray-1080p"].members[0].enabled', type: 'changed' }],
    hasPendingConflict: false,
  });

  assertEquals(explanation.kind, 'user-override');
  assertEquals(explanation.detail, '1 field difference is recorded relative to the base-side layer.');
});

// The entity-level explainer is deliberately coarse: it must NEVER attribute a value to a
// schema/database default or an exact establishing op — that granular claim is owned by the
// field-level lineage surface (issue #231). Absence of a user override is not evidence of a
// default, so no branch may infer one.
function assertNoDefaultOrExactOpClaim(text: string): void {
  const lower = text.toLowerCase();
  assertFalse(lower.includes('database default'), 'must not claim a database default');
  assertFalse(lower.includes('schema default'), 'must not claim a schema default');
  assertFalse(lower.includes('schema-default'), 'must not name the schema-default source');
  assertFalse(/\bop\b|\bop #/.test(lower), 'must not name an exact establishing op');
}

Deno.test('resolved provenance withholds claims when evidence is missing', () => {
  const explanation = explainResolvedProvenance({
    basePresent: null,
    resolvedPresent: true,
    overrides: null,
    hasPendingConflict: false,
  });

  assertEquals(explanation.kind, 'unavailable');
  assertNoDefaultOrExactOpClaim(`${explanation.label} ${explanation.detail}`);
});

Deno.test('resolved provenance base-side match never infers a default from absence of overrides (AC7)', () => {
  // Base present + zero overrides: the resolved value matches base-side evidence, but the
  // entity-level explainer must still refuse to attribute it to a database default or exact op.
  const explanation = explainResolvedProvenance({
    basePresent: true,
    resolvedPresent: true,
    overrides: [],
    hasPendingConflict: false,
  });

  assertEquals(explanation.kind, 'base-side');
  assertNoDefaultOrExactOpClaim(`${explanation.label} ${explanation.detail}`);
});

Deno.test('pending conflict takes precedence over otherwise conclusive evidence', () => {
  const explanation = explainResolvedProvenance({
    basePresent: false,
    resolvedPresent: true,
    overrides: [{ field: 'name', type: 'added' }],
    hasPendingConflict: true,
  });

  assertEquals(explanation.kind, 'pending-conflict');
  assertEquals(explanation.label, 'Provenance ambiguous');
});
