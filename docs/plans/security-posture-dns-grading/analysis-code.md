# Code Analysis: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 extends one existing scored check, `arr_transport`, without adding a
check ID, database state, operational Arr dependency, or probe. The
implementation should materialize bounded DNS observations at the existing
server gather boundary, carry them on `InstanceFact`, and let the pure shared
scorer interpret the closed evidence. This preserves the current architecture:

`computeShield(event?)` -> `buildPostureInputs(event?)` ->
`computeShieldReport(inputs)` -> `toSummaryResponse(report)`.

The main code risks are not in basic DNS lookup. They are (1) extracting the
exact IPv4/IPv6 parser from `trustedProxy.ts` without changing proxy trust, (2)
enforcing report, host, result, cache, and process-global concurrency bounds
together, (3) propagating the gather/service conversion to async through the
HTTP route and both MCP consumers, and (4) keeping the internal, wire, OpenAPI,
generated, MCP, and UI evidence shapes identical. The current engine version is
`'3'`; because the transport formula and report surface change, it must become
`'4'` and the literal assertions in `engine.test.ts` and
`securityPosture.test.ts` must follow it.

No runtime dependency is needed. Native `Deno.resolveDns`, `AbortController`,
timers, `URL`, and bounded `Map` state cover the implementation. DNS remains
report-only: no import or call is allowed from Arr clients, sync, jobs, startup,
save, test-connection, URL authorization, or routing code.

## Existing Code Structure

### Pure shared security engine

- `packages/praxrr-app/src/lib/shared/security/types.ts`
  - `SECURITY_POSTURE_ENGINE_VERSION = '3'` is the single report version
    constant.
  - `TransportTier` is currently
    `'encrypted' | 'loopback' | 'docker-alias' | 'private' |
'unknown' | 'public'`.
  - `InstanceFact` is currently `{ id, name, arrType, url }`.
  - `TransportRow` is the portable internal row and currently has no DNS field.
  - `PostureInputs.instances` is the sole transport input to the pure engine.
- `packages/praxrr-app/src/lib/shared/security/checks.ts`
  - Private helpers `stripBrackets`, `isIpv4`, and `classifyIpv4` feed exported
    `classifyHost(rawHost: string)`.
  - `gradeUrl(rawUrl: string): TransportGrade` parses the stored URL and assigns
    the shipped `100/65/30/null` grades.
  - `transportRowFor(instance: InstanceFact): TransportRow` attaches the
    existing instance fix.
  - `buildTransportRows(instances: readonly InstanceFact[]): TransportRow[]` is
    called by both the check and report engine.
  - `arrTransport.score(inputs)` averages non-null row scores, marks any
    `tier === 'public'` as an action, and caps the band at `guarded`.
- `packages/praxrr-app/src/lib/shared/security/engine.ts`
  - `computeShieldReport(inputs: PostureInputs): ShieldReport` runs
    `ALL_CHECKS`, rolls up exact contributions, applies caps, then calls
    `buildTransportRows(inputs.instances)` for the detail table.
  - DNS must not introduce I/O, `Date`, timers, or resolver imports here.
- `packages/praxrr-app/src/lib/shared/security/index.ts` is the client-safe
  barrel. It currently exports `classifyHost`, `buildTransportRows`, and
  trusted-proxy APIs.

### Exact IP/CIDR implementation to extract

`packages/praxrr-app/src/lib/shared/security/trustedProxy.ts` already contains
correct binary math:

- `parseIpv4ToU32(ip: string): number | null`
- `parseIpv6ToBigInt(ip: string): bigint | null`
- `parseIpLiteral(raw: string): ParsedIp | null`
- `maskV4(prefix: number): number` and `maskV6(prefix: number): bigint`
- `containsV4(base, prefix, peer)` and `containsV6(base, prefix, peer)`
- `parseCidrToken(token: string): CidrRange | null`

It handles decimal IPv4 octets, RFC 4291 compression, embedded IPv4 tails,
bracket stripping, zone-id rejection, and dotted `::ffff:a.b.c.d` normalization.
Those primitives are private today. They should move to the new shared `ip.ts`,
with `trustedProxy.ts` importing them. `parseTrustedProxy` and
`isTrustedProxyPeer` must retain their current public signatures and behavior,
including raw token preservation, keyword expansion, overly-broad detection, and
fail-closed parsing.

### Server gather/service boundary

- `packages/praxrr-app/src/lib/server/security/gather.ts`
  - `gatherInstances(): InstanceFact[]` reads
    `arrInstancesQueries.getEnabled()`, filters with `isSyncPreviewArrType`, and
    preserves `instance.type as ShieldArrType` plus the stored `url`.
  - `buildPostureInputs(event?: SessionRequestContext): PostureInputs` is
    synchronous today and is the only config/DB boundary.
  - Existing read failures degrade locally and never throw; DNS must use the
    same row-local policy.
- `packages/praxrr-app/src/lib/server/security/service.ts`
  - `computeShield(event?: SessionRequestContext): ShieldReport` synchronously
    composes gather and pure evaluation.
- Current consumers of `computeShield(` are exactly:
  - HTTP summary route: `routes/api/v1/security-posture/summary/+server.ts`.
  - MCP resource: `mcp/resources.ts`, `praxrr://security-posture`.
  - MCP tool: `mcp/tools.ts`, `get_security_posture`.

All three must await the new `Promise<ShieldReport>`. The two MCP registry
entries currently wrap the sync result in `Promise.resolve`; replace that with
an `async` callback or a direct promise chain so `toSecuritySummary` receives a
report, not a promise.

### Wire, API, and UI

- `packages/praxrr-app/src/lib/server/security/responses.ts` is an explicit
  allowlist mapper. `WireTransportRow` and `toWireTransportRow(row)` must add
  the closed DNS DTO by copying every count and flag. Do not spread internal
  resolver/cache objects.
- `docs/api/v1/schemas/security-posture.yaml` owns `SecurityTransportTier`,
  `SecurityTransportRow`, and `SecurityPostureSummaryResponse`. DNS schemas
  belong here first.
- Generated mirrors currently contain the same transport contract:
  - `packages/praxrr-app/src/lib/api/v1.d.ts`
  - `packages/praxrr-api/openapi.json`
  - `packages/praxrr-api/types.ts`
- `routes/security-posture/+page.svelte` renders the transport table from
  `SecurityPostureSummaryResponse` and already preserves the previous report
  during refresh.
- `lib/client/ui/security/shieldStatus.ts` is an additional required
  modification not named in the initial relevant-file list: its exhaustive
  `Record<TransportTier, string>` and `tierVariant` switch must cover any new
  `mixed`/`changed` tier values.

## Implementation Patterns

### Closed materialized evidence

Add the spec's types in `types.ts`: `IpAddressClass`, `DnsOutcome`,
`DnsEvidenceSource`, `DnsAddressClassCounts`, and `DnsTransportEvidence`. Add
`dns` to `InstanceFact` and `TransportRow`. Use a fully populated evidence
object for every row, including `outcome: 'not-applicable', source: 'none'`,
zero counts, `observedAt: null`, and false flags. A required nested object is
safer than optional/null variants because checks, mapper, OpenAPI, MCP, and UI
then share one closed contract.

The server module may internally retain normalized addresses and stable failure
categories, but the shared input and public response must contain only
family/class counts, retained count, observation time, and `incomplete`,
`truncated`, and `addressClassesChanged` flags.

### Pure classification before async integration

Create `packages/praxrr-app/src/lib/shared/security/ip.ts` and move the binary
parser/mask/containment primitives into it before adding
`classifyIpAddress(raw: string): IpAddressClass | null` (exact name may vary,
but one shared classifier must serve literals and DNS answers). The classifier
must:

- normalize IPv4-mapped IPv6 to embedded IPv4 semantics;
- distinguish loopback, RFC1918/ULA private, link-local, public, and special;
- classify malformed values as null/special evidence, never public;
- classify reserved, documentation, multicast, CGNAT, unspecified, benchmarking,
  and other reviewed special-purpose prefixes as `special`;
- record the IANA registry review date beside the prefix tables and pin every
  table boundary in `ip.test.ts`.

Then rewrite `classifyHost` to use this shared literal classifier while
preserving hostname rules: `localhost`/`0.0.0.0` shipped loopback behavior,
recognized local suffixes as private, single-label names as docker aliases, and
unknown multi-label names as unknown. The trusted-proxy suite is the regression
gate for extraction; proxy trust policy must not start using the new
public/special grading semantics.

### Injectable bounded resolver factory

Create `packages/praxrr-app/src/lib/server/security/dnsTransport.ts` with a
factory plus one module-level production singleton. Mirror repository
dependency-object seams such as
`checkInstanceDrift(instance, deps: Partial<DriftCheckDeps> = {})`, but inject
every source of nondeterminism:

- `resolveDns(host, 'A' | 'AAAA', { signal })`
- `now(): number`
- timer creation and clearing

Expose fixed policy constants for: 2,000 ms report deadline, 1,500 ms shared
host timeout, 32 unique candidate hosts per report, four process-global active
hostname resolutions, 16 retained unique answers per host, 60-second positive
lifetime, 15-second failed/empty/timed-out lifetime, and 256 combined cache
entries.

The production singleton must own the cache, in-flight map, and semaphore so
simultaneous HTTP/MCP reports cannot multiply the four-host bound. A and AAAA
for one host run concurrently under one `AbortController` and one timer. Always
pass the signal into `Deno.resolveDns`; a bare `Promise.race` leaves resolver
work running and is insufficient.

Normalize candidate keys from `new URL(instance.url).hostname`: lowercase and
remove one terminal dot; URL parsing supplies IDNA ASCII normalization. Resolve
only stored `url` values that are HTTP, multi-label, and
`classifyHost(host) === 'unknown'`. Never use `external_url`. Deduplicate
normalized hosts before applying the 32-host cap, then fan the one observation
back to every matching instance. Use stable instance order for deterministic cap
behavior.

Queue time counts toward the 2-second report deadline. A waiter that cannot
start within the report budget returns `budget-exceeded`; it must not begin a
late 1.5-second wave. When joining a global in-flight lookup, respect the
current report's remaining deadline without aborting work owned by a different
report.

Use deterministic LRU behavior: current cache hits move to most-recent, writes
replace then move, capacity eviction removes expired entries before the oldest
live entry, and size never exceeds 256. A cache hit returns `source: 'cache'`
while preserving the original `observedAt`. Keep an expired successful entry
long enough to compare the next successful semantic class fingerprint. If the
new observation crosses the public/non-public boundary, set
`addressClassesChanged` on the new positive entry for its cache lifetime; do not
label it an attack.

### Conservative grading precedence

`gradeUrl`/`transportRowFor` should apply these rules in order:

1. HTTPS, configured literal loopback, and docker alias retain `100/pass` and do
   no DNS work.
2. A DNS observation containing any public address is `30/action`; local+public
   is `mixed`.
3. `addressClassesChanged` is `30/action` even if the current observation is
   local-only.
4. Complete, untruncated DNS loopback/private/link-local-only evidence is
   `65/attention` (never 100, because DNS is mutable).
5. Failure, timeout, empty, budget exhaustion, special-only, malformed, partial
   local-only, or truncated local-only evidence stays `65/attention` as
   unknown/incomplete.
6. Public evidence remains actionable even if another family failed or retention
   truncated.

`arrTransport.score(inputs)` can keep its mean-of-non-null structure, but its
critical-row predicate must include public, mixed, and changed DNS findings, not
only `tier === 'public'`. Recommendation copy must say “observed from Praxrr's
resolver” and that DNS does not prove WAN reachability. Never emit “publicly
reachable,” “exposed,” “rebind attack,” raw address text, or resolver errors.

## Integration Points

### Exact files to create

- `packages/praxrr-app/src/lib/shared/security/ip.ts`
- `packages/praxrr-app/src/lib/server/security/dnsTransport.ts`
- `packages/praxrr-app/src/tests/shared/security/ip.test.ts`
- `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`

### Exact files to modify

- `packages/praxrr-app/src/lib/shared/security/types.ts`
- `packages/praxrr-app/src/lib/shared/security/checks.ts`
- `packages/praxrr-app/src/lib/shared/security/engine.ts` (version/report
  regression context; avoid logic here unless row construction needs an explicit
  adaptation)
- `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`
- `packages/praxrr-app/src/lib/shared/security/index.ts`
- `packages/praxrr-app/src/lib/server/security/gather.ts`
- `packages/praxrr-app/src/lib/server/security/service.ts`
- `packages/praxrr-app/src/lib/server/security/responses.ts`
- `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`
- `packages/praxrr-app/src/lib/server/mcp/resources.ts`
- `packages/praxrr-app/src/lib/server/mcp/tools.ts`
- `packages/praxrr-app/src/routes/security-posture/+page.svelte`
- `packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts`
- `docs/api/v1/schemas/security-posture.yaml`
- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`
- `packages/praxrr-app/src/tests/shared/security/checks.test.ts`
- `packages/praxrr-app/src/tests/shared/security/engine.test.ts`
- `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`
- `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts`
- `ROADMAP.md`

`scripts/test.ts` already includes the whole `tests/shared/security`,
`tests/server/security`, route, and MCP-adjacent server directories in
`security-posture`; no alias edit is necessary for the two new test files. MCP
contract coverage still requires either running `deno task test mcp` separately
or adding `packages/praxrr-app/src/tests/mcp/mcp.test.ts` to the
security-posture alias.

### Async signatures and call-site edits

- `buildPostureInputs(event?, deps?): Promise<PostureInputs>`: gather sync
  facts, await the singleton resolver's instance observation, then construct
  inputs with one captured `nowIso`.
- `computeShield(event?, deps?): Promise<ShieldReport>`:
  `computeShieldReport(await
buildPostureInputs(event, deps))`.
- HTTP GET: `const report = await computeShield(event)` and return
  `json(..., { headers: {
'cache-control': 'no-store' } })`; retain the
  current generic 500 behavior for unrelated failures.
- MCP resource `read`: `async () => toSecuritySummary(await computeShield())`.
- MCP tool `handler`: `async () => toSecuritySummary(await computeShield())`.

No request parameter, hostname override, nameserver override, cache bypass, or
timeout override is added to HTTP or MCP.

## Code Conventions

- Shared security modules remain pure and client-safe; server-only DNS code
  imports shared policy, never the reverse.
- Use tabs/single quotes/no trailing commas/100-column Prettier output as
  configured by the project.
- Use Svelte 5 without runes. Preserve the current report while refresh is
  pending, add `aria-busy`, a polite completion live region, a real table
  caption, and scoped headers while extending evidence.
- Keep `arrType` unchanged on every `InstanceFact` and `TransportRow`; no
  Radarr/Sonarr/Lidarr fallback or sibling mapping is involved.
- Preserve the explicit response mapper. Copy nested IPv4/IPv6 count objects
  field by field.
- Use fixed literals for outcome/tier/source unions and exhaustive
  switches/records so a new state fails type checking on the UI and mapper
  surfaces.
- Do not log resolver errors, raw answers, URL credentials, path/query,
  nameserver data, or CNAMEs.
- Update `ROADMAP.md` in the existing Ecosystem Security Posture history/summary
  locations after the PR number is known; replace the open #229 follow-up
  language with shipped linkage.

## Dependencies and Services

- Runtime service: native `Deno.resolveDns(hostname, 'A' | 'AAAA', { signal })`
  using the deployment's system resolver and existing `--allow-net` permission.
- No third-party package, database migration, configuration variable, job,
  persistent cache, nameserver option, DoH client, `fetch`, `Deno.connect`, or
  Arr client.
- OpenAPI workflow from repo root:
  1. Edit `docs/api/v1/schemas/security-posture.yaml` first.
  2. Run `deno task generate:api-types` for
     `packages/praxrr-app/src/lib/api/v1.d.ts`.
  3. Run `deno task bundle:api` for `packages/praxrr-api/openapi.json` and
     `types.ts`.
  4. Run `npx prettier --write packages/praxrr-api/openapi.json`.
  5. Review generated diffs and retain only issue-relevant schema changes if
     local tool-version churn appears.
- Validation commands:
  - `deno task test security-posture`
  - `deno task test mcp`
  - `deno task check`
  - `deno task lint` (or scoped modified-file lint/format while iterating)
  - `deno task build`
  - `git diff --check`
  - `graphify update .` after code changes, per repository instructions

## Gotchas and Warnings

- `0.0.0.0` is intentionally classified as loopback by the shipped Arr transport
  heuristic even though it is a wildcard bind elsewhere. Do not accidentally
  change the existing configured-URL grade while extracting the general IP
  classifier.
- Current `classifyHost` collapses IPv4 link-local into `private`; DNS evidence
  needs a distinct `linkLocal` count while configured literal behavior remains
  backward-compatible unless the frozen grading matrix explicitly changes its
  label only.
- The current IPv6 heuristic treats most IPv6 literals as unknown. The new exact
  classifier must not make unfamiliar or reserved IPv6 public by default.
- `trustedProxy.ts` accepts pure-hex IPv4-mapped IPv6 as IPv6 today while dotted
  mapped addresses fold to IPv4. If normalization is broadened, prove
  trusted-proxy matching remains byte-for-byte compatible with regression tests
  before accepting it.
- A+AAAA partial success is not failure. Preserve family completion separately:
  local-only plus one failed family is incomplete/65; public plus one failed
  family is still actionable/30.
- Truncation must happen after deterministic de-duplication, but public evidence
  already seen cannot be discarded by later truncation. Scan/classify bounded
  returned values as they are accepted and retain a public flag independently of
  display counts if needed.
- Cache TTLs are Praxrr observation lifetimes, not authoritative DNS TTLs. Never
  name them `dnsTtl`.
- `observedAt` is the original lookup time. Cache reads must not restamp it, and
  report `generatedAt` must not masquerade as observation time.
- A per-report semaphore is insufficient. The four-host limit must be owned by
  the process singleton shared by HTTP and MCP.
- A report timeout must include semaphore queue time. Otherwise 32 candidates
  can serialize into multiple 1.5-second waves after the supposed 2-second
  deadline.
- In-flight joining and report cancellation have different ownership. A late
  report may stop waiting without aborting a lookup started for another caller.
- The current MCP test validates only that `get_security_posture` has a numeric
  score; extend it to cover both the tool and `praxrr://security-posture`
  resource, async completion, DNS failure degradation, closed evidence keys, and
  absence of raw answers/errors.
- The current route does not set `Cache-Control: no-store`; add it as part of
  the DNS evidence change.
- Generated artifacts are contract deliverables. Updating only YAML and
  hand-written DTOs leaves `v1.d.ts` and the published `praxrr-api` mirror
  stale.

## Task-Specific Guidance

Use these dependency-safe file groups:

1. **IP extraction and policy**: create `ip.ts`; adapt `trustedProxy.ts` and
   `index.ts`; add `ip.test.ts`; run `trustedProxy.test.ts` plus the new IP
   tests. This group must land before the resolver and should make no Shield
   score change by itself.
2. **Evidence contract and pure grading**: modify `types.ts`, `checks.ts`,
   `engine.test.ts`, and `checks.test.ts`; bump engine `3 -> 4`; pin every
   private/public/mixed/partial/truncated/special/ changed matrix row and
   existing non-DNS grades.
3. **Bounded resolver**: create `dnsTransport.ts` and its deterministic test.
   Prove every numeric bound, A/AAAA concurrency, abort, queue deadline,
   in-flight join, positive/failure TTL, LRU capacity, observation timestamp,
   class transition, duplicate-host fan-out, and no-live-DNS test invariant.
4. **Async server integration**: modify gather/service/HTTP/MCP together. Route
   and MCP tests must use an injected resolver or pre-resolved deterministic
   dependency; automated tests must never sleep or query live DNS.
5. **Portable contract and UI**: update YAML first, then response mapper,
   generated artifacts, `shieldStatus.ts`, and page rendering. Add class counts,
   source/freshness, incomplete/truncated/ changed wording, no-WAN-proof
   qualifier, caption/scopes, and live refresh semantics.
6. **Release evidence**: update `ROADMAP.md`, run generation and all
   focused/full gates, run controlled manual resolver cases, and search
   operational code to confirm DNS remains report-only.

Before calling implementation complete, verify the following targeted invariants
in addition to green commands:

- Candidate work occurs only for enabled sync-capable stored HTTP unknown
  multi-label hosts.
- HTTPS, literals, recognized suffixes, and single-label aliases make zero
  resolver calls.
- Every row preserves its exact `instanceId`, `instanceName`, and `arrType`.
- Public/mixed/changed evidence caps `arr_transport` at guarded; DNS-local
  evidence never becomes `100/pass`.
- Resolver permission denial, timeout, rejection, empty response, and
  report/candidate exhaustion all return HTTP 200 and valid MCP output.
- Serialized HTTP and MCP payloads contain no raw returned address, resolver
  error, credentials, URL path/query, nameserver, or CNAME.
- DNS code has no call path from Arr connection, sync, job, startup, save, or
  authorization modules.
