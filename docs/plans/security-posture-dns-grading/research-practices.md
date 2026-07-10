# Practices Research: Security Posture DNS Grading

## Executive Summary

Issue #229 should add one feature-local asynchronous I/O shell around the
existing pure Security Posture engine. The implementation should not introduce a
general networking framework, a database table, a background job, or a
third-party package. Deno already provides the required cancellable A and AAAA
resolver, and the repository already contains the hard part of correct IP
handling: binary IPv4/IPv6 parsing and CIDR containment in
`$shared/security/trustedProxy.ts`.

The recommended structure is:

1. Extract the parser/CIDR primitives from `trustedProxy.ts` into a small pure
   shared module and make trusted-proxy parsing, literal-host grading, and
   DNS-address grading consume it.
2. Add a server-only `$lib/server/security/dnsTransport.ts` containing the fixed
   issue-229 policy, resolver orchestration, process-local bounded cache, and
   in-flight coalescing.
3. Materialize a secret-free DNS observation onto each hostname-based HTTP
   `InstanceFact` before the existing pure scorer runs. HTTPS and IP literals do
   no DNS work.
4. Make `buildPostureInputs()` and `computeShield()` asynchronous and update all
   three real consumers: the HTTP summary route, MCP resource, and MCP tool.
5. Inject the DNS function, clock, and timer functions. Unit tests must use
   fresh cache instances and fake dependencies; no automated test should depend
   on the machine's live resolver.

Use the business-research policy as the single v1 policy: 8 uncached hostnames
per report, 4 hostnames in flight, one 1,000 ms deadline shared by A and AAAA
for each hostname, 16 retained unique answers, 60-second positive cache
lifetime, 10-second negative cache lifetime, and 256 entries. These are product
constants, not DNS TTLs or operator settings.

## Existing Reusable Code

| Existing code                                                                                              | Reuse                                                                                                                                            | Required change / caution                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`                                              | Its u32/bigint parsers, mapped-IPv6 normalization, masks, CIDR parse, and containment are the strongest existing basis for exact classification. | Extract the pure primitives; do not call `parseTrustedProxy()` to classify DNS answers because trusted-proxy policy and address-scope policy are different questions.                                                                   |
| `packages/praxrr-app/src/lib/shared/security/checks.ts`                                                    | Retain URL parsing, the 100/65/30 score ladder, mean aggregation, concrete instance fix, critical public finding, and guarded band cap.          | Replace string-prefix literal rules and hostname assurance with the shared binary classifier plus materialized DNS evidence. Add `mixed`; a partial local-only observation must remain `unknown`.                                       |
| `packages/praxrr-app/src/lib/server/security/gather.ts`                                                    | Keep it as the single config/DB fact boundary; it already gathers only id/name/type/url and degrades read failures.                              | Its return becomes `Promise<PostureInputs>` after hostname observations are attached. Update the “zero network I/O” comment and catch DNS failure per hostname, never around the whole report only.                                     |
| `packages/praxrr-app/src/lib/server/security/service.ts`                                                   | Keep the thin `gather -> pure engine` orchestration.                                                                                             | `computeShield()` returns `Promise<ShieldReport>` and accepts an injectable resolver dependency for unit tests.                                                                                                                         |
| `packages/praxrr-app/src/lib/server/security/responses.ts`                                                 | Preserve the explicit internal-to-wire mapper and secretless host-only response boundary.                                                        | Add a dedicated DNS evidence object and map every field explicitly; do not spread internal cache entries or resolver errors onto the wire.                                                                                              |
| `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`                                                  | Its `Map` + expiry check demonstrates that process-local caches are already accepted.                                                            | Do **not** reuse it: it has a global key space, hard-coded `Date.now()`, no capacity/LRU, no in-flight coalescing, and no prior-class comparison. Extending it would couple unrelated Arr-library cache semantics to security evidence. |
| `packages/praxrr-app/src/lib/server/pull/startup/orchestrator.ts::processBatches` and `$sync/processor.ts` | The repository already uses simple batch + `Promise.all` fan-out instead of a dependency.                                                        | Implement the same small pattern locally for at most four hostnames per batch. Do not import startup orchestration into Security Posture.                                                                                               |
| `packages/praxrr-app/src/lib/server/sync/drift/check.ts`                                                   | Strong precedent for an async never-throwing I/O shell, pure core, typed dependencies, injected clock, and fixed budget.                         | Mirror its dependency-object style, but pass `AbortSignal` into `Deno.resolveDns`; a bare `Promise.race` does not cancel DNS work.                                                                                                      |
| `packages/praxrr-app/src/lib/server/health/recompute.ts` and `$sync/drift/persist.ts`                      | Precedent for module-local in-flight tracking and cleanup in `finally`.                                                                          | DNS needs `Map<hostname, Promise<observation>>`, not `Set`, because concurrent HTTP/MCP reads should share the same result rather than return an in-flight error.                                                                       |
| `packages/praxrr-app/src/tests/shared/security/*.test.ts`                                                  | Pure fixture builders already pin exact scores, status, critical flags, band caps, order invariance, and secret absence.                         | Extend fixtures with explicit DNS observations; keep classifier and scoring tests free of DB, timers, and network.                                                                                                                      |
| `scripts/test.ts` `security-posture` alias                                                                 | Already covers shared security, route, logger, config, auth/network, and server-security tests.                                                  | Place new pure and resolver/cache tests under its existing directories so `deno task test security-posture` remains the authoritative focused gate.                                                                                     |

## Modularity Design

Use three layers with one-way dependencies:

```text
$shared/security/ip.ts
  pure parse/CIDR/address-scope operations
          ^                  ^
          |                  |
trustedProxy.ts       checks.ts + types.ts
                             ^
                             |
$lib/server/security/dnsTransport.ts
  Deno.resolveDns + deadline + limits + memory cache
                             ^
                             |
gather.ts -> service.ts -> HTTP route / MCP resource / MCP tool
```

`ip.ts` must have no Deno, config, DB, logger, clock, or cache imports.
`dnsTransport.ts` is server-only and owns all time-dependent state. `checks.ts`
remains deterministic: identical `PostureInputs` must still produce a deep-equal
report.

Do not put DNS inside an Arr client or sync processor. The issue is advisory
report enrichment only; placing resolution on connection construction would risk
blocking sync, connection tests, startup, or writes and would violate the issue
boundary.

### Shared vs Feature-Specific

| Concern                                                                 | Shared pure module                                                                            | Feature-specific Security Posture module                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Parse IPv4/IPv6 and normalize IPv4-mapped IPv6                          | `$shared/security/ip.ts`                                                                      | —                                                                    |
| Parse/mask CIDR and test containment                                    | `$shared/security/ip.ts`                                                                      | —                                                                    |
| Define globally reachable vs loopback/private/link-local/special ranges | `$shared/security/ip.ts`, because direct URL literals and DNS answers require the same answer | —                                                                    |
| Trusted proxy keywords and overly-broad trust policy                    | —                                                                                             | `$shared/security/trustedProxy.ts` (feature policy remains separate) |
| DNS A/AAAA calls, cancellation, concurrency, host budget                | —                                                                                             | `$lib/server/security/dnsTransport.ts`                               |
| Positive/negative cache lifetimes, LRU, prior class fingerprint         | —                                                                                             | `$lib/server/security/dnsTransport.ts`                               |
| DNS evidence and effective transport grading                            | Shared data types and pure tier selection in `$shared/security/{types,checks}.ts`             | Observation materialization only                                     |
| Wire redaction and UI wording                                           | —                                                                                             | `$lib/server/security/responses.ts` and the Security Posture page    |

## KISS Assessment

The smallest complete design is one extracted pure IP module plus one
feature-local resolver/cache module. It deliberately excludes:

- a generic cache framework or service container;
- persistence, migrations, cleanup jobs, or history tables;
- stale-while-revalidate, background refresh, force-refresh, or
  user-configurable limits;
- DNS-over-HTTPS, external resolvers, CNAME walking, port probes, or HTTP
  reachability checks;
- raw-address response fields or verbose resolver diagnostics;
- a package added solely for IP parsing or concurrency limiting.

The cache should use two `Map`s: resolved entries and in-flight promises. On a
cache hit, refresh its Map insertion order for LRU. Before insertion, remove
expired entries, then evict the oldest until capacity is available. A cache
entry may retain only the immediately previous successful class fingerprint
needed for `changedSincePrevious`; exact prior addresses are unnecessary.
Restarting the process intentionally clears all observations.

Simple batching is sufficient. Four hostnames in a batch means up to eight
resolver calls at once (A and AAAA for each hostname). With eight uncached
hostnames and a 1,000 ms per-host shared deadline, the worst intended report
delay is two bounded waves, approximately two seconds plus local work. Every
hostname promise must resolve to typed evidence, so `Promise.all` cannot let one
rejection abort its siblings.

## Abstraction vs Repetition

Extract shared IP parsing now. Issue #229 creates the second binary-policy
consumer, and leaving the private parser in `trustedProxy.ts` would force
another IPv6 parser or retain incorrect prefix checks such as
`startsWith('fe80')`, which does not cover all of `fe80::/10`. The extraction
should move code and tests with minimal semantic change, not create a general
networking toolkit.

Recommended extraction boundary:

- share `ParsedIp`, `CidrRange`, `parseIpLiteral`, `parseCidrRange`,
  `containsIp`, and `classifyIpAddress`;
- keep `TRUSTED_PROXY` token grammar, keyword expansion, wildcard, invalid-entry
  reporting, and overly-broad policy in `trustedProxy.ts`;
- make direct literal grading in `checks.ts` use `classifyIpAddress` so
  configured literals and DNS answers cannot drift;
- leave `getClientIp` header selection in `network.ts`; it is unrelated to DNS;
- avoid broad AUTH=local behavior changes while extracting. Retain and expand
  the existing drift-guard tests so the local/private canon remains compatible.

Do not abstract the DNS cache into `$utils/cache`. Security observations need
negative-cache source, family completeness, result truncation, prior class
fingerprints, in-flight joining, deterministic host budgets, and strict
redaction. Those semantics are not reusable by the Arr library cache and a
generic API would obscure the security invariants.

## Interface Design with signatures

The pure IP surface should be narrow:

```ts
export type IpFamily = 4 | 6;
export type IpAddressClass =
  'loopback' | 'private' | 'link-local' | 'public' | 'special';

export interface ParsedIp {
  readonly family: IpFamily;
  readonly value: bigint;
}

export interface CidrRange {
  readonly family: IpFamily;
  readonly base: bigint;
  readonly prefix: number;
  readonly raw: string;
}

export function parseIpLiteral(raw: string): ParsedIp | null;
export function parseCidrRange(raw: string): CidrRange | null;
export function containsIp(range: CidrRange, address: ParsedIp): boolean;
export function classifyIpAddress(raw: string): IpAddressClass | null;
```

The shared engine receives only bounded, secret-free evidence:

```ts
export type DnsOutcome =
  | 'not-needed'
  | 'literal'
  | 'resolved'
  | 'timeout'
  | 'failure'
  | 'empty'
  | 'budget-exhausted';

export type DnsEvidenceSource =
  'fresh' | 'cache-hit' | 'negative-cache-hit' | 'none';

export interface DnsClassCounts {
  readonly loopback: number;
  readonly private: number;
  readonly linkLocal: number;
  readonly public: number;
  readonly special: number;
}

export interface DnsTransportObservation {
  readonly outcome: DnsOutcome;
  readonly source: DnsEvidenceSource;
  readonly counts: DnsClassCounts;
  readonly ipv4Count: number;
  readonly ipv6Count: number;
  readonly resultCount: number;
  readonly incomplete: boolean;
  readonly truncated: boolean;
  readonly changedSincePrevious: boolean;
  readonly observedAt: string | null;
}

export interface InstanceFact {
  readonly id: number;
  readonly name: string;
  readonly arrType: ShieldArrType;
  readonly url: string;
  readonly dns: DnsTransportObservation;
}
```

The server I/O seam should make all nondeterminism injectable:

```ts
export type DnsRecordType = 'A' | 'AAAA';
export type ResolveDns = (
  hostname: string,
  recordType: DnsRecordType,
  options: { signal: AbortSignal }
) => Promise<readonly string[]>;

export interface DnsTransportPolicy {
  readonly maxUncachedHostsPerReport: 8;
  readonly maxConcurrentHosts: 4;
  readonly timeoutMs: 1_000;
  readonly maxResultsPerHost: 16;
  readonly positiveCacheMs: 60_000;
  readonly negativeCacheMs: 10_000;
  readonly maxCacheEntries: 256;
}

export interface DnsTransportDependencies {
  readonly resolveDns: ResolveDns;
  readonly now: () => number;
  readonly setTimer: typeof setTimeout;
  readonly clearTimer: typeof clearTimeout;
}

export interface DnsTransportResolver {
  observeInstances(
    instances: readonly InstanceFact[]
  ): Promise<readonly InstanceFact[]>;
}

export function createDnsTransportResolver(
  deps?: Partial<DnsTransportDependencies>,
  policy?: DnsTransportPolicy
): DnsTransportResolver;
```

Production should create one module-level resolver instance so HTTP and MCP
calls share cache and in-flight work. Tests should call the factory for isolated
state. The default `resolveDns` delegates to
`Deno.resolveDns(host, type, { signal })`; A and AAAA share one
`AbortController` and timer per host. Map OS exceptions to stable internal
reasons, then to the public `failure` outcome; never store or return
`error.message`.

Service signatures should make the async fan-out explicit without leaking cache
details:

```ts
export interface SecurityPostureDependencies {
  readonly dns: DnsTransportResolver;
}

export async function buildPostureInputs(
  event?: SessionRequestContext,
  deps?: Partial<SecurityPostureDependencies>
): Promise<PostureInputs>;

export async function computeShield(
  event?: SessionRequestContext,
  deps?: Partial<SecurityPostureDependencies>
): Promise<ShieldReport>;
```

The exact call-site changes are:

```ts
// HTTP route
const report = await computeShield(event);

// MCP resource
read: async () => toSecuritySummary(await computeShield());

// MCP tool
handler: async () => toSecuritySummary(await computeShield());
```

No sync processor, Arr client, job handler, startup hook, or connection-test
route should import `dnsTransport.ts`. A repository-wide `rg "computeShield\\("`
currently identifies only those three consumers plus the service definition,
making the async conversion bounded and auditable.

## Testability Patterns

Add tests at the narrowest responsible layer:

| Test file                                                            | Responsibility                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/tests/shared/security/ip.test.ts`           | IPv4/IPv6 parse boundaries, CIDR containment, IPv4-mapped IPv6, zone-id rejection, loopback/private/link-local/public/special ranges, and exact IANA exclusions used by policy.                                                                           |
| `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts` | Existing grammar/trust behavior remains byte-for-byte compatible after extraction; expand drift samples around `fe80::/10` boundaries.                                                                                                                    |
| `packages/praxrr-app/src/tests/shared/security/checks.test.ts`       | Pure matrix for literal, private-only, public-only, mixed, partial/truncated, failed, budget-exhausted, and changed observations; exact 100/65/30 scores and fixes.                                                                                       |
| `packages/praxrr-app/src/tests/shared/security/engine.test.ts`       | Mean, critical/action propagation, guarded cap, ordering invariance, engine-version bump, and explicit Radarr/Sonarr/Lidarr parity.                                                                                                                       |
| `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts` | A+AAAA shared cancellation, timeout, partial family result, stable failure mapping, dedupe, 16-result cap, 8-host budget, four-host concurrency, 60s/10s expiry, 256-entry eviction, cache source, in-flight joining, and local/public class transitions. |
| `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`       | Route awaits async computation, returns 200 for typed DNS degradation, exposes aggregate counts only, uses `url` not `external_url`, and never exposes API keys/full URLs/raw addresses/error strings.                                                    |
| `packages/praxrr-app/src/tests/mcp/mcp.test.ts`                      | Both `praxrr://security-posture` and `get_security_posture` still await and return the same redacted wire shape.                                                                                                                                          |

Use deferred promises to occupy resolver slots and prove the fifth hostname does
not start until a slot completes. Count calls by `(hostname, recordType)` to
prove hostname dedupe and in-flight joining. Advance an injected numeric clock
to exact expiry boundaries. Inject timers or a resolver stub that observes
`AbortSignal` so timeout tests complete immediately; do not use real one-second
sleeps.

Construct a new resolver/cache per unit test. The production singleton must not
require a public `clear()` used by application code. If test inspection is
needed, expose it only through returned typed outcomes and resolver call counts,
not mutable cache internals.

Keep route and MCP fixtures on literals for generic contract tests, then inject
the resolver at the service boundary for failure behavior. Avoid `.invalid` or
public-domain live lookups in automated tests: resolver latency, hosts files,
container DNS, and offline CI would make them nondeterministic. The manual
controlled-resolver checks remain appropriate for platform parity.

Validation should run, in order:

1. focused new pure IP and DNS transport tests;
2. `deno task test security-posture`;
3. `deno task test mcp` for async MCP propagation;
4. `deno task check`;
5. OpenAPI generation/contract validation required by the repository after
   schema changes.

## Build vs Depend

| Capability                | Build with repository/runtime primitives             | Add dependency                | Decision                                                                        |
| ------------------------- | ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| A/AAAA resolution         | `Deno.resolveDns` with `AbortSignal`                 | DNS client / DoH SDK          | Build; system-resolver viewpoint is part of the feature semantics.              |
| Timeout/cancellation      | `AbortController`, injected timer functions          | timeout library               | Build; a tiny cancellable deadline is clearer and actually aborts the resolver. |
| IP parsing/CIDR           | Extract the already-tested u32/bigint code           | `ipaddr.js`, `ip-cidr`, etc.  | Build/extract; avoids duplicate semantics and another supply-chain surface.     |
| Concurrency limit         | Two batches of at most four hosts with `Promise.all` | `p-limit`                     | Build; fixed maximum of eight makes a dependency unjustified.                   |
| TTL/LRU/in-flight cache   | Feature-local bounded `Map`s                         | cache/LRU package or database | Build; required semantics are small, security-specific, and need injected time. |
| Persistent history        | None                                                 | SQLite table/migration        | Do not build or depend; transient DNS evidence should disappear on restart.     |
| Reachability verification | None                                                 | scanner/HTTP probe            | Do not build or depend; explicitly out of scope.                                |

## Open Questions

1. **Single-label and local-suffix hostnames:** business research recommends
   resolving every HTTP hostname and removing the current `docker-alias / 100`
   assurance, while external research suggests leaving single-label/`.local`
   names outside DNS due system-resolver variability. Prefer the business rule
   because a naming convention is not proof of locality, but confirm this scope
   before planning.
2. **Public range maintenance:** should `classifyIpAddress` encode a pinned
   IANA-special-use snapshot in code, or a deliberately smaller documented
   exclusion set? Either choice needs explicit tests and a comment naming the
   snapshot date; “everything not private is public” is not acceptable.
3. **Previous-success retention after a negative refresh:** retain one bounded
   previous class fingerprint for comparison, or discard it when the negative
   entry replaces the positive entry? Recommendation: retain the fingerprint
   inside the same bounded cache entry but never reuse it as current grading
   evidence.
4. **Route-level dependency injection:** direct service tests can prove DNS
   degradation without live DNS. If acceptance requires the actual exported
   route handler to receive a fake resolver, add a small
   `createSecurityPostureHandler(compute = computeShield)` factory; otherwise
   avoid adding the factory solely for tests.
5. **Wire family counts:** the research requires family-specific explanations.
   Decide whether the public object uses a nested `ipv4`/`ipv6` class-count
   matrix or total class counts plus family totals. A nested matrix is more
   expressive and avoids reconstructing statements from insufficient data, at a
   modest schema cost.
