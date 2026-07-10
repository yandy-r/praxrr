# Business Logic Research: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 should improve one deliberately conservative gap in Shield Check: a
plaintext Arr URL with a hostname currently cannot be distinguished from a
private-only or public destination. DNS can reduce that uncertainty, but it
cannot prove which route an Arr request used, whether a port is reachable, or
whether a service is exposed to the WAN. The product therefore needs a bounded
evidence-gathering step, not a reachability scanner.

The recommended business policy is:

- Resolve only hostname-based `http` Arr targets. `https` is already graded on
  encrypted transport and IP literals already contain the fact needed for
  classification.
- Bound each report to 8 uncached hostnames, 4 concurrent hostnames, a shared
  1,000 ms deadline per hostname, and at most 16 unique A/AAAA answers per
  hostname. A report therefore completes its DNS work in at most two 1-second
  waves, plus local processing.
- Cache positive results for 60 seconds and failures for 10 seconds in a
  256-entry process-local LRU. Coalesce concurrent lookups for the same
  normalized hostname.
- Classify every retained address as loopback, private, link-local, public, or
  other/special. Normalize IPv4-mapped IPv6 before classification.
- Preserve the shipped transport score ladder: encrypted or loopback plaintext
  `100`; private, link-local, unknown, or failed plaintext `65`; any observed
  public plaintext `30`, `action`, critical, with a `guarded` band cap. Mixed
  and rebinding-like evidence inherits the worst observed class.
- Expose only safe evidence: hostname, lookup outcome, class counts,
  truncation/cache/change flags, and hedged explanatory text. Do not return raw
  resolved IPs, resolver error strings, credentials, full URLs, or a claim of
  verified public reachability.
- Keep the feature read-only and non-blocking. DNS failure changes only the
  posture evidence and grade; it never prevents Arr reads, writes, sync,
  connection testing, startup, or report delivery.

This preserves explicit `arr_type` (`radarr`, `sonarr`, or `lidarr`) in each row
for identity and display, while applying exactly the same transport semantics to
every supported Arr app.

## User Stories

1. As an operator using `http://radarr.home.example`, I want Shield Check to
   tell me whether Praxrr's resolver currently sees only local addresses or any
   public address, so that an unknown hostname is more actionable.
2. As an operator using split-horizon DNS, I want the result to describe what
   this Praxrr process observed without declaring the Arr service publicly
   reachable.
3. As an operator with dual-stack DNS, I want A and AAAA answers evaluated
   together so a public IPv6 answer cannot be hidden by a private IPv4 answer.
4. As an operator with a slow or unavailable resolver, I want the posture report
   to complete with an unknown/attention result and a retryable explanation, not
   fail or delay Arr work indefinitely.
5. As an operator with many Arr instances, I want DNS work capped and cached so
   repeatedly opening the posture page cannot turn Praxrr into a DNS load
   generator.
6. As a security-conscious operator, I want recommendations to identify
   plaintext transport as the remediable risk without overstating DNS as proof
   of WAN exposure or malicious rebinding.
7. As an API consumer, I want stable, structured evidence that contains no API
   key, URL user-info, resolver diagnostics, or internal address values.
8. As a Radarr, Sonarr, or Lidarr user, I want identical transport treatment for
   the same URL/DNS facts; the app type must remain visible but must never
   select a sibling-app fallback or a different grade.

## Business Rules

### 1. Scope and evaluation order

For every enabled, sync-capable Arr instance, evaluate the stored connection
`url`; never use `external_url`.

1. Parse the URL. An unparseable URL remains `score: null`, `status: na`; DNS is
   not attempted.
2. If the scheme is `https`, grade `encrypted / 100 / pass`; DNS is `not-needed`
   because address scope cannot weaken the observed encrypted scheme.
3. If the `http` host is an IP literal, classify it directly; DNS is `literal`
   and no lookup occurs.
4. Otherwise normalize the hostname (lowercase, remove a trailing root dot, use
   the URL parser's ASCII hostname) and resolve A and AAAA concurrently under
   one shared deadline.
5. DNS evidence overrides hostname heuristics. A single-label name, `.local`,
   `.lan`, `.home`, or `.internal` suffix is context, not proof of locality. If
   its lookup fails, grade it unknown rather than awarding the current
   `docker-alias / 100` assumption.
6. A cached positive or negative result is equivalent to a fresh outcome for
   grading, but the response must identify `cache: hit` or `negative-hit` so the
   evidence remains honest.

DNS grading affects only plaintext `http`. It never changes a connection URL,
follows an HTTP redirect, opens a TCP socket, sends a request to the Arr host,
validates a certificate, or tests WAN reachability.

### 2. Bounded resolution policy

These are fixed v1 product limits, not operator-tunable settings:

| Limit                    | v1 policy                                                         | Business purpose                                                                   |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Uncached hostname budget | 8 distinct normalized hostnames per report                        | Bounds resolver work across a fleet. Fresh cache hits do not consume the budget.   |
| Concurrency              | 4 hostnames                                                       | Avoids a burst across every configured instance.                                   |
| Per-host deadline        | 1,000 ms shared by A and AAAA                                     | A slow family cannot extend the deadline or block the other family indefinitely.   |
| Retained answers         | 16 unique addresses total across A and AAAA                       | Bounds evidence size and classification work. Duplicate answers are removed first. |
| Positive TTL             | 60 seconds                                                        | Limits repeated lookups while allowing address changes to surface promptly.        |
| Negative TTL             | 10 seconds for timeout, resolver error, NXDOMAIN, or empty answer | Prevents retry storms without making a transient outage look durable.              |
| Cache capacity           | 256 normalized hostnames, process-local LRU                       | Bounds memory; eviction is harmless because the next report can resolve again.     |
| In-flight behavior       | One shared promise per normalized hostname                        | Concurrent report/MCP requests do not duplicate resolver work.                     |

Instances sharing a hostname share one lookup but retain separate rows, instance
IDs, names, and `arr_type` values. Cached hostnames are evaluated first;
uncached work is selected in ascending instance ID/normalized-host order so
budget behavior is deterministic. Hostnames beyond the uncached budget are
`budget-exhausted`, graded unknown, and become eligible on a later report after
earlier names are cached.

A resolver may return more than 16 values before Praxrr can truncate them.
`truncated: true` means the answer set is incomplete. Any public address among
the retained answers is still sufficient for the public-risk grade; an
apparently local-only truncated result is unknown because omitted answers might
be public.

### 3. Address classification

Classification is by parsed binary address, never string prefix alone.

| Class        | IPv4                                                                                            | IPv6                                                                                                                | Meaning for this feature                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `loopback`   | `127.0.0.0/8`                                                                                   | `::1/128`                                                                                                           | Same-host scope.                                                                                    |
| `private`    | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`                                                 | `fc00::/7` (ULA)                                                                                                    | Private-address scope; not proof that the path is trusted.                                          |
| `link-local` | `169.254.0.0/16`                                                                                | `fe80::/10`                                                                                                         | Link-only scope, kept distinct in evidence; plaintext still receives the private/attention grade.   |
| `public`     | Valid globally routable unicast outside IANA special-purpose space                              | Global unicast `2000::/3` outside special-purpose ranges                                                            | DNS evidence that plaintext may leave a trusted local path; not proof the service is WAN reachable. |
| `other`      | Unspecified, broadcast, CGNAT/shared, benchmarking, documentation, multicast, or reserved space | Unspecified, IPv4-compatible/mapped before normalization, documentation, multicast, discard-only, or reserved space | Neither local assurance nor public proof; grades unknown unless another retained answer is public.  |

IPv4-mapped IPv6 (for example `::ffff:192.168.1.10`) is normalized to IPv4
before applying the table. Malformed resolver values are discarded and mark the
outcome incomplete. `0.0.0.0`, `::`, multicast, documentation ranges, and
reserved addresses must not be labeled loopback or public.

### 4. Conservative grading matrix

This matrix is authoritative. The effective result uses the worst row that
applies.

| Scheme / evidence                    | Required condition                                                                                                                                              | Effective tier | Score / status   | Critical / cap   | Required explanation and recommendation                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS                                | Parsed URL has `https:`                                                                                                                                         | `encrypted`    | `100 / pass`     | `false / none`   | Transport to the configured endpoint is encrypted. DNS was not needed; make no exposure claim.                                                                       |
| HTTP loopback-only                   | Complete literal/fresh/cached result; every address is loopback                                                                                                 | `loopback`     | `100 / pass`     | `false / none`   | Praxrr observed only loopback scope. Say this is current resolver evidence, not a reachability test.                                                                 |
| HTTP local-only                      | Complete result; no public/other answers; at least one private or link-local answer (loopback may coexist)                                                      | `private`      | `65 / attention` | `false / none`   | API key crosses plaintext on a local/private-address path. Recommend HTTPS or a TLS front end. Include class counts.                                                 |
| HTTP public-only                     | Complete result; one or more public answers and no local/other answers                                                                                          | `public`       | `30 / action`    | `true / guarded` | Public address evidence was observed. State explicitly that DNS does not verify WAN reachability. Recommend HTTPS/TLS.                                               |
| HTTP mixed                           | One result contains any public answer plus loopback/private/link-local/other, or a complete current result conflicts with a recent successful class observation | `mixed`        | `30 / action`    | `true / guarded` | Mixed/changing address scopes may reflect multi-homing, split-horizon DNS, or rebinding-like change. Do not allege an attack. Recommend HTTPS/TLS and reviewing DNS. |
| HTTP incomplete with public observed | Retained answers include public and the result is truncated or contains malformed values                                                                        | `mixed`        | `30 / action`    | `true / guarded` | A public answer is enough to retain the public-risk grade even though evidence is incomplete.                                                                        |
| HTTP incomplete without public       | Truncated/malformed result contains only loopback/private/link-local/other                                                                                      | `unknown`      | `65 / attention` | `false / none`   | Omitted answers prevent a local-only conclusion. Recommend HTTPS/TLS; retry later.                                                                                   |
| HTTP other-only                      | Complete result contains only `other` addresses                                                                                                                 | `unknown`      | `65 / attention` | `false / none`   | Address scope is not safely classifiable as local or globally routable.                                                                                              |
| HTTP timeout/failure/empty           | Timeout, resolver error, NXDOMAIN, or no A/AAAA answers                                                                                                         | `unknown`      | `65 / attention` | `false / none`   | DNS evidence unavailable; preserve report success. Recommend HTTPS/TLS and retrying/checking DNS, without implying the Arr is down.                                  |
| HTTP budget-exhausted                | Report lookup budget reached and no fresh cache entry exists                                                                                                    | `unknown`      | `65 / attention` | `false / none`   | Lookup was intentionally skipped by policy; retrying later may populate the cache.                                                                                   |
| Malformed URL                        | URL cannot be parsed                                                                                                                                            | `unknown`      | `null / na`      | `false / none`   | Preserve existing not-evaluable behavior; no DNS call.                                                                                                               |

The Arr transport check remains the rounded mean of non-null row scores. The
presence of any row whose effective tier is `public` or `mixed` makes the check
`action`, critical, and caps the overall band at `guarded`, matching the shipped
public-IP-literal behavior. Unknown/failure rows participate at `65`, so DNS
failure never rewards the deployment and never turns the whole check into
unavailable when the URL itself is valid.

### 5. Mixed, split-horizon, and rebinding-like evidence

- A single A/AAAA observation containing public and non-public classes is
  `mixed` immediately. It may be valid multi-homing or split-horizon leakage;
  wording must say "mixed address scopes observed".
- Split-horizon DNS that returns only private answers to Praxrr is `local-only`,
  but the UI must say "this Praxrr resolver currently observed" rather than
  "private everywhere".
- On a positive-cache refresh, compare the new normalized answer set and class
  set with the previous successful entry before replacement. A class change sets
  `changedSincePrevious: true` on the new 60-second entry.
- If either the previous or current successful observation contains public while
  the other contains a non-public class, grade `mixed / 30 / action` for that
  entry's 60-second lifetime. This covers local-to-public and public-to-local
  rebinding-like transitions conservatively.
- A change wholly within local classes remains `65 / attention`; a change wholly
  within public remains `30 / action`. The change flag is still shown, but it
  does not invent a new severity.
- Failure after a previous success does not silently reuse expired scope as
  current truth. It returns `unknown / 65` and may state that the prior cached
  observation expired. No stale-while-revalidate assurance is allowed.

### 6. Safe evidence contract

Each transport row should retain `instanceId`, `instanceName`, explicit
`arrType`, `scheme`, and the already-exposed host, then add structured DNS
evidence equivalent to:

- outcome: `not-needed`, `literal`, `resolved`, `timeout`, `failure`, `empty`,
  or `budget-exhausted`;
- source: `fresh`, `cache-hit`, `negative-cache-hit`, or `none`;
- counts for `loopback`, `private`, `linkLocal`, `public`, and `other`;
- retained unique result count;
- `truncated`, `incomplete`, and `changedSincePrevious` booleans.

The wire response and UI must not expose raw resolved addresses, DNS packet
data, CNAME chains, search domains, nameserver addresses, exception/error text,
URL paths/query/user-info, or API keys. Operator copy may repeat the
already-public report hostname and aggregate class counts only. Logs should use
the same aggregate evidence and a fixed failure reason enum, never raw resolver
exceptions.

### 7. Recommendation rules

- Every `65 / attention` or `30 / action` row retains the concrete instance edit
  link.
- Primary remediation is always to configure an `https` Arr URL or put TLS in
  front of the Arr service.
- Mixed/rebinding-like evidence adds "review A/AAAA records and
  resolver/search-domain configuration" as diagnosis, not as an accusation or a
  prerequisite to using Praxrr.
- Timeout/failure/budget messages may suggest retrying the posture report or
  checking DNS, but must not claim that the Arr service is unavailable; existing
  Arr operations may already have a working path.
- No recommendation may tell the operator to expose a port, disable certificate
  verification, remove IPv6 merely to silence the grade, or replace a private
  address with a public one.

## Workflows and Error Recovery

### On-demand posture report

1. The API gathers enabled Arr instance facts without credentials.
2. Literal and HTTPS rows are materialized immediately.
3. Fresh positive/negative cache entries are applied and duplicate hostnames are
   coalesced.
4. At most eight remaining hostnames are resolved in two concurrency-limited
   waves.
5. Every resolver promise is converted to a typed outcome; none is allowed to
   reject the report.
6. The fully materialized facts enter the pure scoring engine, which builds
   deterministic rows and the aggregate `arr_transport` check.
7. The API returns HTTP 200 with per-row degraded evidence. HTTP 500 remains
   reserved for an unrelated internal failure that prevents report construction,
   not DNS failure.

### Retry and progressive cache fill

A manual refresh inside the positive or negative TTL is cheap and reports cached
evidence honestly. After 10 seconds, a failed hostname becomes eligible for
retry. In fleets with more than eight uncached hostnames, the first report marks
the overflow `budget-exhausted`; a later report can resolve them because earlier
names are now positive/negative cache hits and do not consume the uncached
budget.

### Resolver outage

Timeout, NXDOMAIN, permission failure, resolver error, and empty answers are
separate internal reasons but share the safe business outcome
`unknown / 65 / attention`. They are negatively cached for 10 seconds. The
report, posture page, MCP read, and all Arr operations continue. Recovery is
automatic on a later report; there is no persistent error state to clear.

### Address change

When a positive entry expires, the next report performs a fresh lookup. The
previous successful entry is used only for change comparison, not as current
evidence. Public/non-public transitions produce the temporary mixed grade
described above. A subsequent stable refresh clears the change flag according to
the new observation, with no database migration or operator acknowledgement
required.

## Domain Model and State Transitions

### Core domain facts

- **Instance transport fact:** instance ID, name, explicit Arr type, parsed
  scheme, safe hostname.
- **DNS observation:** normalized hostname, typed outcome, aggregate
  address-class counts, completeness, cache source, and change flag. It contains
  no Arr type because DNS semantics are app-independent.
- **Address class:** `loopback | private | link-local | public | other`.
- **Effective transport tier:**
  `encrypted | loopback | private | public | mixed | unknown`.
- **Transport grade:** score/status/critical/cap plus a concrete fix.
- **Cache entry:** positive observation or negative reason, expiry, last
  successful comparison state, and LRU metadata; process-local and
  non-authoritative.

The existing `docker-alias` value should no longer be treated as an
assurance-producing address class. It can remain a hostname-kind/display label
for compatibility, but a DNS-backed effective grade must be derived from the
observation matrix. `link-local` stays distinct in evidence while sharing the
private plaintext grade.

### State transitions

```text
URL parse failure -> not evaluable (no DNS)
HTTPS             -> encrypted (no DNS)
HTTP IP literal   -> literal classification -> grade
HTTP hostname     -> fresh cache? -> cached observation -> grade
                  -> negative cache? -> cached unknown -> grade
                  -> report budget full? -> budget-exhausted -> unknown
                  -> in-flight same host? -> join lookup
                  -> resolve A + AAAA under deadline
                       -> complete success -> positive cache -> compare prior -> grade
                       -> partial/truncated -> positive incomplete cache -> worst-observed grade
                       -> timeout/error/empty -> negative cache -> unknown
positive expiry   -> fresh resolve; expired value used only for change comparison
negative expiry   -> fresh resolve
LRU eviction      -> absent; next report may resolve again
```

No state transition writes to the Arr instance, blocks a job, or becomes an
authorization decision.

## Existing Codebase Integration

- `packages/praxrr-app/src/lib/shared/security/types.ts` currently models
  `InstanceFact` with explicit `arrType` and URL, and `TransportRow` with
  host-only output. Extend these contracts with fully materialized DNS
  observations/evidence; keep the shared engine free of I/O and bump
  `SECURITY_POSTURE_ENGINE_VERSION` because the report surface and grading
  inputs change.
- `packages/praxrr-app/src/lib/shared/security/checks.ts` owns `classifyHost`,
  `gradeUrl`, `buildTransportRows`, the `65/30` score constants, mean
  aggregation, and the public-row band cap. Replace heuristic hostname assurance
  with the matrix above while retaining literal classification, score
  arithmetic, actionability, and app-independent behavior.
- `packages/praxrr-app/src/lib/server/security/gather.ts` is the only config/DB
  gatherer and currently promises zero network I/O and degrade-never-throw. It
  should remain the fact boundary, but delegate bounded hostname resolution to a
  dedicated server DNS utility/cache and return all outcomes as data. This makes
  gathering asynchronous; failures must be caught per hostname.
- `packages/praxrr-app/src/lib/server/security/service.ts`, the summary route,
  and MCP callers currently use synchronous `computeShield`. They must await
  gathering without changing the read-only contract.
- `packages/praxrr-app/src/lib/server/security/responses.ts`,
  `docs/api/v1/schemas/security-posture.yaml`,
  `packages/praxrr-api/openapi.json`, generated API types, and the runtime
  response mapper must remain in lockstep under Portable Contract Fidelity.
- `packages/praxrr-app/src/routes/security-posture/+page.svelte` currently shows
  scheme, host, and one exposure badge. Add concise outcome/class-count evidence
  and hedged mixed/failure copy without raw IPs; retain the `arrType` badge and
  instance edit action.
- Existing security tests already pin host classification, per-row scores, mean
  aggregation, band caps, secret absence, and route payloads. Add pure IPv4/IPv6
  classifier/matrix tests plus injected-resolver tests for concurrency, timeout,
  result cap, caching, duplicate coalescing, mixed answers, transitions, budget
  exhaustion, and failure-to-200 behavior. The `security-posture` test alias is
  the required gate.
- `ROADMAP.md` identifies #229 as the remaining Shield Check follow-up.
  Completion should add the PR to the shipped table and replace the
  open-follow-up language without changing the initiative's non-blocking,
  threat-model-driven promise.

The cross-Arr checklist is satisfied by construction: API semantics and schema
mappings are identical for this transport-only fact, dispatch never selects
behavior by `arr_type`, and each row preserves its exact source instance/type
with no Radarr/Sonarr/Lidarr fallback.

## Success Criteria Mapped to Issue Acceptance Criteria

| Issue #229 acceptance criterion                                                                           | Completion evidence                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname lookups are bounded by timeout, result count, and cache policy.                                  | Tests pin 8 uncached hosts/report, concurrency 4, one shared 1,000 ms A/AAAA deadline, 16 unique retained answers, 60-second positive/10-second negative TTLs, 256-entry LRU, in-flight coalescing, deterministic budget exhaustion, and no work for HTTPS/literals.                                                                                                       |
| Private-only, public-only, mixed, failed, and rebinding-like results have documented conservative grades. | The authoritative matrix is implemented exactly: local/private `65` except loopback-only `100`; public/mixed/rebinding-with-public `30` action + guarded cap; failed/incomplete-without-public `65` unknown. Unit tests cover every row and both transition directions.                                                                                                    |
| No lookup failure blocks the posture report or any Arr operation.                                         | Timeout/error/NXDOMAIN/empty/budget outcomes return a 200 report row at `unknown / 65`; integration tests prove the summary and MCP reads resolve, and code search/tests prove the resolver is referenced only by security-posture gathering, never Arr clients/jobs/test/save/sync paths.                                                                                 |
| Findings explain observed address classes without claiming verified WAN exposure.                         | API/UI snapshots contain aggregate class counts and the required "current resolver evidence / not a WAN reachability test" wording; secret/raw-address/error-string negative tests pass. Public/mixed recommendations point to TLS and DNS review without saying "publicly reachable" or "attack".                                                                         |
| Tests cover IPv4, IPv6, split-horizon, mixed-address, timeout, and resolver-failure cases.                | Classifier tables cover IPv4 and IPv6 loopback/private/link-local/public/other plus mapped IPv6; resolver tests cover A-only, AAAA-only, dual-stack mixed, split-horizon-like mixed results, local-to-public/public-to-local changes, truncation, timeout, error, NXDOMAIN, empty, cache, and report budget. `deno task test security-posture` and `deno task check` pass. |

Additional definition-of-done invariants:

- Existing literal-IP scores, check mean/contribution arithmetic, top-action
  ranking, and critical cap behavior remain exact.
- The engine/report version is bumped and OpenAPI/runtime/UI contracts agree.
- No payload or log includes an Arr credential, full connection URL, raw answer,
  or resolver exception.
- Manual controlled-resolver checks demonstrate local-only, public-only, mixed,
  changing, and failing hostname states while Arr operations remain usable.

## Open Questions

1. **Should HTTPS hostnames receive informational DNS evidence later?**
   Recommendation for v1: no. It adds network work without changing transport
   risk, and could tempt the UI to conflate address scope with exposure.
2. **Should the fixed limits become configuration?** Recommendation for v1: no.
   Fixed, test-pinned limits produce one predictable security contract and avoid
   turning Shield Check into an operator-tunable scanner. Revisit only with
   operational evidence.
3. **Should raw addresses be available behind a verbose/debug control?**
   Recommendation: no in this report. Class counts answer the posture question
   with less topology leakage; resolver debugging belongs in a separate
   operator-controlled diagnostic surface if demand appears.
4. **Should link-local become a top-level `TransportTier` wire enum?**
   Recommendation: keep it explicit in DNS evidence but map it to the existing
   private/attention effective tier. This meets classification fidelity without
   inventing a different score or remediation.
5. **How long should a rebinding-like warning persist?** The recommended v1
   answer is the new positive entry's 60-second lifetime. Longer persistence
   would require durable history or a second retention clock and is not
   justified by this read-on-demand, non-blocking feature.
