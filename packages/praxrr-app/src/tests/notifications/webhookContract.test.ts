/**
 * Contract test: the generic webhook payload must match `NotificationWebhookPayload` in
 * docs/api/v1/schemas/notifications.yaml, and its HMAC signature must verify independently.
 */

import { assert, assertEquals, assertMatch } from '@std/assert';
import { createHmac } from 'node:crypto';
import { parse } from '@std/yaml';
import { deliveryTiming } from '$notifications/base/delivery.ts';
import { buildWebhookPayload, WEBHOOK_PAYLOAD_VERSION } from '$notifications/notifiers/webhook/payload.ts';
import { webhookProvider } from '$notifications/notifiers/webhook/provider.ts';
import { parseCustomHeaders, signWebhookBody } from '$notifications/notifiers/webhook/signature.ts';
import type { Notification } from '$notifications/types.ts';

interface PropertySchema {
  type: string | string[];
  const?: unknown;
  enum?: unknown[];
  format?: string;
}

interface ObjectSchema {
  type: string;
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, PropertySchema>;
}

const schemaPath = new URL('../../../../../docs/api/v1/schemas/notifications.yaml', import.meta.url);
const schema = (parse(Deno.readTextFileSync(schemaPath)) as Record<string, ObjectSchema>).NotificationWebhookPayload;

const WITH_CONTEXT: Notification = {
  type: 'sync.failed',
  generic: { title: 'Sync failed', message: 'Radarr 4K: 2 sections failed' },
  context: { instanceId: 3, instanceName: 'Radarr 4K', arrType: 'radarr' },
  occurredAt: '2026-10-20T16:00:00.000Z',
};

const WITHOUT_CONTEXT: Notification = { type: 'canary.promoted' };

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/** Minimal validator for the subset of JSON Schema the payload schema uses. */
function assertMatchesSchema(payload: Record<string, unknown>): void {
  assertEquals(schema.type, 'object');
  assertEquals(schema.additionalProperties, false);
  assertEquals(Object.keys(payload).sort(), [...schema.required].sort(), 'payload keys must equal schema required');
  assertEquals(Object.keys(schema.properties).sort(), [...schema.required].sort(), 'every property is required');

  for (const [key, property] of Object.entries(schema.properties)) {
    const value = payload[key];
    const allowed = Array.isArray(property.type) ? property.type : [property.type];
    const actual = jsonType(value);
    assert(
      allowed.includes(actual) || (actual === 'integer' && allowed.includes('number')),
      `${key}: ${actual} not in ${allowed.join('|')}`
    );
    if ('const' in property) assertEquals(value, property.const, `${key} const`);
    if (property.enum) assert(property.enum.includes(value), `${key}: ${String(value)} not in enum`);
    if (property.format === 'date-time' && typeof value === 'string') {
      assertMatch(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    }
    if (property.format === 'uuid' && typeof value === 'string') {
      assertMatch(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  }
}

Deno.test('webhook contract: schema version const matches WEBHOOK_PAYLOAD_VERSION', () => {
  assertEquals(schema.properties.version.const, WEBHOOK_PAYLOAD_VERSION);
});

Deno.test('webhook contract: payload with instance context matches the OpenAPI schema', () => {
  const payload = buildWebhookPayload(WITH_CONTEXT);
  assertMatchesSchema(payload as unknown as Record<string, unknown>);
  assertEquals(payload.severity, 'error');
  assertEquals(payload.instanceId, 3);
  assertEquals(payload.occurredAt, '2026-10-20T16:00:00.000Z');
});

Deno.test('webhook contract: payload without context uses nulls and still matches the schema', () => {
  const payload = buildWebhookPayload(WITHOUT_CONTEXT);
  assertMatchesSchema(payload as unknown as Record<string, unknown>);
  assertEquals(payload.instanceId, null);
  assertEquals(payload.instanceName, null);
  assertEquals(payload.arrType, null);
  assertEquals(payload.severity, 'success');
  assert(!Number.isNaN(Date.parse(payload.occurredAt)));
});

Deno.test('webhook contract: every severity value produced is in the schema enum', () => {
  for (const type of ['sync.failed', 'sync.partial', 'drift.detected', 'upgrade.success', 'pcd.linked']) {
    const payload = buildWebhookPayload({ type });
    assert(schema.properties.severity.enum?.includes(payload.severity), `${type} → ${payload.severity}`);
  }
});

Deno.test('webhook contract: delivery ids are unique per payload', () => {
  assert(buildWebhookPayload(WITH_CONTEXT).id !== buildWebhookPayload(WITH_CONTEXT).id);
});

/** Independent receiver-side verification using WebCrypto directly. */
async function verifySignature(secret: string, timestamp: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const hex = signature.replace(/^sha256=/, '');
  const bytes = new Uint8Array((hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));
  return await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${body}`));
}

Deno.test('webhook contract: signature over the received body verifies with the shared secret', async () => {
  const secret = 'whsec_contract';
  const result = webhookProvider.validate({ url: 'https://receiver.example.com/hook', secret, headers: '' });
  assert(result.ok);

  const originalFetch = globalThis.fetch;
  const originalSleep = deliveryTiming.sleep;
  let received: { body: string; headers: Headers } | undefined;
  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    received = { body: String(init?.body), headers: new Headers(init?.headers) };
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  deliveryTiming.sleep = () => Promise.resolve();
  try {
    await webhookProvider.create(result.config).notify(WITH_CONTEXT);
  } finally {
    globalThis.fetch = originalFetch;
    deliveryTiming.sleep = originalSleep;
  }

  assert(received);
  const timestamp = received.headers.get('x-praxrr-timestamp') ?? '';
  const signature = received.headers.get('x-praxrr-signature') ?? '';
  assertMatch(signature, /^sha256=[0-9a-f]{64}$/);
  assert(Math.abs(Number(timestamp) - Date.now() / 1000) < 60, 'timestamp is current unix seconds');
  assert(await verifySignature(secret, timestamp, received.body, signature), 'signature must verify');
  assert(!(await verifySignature('wrong-secret', timestamp, received.body, signature)));
  assert(!(await verifySignature(secret, timestamp, `${received.body} `, signature)), 'tampered body must fail');

  assertMatchesSchema(JSON.parse(received.body));
  assertEquals(received.headers.get('x-praxrr-event'), 'sync.failed');
});

Deno.test('webhook contract: signWebhookBody equals an independent node:crypto HMAC of "<ts>.<body>"', async () => {
  const body = JSON.stringify(buildWebhookPayload(WITH_CONTEXT));
  const expected = `sha256=${createHmac('sha256', 'key').update(`1700000000.${body}`).digest('hex')}`;
  assertEquals(await signWebhookBody('key', '1700000000', body), expected);
});

Deno.test('webhook contract: custom header parsing preserves names and rejects CR/LF injection', () => {
  const parsed = parseCustomHeaders('X-Api-Key:  abc:def  \r\n\r\nAuthorization: Bearer t');
  assert(parsed.ok);
  assertEquals(parsed.headers, { 'X-Api-Key': 'abc:def', Authorization: 'Bearer t' });

  const injected = parseCustomHeaders('X-Ok: a\u0000b');
  assert(!injected.ok);
  const duplicate = parseCustomHeaders('X-A: 1\nx-a: 2');
  assert(!duplicate.ok);
});
