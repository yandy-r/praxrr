# Feature Spec: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 adds bounded DNS evidence to Shield Check's `arr_transport` criterion
for enabled Arr instances using unknown multi-label HTTP hosts. A server-only
resolver queries A and AAAA through Deno's system resolver under fixed report,
host, concurrency, result, and cache limits, then passes aggregate class
evidence into the pure security engine. Public, mixed, or class-changing
observations become actionable without claiming WAN reachability; lookup failure
remains unknown and never blocks the report or an Arr operation. OpenAPI,
runtime mapping, UI, MCP, tests, and the engine version ship as one contract
change without a new dependency, database table, background job, or probe.

## External Dependencies

### APIs and Services

#### Deno system DNS resolver

- **Documentation**:
  [Deno.resolveDns](https://docs.deno.com/api/deno/~/Deno.resolveDns)
- **Authentication**: none; runtime `allow-net` permission is required.
- **Records**: query `A` and `AAAA` concurrently through the deployment's system
  resolver.
- **Cancellation**: pass one `AbortSignal` shared by both family lookups for a
  hostname.
- **Rate limits**: no provider rate limit; Praxrr enforces its own global and
  per-report bounds.
- **Pricing**: built into Deno; no service or network dependency is added.
- **Constraint**: returned strings do not include authoritative TTLs, so
  60-second positive and 15-second failure lifetimes are explicitly Praxrr cache
  policy, not DNS TTL claims.

The resolver call must not set `nameServer`, follow CNAMEs manually, query a
public DNS-over-HTTPS service, or make a connection to any returned address.
Permission denial, abort, timeout, empty answers, malformed answers, and
resolver rejection become closed evidence outcomes.

### Libraries and SDKs

| Library                          | Version                    | Purpose                                                    | Installation     |
| -------------------------------- | -------------------------- | ---------------------------------------------------------- | ---------------- |
| Deno runtime APIs                | Repository-pinned Deno 2.x | Cancellable A/AAAA resolution, timers, URL parsing         | Existing runtime |
| Third-party DNS/IP/cache package | None                       | Not required; avoids supply-chain and permission expansion | N/A              |

### External Documentation

- [IANA IPv4 Special-Purpose Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml):
  reviewed source for non-public IPv4 ranges.
- [IANA IPv6 Special-Purpose Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml):
  reviewed source for non-public IPv6 ranges.
- [RFC 1918](https://datatracker.ietf.org/doc/html/rfc1918): IPv4 private-use
  ranges.
- [RFC 3927](https://datatracker.ietf.org/doc/html/rfc3927): IPv4 link-local
  range.
- [RFC 4193](https://datatracker.ietf.org/doc/html/rfc4193): IPv6 unique-local
  range.
- [RFC 4291](https://datatracker.ietf.org/doc/html/rfc4291): IPv6 loopback,
  link-local, unspecified, and mapped-address semantics.
- [RFC 6890](https://datatracker.ietf.org/doc/html/rfc6890): interpretation of
  special-purpose address registries.

## Business Requirements

### User Stories

**Primary User: self-hosted Praxrr operator**

- As an operator, I want Shield Check to distinguish a hostname resolving only
  to local addresses from one resolving to public or mixed address scopes so
  that its transport recommendation is more useful than the current unknown-host
  heuristic.
- As an operator, I want the report to explain exactly which address classes
  were observed without publishing raw internal addresses or claiming the Arr
  service is reachable from the WAN.
- As an operator, I want resolver timeouts and failures to degrade one row to
  unknown while the rest of Shield Check and every Arr operation continue
  normally.
- As an operator, I want cached evidence labeled with its original observation
  time so that a cache hit is not presented as a fresh DNS lookup.

**Secondary User: support or automation consumer**

- As an MCP/API consumer, I want the same closed, redacted DNS evidence and
  grading semantics as the UI so that no surface invents a stronger exposure
  claim.

### Business Rules

1. **Candidate scope**: resolve only enabled, sync-capable Arr instances whose
   stored `url` is plaintext `http:`, whose host is multi-label, and whose
   existing non-DNS classification is `unknown`.
   - Never use `external_url` because Arr credentials do not travel over it.
   - HTTPS, configured IP literals, recognized local suffixes, and
     single-label/Docker aliases do no DNS work and retain their shipped
     behavior.
2. **Fixed work policy**: one report has a 2,000 ms deadline, each host has one
   shared 1,500 ms A+AAAA timeout, at most 32 candidates are considered, at most
   four hostname resolutions run globally, and no host retains more than 16
   unique classified answers.
3. **Fixed cache policy**: one process-local 256-entry cache and in-flight map
   are shared by HTTP and MCP. Positive observations live 60 seconds;
   failed/empty/timed-out observations live 15 seconds. Expired entries are
   never current evidence.
4. **Conservative precedence**:
   - HTTPS, configured loopback, and recognized Docker-local transport remain
     `100/pass`.
   - Complete DNS loopback/private/link-local evidence is `65/attention` because
     DNS is mutable.
   - Any observed public address, mixed local/public classes, or a
     public/non-public class transition is `30/action` and caps the overall band
     at guarded.
   - Failure, timeout, empty, candidate/report budget exhaustion,
     special-use-only, malformed, partial local-only, or truncated local-only
     evidence is `65/attention` as unknown/incomplete.
   - Public evidence remains actionable even if another family failed or the
     retained set truncated.
5. **Evidence boundary**: return configured host identity already present today
   plus outcome, source, observation time, bounded IPv4/IPv6 class counts,
   retained count, and incomplete/truncated/change flags. Never return raw
   answers, nameserver data, CNAMEs, errors, URL credentials/path/query, or API
   keys.
6. **No enforcement**: DNS evidence never authorizes, rejects, rewrites, pins,
   routes, or delays an Arr connection. It is absent from Arr clients,
   URL-safety guards, sync, jobs, startup, save, and connection-test paths.
7. **Honest language**: findings say “observed from Praxrr's resolver” and
   explicitly state that DNS alone does not prove WAN reachability. A transition
   is “Address scope changed,” never a confirmed rebinding attack.
8. **Cross-Arr fidelity**: retain the exact `arrType` on every row and apply one
   transport policy to Radarr, Sonarr, and Lidarr without sibling fallback.

### Edge Cases

| Scenario                                                                 | Expected Behavior                                          |               Grade |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------: |
| A and AAAA are private/link-local only and both finish                   | Show local class counts and resolver vantage               |                  65 |
| Any retained answer is public                                            | Show public-address evidence and HTTPS recommendation      |                  30 |
| Local and public answers coexist                                         | Show mixed address scopes; never average to local          |                  30 |
| Prior successful class set crosses public/non-public boundary            | Show Address scope changed for the new cache lifetime      |                  30 |
| A succeeds locally while AAAA fails                                      | Show partial/incomplete; do not claim local-only           |                  65 |
| A is public while AAAA fails                                             | Preserve actionable public evidence and mark incomplete    |                  30 |
| Result/candidate cap is hit without a public answer                      | Show incomplete/truncated or budget-limited evidence       |                  65 |
| Timeout, permission denial, empty answer, or rejection                   | Return a successful report with DNS unavailable/unknown    |                  65 |
| Special, reserved, documentation, multicast, CGNAT, or malformed address | Classify special/unknown, never default public/private     |                  65 |
| IPv4-mapped IPv6 loopback/private address                                | Normalize to embedded IPv4 semantics before classification | 65 when DNS-derived |
| Existing HTTPS, literal loopback, or Docker alias                        | Skip DNS and preserve shipped result                       |                 100 |

### Success Criteria

- [ ] Deterministic tests pin every timeout, candidate, concurrency, result,
      cache, and capacity bound.
- [ ] Pure tests document grades for private-only, public-only, mixed, failed,
      partial, truncated, special, and class-changing IPv4/IPv6 evidence.
- [ ] Resolver failure produces HTTP 200 and valid MCP output without affecting
      any Arr operation.
- [ ] HTTP, MCP, and UI explain class counts and uncertainty without raw
      addresses, credentials, errors, “publicly reachable,” “exposed,” or
      “attack detected.”
- [ ] `deno task test security-posture`, relevant MCP tests, API
      generation/contract gates, and `deno task check` pass.

## Technical Specifications

### Architecture Overview

```text
HTTP summary / MCP resource / MCP tool
                 |
                 v
       async security service
                 |
                 v
gather config + enabled Arr instance facts
                 |
                 v
server-only DNS resolver/cache/semaphore
  Deno.resolveDns(A + AAAA, AbortSignal)
                 |
                 v
pure IP classifier -> bounded class evidence
                 |
                 v
pure shared checks/engine -> explicit wire mapper
                 |
                 v
        OpenAPI / HTTP / MCP / UI
```

`$shared/security` stays deterministic and client-safe.
`$lib/server/security/dnsTransport.ts` owns all time and I/O, including a
module-level production singleton shared across consumers and a factory for
isolated tests. `gather.ts` attaches an observation to an eligible
`InstanceFact`; the engine only interprets the materialized fact.

### Data Models

No database model or migration is added. Process-local entries intentionally
disappear on restart.

```ts
export type IpAddressClass =
  'loopback' | 'private' | 'link-local' | 'public' | 'special';
export type DnsOutcome =
  | 'not-applicable'
  | 'resolved'
  | 'partial'
  | 'timeout'
  | 'failed'
  | 'empty'
  | 'budget-exceeded';
export type DnsEvidenceSource = 'none' | 'fresh' | 'cache';

export interface DnsAddressClassCounts {
  readonly loopback: number;
  readonly private: number;
  readonly linkLocal: number;
  readonly public: number;
  readonly special: number;
}

export interface DnsTransportEvidence {
  readonly outcome: DnsOutcome;
  readonly source: DnsEvidenceSource;
  readonly ipv4: DnsAddressClassCounts;
  readonly ipv6: DnsAddressClassCounts;
  readonly retainedCount: number;
  readonly observedAt: string | null;
  readonly incomplete: boolean;
  readonly truncated: boolean;
  readonly addressClassesChanged: boolean;
}
```

The internal cache may retain bounded normalized addresses only as needed for
classification and comparison. The public mapper emits counts and flags only. A
cache hit preserves the underlying `observedAt`; `source='cache'` does not
refresh it.

### API Design

#### `GET /api/v1/security-posture/summary`

**Purpose**: return the live Shield Check report with bounded per-instance DNS
evidence.

**Authentication**: unchanged repository auth middleware; no public DNS endpoint
is added.

**Request**: no new query parameters, hostname override, timeout override, or
cache bypass.

**Response (200 excerpt):**

```json
{
  "engineVersion": "4",
  "transport": [
    {
      "instanceId": 12,
      "instanceName": "Radarr",
      "arrType": "radarr",
      "scheme": "http",
      "host": "radarr.internal.example",
      "tier": "mixed",
      "score": 30,
      "status": "action",
      "dns": {
        "outcome": "resolved",
        "source": "fresh",
        "ipv4": {
          "loopback": 0,
          "private": 1,
          "linkLocal": 0,
          "public": 1,
          "special": 0
        },
        "ipv6": {
          "loopback": 0,
          "private": 0,
          "linkLocal": 0,
          "public": 0,
          "special": 0
        },
        "retainedCount": 2,
        "observedAt": "2026-07-10T12:00:00.000Z",
        "incomplete": false,
        "truncated": false,
        "addressClassesChanged": false
      },
      "fix": {
        "kind": "instance-link",
        "instanceId": 12,
        "href": "/arr/12",
        "label": "Edit connection"
      }
    }
  ]
}
```

The exact engine version is incremented once during implementation from the
current value. The response carries `Cache-Control: no-store`. DNS degradation
remains inside the 200 response; 500 is reserved for unrelated report
construction failure as today.

#### MCP surfaces

`praxrr://security-posture` and `get_security_posture` become async callers of
the same `computeShield()` service and receive the same allowlisted aggregate
evidence. Neither serializes the internal resolver/cache object.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/shared/security/ip.ts`: pure IPv4/IPv6 parsing,
  CIDR containment, and explicit address-class policy.
- `packages/praxrr-app/src/lib/server/security/dnsTransport.ts`: resolver
  adapter, budgets, concurrency, in-flight joining, cache, evidence aggregation,
  and injectable factory.
- `packages/praxrr-app/src/tests/shared/security/ip.test.ts`: parser/classifier
  boundary tables.
- `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`:
  deterministic async/cache policy suite.

#### Files to Modify

- `packages/praxrr-app/src/lib/shared/security/{types,checks,engine,index,trustedProxy}.ts`
- `packages/praxrr-app/src/lib/server/security/{gather,service,responses}.ts`
- `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`
- `packages/praxrr-app/src/lib/server/mcp/{resources,tools}.ts`
- `docs/api/v1/schemas/security-posture.yaml` and generated API artifacts
  required by repo gates
- `packages/praxrr-app/src/routes/security-posture/+page.svelte`
- focused shared/route/MCP tests and `scripts/test.ts` only if the current alias
  omits new tests
- `ROADMAP.md`

#### Configuration

No user configuration is added. Policy values are fixed exported constants.
Production already has network capability for Arr/Git operations; a restricted
runtime that denies DNS fails to typed unknown evidence without requesting
permission.

## UX Considerations

### User Workflows

#### Primary Workflow: Inspect transport evidence

1. **Load Shield Check**
   - User opens `/security-posture`.
   - System computes the report under the 2-second budget and reuses current
     cache entries.
2. **Review one Arr row**
   - User sees scheme, existing transport tier, DNS evidence label, class/family
     counts, source, and observation time.
   - Public/mixed/changed rows include the no-WAN-proof qualifier and a link to
     instance settings.
3. **Act**
   - User points the Arr connection at HTTPS or corrects internal/external DNS.
   - No modal blocks sync or other Arr operations.

#### Error Recovery Workflow

1. **Error occurs**: one hostname times out, fails, is truncated, or misses the
   report budget.
2. **User sees**: a row-level “DNS unavailable” or “DNS evidence incomplete”
   label with unknown/65, while successful rows and the overall report remain
   available.
3. **Recovery**: the short failure cache prevents a retry storm; a later normal
   refresh can recover.

### UI Patterns

| Component                      | Pattern                                 | Notes                                                         |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------- |
| Existing transport table/cards | Progressive evidence disclosure         | Keep scheme and fix prominent; counts remain compact          |
| DNS badge                      | Text + non-color status                 | Private-only, Public-address, Mixed, Changed, Unavailable     |
| Refresh state                  | One polite page status with `aria-busy` | Preserve the prior report while refreshing; do not move focus |
| Responsive rows                | Stacked instance card on narrow screens | Instance -> transport -> DNS evidence -> freshness -> action  |

### Accessibility Requirements

- Preserve text labels for every state; color is supplemental.
- Add/retain a descriptive table caption and `scope` on column/row headers.
- Announce refresh completion through one polite live region; reserve alerts for
  whole-report failure.
- Keep the no-WAN-proof qualifier and incomplete/stale markers visible without
  requiring hover.
- Never use `{@html}` for hostname or resolver-derived text.

### Performance UX

- Keep the stable page shell while the bounded report is computed.
- Label cache hits as cached with the original observation age.
- Do not expose a force-refresh/cache-bypass control.
- A candidate/result cap is evidence incompleteness, not an invitation to retry
  unboundedly.

## Recommendations

### Implementation Approach

**Recommended Strategy**: freeze the closed evidence contract and pure
classifier first, implement and test the server resolver/cache second, propagate
async integration third, then complete contract/UI surfaces and validation. This
isolates address-policy errors from resolver scheduling bugs.

**Phasing:**

1. **Foundation**: extract shared IP primitives, define evidence contracts and
   pure scoring matrix.
2. **Resolver**: implement cancellation, budgets, process-global concurrency,
   in-flight joining, bounded cache, and deterministic tests.
3. **Integration**: make gather/service/HTTP/MCP async and never-throwing for
   DNS outcomes.
4. **Contract/UI**: update OpenAPI/generated artifacts, mapper, no-store
   response, page evidence, and redaction/copy tests.
5. **Release gate**: update ROADMAP, version, validation, and manual
   controlled-resolver scenarios.

### Technology Decisions

| Decision      | Recommendation                                | Rationale                                                  |
| ------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Resolver      | Native `Deno.resolveDns` with system resolver | Matches deployment DNS view; cancellable; no dependency    |
| IP parsing    | Extract repository bigint/u32 primitives      | Correct prefix math and shared literal/DNS semantics       |
| Cache         | Feature-local bounded `Map` + in-flight `Map` | Security-specific semantics; deterministic and small       |
| Concurrency   | Small process-global semaphore                | Bounds combined HTTP/MCP work rather than per-request work |
| Persistence   | None                                          | DNS evidence is transient and topology-sensitive           |
| Wire evidence | Nested family/class counts                    | Explains IPv4/IPv6 split without raw-address disclosure    |

### Quick Wins

- Convert public IPv6 and IPv4-mapped literals through the exact shared
  classifier while preserving special ranges as unknown.
- Reuse the existing instance-settings fix and transport table instead of adding
  a second page.
- Add `Cache-Control: no-store` while touching the summary route.

### Future Enhancements

- Privacy-safe aggregate metrics for outcome counts, cache hit ratio, queue
  depth, and truncation.
- A separately designed class-transition history only if operational evidence
  justifies it; never raw DNS history in this issue.

## Risk Assessment

### Technical Risks

| Risk                                                        | Likelihood | Impact | Mitigation                                                                  |
| ----------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------- |
| Per-request limits multiply under concurrent HTTP/MCP reads | Medium     | High   | Process-global semaphore, cache, and in-flight joining                      |
| Partial A/AAAA result gives false local assurance           | Medium     | High   | Public wins; incomplete local-only remains unknown/65                       |
| Special-use or mapped address is misclassified              | Medium     | High   | Binary parser, explicit prefixes, boundary tables, fail to special          |
| Async conversion leaves a non-awaited caller                | Medium     | High   | Search all `computeShield(` call sites and run server/client checks         |
| Cache hides a class transition                              | Low        | High   | Short fixed lifetime and class-fingerprint comparison on refresh            |
| UI/API/MCP contract drifts                                  | Medium     | Medium | OpenAPI-first update, generated artifacts, explicit mapper, shared fixtures |

### Integration Challenges

- `trustedProxy.ts` currently owns private parsing primitives; extraction must
  preserve proxy behavior exactly while separating trusted-peer policy from
  address-class policy.
- Resolver/cache tests require injected time and pending promises; they must not
  sleep or use live DNS.
- Candidate/report deadlines must include queue time so 32 slow hosts cannot
  turn into sequential 1.5-second waves.

### Security Considerations

#### Critical — Hard Stops

| Finding                                                             | Risk                                   | Required Mitigation                                                                 |
| ------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| DNS helper accepts arbitrary nameserver/host or connects to answers | SSRF/scanner boundary violation        | Resolve only normalized stored candidates through system DNS; no socket/fetch/probe |
| DNS grade flows into Arr URL authorization or routing               | DNS rebinding TOCTOU can bypass safety | Keep evidence report-only; forbid imports from operational Arr paths                |

#### Warnings — Must Address

| Finding                                             | Risk                                         | Mitigation                                                 | Alternatives                                            |
| --------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Timeout implemented with `Promise.race` only        | Resolver work continues after report returns | Pass `AbortSignal`, clear timer/in-flight in `finally`     | Route rate limit is supplementary only                  |
| Raw results/errors cross response/log boundary      | Topology or secret leakage                   | Closed mapper, class counts only, no-store, negative tests | Omitting host entirely is optional, raw answers are not |
| DNS-local loopback is treated like literal loopback | Mutable evidence becomes false assurance     | Keep every DNS-local class at attention/65                 | None for v1                                             |

#### Advisories — Best Practices

- Record the reviewed IANA registry snapshot date beside classification tables.
- Keep process-local cache provenance explicit in multi-process deployments.
- Add only aggregate, hostname-free operational metrics if tuning becomes
  necessary.

## Task Breakdown Preview

### Phase 1: Pure policy foundation

**Focus**: shared parser, evidence types, and deterministic grading.

**Tasks**:

- Extract IP/CIDR primitives and preserve trusted-proxy behavior.
- Add address-class tables and boundary tests.
- Add DNS evidence types, transport tiers, version bump, and pure score-matrix
  tests.

**Parallelization**: schema-source drafting can begin after types freeze, but
generated artifacts wait.

### Phase 2: Bounded resolver

**Focus**: server-only asynchronous I/O and cache policy.

**Dependencies**: Phase 1 classifier/evidence types.

**Tasks**:

- Implement injected A+AAAA resolver, abort deadlines, aggregation, global
  concurrency, in-flight joining, cache expiry/LRU, and class transitions.
- Prove every fixed limit and error path deterministically.

### Phase 3: Integration and presentation

**Focus**: async consumers and portable contract fidelity.

**Dependencies**: Phases 1-2.

**Tasks**:

- Attach observations in gatherer; await service from HTTP and both MCP paths.
- Update OpenAPI, generated artifacts, explicit mapper, no-store behavior, and
  contract tests.
- Render accessible evidence/copy and add UI/redaction tests.
- Update `ROADMAP.md`, run focused/full validation, and complete
  controlled-resolver manual checks.

## Decisions Needed

No product decision remains open. The design fixes candidate scope, resolver
viewpoint, all resource bounds, cache policy, grading, redaction, module
ownership, async consumers, and contract surfaces. Implementation should use
deterministic LRU eviction, nested IPv4/IPv6 class counts, and a
public/non-public class fingerprint lasting for the new positive-cache entry
unless a concrete code constraint proves an equivalent safer representation.

The classifier implementation must record the reviewed IANA registry snapshot
date and tests must pin every included prefix. This is an implementation detail,
not permission to weaken the rule that unfamiliar/special space fails to unknown
rather than public.

## Research References

- [research-external.md](./research-external.md): Deno resolver, standards, and
  cache constraints.
- [research-business.md](./research-business.md): user rules, grading matrix,
  and acceptance mapping.
- [research-technical.md](./research-technical.md): architecture, types, async
  integration, and tests.
- [research-ux.md](./research-ux.md): evidence wording, accessibility,
  freshness, and error states.
- [research-security.md](./research-security.md): scanner/TOCTOU boundaries and
  severity findings.
- [research-practices.md](./research-practices.md): reuse, module boundaries,
  KISS, and test seams.
- [research-recommendations.md](./research-recommendations.md): final choices
  and phased execution.
