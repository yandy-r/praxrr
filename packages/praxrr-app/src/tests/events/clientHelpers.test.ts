import { assert, assertEquals } from '@std/assert';
import {
  classifyProbeStatus,
  cursorAfterHello,
  helloCursor,
  nextBackoffMs,
  parseLiveEvent,
  retryAfterMs,
} from '$lib/client/events/reconnect.ts';
import { coalesceKey, decideJobToast, SeenSet, ToastCoalescer } from '$lib/client/events/toastPolicy.ts';
import { DebounceScheduler, type DebounceTimers } from '$lib/client/events/debounce.ts';
import { dataUrlPagePath, isLiveDataRequest } from '$lib/client/events/liveFetch.ts';
import { pushAlert } from '$lib/client/alerts/stack.ts';
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
    handedBack: false,
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
  assertEquals(
    decideJobToast(finished({ runStatus: 'failure', status: 'failed' }), { ...ctx, syncStatus: 'partial' }),
    {
      kind: 'toast',
      type: 'warning',
      message: 'Sync Radarr partially succeeded',
      sticky: false,
      href,
    }
  );
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
  assertEquals(decideJobToast(finished({ source: 'schedule', rescheduled: true }), noSync), { kind: 'none' });
  assertEquals(decideJobToast(finished({ rescheduled: true, runStatus: 'skipped' }), noSync), { kind: 'none' });
  const scheduledFailure = finished({ source: 'schedule', rescheduled: true, runStatus: 'failure' });
  assertEquals(decideJobToast(scheduledFailure, noSync), {
    kind: 'toast',
    type: 'error',
    message: 'Sync Radarr failed',
    sticky: true,
    href: '/base/settings/jobs',
  });
  assertEquals(decideJobToast(scheduledFailure, { syncHistoryId: 9, syncStatus: 'partial', base: '/base' }), {
    kind: 'toast',
    type: 'warning',
    message: 'Sync Radarr partially succeeded',
    sticky: false,
    href: '/base/sync-history/9',
  });
  assertEquals(
    decideJobToast(
      finished({
        source: 'schedule',
        jobType: 'pcd.sync',
        displayName: 'Sync DB',
        runStatus: 'failure',
        rescheduled: true,
      }),
      noSync
    ),
    { kind: 'toast', type: 'error', message: 'Sync DB failed', sticky: true, href: '/base/settings/jobs' }
  );
  assertEquals(decideJobToast(finished({ rescheduled: true, runStatus: 'failure' }), noSync), {
    kind: 'toast',
    type: 'error',
    message: 'Sync Radarr failed',
    sticky: true,
    href: '/base/settings/jobs',
  });
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

Deno.test('T-C4: manual hand-back to the schedule still toasts; canary continuations stay quiet', () => {
  // A manual "Sync now" hands its slot back to the recurring schedule: rescheduled + handedBack,
  // so the manual completion toast must survive the rescheduled suppression.
  const handedBack = finished({
    jobType: 'pcd.sync',
    displayName: 'Sync DB',
    instanceId: null,
    arrType: null,
    databaseId: 1,
    status: 'queued',
    rescheduled: true,
    handedBack: true,
    nextRunAt: '2026-10-20T01:00:00.000Z',
  });
  assertEquals(decideJobToast(handedBack, noSync), {
    kind: 'toast',
    type: 'success',
    message: 'Sync DB finished',
    sticky: false,
    href: '/base/settings/jobs',
  });
  assertEquals(decideJobToast({ ...handedBack, runStatus: 'failure', failureCode: 'gitNetwork' }, noSync), {
    kind: 'toast',
    type: 'error',
    message: 'Sync DB failed',
    sticky: true,
    href: '/base/settings/jobs',
  });
  assertEquals(decideJobToast({ ...handedBack, runStatus: 'skipped' }, noSync), {
    kind: 'toast',
    type: 'info',
    message: 'Sync DB skipped',
    sticky: false,
    href: '/base/settings/jobs',
  });
  assertEquals(decideJobToast({ ...handedBack, runStatus: 'cancelled' }, noSync), {
    kind: 'toast',
    type: 'info',
    message: 'Sync DB cancelled',
    sticky: false,
    href: '/base/settings/jobs',
  });

  // A canary continuation is manual and rescheduled on every batch but is NOT a hand-back;
  // it must keep its per-batch silence (and its correlation is not a run history row).
  assertEquals(decideJobToast(finished({ status: 'queued', rescheduled: true, handedBack: false }), noSync), {
    kind: 'none',
  });
  assertEquals(decideJobToast(finished({ status: 'queued', rescheduled: true }), noSync), { kind: 'none' });

  // A scheduled run that merely re-queues itself never sets handedBack.
  assertEquals(decideJobToast(finished({ source: 'schedule', status: 'queued', rescheduled: true }), noSync), {
    kind: 'none',
  });
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

Deno.test('cursorAfterHello keeps same-boot cursors and resets across boots', () => {
  assertEquals(helloCursor({ bootId: 'b1', headId: '' }), 'b1-0');
  assertEquals(helloCursor({ bootId: 'b1', headId: 'b1-4' }), 'b1-4');
  assertEquals(cursorAfterHello(null, { bootId: 'b1', headId: '' }), 'b1-0');
  assertEquals(cursorAfterHello(null, { bootId: 'b1', headId: 'b1-4' }), 'b1-4');
  assertEquals(cursorAfterHello('b1-2', { bootId: 'b1', headId: 'b1-4' }), 'b1-2');
  assertEquals(cursorAfterHello('b0-9', { bootId: 'b1', headId: 'b1-4' }), 'b1-4');
  assertEquals(cursorAfterHello('b0-9', { bootId: 'b1', headId: '' }), 'b1-0');
  assertEquals(cursorAfterHello('garbage', { bootId: 'b1', headId: '' }), 'b1-0');
  assertEquals(cursorAfterHello('a-b-3', { bootId: 'a-b', headId: 'a-b-5' }), 'a-b-3');
});

Deno.test('ToastCoalescer keys on job type, instance and database', () => {
  const coalescer = new ToastCoalescer(60_000, () => 1_000_000);
  const failure = finished({ source: 'schedule', jobType: 'pcd.sync', instanceId: null, runStatus: 'failure' });
  assertEquals(coalesceKey(failure), 'pcd.sync:none:none');
  assertEquals(coalesceKey({ ...failure, instanceId: 4, databaseId: 9 }), 'pcd.sync:4:9');
  assert(coalescer.allow({ ...failure, databaseId: 1 }));
  assertEquals(coalescer.allow({ ...failure, databaseId: 1 }), false);
  assert(coalescer.allow({ ...failure, databaseId: 2 }));
});

Deno.test('pushAlert replaces same-key alerts and caps the stack, dropping oldest non-error first', () => {
  type A = { id: string; type: string; key?: string };
  let stack: A[] = [];
  stack = pushAlert(stack, { id: 'e1', type: 'error', key: 'k' });
  stack = pushAlert(stack, { id: 'e2', type: 'error', key: 'k' });
  assertEquals(
    stack.map((a) => a.id),
    ['e2']
  );
  stack = pushAlert(stack, { id: 's1', type: 'success' });
  stack = pushAlert(stack, { id: 's2', type: 'success' });
  stack = pushAlert(stack, { id: 'e3', type: 'error' });
  stack = pushAlert(stack, { id: 'e4', type: 'error' });
  stack = pushAlert(stack, { id: 'e5', type: 'error' }, 5);
  assertEquals(
    stack.map((a) => a.id),
    ['e2', 's2', 'e3', 'e4', 'e5']
  );
  stack = pushAlert(stack, { id: 'e6', type: 'error' }, 5);
  assertEquals(
    stack.map((a) => a.id),
    ['e2', 'e3', 'e4', 'e5', 'e6']
  );
  stack = pushAlert(stack, { id: 'i1', type: 'info' }, 5);
  assertEquals(
    stack.map((a) => a.id),
    ['e3', 'e4', 'e5', 'e6', 'i1']
  );
});

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: DebounceTimers = {
    now: () => now,
    set: (fn, ms) => {
      pending.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clear: (id) => void pending.delete(id),
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
  };
  return { timers, advance };
}

Deno.test('DebounceScheduler trails bursts and still fires within maxWait under continuous events', () => {
  const { timers, advance } = fakeTimers();
  let calls = 0;
  const s = new DebounceScheduler(() => calls++, 250, 2_000, timers);
  s.schedule();
  advance(100);
  s.schedule();
  advance(249);
  assertEquals(calls, 0);
  advance(1);
  assertEquals(calls, 1);

  // An event every 100 ms for 5 s must not starve the refresh.
  for (let i = 0; i < 50; i++) {
    s.schedule();
    advance(100);
  }
  assert(calls >= 3, `expected at least 3 refreshes, got ${calls}`);
  s.cancel();
  advance(5_000);
  const settled = calls;
  advance(5_000);
  assertEquals(calls, settled);
});

Deno.test('isLiveDataRequest tags only GET data requests for live pages', () => {
  assertEquals(dataUrlPagePath('/settings/jobs/__data.json'), '/settings/jobs');
  assertEquals(dataUrlPagePath('/__data.json'), '/');
  assertEquals(dataUrlPagePath('/page.html__data.json'), '/page');
  assertEquals(dataUrlPagePath('/api/v1/jobs'), null);
  const live = new Map([['/settings/jobs', 1]]);
  const url = (p: string) => new URL(p, 'http://localhost');
  assert(isLiveDataRequest(url('/settings/jobs/__data.json?x-sveltekit-invalidated=01'), 'GET', live));
  assertEquals(isLiveDataRequest(url('/settings/jobs/__data.json'), 'POST', live), false);
  assertEquals(isLiveDataRequest(url('/sync-history/__data.json'), 'GET', live), false);
  assertEquals(isLiveDataRequest(url('/api/v1/jobs'), 'GET', live), false);
  assertEquals(isLiveDataRequest(url('/settings/jobs/__data.json'), 'GET', new Map()), false);
});
