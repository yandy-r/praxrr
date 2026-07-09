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

Deno.test('resolved provenance withholds claims when evidence is missing', () => {
  const explanation = explainResolvedProvenance({
    basePresent: null,
    resolvedPresent: true,
    overrides: null,
    hasPendingConflict: false,
  });

  assertEquals(explanation.kind, 'unavailable');
  assertFalse(`${explanation.label} ${explanation.detail}`.toLowerCase().includes('database default'));
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
