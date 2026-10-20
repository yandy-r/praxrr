import { assert, assertEquals } from '@std/assert';
import { classifyProbeStatus, nextBackoffMs, parseLiveEvent, retryAfterMs } from '$lib/client/events/reconnect.ts';
import { decideJobToast, SeenSet, ToastCoalescer } from '$lib/client/events/toastPolicy.ts';
import type { LiveHelloEvent, LiveJobFinishedEvent } from '$shared/events/types.ts';

function finished(overrides: Partial<LiveJobFinishedEvent> = {}): LiveJobFinishedEvent {
  return {
    type: 'job.finished',
    jobId: 7,
    jobType: 'arr.sync',
    source: 'manual',
    displayName: 'Sync Radarr',
    instanceId: 1,
    arrType: 'radarr',
    databaseId: null,
    status: 'success',
    runStatus: 'success',
    rescheduled: false,
    nextRunAt: null,
    runId: 3,
    failureCode: null,
    durationMs: 120,
    finishedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

const noSync = { syncHistoryId: null, syncStatus: null, base: '/base' };

Deno.test('T-C1: nextBackoffMs doubles from 1 s, caps at 30 s, and bounds jitter', () => {
  const half = () => 0.5;
  assertEquals(
    [0, 1, 2, 3, 4, 5, 6, 10].map((a) => nextBackoffMs(a, half)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]
  );
  assertEquals(nextBackoffMs(-3, half), 1000);
  for (let attempt = 0; attempt < 12; attempt++) {
    assert(nextBackoffMs(attempt, () => 0) >= 1000);
    assert(nextBackoffMs(attempt, () => 1) <= 36_000);
  }
});

Deno.test('retryAfterMs parses integer seconds and caps at 300 s', () => {
  assertEquals(retryAfterMs('30'), 30_000);
  assertEquals(retryAfterMs('0'), 0);
  assertEquals(retryAfterMs('9999'), 300_000);
  assertEquals(retryAfterMs(null), null);
  assertEquals(retryAfterMs('1.5'), null);
  assertEquals(retryAfterMs('-1'), null);
  assertEquals(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT'), null);
});

Deno.test('T-C2: parseLiveEvent rejects malformed and unknown payloads', () => {
  assertEquals(parseLiveEvent('{not json'), null);
  assertEquals(parseLiveEvent('[]'), null);
  assertEquals(parseLiveEvent('null'), null);
  assertEquals(parseLiveEvent('{"bootId":"x"}'), null);
  assertEquals(parseLiveEvent('{"type":"job.exploded"}'), null);
  const { jobId: _jobId, ...withoutJobId } = finished();
  assertEquals(parseLiveEvent(JSON.stringify(withoutJobId)), null);
  assertEquals(parseLiveEvent('{"type":"sync.recorded","syncHistoryId":"1"}'), null);

  const hello: LiveHelloEvent = { type: 'hello', bootId: 'b', headId: '', serverTime: 'now', heartbeatMs: 20_000 };
  assertEquals(parseLiveEvent(JSON.stringify(hello)), hello);
  assertEquals(parseLiveEvent(JSON.stringify(finished())), finished());
});

Deno.test('T-C3: classifyProbeStatus', () => {
  assertEquals(classifyProbeStatus(204), 'ok');
  assertEquals(classifyProbeStatus(401), 'stop');
  assertEquals(classifyProbeStatus(403), 'stop');
  assertEquals(classifyProbeStatus(429), 'backoff');
  assertEquals(classifyProbeStatus(503), 'backoff');
});

Deno.test('T-C4: decideJobToast covers manual statuses', () => {
  const ctx = { syncHistoryId: 42, syncStatus: null, base: '/base' };
  const href = '/base/sync-history/42';
  assertEquals(decideJobToast(finished(), ctx), {
    kind: 'toast',
    type: 'success',
    message: 'Sync Radarr finished',
    sticky: false,
    href,
  });
  assertEquals(decideJobToast(finished({ runStatus: 'success' }), { ...ctx, syncStatus: 'partial' }), {
    kind: 'toast',
    type: 'warning',
    message: 'Sync Radarr partially succeeded',
    sticky: false,
    href,
  });
  assertEquals(decideJobToast(finished({ runStatus: 'failure', status: 'failed' }), ctx), {
    kind: 'toast',
    type: 'error',
    message: 'Sync Radarr failed',
    sticky: true,
    href,
  });
  assertEquals(decideJobToast(finished({ runStatus: 'skipped' }), ctx), {
    kind: 'toast',
    type: 'info',
    message: 'Sync Radarr skipped',
    sticky: false,
    href,
  });
  assertEquals(decideJobToast(finished({ runStatus: 'cancelled', status: 'cancelled' }), ctx), {
    kind: 'toast',
    type: 'info',
    message: 'Sync Radarr cancelled',
    sticky: false,
    href,
  });
});

Deno.test('T-C4: decideJobToast background policy, rescheduled and href fallback', () => {
  assertEquals(decideJobToast(finished({ rescheduled: true, runStatus: 'failure' }), noSync), { kind: 'none' });
  assertEquals(decideJobToast(finished({ source: 'schedule' }), noSync), { kind: 'none' });
  assertEquals(decideJobToast(finished({ source: 'schedule', runStatus: 'failure', failureCode: null }), noSync), {
    kind: 'toast',
    type: 'error',
    message: 'Sync Radarr failed',
    sticky: true,
    href: '/base/settings/jobs',
  });
  assertEquals(
    decideJobToast(
      finished({ source: 'schedule', jobType: 'backup.create', displayName: 'Backup', runStatus: 'failure' }),
      noSync
    ),
    { kind: 'none' }
  );
});

Deno.test('T-C5: ToastCoalescer blocks repeat background failures inside the window', () => {
  let now = 1_000_000;
  const coalescer = new ToastCoalescer(60_000, () => now);
  const failure = finished({ source: 'schedule', runStatus: 'failure' });
  assert(coalescer.allow(failure));
  assertEquals(coalescer.allow(failure), false);
  assert(coalescer.allow({ ...failure, instanceId: 2 }));
  assert(coalescer.allow(finished({ runStatus: 'failure' })));
  assert(coalescer.allow(finished({ runStatus: 'failure' })));
  now += 61_000;
  assert(coalescer.allow(failure));
});

Deno.test('T-C6: SeenSet.addOnce dedupes with FIFO eviction', () => {
  const seen = new SeenSet(2);
  assert(seen.addOnce('7:1'));
  assertEquals(seen.addOnce('7:1'), false);
  assert(seen.addOnce('7:2'));
  assert(seen.addOnce('7:3'));
  assert(seen.addOnce('7:1'));
  assertEquals(seen.addOnce('7:3'), false);
});
