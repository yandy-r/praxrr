import { assertEquals } from '@std/assert';
import { resolveInstanceBrowserUrl } from '$shared/arr/instanceUrl.ts';

const resolveLibraryBaseUrl = (instance: { url: string; external_url: string | null }): string => {
  return resolveInstanceBrowserUrl(instance).replace(/\/$/, '');
};

Deno.test('library links fall back to instance.url when external_url is not set', () => {
  const baseUrl = resolveLibraryBaseUrl({
    url: 'https://arr.internal.local/',
    external_url: null,
  });
  assertEquals(baseUrl, 'https://arr.internal.local');
  assertEquals(`${baseUrl}/movie/1`, 'https://arr.internal.local/movie/1');
});

Deno.test('library links use external_url when it is available', () => {
  const baseUrl = resolveLibraryBaseUrl({
    url: 'https://arr.internal.local',
    external_url: 'https://arr.external.example/',
  });
  assertEquals(baseUrl, 'https://arr.external.example');
  assertEquals(`${baseUrl}/series/my-show`, 'https://arr.external.example/series/my-show');
});
