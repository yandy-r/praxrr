// Pure classifier tests for `explainFieldLineage` + `foldPendingConflict` (issue #231). No cache.

import { assertEquals } from '@std/assert';
import { explainFieldLineage, foldPendingConflict, type EffectiveCell, type FieldLineage } from '$shared/pcd/fieldLineage.ts';

const baseCell: EffectiveCell = { sourceLayer: 'base', opId: 7, opRef: null, ambiguous: false };
const fileCell: EffectiveCell = { sourceLayer: 'tweaks', opId: null, opRef: { filename: '3.tweak.sql', order: 3 }, ambiguous: false };
const schemaDefault = { hasDefault: true, schemaFile: '0.schema.sql' };

Deno.test('explainFieldLineage: explicit writer -> ${layer}-op even when value equals default (AC3)', () => {
  const r = explainFieldLineage({ fieldPath: 'includeInRename', effectiveCell: baseCell, schemaDefault, valueMatchesDefault: true });
  assertEquals(r.status, 'resolved');
  assertEquals(r.sourceKind, 'base-op');
  assertEquals(r.sourceLayer, 'base');
  assertEquals(r.opId, 7);
  assertEquals(r.explicit, true);
  assertEquals(r.valueEqualsDefault, true);
});

Deno.test('explainFieldLineage: file-layer writer carries opRef, not opId', () => {
  const r = explainFieldLineage({ fieldPath: 'x', effectiveCell: fileCell, schemaDefault: undefined, valueMatchesDefault: undefined });
  assertEquals(r.sourceKind, 'tweaks-op');
  assertEquals(r.opId, null);
  assertEquals(r.opRef, { filename: '3.tweak.sql', order: 3 });
});

Deno.test('explainFieldLineage: ambiguous surviving writer makes no source claim (AC4)', () => {
  const r = explainFieldLineage({ fieldPath: 'x', effectiveCell: { ...baseCell, ambiguous: true }, schemaDefault, valueMatchesDefault: true });
  assertEquals(r.status, 'ambiguous');
  assertEquals(r.sourceKind, 'ambiguous');
  assertEquals(r.sourceLayer, null);
});

Deno.test('explainFieldLineage: no writer + value equals default -> schema-default (implicit)', () => {
  const r = explainFieldLineage({ fieldPath: 'includeInRename', effectiveCell: null, schemaDefault, valueMatchesDefault: true });
  assertEquals(r.status, 'resolved');
  assertEquals(r.sourceKind, 'schema-default');
  assertEquals(r.sourceLayer, 'schema');
  assertEquals(r.explicit, false);
  assertEquals(r.opRef?.filename, '0.schema.sql');
});

Deno.test('explainFieldLineage: no writer + value differs from default -> ambiguous, never fabricated (AC4/AC7)', () => {
  const r = explainFieldLineage({ fieldPath: 'x', effectiveCell: null, schemaDefault, valueMatchesDefault: false });
  assertEquals(r.status, 'ambiguous');
  assertEquals(r.sourceKind, 'ambiguous');
});

Deno.test('explainFieldLineage: no writer + no default -> unavailable', () => {
  const r = explainFieldLineage({ fieldPath: 'description', effectiveCell: null, schemaDefault: undefined, valueMatchesDefault: undefined });
  assertEquals(r.status, 'unavailable');
  assertEquals(r.sourceKind, 'unavailable');
});

Deno.test('foldPendingConflict: pending forces every field ambiguous and entity status ambiguous', () => {
  const fields: FieldLineage[] = [
    { fieldPath: 'a', status: 'resolved', sourceLayer: 'base', sourceKind: 'base-op', opId: 1, opRef: null, explicit: true },
    { fieldPath: 'b', status: 'resolved', sourceLayer: 'schema', sourceKind: 'schema-default', opId: null, opRef: null, explicit: false }
  ];
  const r = foldPendingConflict(fields, true);
  assertEquals(r.lineageStatus, 'ambiguous');
  assertEquals(r.lineage.every((f) => f.status === 'ambiguous' && f.sourceKind === 'ambiguous'), true);
});

Deno.test('foldPendingConflict: no conflict -> available (or unavailable when empty)', () => {
  assertEquals(foldPendingConflict([], false).lineageStatus, 'unavailable');
  const one: FieldLineage[] = [{ fieldPath: 'a', status: 'resolved', sourceLayer: 'base', sourceKind: 'base-op', opId: 1, opRef: null, explicit: true }];
  assertEquals(foldPendingConflict(one, false).lineageStatus, 'available');
});
