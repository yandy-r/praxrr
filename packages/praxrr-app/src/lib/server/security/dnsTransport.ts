/**
 * Bounded DNS observations for Security Posture transport grading (issue #229).
 *
 * Server-only and report-only: this module resolves A/AAAA through the system resolver, classifies a
 * bounded result set, and returns aggregate evidence. It never connects to an answer and must never
 * participate in Arr authorization, routing, sync, startup, save, or connection-test behavior.
 */

import { classifyIpAddress, parseIpLiteral } from '$shared/security/ip.ts';
import type { DnsEvidenceSource, DnsOutcome, DnsTransportEvidence, IpAddressClass } from '$shared/security/types.ts';

export type DnsRecordType = 'A' | 'AAAA';
export type ResolveDns = (
  hostname: string,
  recordType: DnsRecordType,
  options: { signal: AbortSignal }
) => Promise<readonly string[]>;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface DnsTransportDependencies {
  readonly resolveDns: ResolveDns;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer: (handle: TimerHandle) => void;
}

export interface DnsTransportPolicy {
  readonly maxConcurrentHosts: number;
  readonly timeoutMs: number;
  readonly maxResultsPerHost: number;
  readonly positiveCacheMs: number;
  readonly negativeCacheMs: number;
  readonly maxCacheEntries: number;
}

export const DNS_TRANSPORT_POLICY: DnsTransportPolicy = {
  maxConcurrentHosts: 4,
  timeoutMs: 1_500,
  maxResultsPerHost: 16,
  positiveCacheMs: 60_000,
  negativeCacheMs: 15_000,
  maxCacheEntries: 256,
};

export interface DnsObservationOptions {
  /** Absolute millisecond deadline for the caller, including semaphore queue time. */
  readonly deadlineAt?: number;
}

export interface DnsTransportResolver {
  observe(hostname: string, options?: DnsObservationOptions): Promise<DnsTransportEvidence>;
  /** Test/reset lifecycle only; aborts work and clears cache, history, in-flight state, and slots. */
  reset(): void;
}

interface AddressFamilyResult {
  readonly family: DnsRecordType;
  readonly ok: boolean;
  readonly answers: readonly string[];
}

interface MutableAddressClassCounts {
  loopback: number;
  private: number;
  linkLocal: number;
  public: number;
  special: number;
}

interface ScopeFingerprint {
  readonly public: boolean;
  readonly nonPublic: boolean;
}

interface CacheEntry {
  readonly evidence: DnsTransportEvidence;
  readonly expiresAt: number;
  /** Latest successful fingerprint, retained across negative cache entries for the next comparison. */
  readonly fingerprint: ScopeFingerprint | null;
}

interface CacheRead {
  readonly evidence: DnsTransportEvidence | null;
  readonly previousFingerprint: ScopeFingerprint | null;
}

type ReleaseSlot = () => void;

interface SlotWaiter {
  readonly generation: number;
  readonly resolve: (release: ReleaseSlot | null) => void;
  timer: TimerHandle | null;
}

class HostSemaphore {
  private active = 0;
  private generation = 0;
  private readonly queue: SlotWaiter[] = [];

  constructor(
    private readonly limit: number,
    private readonly deps: Pick<DnsTransportDependencies, 'now' | 'setTimer' | 'clearTimer'>
  ) {}

  acquire(deadlineAt?: number): Promise<ReleaseSlot | null> {
    if (deadlineAt !== undefined && deadlineAt <= this.deps.now()) return Promise.resolve(null);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFor(this.generation));
    }

    return new Promise((resolve) => {
      const waiter: SlotWaiter = { generation: this.generation, resolve, timer: null };
      if (deadlineAt !== undefined) {
        waiter.timer = this.deps.setTimer(
          () => {
            const index = this.queue.indexOf(waiter);
            if (index !== -1) this.queue.splice(index, 1);
            waiter.timer = null;
            resolve(null);
          },
          Math.max(0, deadlineAt - this.deps.now())
        );
      }
      this.queue.push(waiter);
    });
  }

  reset(): void {
    this.generation += 1;
    this.active = 0;
    for (const waiter of this.queue.splice(0)) {
      if (waiter.timer !== null) this.deps.clearTimer(waiter.timer);
      waiter.resolve(null);
    }
  }

  private releaseFor(generation: number): ReleaseSlot {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (generation !== this.generation) return;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      if (waiter.generation !== this.generation) {
        waiter.resolve(null);
        continue;
      }
      if (waiter.timer !== null) this.deps.clearTimer(waiter.timer);
      this.active += 1;
      waiter.resolve(this.releaseFor(this.generation));
    }
  }
}

function emptyCounts(): MutableAddressClassCounts {
  return { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 };
}

function closedEvidence(
  outcome: DnsOutcome,
  source: DnsEvidenceSource,
  observedAt: string | null,
  incomplete = true
): DnsTransportEvidence {
  return {
    outcome,
    source,
    ipv4: emptyCounts(),
    ipv6: emptyCounts(),
    retainedCount: 0,
    observedAt,
    incomplete,
    truncated: false,
    addressClassesChanged: false,
  };
}

function cacheEvidence(evidence: DnsTransportEvidence): DnsTransportEvidence {
  return { ...evidence, source: 'cache' };
}

function normalizedHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
}

function fingerprintFor(evidence: DnsTransportEvidence): ScopeFingerprint | null {
  if (evidence.retainedCount === 0) return null;
  const counts = [evidence.ipv4, evidence.ipv6];
  const publicCount = counts.reduce((sum, count) => sum + count.public, 0);
  return { public: publicCount > 0, nonPublic: evidence.retainedCount > publicCount };
}

function fingerprintsDiffer(left: ScopeFingerprint | null, right: ScopeFingerprint | null): boolean {
  return left !== null && right !== null && (left.public !== right.public || left.nonPublic !== right.nonPublic);
}

function cacheLifetime(evidence: DnsTransportEvidence, policy: DnsTransportPolicy): number {
  return evidence.retainedCount > 0 ? policy.positiveCacheMs : policy.negativeCacheMs;
}

class DnsTransportResolverImpl implements DnsTransportResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<DnsTransportEvidence>>();
  /** Latest successful scope fingerprint per bounded LRU key, independent of cache expiry/failure. */
  private readonly transitionHistory = new Map<string, ScopeFingerprint>();
  private readonly controllers = new Set<AbortController>();
  private readonly semaphore: HostSemaphore;
  private generation = 0;

  constructor(
    private readonly deps: DnsTransportDependencies,
    private readonly policy: DnsTransportPolicy
  ) {
    this.semaphore = new HostSemaphore(policy.maxConcurrentHosts, deps);
  }

  async observe(hostname: string, options: DnsObservationOptions = {}): Promise<DnsTransportEvidence> {
    const key = normalizedHostname(hostname);
    if (key.length === 0) return closedEvidence('failed', 'fresh', new Date(this.deps.now()).toISOString());

    const read = this.readCache(key);
    if (read.evidence !== null) return read.evidence;

    let work = this.inFlight.get(key);
    if (work === undefined) {
      const generation = this.generation;
      work = this.resolveAndCache(key, read.previousFingerprint, generation, options.deadlineAt);
      this.inFlight.set(key, work);
      void work.finally(() => {
        if (this.inFlight.get(key) === work) this.inFlight.delete(key);
      });
    }

    return await this.awaitForCaller(work, options.deadlineAt);
  }

  reset(): void {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.cache.clear();
    this.inFlight.clear();
    this.transitionHistory.clear();
    this.semaphore.reset();
  }

  private readCache(key: string): CacheRead {
    const entry = this.cache.get(key);
    if (entry === undefined) {
      return { evidence: null, previousFingerprint: this.transitionHistory.get(key) ?? null };
    }

    if (this.deps.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return { evidence: null, previousFingerprint: entry.fingerprint };
    }

    // Map insertion order is the LRU order. A current hit becomes most-recent without changing time.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { evidence: cacheEvidence(entry.evidence), previousFingerprint: entry.fingerprint };
  }

  private async resolveAndCache(
    hostname: string,
    previousFingerprint: ScopeFingerprint | null,
    generation: number,
    deadlineAt?: number
  ): Promise<DnsTransportEvidence> {
    const release = await this.semaphore.acquire(deadlineAt);
    if (release === null) return closedEvidence('budget-exceeded', 'none', null);

    try {
      const evidence = await this.resolveHost(hostname, deadlineAt);
      if (generation !== this.generation || evidence.outcome === 'budget-exceeded') return evidence;

      const nextFingerprint = fingerprintFor(evidence);
      const changed = fingerprintsDiffer(previousFingerprint, nextFingerprint);
      const finalEvidence = changed ? { ...evidence, addressClassesChanged: true } : evidence;
      const retainedFingerprint = nextFingerprint ?? previousFingerprint;
      if (nextFingerprint !== null) this.writeTransitionHistory(hostname, nextFingerprint);
      this.writeCache(hostname, finalEvidence, retainedFingerprint);
      return finalEvidence;
    } finally {
      release();
    }
  }

  private async resolveHost(hostname: string, deadlineAt?: number): Promise<DnsTransportEvidence> {
    const startedAt = this.deps.now();
    const remaining = deadlineAt === undefined ? this.policy.timeoutMs : deadlineAt - startedAt;
    if (remaining <= 0) return closedEvidence('budget-exceeded', 'none', null);

    const deadlineOwnsAbort = deadlineAt !== undefined && remaining < this.policy.timeoutMs;
    const controller = new AbortController();
    this.controllers.add(controller);
    let aborted = false;
    const timer = this.deps.setTimer(
      () => {
        aborted = true;
        controller.abort();
      },
      Math.min(this.policy.timeoutMs, remaining)
    );

    const query = async (family: DnsRecordType): Promise<AddressFamilyResult> => {
      try {
        const answers = await this.deps.resolveDns(hostname, family, { signal: controller.signal });
        return Array.isArray(answers) ? { family, ok: true, answers } : { family, ok: false, answers: [] };
      } catch {
        return { family, ok: false, answers: [] };
      }
    };

    let families: readonly AddressFamilyResult[];
    try {
      families = await Promise.all([query('A'), query('AAAA')]);
    } finally {
      this.deps.clearTimer(timer);
      this.controllers.delete(controller);
    }

    const observedAt = new Date(startedAt).toISOString();
    if (families.every((family) => !family.ok)) {
      if (aborted) {
        return closedEvidence(deadlineOwnsAbort ? 'budget-exceeded' : 'timeout', 'fresh', observedAt);
      }
      return closedEvidence('failed', 'fresh', observedAt);
    }

    return this.aggregateFamilies(families, observedAt);
  }

  private aggregateFamilies(families: readonly AddressFamilyResult[], observedAt: string): DnsTransportEvidence {
    const ipv4 = emptyCounts();
    const ipv6 = emptyCounts();
    const seen = new Set<string>();
    let retainedCount = 0;
    let truncated = false;
    let malformed = false;

    for (const family of families) {
      if (!family.ok) continue;
      for (const raw of family.answers) {
        const normalized = raw.trim().toLowerCase();
        const key = `${family.family}:${normalized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (retainedCount >= this.policy.maxResultsPerHost) {
          truncated = true;
          continue;
        }

        const addressClass = classifyIpAddress(raw);
        if (parseIpLiteral(raw) === null) malformed = true;
        const counts = family.family === 'A' ? ipv4 : ipv6;
        incrementCount(counts, addressClass);
        retainedCount += 1;
      }
    }

    const failedFamilies = families.filter((family) => !family.ok).length;
    let outcome: DnsOutcome;
    if (failedFamilies > 0) outcome = 'partial';
    else if (retainedCount === 0) outcome = 'empty';
    else outcome = 'resolved';

    return {
      outcome,
      source: 'fresh',
      ipv4,
      ipv6,
      retainedCount,
      observedAt,
      incomplete: failedFamilies > 0 || retainedCount === 0 || truncated || malformed,
      truncated,
      addressClassesChanged: false,
    };
  }

  private writeCache(key: string, evidence: DnsTransportEvidence, fingerprint: ScopeFingerprint | null): void {
    const now = this.deps.now();
    for (const [cachedKey, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(cachedKey);
    }
    while (this.cache.size >= this.policy.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.delete(key);
    this.cache.set(key, {
      evidence,
      expiresAt: now + cacheLifetime(evidence, this.policy),
      fingerprint,
    });
  }

  private writeTransitionHistory(key: string, fingerprint: ScopeFingerprint): void {
    this.transitionHistory.delete(key);
    while (this.transitionHistory.size >= this.policy.maxCacheEntries) {
      const oldest = this.transitionHistory.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.transitionHistory.delete(oldest);
    }
    this.transitionHistory.set(key, fingerprint);
  }

  private async awaitForCaller(
    work: Promise<DnsTransportEvidence>,
    deadlineAt?: number
  ): Promise<DnsTransportEvidence> {
    if (deadlineAt === undefined) return await work;
    const remaining = deadlineAt - this.deps.now();
    if (remaining <= 0) return closedEvidence('budget-exceeded', 'none', null);

    let timer: TimerHandle | null = null;
    const deadline = new Promise<DnsTransportEvidence>((resolve) => {
      timer = this.deps.setTimer(() => resolve(closedEvidence('budget-exceeded', 'none', null)), remaining);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (timer !== null) this.deps.clearTimer(timer);
    }
  }
}

function incrementCount(counts: MutableAddressClassCounts, addressClass: IpAddressClass): void {
  switch (addressClass) {
    case 'loopback':
      counts.loopback += 1;
      break;
    case 'private':
      counts.private += 1;
      break;
    case 'link-local':
      counts.linkLocal += 1;
      break;
    case 'public':
      counts.public += 1;
      break;
    case 'special':
      counts.special += 1;
      break;
  }
}

const DEFAULT_DEPENDENCIES: DnsTransportDependencies = {
  resolveDns: (hostname, recordType, options) =>
    Deno.resolveDns(hostname, recordType, options) as Promise<readonly string[]>,
  now: Date.now,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
};

export function createDnsTransportResolver(
  dependencies: Partial<DnsTransportDependencies> = {},
  policy: Partial<DnsTransportPolicy> = {}
): DnsTransportResolver {
  return new DnsTransportResolverImpl(
    { ...DEFAULT_DEPENDENCIES, ...dependencies },
    { ...DNS_TRANSPORT_POLICY, ...policy }
  );
}

/** Process-wide production state shared by the HTTP summary and both MCP consumers. */
export const productionDnsTransportResolver = createDnsTransportResolver();

let activeDnsTransportResolver: DnsTransportResolver = productionDnsTransportResolver;

/** Resolve the current singleton; application consumers use this rather than constructing state. */
export function getDnsTransportResolver(): DnsTransportResolver {
  return activeDnsTransportResolver;
}

/**
 * Narrow boundary-test seam. Installs an isolated resolver and returns an idempotent restore closure;
 * both installation and restoration clear every mutable resolver state.
 */
export function overrideDnsTransportResolverForTest(resolver: DnsTransportResolver): () => void {
  const previous = activeDnsTransportResolver;
  previous.reset();
  resolver.reset();
  activeDnsTransportResolver = resolver;

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    resolver.reset();
    activeDnsTransportResolver = previous;
    previous.reset();
  };
}
