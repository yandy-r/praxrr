import { assertEquals, assertExists } from '@std/assert';

import {
  BUNDLE_MAX_ENTITIES,
  bundleEntityKey,
  generateRenamedName,
  resolveCollisionPolicy,
  validateBundle,
  validateCollisionOptions,
} from '$shared/pcd/bundle.ts';

function regexEntry(name: string) {
  return {
    entityType: 'regular_expression',
    data: { name, pattern: 'x', tags: [], description: null, regex101Id: null },
  };
}

Deno.test('validateBundle accepts a well-formed bundle and rejects wrong version', () => {
  const ok = validateBundle({ version: 1, entities: [regexEntry('A')] });
  assertExists('bundle' in ok ? ok.bundle : null);
  assertEquals('error' in validateBundle({ version: 2, entities: [regexEntry('A')] }), true);
});

Deno.test('validateBundle enforces entity count caps and entity types', () => {
  assertEquals('error' in validateBundle({ version: 1, entities: [] }), true);
  const tooMany = Array.from({ length: BUNDLE_MAX_ENTITIES + 1 }, (_, i) => regexEntry(`R${i}`));
  assertEquals('error' in validateBundle({ version: 1, entities: tooMany }), true);
  const atCap = Array.from({ length: BUNDLE_MAX_ENTITIES }, (_, i) => regexEntry(`R${i}`));
  assertEquals('bundle' in validateBundle({ version: 1, entities: atCap }), true);
  assertEquals(
    'error' in validateBundle({ version: 1, entities: [{ entityType: 'nope', data: { name: 'x' } }] }),
    true
  );
  assertEquals('error' in validateBundle({ version: 1, entities: [regexEntry('A'), regexEntry('a')] }), true);
});

Deno.test('resolveCollisionPolicy: per-entity beats default and keys are case-insensitive', () => {
  const parsed = validateCollisionOptions({
    default: 'skip',
    perEntity: { 'Custom_Format:My CF': 'overwrite' },
  });
  if (!('options' in parsed)) throw new Error('expected options');
  assertEquals(resolveCollisionPolicy(parsed.options, 'custom_format', 'my cf'), 'overwrite');
  assertEquals(resolveCollisionPolicy(parsed.options, 'custom_format', 'other'), 'skip');
  assertEquals(bundleEntityKey('custom_format', 'My CF'), 'custom_format:my cf');
  assertEquals('error' in validateCollisionOptions({ default: 'bogus' }), true);
});

Deno.test('generateRenamedName counts up past taken names case-insensitively', () => {
  assertEquals(generateRenamedName('Foo', new Set()), 'Foo (2)');
  assertEquals(generateRenamedName('Foo', new Set(['foo (2)', 'foo (3)'])), 'Foo (4)');
});
