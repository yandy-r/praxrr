# Security Research: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 can safely add DNS evidence to Shield Check if DNS remains an
observation-only input. The feature must resolve only the normalized hostname
already stored on an enabled Arr instance, through the system resolver, and must
never open a socket to an answer, probe a port, follow an HTTP redirect, accept
a caller-selected name server, or use a favorable result to authorize an Arr
request. Under those constraints it is not a reachability scanner: it asks the
configured resolver for A and AAAA records and classifies a bounded subset of
the returned strings.

The agreed v1 limits are defensible: eight uncached hostnames per report, four
concurrent hostname lookups, one shared 1,000 ms A/AAAA deadline, sixteen
retained unique addresses, a 60-second positive cache, a 10-second failure
cache, a 256-entry process-local LRU, and in-flight coalescing. Security
requires the concurrency limit and in-flight map to be process-wide, not
recreated per request, or parallel UI/MCP requests multiply the advertised
bound. Use the `AbortSignal` supported by
[`Deno.resolveDns`](https://docs.deno.com/api/deno/~/Deno.resolveDns) so
timed-out work is actually cancelled; a `Promise.race` alone leaves resolver
operations running.

Every result is untrusted, time-scoped evidence. Parse addresses to binary form
and classify against the current
[IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)
and
[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
special-purpose registries. Default an unfamiliar or malformed value to `other`,
never `public` or `private`. Any observed public answer keeps the public-risk
grade; a partial/truncated result with no public answer is unknown. DNS failure,
permission denial, budget exhaustion, and cache eviction are closed outcomes
that return a report row, never exceptions that block the report or Arr work.

The response should expose the existing configured hostname plus outcome,
source/freshness, family/class counts, and incomplete/change flags. It must not
expose raw answers, resolver/name-server details, CNAME chains, raw exception
text, credentials, or full URLs. Copy must say “observed from Praxrr's resolver”
and “DNS does not prove WAN reachability”; a scope change is not proof of a DNS
rebinding attack. HTTPS remains the primary remediation because DNS-based
authority can change or be compromised, a limitation also called out by
[RFC 6454 section 8.1](https://www.rfc-editor.org/rfc/rfc6454.html#section-8.1).

## Findings by Severity

### CRITICAL — Hard Stops

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                | Risk                                                                                                                                                                                                         | Required Mitigation                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | A resolver helper that accepts a caller-selected name server, makes TCP/HTTP requests to answers, probes ports, resolves caller-supplied arbitrary query parameters, or follows redirects crosses the issue's DNS-only boundary. `Deno.resolveDns` even has an optional `nameServer` target, so passing user input into that option would create arbitrary outbound UDP/TCP targeting. | The authenticated summary/MCP surface becomes an SSRF or internal network-scanner oracle and may reach metadata, control-plane, or otherwise inaccessible services.                                          | Call `Deno.resolveDns(normalizedStoredHost, 'A'\|'AAAA', { signal })` with the system resolver only. Do not set `nameServer`; do not perform PTR/CNAME enumeration; do not call `fetch`, `Deno.connect`, an Arr client, or any port API. Keep the resolver module referenced only by security-posture gathering and pin that boundary with a code-search/adapter test. |
| C2  | Treating a private/loopback DNS grade as authorization for a later connection, or as a reason to bypass `assertSafeArrUrl`, creates a DNS time-of-check/time-of-use security decision.                                                                                                                                                                                                 | An answer can change between grading and connection, allowing rebinding from an apparently local address to a sensitive or public target. It can also wrongly block legitimate split-horizon Arr operations. | DNS evidence is report-only. It must never permit, deny, rewrite, pin, or route an Arr operation and must never weaken the independent URL-safety guard. No shared “safe host” boolean may flow from Shield Check into clients, sync, setup/test, jobs, or redirects.                                                                                                  |

### WARNING — Must Address

| ID  | Finding                                                                                                                                                                                                                                                | Risk                                                                                                                                                                   | Required Mitigation                                                                                                                                                                                                                                                                                                                                                                                                    | Alternative / Trade-off                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Per-request concurrency limits are bypassed by concurrent summary and MCP calls; `Promise.race` timeouts do not cancel underlying DNS work.                                                                                                            | Resolver load, queued tasks, and memory grow with request concurrency despite each report appearing bounded.                                                           | Use one process-wide semaphore capped at four hostname resolutions, one process-wide in-flight map, and one shared `AbortController` deadline for both A and AAAA calls for a hostname. Delete the in-flight entry in `finally`, clear timers, and convert abort to `timeout`. Deno documents that `ResolveDnsOptions.signal` stops the operation and rejects with `AbortError`.                                       | A small authenticated-route rate limit is additional defense, especially under `AUTH=off`; it does not replace global bounds.                                                                                                                                                   |
| W2  | Treating one successful family as complete when the other timed out/failed, or treating the first sixteen answers as exhaustive, can award false local assurance.                                                                                      | A public IPv6 answer can be hidden by private IPv4, or an omitted answer can be public.                                                                                | Run A and AAAA under the same deadline with `Promise.allSettled`. Only call a local-only result complete when both family attempts completed (an explicit no-data result is complete; an error is not). Any retained public answer wins. Otherwise any family failure, malformed answer, raw/result cap, or truncation produces incomplete/unknown.                                                                    | Returning partial family counts is useful evidence as long as the grade and wording remain unknown.                                                                                                                                                                             |
| W3  | The current string-prefix classifiers are insufficient for this feature: `0.0.0.0` is currently called loopback, `fe80` prefix checks do not represent the whole `fe80::/10`, and “not RFC1918” is not equivalent to public.                           | Unspecified, CGNAT/shared, documentation, multicast, benchmarking, reserved, or malformed values can be mislabeled as safe or globally reachable.                      | Parse canonical IPv4/IPv6 bytes; normalize IPv4-mapped IPv6 before classifying; match loopback, RFC1918/ULA, and link-local explicitly; match all current IANA special-purpose blocks as `other`; classify `public` only as valid unicast outside those blocks (and IPv6 within global-unicast space). Test boundaries immediately below/inside/above every prefix.                                                    | Generate a checked-in table from IANA data, but never fetch registries at report time. Record the registry snapshot date and review it during dependency/security maintenance.                                                                                                  |
| W4  | DNS answers and class sets can legitimately change because of split-horizon routing, multi-homing, resolver location, poisoning, or rebinding. A 60-second cache can hide transitions, and a new process loses comparison history.                     | “Private-only” or “rebinding detected” language creates false assurance or a false accusation. DNS-derived loopback is less stable than a configured loopback literal. | Compare only fresh successful observations, retain the worse class when a public/non-public transition is observed, label it `changedSincePrevious`, and expire that indication with the new positive entry. Never call it an attack and never reuse an expired success as current truth after failure. Say which resolver vantage and observation time the evidence represents.                                       | Security-preferred grading keeps hostname-derived loopback at attention/65 while literal loopback retains 100. If product keeps 100 for a complete DNS loopback result, its UI must visibly qualify it as a current observation and tests must cover loopback-to-public change. |
| W5  | `Deno.resolveDns` returns record values, not authoritative TTLs, so 60/10 seconds are application observation policy rather than DNS TTL fidelity. Incorrect stale reuse or unbounded negative retries can conceal change or amplify resolver failure. | Stale false assurance, delayed recovery, resolver retry storms, or cache memory growth.                                                                                | Document fixed policy TTLs; use monotonic elapsed time for expiry; cap the combined positive/negative LRU at 256; never serve an expired entry as current; cache timeout/error/empty/permission outcomes for 10 seconds; coalesce identical in-flight keys. RFC 2308 and its update [RFC 9520](https://www.rfc-editor.org/info/rfc9520/) support bounded failure caching to avoid aggressive re-querying.              | Stale evidence may be displayed only as clearly subordinate history and must not affect the current grade.                                                                                                                                                                      |
| W6  | A “16 unique answers” cap alone may still scan an arbitrarily long returned array while deduplicating, and Deno has already allocated the returned arrays before application truncation.                                                               | A hostile or pathological answer set can consume more CPU/memory than the evidence contract suggests.                                                                  | Retain at most sixteen unique canonical addresses and stop application parsing at a separately fixed raw-value inspection cap (for example 32 or 64 across both families), marking `truncated/incomplete`. Never sort or serialize the full resolver arrays. The process-global deadline/concurrency limits remain necessary because the API cannot impose a wire-result cap.                                          | A lower raw cap is safer but more often unknown; that is acceptable for a non-blocking posture report.                                                                                                                                                                          |
| W7  | Raw answers, full URLs, resolver exceptions, name-server/search-domain details, and cache keys reveal internal topology and may contain credential-shaped strings. The authenticated GET currently has no explicit cache directive.                    | Sensitive topology or credentials leak through API responses, browser/proxy caches, logs, screenshots, support bundles, or MCP output.                                 | Map errors to a closed enum; return only the existing configured host plus bounded aggregate counts/flags; never return/log raw answers or exception messages. Add `Cache-Control: no-store` to the summary response. Use the same allowlisted mapper for UI and MCP. Add negative tests with URL user-info, API keys in query/path, secret-shaped exceptions, internal IPs, control characters, and oversized values. | Omitting the configured hostname would further reduce screenshot leakage but is a product/API compatibility decision; raw DNS answers are not needed either way.                                                                                                                |
| W8  | Permission denial or one rejected resolver promise can currently bubble through the synchronous service shape and turn the entire summary into HTTP 500. Deno DNS requires `allow-net`.                                                                | Shield Check availability degrades, repeated requests retry noisily, and implementation may be tempted to request broader runtime permission interactively.            | Make gather/service/API/MCP orchestration explicitly async; catch every resolver outcome per hostname; map `NotCapable`/permission denial to a safe `permission-denied` internal reason and public `failure/unknown`; never call `Deno.permissions.request`. Production already compiles with `--allow-net`; restricted deployments must degrade without prompting.                                                    | A startup capability advisory may explain a persistent denial, but it must not block startup or Arr functions.                                                                                                                                                                  |
| W9  | The summary route is normally authenticated, but `AUTH=off` and trusted-local bypass intentionally widen who can trigger it; repeated refreshes can progressively fill/evict the cache across large instance fleets.                                   | A reachable deployment can be used to generate sustained DNS traffic even though each report has a budget.                                                             | Keep the endpoint out of `PUBLIC_PATHS`, accept no hostname/timeout/cache-bypass parameters, disable duplicate UI refreshes, make cache and concurrency global across UI/MCP, and consider the existing bounded in-memory rate limiter keyed by authenticated user or trusted client IP. A force-refresh must not bypass cache or budgets.                                                                             | Strict global work bounds may be sufficient for v1 single-operator deployments; rate limiting is stronger defense for `AUTH=off`.                                                                                                                                               |

### ADVISORY — Best Practices

| ID  | Finding                                                                                               | Benefit                                                                        | Recommendation                                                                                                                                                                                                                      | Defer Justification                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The system resolver may use split-horizon policy and the API does not expose DNSSEC validation state. | Prevents unsupported integrity and global-visibility claims.                   | Say only “observed by Praxrr's resolver”; do not emit `dnssec`, `trusted`, `authoritative`, `globally visible`, or `WAN reachable` claims.                                                                                          | DNSSEC-aware diagnostics would require a different resolver contract and are outside issue #229.                                                               |
| A2  | Process-local cache/history disappears on restart and differs across multiple Praxrr replicas.        | Keeps evidence provenance honest.                                              | Include observation timestamp, cache source, and policy/engine version. Do not persist DNS answers or merge observations across replicas implicitly.                                                                                | Durable history adds sensitive topology retention and is unnecessary for a live advisory.                                                                      |
| A3  | Safe aggregate observability helps tune limits without leaking topology.                              | Detects timeouts, stampedes, and resolver pressure.                            | Record counts/durations by closed outcome (`resolved`, `timeout`, `failure`, `budget-exhausted`), cache hit ratio, truncation count, queue depth, and global in-flight count. Omit hostnames, answers, nameservers, and raw errors. | Metrics can be deferred if bounded unit tests and protected aggregate logs are sufficient initially.                                                           |
| A4  | Radarr, Sonarr, and Lidarr share transport semantics but not general domain semantics.                | Avoids accidental sibling fallback while keeping one auditable grading policy. | Preserve explicit `arrType` only as row identity; resolve the stored `url` for that exact instance; use one exhaustive transport policy without Arr-specific fallback.                                                              | No Arr-specific DNS policy is justified by current requirements.                                                                                               |
| A5  | A third-party DNS/IP package is unnecessary.                                                          | Avoids new supply-chain and permission behavior.                               | Use the Deno built-in resolver behind a tiny injected adapter and a small reviewed binary IP classifier. If a package is proposed, pin it, inspect transitives/permissions, and rerun `deno audit`.                                 | A mature IP parser may reduce correctness risk only if its maintenance and special-range policy are demonstrably better than the bounded local implementation. |

## Authentication and Authorization

- `/api/v1/security-posture/summary` is not in `PUBLIC_PATHS`; the global
  SvelteKit hook requires a session/API key unless the operator deliberately
  selected `AUTH=off` or the trusted-local bypass. Keep resolution behind that
  hook and do not add a public DNS sub-route.
- The MCP route has its own same-origin rebinding defense for browser callers
  and normal authentication. `get_security_posture` must call the same bounded
  async service and share the same cache/semaphore; it must not become a second
  independent resolver budget.
- Praxrr has no per-instance roles. Any authenticated operator can already see
  all transport rows and manage Arr instances. Do not add client-provided
  instance ownership or hostname overrides; select enabled, sync-capable
  instances server-side.
- Authentication does not make unbounded network work safe. Preserve fixed
  budgets for API-key, session, local-bypass, and `AUTH=off` requests alike.

## Data Protection

- Continue gathering only `instanceId`, `instanceName`, explicit `arrType`, and
  connection `url`; never load the Arr API key for DNS grading. Parse the URL
  server-side and discard username, password, port, path, query, and fragment
  before resolver/evidence construction.
- The wire allowlist is: normalized configured host, outcome, source,
  observation time, class/family counts, retained count, and bounded boolean
  flags. Raw IP answers, CNAMEs, DNS packets, resolver configuration, previous
  raw sets, exception text, and cache keys stay off the wire.
- Raw addresses may exist transiently in server memory for parsing/comparison.
  Keep them process-local, bounded by the cache, erase references on
  expiry/eviction, and never persist them. Prefer storing class summaries plus a
  process-local comparison fingerprint if exact-set change detection is kept.
- Add `Cache-Control: no-store`. This reduces accidental browser/proxy retention
  but does not replace TLS or authentication.
- Render every hostname and reason through normal Svelte text interpolation;
  prohibit `{@html}` and untrusted link construction. The instance edit link
  must continue to be built from numeric `instanceId`, not the hostname.

## Dependency Security

| Dependency / Boundary                 | Version / Source                                              | Security Considerations                                                                                                                                      | Risk Level                                                                             | Recommendation / Alternative                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Deno.resolveDns`                     | Deno 2.x built-in (worktree runtime 2.9.1)                    | Requires `allow-net`; uses the system name-server configuration by default; supports abort; returns record strings but no authoritative TTL/security status. | Low if constrained; Critical if custom `nameServer` or follow-up connections are added | Inject a thin A/AAAA-only adapter, pass only `signal`, and map all rejections to closed outcomes.                            |
| System recursive resolver             | Host/container configuration (for example `/etc/resolv.conf`) | Answers may be cached, split-horizon, poisoned, search-domain-expanded, or different across replicas.                                                        | Warning as evidence source                                                             | Treat as one observation vantage, never an authorization oracle. Rely on TLS for endpoint authentication.                    |
| IANA special-purpose registries       | IANA, updated independently                                   | Hardcoded tables can drift; “global” and “globally reachable” are distinct concepts clarified by [RFC 8190](https://www.rfc-editor.org/rfc/rfc8190.html).    | Warning if incomplete                                                                  | Check in explicit prefix tables with boundary tests and a documented registry snapshot date; fail `other` for unknown space. |
| New third-party resolver/IP libraries | None proposed                                                 | Adds supply-chain, transitive, parser, and permission surface.                                                                                               | Advisory                                                                               | Add no dependency for v1; reassess only if binary IPv6 parsing cannot be made small and exhaustively tested.                 |

## Input Validation

1. Accept no DNS-specific request input. The sole query source is
   `new URL(instance.url).hostname` for an enabled stored instance.
2. Resolve only `http:` hostnames. Skip HTTPS and classify IP literals directly.
   Malformed URLs and unsupported schemes are not resolved and remain
   not-evaluable/unknown.
3. Normalize with the URL parser's ASCII hostname, lowercase it, remove one
   terminal root dot, reject empty/root names, and enforce DNS total/label
   length limits before calling the resolver. Cache by this canonical hostname
   only.
4. Distinguish hostnames from IPv4/IPv6 literals with a real parser. Normalize
   unusual IPv4 URL forms and IPv4-mapped IPv6 before range checks; reject zone
   identifiers and malformed resolver values.
5. Parse bytes and apply longest/specific-prefix-safe tables. Never use
   `startsWith`, partial `parseInt`, regex-only IPv6 validation, or
   default-to-public logic.
6. Bound raw values inspected, unique values retained, class counts, strings,
   and timestamps. Saturate counts at the policy cap and mark incomplete rather
   than overflowing or emitting a large payload.
7. Use closed unions for outcome/source/failure/class/tier. Unknown exceptions
   and unknown address forms map to safe generic outcomes, not caller-visible
   strings.

## Infrastructure Security

No new service, port, secret, CORS rule, callback, or runtime permission is
required. Development and production already run with network permission for
existing Arr/Git operations; issue #229 must not broaden it or request
permissions interactively. Use only the configured system resolver and never
embed a public resolver IP, because that would bypass operator split-horizon
policy and disclose internal names externally.

Keep the cache, semaphore, and in-flight registry process-local and
capacity-bounded. Parallel server workers/replicas each have their own bounds,
so deployments with many replicas multiply the DNS load; document this if
horizontal scaling becomes supported. A resolver outage must consume at most the
global concurrency/deadline budget and return a successful posture response with
unknown rows.

The summary endpoint remains read-only and should emit
`Cache-Control: no-store`. Do not add wildcard CORS, background refresh jobs,
scheduled scans, startup lookups, or persistent DNS history. Manual
controlled-resolver testing should prove that no packets other than DNS queries
are sent and that Arr sync/test/save operations are unchanged during resolver
timeout or denial.

## Secure Coding Guidelines

1. Put all DNS I/O in one server-only adapter; keep the shared scoring engine
   pure.
2. Make DNS evidence a typed input to grading, never an authorization boolean.
3. Use process-wide concurrency, capacity, and in-flight coalescing; clean every
   map/timer in `finally`.
4. Abort actual A/AAAA operations at one shared deadline; do not rely on
   `Promise.race` alone.
5. Treat A and AAAA independently, then combine conservatively; one public
   answer wins and one failed family prevents a local-only conclusion.
6. Parse binary addresses and test every range boundary, including `0.0.0.0`,
   `::`, mapped IPv4, full IPv4 loopback, full IPv6 link-local `/10`, ULA,
   CGNAT, documentation, multicast, and reserved.
7. Never log or return raw answers, full URLs, nameservers, search domains, or
   resolver errors.
8. Use monotonic expiry and bounded LRU semantics; an expired success is not
   current truth.
9. Keep resolver results out of Arr clients, `assertSafeArrUrl`, sync, jobs, and
   connection tests.
10. Inject resolver, clock, and limits for deterministic tests; include
    concurrency floods, abort races, cache eviction, malformed answers,
    secret-shaped errors, mixed families, and both class-transition directions.

## Trade-off Recommendations

1. **Adopt the agreed fixed v1 policy**, but define concurrency as process-wide
   and add a raw-value inspection cap. Fixed limits are easier to test and
   harder to turn into a scanner than operator- or caller-tunable limits.
2. **Prefer fail-unknown over availability-derived guesses.** Timeout, resolver
   error, permission denial, one-family failure, empty answer, truncation
   without public evidence, and budget exhaustion should remain score
   65/attention for valid plaintext URLs and must not resurrect `.local` or
   single-label heuristics as verified evidence.
3. **Retain the worst observed public risk.** Public plus any other class, or
   public/non-public change across current observations, should grade action/30
   with a guarded cap. This is conservative without claiming the service is
   reachable.
4. **Reconsider 100 for DNS-derived loopback.** Literal loopback is a stable
   configured fact; a hostname resolving to loopback is time-varying evidence.
   Security prefers attention/65 for the latter. If product consistency wins,
   prominent snapshot wording and loopback-to-public tests are mandatory.
5. **Use application TTLs honestly.** Deno does not expose answer TTLs, so 60/10
   seconds are freshness policy, not authoritative DNS cache compliance. Do not
   add stale-while-revalidate to the score.
6. **Share one evidence contract across API/UI/MCP.** Counts and safe flags are
   sufficient. A separate raw-address debug mode would create disproportionate
   disclosure and should be a separately reviewed future feature.

## Open Questions

1. Will the final scoring decision distinguish configured literal loopback (100)
   from DNS-derived loopback (security recommendation: 65), or explicitly accept
   the latter's time-scoped assurance?
2. What fixed raw-value inspection cap accompanies the sixteen-unique-answer
   retention cap?
3. Will the four-host concurrency limit be implemented globally across summary
   and MCP callers, and is a small authenticated/client-IP route rate limit also
   desired for `AUTH=off` deployments?
4. Does the response retain the existing hostname by default, or can it be
   hidden in non-verbose UI while remaining in the authenticated API for
   compatibility?
5. Should class-change detection compare exact address-set fingerprints or only
   security-relevant class/family summaries? The latter retains less topology
   and is sufficient for grading.
6. Which IANA registry snapshot date will be pinned in classifier
   documentation/tests, and who owns reviewing future registry changes?
