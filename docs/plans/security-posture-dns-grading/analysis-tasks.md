# Task Analysis: DNS-Aware Arr Transport Grading

## Executive Summary

Issue #229 should be implemented as six dependency-resolved phases and four
practical parallel batches. The critical path is: shared IP/evidence foundation
-> pure grading and bounded resolver -> async gathering -> HTTP/MCP integration
-> contract/UI completion -> release validation. File ownership must remain
exclusive within each task so parallel work does not collide in the shared
types, generated API artifacts, route tests, or UI.

The implementation is best divided into 13 code/document tasks plus one
validation task. Most tasks own one to three files. Shared contracts and
classifier behavior are frozen first; the resolver and pure scoring can then
proceed in parallel. OpenAPI source/runtime mapping can also proceed once the
evidence shape is frozen. Generated artifacts are a separate serialized task.
HTTP and MCP consumers become independent integration tasks only after the async
service and response mapper stabilize. The existing route test remains the
single combined HTTP/UI contract-test owner, avoiding competing edits.

Every task must preserve the fixed design: only stored unknown multi-label HTTP
hosts are eligible; A and AAAA use the system resolver; bounds are 2,000
ms/report, 1,500 ms/host, 32 candidates, four globally active hostname
resolutions, 16 retained answers/host, 60-second positive cache, 15-second
failure cache, and 256 entries; public/mixed/changed evidence is `30/action`,
complete DNS-local evidence is `65/attention`, and all uncertain non-public
evidence is `65/attention`. There are no probes, persistence, new dependencies,
runtime settings, raw-address output, or operational Arr-path dependencies.

## Recommended Phase Structure

### Phase 1 — Pure policy foundation

**Task T1: Extract and extend shared IP classification**

- **Owns:**
  - `packages/praxrr-app/src/lib/shared/security/ip.ts` (new)
  - `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`
  - `packages/praxrr-app/src/tests/shared/security/ip.test.ts` (new)
- **Work:** Extract the existing exact IPv4/IPv6/CIDR primitives, add
  IPv4-mapped-IPv6 normalization, and classify `loopback`, `private`,
  `link-local`, `public`, and `special` with an IANA snapshot note. Preserve
  trusted-proxy policy while moving only reusable parsing/math.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/shared/security/ip.test.ts`
  - `deno check packages/praxrr-app/src/lib/shared/security/ip.ts`
- **Dependencies:** none.

**Task T2: Freeze DNS evidence and transport contracts**

- **Owns:**
  - `packages/praxrr-app/src/lib/shared/security/types.ts`
  - `packages/praxrr-app/src/lib/shared/security/index.ts`
- **Work:** Add closed DNS outcome/source/count/evidence types, attach evidence
  to `InstanceFact`/`TransportRow`, extend transport-tier vocabulary where
  needed, and bump `SECURITY_POSTURE_ENGINE_VERSION` from `3` to `4`. Export
  only pure/client-safe types and helpers.
- **Validation:**
  - `deno check packages/praxrr-app/src/lib/shared/security/types.ts`
  - `deno task check:server`
- **Dependencies:** none; may run in parallel with T1 because file ownership is
  disjoint.

**Task T3: Prove trusted-proxy extraction parity**

- **Owns:**
  - `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`
- **Work:** Add boundary/regression cases proving the extracted parser leaves
  exact token, CIDR, wildcard, invalid-entry, and overly-broad trust behavior
  unchanged.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`
- **Dependencies:** T1.

### Phase 2 — Deterministic grading and bounded DNS resolver

**Task T4: Implement pure DNS-aware transport grading**

- **Owns:**
  - `packages/praxrr-app/src/lib/shared/security/checks.ts`
  - `packages/praxrr-app/src/tests/shared/security/checks.test.ts`
- **Work:** Preserve URL-first shipped classifications, consume materialized DNS
  evidence only for eligible `unknown` HTTP rows, and implement the fixed
  precedence: configured HTTPS/loopback/Docker-local `100`;
  public/mixed/public-boundary-change `30/action` with guarded cap; complete
  DNS-local and every uncertain non-public state `65/attention`. Public evidence
  wins over partial/truncated flags. Use hedged resolver-vantage language.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/shared/security/checks.test.ts`
  - `deno check packages/praxrr-app/src/lib/shared/security/checks.ts`
- **Dependencies:** T1 and T2.

**Task T5: Build the server-only DNS resolver/cache**

- **Owns:**
  - `packages/praxrr-app/src/lib/server/security/dnsTransport.ts` (new)
  - `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts` (new)
- **Work:** Implement the injectable `Deno.resolveDns` A+AAAA adapter, one
  shared host abort deadline, process-global four-slot semaphore, normalized-key
  in-flight joining, bounded deterministic LRU cache, expiry, aggregate counts,
  incompleteness/truncation, and public/non-public class-transition
  fingerprints. Export a production singleton and an isolated factory. Always
  clean timers and in-flight state in `finally`.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`
  - `deno check packages/praxrr-app/src/lib/server/security/dnsTransport.ts`
- **Dependencies:** T1 and T2. May run in parallel with T4 and T6.

**Task T6: Add engine-level DNS rollup invariants**

- **Owns:**
  - `packages/praxrr-app/src/tests/shared/security/engine.test.ts`
- **Work:** Pin version `4`, exact row/check/overall score consequences,
  contribution-sum and recoverable-points invariants, guarded cap behavior,
  actionability, and unchanged results for established trusted cases. No engine
  I/O or resolver mocking belongs here.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/shared/security/engine.test.ts`
- **Dependencies:** T2 and T4.

### Phase 3 — Async gathering and service orchestration

**Task T7: Materialize bounded DNS evidence in posture gathering**

- **Owns:**
  - `packages/praxrr-app/src/lib/server/security/gather.ts`
  - `packages/praxrr-app/src/lib/server/security/service.ts`
  - `packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts`
    (new)
- **Work:** Convert `buildPostureInputs` and `computeShield` to async. Select
  only enabled, sync-capable instances whose stored `url` is plaintext HTTP,
  multi-label, and currently unknown; never use `external_url`. Normalize with
  `URL.hostname`, lowercase, remove one terminal dot, deduplicate
  deterministically, cap at 32, and enforce the 2-second report deadline
  including semaphore queue time. Attach typed evidence per row and keep all DNS
  failures row-local and never-throwing.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts`
  - `deno task check:server`
  - `rg -n "computeShield\\(|buildPostureInputs\\(" packages/praxrr-app/src`
- **Dependencies:** T4 and T5.

### Phase 4 — Portable contract and generated artifacts

**Task T8: Define the wire contract and explicit redaction mapper**

- **Owns:**
  - `docs/api/v1/schemas/security-posture.yaml`
  - `packages/praxrr-app/src/lib/server/security/responses.ts`
- **Work:** Define nested IPv4/IPv6 class counts plus closed outcome/source,
  `retainedCount`, nullable `observedAt`, and incomplete/truncated/change flags.
  Map every field explicitly. Do not permit raw address strings, errors,
  nameservers, CNAMEs, or full URLs. Keep runtime DTO and schema
  required/nullable semantics identical.
- **Validation:**
  - `deno task bundle:api`
  - `deno task check:server`
- **Dependencies:** T2 and T4. May be drafted in parallel with T5 after the
  evidence shape is frozen, but must be finalized before T9.

**Task T9: Regenerate and inspect API artifacts**

- **Owns:**
  - `packages/praxrr-api/openapi.json`
  - `packages/praxrr-app/src/lib/api/v1.d.ts`
- **Work:** Generate from the YAML sources only; never hand-edit either
  artifact. Format the bundled JSON and inspect both diffs to ensure changes are
  limited to the DNS evidence contract.
- **Validation:**
  - `deno task bundle:api`
  - `deno task generate:api-types`
  - `deno task format`
  - rerun both generation commands and verify `git diff` is stable.
- **Dependencies:** T8. Serialized because both commands touch generated
  contract state.

### Phase 5 — HTTP, MCP, and UI integration

**Task T10: Await the HTTP service and secure response caching**

- **Owns:**
  - `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`
- **Work:** Await `computeShield(event)`, map through `toSummaryResponse`,
  preserve unrelated internal-failure behavior, keep DNS degradation inside HTTP
  200, and add `Cache-Control: no-store`.
- **Validation:**
  - `deno check packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`
- **Dependencies:** T7 and T8.

**Task T11: Await both MCP security-posture consumers**

- **Owns:**
  - `packages/praxrr-app/src/lib/server/mcp/resources.ts`
  - `packages/praxrr-app/src/lib/server/mcp/tools.ts`
  - `packages/praxrr-app/src/tests/mcp/mcp.test.ts`
- **Work:** Make `praxrr://security-posture` and `get_security_posture` await
  the same singleton-backed `computeShield()` service and pass results through
  the same response mapper. Test success, resolver failure degradation,
  identical aggregate evidence, and absence of raw addresses/errors/secrets.
- **Validation:**
  - `deno task test mcp`
  - `deno task check:server`
- **Dependencies:** T7 and T8. May run in parallel with T10 and T12.

**Task T12: Complete HTTP contract tests and accessible UI evidence**

- **Owns:**
  - `packages/praxrr-app/src/routes/security-posture/+page.svelte`
  - `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`
- **Work:** Render text-labeled DNS states, compact per-family class counts,
  source, original observation time, incomplete/truncated/change indicators, and
  the explicit no-WAN-proof qualifier. Preserve prior content while refreshing,
  stable focus, `aria-busy`, and one polite live region; never use `{@html}`.
  Extend the route suite to cover HTTP 200 degradation, `no-store`, exact wire
  shape, configured-host identity, public/mixed/partial/cache/change cases,
  engine version `4`, and forbidden terms/data.
- **Validation:**
  - `deno task test packages/praxrr-app/src/tests/routes/securityPosture.test.ts`
  - `deno task check:client`
  - `deno task test security-posture`
- **Dependencies:** T8, T9, and T10. UI work may start after T8; final tests
  require T10.

### Phase 6 — Documentation and release gate

**Task T13: Record issue #229 delivery**

- **Owns:**
  - `ROADMAP.md`
- **Work:** Update the Ecosystem Security Posture row and release-history entry
  in the established table format, reference issue #229 and the eventual PR, and
  accurately summarize resolver bounds, advisory-only semantics, redacted
  evidence, version bump, and validation coverage.
- **Validation:**
  - `deno fmt --check ROADMAP.md`
  - `git diff --check -- ROADMAP.md`
- **Dependencies:** T10, T11, and T12; final PR link can be filled when known.

**Task T14: Run the complete release validation and boundary audit**

- **Owns:** no source files; validation-only task. Any discovered fix returns to
  the task that owns the affected file.
- **Work:** Run all focused/full gates, audit async callers and forbidden
  imports, update graphify after code changes, and perform controlled resolver
  scenarios without arbitrary live DNS.
- **Validation:** see the ordered gate list under Implementation Strategy
  Recommendations.
- **Dependencies:** T3, T6, T9, T11, T12, and T13.

## Task Granularity Recommendations

- Keep T1 cohesive even though it owns three files: parser extraction,
  classifier policy, and its boundary table must be reviewed together.
  Trusted-proxy behavior tests are T3 so T1 does not exceed three files.
- Keep T2 as the single owner of `types.ts` and `index.ts` for the entire
  implementation. Later tasks consume those contracts and must send any type
  adjustment back through T2 rather than editing in parallel.
- Keep scoring production and scoring tests together in T4. The precedence
  matrix is the executable definition of the pure grading policy.
- Keep the resolver and its deterministic tests together in T5. Splitting
  semaphore, cache, timeout, or transition behavior into separate production
  files would add surface without improving ownership.
- Keep gathering and the thin service wrapper together in T7 because the async
  signature change is one atomic integration seam. Use a dedicated new gathering
  test rather than overloading route tests with candidate-selection internals.
- Keep YAML source and runtime response mapper together in T8; contract drift is
  less likely when one task owns both. Generated outputs remain T9 so generator
  churn cannot collide with schema design.
- Keep the existing `securityPosture.test.ts` under T12 as the single combined
  HTTP/UI contract test owner. T10 therefore edits only the endpoint, and T12
  runs after it.
- Do not modify `scripts/test.ts` unless tests are placed outside paths already
  covered by the `security-posture` alias. The proposed new tests are already
  beneath `tests/shared/security` and `tests/server/security`.
- T14 makes no opportunistic edits. Failures are routed back to the exclusive
  file owner, preserving reviewability and avoiding a final cross-cutting
  cleanup commit.

## Dependency Analysis

### Dependency-resolved batches

```text
Batch A (parallel)
  T1 shared IP/classifier extraction
  T2 DNS evidence contracts/version

Batch B (parallel after A)
  T3 trusted-proxy parity      <- T1
  T4 pure grading             <- T1, T2
  T5 resolver/cache           <- T1, T2
  T8 schema/response draft    <- T2 (finalize after T4)

Batch C (parallel where shown)
  T6 engine invariants        <- T4
  T7 async gather/service     <- T4, T5
  T9 generated artifacts      <- T8

Batch D (parallel after T7/T8; T12 finishes after T9/T10)
  T10 HTTP endpoint           <- T7, T8
  T11 MCP consumers/tests     <- T7, T8
  T12 UI + route tests        <- T8, T9, T10

Batch E
  T13 ROADMAP                 <- T10, T11, T12
  T14 full release gate       <- T3, T6, T9, T11, T12, T13
```

### Critical path

`T1 + T2 -> T4 + T5 -> T7 -> T10 -> T12 -> T13 -> T14`

T8/T9 must finish before T12, but can overlap resolver/gathering work. T3 and T6
are regression gates rather than integration blockers, yet both must pass before
T14. MCP T11 is parallel to HTTP/UI and is an independent release blocker.

### Hard dependency rules

- Do not start async consumer edits before T7 fixes the `computeShield`
  signature.
- Do not generate contract artifacts before T8 freezes YAML and response DTO
  semantics.
- Do not finalize UI field access before T9 supplies the generated public shape.
- Do not treat a focused resolver test as proof of report behavior; T10-T12 and
  T11 prove HTTP/MCP degradation and redaction at their actual boundaries.
- Do not update the final ROADMAP PR reference until the PR number exists; a
  placeholder may be prepared but must not survive T14.

## File-to-Task Mapping

| Task | Production/document files                                                   | Test/generated files                                  | Parallel-write risk                     |
| ---- | --------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| T1   | `shared/security/ip.ts`, `shared/security/trustedProxy.ts`                  | `shared/security/ip.test.ts`                          | None with T2                            |
| T2   | `shared/security/types.ts`, `shared/security/index.ts`                      | —                                                     | Contract hotspot; exclusive owner       |
| T3   | —                                                                           | `shared/security/trustedProxy.test.ts`                | Depends on T1                           |
| T4   | `shared/security/checks.ts`                                                 | `shared/security/checks.test.ts`                      | No overlap with T5/T8                   |
| T5   | `server/security/dnsTransport.ts`                                           | `server/security/dnsTransport.test.ts`                | Stateful module; exclusive owner        |
| T6   | —                                                                           | `shared/security/engine.test.ts`                      | No production collision                 |
| T7   | `server/security/gather.ts`, `server/security/service.ts`                   | `server/security/gatherDnsTransport.test.ts`          | Async seam; exclusive owner             |
| T8   | `docs/api/v1/schemas/security-posture.yaml`, `server/security/responses.ts` | —                                                     | Contract hotspot; precedes T9           |
| T9   | —                                                                           | `packages/praxrr-api/openapi.json`, `lib/api/v1.d.ts` | Serialized generation only              |
| T10  | `routes/api/v1/security-posture/summary/+server.ts`                         | —                                                     | Independent of MCP files                |
| T11  | `server/mcp/resources.ts`, `server/mcp/tools.ts`                            | `tests/mcp/mcp.test.ts`                               | Independent of HTTP/UI files            |
| T12  | `routes/security-posture/+page.svelte`                                      | `tests/routes/securityPosture.test.ts`                | Sole route-test owner                   |
| T13  | `ROADMAP.md`                                                                | —                                                     | Last documentation writer               |
| T14  | —                                                                           | —                                                     | Validation-only; routes fixes to owners |

Paths in the table under `shared`, `server`, `routes`, and `tests` are relative
to `packages/praxrr-app/src/` unless otherwise shown.

## Optimization Opportunities

1. **Freeze the evidence shape once.** T2 should define the nested
   family/class-count model before resolver, mapper, or UI work. This avoids
   parallel teams inventing incompatible internal and wire vocabularies.
2. **Coalesce before the semaphore.** T5 should check cache/in-flight state
   before acquiring one of four slots so identical concurrent HTTP/MCP requests
   consume one lookup and one slot.
3. **Resolve per normalized hostname, project per instance.** T7 can deduplicate
   work while preserving distinct instance IDs, names, and exact Arr types in
   output rows.
4. **Use pure helpers for aggregation and precedence.** Address parsing, count
   aggregation, class fingerprints, and grading should be independently testable
   without timers or the DB. Keep only scheduling/cache mutation in the stateful
   resolver shell.
5. **Reuse current route and UI structure.** Extend the existing transport row
   and instance-settings fix rather than creating a new endpoint, page, modal,
   or state store.
6. **Exploit existing focused aliases.** The current `security-posture` alias
   already reaches both new test directories and the route test. Avoid
   test-runner churn.
7. **Generate once after schema review.** Review T8 first, then run T9's
   bundle/type generation together and format immediately. This reduces noisy
   repeated artifact diffs.
8. **Use targeted gates inside tasks.** Run the smallest relevant test/check
   after each task; reserve `deno task lint`, `deno task check`, and the full
   suite for T14.
9. **Keep manual scenarios controlled.** Reuse injected resolver fixtures for
   local, public, mixed, partial, changed, timeout, empty, and cache-hit cases.
   No task should wait on arbitrary public DNS behavior.

## Implementation Strategy Recommendations

Implement batch by batch and require each task's focused validation before
unblocking its dependents. Within a parallel batch, assign each task's listed
files to one implementor and do not allow opportunistic edits outside that
ownership. If a contract mismatch is found, return it to T2 or T8, rerun
dependent tests/generation, and only then resume downstream work.

The resolver test suite in T5 must deterministically pin:

- one 1,500 ms shared A+AAAA timeout and abort cleanup;
- a 2,000 ms caller/report abort including semaphore queue time;
- no more than four active hostname resolutions across concurrent consumers;
- 32 deterministic candidates per report with overflow marked incomplete;
- no more than 16 unique classified retained answers per hostname;
- in-flight joining before slot acquisition and single cache insertion;
- 60,000 ms positive and 15,000 ms failed/empty/timed-out lifetimes;
- expiry before deterministic LRU eviction and capacity behavior on entry 257;
- cache hits preserving original `observedAt` while reporting `source='cache'`;
- public evidence surviving family failure/truncation;
- class transitions only across the public/non-public boundary for the current
  positive cache lifetime;
- rejection, permission denial, timeout, empty, malformed, and partial outcomes
  never escaping as thrown report errors.

Run the final T14 gates in this order:

1. `deno task test packages/praxrr-app/src/tests/shared/security/ip.test.ts`
2. `deno task test packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`
3. `deno task test packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`
4. `deno task test packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts`
5. `deno task test security-posture`
6. `deno task test mcp`
7. `deno task bundle:api`
8. `deno task generate:api-types`
9. `deno task format`
10. rerun `deno task bundle:api` and `deno task generate:api-types`; confirm no
    new diff
11. `deno task lint`
12. `deno task check`
13. `deno task test`
14. `deno task check:dist-paths`
15. `rg -n "computeShield\\(|buildPostureInputs\\(" packages/praxrr-app/src`
16. `rg -n "dnsTransport" packages/praxrr-app/src/lib/server` and confirm
    imports are limited to the security posture gather/service path, never Arr
    clients, sync, jobs, startup, save, connection tests, authorization, or
    URL-safety code
17. negative-output searches/tests confirming no raw DNS answers, resolver error
    text, credentials, path/query, nameservers, CNAMEs, “publicly reachable,”
    “exposed,” “rebound,” or “attack detected” cross HTTP/MCP/UI boundaries
18. `graphify update .`
19. `git diff --check`

Finally, run controlled resolver scenarios for complete local-only A+AAAA,
public-only, mixed, public plus failed family, local plus failed family,
truncated local, special-only, class transition, timeout, rejection, empty
answer, cache hit, and report/candidate budget exhaustion. The release is ready
for PR review only when the exact generated contract is stable, engine version
`4` is asserted, `ROADMAP.md` is complete, every async caller is awaited, the
forbidden-import audit is clean, and all focused/full gates pass.
