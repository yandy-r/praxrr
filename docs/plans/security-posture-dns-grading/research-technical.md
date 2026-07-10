# Technical Research: DNS-Aware Arr Transport Grading

## Executive Summary

The DNS-aware transport grading design extends Praxrr's existing Arr transport
security posture without adding persistence, network probes, or third-party
dependencies. The implementation resolves configured Arr hostnames on the server
with Deno's native `Deno.resolveDns` API, classifies the returned IPv4 and IPv6
addresses, and supplies compact DNS evidence to the existing security grading
engine. Resolution is asynchronous and server-only. Classification and grading
remain pure, shared functions so that policy can be tested deterministically and
reused without exposing network behavior to client code.

The policy has deliberately bounded cost. Each security report has a hard 2
second deadline. A hostname gets one shared 1.5 second timeout covering its A
and AAAA work, reports inspect at most 32 hostname candidates, DNS work is
globally limited to four concurrent host resolutions, and evidence retains at
most 16 classified addresses per host. A process-singleton cache holds no more
than 256 entries, with positive answers cached for 60 seconds and negative or
failed answers cached for 15 seconds. A process-singleton in-flight registry
coalesces concurrent requests for the same normalized hostname.

The API never returns raw IP addresses, resolver errors, or exception text. It
exposes only aggregate class and family counts plus bounded metadata: outcome,
source, observed time, incomplete state, truncation state, and whether the
result changed relative to relevant configured or previously observed evidence.
These facts support deterministic grades. DNS evidence for loopback, private, or
link-local destinations scores 65. Public, mixed, or changed DNS evidence scores
30 and requires action. Partial resolution, failure, and special or unknown
address classes score 65. Existing HTTPS, explicitly configured loopback, and
Docker-local cases retain a score of 100. DNS cannot lower those established
trusted cases.

## Architecture Design

The system is split into three layers. The shared layer owns address syntax,
classification, evidence types, checks, and grading. It performs no I/O. The
server layer owns hostname extraction, deadlines, DNS resolution, caching,
concurrency, and evidence gathering. The presentation layer maps internal
evidence into HTTP, MCP, schema, and UI contracts.

The central server component is an asynchronous resolver with explicit seams:

```ts
export interface DnsResolverDeps {
  resolveDns: typeof Deno.resolveDns;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface DnsTransportResolver {
  resolveHost(hostname: string, signal?: AbortSignal): Promise<DnsHostEvidence>;
}
```

Production dependencies wrap `Deno.resolveDns`, `Date.now`, and Deno-compatible
timers. Tests inject scripted resolver results, a controllable clock, and
deterministic timers. The A and AAAA lookups start together but share one 1.5
second per-host timeout. A timeout or one-family rejection can still produce
partial aggregate evidence from the completed family. Cancellation from the 2
second report deadline prevents callers from waiting beyond the report budget
even if an underlying platform DNS call cannot be forcibly interrupted.

`dnsTransport.ts` owns the process singleton. It includes a bounded cache, an
in-flight map keyed by normalized hostname, and a concurrency limiter with
capacity four. Coalescing occurs before acquiring a concurrency slot, so
duplicate callers share both the work and the slot. Cache insertion is performed
once, after the shared resolution settles. The cache should use insertion/access
order eviction and remove the oldest entry when adding a 257th key.

`gather.ts` discovers eligible hostname candidates from Arr configuration,
deduplicates normalized names, caps candidates at 32, and schedules resolution
under the global limiter. `service.ts` changes security report production to
await DNS gathering and then invoke the pure engine. `responses.ts` is the only
place that converts internal DNS results into the public aggregate wire format.

The high-level flow is:

```text
HTTP or MCP request
  -> async computeShield()
  -> gather configured Arr transport candidates
  -> reuse cache or in-flight lookup
  -> resolve A and AAAA with shared timeout
  -> classify addresses with pure shared function
  -> aggregate pure DNS evidence
  -> run pure security checks and engine
  -> redact/map response aggregates
  -> render API, MCP, or UI result
```

## Data Models

The classifier should use a closed vocabulary so unknown data cannot silently
become public:

```ts
export type IpFamily = 'ipv4' | 'ipv6';

export type IpClass =
  'loopback' | 'private' | 'link_local' | 'public' | 'special' | 'unknown';

export interface ClassifiedIp {
  family: IpFamily;
  class: IpClass;
}
```

`shared/security/ip.ts` parses and classifies address strings without DNS, time,
configuration access, or logging. It must cover IPv4-mapped IPv6 and avoid
classifying malformed or unrecognized literals as public. The caller may retain
classified entries internally while discarding the original string immediately
after classification.

Internal host evidence can carry only the minimum state required for
aggregation:

```ts
export type DnsOutcome = 'resolved' | 'partial' | 'failed' | 'timeout';
export type DnsSource = 'network' | 'cache' | 'in_flight';

export interface DnsHostEvidence {
  hostnameKey: string;
  outcome: DnsOutcome;
  source: DnsSource;
  observedAt: string;
  addresses: ClassifiedIp[];
  incomplete: boolean;
  truncated: boolean;
  changed: boolean;
}
```

The public representation omits `hostnameKey` if it would disclose unnecessary
configuration detail and always omits address literals. At report or check level
it exposes counts:

| Field          | Type                                | Meaning                                                   |
| -------------- | ----------------------------------- | --------------------------------------------------------- |
| `classCounts`  | `Partial<Record<IpClass, number>>`  | Count by safe semantic class                              |
| `familyCounts` | `Partial<Record<IpFamily, number>>` | Retained IPv4 and IPv6 counts                             |
| `outcome`      | `DnsOutcome`                        | Resolved, partial, failed, or timed out                   |
| `source`       | `DnsSource`                         | Network, cache, or shared in-flight work                  |
| `observedAt`   | ISO-8601 string                     | Time the underlying observation was made                  |
| `incomplete`   | boolean                             | Some required work did not complete                       |
| `truncated`    | boolean                             | Candidate or retained-address bound was hit               |
| `changed`      | boolean                             | DNS class/family posture differs from comparison evidence |

Cache entries store the observation timestamp and expiry separately. A cache hit
preserves the original `observedAt`; it does not make stale evidence appear
newly observed. Negative entries contain outcome metadata but no errors.
Internally recorded errors should be reduced to a stable category before
logging, and neither stack traces nor resolver messages belong in evidence.

## API Design

`computeShield` becomes asynchronous because DNS is inherently asynchronous:

```ts
export async function computeShield(
  input: SecurityInput,
  options?: ComputeShieldOptions
): Promise<SecurityReport>;
```

`ComputeShieldOptions` may accept an injected DNS gatherer for tests and callers
that already own an observation. The shared `engine.ts` should remain pure; an
orchestration wrapper gathers DNS first and passes `SecurityEvidence` into the
engine. This distinction prevents `Deno.resolveDns` from leaking into browser
bundles or pure unit tests.

The HTTP route continues returning the security report but adds a DNS evidence
section or DNS-specific check details using the aggregate wire model.
OpenAPI/schema definitions must enumerate outcomes, sources, IP classes, and
families; require boolean flags; and describe that counts are bounded retained
observations rather than a complete DNS inventory. No schema field should permit
raw address strings or arbitrary error text.

MCP resources provide the same summarized report available through HTTP. MCP
tools that trigger shield computation await `computeShield` and describe the
deadline-limited nature of DNS evidence. Tool output must pass through
`responses.ts`, not serialize internal `DnsHostEvidence` directly. HTTP, MCP,
and UI therefore share one redaction boundary.

The grading contract is fixed:

| Evidence                          | Score | Disposition                             |
| --------------------------------- | ----: | --------------------------------------- |
| HTTPS transport                   |   100 | Retain trusted result                   |
| Explicitly configured loopback    |   100 | Retain trusted result                   |
| Recognized Docker-local transport |   100 | Retain trusted result                   |
| DNS loopback only                 |    65 | Caution; local resolution observed      |
| DNS private only                  |    65 | Caution; private network observed       |
| DNS link-local only               |    65 | Caution; link-local resolution observed |
| DNS public or mixed classes       |    30 | Action required                         |
| DNS posture changed               |    30 | Action required                         |
| Partial, failed, or timed-out DNS |    65 | Caution; incomplete evidence            |
| Special or unknown address class  |    65 | Caution; classification not trusted     |

Precedence matters. HTTPS, configured loopback, and Docker-local decisions are
evaluated before DNS downgrade rules. Among DNS rules, public, mixed, or changed
evidence takes precedence over partial-state caution when both apply, because
the observed actionable fact remains valid even if additional records were
unavailable.

## System Constraints

| Constraint                    | Fixed value | Enforcement point                   |
| ----------------------------- | ----------: | ----------------------------------- |
| Total report deadline         |   2 seconds | `gather.ts` / service orchestration |
| Shared A+AAAA host timeout    | 1.5 seconds | `dnsTransport.ts`                   |
| Maximum hostname candidates   |          32 | `gather.ts`                         |
| Global hostname concurrency   |           4 | process-singleton resolver          |
| Retained classified addresses | 16 per host | resolver aggregation                |
| Positive cache TTL            |  60 seconds | process-singleton cache             |
| Negative cache TTL            |  15 seconds | process-singleton cache             |
| Maximum cache entries         |         256 | cache eviction                      |

The 2 second limit includes queueing behind the global concurrency limiter.
Candidates that cannot start or finish within that budget produce incomplete
report evidence rather than extending latency. The 1.5 second host timer is
shared by A and AAAA; it is not 1.5 seconds per family. The 16-address retention
limit applies after deduplication. Counts in the wire response reflect retained
classified evidence, and `truncated` communicates that more candidates or
addresses existed.

DNS results are observations, not proof of reachability or transport
confidentiality. The design performs no TCP connection, HTTP request, TLS
handshake, Docker socket query, or Arr health probe. It makes no database
changes and adds no dependency. Process-local state intentionally resets on
restart and is not synchronized across workers. Native resolver behavior, search
domains, hosts-file handling, and platform DNS configuration remain Deno/runtime
concerns.

## Codebase Changes

The implementation should be intentionally distributed along existing ownership
boundaries:

- `shared/security/ip.ts`: pure IPv4/IPv6 parsing and classification.
- `shared/security/types.ts`: DNS evidence, class, family, outcome, and report
  types.
- `shared/security/checks.ts`: pure transport checks that consume DNS
  aggregates.
- `shared/security/engine.ts`: pure grade precedence and evidence evaluation.
- `shared/security/index.ts`: stable shared exports without server-only modules.
- `server/security/dnsTransport.ts`: native resolver adapter, timers, cache,
  in-flight coalescing, address cap, and global concurrency.
- `server/security/gather.ts`: candidate discovery, deduplication, 32-candidate
  cap, and 2 second report budget.
- `server/security/service.ts`: asynchronous `computeShield` orchestration and
  injected gatherer seam.
- `server/security/responses.ts`: public aggregation and mandatory redaction.
- HTTP route: await the service and return schema-conformant DNS evidence.
- MCP resources/tools: await the service and reuse the response mapper.
- Schema: add closed DNS evidence contracts and regenerate derived API types
  where required.
- UI: render score, outcome, counts, change/caution states, observation time,
  incomplete, and truncated indicators without raw network details.
- Tests: classifier tables, pure engine precedence, resolver
  timeout/cache/coalescing/concurrency behavior, response redaction, schema
  compatibility, HTTP behavior, MCP behavior, and UI states.

Test seams are mandatory. Resolver tests inject `resolveDns`; TTL and eviction
tests inject a clock; timeout and deadline tests inject timers; service tests
inject a DNS gatherer; engine tests pass plain evidence objects. A concurrency
test should hold four host promises open and prove a fifth does not begin. A
coalescing test should prove concurrent identical host requests call A and AAAA
only once each. Redaction tests should seed recognizable IP and error strings
internally and assert they are absent from serialized responses.

## Technical Decisions

1. **Use native Deno DNS only.** `Deno.resolveDns` supplies A and AAAA records
   without a new dependency. The permission and deployment implications remain
   visible and server-scoped.
2. **Keep classification and grading pure.** Network orchestration gathers
   facts; shared code interprets them. This makes policy deterministic and
   prevents server APIs from entering client bundles.
3. **Use one process singleton.** Cache, in-flight work, and the four-slot
   limiter must be shared across HTTP and MCP requests or the global bounds
   would be illusory.
4. **Coalesce by normalized hostname.** Lowercase, trailing-dot normalization,
   and IDN handling should produce a stable key while avoiding URL-path or port
   participation.
5. **Cache failures briefly.** Fifteen-second negative caching protects
   resolvers and report latency while allowing quick recovery. Successful
   observations remain useful for 60 seconds.
6. **Aggregate before crossing a boundary.** `responses.ts` emits semantic
   counts and metadata only. Raw IPs and errors are neither useful for the grade
   nor appropriate for routine disclosure.
7. **Treat uncertainty as caution, not safety.** Failure, timeout, partial
   answers, special ranges, and unknown syntax score 65 unless stronger
   actionable evidence requires 30.
8. **Preserve established trusted cases.** DNS grading supplements transport
   configuration; it does not penalize HTTPS, configured loopback, or recognized
   Docker-local transports.
9. **Avoid persistence and probes.** Cache state is operational and ephemeral.
   No migration, database table, background job, reachability request, or TLS
   probe is introduced.
10. **Make async propagation explicit.** Every HTTP and MCP caller of
    `computeShield` must await it, and compile-time signatures should expose
    missed call sites during implementation.

## Open Questions

The fixed grading and resource bounds leave several implementation details to
confirm against current domain contracts:

- What exact configured evidence constitutes “changed”: prior cached
  class/family aggregates, a configured expected address class, or both? The
  comparison input should be explicit and pure rather than inferred from cache
  eviction history.
- Should the public response aggregate per Arr instance, per hostname, or only
  per report check? The narrowest representation that still lets users locate
  the actionable configuration should be chosen, while hostname disclosure
  policy remains consistent with existing APIs.
- How should IPv4-mapped IPv6 records contribute to family counts? A recommended
  rule is to classify their embedded IPv4 semantics and count them as IPv6
  transport records, documenting both choices in tests.
- Which special-purpose CIDRs belong in `special` versus `private` or
  `link_local`? The classifier table should be exhaustive and grounded in a
  reviewed policy list, with unknown ranges failing closed to `special` or
  `unknown`, never `public` by default.
- Does the deployed Deno permission model already allow DNS resolution in every
  supported launch path? The implementation should fail into bounded caution
  evidence when permission is unavailable, without leaking the permission error.
- Should the 256-entry cache use strict LRU or insertion-order FIFO? LRU better
  protects active Arr hosts, but the choice must be deterministic under an
  injected clock and covered by eviction tests.
- How should UI copy distinguish “DNS changed” from “DNS incomplete”? Both
  affect trust, but changed evidence requires action at score 30 while
  incomplete evidence is cautionary at score 65.
- Are MCP resources snapshot-based or recomputed on each read? Regardless, all
  paths must use the same singleton and response redaction mapper so their
  semantics match HTTP.

These questions do not alter the fixed policy. They identify contract details
that should be decided before implementation so that engine behavior, generated
schema, API responses, MCP output, and UI language remain aligned.
