import { assertEquals } from '@std/assert';
import { validateNamingFormat } from '$shared/pcd/namingTokens.ts';

Deno.test('validateNamingFormat: accepts canonical MediaInfo tokens for Sonarr', () => {
  const result = validateNamingFormat('{Series Title} - {MediaInfo AudioCodec} {MediaInfo AudioChannels}', 'sonarr');
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test('validateNamingFormat: accepts Mediainfo token casing variants for Sonarr', () => {
  const result = validateNamingFormat('{Series Title} - {Mediainfo AudioCodec} {Mediainfo AudioChannels}', 'sonarr');
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test('validateNamingFormat: accepts Mediainfo token casing variants for Radarr', () => {
  const result = validateNamingFormat('{Movie Title} - {Mediainfo AudioCodec} {Mediainfo AudioChannels}', 'radarr');
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test('validateNamingFormat: still rejects unknown tokens', () => {
  const result = validateNamingFormat('{Series Title} - {Unknown Token}', 'sonarr');
  assertEquals(result.valid, false);
  assertEquals(result.errors, ['Unknown token: {Unknown Token}']);
});
