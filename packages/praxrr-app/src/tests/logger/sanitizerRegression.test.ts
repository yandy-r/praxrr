/**
 * Durable regression guard for the log-redaction sanitizer that Security Posture (issue #28) relies on
 * for its runtime self-verify. If `sanitizeLogMeta` ever stops stripping the value patterns that
 * protect real credentials (32-hex Arr keys, `sk-` tokens, JWTs), this test fails HERE — a code
 * regression caught at build time, exactly what the shield's `redactionVerified` assurance detects at
 * runtime. Pairs with tests/base/arrCredentialRedactionRoutes.test.ts (which guards route responses).
 */

import { assert, assertEquals } from '@std/assert';
import { sanitizeLogMeta } from '$logger/sanitizer.ts';
import { HttpError } from '$http/types.ts';

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

Deno.test('sanitizeLogMeta strips embedded tokens and credential query values', () => {
  const sk = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const apiKey = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sanitized = sanitizeLogMeta({
    label: `Movies ${sk}`,
    url: `https://arr.example/api?apikey=${apiKey}&mode=preview`,
    header: `Bearer ${sk}`,
  });
  const serialized = JSON.stringify(sanitized);

  assert(!serialized.includes(sk), 'embedded sk token must not survive');
  assert(!serialized.includes(apiKey), 'credential query value must not survive');
  assert(serialized.includes('Movies [REDACTED]'));
  assert(serialized.includes('apikey=[REDACTED]&mode=preview'));
  assert(serialized.includes('"header":"[REDACTED]"'));
});

Deno.test('sanitizeLogMeta strips Praxrr prx_ API token secrets by value and when embedded', () => {
  const secret = `prx_${'ab12'.repeat(16)}`;
  const sanitized = sanitizeLogMeta({ opaque: secret, note: `client sent ${secret} on /api/v1/mcp` }) as Record<
    string,
    string
  >;
  assertEquals(sanitized.opaque, '[REDACTED]');
  assertEquals(sanitized.note, 'client sent [REDACTED] on /api/v1/mcp');
  assert(!JSON.stringify(sanitized).includes(secret), 'a prx_ token must not survive');
});

Deno.test('sanitizeLogMeta redacts a non-string value under a sensitive key', () => {
  const sanitized = sanitizeLogMeta({ credential: { user: 'admin', token: 42 } }) as Record<string, unknown>;
  assertEquals(sanitized.credential, '[REDACTED]');
});

Deno.test('sanitizeLogMeta leaves non-sensitive plain data intact', () => {
  const sanitized = sanitizeLogMeta({ host: '10.0.0.5', port: 7878, scheme: 'http' });
  assertEquals(sanitized, { host: '10.0.0.5', port: 7878, scheme: 'http' });
});

Deno.test('sanitizeLogMeta expands Errors into JSON-safe diagnostic records', () => {
  const sanitized = sanitizeLogMeta({ error: new Error('boom') }) as {
    error: Record<string, unknown>;
  };
  const serialized = JSON.stringify(sanitized);

  assert(serialized.includes('"name":"Error"'));
  assert(serialized.includes('"message":"boom"'));
  assertEquals(typeof sanitized.error.stack, 'string');
});

Deno.test('sanitizeLogMeta redacts embedded secrets from Error messages and stacks', () => {
  const key = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sanitized = sanitizeLogMeta({ error: new Error(`request failed ${key}`) }) as {
    error: Record<string, unknown>;
  };
  const stack = sanitized.error.stack;

  assertEquals(sanitized.error.message, 'request failed [REDACTED]');
  assert(typeof stack === 'string');
  assert(!stack.includes(key), 'the Error stack must not retain the embedded key');
  assert(!stack.includes('request failed'), 'the stack carries frames only, not the message');
});

Deno.test('sanitizeLogMeta expands HttpError fields and redacts its nested credentials', () => {
  const key = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const token = 'short-nonhex-token';
  const details = JSON.stringify({ password: 'hunter2', token });
  const message = `HTTP 401: Unauthorized | ${details}`;
  const error = new HttpError(message, 401, { apiKey: key, detail: { token: 'abc' } });
  const sanitized = sanitizeLogMeta({ error }) as { error: Record<string, unknown> };
  const response = sanitized.error.response as {
    apiKey: unknown;
    detail: { token: unknown };
  };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.error.name, 'HttpError');
  assertEquals(sanitized.error.status, 401);
  assertEquals(response.apiKey, '[REDACTED]');
  assertEquals(response.detail.token, '[REDACTED]');
  assert(!serialized.includes(key), 'the HttpError response must not retain the API key');
  assert(!serialized.includes('abc'), 'the HttpError response must not retain the token');
  assert(!serialized.includes(token), 'the HttpError message and stack must not retain the token');
  assert(!serialized.includes('hunter2'), 'the HttpError message and stack must not retain the password');
});

Deno.test('sanitizeLogMeta serializes and redacts an Error cause', () => {
  const key = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const error = new Error('outer', { cause: new Error(`inner ${key}`) });
  const sanitized = sanitizeLogMeta({ error }) as { error: Record<string, unknown> };
  const cause = sanitized.error.cause as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);

  assertEquals(cause.message, 'inner [REDACTED]');
  assert(!serialized.includes(key), 'the Error cause must not retain the embedded key');
});

Deno.test('sanitizeLogMeta handles an Error own-property cycle', () => {
  const error = new Error('cycle') as Error & { self?: unknown };
  error.self = error;

  const sanitized = sanitizeLogMeta({ error }) as { error: Record<string, unknown> };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.error.self, '[Circular]');
  assert(serialized.includes('"message":"cycle"'));
});

Deno.test('sanitizeLogMeta redacts sensitive fields on plain class instances', () => {
  class Creds {
    constructor(
      public user = 'u',
      public password = 'p'
    ) {}
  }

  const sanitized = sanitizeLogMeta(new Creds()) as Record<string, unknown>;

  assertEquals(sanitized.user, 'u');
  assertEquals(sanitized.password, '[REDACTED]');
});

Deno.test('sanitizeLogMeta sanitizes URL toJSON output', () => {
  const key = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const url = new URL(`https://arr.example/api?apikey=${key}&mode=preview`);
  const sanitized = sanitizeLogMeta({ url }) as { url: unknown };

  assertEquals(sanitized.url, 'https://arr.example/api?apikey=[REDACTED]&mode=preview');
  assert(!JSON.stringify(sanitized).includes(key), 'the URL must not retain the API key');
});

Deno.test('sanitizeLogMeta expands AggregateError entries with redaction', () => {
  const token = 'short-agg-token';
  const error = new AggregateError([new Error(`inner {"token":"${token}"}`), 'plain failure'], 'multiple failures');
  const sanitized = sanitizeLogMeta({ error }) as { error: Record<string, unknown> };
  const errors = sanitized.error.errors as unknown[];
  const firstError = errors[0] as Record<string, unknown>;
  assertEquals(firstError.message, 'inner {"token":"[REDACTED]"}');
  assertEquals(errors[1], 'plain failure');
  assertEquals(sanitized.error.message, 'multiple failures');
});

Deno.test('sanitizeLogMeta isolates a throwing getter to that field', () => {
  const meta: Record<string, unknown> = { ok: 'kept' };
  Object.defineProperty(meta, 'bad', {
    enumerable: true,
    get() {
      throw new Error('getter exploded');
    },
  });
  const sanitized = sanitizeLogMeta(meta) as Record<string, unknown>;
  assertEquals(sanitized.ok, 'kept');
  assertEquals(sanitized.bad, '[Unserializable]');
});

Deno.test('sanitizeLogMeta isolates a throwing getter on an Error to that field', () => {
  const error = new Error('boom') as Error & { bad?: unknown };
  Object.defineProperty(error, 'bad', {
    enumerable: true,
    get() {
      throw new Error('getter exploded');
    },
  });
  const sanitized = sanitizeLogMeta({ error }) as { error: Record<string, unknown> };
  assertEquals(sanitized.error.message, 'boom');
  assertEquals(sanitized.error.bad, '[Unserializable]');
});

Deno.test('sanitizeLogMeta handles a revoked Proxy without throwing', () => {
  const { proxy, revoke } = Proxy.revocable({ secret: 'x' }, {});
  revoke();
  const sanitized = sanitizeLogMeta({ proxy }) as { proxy: unknown };
  assertEquals(sanitized.proxy, '[Unserializable]');
});

Deno.test('sanitizeLogMeta handles a self-containing array', () => {
  const list: unknown[] = ['kept'];
  list.push(list);
  const sanitized = sanitizeLogMeta({ list }) as { list: unknown[] };
  assertEquals(sanitized.list[0], 'kept');
  assertEquals(sanitized.list[1], '[Circular]');
});

Deno.test('sanitizeLogMeta handles a toJSON that returns this', () => {
  const obj = {
    label: 'kept',
    apiKey: 'hunter2',
    toJSON() {
      return this;
    },
  };
  const sanitized = sanitizeLogMeta(obj) as Record<string, unknown>;
  assertEquals(sanitized.label, 'kept');
  assertEquals(sanitized.apiKey, '[REDACTED]');
  assertEquals(sanitized.toJSON, undefined);
});

Deno.test('sanitizeLogMeta drops functions and symbols and stringifies bigint', () => {
  const sanitized = sanitizeLogMeta({
    fn: () => 1,
    sym: Symbol('s'),
    big: 42n,
    kept: 'yes',
  }) as Record<string, unknown>;
  assertEquals(sanitized.fn, undefined);
  assertEquals(sanitized.sym, undefined);
  assertEquals(sanitized.big, '42');
  assertEquals(sanitized.kept, 'yes');
  JSON.stringify(sanitized);
});

Deno.test('sanitizeLogMeta truncates deeply nested values', () => {
  let deep: Record<string, unknown> = { leaf: 'kept-secret-token' };
  for (let i = 0; i < 50; i++) {
    deep = { next: deep };
  }
  const serialized = JSON.stringify(sanitizeLogMeta(deep));
  assert(serialized.includes('[Truncated]'));
});

Deno.test('sanitizeLogMeta redacts URL userinfo on URL objects and strings', () => {
  const sanitized = sanitizeLogMeta({
    url: new URL('https://user:hunter2pass@arr.example/api'),
    plain: 'connect https://user:hunter2pass@arr.example/api failed',
    remote: 'https://sometokenvalue@github.com/org/repo.git',
  }) as Record<string, string>;
  assertEquals(sanitized.url, 'https://[REDACTED]@arr.example/api');
  assertEquals(sanitized.plain, 'connect https://[REDACTED]@arr.example/api failed');
  assertEquals(sanitized.remote, 'https://[REDACTED]@github.com/org/repo.git');
});

Deno.test('sanitizeLogMeta redacts GitHub tokens in Error messages', () => {
  const pat = 'ghp_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const fineGrained = 'github_pat_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_ab';
  const sanitized = sanitizeLogMeta({
    error: new Error(`clone https://${pat}@github.com/org/repo.git failed with ${fineGrained}`),
  }) as { error: Record<string, unknown> };
  const serialized = JSON.stringify(sanitized);
  assert(!serialized.includes(pat), 'the ghp_ token must not survive');
  assert(!serialized.includes(fineGrained), 'the github_pat_ token must not survive');
  assertEquals(sanitized.error.message, 'clone https://[REDACTED]@github.com/org/repo.git failed with [REDACTED]');
});

Deno.test('sanitizeLogMeta redacts embedded JSON sensitive fields in strings', () => {
  const sanitized = sanitizeLogMeta({
    note: 'body {"password":"hunter2","token":"abc123","label":"keep"} end',
    unquoted: '{"apiKey": abc123456, "name": "keep"}',
  }) as Record<string, string>;
  assertEquals(sanitized.note, 'body {"password":"[REDACTED]","token":"[REDACTED]","label":"keep"} end');
  assertEquals(sanitized.unquoted, '{"apiKey": "[REDACTED]", "name": "keep"}');
});

Deno.test('sanitizeLogMeta exempts identifier keys while still redacting secrets', () => {
  const sanitized = sanitizeLogMeta({
    password: 'hunter2',
    apiKey: 'key-value',
    token: 'token-value',
    tokenName: 'deploy-token https://user:hunter2pass@arr.example/api',
    credentialId: 'cred-123',
    runId: 'run-123',
    correlationId: 'corr-123',
    apiKeyPrefix: 'prx_ab12',
    tokenCount: 3,
    hasPersonalAccessToken: true,
    isTokenValid: false,
  }) as Record<string, unknown>;
  assertEquals(sanitized.password, '[REDACTED]');
  assertEquals(sanitized.apiKey, '[REDACTED]');
  assertEquals(sanitized.token, '[REDACTED]');
  assertEquals(sanitized.tokenName, 'deploy-token https://[REDACTED]@arr.example/api');
  assertEquals(sanitized.credentialId, 'cred-123');
  assertEquals(sanitized.runId, 'run-123');
  assertEquals(sanitized.correlationId, 'corr-123');
  assertEquals(sanitized.apiKeyPrefix, 'prx_ab12');
  assertEquals(sanitized.tokenCount, 3);
  assertEquals(sanitized.hasPersonalAccessToken, true);
  assertEquals(sanitized.isTokenValid, false);
});

Deno.test('sanitizeLogMeta sanitizes shared non-cyclic references normally', () => {
  const shared = { label: 'shared', token: 'abc' };
  const sanitized = sanitizeLogMeta({ a: shared, b: { inner: shared } }) as {
    a: Record<string, unknown>;
    b: { inner: Record<string, unknown> };
  };
  assertEquals(sanitized.a, { label: 'shared', token: '[REDACTED]' });
  assertEquals(sanitized.b.inner, { label: 'shared', token: '[REDACTED]' });
});

Deno.test('sanitizeLogMeta redacts later JSON fields after a Bearer value inside a body', () => {
  const sanitized = sanitizeLogMeta({
    note: '{"authorization":"Bearer abc","password":"hunter2"}',
    userinfo: '{"url":"https://user:pw@host","token":"t0k3n"}',
  });
  const serialized = JSON.stringify(sanitized);
  assert(!serialized.includes('hunter2'), 'password after Bearer must not survive');
  assert(!serialized.includes('t0k3n'), 'token after userinfo URL must not survive');
  assert(!serialized.includes('abc'), 'Bearer value must not survive');
});

Deno.test('sanitizeLogMeta redacts sensitive JSON fields nested under non-sensitive keys', () => {
  const sanitized = sanitizeLogMeta({
    body: 'HTTP 400: Bad | {"error":{"token":"t0k"},"items":[{"password":"pw"}],"label":"keep"}',
    container: '{"detail":"x","credentials":{"user":"u","pass":"p"},"after":"keep"}',
    escaped: '{"body":"{\\"token\\":\\"esc-secret\\",\\"label\\":\\"keep\\"}"}',
  }) as Record<string, string>;
  const serialized = JSON.stringify(sanitized);
  for (const leaked of ['t0k"', '"pw"', 'esc-secret', '"u"', '"p"']) {
    assert(!serialized.includes(leaked), `${leaked} must not survive`);
  }
  assert(sanitized.body.includes('"label":"keep"'));
  assert(sanitized.container.includes('"after":"keep"'));
  assert(sanitized.escaped.includes('label'));
});

Deno.test('sanitizeLogMeta applies word boundaries to the identifier-key exemption', () => {
  const sanitized = sanitizeLogMeta({
    passwordValid: 'hunter2',
    apiKeyAndroid: 'key-android',
    secretId: 'vault-secret-id',
    secret_id: 'vault-secret-id',
    tokenName: 'deploy',
    credentialId: 'cred-1',
    client_name: 'web',
    token_count: 2,
    'api-key-prefix': 'prx_ab',
  }) as Record<string, unknown>;
  assertEquals(sanitized.passwordValid, '[REDACTED]');
  assertEquals(sanitized.apiKeyAndroid, '[REDACTED]');
  assertEquals(sanitized.secretId, '[REDACTED]');
  assertEquals(sanitized.secret_id, '[REDACTED]');
  assertEquals(sanitized.tokenName, 'deploy');
  assertEquals(sanitized.credentialId, 'cred-1');
  assertEquals(sanitized.client_name, 'web');
  assertEquals(sanitized.token_count, 2);
  assertEquals(sanitized['api-key-prefix'], 'prx_ab');
});

Deno.test('sanitizeLogMeta caps string length and emits only stack frames for Errors', () => {
  const big = 'x '.repeat(20_000);
  const capped = sanitizeLogMeta({ big }) as { big: string };
  assert(capped.big.length < 9_000, 'long strings must be truncated');
  assert(capped.big.endsWith('…[Truncated]'));

  const error = new Error('boom {"token":"abc123"} detail');
  const sanitized = sanitizeLogMeta({ error }) as {
    error: { message: string; stack?: string };
  };
  assertEquals(sanitized.error.message, 'boom {"token":"[REDACTED]"} detail');
  assert(!sanitized.error.stack?.includes('boom'), 'stack must not repeat the message');
  assert(sanitized.error.stack?.includes('at '), 'stack frames are kept');
  assert(!JSON.stringify(sanitized).includes('abc123'));
});

Deno.test('sanitizeLogMeta stays fast on adversarial large strings', () => {
  const size = 200_000;
  const inputs = [
    'a'.repeat(size),
    '"a":'.repeat(size / 4),
    '{"a":'.repeat(size / 5),
    '\\"a\\":'.repeat(size / 6),
    '['.repeat(size),
    '"token":{'.repeat(size / 9),
    'Bearer '.repeat(size / 7),
  ];
  for (const input of inputs) {
    const start = performance.now();
    sanitizeLogMeta({ input });
    const elapsed = performance.now() - start;
    assert(elapsed < 200, `sanitizing took ${elapsed.toFixed(1)}ms`);
  }
});

Deno.test('Logger writes sanitized HttpError meta to the log file', async () => {
  const { Logger } = await import('$logger/logger.ts');
  const dir = await Deno.makeTempDir({ prefix: 'praxrr-logger-' });
  const originalLog = console.log;
  console.log = () => {};
  try {
    const logger = new Logger({ logsDir: dir, minLevel: 'DEBUG' });
    const body = '{"error":{"token":"t0k-secret"},"password":"hunter2","message":"nope"}';
    const error = new HttpError(`HTTP 400: ${body}`, 400, body);
    await logger.error('request failed', { source: 'test', meta: { error } });
    await logger.errorWithTrace('trace', error, { source: 'test' });

    const files = [...Deno.readDirSync(dir)].filter((entry) => entry.name.endsWith('.log'));
    assertEquals(files.length, 1);
    const written = await Deno.readTextFile(`${dir}/${files[0].name}`);
    assert(!written.includes('t0k-secret'), 'nested token must not be written');
    assert(!written.includes('hunter2'), 'password must not be written');
    assert(written.includes('HTTP 400'), 'error message must be written');
    assert(written.includes('nope'), 'non-sensitive body content must be written');
    for (const line of written.trim().split('\n')) {
      JSON.parse(line);
    }
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }
});
