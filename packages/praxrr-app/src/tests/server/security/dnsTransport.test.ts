/** Deterministic tests for the bounded DNS resolver/cache. No live DNS and no wall-clock sleeps. */

import { assert, assertEquals } from '@std/assert';
import {
  DNS_TRANSPORT_POLICY,
  createDnsTransportResolver,
  getDnsTransportResolver,
  overrideDnsTransportResolverForTest,
  productionDnsTransportResolver,
  type DnsRecordType,
  type DnsTransportDependencies,
  type DnsTransportPolicy,
  type ResolveDns,
} from '$lib/server/security/dnsTransport.ts';

type TimerHandle = ReturnType<typeof setTimeout>;

class FakeClock {
  nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  readonly now = (): number => this.nowMs;

  readonly setTimer = (callback: () => void, delayMs: number): TimerHandle => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, delayMs), callback });
    return id as unknown as TimerHandle;
  };

  readonly clearTimer = (handle: TimerHandle): void => {
    this.timers.delete(handle as unknown as number);
  };

  advance(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.nowMs = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.nowMs = target;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function resolverWith(resolveDns: ResolveDns, clock = new FakeClock(), policy: Partial<DnsTransportPolicy> = {}) {
  const dependencies: Partial<DnsTransportDependencies> = {
    resolveDns,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  };
  return { resolver: createDnsTransportResolver(dependencies, policy), clock };
}

function resolved(answers: readonly string[]): Promise<readonly string[]> {
  return Promise.resolve(answers);
}

function rejected(error: unknown): Promise<readonly string[]> {
  return Promise.reject(error);
}

Deno.test('DNS policy pins every process-wide bound', () => {
  assertEquals(DNS_TRANSPORT_POLICY, {
    maxConcurrentHosts: 4,
    timeoutMs: 1_500,
    maxResultsPerHost: 16,
    positiveCacheMs: 60_000,
    negativeCacheMs: 15_000,
    maxCacheEntries: 256,
  });
});

Deno.test('resolver queries A+AAAA concurrently with one signal and aggregates family/class counts', async () => {
  const calls: Array<{ host: string; family: DnsRecordType; signal: AbortSignal }> = [];
  const { resolver, clock } = resolverWith((host, family, options) => {
    calls.push({ host, family, signal: options.signal });
    return resolved(family === 'A' ? ['10.0.0.5', '8.8.8.8'] : ['fd00::1', 'fe80::1']);
  });

  const evidence = await resolver.observe('Arr.Example.');
  assertEquals(
    calls.map((call) => [call.host, call.family]),
    [
      ['arr.example', 'A'],
      ['arr.example', 'AAAA'],
    ]
  );
  assertEquals(calls[0].signal, calls[1].signal);
  assertEquals(evidence.outcome, 'resolved');
  assertEquals(evidence.source, 'fresh');
  assertEquals(evidence.ipv4, { loopback: 0, private: 1, linkLocal: 0, public: 1, special: 0 });
  assertEquals(evidence.ipv6, { loopback: 0, private: 1, linkLocal: 1, public: 0, special: 0 });
  assertEquals(evidence.retainedCount, 4);
  assertEquals(evidence.incomplete, false);
  assertEquals(evidence.observedAt, '1970-01-01T00:00:00.000Z');
  assertEquals(clock.pendingTimers, 0);
});

Deno.test('one failed family yields partial evidence; retained public evidence survives incompleteness', async () => {
  const { resolver } = resolverWith((_host, family) => {
    if (family === 'AAAA') return rejected(new Error('must stay internal'));
    return resolved(['8.8.8.8']);
  });
  const evidence = await resolver.observe('partial.example');
  assertEquals(evidence.outcome, 'partial');
  assertEquals(evidence.incomplete, true);
  assertEquals(evidence.ipv4.public, 1);
  assertEquals(evidence.retainedCount, 1);
});

Deno.test('shared host timeout aborts both families, returns closed timeout, and clears timer/state', async () => {
  const signals: AbortSignal[] = [];
  const { resolver, clock } = resolverWith((_host, _family, options) => {
    signals.push(options.signal);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  });

  const pending = resolver.observe('timeout.example');
  await flush();
  assertEquals(signals.length, 2);
  clock.advance(1_499);
  await flush();
  assertEquals(signals[0].aborted, false);
  clock.advance(1);
  const evidence = await pending;
  assert(signals.every((signal) => signal.aborted));
  assertEquals(evidence.outcome, 'timeout');
  assertEquals(evidence.source, 'fresh');
  assertEquals(evidence.retainedCount, 0);
  assertEquals(clock.pendingTimers, 0);
  assertEquals((await resolver.observe('timeout.example')).source, 'cache');
  assertEquals(signals.length, 2);
});

Deno.test('identical in-flight hosts coalesce before acquiring a global slot', async () => {
  const byFamily = new Map<DnsRecordType, Deferred<readonly string[]>>([
    ['A', deferred<readonly string[]>()],
    ['AAAA', deferred<readonly string[]>()],
  ]);
  let calls = 0;
  const { resolver } = resolverWith((_host, family) => {
    calls += 1;
    return byFamily.get(family)!.promise;
  });

  const pending = Array.from({ length: 12 }, () => resolver.observe('same.example'));
  await flush();
  assertEquals(calls, 2);
  byFamily.get('A')!.resolve(['10.0.0.1']);
  byFamily.get('AAAA')!.resolve([]);
  const evidence = await Promise.all(pending);
  assert(evidence.every((entry) => entry.retainedCount === 1));
  assertEquals(calls, 2);
});

Deno.test('global semaphore runs at most four hosts and releases queued work', async () => {
  const pendingCalls = new Map<string, Map<DnsRecordType, Deferred<readonly string[]>>>();
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const { resolver } = resolverWith((host, family) => {
    activeCalls += 1;
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
    const item = deferred<readonly string[]>();
    let hostCalls = pendingCalls.get(host);
    if (!hostCalls) {
      hostCalls = new Map();
      pendingCalls.set(host, hostCalls);
    }
    hostCalls.set(family, item);
    return item.promise.finally(() => {
      activeCalls -= 1;
    });
  });

  const observations = Array.from({ length: 6 }, (_, index) => resolver.observe(`host-${index}.example`));
  await flush();
  assertEquals(pendingCalls.size, 4);
  assertEquals(maxActiveCalls, 8); // four hosts, two family calls per host

  for (const item of pendingCalls.get('host-0.example')!.values()) item.resolve([]);
  await flush();
  assertEquals(pendingCalls.size, 5);

  for (const calls of pendingCalls.values()) {
    for (const item of calls.values()) item.resolve([]);
  }
  await flush();
  for (const calls of pendingCalls.values()) {
    for (const item of calls.values()) item.resolve([]);
  }
  await Promise.all(observations);
});

Deno.test('queue deadline returns budget-exceeded without starting late DNS work', async () => {
  const first = new Map<DnsRecordType, Deferred<readonly string[]>>([
    ['A', deferred<readonly string[]>()],
    ['AAAA', deferred<readonly string[]>()],
  ]);
  const hosts: string[] = [];
  const { resolver, clock } = resolverWith(
    (host, family) => {
      hosts.push(host);
      return first.get(family)!.promise;
    },
    undefined,
    { maxConcurrentHosts: 1 }
  );

  const occupying = resolver.observe('first.example');
  await flush();
  const queued = resolver.observe('late.example', { deadlineAt: 100 });
  await flush();
  clock.advance(100);
  assertEquals((await queued).outcome, 'budget-exceeded');
  assertEquals(hosts, ['first.example', 'first.example']);

  first.get('A')!.resolve([]);
  first.get('AAAA')!.resolve([]);
  await occupying;
});

Deno.test('retention is deterministic, deduplicated, capped at 16, and malformed answers are special', async () => {
  const answers = ['not-an-ip', 'not-an-ip', ...Array.from({ length: 20 }, (_, index) => `10.0.0.${index + 1}`)];
  const { resolver } = resolverWith((_host, family) => resolved(family === 'A' ? answers : []));
  const evidence = await resolver.observe('many.example');
  assertEquals(evidence.retainedCount, 16);
  assertEquals(evidence.truncated, true);
  assertEquals(evidence.incomplete, true);
  assertEquals(evidence.ipv4.special, 1);
  assertEquals(evidence.ipv4.private, 15);
});

Deno.test('positive cache uses 60s, labels cache source, and preserves original observedAt', async () => {
  let calls = 0;
  const { resolver, clock } = resolverWith((_host, family) => {
    calls += 1;
    return resolved(family === 'A' ? ['10.0.0.1'] : []);
  });

  const fresh = await resolver.observe('cache.example');
  clock.advance(59_999);
  const cached = await resolver.observe('cache.example');
  assertEquals(cached.source, 'cache');
  assertEquals(cached.observedAt, fresh.observedAt);
  assertEquals(calls, 2);

  clock.advance(1);
  const refreshed = await resolver.observe('cache.example');
  assertEquals(refreshed.source, 'fresh');
  assertEquals(refreshed.observedAt, '1970-01-01T00:01:00.000Z');
  assertEquals(calls, 4);
});

Deno.test('failed and empty observations use the 15s negative cache boundary', async () => {
  for (const mode of ['failed', 'empty'] as const) {
    let calls = 0;
    const { resolver, clock } = resolverWith(() => {
      calls += 1;
      if (mode === 'failed') return rejected(new Error('closed failure'));
      return resolved([]);
    });
    assertEquals((await resolver.observe(`${mode}.example`)).outcome, mode);
    clock.advance(14_999);
    assertEquals((await resolver.observe(`${mode}.example`)).source, 'cache');
    assertEquals(calls, 2);
    clock.advance(1);
    assertEquals((await resolver.observe(`${mode}.example`)).source, 'fresh');
    assertEquals(calls, 4);
  }
});

Deno.test('cache capacity is 256 with deterministic LRU eviction after current hits', async () => {
  const calls = new Map<string, number>();
  const { resolver } = resolverWith((host, family) => {
    if (family === 'A') calls.set(host, (calls.get(host) ?? 0) + 1);
    return resolved(family === 'A' ? ['10.0.0.1'] : []);
  });

  for (let index = 0; index < 256; index += 1) await resolver.observe(`host-${index}.example`);
  assertEquals((await resolver.observe('host-0.example')).source, 'cache'); // host 0 becomes most recent
  await resolver.observe('host-256.example'); // entry 257 evicts host 1
  assertEquals((await resolver.observe('host-1.example')).source, 'fresh');
  assertEquals(calls.get('host-1.example'), 2);
  assertEquals((await resolver.observe('host-0.example')).source, 'cache');
  assertEquals(calls.get('host-0.example'), 1);
});

Deno.test('successive positive observations track only public/non-public fingerprint changes', async () => {
  const answers = [['10.0.0.1'], ['8.8.8.8'], ['1.1.1.1']];
  let lookup = 0;
  const { resolver, clock } = resolverWith((_host, family) => {
    if (family === 'AAAA') return resolved([]);
    return resolved(answers[Math.min(lookup++, answers.length - 1)]);
  });

  assertEquals((await resolver.observe('change.example')).addressClassesChanged, false);
  clock.advance(60_000);
  const changed = await resolver.observe('change.example');
  assertEquals(changed.addressClassesChanged, true);
  assertEquals((await resolver.observe('change.example')).addressClassesChanged, true);
  clock.advance(60_000);
  assertEquals((await resolver.observe('change.example')).addressClassesChanged, false);
});

Deno.test('transition history survives cache expiry, pruning, and an intervening failed lookup', async () => {
  let targetLookups = 0;
  const { resolver, clock } = resolverWith(
    (host, family) => {
      if (host === 'failure.example') return rejected(new Error('closed failure'));
      if (family === 'AAAA') return resolved([]);
      return resolved(targetLookups++ === 0 ? ['10.0.0.1'] : ['8.8.8.8']);
    },
    undefined,
    { maxCacheEntries: 1 }
  );

  await resolver.observe('history.example');
  clock.advance(60_000);
  await resolver.observe('failure.example'); // prunes the expired positive cache entry
  assertEquals((await resolver.observe('history.example')).addressClassesChanged, true);
});

Deno.test(
  'permission/rejection failures stay closed; malformed answers become incomplete special evidence',
  async () => {
    for (const error of [new Error('nameserver secret detail'), new Deno.errors.NotCapable('permission detail')]) {
      const failure = resolverWith(() => rejected(error)).resolver;
      const failed = await failure.observe('failure.example');
      assertEquals(failed.outcome, 'failed');
      assert(!JSON.stringify(failed).includes(error.message));
    }

    const malformed = resolverWith((_host, family) => resolved(family === 'A' ? ['999.1.1.1'] : [])).resolver;
    const evidence = await malformed.observe('malformed.example');
    assertEquals(evidence.outcome, 'resolved');
    assertEquals(evidence.ipv4.special, 1);
    assertEquals(evidence.incomplete, true);
  }
);

Deno.test('reset aborts active work, releases queued slots, and permits clean reuse', async () => {
  let calls = 0;
  const resolveDns: ResolveDns = (_host, _family, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  };
  const { resolver } = resolverWith(resolveDns, undefined, { maxConcurrentHosts: 1 });
  const active = resolver.observe('active.example');
  const queued = resolver.observe('queued.example');
  await flush();
  assertEquals(calls, 2);
  resolver.reset();
  assertEquals((await queued).outcome, 'budget-exceeded');
  await active;

  const reused = resolver.observe('reused.example');
  await flush();
  assertEquals(calls, 4);
  resolver.reset();
  await reused;
});

Deno.test('test override restore closure is idempotent and clears isolated cache/history', async () => {
  let calls = 0;
  const custom = resolverWith((_host, family) => {
    calls += 1;
    return resolved(family === 'A' ? ['10.0.0.1'] : []);
  }).resolver;

  const restore = overrideDnsTransportResolverForTest(custom);
  try {
    assertEquals(getDnsTransportResolver(), custom);
    await getDnsTransportResolver().observe('override.example');
    assertEquals((await getDnsTransportResolver().observe('override.example')).source, 'cache');
  } finally {
    restore();
  }
  restore();
  assertEquals(getDnsTransportResolver(), productionDnsTransportResolver);

  const restoreAgain = overrideDnsTransportResolverForTest(custom);
  try {
    assertEquals((await custom.observe('override.example')).source, 'fresh');
    assertEquals(calls, 4);
  } finally {
    restoreAgain();
  }
});
