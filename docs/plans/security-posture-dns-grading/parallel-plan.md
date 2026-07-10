# DNS-Aware Arr Transport Grading Implementation Plan

Issue #229 adds bounded DNS A/AAAA evidence to the existing pure Shield Check
transport criterion for unknown multi-label HTTP Arr hosts. The implementation
extracts exact shared IP parsing, adds a server-only resolver with
process-global concurrency/cache bounds, materializes observations before pure
grading, and propagates the async contract through HTTP and both MCP consumers.
OpenAPI, generated artifacts, the explicit wire mapper, accessible UI, tests,
engine version, and `ROADMAP.md` ship together; no DB, dependency, background
job, reachability probe, or operational Arr decision is added.

## Worktree Setup

- **Parent**: /home/yandy/Projects/github.com/yandy-r/praxrr-issue-229/ (branch:
  feat/security-posture-dns-229)

## Critically Relevant Files and Documentation

- CLAUDE.md: Repository architecture, contract-first API, cross-Arr, formatting,
  and test rules.
- docs/plans/security-posture-dns-grading/feature-spec.md: Fixed issue scope,
  bounds, grading, evidence, and acceptance criteria.
- docs/plans/security-posture-dns-grading/shared.md: Codebase files, patterns,
  and implementation constraints.
- docs/internal/security-posture-design.md: Original threat model, transport
  weight, score ladder, and band-cap intent.
- docs/internal/227-session-hardening/design.md: Recent unknown-versus-verified
  evidence and versioning precedent.
- docs/internal/228-trusted-proxy/DESIGN.md: Exact IP math and proxy-trust
  behavior that extraction must preserve.
- packages/praxrr-app/src/lib/shared/security/types.ts: Versioned shared inputs,
  rows, checks, and report contracts.
- packages/praxrr-app/src/lib/shared/security/checks.ts: Current URL
  classification and transport grading.
- packages/praxrr-app/src/lib/shared/security/trustedProxy.ts: Existing
  u32/bigint IP and CIDR primitives.
- packages/praxrr-app/src/lib/server/security/gather.ts: Sole runtime/config/DB
  fact-gathering boundary.
- packages/praxrr-app/src/lib/server/security/responses.ts: Explicit
  internal-to-wire allowlist mapper.
- docs/api/v1/schemas/security-posture.yaml: Source portable security-posture
  schema.
- packages/praxrr-app/src/routes/security-posture/+page.svelte: Existing report
  refresh and transport table UI.
- packages/praxrr-app/src/tests/shared/security/checks.test.ts: Pure transport
  policy test precedent.
- packages/praxrr-app/src/tests/routes/securityPosture.test.ts: HTTP contract
  and secret-redaction test precedent.
- ROADMAP.md: Ecosystem Security Posture delivery tracking.

## Implementation Plan

### Phase 1: Pure Address and Evidence Foundation

#### Task 1.1: Extract Exact IP Primitives and Address Classification Depends on [none]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/shared/security/trustedProxy.ts
- packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts
- docs/plans/security-posture-dns-grading/feature-spec.md

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/shared/security/ip.ts
- packages/praxrr-app/src/tests/shared/security/ip.test.ts

Files to Modify

- packages/praxrr-app/src/lib/shared/security/trustedProxy.ts
- packages/praxrr-app/src/lib/shared/security/index.ts

Move the proven IPv4 u32, IPv6 bigint, mapped-IPv6, CIDR mask, and containment
primitives into a pure client-safe module. Add an explicit
`loopback | private | link-local | public | special` classifier using a
reviewed, dated IANA special-purpose prefix table; malformed, unspecified,
CGNAT, documentation, benchmarking, multicast, reserved, and unfamiliar values
must not default to public. Keep trusted-proxy token grammar, keyword expansion,
wildcard behavior, invalid-entry handling, and overly-broad policy unchanged.
Pin prefix boundaries, mapped IPv6, zone-id rejection, and malformed input in
table tests. Export the pure IP surface from the shared barrel. Validate with
the new IP test and the existing trusted-proxy test.

#### Task 1.2: Define Versioned DNS Evidence Contracts Depends on [none]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/shared/security/types.ts
- packages/praxrr-app/src/lib/shared/security/index.ts
- docs/api/v1/schemas/security-posture.yaml

**Instructions**

Files to Modify

- packages/praxrr-app/src/lib/shared/security/types.ts

Add closed readonly types for DNS outcomes, source, per-family address-class
counts, retained count, nullable observation time, incomplete/truncated flags,
and public/non-public class change as standalone contracts without making
existing fixtures/builders satisfy new required fields yet. Leave the branch
type-correct. Preserve exact `arrType`, the current engine version, and the
existing check-id/weight surface; consumer attachment and versioning occur with
their executable-policy tasks. Use the feature-spec vocabulary exactly,
including `not-applicable`, `resolved`, `partial`, `timeout`, `failed`, `empty`,
`budget-exceeded`, `none`, `fresh`, and `cache`.

### Phase 2: Pure Grading and Bounded DNS Resolution

#### Task 2.1: Implement the Conservative DNS Transport Matrix Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/shared/security/checks.ts
- packages/praxrr-app/src/tests/shared/security/checks.test.ts
- docs/plans/security-posture-dns-grading/feature-spec.md

**Instructions**

Files to Modify

- packages/praxrr-app/src/lib/shared/security/types.ts
- packages/praxrr-app/src/lib/shared/security/checks.ts
- packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts
- packages/praxrr-app/src/tests/shared/security/checks.test.ts

Attach optional materialized evidence to `InstanceFact`, derived evidence to
`TransportRow`, and the user-visible tier additions while updating scorer
fixtures in this task so the branch stays type-correct. Keep URL-first shipped
behavior: HTTPS, configured loopback, recognized Docker aliases, local suffixes,
and literals are decided before DNS. For an eligible unknown HTTP hostname,
consume only attached evidence. Complete DNS loopback/private/link-local is
`65/attention`; any public answer, mixed scope, or public/non-public change is
`30/action`, critical, and capped at guarded; every non-public partial, failed,
timeout, empty, budget-limited, truncated, malformed, or special state remains
unknown `65/attention`. Public evidence wins over incompleteness.
Recommendations must say evidence was observed by Praxrr's resolver and that DNS
does not prove WAN reachability. Pin IPv4, IPv6, split-horizon/mixed,
class-change, failure, partial, and established-trusted cases.
`InstanceFact.dns` may remain optional for fixture compatibility, but every
derived `TransportRow.dns` is required and defaults to `not-applicable`/`none`,
zero family/class counts, null `observedAt`, and false flags. Extend exhaustive
tier labels/variants in `shieldStatus.ts` now; Task 4.3 later owns presentation
polish rather than repairing a broken union.

#### Task 2.2: Build the Process-Bounded DNS Resolver and Cache Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/security/gather.ts
- packages/praxrr-app/src/lib/server/health/recompute.ts
- packages/praxrr-app/src/lib/server/utils/cache/cache.ts
- docs/plans/security-posture-dns-grading/research-security.md

**Instructions**

Files to Create

- packages/praxrr-app/src/lib/server/security/dnsTransport.ts
- packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts

Files to Modify

- None.

Implement a feature-local factory with injected `resolveDns`, clock, and timers
plus one production singleton shared by HTTP and MCP. Resolve A and AAAA
concurrently with one shared 1,500 ms `AbortSignal`; do not set `nameServer` or
perform CNAME/PTR/connection work. Enforce a process-global four-host semaphore,
in-flight coalescing before slot acquisition, 16 retained unique answers, a
60,000 ms positive and 15,000 ms failed/empty/timeout cache lifetime,
expiry-before-deterministic-LRU, and 256 entries. Aggregate class/family counts,
preserve the original observation time on cache hits, track only
public/non-public class-fingerprint changes for the new positive entry, map all
errors to closed outcomes, and clear timer/in-flight state in `finally`.
Deterministically test cancellation, partial families, caps, coalescing, global
concurrency, expiry boundaries, entry 257 eviction, cache source, transitions,
permission/rejection/empty/malformed outcomes, and absence of live DNS/sleeps.
Expose a narrow test-only production-singleton override/reset seam that returns
a restore closure so HTTP and MCP boundary tests can inject controlled evidence
without live DNS; application code must not use it as a cache bypass.
Restoration must reset cache entries, in-flight promises, transition history,
and semaphore counters, and boundary tests must invoke it in `try/finally`.

#### Task 2.3: Prove Trusted-Proxy Extraction Parity Depends on [1.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/shared/security/trustedProxy.ts
- packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts

Expand regression samples around IPv4, IPv6, mapped IPv6, `fe80::/10`, keyword
expansions, wildcard, invalid tokens, and overly-broad prefixes to prove the
extraction did not alter proxy trust. Keep this test focused on trusted-peer
semantics; address-class behavior belongs in `ip.test.ts`.

#### Task 2.4: Pin Engine Rollup and Version Invariants Depends on [2.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/shared/security/engine.ts
- packages/praxrr-app/src/tests/shared/security/engine.test.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/lib/shared/security/types.ts
- packages/praxrr-app/src/tests/shared/security/engine.test.ts
- packages/praxrr-app/src/tests/routes/securityPosture.test.ts

Bump `SECURITY_POSTURE_ENGINE_VERSION` from `3` to `4`, update input fixtures
for DNS evidence, and pin exact DNS-local/public/mixed/change row and check
outcomes, guarded cap behavior, contribution-sum and recoverable-point
invariants, actionability, order invariance, and unchanged scores for
HTTPS/configured-loopback/Docker cases. Do not mock network or time at the
engine layer; the engine remains pure. Update the existing literal route
assertion from version `3` to `4` in this task so the focused suite stays green;
Task 4.4 later adds DNS route cases without changing that version.

### Phase 3: Async Gathering and Portable Contract

#### Task 3.1: Materialize DNS Evidence Through the Async Service Depends on [1.2, 2.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/security/gather.ts
- packages/praxrr-app/src/lib/server/security/service.ts
- packages/praxrr-app/src/lib/server/security/dnsTransport.ts

**Instructions**

Files to Create

- packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts

Files to Modify

- packages/praxrr-app/src/lib/server/security/gather.ts
- packages/praxrr-app/src/lib/server/security/service.ts
- packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts
- packages/praxrr-app/src/lib/server/mcp/resources.ts
- packages/praxrr-app/src/lib/server/mcp/tools.ts

Make `buildPostureInputs` and `computeShield` async. Select only enabled
sync-capable instances whose stored `url` is HTTP, multi-label, and currently
unknown; never use `external_url`. Normalize with `URL.hostname`, lowercase,
remove one terminal dot, deduplicate deterministically, cap candidates at 32,
and enforce a 2,000 ms report deadline including semaphore queue time. Project
one hostname observation back onto every matching instance and represent
overflow/deadline/failure row-locally. Inject the resolver dependency for tests.
Preserve existing config/DB degrade-never-throw behavior and prove eligibility,
ordering, deduplication, exact `arrType`, cap/deadline, and failure behavior.
Treat the async signature migration as an atomic exception to the 1-3 file
guideline: minimally await `computeShield` in the HTTP route, MCP resource, and
MCP tool here so the branch remains type-correct. Tasks 4.1 and 4.2 retain
ownership of their surface-specific behavior, prose, and tests.

#### Task 3.2: Define the OpenAPI DNS Evidence and Explicit Wire Mapper Depends on [1.2, 2.1]

**READ THESE BEFORE TASK**

- docs/api/v1/schemas/security-posture.yaml
- packages/praxrr-app/src/lib/server/security/responses.ts
- packages/praxrr-app/src/lib/shared/security/types.ts

**Instructions**

Files to Modify

- docs/api/v1/schemas/security-posture.yaml
- packages/praxrr-app/src/lib/server/security/responses.ts

Add closed schemas and mutable runtime DTOs for nested IPv4/IPv6 class counts,
outcome/source, retained count, nullable `observedAt`, and
incomplete/truncated/change flags. Update transport tier enums and required
fields in lockstep. Map every field explicitly; never allow raw addresses,
nameservers, CNAMEs, error text, full URLs, or resolver internals onto the wire.
Validate schema/runtime nullability and naming before generation.

#### Task 3.3: Regenerate and Inspect Portable API Artifacts Depends on [3.2]

**READ THESE BEFORE TASK**

- deno.json
- scripts/bundle-api.ts
- docs/api/v1/openapi.yaml

**Instructions**

Files to Modify

- packages/praxrr-api/openapi.json
- packages/praxrr-api/types.ts
- packages/praxrr-app/src/lib/api/v1.d.ts

Run this exact sequence twice: `deno task generate:api-types`,
`deno task bundle:api`, then
`npx prettier --write packages/praxrr-api/openapi.json` (the bundle copies the
current `v1.d.ts` into package types). Never hand-edit generated files. Inspect
that diffs are limited to DNS evidence and confirm the complete second sequence
produces no new diff.

### Phase 4: HTTP, MCP, and UI Consumers

#### Task 4.1: Await the HTTP Report and Disable Response Caching Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts
- packages/praxrr-app/src/lib/server/security/service.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts

Await `computeShield(event)`, continue mapping with `toSummaryResponse`, add
`Cache-Control: no-store`, and keep unrelated construction failures at 500 while
every DNS degradation remains in a valid 200 body. Update route documentation
that currently promises zero network I/O without implying a probe.

#### Task 4.2: Await and Test Both MCP Security-Posture Surfaces Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/lib/server/mcp/resources.ts
- packages/praxrr-app/src/lib/server/mcp/tools.ts
- packages/praxrr-app/src/tests/mcp/mcp.test.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/lib/server/mcp/resources.ts
- packages/praxrr-app/src/lib/server/mcp/tools.ts
- packages/praxrr-app/src/tests/mcp/mcp.test.ts

Make `praxrr://security-posture` and `get_security_posture` await the same
singleton-backed service and pass through the same allowlisted summary mapper.
Test both success and DNS failure degradation, exact aggregate evidence parity,
and absence of raw addresses, errors, full URLs, and secrets. Do not create an
MCP-specific resolver or cache. Install the resolver override and restore it in
`try/finally` for every controlled case.

#### Task 4.3: Render Accessible DNS Evidence Depends on [3.3]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/routes/security-posture/+page.svelte
- packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/routes/security-posture/+page.svelte
- packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts

Render text-labeled DNS states, compact family/class counts, cache/fresh source,
original observation time, incomplete/truncated/change markers, and visible
“observed from Praxrr”/no-WAN-proof language. Preserve prior content while
refreshing, stable focus, `aria-busy`, native table/card semantics, and one
polite live status; never use `{@html}`. Keep field access aligned with the
generated contract and keep overclaim qualifiers visible without hover.

#### Task 4.4: Prove HTTP DNS Contract and Redaction Depends on [2.4, 3.3, 4.1]

**READ THESE BEFORE TASK**

- packages/praxrr-app/src/tests/routes/securityPosture.test.ts
- packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts
- packages/praxrr-app/src/lib/server/security/dnsTransport.ts

**Instructions**

Files to Modify

- packages/praxrr-app/src/tests/routes/securityPosture.test.ts

Use the test-only resolver override/restore seam to cover HTTP 200 DNS
degradation, `no-store`, exact wire shape, public/mixed/partial/cache/change
states, version `4`, configured `url` rather than `external_url`, and negative
assertions for raw answers, resolver errors, full URLs, secrets, and overclaims.
Restore singleton state in test cleanup so cases cannot leak cache/history into
one another; never use live DNS.

### Phase 5: Delivery Documentation and Release Gate

#### Task 5.1: Record Issue #229 Delivery in the Roadmap Depends on [4.1, 4.2, 4.3, 4.4]

**READ THESE BEFORE TASK**

- ROADMAP.md
- docs/plans/security-posture-dns-grading/feature-spec.md

**Instructions**

Files to Modify

- ROADMAP.md

Update the Ecosystem Security Posture row and notes in the existing table style.
Reference issue #229 and summarize the fixed bounds, report-only semantics,
class-count redaction, conservative grading, and test coverage accurately. Use
no placeholder PR number: the later publish workflow adds the actual PR link
after GitHub allocates it, then reruns roadmap and final validation gates.

#### Task 5.2: Run Full Validation and Boundary Audit Depends on [2.3, 2.4, 3.3, 4.2, 4.3, 4.4, 5.1]

**READ THESE BEFORE TASK**

- CLAUDE.md
- docs/plans/security-posture-dns-grading/feature-spec.md
- deno.json
- scripts/test.ts

**Instructions**

Files to Modify

- None.

Run focused IP, trusted-proxy, DNS resolver, gathering, security-posture, and
MCP tests; then repeat the Task 3.3 sequence—`deno task generate:api-types`,
`deno task bundle:api`, and
`npx prettier --write packages/praxrr-api/openapi.json`—and assert that the
complete second sequence adds no diff. Use `deno fmt --check` and
`deno task lint` rather than a broad write formatter in this validation-only
task, then run `deno task check`, `deno task test`, `deno task build`,
`deno task check:dist-paths`, and `git diff --check`. Search all
`computeShield(` and `buildPostureInputs(` callers for missing awaits. Audit
`dnsTransport` imports to prove no Arr client, sync, job, startup, save,
URL-safety, authorization, or connection-test dependency. Run controlled
resolver cases for local, public, mixed, partial, special, changed, timeout,
failure, empty, truncation, cache, and report/candidate limits through the
injected deterministic test suites and record those passing test names in the
implementation report; no arbitrary live DNS is required. Manually inspect the
rendered desktop and narrow UI for keyboard refresh, retained content while
busy, the polite live announcement, caption/scoped headers, visible freshness
and qualifiers, and no hover-only evidence. Route any discovered fix back
through the task that owns the file, then rerun its focused and downstream
gates. The root lifecycle runs `graphify update .` from the original checkout
after merge, where the existing graph is available, then rechecks repository
status.

## Advice

- Treat `ip.test.ts` and `checks.test.ts` as the executable security policy; do
  not debug concurrency and address classification at the same time.
- Coalesce identical work before acquiring the process-global semaphore, and
  include queue time in the 2-second report budget; otherwise concurrent
  HTTP/MCP calls defeat the advertised bounds.
- Public evidence is monotonic within one observation: one public result stays
  actionable even when another family fails or the retained set truncates. The
  inverse is not true—partial local evidence never becomes a local-only
  assurance.
- The response mapper, not TypeScript privacy, is the disclosure boundary. Never
  spread the internal resolver/cache object or exception data into HTTP or MCP
  output.
- Extract parser mechanics from `trustedProxy.ts`, not trusted-proxy policy. Any
  proxy behavior change is a regression unrelated to issue #229.
- Keep established HTTPS/configured-loopback/Docker grades and the
  `arr_transport` weight unchanged; DNS only enriches the shipped unknown
  multi-label HTTP case.
- Generate API artifacts only after YAML and runtime DTO semantics agree, then
  rerun generation to prove stability before UI and PR review.
- The implementation workflow records issue #229 without inventing a PR number.
  After pre-PR validation creates the draft PR, the root publish workflow adds
  the real link, commits it, and reruns roadmap formatting plus full validation
  before review.
