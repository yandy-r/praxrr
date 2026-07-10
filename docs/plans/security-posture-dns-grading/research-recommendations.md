# Recommendations: DNS-Aware Arr Transport Grading

## Executive Summary

Implement issue #229 as a bounded enrichment step for the Arr transport check,
not as a new network diagnostic subsystem. Praxrr should resolve only enabled
Arr instances whose configured URL is plaintext `http:`, whose host is a
multi-label hostname, and whose current non-DNS transport classification is
`unknown`. HTTPS, configured IP literals, single-label/Docker-local names, and
all already-classified hosts keep their existing behavior and do no DNS work.

Use the system resolver through `Deno.resolveDns` for concurrent A and AAAA
queries. Give the entire report 2 seconds, give each hostname one shared
1.5-second A+AAAA timeout, inspect at most 32 candidate hostnames per report,
allow no more than four hostname resolutions globally, and retain at most 16
unique classified addresses per hostname. Coalesce in-flight work and use one
process-local, 256-entry bounded cache with 60-second positive and 15-second
failure lifetimes.

DNS is resolver-local, time-scoped evidence. It must never be described as proof
that an Arr service is reachable from the WAN. The public contract should expose
address-class and family counts plus closed metadata only; raw IP addresses,
resolver details, exception text, credentials, and full URLs must stay out of
API, MCP, UI, and ordinary logs. No TCP/HTTP probes, new dependency,
persistence, migration, or background job is justified.

The grading policy should be deterministic: DNS-observed loopback, private, or
link-local plaintext scores 65; public, mixed, or security-relevant class-change
evidence scores 30; and failure, incomplete, empty, budget-limited, special, or
unknown evidence scores 65. Existing HTTPS, explicitly configured loopback, and
recognized Docker-local results retain 100. Keep classification and scoring
pure, put asynchronous DNS orchestration behind a server-only injected seam, and
update OpenAPI, generated types, runtime mapping, UI, and both MCP surfaces as
one contract change.

## Implementation Recommendations

1. **Gate candidates through the existing transport classifier.** Parse the
   stored connection `url` for each enabled, sync-capable instance. Resolve only
   current `unknown` multi-label HTTP hostnames. Normalize with `URL.hostname`,
   lowercase it, and remove one terminal dot. Do not resolve `external_url`,
   HTTPS, IP literals, single-label/Docker aliases, malformed URLs, or
   already-known local suffixes. Preserve the exact `arrType` on every row, but
   apply one app-independent transport policy with no sibling fallback.
2. **Extract a pure binary IP classifier.** Reuse the IPv4/IPv6 parsing and CIDR
   primitives currently embedded in `trustedProxy.ts`. Classify loopback, RFC
   1918/IPv6 ULA, link-local, globally reachable public unicast, and IANA
   special-purpose space with prefix math. Normalize IPv4-mapped IPv6 before
   classification. Malformed, unspecified, CGNAT, documentation, multicast,
   benchmarking, and reserved values must fail to `special`/`unknown`, never
   default to public or local.
3. **Add one server-only DNS component.** A feature-local `dnsTransport.ts`
   should own the native resolver adapter, one shared A+AAAA abort deadline,
   process-global four-slot concurrency limiter, in-flight map, bounded cache,
   and class-change comparison. Inject the resolver, clock, and timer functions
   so automated tests never use live DNS. Always clear timers and in-flight
   entries in `finally`, and convert every rejection into typed evidence.
4. **Enforce the fixed policy at explicit boundaries.** The report deadline is
   2,000 ms including queueing; the per-host A+AAAA timeout is one shared 1,500
   ms budget; the report considers at most 32 candidates; no more than four
   hostnames resolve across all concurrent HTTP and MCP callers; no host retains
   more than 16 unique classified answers; positive/failure cache lifetimes are
   60,000/15,000 ms; and capacity is 256 entries. Expire entries before
   deterministic LRU eviction. Cache hits preserve the original observation
   time. A cap hit marks evidence incomplete.
5. **Aggregate conservatively before scoring.** One public answer is enough for
   score 30 even if the other family failed or the retained set was truncated.
   Without a public answer, a failed family, truncation, malformed answer,
   timeout, empty result, report deadline, or candidate overflow yields
   unknown/65 rather than a local conclusion. Complete local-only DNS
   evidence—including DNS-derived loopback—scores 65. A public/non-public class
   transition between consecutive successful observations sets a changed flag
   and scores 30 for the current positive-cache lifetime. Compare class
   fingerprints, not exact addresses, so ordinary rotation within the same class
   is not treated as a security change.
6. **Keep I/O outside the engine.** Make posture gathering and `computeShield`
   asynchronous, attach a bounded DNS observation to each eligible
   `InstanceFact`, and then invoke the existing pure engine. The HTTP summary
   route, MCP resource, and MCP tool must all await the same service and share
   the same singleton resolver/cache. No Arr client, connection test, sync
   processor, job, startup path, or authorization decision may import or depend
   on DNS grading.
7. **Use one redacted response mapper.** Emit only the already-exposed
   configured hostname, outcome, evidence source, observation timestamp,
   IPv4/IPv6 class counts, retained count, and boolean `incomplete`,
   `truncated`, and `addressClassesChanged` flags. Do not expose raw answers,
   prior address sets, resolver/name-server details, CNAMEs, error messages, URL
   user info/path/query, or API keys. Add `Cache-Control: no-store` to the
   summary response and reuse the same allowlisted mapping for MCP.
8. **Present evidence, not exposure claims.** Rename the relevant UI concept
   from “Exposure” to “DNS evidence” or “Target evidence.” Use labels such as
   “Private-only DNS,” “Public-address DNS,” “Mixed address scopes,” “Address
   scope changed,” and “DNS unavailable.” Public/mixed/changed rows must say
   “Observed from Praxrr” and “DNS alone does not prove WAN reachability.” Keep
   the existing instance settings action, recommend HTTPS/TLS, preserve the
   prior report while refreshing, and expose a single accessible busy/completion
   status rather than per-row alerts.
9. **Treat this as a versioned contract change.** Update the source OpenAPI
   schema first, regenerate API artifacts, update shared/runtime response types
   and the explicit response mapper, then update the Svelte page and MCP
   outputs. Bump the Security Posture engine/report version. A change is not
   complete if any one of OpenAPI, generated types, runtime HTTP, UI, or MCP
   lacks the same closed DNS evidence semantics.

Acceptance criteria should be proven as follows:

| Issue #229 criterion                                                                                      | Required implementation and test evidence                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lookups are bounded by timeout, result count, and cache policy.                                           | Deterministic tests pin the 2-second report deadline, shared 1.5-second A+AAAA timeout, 32 candidates, global concurrency four, 16 retained results, 60/15-second lifetimes, 256-entry eviction, hostname deduplication, and in-flight coalescing.     |
| Private-only, public-only, mixed, failed, and rebinding-like results have documented conservative grades. | Pure table tests pin DNS local classes at 65, public/mixed/changed at 30, failure/incomplete/special/unknown at 65, and existing HTTPS/configured-loopback/Docker-local at 100. Test both local-to-public and public-to-local class transitions.       |
| No lookup failure blocks the report or any Arr operation.                                                 | Resolver timeout, rejection, permission denial, empty answer, and report-budget tests return a successful degraded report; import-boundary checks prove DNS is absent from Arr clients, sync, jobs, startup, save, and connection-test paths.          |
| Findings explain observed classes without claiming WAN exposure.                                          | HTTP/UI/MCP contract tests assert class-count evidence and hedged wording, and negatively assert absence of raw IPs, full URLs, credentials, resolver errors, “publicly reachable,” “exposed,” and “attack detected.”                                  |
| Tests cover IPv4, IPv6, split-horizon, mixed, timeout, and resolver failure.                              | Binary classifier boundary tables cover both families and special ranges; injected resolver tests cover private/public dual stack, mixed/split-horizon-like answers, partial families, truncation, transitions, timeout, and failure without live DNS. |

## Improvement Ideas

- Add aggregate, privacy-safe diagnostics for cache hit rate, closed resolver
  outcome counts, queue depth, truncation count, and in-flight count. Do not
  attach hostnames, raw addresses, or errors.
- Pin an IANA special-purpose registry snapshot date beside the checked-in
  classification table and add a maintenance checklist for reviewing changes.
  Never fetch registry data during report generation.
- After v1 usage data exists, evaluate a small authenticated/client-IP rate
  limit for `AUTH=off` deployments. It would supplement, not replace, the fixed
  global work bounds.
- Consider a responsive stacked-card representation for narrow screens and a
  “Needs review” filter for large deployments, without changing the API or
  grading policy.
- If class instability becomes an operational support problem, consider bounded
  class-level history in a separately designed feature. Do not persist raw DNS
  answers or add history to issue #229.

## Risk Assessment

| Risk                                                              | Impact                                                                | Required control                                                                                                                                                   | Residual risk                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| DNS work becomes an implicit scanner or load source.              | Network and resolver pressure; scope violation.                       | Resolve stored eligible hostnames only through the system resolver; enforce the report, host, candidate, concurrency, result, cache, and capacity bounds globally. | Multiple Praxrr processes each have independent bounds; document this if horizontal scaling is supported.        |
| Partial A/AAAA results produce false local assurance.             | A hidden public family is graded too favorably.                       | Query both families under one timeout; public wins, while incomplete evidence without public remains unknown/65.                                                   | The runtime allocates returned arrays before Praxrr retains 16; processing and response size are still bounded.  |
| Incorrect IP classification labels special space public or local. | Misleading grade and recommendation.                                  | Binary parsing, mapped-IPv6 normalization, explicit IANA exclusions, and prefix-boundary tests; fail closed to special/unknown.                                    | Special-use registries evolve and require maintenance.                                                           |
| Resolver-local evidence is presented as global reachability.      | False alarms or false assurance in split-horizon deployments.         | “Observed from Praxrr” language, observation time/source, class-count-only evidence, and an explicit no-WAN-proof qualifier.                                       | Another resolver or a later connection may observe different answers; this is inherent to DNS evidence.          |
| Rebinding-like changes are overstated.                            | Legitimate rotation or split horizon is called an attack.             | Compare security-relevant class fingerprints only and label the result “Address scope changed.”                                                                    | A class transition still cannot reveal intent or cause.                                                          |
| Sensitive topology or credentials leak.                           | Internal IPs, nameservers, URLs, or secrets appear in responses/logs. | Allowlisted response mapper, class counts only, no-store response, Svelte text interpolation, and negative redaction tests across HTTP and MCP.                    | The configured hostname remains visible as it is today in the authenticated report.                              |
| DNS failure propagates through async conversion.                  | HTTP 500, broken MCP reads, or blocked Arr behavior.                  | Typed never-throwing per-host outcomes, awaited callers, injected failure tests, and strict module ownership.                                                      | Unrelated failures may still prevent report construction and should remain distinguishable from DNS degradation. |
| Contract surfaces drift.                                          | API validates one shape while UI/MCP render another.                  | Contract-first schema change, generated types, explicit mapper, shared fixtures, and end-to-end HTTP/MCP/UI tests in one change.                                   | Future consumers must continue to use the shared mapper rather than internal resolver objects.                   |

## Alternative Approaches

1. **Resolve every hostname, including HTTPS, single-label, and Docker-local
   names.** Rejected for issue #229. It spends budget where grading is already
   known, changes shipped 100-grade semantics, increases platform-specific
   resolver behavior, and exceeds the requested unknown-hostname gap.
2. **Use DNS-over-HTTPS or an explicit public resolver.** Rejected. It bypasses
   the deployment's system/split-horizon view, discloses internal names
   externally, adds dependency and telemetry concerns, and still cannot prove
   reachability.
3. **Probe TCP, HTTP, TLS, or WAN reachability.** Rejected as explicitly out of
   scope. It would turn advisory evidence gathering into active scanning and
   introduce materially different permissions, failure modes, and security
   review.
4. **Persist DNS observations in SQLite.** Rejected. A database migration and
   durable topology history are unnecessary for a live non-blocking report,
   increase sensitive-data retention, and complicate expiry and multi-process
   semantics.
5. **Return raw IP addresses or add a verbose debug switch.** Rejected for the
   routine report. Address class/family counts fully support grading and
   acceptance criteria with substantially less topology disclosure.
6. **Put DNS resolution inside the pure engine or Arr client.** Rejected. It
   destroys deterministic tests and risks coupling posture availability to
   connection, sync, and job behavior. The correct boundary is async server
   gathering followed by pure evaluation.
7. **Add a resolver, IP, cache, or concurrency package.** Rejected for v1. Deno
   and the repository's existing parsing primitives cover the required behavior
   with less supply-chain and permission surface.

## Task Breakdown Preview

The implementation plan should preserve these dependencies and validation gates:

1. **Phase 1 — Contract and pure policy foundation.** Finalize closed DNS types
   and the wire evidence shape; extract the shared IP parser/CIDR primitives;
   implement the pure address classifier and grading precedence; add boundary
   and matrix tests. This phase is the dependency for every later resolver and
   presentation task.
2. **Phase 2 — Server resolver/cache.** Implement the injected A+AAAA adapter,
   cancellation, global limiter, in-flight coalescing, cache/expiry/eviction,
   class-count aggregation, class-transition tracking, and focused deterministic
   tests. This depends on Phase 1 types/classifier but can proceed independently
   of UI work once the wire contract is fixed.
3. **Phase 3 — Async gathering and service integration.** Add candidate
   selection and the 32-candidate, 2-second report budget; materialize
   observations; make `buildPostureInputs`/`computeShield` async; update HTTP
   and both MCP callers; prove failure-to-report degradation and forbidden
   import boundaries. This depends on Phases 1 and 2.
4. **Phase 4 — Portable contract surfaces.** Update OpenAPI, regenerate API
   types/artifacts, update the explicit response mapper, add no-store behavior,
   and land HTTP/MCP contract tests. Schema source changes precede generated
   files; this phase depends on the finalized Phase 1 model and Phase 3
   orchestration.
5. **Phase 5 — UI/UX.** Render DNS evidence, class/family counts, source/time,
   incomplete/change states, hedged copy, accessible refresh behavior, and
   responsive layout. Add copy/redaction/accessibility tests. This depends on
   the Phase 4 public contract, not on resolver internals.
6. **Phase 6 — Documentation and validation.** Bump the engine/report version,
   update `ROADMAP.md` and relevant API/security documentation, run
   generation/contract checks, focused classifier/resolver tests,
   `deno task test security-posture`, MCP tests, `deno task check`, and manual
   controlled-resolver checks for local, public, mixed, changing, and failure
   cases. This depends on all implementation phases and is the release gate.

Parallel planning opportunity: after Phase 1 freezes the shared types, Phase 2
resolver work and the Phase 4 schema-source draft can proceed in parallel; UI
implementation waits for the generated public contract. Pure policy tests should
land before async integration so scoring defects are isolated from resolver
behavior.

## Key Decisions Needed

The following are the authoritative v1 decisions and should not be reopened
during planning:

- Candidate scope is current unknown multi-label HTTP hostnames only.
- Resolution uses Deno's system resolver, A and AAAA together, with no alternate
  nameserver.
- Bounds are 2 seconds/report, 1.5 seconds/shared host lookup, 32
  candidates/report, global concurrency four, 16 retained addresses/host,
  60-second positive cache, 15-second failure cache, and 256 entries.
- Public evidence is class-count-only; raw addresses and resolver errors never
  cross the server boundary.
- There are no probes, new dependencies, database changes, background refreshes,
  or user-tunable limits.
- DNS loopback/private/link-local score 65; public/mixed/changed score 30;
  failure/incomplete/special/unknown score 65;
  HTTPS/configured-loopback/Docker-local retain 100.
- The engine remains pure, DNS gathering is asynchronous and server-only, and
  all three service consumers await the same singleton-backed orchestration.
- OpenAPI, generated types, runtime mapper, HTTP, UI, and MCP ship in lockstep
  with an engine/report version bump.

Implementation-level decisions should use these recommendations unless code
constraints prove a better equivalent: deterministic LRU eviction, per-row
nested IPv4/IPv6 class counts, a class-set fingerprint for change detection, and
a changed warning lasting for the new 60-second positive-cache entry.

## Open Questions

1. Which reviewed IANA IPv4/IPv6 special-purpose registry snapshot date should
   be recorded with the classifier table and tests?
2. What existing public enum and naming conventions should the new closed
   outcome/source fields mirror so the OpenAPI change is additive and generated
   types remain idiomatic?
3. Can route and MCP tests inject the service dependency through existing seams,
   or is a narrow handler factory required to prove timeout/failure behavior
   without live DNS?
4. Which exact existing UI component should own the accessible refresh status
   and prior-report preservation so DNS work does not introduce a second refresh
   state machine?
5. Does the repository already have a contract-validation task beyond API type
   generation that must be added to the final validation sequence? The
   implementation plan should discover and name the exact command rather than
   invent a new gate.
