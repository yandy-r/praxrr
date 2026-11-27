import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import {
  formatFieldChangeValue,
  formatFieldValue,
  isMissingFieldChangeSide,
  MISSING_FIELD_VALUE,
} from '$ui/resolved/fieldChangeDisplay.ts';

// YAN-1576: keyed-array added/removed rows carry an explicit `null` on the missing side (per
// the OpenAPI contract), while older stored sync-history/canary rows omit the key entirely.
// Both must render the shared placeholder; a real `null` on a `changed` row must stay `null`.

Deno.test('missing side placeholder is the em dash', () => {
  assertEquals(MISSING_FIELD_VALUE, '—');
});

Deno.test('added rows render the missing current side as the placeholder (null and absent key)', () => {
  const absentKey: { current?: unknown } = {};
  assertEquals(formatFieldChangeValue('added', 'current', null), '—');
  assertEquals(formatFieldChangeValue('added', 'current', absentKey.current), '—');
  assertEquals(formatFieldChangeValue('added', 'desired', 42), '42');
  assertEquals(formatFieldChangeValue('added', 'desired', { name: 'x' }), JSON.stringify({ name: 'x' }, null, 2));
});

Deno.test('removed rows render the missing desired side as the placeholder (null and absent key)', () => {
  const absentKey: { desired?: unknown } = {};
  assertEquals(formatFieldChangeValue('removed', 'desired', null), '—');
  assertEquals(formatFieldChangeValue('removed', 'desired', absentKey.desired), '—');
  assertEquals(formatFieldChangeValue('removed', 'current', 'Bluray-1080p'), 'Bluray-1080p');
});

Deno.test('changed rows keep a real null value as literal null', () => {
  assertEquals(formatFieldChangeValue('changed', 'current', null), 'null');
  assertEquals(formatFieldChangeValue('changed', 'desired', null), 'null');
  assertEquals(formatFieldChangeValue('changed', 'current', false), 'false');
  assertEquals(formatFieldChangeValue('changed', 'desired', 0), '0');
});

Deno.test('present side of an added/removed row that is null is not treated as missing', () => {
  // The present side of an added row is `desired`; a null there is a real value.
  assertFalse(isMissingFieldChangeSide('added', 'desired', null));
  assertFalse(isMissingFieldChangeSide('removed', 'current', null));
  assertEquals(formatFieldChangeValue('added', 'desired', null), 'null');
  assertEquals(formatFieldChangeValue('removed', 'current', null), 'null');
  assert(isMissingFieldChangeSide('added', 'current', undefined));
  assert(isMissingFieldChangeSide('removed', 'desired', null));
});

Deno.test('formatFieldValue raw formatter is unchanged', () => {
  assertEquals(formatFieldValue(null), 'null');
  assertEquals(formatFieldValue(undefined), 'undefined');
  assertEquals(formatFieldValue('a'), 'a');
  assertEquals(formatFieldValue([1]), '[\n  1\n]');
});

// Every FieldChange diff view must route current/desired through the side-aware formatter so the
// placeholder cannot silently regress to raw `null`/`undefined` in one view.
const DIFF_VIEWS = [
  '../../lib/client/ui/drift/DriftFieldDiff.svelte',
  '../../lib/client/ui/snapshots/SnapshotDiff.svelte',
  '../../lib/client/ui/sync-history/SyncHistoryDiff.svelte',
  '../../routes/databases/[id]/overrides/+page.svelte',
  '../../routes/resolved-config/[databaseId]/LiveDiffPanel.svelte',
  '../../routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte',
  '../../routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte',
];

for (const path of DIFF_VIEWS) {
  Deno.test(`diff view ${path} formats both sides with formatFieldChangeValue`, async () => {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    // Prettier may wrap the call across lines; collapse whitespace inside the parentheses.
    const compact = source.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    assertStringIncludes(compact, "formatFieldChangeValue(fieldChange.type, 'current', fieldChange.current)");
    assertStringIncludes(compact, "formatFieldChangeValue(fieldChange.type, 'desired', fieldChange.desired)");
    assertFalse(/format(?:Field)?Value\(\s*fieldChange\.(?:current|desired)\s*\)/.test(source));
  });
}

Deno.test('cross-instance grid, canary, and impact-simulator diffs use the side-aware missing check', async () => {
  const grid = await Deno.readTextFile(
    new URL('../../routes/resolved-config/[databaseId]/CrossInstanceGrid.svelte', import.meta.url)
  );
  assertStringIncludes(grid, "formatFieldChangeValue(cell.type, 'desired', cell.value)");
  assertStringIncludes(grid, "formatFieldChangeValue(cell.baselineType, 'current', cell.value)");

  for (const path of [
    '../../routes/canary/[id]/+page.svelte',
    '../../routes/impact-simulator/[databaseId]/components/ConfigDiffPanel.svelte',
  ]) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, 'isMissingFieldChangeSide(');
    assertStringIncludes(source, "if (value === null) return 'null';");
  }
});
