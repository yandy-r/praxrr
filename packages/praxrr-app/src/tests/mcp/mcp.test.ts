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
import { pluginRegistryQueries, type PluginRegistryRecord } from '$db/queries/pluginRegistry.ts';
import { redactSecrets } from '$lib/server/mcp/redact.ts';
import { toMcpDatabase, toMcpInstance } from '$lib/server/mcp/mappers.ts';
import { toToolResult } from '$lib/server/mcp/serialize.ts';
import {
  createDnsTransportResolver,
  overrideDnsTransportResolverForTest,
  type DnsRecordType,
  type DnsTransportResolver,
} from '$lib/server/security/dnsTransport.ts';
import type { SecurityPostureSummaryResponse, WireDnsTransportEvidence } from '$lib/server/security/responses.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { PluginManifest } from '$shared/plugins/index.ts';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous JSON-RPC test assertions intentionally traverse dynamic response bodies
type JsonRpcBody = any;

const MCP_PLUGIN_MANIFEST: PluginManifest = {
  apiVersion: '1',
  id: 'com.example.mcp',
  name: 'MCP Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['read:sync-preview'],
};

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

function seedDnsInstance(url: string, apiKey: string): number {
  return arrInstancesQueries.create({
    name: `dns-radarr ${crypto.randomUUID()}`,
    type: 'radarr',
    url,
    apiKey,
    apiKeyFingerprint: 'dns-fingerprint',
    enabled: true,
  });
}

function dnsAggregate(evidence: WireDnsTransportEvidence): Omit<WireDnsTransportEvidence, 'source'> {
  const { source: _source, ...aggregate } = evidence;
  return aggregate;
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

function withPrivatePluginFields(
  record: PluginRegistryRecord,
  privatePath: string,
  rawSecret: string
): PluginRegistryRecord {
  const privateFields = {
    sourceDir: privatePath,
    source_dir: privatePath,
    manifest_json: JSON.stringify({ token: rawSecret }),
    token: rawSecret,
  };
  return {
    ...record,
    ...privateFields,
    manifest: { ...record.manifest, ...privateFields },
  } as unknown as PluginRegistryRecord;
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

migratedTest('tools/list returns 10 read-only tools including closed-input list_plugins', async () => {
  const body = await rpcBody('tools/list');
  const tools = body.result.tools as Array<{
    name: string;
    description: string;
    inputSchema: { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
    annotations: { readOnlyHint: boolean };
  }>;
  assertEquals(tools.length, 10);
  for (const tool of tools) {
    assertEquals(tool.annotations.readOnlyHint, true);
    assertExists(tool.inputSchema);
  }
  const names = tools.map((tool) => tool.name);
  assert(names.includes('list_instances'));
  assert(names.includes('list_plugins'));
  assert(names.includes('preview_sync'));
  const listPluginsTool = tools.find((tool) => tool.name === 'list_plugins');
  assertExists(listPluginsTool);
  assertEquals(listPluginsTool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  assert(listPluginsTool.description.includes('raw manifests omitted'));
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

migratedTest('tools/call list_plugins returns the feature-off empty response', async () => {
  const pluginsConfig = config as unknown as { pluginsEnabled: boolean };
  const original = pluginsConfig.pluginsEnabled;
  pluginsConfig.pluginsEnabled = false;
  try {
    const body = await rpcBody('tools/call', { name: 'list_plugins', arguments: {} });
    assertEquals(body.result.isError, false);
    assertEquals(JSON.parse(body.result.content[0].text), { pluginsEnabled: false, items: [] });
  } finally {
    pluginsConfig.pluginsEnabled = original;
  }
});

migratedTest('tools/call list_plugins exposes only the redacted public plugin shape', async () => {
  const pluginsConfig = config as unknown as { pluginsEnabled: boolean };
  const original = pluginsConfig.pluginsEnabled;
  pluginsConfig.pluginsEnabled = true;
  try {
    await pluginRegistryQueries.reconcile([{ manifest: MCP_PLUGIN_MANIFEST }]);

    const record = pluginRegistryQueries.get('1', 'com.example.mcp');
    assertExists(record);
    const queries = pluginRegistryQueries as unknown as { list: typeof pluginRegistryQueries.list };
    const originalList = queries.list;
    const privatePath = '/tmp/private-plugin-root/com.example.mcp';
    const rawSecret = 'RAW-MCP-PLUGIN-TOKEN-MUST-NOT-LEAK';
    queries.list = () => [withPrivatePluginFields(record, privatePath, rawSecret)];

    let body: JsonRpcBody;
    try {
      body = await rpcBody('tools/call', { name: 'list_plugins', arguments: {} });
    } finally {
      queries.list = originalList;
    }
    assertEquals(body.result.isError, false);
    const payload = JSON.parse(body.result.content[0].text) as {
      pluginsEnabled: boolean;
      items: Array<{ manifest: { id: string } }>;
    };
    assertEquals(payload.pluginsEnabled, true);
    assertEquals(payload.items[0].manifest.id, 'com.example.mcp');
    const keys = collectKeys(payload);
    assert(!keys.has('sourceDir'));
    assert(!keys.has('source_dir'));
    assert(!keys.has('manifest_json'));
    const serialized = JSON.stringify(body);
    assert(!serialized.includes(privatePath));
    assert(!serialized.includes(rawSecret));
  } finally {
    pluginsConfig.pluginsEnabled = original;
  }
});

migratedTest('tools/call list_plugins converts service failures to a safe domain error', async () => {
  const pluginsConfig = config as unknown as { pluginsEnabled: boolean };
  const queries = pluginRegistryQueries as unknown as { list: typeof pluginRegistryQueries.list };
  const originalEnabled = pluginsConfig.pluginsEnabled;
  const originalList = queries.list;
  pluginsConfig.pluginsEnabled = true;
  queries.list = () => {
    throw new Error('database secret that must not leak');
  };
  try {
    const body = await rpcBody('tools/call', { name: 'list_plugins', arguments: {} });
    assertEquals(body.result.isError, true);
    const serialized = JSON.stringify(body);
    assert(serialized.includes('Unable to list plugins'));
    assert(!serialized.includes('database secret'));
  } finally {
    queries.list = originalList;
    pluginsConfig.pluginsEnabled = originalEnabled;
  }
});

migratedTest('list_instances: type and enabledOnly compose (AND)', async () => {
  const enabledId = seedInstance('radarr');
  arrInstancesQueries.create({
    name: `radarr-disabled ${crypto.randomUUID()}`,
    type: 'radarr',
    url: 'http://127.0.0.1:9',
    apiKey: 'k',
    apiKeyFingerprint: 'fp',
    enabled: false,
  });
  const byType = await rpcBody('tools/call', { name: 'list_instances', arguments: { type: 'radarr' } });
  assertEquals(JSON.parse(byType.result.content[0].text).length, 2);

  const enabledOnly = await rpcBody('tools/call', {
    name: 'list_instances',
    arguments: { type: 'radarr', enabledOnly: true },
  });
  const rows = JSON.parse(enabledOnly.result.content[0].text) as Array<{ id: number }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].id, enabledId);
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

migratedTest('get_config_health fleet returns a valid summary', async () => {
  const health = await rpcBody('tools/call', { name: 'get_config_health', arguments: {} });
  assertEquals(health.result.isError, false);
  assertExists(JSON.parse(health.result.content[0].text).totals);
});

migratedTest('security posture tool and resource share singleton DNS aggregates without leaking inputs', async () => {
  const configuredUrl = 'http://mcp-dns.example.test:7878/api?access=full-url-secret';
  const apiKey = 'mcp-success-api-key-secret';
  const rawIpv4 = ['8.8.8.8', '10.20.30.40'] as const;
  const rawIpv6 = ['2606:4700:4700::1111', 'fd00::1234'] as const;
  const lookups: DnsRecordType[] = [];
  seedDnsInstance(configuredUrl, apiKey);

  const resolver = createDnsTransportResolver({
    resolveDns: (_hostname, recordType) => {
      lookups.push(recordType);
      return Promise.resolve(recordType === 'A' ? rawIpv4 : rawIpv6);
    },
  });
  const restore = overrideDnsTransportResolverForTest(resolver);
  try {
    const toolBody = await rpcBody('tools/call', { name: 'get_security_posture', arguments: {} });
    const resourceBody = await rpcBody('resources/read', { uri: 'praxrr://security-posture' });
    assertEquals(toolBody.result.isError, false);

    const tool = JSON.parse(toolBody.result.content[0].text) as SecurityPostureSummaryResponse;
    const resource = JSON.parse(resourceBody.result.contents[0].text) as SecurityPostureSummaryResponse;
    const toolDns = tool.transport[0].dns;
    const resourceDns = resource.transport[0].dns;

    assertEquals(toolDns, {
      outcome: 'resolved',
      source: 'fresh',
      ipv4: { loopback: 0, private: 1, linkLocal: 0, public: 1, special: 0 },
      ipv6: { loopback: 0, private: 1, linkLocal: 0, public: 1, special: 0 },
      retainedCount: 4,
      observedAt: toolDns.observedAt,
      incomplete: false,
      truncated: false,
      addressClassesChanged: false,
    });
    assertEquals(resourceDns.source, 'cache');
    assertEquals(dnsAggregate(resourceDns), dnsAggregate(toolDns));
    assertEquals(lookups, ['A', 'AAAA']);

    const serialized = JSON.stringify({ toolBody, resourceBody });
    for (const rawAddress of [...rawIpv4, ...rawIpv6]) assert(!serialized.includes(rawAddress));
    assert(!serialized.includes(configuredUrl));
    assert(!serialized.includes('full-url-secret'));
    assert(!serialized.includes(apiKey));
  } finally {
    restore();
  }
});

migratedTest('security posture tool and resource degrade DNS failures identically without leaking errors', async () => {
  const configuredUrl = 'http://mcp-failure.example.test:7878/private/path?secret=url-secret';
  const apiKey = 'mcp-failure-api-key-secret';
  const resolverError = 'resolver exploded for 198.51.100.77 with internal details';
  seedDnsInstance(configuredUrl, apiKey);

  const resolver: DnsTransportResolver = {
    observe: () => Promise.reject(new Error(resolverError)),
    reset: () => undefined,
  };
  const restore = overrideDnsTransportResolverForTest(resolver);
  try {
    const toolBody = await rpcBody('tools/call', { name: 'get_security_posture', arguments: {} });
    const resourceBody = await rpcBody('resources/read', { uri: 'praxrr://security-posture' });
    assertEquals(toolBody.result.isError, false);

    const tool = JSON.parse(toolBody.result.content[0].text) as SecurityPostureSummaryResponse;
    const resource = JSON.parse(resourceBody.result.contents[0].text) as SecurityPostureSummaryResponse;
    const expectedFailure: WireDnsTransportEvidence = {
      outcome: 'failed',
      source: 'none',
      ipv4: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
      ipv6: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
      retainedCount: 0,
      observedAt: null,
      incomplete: true,
      truncated: false,
      addressClassesChanged: false,
    };
    assertEquals(tool.transport[0].dns, expectedFailure);
    assertEquals(resource.transport[0].dns, expectedFailure);

    const serialized = JSON.stringify({ toolBody, resourceBody });
    assert(!serialized.includes(resolverError));
    assert(!serialized.includes('198.51.100.77'));
    assert(!serialized.includes(configuredUrl));
    assert(!serialized.includes('url-secret'));
    assert(!serialized.includes(apiKey));
  } finally {
    restore();
  }
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

// ============================================================================
// Mapper-level redaction (feeds a REAL raw secret through the whitelist + serializer)
// ============================================================================

Deno.test('toMcpInstance + toToolResult drop a raw api_key and keep the fingerprint', () => {
  const instance = {
    id: 1,
    name: 'radarr',
    type: 'radarr',
    url: 'http://x',
    external_url: null,
    api_key_fingerprint: 'fp-xyz',
    api_key: 'RAW-API-KEY-VALUE',
    tags: null,
    enabled: 1,
    source: 'ui',
    detected_version: null,
    detected_at: null,
    created_at: 't',
    updated_at: 't',
  } as ArrInstance;
  const wire = toMcpInstance(instance);
  assert(!Object.keys(wire).includes('api_key'));
  assertEquals(wire.api_key_fingerprint, 'fp-xyz');
  assert(!JSON.stringify(toToolResult(wire)).includes('RAW-API-KEY-VALUE'));
});

Deno.test('toMcpDatabase + toToolResult drop a raw personal_access_token', () => {
  const db = {
    id: 1,
    uuid: 'u',
    name: 'db',
    repository_url: 'http://x',
    local_path: '/x',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    personal_access_token: 'RAW-GIT-PAT',
    has_personal_access_token: 1,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: 't',
    updated_at: 't',
  } as DatabaseInstance;
  const wire = toMcpDatabase(db);
  assert(!Object.keys(wire).includes('personal_access_token'));
  assertEquals(wire.has_personal_access_token, true);
  assert(!JSON.stringify(toToolResult(wire)).includes('RAW-GIT-PAT'));
});
