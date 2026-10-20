import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { EventBus, eventBus, type LiveEventEnvelope } from '$lib/server/events/bus.ts';
import { _jobBase, publishCanaryUpdated, publishJobFinished } from '$lib/server/events/publish.ts';
import type { LiveDomainEvent } from '$shared/events/types.ts';

const FORBIDDEN_KEYS = ['error', 'payload', 'stateToken', 'nextToken', 'canaryError', 'url', 'apiKey'] as const;

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

function publishMany(bus: EventBus, count: number): void {
  for (let i = 1; i <= count; i++) bus.publish(driftEvent(i));
}

function assertNoForbiddenKeys(value: unknown): void {
  const json = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    assert(!json.includes(`"${key}"`), `event leaked forbidden key "${key}": ${json}`);
  }
}

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/events-bus-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

Deno.test('T-B1: a throwing listener does not block later listeners or throw from publish', () => {
  const bus = new EventBus(4, 'boottest');
  const received: LiveEventEnvelope[] = [];
  bus.subscribe(() => {
    throw new Error('listener boom');
  });
  bus.subscribe((envelope) => received.push(envelope));

  bus.publish(driftEvent(1));

  assertEquals(received.length, 1);
  assertEquals(received[0].id, 'boottest-1');
});

Deno.test('T-B2: unsubscribe is idempotent', () => {
  const bus = new EventBus(4, 'boottest');
  const unsubscribe = bus.subscribe(() => {});
  assertEquals(bus.subscriberCount(), 1);

  unsubscribe();
  unsubscribe();

  assertEquals(bus.subscriberCount(), 0);
});

Deno.test('T-B3: ids are sequential per boot and the ring keeps only the last capacity events', () => {
  const bus = new EventBus(4, 'boottest');
  const ids: string[] = [];
  bus.subscribe((envelope) => ids.push(envelope.id));
  assertEquals(bus.headId(), '');

  publishMany(bus, 6);

  assertEquals(ids, ['boottest-1', 'boottest-2', 'boottest-3', 'boottest-4', 'boottest-5', 'boottest-6']);
  assertEquals(bus.headId(), 'boottest-6');
  const replay = bus.replaySince('boottest-2');
  assertEquals(replay.kind, 'replay');
  if (replay.kind === 'replay') {
    assertEquals(
      replay.events.map((envelope) => envelope.id),
      ['boottest-3', 'boottest-4', 'boottest-5', 'boottest-6']
    );
  }
});

Deno.test('T-B4: replaySince covers fresh, replay, foreign boot, gap, future and garbage ids', () => {
  const bus = new EventBus(4, 'boottest');
  assertEquals(bus.replaySince(null), { kind: 'replay', events: [] });
  assertEquals(bus.replaySince(''), { kind: 'replay', events: [] });

  publishMany(bus, 3);
  const replay = bus.replaySince('boottest-2');
  assertEquals(replay.kind, 'replay');
  if (replay.kind === 'replay') {
    assertEquals(
      replay.events.map((envelope) => envelope.seq),
      [3]
    );
  }
  assertEquals(bus.replaySince('boottest-3'), { kind: 'replay', events: [] });
  assertEquals(bus.replaySince('other-1'), { kind: 'resync', reason: 'boot' });

  publishMany(bus, 3);
  assertEquals(bus.replaySince('boottest-1'), { kind: 'resync', reason: 'gap' });
  assertEquals(bus.replaySince('boottest-99'), { kind: 'resync', reason: 'boot' });
  assertEquals(bus.replaySince('garbage'), { kind: 'resync', reason: 'boot' });
  assertEquals(bus.replaySince('boottest-'), { kind: 'resync', reason: 'boot' });
});

Deno.test('T-B5: eventBus singleton lives on globalThis', () => {
  const registry = globalThis as typeof globalThis & { [key: symbol]: unknown };
  assertEquals(registry[Symbol.for('praxrr.events.bus')], eventBus);
  assertEquals(eventBus.bootId.length, 8);
  assert(/^[0-9a-z]{8}$/.test(eventBus.bootId));
});

migratedTest('T-B6: job.finished and canary.updated events carry only allow-listed fields', () => {
  const job: JobQueueRecord = {
    id: 41,
    jobType: 'arr.sync',
    status: 'failed',
    runAt: '2026-10-20T00:00:00.000Z',
    payload: {
      instanceId: 999,
      error: 'raw failure text',
      stateToken: 'secret-token',
      url: 'http://radarr.local',
      apiKey: 'secret-key',
    } as JobQueueRecord['payload'],
    source: 'manual',
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 1,
    startedAt: '2026-10-20T00:00:00.000Z',
    finishedAt: '2026-10-20T00:00:01.000Z',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:01.000Z',
  };

  const base = _jobBase(job);
  assertEquals(base.instanceId, 999);
  assertEquals(base.arrType, null);
  assertNoForbiddenKeys(base);

  const rolloutId = canaryRolloutQueries.insert({
    arrType: 'radarr',
    canaryInstanceId: null,
    canaryInstanceName: 'Canary',
    sections: null,
    maxBatchSize: 1,
    partialPolicy: 'gate',
    remainingTargets: [{ instanceId: 7, instanceName: 'Target' }],
    trigger: 'manual',
    startedAt: '2026-10-20T00:00:00.000Z',
    stateToken: 'secret-state-token',
  });
  assert(rolloutId > 0);

  const captured: LiveDomainEvent[] = [];
  const unsubscribe = eventBus.subscribe((envelope) => captured.push(envelope.event));
  try {
    publishJobFinished(job, {
      status: 'failed',
      runStatus: 'failure',
      rescheduled: false,
      nextRunAt: null,
      runId: 3,
      failureCode: null,
      durationMs: 1000,
      finishedAt: '2026-10-20T00:00:01.000Z',
    });
    publishCanaryUpdated(rolloutId);
  } finally {
    unsubscribe();
  }

  const finished = captured.find((event) => event.type === 'job.finished');
  const canary = captured.find((event) => event.type === 'canary.updated');
  assertExists(finished);
  assertExists(canary);
  assertNoForbiddenKeys(finished);
  assertNoForbiddenKeys(canary);
  assert(!JSON.stringify(captured).includes('secret'));
  if (canary.type === 'canary.updated') {
    assertEquals(canary.completedCount, 0);
    assertEquals(canary.remainingCount, 1);
    assertEquals(canary.canaryStatus, null);
  }
});
