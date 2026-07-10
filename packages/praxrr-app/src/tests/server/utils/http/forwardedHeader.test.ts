/**
 * Unit tests for the shared X-Forwarded-* first-token parser (extracted for #227, shared by
 * webauthn/rp.ts and security/sessionTransport.ts). Pins the trim + empty-token + first-token-wins
 * normalization so a future edit that drops `.trim()` or the `|| null` guard fails here rather than
 * silently mis-classifying transport for one of the two consumers.
 */

import { assertEquals } from '@std/assert';
import { firstForwardedValue } from '$http/forwardedHeader.ts';

Deno.test('firstForwardedValue: null / empty input returns null', () => {
  assertEquals(firstForwardedValue(null), null);
  assertEquals(firstForwardedValue(''), null);
});

Deno.test('firstForwardedValue: a single value is returned verbatim', () => {
  assertEquals(firstForwardedValue('https'), 'https');
});

Deno.test('firstForwardedValue: the FIRST comma token wins (client-nearest proxy)', () => {
  assertEquals(firstForwardedValue('https, http'), 'https');
  assertEquals(firstForwardedValue('http, https'), 'http');
});

Deno.test('firstForwardedValue: surrounding whitespace on the first token is trimmed', () => {
  assertEquals(firstForwardedValue(' https '), 'https');
  assertEquals(firstForwardedValue('\thttps\n'), 'https');
  // Whitespace around the first token of a chain is trimmed too (proxies may pad the list).
  assertEquals(firstForwardedValue(' https ,http'), 'https');
});

Deno.test('firstForwardedValue: an empty first token collapses to null (leading comma)', () => {
  assertEquals(firstForwardedValue(', https'), null);
  assertEquals(firstForwardedValue('   , https'), null);
});
