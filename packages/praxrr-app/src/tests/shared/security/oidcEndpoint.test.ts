/**
 * Pure tests for the OIDC endpoint transport policy (YAN-1601): `https:` is always acceptable,
 * plain `http:` only for loopback hosts, everything else is rejected.
 */

import { assertEquals } from '@std/assert';
import { isSecureOidcEndpoint } from '$shared/security/oidcEndpoint.ts';

Deno.test('isSecureOidcEndpoint: https endpoints are accepted', () => {
  assertEquals(isSecureOidcEndpoint('https://idp.example.com/.well-known/openid-configuration'), true);
  assertEquals(isSecureOidcEndpoint('https://idp.example.com:8443/jwks'), true);
});

Deno.test('isSecureOidcEndpoint: remote http endpoints are rejected', () => {
  assertEquals(isSecureOidcEndpoint('http://idp.example.com/token'), false);
  assertEquals(isSecureOidcEndpoint('http://10.0.0.5/token'), false);
});

Deno.test('isSecureOidcEndpoint: loopback http endpoints are accepted', () => {
  for (const url of [
    'http://localhost:8080/token',
    'http://127.0.0.1:8080/token',
    'http://127.1/token',
    'http://[::1]:8080/token',
    'http://[0:0:0:0:0:0:0:1]/token',
  ]) {
    assertEquals(isSecureOidcEndpoint(url), true, url);
  }
});

Deno.test('isSecureOidcEndpoint: loopback look-alikes are rejected', () => {
  for (const url of [
    'http://127.0.0.1@evil.com/token',
    'http://localhost.evil.com/token',
    'http://127.0.0.1.evil.com/token',
  ]) {
    assertEquals(isSecureOidcEndpoint(url), false, url);
  }
});

Deno.test('isSecureOidcEndpoint: other schemes and unusable values are rejected', () => {
  for (const value of [
    'ftp://idp.example.com/token',
    'javascript:alert(1)',
    '/relative/path',
    'idp.example.com/token',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assertEquals(isSecureOidcEndpoint(value), false, String(value));
  }
});
