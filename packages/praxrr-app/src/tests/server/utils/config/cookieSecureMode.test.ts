/**
 * Tests for `parseCookieSecureMode` (issue #227). Pure parse of the `PRAXRR_COOKIE_SECURE` env value
 * into a `CookieSecureMode`: `auto`/`on`/`off` pass through (case- and whitespace-insensitive), and
 * any invalid, empty, or unset value fails safe to `auto` (design §11 "Config"). No `Deno.env` access.
 */

import { assertEquals } from '@std/assert';
import { parseCookieSecureMode } from '$config';

Deno.test('parseCookieSecureMode: canonical values pass through', () => {
  assertEquals(parseCookieSecureMode('auto'), 'auto');
  assertEquals(parseCookieSecureMode('on'), 'on');
  assertEquals(parseCookieSecureMode('off'), 'off');
});

Deno.test('parseCookieSecureMode: case-insensitive', () => {
  assertEquals(parseCookieSecureMode('AUTO'), 'auto');
  assertEquals(parseCookieSecureMode('On'), 'on');
  assertEquals(parseCookieSecureMode('OFF'), 'off');
});

Deno.test('parseCookieSecureMode: surrounding whitespace is trimmed', () => {
  assertEquals(parseCookieSecureMode(' on '), 'on');
  assertEquals(parseCookieSecureMode('\tauto\n'), 'auto');
});

Deno.test('parseCookieSecureMode: invalid, empty, and undefined fail safe to auto', () => {
  assertEquals(parseCookieSecureMode('garbage'), 'auto');
  assertEquals(parseCookieSecureMode(''), 'auto');
  assertEquals(parseCookieSecureMode('   '), 'auto');
  assertEquals(parseCookieSecureMode(undefined), 'auto');
});
