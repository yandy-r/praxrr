// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import type { Action } from '@sveltejs/kit';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries, type ArrInstanceSource } from '$db/queries/arrInstances.ts';
import { cache, getArrLibraryCachePrefix } from '$cache/cache.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { eventBus } from '$lib/server/events/bus.ts';
import type { LiveEventEnvelope } from '$lib/server/events/bus.ts';
import { logger } from '$logger/logger.ts';
import { actions as listActions } from '../../routes/arr/+page.server.ts';
import { actions as settingsActions } from '../../routes/arr/[id]/settings/+page.server.ts';

type ActionEvent = Parameters<Action>[0];
type ActionFailure = { status: number; data?: { error?: string } };
type RedirectLike = { status: number; location: string };

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/arr-instance-delete-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      const originals = { warn: logger.warn, info: logger.info, error: logger.error };
      logger.warn = async () => {};
      logger.info = async () => {};
      logger.error = async () => {};

      // Isolate from the developer's own *_INSTANCE_* variables; restored in finally.
      const savedEnv = Object.entries(Deno.env.toObject()).filter(([key]) => ARR_INSTANCE_ENV_KEY_RE.test(key));
      for (const [key] of savedEnv) Deno.env.delete(key);

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        for (const key of Object.keys(Deno.env.toObject())) {
          if (ARR_INSTANCE_ENV_KEY_RE.test(key)) Deno.env.delete(key);
        }
        for (const [key, value] of savedEnv) Deno.env.set(key, value);
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        Object.assign(logger, originals);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

const ARR_INSTANCE_ENV_KEY_RE = /^[A-Z]+_INSTANCE_/;

function createInstance(source: ArrInstanceSource, name = `radarr ${crypto.randomUUID()}`): number {
  const id = arrInstancesQueries.create({
    name,
    type: 'radarr',
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
    source,
  });
  jobQueueQueries.create({
    jobType: 'arr.upgrade',
    runAt: new Date(Date.now() + 3_600_000).toISOString(),
    payload: { instanceId: id },
    dedupeKey: `arr.upgrade:${id}`,
  });
  return id;
}

/** Env instance still declared by the current environment (matched by name). */
function createDeclaredEnvInstance(): number {
  const name = `env radarr ${crypto.randomUUID()}`;
  Deno.env.set('RADARR_INSTANCE_URL_1', 'http://127.0.0.1:9');
  Deno.env.set('RADARR_INSTANCE_API_KEY_1', 'declared-env-key');
  Deno.env.set('RADARR_INSTANCE_NAME_1', name);
  return createInstance('env', name);
}

function instanceJobCount(id: number): number {
  return jobQueueQueries.listByJobTypes(['arr.upgrade']).filter((job) => job.payload?.instanceId === id).length;
}

function listDeleteEvent(id: number): ActionEvent {
  const body = new FormData();
  body.set('id', String(id));
  return {
    params: {},
    request: new Request('http://localhost/arr', { method: 'POST', body }),
  } as never;
}

function settingsDeleteEvent(id: number): ActionEvent {
  return { params: { id: String(id) } } as never;
}

async function runAction(action: Action, event: ActionEvent): Promise<ActionFailure | RedirectLike> {
  try {
    return (await action(event)) as ActionFailure;
  } catch (error) {
    if (error && typeof error === 'object' && 'location' in error) return error as RedirectLike;
    throw error;
  }
}

migratedTest('/arr list delete refuses env-managed instances and keeps their jobs', async () => {
  const id = createDeclaredEnvInstance();

  const result = (await runAction(listActions.delete, listDeleteEvent(id))) as ActionFailure;

  assertEquals(result.status, 403);
  assert(arrInstancesQueries.getById(id), 'env instance must survive');
  assertEquals(instanceJobCount(id), 1);
});

migratedTest('/arr list delete allows env rows whose variables were removed', async () => {
  const id = createInstance('env');

  const result = (await runAction(listActions.delete, listDeleteEvent(id))) as RedirectLike;

  assertEquals(result.status, 303);
  assertEquals(arrInstancesQueries.getById(id), undefined);
  assertEquals(instanceJobCount(id), 0);
});

migratedTest('/arr list delete removes UI-managed instances, their jobs and library cache', async () => {
  const id = createInstance('ui');
  const name = arrInstancesQueries.getById(id)?.name;
  const cacheKey = `${getArrLibraryCachePrefix(id)}movies`;
  cache.set(cacheKey, ['cached'], 60);
  const events: LiveEventEnvelope[] = [];
  const unsubscribe = eventBus.subscribe((envelope) => events.push(envelope));

  try {
    const result = (await runAction(listActions.delete, listDeleteEvent(id))) as RedirectLike;

    assertEquals(result.status, 303);
    assertEquals(result.location, '/arr');
    assertEquals(arrInstancesQueries.getById(id), undefined);
    assertEquals(instanceJobCount(id), 0);
    assertEquals(cache.get(cacheKey), undefined);

    // Cancel event is published after the row is gone but still carries the instance identity.
    const cancelled = events.map((envelope) => envelope.event).find((event) => event.type === 'job.finished');
    assert(cancelled && cancelled.type === 'job.finished');
    assertEquals(cancelled.status, 'cancelled');
    assertEquals(cancelled.arrType, 'radarr');
    assertEquals(cancelled.displayName.endsWith(` - ${name}`), true);
  } finally {
    unsubscribe();
    cache.deleteByPrefix(getArrLibraryCachePrefix(id));
  }
});

migratedTest('/arr list delete rolls back jobs and publishes nothing when the row delete fails', async () => {
  const id = createInstance('ui');
  const events: LiveEventEnvelope[] = [];
  const unsubscribe = eventBus.subscribe((envelope) => events.push(envelope));
  const originalDelete = arrInstancesQueries.delete;
  arrInstancesQueries.delete = () => false;

  try {
    const result = (await runAction(listActions.delete, listDeleteEvent(id))) as ActionFailure;

    assertEquals(result.status, 500);
    assert(arrInstancesQueries.getById(id));
    assertEquals(instanceJobCount(id), 1);
    assertEquals(
      events.some((envelope) => envelope.event.type === 'job.finished'),
      false
    );
  } finally {
    arrInstancesQueries.delete = originalDelete;
    unsubscribe();
  }
});

migratedTest('/arr list delete returns 404 for unknown instances', async () => {
  const result = (await runAction(listActions.delete, listDeleteEvent(987654))) as ActionFailure;
  assertEquals(result.status, 404);
});

migratedTest('settings delete refuses env-managed instances and keeps their jobs', async () => {
  const id = createDeclaredEnvInstance();

  const result = (await runAction(settingsActions.delete, settingsDeleteEvent(id))) as ActionFailure;

  assertEquals(result.status, 403);
  assert(arrInstancesQueries.getById(id), 'env instance must survive');
  assertEquals(instanceJobCount(id), 1);
});

migratedTest('settings delete removes UI-managed instances and their jobs', async () => {
  const id = createInstance('ui');

  const result = (await runAction(settingsActions.delete, settingsDeleteEvent(id))) as RedirectLike;

  assertEquals(result.status, 303);
  assertEquals(arrInstancesQueries.getById(id), undefined);
  assertEquals(instanceJobCount(id), 0);
});
