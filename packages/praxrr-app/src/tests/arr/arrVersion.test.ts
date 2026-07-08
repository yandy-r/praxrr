import { assert, assertEquals } from '@std/assert';
import { compareArrVersions, parseArrVersion, type ArrVersion } from '$shared/arr/version.ts';

/**
 * Parse and assert non-null in one step so `compareArrVersions` (which requires a
 * parsed `ArrVersion`) can be driven from raw strings.
 */
function parse(raw: string): ArrVersion {
  const parsed = parseArrVersion(raw);
  assert(parsed !== null, `expected "${raw}" to parse`);
  return parsed;
}

Deno.test('parseArrVersion parses a 4-part version into numeric segments', () => {
  const parsed = parseArrVersion('5.14.0.9383');
  assertEquals(parsed, { major: 5, minor: 14, patch: 0, build: 9383, raw: '5.14.0.9383' });
});

Deno.test('parseArrVersion defaults build to 0 for a 3-part version', () => {
  const parsed = parseArrVersion('3.0.10');
  assertEquals(parsed, { major: 3, minor: 0, patch: 10, build: 0, raw: '3.0.10' });
});

Deno.test('parseArrVersion trims surrounding whitespace', () => {
  assertEquals(parseArrVersion('  4.0.15.2941  '), { major: 4, minor: 0, patch: 15, build: 2941, raw: '4.0.15.2941' });
});

Deno.test('parseArrVersion returns null for malformed / empty / null input and never throws', () => {
  const badInputs: Array<string | null | undefined> = [
    '', // empty
    '   ', // whitespace only
    null,
    undefined,
    '1.2', // fewer than 3 segments
    '1.2.3.4.5', // more than 4 segments
    'a.b.c', // non-numeric
    '5.14.0.x', // non-numeric build
    '5.14.-1.0', // negative segment rejected by the digit-only guard
    '5..0.1', // empty middle segment
  ];

  for (const input of badInputs) {
    // Must not throw regardless of input shape.
    const result = parseArrVersion(input);
    assertEquals(result, null, `expected ${JSON.stringify(input)} -> null`);
  }
});

Deno.test('compareArrVersions orders numerically, not lexically (5.9.0 < 5.14.0)', () => {
  assertEquals(compareArrVersions(parse('5.9.0'), parse('5.14.0')), -1);
  assertEquals(compareArrVersions(parse('5.14.0'), parse('5.9.0')), 1);
});

Deno.test('compareArrVersions returns 0 for equal versions', () => {
  assertEquals(compareArrVersions(parse('4.0.15.2941'), parse('4.0.15.2941')), 0);
  // 3-part vs equivalent 4-part with explicit .0 build compare equal.
  assertEquals(compareArrVersions(parse('3.0.10'), parse('3.0.10.0')), 0);
});

Deno.test('compareArrVersions compares each segment in precedence order', () => {
  assertEquals(compareArrVersions(parse('6.0.0.0'), parse('5.99.99.99')), 1, 'major dominates');
  assertEquals(compareArrVersions(parse('5.1.0.0'), parse('5.2.0.0')), -1, 'minor');
  assertEquals(compareArrVersions(parse('5.0.1.0'), parse('5.0.0.9')), 1, 'patch dominates build');
  assertEquals(compareArrVersions(parse('5.0.0.1'), parse('5.0.0.2')), -1, 'build');
});
