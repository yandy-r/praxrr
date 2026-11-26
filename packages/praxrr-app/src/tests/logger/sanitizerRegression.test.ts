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

// Loaded at module scope: logger.ts transitively loads a native SQLite library, which Deno's leak
// sanitizer reports as a leak when first imported inside a test body.
const { Logger } = await import('$logger/logger.ts');

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

Deno.test('sanitizeLogMeta serializes string-keyed Map as a sanitized record', () => {
  const hexKey = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sk = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const map = new Map<string, unknown>([
    ['host', '10.0.0.5'],
    ['radarr.local.lan', 'reachable'],
    ['v0.8.0', 200],
    ['apiKey', 'short-key'],
    ['authorization', 'Bearer custom-token'],
    ['x-api-key', 'arr-secret'],
    ['cookie', 'session=secret-cookie'],
    ['empty_token', ''],
    ['note', `leak ${hexKey}`],
    ['https://user:hunter2@arr.example/api', 'ok'],
    [`key-${sk}`, 'value'],
  ]);

  const sanitized = sanitizeLogMeta({ map, empty: new Map() }) as {
    map: Record<string, unknown>;
    empty: Record<string, unknown>;
  };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.empty, {});
  assertEquals(sanitized.map.host, '10.0.0.5');
  assertEquals(sanitized.map['radarr.local.lan'], 'reachable');
  assertEquals(sanitized.map['v0.8.0'], 200);
  assertEquals(sanitized.map.apiKey, '[REDACTED]');
  assertEquals(sanitized.map.authorization, '[REDACTED]');
  assertEquals(sanitized.map['x-api-key'], '[REDACTED]');
  assertEquals(sanitized.map.cookie, '[REDACTED]');
  assertEquals(sanitized.map.empty_token, '');
  assertEquals(sanitized.map.note, 'leak [REDACTED]');
  assertEquals(sanitized.map['https://[REDACTED]@arr.example/api'], 'ok');
  assertEquals(sanitized.map['key-[REDACTED]'], 'value');
  for (const leaked of [hexKey, sk, 'short-key', 'custom-token', 'arr-secret', 'secret-cookie', 'hunter2']) {
    assert(!serialized.includes(leaked), `${leaked} must not survive`);
  }
});

Deno.test('sanitizeLogMeta handles __proto__ keys in Map without prototype pollution', () => {
  const map = new Map<string, unknown>([
    ['__proto__', { polluted: true }],
    ['safe', 'kept'],
  ]);
  const sanitized = sanitizeLogMeta(map) as Record<string, unknown>;

  assertEquals(Object.getPrototypeOf(sanitized), Object.prototype);
  assertEquals(Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), true);
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
  assertEquals((sanitized as { polluted?: unknown }).polluted, undefined);
  assertEquals(sanitized.safe, 'kept');
  assert(JSON.stringify(sanitized).includes('"__proto__":{"polluted":true}'));
});

Deno.test('sanitizeLogMeta serializes non-string-keyed Map as a sanitized entry array', () => {
  const hexKey = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const map = new Map<unknown, unknown>([
    [1, 'one'],
    ['v0.8.0', 200],
    ['https://user:hunter2@arr.example/api', 'ok'],
    [
      { apiKey: 'key-in-obj', id: 7 },
      { password: 'pw-in-val', ok: true },
    ],
    ['authorization', 'Bearer mixed-secret'],
    ['cookie', 'sid=mixed-cookie'],
    ['x-api-key', 'mixed-api-key'],
    ['empty_secret', ''],
    [42n, `note ${hexKey}`],
    [Symbol('s'), 'sym-val'],
  ]);

  const sanitized = sanitizeLogMeta({ map }) as { map: Array<[unknown, unknown]> };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.map[0], [1, 'one']);
  assertEquals(sanitized.map[1], ['v0.8.0', 200]);
  assertEquals(sanitized.map[2], ['https://[REDACTED]@arr.example/api', 'ok']);
  assertEquals(sanitized.map[3], [
    { apiKey: '[REDACTED]', id: 7 },
    { password: '[REDACTED]', ok: true },
  ]);
  assertEquals(sanitized.map[4], ['authorization', '[REDACTED]']);
  assertEquals(sanitized.map[5], ['cookie', '[REDACTED]']);
  assertEquals(sanitized.map[6], ['x-api-key', '[REDACTED]']);
  assertEquals(sanitized.map[7], ['empty_secret', '']);
  assertEquals(sanitized.map[8], ['42', 'note [REDACTED]']);
  assertEquals(sanitized.map[9], [undefined, 'sym-val']);
  for (const leaked of [
    hexKey,
    'key-in-obj',
    'pw-in-val',
    'mixed-secret',
    'mixed-cookie',
    'mixed-api-key',
    'hunter2',
  ]) {
    assert(!serialized.includes(leaked), `${leaked} must not survive`);
  }
});

Deno.test('sanitizeLogMeta serializes Set as a sanitized array', () => {
  const sk = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const set = new Set<unknown>(['alpha', 42, sk, { token: 'secret-token', label: 'keep' }, new Set(['nested', 9n])]);

  const sanitized = sanitizeLogMeta({ set, empty: new Set() }) as {
    set: unknown[];
    empty: unknown[];
  };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.empty, []);
  assertEquals(sanitized.set, ['alpha', 42, '[REDACTED]', { token: '[REDACTED]', label: 'keep' }, ['nested', '9']]);
  assert(!serialized.includes(sk), 'sk token inside Set must not survive');
  assert(!serialized.includes('secret-token'), 'nested secret inside Set must not survive');
});

Deno.test('sanitizeLogMeta serializes Headers as a sanitized record with sensitive headers redacted', () => {
  const hexKey = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const sk = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const headers = new Headers([
    ['Content-Type', 'application/json'],
    ['X-Request-Id', 'req-123'],
    ['Authorization', `Bearer ${sk}`],
    ['Proxy-Authorization', 'Basic dXNlcjpwYXNz'],
    ['X-Api-Key', 'plain-arr-key'],
    ['Cookie', 'session=abc123; theme=dark'],
    ['Set-Cookie', 'session=new-session-secret; HttpOnly; Secure'],
    ['Set-Cookie', ''],
    ['X-Csrf-Token', 'csrf-secret'],
    ['Referer', `https://user:hunter2@arr.example/api?apikey=${hexKey}&page=1`],
    ['X-Custom', `token ${sk}`],
  ]);

  const error = new Error('upstream failed') as Error & { headers?: Headers };
  error.headers = headers;

  const sanitized = sanitizeLogMeta({
    headers,
    empty: new Headers(),
    error,
  }) as {
    headers: Record<string, unknown>;
    empty: Record<string, unknown>;
    error: { headers: Record<string, unknown> };
  };
  const serialized = JSON.stringify(sanitized);

  assertEquals(sanitized.empty, {});
  assertEquals(sanitized.headers['content-type'], 'application/json');
  assertEquals(sanitized.headers['x-request-id'], 'req-123');
  assertEquals(sanitized.headers.authorization, '[REDACTED]');
  assertEquals(sanitized.headers['proxy-authorization'], '[REDACTED]');
  assertEquals(sanitized.headers['x-api-key'], '[REDACTED]');
  assertEquals(sanitized.headers.cookie, '[REDACTED]');
  assertEquals(sanitized.headers['set-cookie'], '[REDACTED]');
  assertEquals(sanitized.headers['x-csrf-token'], '[REDACTED]');
  assertEquals(sanitized.headers.referer, 'https://[REDACTED]@arr.example/api?apikey=[REDACTED]&page=1');
  assertEquals(sanitized.headers['x-custom'], 'token [REDACTED]');
  assertEquals(sanitized.error.headers, sanitized.headers);

  for (const leaked of [
    hexKey,
    sk,
    'dXNlcjpwYXNz',
    'plain-arr-key',
    'abc123',
    'new-session-secret',
    'csrf-secret',
    'hunter2',
  ]) {
    assert(!serialized.includes(leaked), `${leaked} must not survive`);
  }
});

Deno.test(
  'sanitizeLogMeta preserves cycle, shared-ref, depth, size, and non-throwing guarantees for Map, Set, and Headers',
  () => {
    // Cycles in Set and Map (both value and key positions)
    const cyclicSet = new Set<unknown>(['kept']);
    cyclicSet.add(cyclicSet);
    const cyclicValueMap = new Map<string, unknown>([['ok', 1]]);
    cyclicValueMap.set('self', cyclicValueMap);
    const cyclicKeyMap = new Map<unknown, unknown>();
    cyclicKeyMap.set(cyclicKeyMap, 'self-key');

    const cyclic = sanitizeLogMeta({ cyclicSet, cyclicValueMap, cyclicKeyMap }) as {
      cyclicSet: unknown[];
      cyclicValueMap: Record<string, unknown>;
      cyclicKeyMap: Array<[unknown, unknown]>;
    };
    assertEquals(cyclic.cyclicSet, ['kept', '[Circular]']);
    assertEquals(cyclic.cyclicValueMap, { ok: 1, self: '[Circular]' });
    assertEquals(cyclic.cyclicKeyMap, [['[Circular]', 'self-key']]);

    // Shared non-cyclic references must not be marked circular
    const sharedMap = new Map([['k', 'v']]);
    const sharedSet = new Set(['x']);
    const sharedHeaders = new Headers({ 'content-type': 'text/plain', cookie: 'sid=1' });
    const shared = sanitizeLogMeta({
      first: { sharedMap, sharedSet, sharedHeaders },
      second: { sharedMap, sharedSet, sharedHeaders },
    }) as {
      first: Record<string, unknown>;
      second: Record<string, unknown>;
    };
    assertEquals(shared.first, shared.second);
    assertEquals(shared.first.sharedMap, { k: 'v' });
    assertEquals(shared.first.sharedSet, ['x']);
    assertEquals(shared.first.sharedHeaders, { 'content-type': 'text/plain', cookie: '[REDACTED]' });

    // Depth caps for Map, Set, and Headers (including sensitive header at MAX_DEPTH boundary)
    let deepMap: Map<string, unknown> = new Map([['leaf', 'deep-value']]);
    let deepSet: Set<unknown> = new Set(['deep-value']);
    for (let i = 0; i < 40; i++) {
      deepMap = new Map([['next', deepMap]]);
      deepSet = new Set([deepSet]);
    }
    assert(JSON.stringify(sanitizeLogMeta(deepMap)).includes('[Truncated]'));
    assert(JSON.stringify(sanitizeLogMeta(deepSet)).includes('[Truncated]'));

    let atDepthLimit: Record<string, unknown> = {
      headers: new Headers({ authorization: 'Bearer boundary-secret', 'content-type': 'text/plain' }),
    };
    for (let i = 0; i < 31; i++) {
      atDepthLimit = { next: atDepthLimit };
    }
    const boundarySerialized = JSON.stringify(sanitizeLogMeta(atDepthLimit));
    assert(!boundarySerialized.includes('boundary-secret'), 'sensitive header at depth limit must not leak');
    assert(boundarySerialized.includes('[REDACTED]'));
    assert(boundarySerialized.includes('[Truncated]'));

    // String length cap inside Map keys/values, Set items, and Headers values
    const longText = 'x '.repeat(20_000);
    const longSanitized = sanitizeLogMeta({
      map: new Map([[longText, longText]]),
      set: new Set([longText]),
      headers: new Headers({ 'x-long': longText }),
    }) as {
      map: Record<string, string>;
      set: string[];
      headers: Record<string, string>;
    };
    const [longMapKey] = Object.keys(longSanitized.map);
    assert(longMapKey.length < 9_000 && longMapKey.endsWith('…[Truncated]'));
    assert(longSanitized.map[longMapKey].length < 9_000 && longSanitized.map[longMapKey].endsWith('…[Truncated]'));
    assert(longSanitized.set[0].length < 9_000 && longSanitized.set[0].endsWith('…[Truncated]'));
    assert(longSanitized.headers['x-long'].length < 9_000 && longSanitized.headers['x-long'].endsWith('…[Truncated]'));

    // Collection entry cap for oversized Map and Set (including non-string key past the cap)
    const bigMap = new Map<string, number>();
    const bigMixedMap = new Map<unknown, number>();
    const lateMixedMap = new Map<unknown, number>();
    const bigSet = new Set<number>();
    for (let i = 0; i < 1_200; i++) {
      bigMap.set(`k${i}`, i);
      bigMixedMap.set(i, i);
      bigSet.add(i);
    }
    for (let i = 0; i < 1_000; i++) {
      lateMixedMap.set(`k${i}`, i);
    }
    lateMixedMap.set(1_001, 1_001);
    const cappedCollections = sanitizeLogMeta({ bigMap, bigMixedMap, lateMixedMap, bigSet }) as {
      bigMap: Record<string, unknown>;
      bigMixedMap: unknown[];
      lateMixedMap: unknown[];
      bigSet: unknown[];
    };
    assertEquals(cappedCollections.bigMap['[Truncated]'], true);
    assertEquals(Object.keys(cappedCollections.bigMap).length, 1_001);
    assertEquals(cappedCollections.bigMixedMap.length, 1_001);
    assertEquals(cappedCollections.bigMixedMap[1_000], '[Truncated]');
    assert(Array.isArray(cappedCollections.lateMixedMap));
    assertEquals(cappedCollections.lateMixedMap.length, 1_001);
    assertEquals(cappedCollections.lateMixedMap[0], ['k0', 0]);
    assertEquals(cappedCollections.lateMixedMap[1_000], '[Truncated]');
    assertEquals(cappedCollections.bigSet.length, 1_001);
    assertEquals(cappedCollections.bigSet[1_000], '[Truncated]');

    // Incompatible receivers and Proxies must not throw
    const fakeMap = Object.create(Map.prototype);
    const fakeSet = Object.create(Set.prototype);
    const fakeHeaders = Object.create(Headers.prototype);
    const proxiedMap = new Proxy(new Map([['k', 'v']]), {});
    const throwingItem: Record<string, unknown> = { ok: 'kept' };
    Object.defineProperty(throwingItem, 'boom', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });

    const safe = sanitizeLogMeta({
      fakeMap,
      fakeSet,
      fakeHeaders,
      proxiedMap,
      setWithThrowingItem: new Set([throwingItem]),
      mapWithThrowingItem: new Map([['item', throwingItem]]),
    }) as Record<string, unknown>;
    assertEquals(safe.fakeMap, '[Unserializable]');
    assertEquals(safe.fakeSet, '[Unserializable]');
    assertEquals(safe.fakeHeaders, '[Unserializable]');
    assertEquals(safe.proxiedMap, '[Unserializable]');
    assertEquals(safe.setWithThrowingItem, [{ ok: 'kept', boom: '[Unserializable]' }]);
    assertEquals(safe.mapWithThrowingItem, { item: { ok: 'kept', boom: '[Unserializable]' } });
  }
);

Deno.test('Logger writes sanitized Map, Set, and Headers metadata to the log file', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'praxrr-logger-containers-' });
  const originalLog = console.log;
  console.log = () => {};
  try {
    const logger = new Logger({ logsDir: dir, minLevel: 'DEBUG' });
    await logger.info('request context', {
      source: 'test',
      meta: {
        counts: new Map<string, unknown>([
          ['synced', 3],
          ['apiKey', 'secret-map-key'],
        ]),
        tags: new Set(['radarr', 'sk-ABCDEFGHIJKLMNOPQRSTUVWX']),
        headers: new Headers({
          'Content-Type': 'application/json',
          Authorization: 'Bearer log-secret-bearer',
          'X-Api-Key': 'log-secret-apikey',
          Cookie: 'session=log-secret-cookie',
        }),
      },
    });

    const files = [...Deno.readDirSync(dir)].filter((entry) => entry.name.endsWith('.log'));
    assertEquals(files.length, 1);
    const written = await Deno.readTextFile(`${dir}/${files[0].name}`);
    for (const leaked of [
      'secret-map-key',
      'sk-ABCDEFGHIJKLMNOPQRSTUVWX',
      'log-secret-bearer',
      'log-secret-apikey',
      'log-secret-cookie',
    ]) {
      assert(!written.includes(leaked), `${leaked} must not be written to log file`);
    }
    const parsed = JSON.parse(written.trim()) as {
      meta: {
        counts: Record<string, unknown>;
        tags: unknown[];
        headers: Record<string, unknown>;
      };
    };
    assertEquals(parsed.meta.counts, { synced: 3, apiKey: '[REDACTED]' });
    assertEquals(parsed.meta.tags, ['radarr', '[REDACTED]']);
    assertEquals(parsed.meta.headers, {
      'content-type': 'application/json',
      authorization: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      cookie: '[REDACTED]',
    });
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('sanitizeLogMeta summarizes Request without accessing its body or custom hooks', async () => {
  let pulls = 0;
  const payload = 'request body fixture';
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const request = new Request('https://example.test/items?token=fixture-one&%74oken=fixture-two&page=2#omit', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer fixture-auth',
      'X-Api-Key': 'fixture-key',
      Cookie: 'sid=fixture-cookie',
      'X-Request-Id': 'req-123',
    },
    body: stream,
  });
  const accessed: string[] = [];
  const shadowed = ['body', 'clone', 'text', 'json', 'toJSON', 'headers', 'url', 'bodyUsed'];
  for (const key of shadowed) {
    Object.defineProperty(request, key, {
      configurable: true,
      enumerable: true,
      get() {
        accessed.push(key);
        throw new Error('custom property must not run');
      },
    });
  }

  const summary = {
    method: 'POST',
    url: 'https://example.test/items?token=[REDACTED]&%74oken=[REDACTED]&page=2',
    headers: {
      authorization: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      cookie: '[REDACTED]',
      'x-request-id': 'req-123',
    },
    bodyUsed: false,
  };
  assertEquals(sanitizeLogMeta({ request, shared: request }), { request: summary, shared: summary });
  await Promise.resolve();
  assertEquals(accessed, []);
  assertEquals(pulls, 0);
  assertEquals(stream.locked, false);
  // Remove the shadowed getters before normal application code consumes the original body.
  for (const key of shadowed) Reflect.deleteProperty(request, key);
  assertEquals(await request.text(), payload);
  assertEquals(sanitizeLogMeta(request), { ...summary, bodyUsed: true });
});

Deno.test('sanitizeLogMeta summarizes Response with its original stream intact', async () => {
  let pulls = 0;
  const payload = 'response body fixture';
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const response = new Response(stream, {
    status: 202,
    statusText: 'Accepted',
    headers: [
      ['Set-Cookie', 'sid=fixture-cookie'],
      ['Set-Cookie', ''],
      ['Content-Type', 'text/plain'],
    ],
  });
  const summary = {
    status: 202,
    statusText: 'Accepted',
    ok: true,
    redirected: false,
    url: '',
    headers: { 'set-cookie': '[REDACTED]', 'content-type': 'text/plain' },
    bodyUsed: false,
  };
  assertEquals(sanitizeLogMeta(response), summary);
  await Promise.resolve();
  assertEquals(pulls, 0);
  assertEquals(stream.locked, false);
  assertEquals(await response.text(), payload);
  assertEquals(sanitizeLogMeta(response), { ...summary, bodyUsed: true });
});

Deno.test('sanitizeLogMeta removes userinfo from Fetch URLs and sanitizes redirected Response URLs', async () => {
  // Some Fetch implementations refuse URLs with userinfo at construction time; Deno accepts them.
  const request = new Request('https://:fixture-userinfo@example.test/path?access_token=fixture-value');
  assertEquals((sanitizeLogMeta(request) as { url: string }).url, 'https://example.test/path?access_token=[REDACTED]');

  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, (request) => {
    if (new URL(request.url).pathname === '/start') {
      return Response.redirect(new URL('/end?token=fixture-value&page=2', request.url));
    }
    return new Response('fixture');
  });
  try {
    const base = `http://127.0.0.1:${server.addr.port}`;
    const response = await fetch(`${base}/start`);
    assertEquals(sanitizeLogMeta(response), {
      status: 200,
      statusText: 'OK',
      ok: true,
      redirected: true,
      url: `${base}/end?token=[REDACTED]&page=2`,
      headers: sanitizeLogMeta(response.headers),
      bodyUsed: false,
    });
    assertEquals(await response.text(), 'fixture');
  } finally {
    await server.shutdown();
  }
});

Deno.test('sanitizeLogMeta keeps Fetch summaries bounded and non-throwing', () => {
  const headers = new Headers({ 'x-0000': 'x '.repeat(5000) });
  for (let i = 1; i <= 1000; i++) headers.set(`x-${String(i).padStart(4, '0')}`, 'ok');
  const response = new Response(null, { headers });
  const request = new Request(`https://example.test/${'x'.repeat(9000)}`);
  const opaque = new Request('data:text/plain,fixture');
  assertEquals((sanitizeLogMeta(opaque) as { url: string }).url, '[REDACTED]');
  const sanitized = sanitizeLogMeta({ request, response }) as {
    request: { url: string };
    response: { headers: Record<string, string | boolean> };
  };
  assertEquals(sanitized.request.url, '[Truncated]');
  const capped = sanitized.response.headers;
  assertEquals(Object.keys(capped).length, 1001);
  assertEquals(capped['[Truncated]'], true);
  assertEquals(capped['x-1000'], undefined);
  const longHeader = capped['x-0000'];
  assert(typeof longHeader === 'string' && longHeader.endsWith('…[Truncated]'));
  assert(longHeader.length < 9000);

  let deep: unknown = { request, response };
  for (let i = 0; i < 31; i++) deep = { next: deep };
  const unwrap = (value: unknown, levels: number) => {
    for (let i = 0; i < levels; i++) value = (value as { next: unknown }).next;
    return value;
  };
  assertEquals((unwrap(sanitizeLogMeta(deep), 31) as { request: unknown }).request, {
    method: '[Truncated]',
    url: '[Truncated]',
    headers: '[Truncated]',
    bodyUsed: '[Truncated]',
  });
  assertEquals(unwrap(sanitizeLogMeta({ next: deep }), 32), { request: '[Truncated]', response: '[Truncated]' });

  const revoked = Proxy.revocable(response, {});
  revoked.revoke();
  assertEquals(
    sanitizeLogMeta({ request: Object.create(Request.prototype), response: revoked.proxy, sibling: 'kept' }),
    { request: '[Unserializable]', response: '[Unserializable]', sibling: 'kept' }
  );
});
