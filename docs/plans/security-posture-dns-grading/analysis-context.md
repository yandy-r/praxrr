# Context Analysis: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 is a bounded, report-only enrichment of Shield Check's existing
`arr_transport` criterion. It resolves only enabled, sync-capable Arr instances
whose stored `url` is plaintext HTTP, whose normalized host is multi-label, and
whose current non-DNS transport tier is `unknown`. The implementation must use
the deployment's system resolver for concurrent A and AAAA queries, convert
results immediately into aggregate address-class evidence, and feed those
materialized facts into the existing pure security engine. HTTPS, configured IP
literals, loopback, recognized local suffixes, and single-label/Docker aliases
retain their shipped behavior and perform no DNS work.

The design is fixed around conservative evidence. Complete DNS-local
observations score `65/attention`; any observed public address, mixed
local/public classes, or a transition across the public/non-public boundary
scores `30/action` and caps the overall band at `guarded`; all failed, partial,
empty, timed-out, budget-limited, special-use-only, malformed, or truncated
local-only observations remain `65/attention`. Public evidence always wins over
incompleteness. DNS-derived loopback never inherits the `100/pass` of a
configured loopback literal because DNS is mutable.

All time and I/O live in a new server-only resolver/cache component. Shared IP
parsing, classification, evidence interpretation, and scoring remain pure. HTTP,
the MCP resource, and the MCP tool must await the same service and share one
process-wide production singleton. OpenAPI, generated API bundle, runtime
mapper, UI, MCP, tests, the engine version (`3` to `4`), and `ROADMAP.md` ship
together. There is no database migration, background job, third-party
dependency, connection probe, user configuration, or coupling to any operational
Arr path.

## Architecture Context

The current flow is synchronous:

```text
HTTP summary / MCP resource / MCP tool
  -> computeShield(event?)
  -> buildPostureInputs(event?)
  -> computeShieldReport(inputs)
  -> toSummaryResponse(report)
```

The target flow introduces one asynchronous evidence boundary while preserving a
pure engine:

```text
HTTP summary / MCP resource / MCP tool
  -> await computeShield(event?)
  -> await buildPostureInputs(event?)
       -> read config + enabled Arr rows
       -> select/deduplicate/cap eligible hostnames
       -> shared singleton dnsTransport resolves/cache-joins under deadlines
       -> attach closed DnsTransportEvidence to InstanceFact rows
  -> computeShieldReport(materialized inputs)       # still pure
  -> toSummaryResponse(report)                      # explicit allowlist
  -> OpenAPI / HTTP / MCP / Svelte UI
```

The implementation should have these ownership boundaries:

- `shared/security/ip.ts` owns binary IPv4/IPv6 parsing, CIDR containment,
  IPv4-mapped IPv6 normalization, and the explicit class policy. It has no I/O,
  time, logging, config, or Deno resolver imports.
- `server/security/dnsTransport.ts` owns system DNS I/O, the per-host timeout,
  process-global semaphore, in-flight coalescing, bounded cache, expiry/LRU,
  aggregation, and public/non-public class-transition comparison. Export a
  production singleton plus an injected factory for deterministic tests.
- `server/security/gather.ts` remains the sole config/DB fact boundary. It owns
  eligibility, hostname normalization/deduplication, the 32-candidate limit, and
  the 2-second report deadline. It attaches evidence but never throws because
  one DNS row failed.
- `shared/security/checks.ts` and `engine.ts` interpret only materialized
  evidence. DNS work must never enter the pure engine.
- `server/security/responses.ts` remains the only internal-to-wire mapper. The
  public contract contains family/class counts and closed metadata, never
  resolver internals.
- The HTTP route and both MCP surfaces are consumers of the same async service;
  none may instantiate an independent resolver or serialize cache state.

The existing `arr_transport` weight, arithmetic, contribution invariants, and
mean of non-null row scores remain intact. Only individual row
evidence/tier/score precedence and the resulting existing rollup may change. The
existing non-DNS trusted cases are evaluated before DNS rules.

## Critical Files Reference

### Pure shared policy

- `packages/praxrr-app/src/lib/shared/security/types.ts`
  - Current `SECURITY_POSTURE_ENGINE_VERSION` is `'3'`; bump once to `'4'`
    because the versioned report surface and grading behavior change.
  - Add closed DNS outcome/source/count/evidence types, extend `InstanceFact`,
    `TransportRow`, and `TransportTier` as required, and keep all fields
    readonly.
- `packages/praxrr-app/src/lib/shared/security/ip.ts` (new)
  - Extract exact IP/CIDR primitives and add the explicit `loopback`, `private`,
    `link-local`, `public`, and `special` classifier.
  - Record the reviewed IANA registry snapshot date beside prefix policy.
- `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`
  - Replace embedded parsing primitives with imports from `ip.ts` without
    changing trusted-proxy token parsing, range semantics, wildcard behavior, or
    overly-broad trust detection.
- `packages/praxrr-app/src/lib/shared/security/checks.ts`
  - Preserve current URL-first classification and grade only eligible `unknown`
    HTTP hosts from attached DNS evidence.
  - Implement the fixed precedence and hedged recommendation language.
- `packages/praxrr-app/src/lib/shared/security/engine.ts`
  - Preserve pure rollup mechanics, exact contribution sum, recoverable-points
    logic, and band-cap behavior.
- `packages/praxrr-app/src/lib/shared/security/index.ts`
  - Export client-safe IP/evidence contracts only; never export server resolver
    code.

### Server orchestration and contracts

- `packages/praxrr-app/src/lib/server/security/dnsTransport.ts` (new)
  - Native `Deno.resolveDns` adapter, shared A+AAAA abort signal, global
    four-slot semaphore, in-flight map, 256-entry deterministic LRU cache,
    evidence aggregation, transition tracking, and injectable dependencies.
- `packages/praxrr-app/src/lib/server/security/gather.ts`
  - Convert `buildPostureInputs` to async, retain the degrade-never-throw
    behavior, and resolve only normalized stored `url` candidates. Never use
    `external_url`.
- `packages/praxrr-app/src/lib/server/security/service.ts`
  - Convert `computeShield` to `Promise<ShieldReport>` and await gathering
    before calling the pure engine.
- `packages/praxrr-app/src/lib/server/security/responses.ts`
  - Add mutable wire DTOs and explicit field-by-field mapping for closed DNS
    evidence.
- `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`
  - Await `computeShield(event)` and return `Cache-Control: no-store`. DNS
    degradation stays within a valid HTTP 200 report.
- `packages/praxrr-app/src/lib/server/mcp/resources.ts`
  - Await the shared service for `praxrr://security-posture`.
- `packages/praxrr-app/src/lib/server/mcp/tools.ts`
  - Await the shared service for `get_security_posture`.

### Portable and UI surfaces

- `docs/api/v1/schemas/security-posture.yaml`
  - Source of truth for the nested DNS evidence object, closed enums, required
    counts, flags, and nullable observation time.
- `packages/praxrr-api/openapi.json`
  - Regenerated with `deno task bundle:api`; do not hand-edit, and format it
    after generation.
- `packages/praxrr-app/src/lib/api/v1.d.ts`
  - Regenerate with `deno task generate:api-types` when required by the schema
    contract; review the diff for scoped contract changes.
- `packages/praxrr-app/src/routes/security-posture/+page.svelte`
  - Render compact family/class counts, source, original observation time,
    incomplete/truncated/change states, and explicit no-WAN-proof language using
    text interpolation only.
- `ROADMAP.md`
  - Mark #229 delivered and link the PR in the Ecosystem Security Posture
    entry/history using the repository's existing format.

### Tests

- `packages/praxrr-app/src/tests/shared/security/ip.test.ts` (new): exact
  parser, mapped-IPv6, IANA-prefix, malformed, and prefix-boundary tables.
- `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts` (new):
  injected resolver/clock/timers; every deadline, cache, capacity, coalescing,
  concurrency, cancellation, result-cap, and transition invariant.
- `packages/praxrr-app/src/tests/shared/security/checks.test.ts`: complete
  grading and precedence matrix.
- `packages/praxrr-app/src/tests/shared/security/engine.test.ts`: exact scores,
  caps, contributions, actionability, and version `4` invariants.
- `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`:
  extraction must leave proxy parsing/trust semantics byte-for-byte equivalent.
- `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`: migrated-DB
  HTTP 200, `no-store`, contract shape, failure degradation, and negative
  redaction/copy checks.
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts`: both MCP surfaces await and
  emit the same allowlisted evidence with failure degradation.
- `scripts/test.ts`: the current `security-posture` alias already includes
  `tests/shared/security`, `tests/server/security`, and the route suite; change
  it only if a new test lands outside those paths.

## Patterns to Follow

1. **Materialize I/O facts, then evaluate purely.** Follow the existing
   `gather.ts -> service.ts -> computeShieldReport()` seam. The async conversion
   ends at gathering; scoring remains deterministic and browser-safe.
2. **Explicit allowlisted wire mapping.** Follow `toWireTransportRow` in
   `responses.ts`. Copy every DNS field intentionally; never spread internal
   evidence or cache entries.
3. **Degrade never throw.** Match existing config/DB fact gathering: a resolver
   failure, permission denial, abort, timeout, empty answer, or malformed record
   produces a closed row outcome rather than rejecting the report.
4. **Exact bigint/u32 prefix math.** Extract the proven parsing/CIDR machinery
   from `trustedProxy.ts`, then keep trusted-proxy policy separate from
   address-class policy. Unknown or special address space fails closed to
   `special`, never by exclusion to `public`.
5. **Injected nondeterminism.** The resolver factory accepts the resolver,
   clock, timers, and any scheduler seam needed by tests. Unit tests must not
   query live DNS, sleep, or depend on wall-clock timing.
6. **Contract-first generation.** Change the YAML source before generated
   artifacts, generate instead of hand-editing, and keep schema/runtime
   mapper/MCP/UI in lockstep.
7. **Stable configured identity.** Continue exposing only the already-present
   configured hostname and exact `arrType`; reject empty inputs but do not leak
   credentials, paths, queries, full URLs, or resolver-returned addresses.
8. **Evidence language, not exposure claims.** Use “observed from Praxrr's
   resolver,” “Address scope changed,” and a visible statement that DNS alone
   does not prove WAN reachability. Do not say “publicly reachable,” “exposed,”
   “rebound,” or “attack detected” based on DNS evidence.

## Cross-Cutting Concerns

### Security and privacy

- Resolve stored eligible names only through the system resolver. Do not accept
  request hostnames, alternate nameservers, timeout overrides, cache bypasses,
  or manual CNAME traversal.
- Do not fetch, connect, probe TCP/HTTP/TLS, pin, rewrite, route, authorize, or
  reject an Arr operation based on DNS results. DNS grading is advisory and
  report-only.
- Never return or ordinarily log raw answers, nameservers, CNAMEs, resolver
  error text, exception stacks, URL credentials/path/query, or API keys. Public
  outputs contain only configured host identity, bounded counts, closed
  outcome/source metadata, observation time, and flags.
- Use one `AbortSignal` for both family lookups, clear timers and in-flight
  entries in `finally`, and include semaphore queue time in the report deadline.
- `Cache-Control: no-store` protects the authenticated HTTP response; cache
  policy applies only to internal aggregate observations.

### Classification and grading correctness

- Normalize IPv4-mapped IPv6 to embedded IPv4 semantics before classification.
- Explicitly classify loopback, RFC1918/ULA private, link-local, public unicast,
  and special-use. Unspecified, CGNAT, documentation, multicast, benchmarking,
  reserved, and malformed values are `special`/unknown evidence.
- A single public answer is actionable even when the other family fails or
  retention is truncated. Without public evidence, any
  partial/truncated/budget-limited/special state prevents a local-only
  conclusion.
- Compare public/non-public class fingerprints between consecutive successful
  fresh observations, not exact addresses. The change flag lasts for the new
  positive-cache entry; normal address rotation within a class is not a change.
- A cache hit preserves the original `observedAt`; it changes only `source` to
  `cache` and never refreshes freshness.

### Resource control and reliability

- Enforce the fixed bounds at their owning layers: 2,000 ms per report including
  queue time; one shared 1,500 ms A+AAAA host timeout; at most 32 candidate
  hostnames per report; at most four active host resolutions process-wide; at
  most 16 unique retained classified addresses per host; 60,000 ms positive and
  15,000 ms failure cache lives; 256 cache entries.
- Deduplicate normalized hostnames and coalesce in-flight work before acquiring
  a semaphore slot. HTTP and MCP calls share both work and limits.
- Expire entries before deterministic LRU eviction. Candidate/result-cap hits
  must set incomplete/budget evidence rather than silently dropping uncertainty.
- A restricted runtime without DNS permission must still return a valid report
  and must not request new permission dynamically.

### Contract, accessibility, and cross-Arr fidelity

- Closed OpenAPI enums, runtime types, mapper output, MCP output, and UI
  rendering must describe exactly the same evidence states.
- Preserve `radarr`, `sonarr`, or `lidarr` exactly on each row. The transport
  policy is common, but there is no sibling-app fallback or inferred mapping.
- Color is supplemental. Every DNS state needs a text label;
  incomplete/change/freshness indicators and the no-WAN-proof qualifier cannot
  require hover.
- Preserve the report while refreshing, use one polite live region and
  `aria-busy`, keep focus stable, and never use `{@html}` for host or
  resolver-derived content.

## Parallelization Opportunities

The dependency graph should drive task batching:

1. **Foundation is serial and blocking:** freeze shared evidence types, extract
   IP primitives, implement the classifier, and pin pure boundary/grading tests.
   All later work depends on these contracts.
2. **After types/classifier freeze, two tracks can run in parallel:**
   - server resolver/cache/semaphore implementation plus deterministic tests;
   - OpenAPI schema-source drafting and response DTO design. Generated artifacts
     must wait until the schema and runtime shape agree.
3. **Async integration follows the resolver:** update gather/service, then
   independently update the HTTP route and the two MCP call sites once the
   service signature is final. Search every `computeShield(` and
   `buildPostureInputs(` caller before declaring this complete.
4. **Contract consumers follow the public mapper:** HTTP/MCP contract tests and
   Svelte UI work can proceed in parallel after the wire shape is fixed. UI does
   not import resolver internals.
5. **Release work is last:** generated-artifact review, engine/version
   assertions, `ROADMAP.md`, full validation, manual controlled-resolver checks,
   PR review/fixes, and CI are downstream of all implementation tracks.

Avoid parallel edits to the shared types/checks/engine cluster or to the same
generated API artifacts. Those files establish contracts and are likely
merge-conflict hotspots.

## Implementation Constraints

- No product decision remains open: do not reopen candidate scope, resolver
  viewpoint, bounds, cache policy, grading, redaction, or module ownership
  during planning.
- Candidate normalization uses `URL.hostname`, lowercase, and removal of one
  terminal dot. Resolve only existing `unknown` multi-label HTTP hosts from
  stored Arr `url`; never `external_url`.
- Query A and AAAA concurrently with one shared abort deadline. Do not configure
  a nameserver and do not manually follow CNAMEs.
- No new dependency, database table/migration, persisted topology history,
  background refresh, user-tunable setting, debug raw-answer mode, or
  reachability probe.
- The process-local singleton is shared only within a process; do not claim
  cluster-wide cache/concurrency semantics.
- Internal cache storage may retain bounded normalized addresses only when
  required for classification/transition comparison. They never cross
  `responses.ts`.
- Keep established `100/pass` results for HTTPS, configured loopback, and
  recognized Docker-local connections. DNS can enrich only the eligible shipped
  `unknown` case.
- Keep the `arr_transport` criterion weight and the engine's exact
  rollup/contribution invariants. Public/mixed/changed rows remain critical
  enough to cap the band at `guarded`; DNS-local/incomplete rows do not become
  critical.
- Follow repository formatting: tabs in code, single quotes, no trailing commas,
  100 character print width. Use Svelte 5 event attributes and no runes.
- Update the source schema before generated artifacts; never hand-edit
  `packages/praxrr-api/openapi.json`.
- Update `ROADMAP.md` in the same change and retain the repository PR
  template/issue linkage in the later publishing workflow.

### Exact validation gates

Run in this order, fixing scoped failures before advancing:

1. `deno task test packages/praxrr-app/src/tests/shared/security/ip.test.ts`
2. `deno task test packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`
3. `deno task test packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`
4. `deno task test security-posture`
5. `deno task test mcp`
6. `deno task bundle:api`
7. `deno task generate:api-types`
8. `deno task format`
9. `deno task lint`
10. `deno task check`
11. `deno task test`
12. `deno task check:dist-paths`
13. `git diff --check`
14. `graphify update .` after code changes, followed by another
    `git diff --check`.

The focused automated tests must deterministically prove all seven resource
values, including global concurrency across concurrent callers, in-flight
coalescing, expiry and 257th-entry eviction, preserved observation time,
cancellation cleanup, candidate/report budget exhaustion, and the 16-answer cap.
Route and MCP tests must prove resolver failure still yields a valid report, raw
addresses/errors/secrets never appear, and every consumer awaits the result.
Manual validation uses a controlled/injected resolver or controlled test DNS for
complete-local, public, mixed, family-partial, truncated, class-changing,
timeout, failed, empty, and cache-hit cases; it must never depend on arbitrary
live DNS.

## Key Recommendations

1. Land the pure IP/evidence policy first and treat its test tables as the
   security specification. This isolates address-policy defects from concurrency
   defects.
2. Build `dnsTransport.ts` as a small stateful I/O shell around pure
   classification. Keep one production singleton but expose a factory with
   injected resolver, clock, and timers so tests are fast and exact.
3. Make candidate selection explicit and testable in `gather.ts`: URL-first
   eligibility, normalization, deduplication, deterministic cap ordering, report
   deadline, and row-local degradation.
4. Encode grading precedence in one pure decision function: trusted configured
   cases first; then public/mixed/changed `30/action`; then complete local-only
   or all uncertain states `65/attention`.
5. Freeze the nested IPv4/IPv6 class-count wire contract before integrating
   consumers. Use the explicit mapper as the sole redaction boundary and ship
   OpenAPI, HTTP, MCP, and UI together.
6. Audit forbidden coupling with import/search checks: `dnsTransport.ts` must
   not be imported by Arr clients, connection tests, sync, jobs, startup, save,
   authorization, or URL-safety code.
7. Treat async call-site completeness and report availability as release
   blockers. Search all service/gather callers and prove that DNS failures are
   typed evidence, not rejected promises or HTTP 500 responses.
8. Complete release evidence only after the full gate set passes: version `4`,
   updated `ROADMAP.md`, regenerated/formatted contract artifacts, controlled
   scenario checks, PR review fixes, and green CI.
