import { assertEquals } from '@std/assert';
import { entityNameToSlug, resolveEntitySlug } from '$pcd/migration/slug.ts';

Deno.test('slug: resolves empty and whitespace names to the fallback', () => {
  assertEquals(entityNameToSlug(''), 'export-batch');
  assertEquals(entityNameToSlug('   '), 'export-batch');
  assertEquals(entityNameToSlug('\n\t\r'), 'export-batch');
});

Deno.test('slug: normalizes and trims special characters deterministically', () => {
  assertEquals(entityNameToSlug('  Hello, World!  '), 'hello-world');
  assertEquals(entityNameToSlug('My___Complex::Name'), 'my-complex-name');
});

Deno.test('slug: truncates long names to 60 characters', () => {
  assertEquals(entityNameToSlug('a'.repeat(61)), 'a'.repeat(60));
  assertEquals(entityNameToSlug('a'.repeat(75)), 'a'.repeat(60));
});

Deno.test('slug: converts unicode-heavy input to safe ASCII slug segments', () => {
  assertEquals(entityNameToSlug('你好World'), 'world');
  assertEquals(entityNameToSlug('Emoji 🎉 Party'), 'emoji-party');
});

Deno.test('slug: resolves collisions deterministically', () => {
  const entityNames = ['Alpha Regex', 'Alpha Regex', 'Alpha-Regex'];
  const existingSlugs = new Set<string>(entityNames.map((name) => entityNameToSlug(name)));

  assertEquals(resolveEntitySlug('Alpha Regex', existingSlugs), 'alpha-regex-2');
  assertEquals(resolveEntitySlug('Alpha Regex', ['alpha-regex', 'alpha-regex-2']), 'alpha-regex-3');
  assertEquals(resolveEntitySlug('Alpha Regex', ['alpha-regex', 'alpha-regex-2', 'alpha-regex-3']), 'alpha-regex-4');
});
