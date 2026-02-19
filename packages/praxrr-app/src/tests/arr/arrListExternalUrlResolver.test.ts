import { assertEquals } from '@std/assert';
import { resolveInstanceBrowserUrl } from '$shared/arr/instanceUrl.ts';

Deno.test('arr list/table Open-in target falls back to canonical URL when external URL is missing', () => {
  const target = resolveInstanceBrowserUrl({
    url: 'http://arr.internal:7878',
    external_url: null,
  });

  assertEquals(target, 'http://arr.internal:7878');
});

Deno.test('arr list/table Open-in target uses external URL when provided', () => {
  const target = resolveInstanceBrowserUrl({
    url: 'http://arr.internal:7878',
    external_url: 'https://arr.example.com',
  });

  assertEquals(target, 'https://arr.example.com');
});

Deno.test('arr list/table Open-in target ignores blank external URL and falls back to canonical URL', () => {
  const target = resolveInstanceBrowserUrl({
    url: 'http://arr.internal:7878',
    external_url: '   ',
  });

  assertEquals(target, 'http://arr.internal:7878');
});
