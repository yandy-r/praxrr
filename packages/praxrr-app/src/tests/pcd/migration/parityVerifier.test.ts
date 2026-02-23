import { assertEquals, assertThrows } from '@std/assert';
import {
  __testOnly_compareRowsBySortKeys,
  __testOnly_normalizeScalarValue,
  __testOnly_valuesEqual,
  compareRowsByNaturalKey,
} from '$pcd/migration/parityVerifier.ts';

Deno.test('parityVerifier: normalizeScalarValue coerce booleans and numeric text', () => {
  assertEquals(__testOnly_normalizeScalarValue(true), 1);
  assertEquals(__testOnly_normalizeScalarValue(false), 0);
  assertEquals(__testOnly_normalizeScalarValue('  12 '), 12);
  assertEquals(__testOnly_normalizeScalarValue('true'), 1);
  assertEquals(__testOnly_normalizeScalarValue(' false '), 0);
  assertEquals(__testOnly_normalizeScalarValue('  not-number  '), 'not-number');
  assertEquals(__testOnly_normalizeScalarValue(''), '');
});

Deno.test('parityVerifier: valuesEqual compares scalars and structured payloads by stable JSON', () => {
  assertEquals(__testOnly_valuesEqual(1, 1), true);
  assertEquals(__testOnly_valuesEqual(null, undefined), false);
  assertEquals(__testOnly_valuesEqual({ name: 'a', value: 1 }, { value: 1, name: 'a' }), true);
  assertEquals(__testOnly_valuesEqual(['a', 'b'], ['a', 'b']), true);
  assertEquals(__testOnly_valuesEqual(['a', 'b'], ['b', 'a']), false);
});

Deno.test('parityVerifier: compareRowsBySortKeys supports numeric coercion and nulls', () => {
  const rowA = { position: '10', name: 'first', optional: null };
  const rowB = { position: '2', name: 'second', optional: 'x' };
  const rowC = { position: null, name: 'third', optional: 'x' };

  assertEquals(__testOnly_compareRowsBySortKeys(rowA, rowB, ['position']), -1);
  assertEquals(__testOnly_compareRowsBySortKeys(rowB, rowA, ['position']), 1);
  assertEquals(__testOnly_compareRowsBySortKeys(rowC, rowB, ['position']), -1);
  assertEquals(__testOnly_compareRowsBySortKeys(rowB, rowC, ['position']), 1);
  assertEquals(__testOnly_compareRowsBySortKeys({ name: 'a' }, { name: 'b' }, ['name']), -1);
});

Deno.test('parityVerifier: compareRowsByNaturalKey throws for duplicate natural keys', () => {
  assertThrows(
    () =>
      compareRowsByNaturalKey(
        [
          { name: 'duplicate', value: 1 },
          { name: 'duplicate', value: 2 },
        ],
        [{ name: 'unique', value: 3 }],
        'tags'
      ),
    Error,
    'Duplicate row key in table "tags": {"name": "duplicate"}'
  );
});
