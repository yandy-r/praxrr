// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { redactSecrets } from '$lib/server/mcp/redact.ts';
import { DELETE, GET, POST } from '../../routes/api/v1/mcp/+server.ts';

type PostEvent = Parameters<typeof POST>[0];

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain, invoke the body, then tear down. Mirrors configHealth.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/mcp-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

// A fake RequestEvent: the route only reads request.headers.get() + request.text(), event.url, and
// event.locals. Using a plain object (not a real Request) lets us set the Origin header, which the
// Fetch Request header guard would otherwise strip.
function buildEvent(bodyText: string, headers: Record<string, string> = {}): PostEvent {
  const request = {
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    text: () => Promise.resolve(bodyText),
  };
  const url = new URL('http://localhost/api/v1/mcp');
  const locals = { user: { id: 0, username: 'api' }, session: null, authBypass: true };
  return { request, url, locals } as unknown as PostEvent;
}

// deno-lint-ignore no-explicit-any
type JsonRpcBody = any;

async function callRpc(
  method: string,
  params?: unknown,
  id: unknown = 1,
  headers?: Record<string, string>
): Promise<Response> {
  const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (id !== undefined) payload.id = id;
  if (params !== undefined) payload.params = params;
  return await POST(buildEvent(JSON.stringify(payload), headers));
}

async function rpcBody(method: string, params?: unknown, id: unknown = 1): Promise<JsonRpcBody> {
  const response = await callRpc(method, params, id);
  return (await response.json()) as JsonRpcBody;
}

function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr', apiKey = 'super-secret-key'): number {
  return arrInstancesQueries.create({
    name: `${type} ${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:9',
    apiKey,
    apiKeyFingerprint: 'fp-abc123',
    enabled: true,
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}

// ============================================================================
// Handshake + negotiation
// ============================================================================

migratedTest('initialize: echoes a supported protocol version', async () => {
  const body = await rpcBody('initialize', { protocolVersion: '2025-03-26' });
  assertEquals(body.result.protocolVersion, '2025-03-26');
});

migratedTest('initialize: unsupported/absent version negotiates to latest', async () => {
  const newer = await rpcBody('initialize', { protocolVersion: '2099-01-01' });
  assertEquals(newer.result.protocolVersion, '2025-06-18');
  const absent = await rpcBody('initialize', {});
  assertEquals(absent.result.protocolVersion, '2025-06-18');
});

migratedTest('initialize: exact capabilities + serverInfo', async () => {
  const body = await rpcBody('initialize', { protocolVersion: '2025-06-18' });
  assertEquals(body.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assertEquals(body.result.serverInfo.name, 'praxrr');
  assert(typeof body.result.serverInfo.version === 'string' && body.result.serverInfo.version.length > 0);
  assert(typeof body.result.instructions === 'string');
});

migratedTest('notifications/initialized returns 202 with empty body', async () => {
  // A notification has no `id`. Build the payload directly (passing undefined to callRpc's defaulted
  // id would fall back to the default).
  const response = await POST(buildEvent(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));
  assertEquals(response.status, 202);
  assertEquals(await response.text(), '');
});

migratedTest('ping returns an empty result object', async () => {
  const body = await rpcBody('ping');
  assertEquals(body.result, {});
});

// ============================================================================
// Listings
// ============================================================================

migratedTest('tools/list returns 9 read-only tools', async () => {
  const body = await rpcBody('tools/list');
  const tools = body.result.tools as Array<{
    name: string;
    inputSchema: unknown;
    annotations: { readOnlyHint: boolean };
  }>;
  assertEquals(tools.length, 9);
  for (const tool of tools) {
    assertEquals(tool.annotations.readOnlyHint, true);
    assertExists(tool.inputSchema);
  }
  const names = tools.map((tool) => tool.name);
  assert(names.includes('list_instances'));
  assert(names.includes('preview_sync'));
});

migratedTest('resources/list returns only static resources', async () => {
  const body = await rpcBody('resources/list');
  const resources = body.result.resources as Array<{ uri: string }>;
  assertEquals(resources.length, 5);
  for (const resource of resources) {
    assert(!resource.uri.includes('{'), `static resource must not be templated: ${resource.uri}`);
  }
});

migratedTest('resources/templates/list returns 4 templates', async () => {
  const body = await rpcBody('resources/templates/list');
  const templates = body.result.resourceTemplates as Array<{ uriTemplate: string }>;
  assertEquals(templates.length, 4);
  assert(
    templates.some(
      (template) => template.uriTemplate === 'praxrr://databases/{databaseId}/entities/{entityType}/{name}'
    )
  );
});

migratedTest('prompts/list returns 4 prompts', async () => {
  const body = await rpcBody('prompts/list');
  assertEquals(body.result.prompts.length, 4);
});

migratedTest('prompts/get builds a user message; missing required arg → -32602', async () => {
  const ok = await rpcBody('prompts/get', { name: 'plan_sync', arguments: { instanceId: '5' } });
  assertEquals(ok.result.messages[0].role, 'user');
  assert(ok.result.messages[0].content.text.includes('5'));
  const bad = await rpcBody('prompts/get', { name: 'plan_sync', arguments: {} });
  assertEquals(bad.error.code, -32602);
});

// ============================================================================
// tools/call — result vs error semantics
// ============================================================================

migratedTest('tools/call list_instances: happy path returns text content, isError false', async () => {
  seedInstance('radarr');
  const body = await rpcBody('tools/call', { name: 'list_instances', arguments: {} });
  assertEquals(body.result.isError, false);
  assertEquals(body.result.content[0].type, 'text');
  const parsed = JSON.parse(body.result.content[0].text);
  assertEquals(parsed.length, 1);
});

migratedTest('tools/call get_drift_status: unknown instance → isError result (not a protocol error)', async () => {
  const body = await rpcBody('tools/call', { name: 'get_drift_status', arguments: { instanceId: 999999 } });
  assertEquals(body.result.isError, true);
  assert(!('error' in body));
});

migratedTest('tools/call unknown tool → -32602', async () => {
  const body = await rpcBody('tools/call', { name: 'does_not_exist', arguments: {} });
  assertEquals(body.error.code, -32602);
});

migratedTest('tools/call schema-invalid args → -32602', async () => {
  const body = await rpcBody('tools/call', { name: 'preview_sync', arguments: { instanceId: 'not-a-number' } });
  assertEquals(body.error.code, -32602);
});

migratedTest('tools/call unexpected handler throw → -32603 with generic message', async () => {
  const settings = configHealthSettingsQueries as unknown as { get: unknown };
  const original = settings.get;
  settings.get = () => {
    throw new Error('boom: this stack must not leak');
  };
  try {
    const body = await rpcBody('tools/call', { name: 'get_config_health', arguments: {} });
    assertEquals(body.error.code, -32603);
    assertEquals(body.error.message, 'Internal error');
  } finally {
    settings.get = original;
  }
});

migratedTest('get_security_posture and get_config_health fleet return valid summaries', async () => {
  const shield = await rpcBody('tools/call', { name: 'get_security_posture', arguments: {} });
  assertEquals(shield.result.isError, false);
  assert(typeof JSON.parse(shield.result.content[0].text).score === 'number');

  const health = await rpcBody('tools/call', { name: 'get_config_health', arguments: {} });
  assertEquals(health.result.isError, false);
  assertExists(JSON.parse(health.result.content[0].text).totals);
});

migratedTest('search_sync_history: empty history + pageSize clamp to 100', async () => {
  const empty = await rpcBody('tools/call', { name: 'search_sync_history', arguments: { page: 1, pageSize: 50 } });
  const emptyParsed = JSON.parse(empty.result.content[0].text);
  assertEquals(emptyParsed.totalRecords, 0);
  assertEquals(emptyParsed.page, 1);
  assertEquals(emptyParsed.pageSize, 50);

  const clamped = await rpcBody('tools/call', { name: 'search_sync_history', arguments: { pageSize: 9999 } });
  assertEquals(JSON.parse(clamped.result.content[0].text).pageSize, 100);
});

migratedTest('preview_sync: unknown instance → isError result', async () => {
  const body = await rpcBody('tools/call', { name: 'preview_sync', arguments: { instanceId: 999999 } });
  assertEquals(body.result.isError, true);
});

migratedTest('list_resolved_entities: unknown db → isError; invalid entityType → -32602', async () => {
  const missing = await rpcBody('tools/call', {
    name: 'list_resolved_entities',
    arguments: { databaseId: 999999, entityType: 'customFormat' },
  });
  assertEquals(missing.result.isError, true);

  const invalid = await rpcBody('tools/call', {
    name: 'list_resolved_entities',
    arguments: { databaseId: 1, entityType: 'bogus' },
  });
  assertEquals(invalid.error.code, -32602);
});

// ============================================================================
// resources/read
// ============================================================================

migratedTest('resources/read: unknown URI → -32002 (resource not found)', async () => {
  const body = await rpcBody('resources/read', { uri: 'praxrr://nope' });
  assertEquals(body.error.code, -32002);
});

migratedTest('resources/read: arr-agnostic entity template matches (missing db → -32002 with id)', async () => {
  const body = await rpcBody('resources/read', {
    uri: 'praxrr://databases/999999/entities/customFormat/Some%20Name',
  });
  assertEquals(body.error.code, -32002);
  // Message references the db id → the 3-segment (arr-agnostic) template matched, rather than
  // falling through to the unknown-URI branch.
  assert(body.error.message.includes('999999'));
});

migratedTest('resources/read: per-arr (4-segment) template validates arrType before lookup → -32602', async () => {
  const body = await rpcBody('resources/read', {
    uri: 'praxrr://databases/999999/entities/naming/bogus/Some',
  });
  assertEquals(body.error.code, -32602);
  assert(body.error.message.toLowerCase().includes('arrtype'));
});

migratedTest('resources/read: entity-names template parses ?arrType= query (bogus → -32602)', async () => {
  const body = await rpcBody('resources/read', {
    uri: 'praxrr://databases/999999/entities/naming?arrType=bogus',
  });
  assertEquals(body.error.code, -32602);
  assert(body.error.message.toLowerCase().includes('arrtype'));
});

migratedTest('resources/read: malformed percent-encoding in a name → -32602 (not -32603)', async () => {
  const body = await rpcBody('resources/read', {
    uri: 'praxrr://databases/999999/entities/customFormat/bad%ZZname',
  });
  assertEquals(body.error.code, -32602);
});

// ============================================================================
// Secret redaction
// ============================================================================

migratedTest('redaction: list_instances exposes the fingerprint, never the raw api_key', async () => {
  seedInstance('radarr', 'raw-secret-value');
  const body = await rpcBody('tools/call', { name: 'list_instances', arguments: {} });
  const text = body.result.content[0].text as string;
  assert(!text.includes('raw-secret-value'));
  const keys = collectKeys(JSON.parse(text));
  assert(!keys.has('api_key'));
  assert(!keys.has('personal_access_token'));
  assert(keys.has('api_key_fingerprint'));
});

migratedTest('redaction: resources/read arr-instances has no api_key key', async () => {
  seedInstance('sonarr');
  const body = await rpcBody('resources/read', { uri: 'praxrr://arr-instances' });
  const keys = collectKeys(JSON.parse(body.result.contents[0].text));
  assert(!keys.has('api_key'));
  assert(keys.has('api_key_fingerprint'));
});

function seedDatabase(token = 'ghp_rawtoken'): void {
  databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: 'Test DB',
    repositoryUrl: 'http://127.0.0.1:9/repo.git',
    localPath: `/tmp/praxrr-tests/pcd-${crypto.randomUUID()}`,
    personalAccessToken: token,
    enabled: true,
  });
}

migratedTest('redaction: list_databases drops the PAT and keeps has_personal_access_token as a boolean', async () => {
  seedDatabase();
  const body = await rpcBody('tools/call', { name: 'list_databases', arguments: {} });
  const text = body.result.content[0].text as string;
  assert(!text.includes('ghp_rawtoken'));
  const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
  const keys = collectKeys(parsed);
  assert(!keys.has('personal_access_token'));
  assert(keys.has('has_personal_access_token'));
  // The boolean presence flag must survive the scrubber (it shares the `token` suffix).
  assertEquals(typeof parsed[0].has_personal_access_token, 'boolean');
});

migratedTest('redaction: resources/read databases drops the PAT, keeps the boolean flag', async () => {
  seedDatabase();
  const body = await rpcBody('resources/read', { uri: 'praxrr://databases' });
  const text = body.result.contents[0].text as string;
  assert(!text.includes('ghp_rawtoken'));
  const keys = collectKeys(JSON.parse(text));
  assert(!keys.has('personal_access_token'));
  assert(keys.has('has_personal_access_token'));
});

// ============================================================================
// JSON-RPC + HTTP error semantics
// ============================================================================

migratedTest('invalid JSON → -32700 with null id, HTTP 200', async () => {
  const response = await POST(buildEvent('this is not json'));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.error.code, -32700);
  assertEquals(body.id, null);
});

migratedTest('batch array → -32600', async () => {
  const response = await POST(buildEvent(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }])));
  const body = await response.json();
  assertEquals(body.error.code, -32600);
});

migratedTest('malformed envelope (missing jsonrpc) → -32600', async () => {
  const response = await POST(buildEvent(JSON.stringify({ id: 1, method: 'ping' })));
  const body = await response.json();
  assertEquals(body.error.code, -32600);
});

migratedTest('unknown method → -32601', async () => {
  const body = await rpcBody('resources/subscribe');
  assertEquals(body.error.code, -32601);
});

// ============================================================================
// HTTP method + header + guard behavior
// ============================================================================

migratedTest('GET and DELETE → 405 with Allow: POST', async () => {
  const get = await GET({} as Parameters<typeof GET>[0]);
  assertEquals(get.status, 405);
  assertEquals(get.headers.get('allow'), 'POST');
  const del = await DELETE({} as Parameters<typeof DELETE>[0]);
  assertEquals(del.status, 405);
  assertEquals(del.headers.get('allow'), 'POST');
});

migratedTest('unsupported MCP-Protocol-Version header → HTTP 400', async () => {
  const response = await callRpc('ping', undefined, 1, { 'mcp-protocol-version': '1999-01-01' });
  assertEquals(response.status, 400);
});

migratedTest('absent MCP-Protocol-Version header proceeds (200)', async () => {
  const response = await callRpc('ping');
  assertEquals(response.status, 200);
});

migratedTest('feature flag off → 404', async () => {
  const flag = config as unknown as { mcpEnabled: boolean };
  const original = flag.mcpEnabled;
  flag.mcpEnabled = false;
  try {
    const response = await callRpc('ping');
    assertEquals(response.status, 404);
  } finally {
    flag.mcpEnabled = original;
  }
});

migratedTest('oversized body → 413', async () => {
  const big = 'x'.repeat(70 * 1024);
  const response = await POST(buildEvent(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { big } })));
  assertEquals(response.status, 413);
});

migratedTest('Origin guard: cross-origin → 403, same-origin + absent → 200', async () => {
  const cross = await callRpc('ping', undefined, 1, { origin: 'http://evil.example' });
  assertEquals(cross.status, 403);
  const same = await callRpc('ping', undefined, 1, { origin: 'http://localhost' });
  assertEquals(same.status, 200);
  const absent = await callRpc('ping');
  assertEquals(absent.status, 200);
});

migratedTest('oversized Content-Length header → 413 (fast path, small body)', async () => {
  const response = await POST(
    buildEvent(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
      'content-length': String(70 * 1024),
    })
  );
  assertEquals(response.status, 413);
});

// ============================================================================
// Result shape + argument validation
// ============================================================================

migratedTest('tools/call structuredContent is a JSON object even when the payload is an array', async () => {
  seedInstance('radarr');
  const body = await rpcBody('tools/call', { name: 'list_instances', arguments: {} });
  const structured = body.result.structuredContent;
  assert(structured !== null && typeof structured === 'object' && !Array.isArray(structured));
  assert(Array.isArray(structured.items));
});

migratedTest('tools/call rejects unexpected arguments (additionalProperties:false) → -32602', async () => {
  const body = await rpcBody('tools/call', { name: 'list_instances', arguments: { bogusArg: true } });
  assertEquals(body.error.code, -32602);
});

// ============================================================================
// redactSecrets unit coverage
// ============================================================================

Deno.test('redactSecrets scrubs string secrets (incl. password_hash) but keeps fingerprints and boolean flags', () => {
  const scrubbed = redactSecrets({
    api_key: 'raw-key',
    api_key_fingerprint: 'fp-123',
    personal_access_token: 'ghp_x',
    password_hash: 'hashed',
    passwordHash: 'hashed2',
    authorization: 'Bearer x',
    has_personal_access_token: true,
    nested: [{ token: 'inner-secret', label: 'keep-me' }],
    count: 5,
  });
  assertEquals(scrubbed.api_key, '[REDACTED]');
  assertEquals(scrubbed.api_key_fingerprint, 'fp-123');
  assertEquals(scrubbed.personal_access_token, '[REDACTED]');
  assertEquals(scrubbed.password_hash, '[REDACTED]');
  assertEquals(scrubbed.passwordHash, '[REDACTED]');
  assertEquals(scrubbed.authorization, '[REDACTED]');
  assertEquals(scrubbed.has_personal_access_token, true);
  assertEquals(scrubbed.nested[0].token, '[REDACTED]');
  assertEquals(scrubbed.nested[0].label, 'keep-me');
  assertEquals(scrubbed.count, 5);
});
