/**
 * Durable regression guard for the log-redaction sanitizer that Security Posture (issue #28) relies on
 * for its runtime self-verify. If `sanitizeLogMeta` ever stops stripping the value patterns that
 * protect real credentials (32-hex Arr keys, `sk-` tokens, JWTs), this test fails HERE — a code
 * regression caught at build time, exactly what the shield's `redactionVerified` assurance detects at
 * runtime. Pairs with tests/base/arrCredentialRedactionRoutes.test.ts (which guards route responses).
 */

import { assert, assertEquals } from '@std/assert';
import { sanitizeLogMeta } from '$logger/sanitizer.ts';

Deno.test('sanitizeLogMeta strips a 32-hex Arr-key-shaped value anywhere it appears', () => {
  const key = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sanitized = sanitizeLogMeta({ note: key, nested: { alsoKey: key } });
  assert(!JSON.stringify(sanitized).includes(key), 'a 32-hex secret must not survive');
});

Deno.test('sanitizeLogMeta strips sk- tokens and JWT triples by value pattern', () => {
  const sk = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const jwt = 'aaaa.bbbb.cccc';
  const sanitized = sanitizeLogMeta({ opaque: sk, bearer: jwt }) as Record<string, string>;
  assertEquals(sanitized.opaque, '[REDACTED]');
  assertEquals(sanitized.bearer, '[REDACTED]');
});

Deno.test('sanitizeLogMeta redacts a non-string value under a sensitive key', () => {
  const sanitized = sanitizeLogMeta({ credential: { user: 'admin', token: 42 } }) as Record<string, unknown>;
  assertEquals(sanitized.credential, '[REDACTED]');
});

Deno.test('sanitizeLogMeta leaves non-sensitive plain data intact', () => {
  const sanitized = sanitizeLogMeta({ host: '10.0.0.5', port: 7878, scheme: 'http' });
  assertEquals(sanitized, { host: '10.0.0.5', port: 7878, scheme: 'http' });
});
