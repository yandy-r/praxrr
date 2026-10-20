// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { EventBus, eventBus } from '$lib/server/events/bus.ts';
import { EventConnectionRegistry } from '$lib/server/events/connections.ts';
import { encodeEvent } from '$lib/server/events/sse.ts';
import { createEventStream, type EventStreamOptions } from '$lib/server/events/stream.ts';
import type { LiveDomainEvent } from '$shared/events/types.ts';
import { GET } from '../../routes/api/v1/events/+server.ts';

const decoder = new TextDecoder();

function driftEvent(instanceId: number): LiveDomainEvent {
  return {
    type: 'drift.updated',
    instanceId,
    arrType: 'radarr',
    status: 'in-sync',
    driftedCount: 0,
    missingCount: 0,
    unmanagedCount: 0,
    checkedAt: '2026-10-20T00:00:00.000Z',
  };
}

interface Harness {
  bus: EventBus;
  abort: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  releases: () => number;
  next: () => Promise<string | null>;
}

function open(overrides: Partial<EventStreamOptions> = {}, bus = new EventBus(8, 'teststrm')): Harness {
  const abort = new AbortController();
  let releaseCount = 0;
  const stream = createEventStream({
    bus,
    signal: abort.signal,
    lastEventId: null,
    revalidate: () => true,
    release: () => {
      releaseCount += 1;
    },
    heartbeatMs: 60_000,
    maxLifetimeMs: 60_000,
    ...overrides,
  });
  const reader = stream.getReader();
  return {
    bus,
    abort,
    reader,
    releases: () => releaseCount,
    next: async () => {
      const { value, done } = await reader.read();
      return done ? null : decoder.decode(value);
    },
  };
}

/** Reads past the `retry:` and `hello` preamble. */
async function skipPreamble(h: Harness): Promise<void> {
  assertEquals(await h.next(), 'retry: 5000\n\n');
  assertStringIncludes((await h.next()) ?? '', '"type":"hello"');
}

/** Drains until `done`, failing if it takes longer than `ms`. */
async function readUntilDone(h: Harness, ms = 1000): Promise<string[]> {
  const frames: string[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const frame = await h.next();
    if (frame === null) return frames;
    frames.push(frame);
  }
  throw new Error('stream did not finish in time');
}

Deno.test('T-S1: preamble then live event frames', async () => {
  const h = open();
  assertEquals(await h.next(), 'retry: 5000\n\n');
  const hello = await h.next();
  assert(hello !== null && !hello.startsWith('id:'));
  const parsed = JSON.parse(hello.replace(/^data: /, ''));
  assertEquals(parsed.type, 'hello');
  assertEquals(parsed.bootId, 'teststrm');
  assertEquals(parsed.headId, '');
  assertEquals(parsed.heartbeatMs, 60_000);
  assertEquals(h.bus.subscriberCount(), 1);

  h.bus.publish(driftEvent(7));
  assertEquals(await h.next(), `id: teststrm-1\ndata: ${JSON.stringify(driftEvent(7))}\n\n`);

  h.abort.abort();
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
});

Deno.test('T-S2: heartbeat sends a ping comment', async () => {
  const h = open({ heartbeatMs: 10 });
  await skipPreamble(h);
  assertEquals(await h.next(), ': ping\n\n');
  h.abort.abort();
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
});

Deno.test('T-S3: abort unsubscribes, releases once and finishes the stream', async () => {
  const h = open();
  await skipPreamble(h);
  h.abort.abort();
  h.abort.abort();
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
  assertEquals(await h.next(), null);
  await h.reader.cancel();
  assertEquals(h.releases(), 1);
});

Deno.test('T-S4: reader.cancel unsubscribes and releases once', async () => {
  const h = open();
  await skipPreamble(h);
  await h.reader.cancel();
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
  h.abort.abort();
  assertEquals(h.releases(), 1);
});

Deno.test('T-S5: failed revalidation sends session.expired and closes', async () => {
  const h = open({ heartbeatMs: 10, revalidate: () => false });
  await skipPreamble(h);
  assertEquals(await h.next(), 'data: {"type":"session.expired"}\n\n');
  assertEquals(await h.next(), null);
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
});

Deno.test('T-S6: max lifetime closes the stream', async () => {
  const h = open({ maxLifetimeMs: 20 });
  await skipPreamble(h);
  const started = Date.now();
  assertEquals(await readUntilDone(h, 100), []);
  assert(Date.now() - started < 100);
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
});

Deno.test('T-S7: replays missed events in order, or sends resync for a foreign id', async () => {
  const bus = new EventBus(8, 'teststrm');
  for (let i = 1; i <= 3; i++) bus.publish(driftEvent(i));

  const h = open({ lastEventId: 'teststrm-1' }, bus);
  assertEquals(await h.next(), 'retry: 5000\n\n');
  assertStringIncludes((await h.next()) ?? '', '"headId":"teststrm-3"');
  assertEquals(await h.next(), `id: teststrm-2\ndata: ${JSON.stringify(driftEvent(2))}\n\n`);
  assertEquals(await h.next(), `id: teststrm-3\ndata: ${JSON.stringify(driftEvent(3))}\n\n`);
  bus.publish(driftEvent(4));
  assertEquals(await h.next(), `id: teststrm-4\ndata: ${JSON.stringify(driftEvent(4))}\n\n`);
  h.abort.abort();

  const r = open({ lastEventId: 'zzz-1' }, bus);
  await skipPreamble(r);
  assertEquals(await r.next(), 'data: {"type":"resync","reason":"boot"}\n\n');
  r.abort.abort();
  assertEquals(bus.subscriberCount(), 0);
});

Deno.test('T-S8: a slow consumer is disconnected', () => {
  const h = open({ highWaterMark: 2 });
  for (let i = 1; i <= 10; i++) h.bus.publish(driftEvent(i));
  assertEquals(h.bus.subscriberCount(), 0);
  assertEquals(h.releases(), 1);
});

Deno.test('T-S8b: an already-aborted signal closes immediately', () => {
  const abort = new AbortController();
  abort.abort();
  const bus = new EventBus(8, 'teststrm');
  let releases = 0;
  createEventStream({
    bus,
    signal: abort.signal,
    lastEventId: null,
    revalidate: () => true,
    release: () => {
      releases += 1;
    },
  });
  assertEquals(bus.subscriberCount(), 0);
  assertEquals(releases, 1);
});

Deno.test('T-S9: connection caps per principal and globally', () => {
  const registry = new EventConnectionRegistry(2, 3);
  const a1 = registry.acquire('a');
  const a2 = registry.acquire('a');
  assert(a1.ok && a2.ok);
  assertEquals(registry.acquire('a'), { ok: false, status: 429 });
  const b = registry.acquire('b');
  assert(b.ok);
  assertEquals(registry.acquire('c'), { ok: false, status: 503 });
  assertEquals(registry.acquire('d'), { ok: false, status: 503 });
  a1.release();
  a1.release();
  assertEquals(registry.count(), 2);
  const c = registry.acquire('c');
  assert(c.ok);
  a2.release();
  b.release();
  c.release();
  c.release();
  assertEquals(registry.count(), 0);
  assertEquals(registry.count('a'), 0);
});

Deno.test({
  name: 'T-S10: route returns SSE headers, rejects missing principal, and cleans up on abort',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const before = eventBus.subscriberCount();
    const abort = new AbortController();
    const routeEvent = (principal: unknown) =>
      ({
        request: new Request('http://x/api/v1/events', { signal: abort.signal }),
        url: new URL('http://x/api/v1/events'),
        locals: { session: null, principal },
        getClientAddress: () => '127.0.0.1',
      }) as unknown as Parameters<typeof GET>[0];

    const response = await GET(routeEvent({ kind: 'bypass', scopes: [] }));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
    assertEquals(response.headers.get('Cache-Control'), 'no-cache, no-transform');
    assertEquals(response.headers.get('Connection'), 'keep-alive');
    assertEquals(response.headers.get('X-Accel-Buffering'), 'no');
    assertEquals(eventBus.subscriberCount(), before + 1);

    const unauthorized = await GET(routeEvent(null));
    assertEquals(unauthorized.status, 401);
    assertEquals(await unauthorized.json(), { error: 'Unauthorized' });

    abort.abort();
    assertEquals(eventBus.subscriberCount(), before);
    await response.body?.cancel();
  },
});

Deno.test('T-S11: encodeEvent rejects newline ids and keeps data on one line', () => {
  assertThrows(() => encodeEvent(driftEvent(1), 'bad\nid'), TypeError);
  const frame = decoder.decode(
    encodeEvent({ ...driftEvent(1), checkedAt: 'line1\nline2' } as LiveDomainEvent, 'teststrm-1')
  );
  const lines = frame.split('\n');
  assertEquals(lines.length, 4);
  assert(lines[1].startsWith('data: '));
  assertStringIncludes(lines[1], 'line1\\nline2');
});
