# Feature Spec: Issue #262 Deno-WASM Runtime Viability Decision

## Executive Summary

Issue #262 gates Praxrr's first real plugin executor on proof that the selected
Deno runtime can enforce finite wall-clock, guest-memory, and fuel limits while
denying network and filesystem access. The evaluated `@extism/extism@2.0.0-rc13`
JavaScript SDK executes compatible guests and enforces a worker timeout on Deno,
but it has no fuel or active-cancellation API and its `maxPages` option does not
cap guest-owned linear memory. The design decision is therefore NO-GO: preserve
the frozen, default-off Phase-1 foundation, document the evidence, and keep
production execution and dependent phases blocked until a separately approved
backend satisfies every sandbox gate.

## External Dependencies

### APIs and Services

No remote service is part of the implementation. The spike evaluated local
execution through the Extism universal JavaScript SDK and loaded only controlled
test artifacts.

### Libraries and SDKs

| Candidate                           | Evaluated version              | Result                            | Repository impact                                       |
| ----------------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------- |
| `@extism/extism`                    | Exact npm pin `2.0.0-rc13`     | NO-GO for #262                    | Do not add to `deno.json` or `deno.lock`                |
| Native `libextism` / Wasmtime       | Current C/Rust APIs researched | Plausible, not approved           | Requires a separate FFI, packaging, and platform design |
| Deno Worker + QuickJS/other backend | Conceptual fallback            | Not a drop-in Extism/WASM runtime | Requires a separate backend-selection design            |

### External Documentation

- [Extism JS SDK v2.0.0-rc13](https://github.com/extism/js-sdk/tree/v2.0.0-rc13):
  exact JavaScript implementation evaluated.
- [Extism JS SDK interfaces](https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/interfaces.ts):
  public options have timeout and exchange-memory controls but no fuel or
  `AbortSignal` API.
- [Extism background plugin](https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/background-plugin.ts):
  worker timeout and restart behavior.
- [Extism call-context memory](https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/call-context.ts):
  `maxPages` accounting applies to host-context blocks rather than all guest
  memories.
- [Extism runtime C API](https://extism.org/docs/concepts/runtime-apis/): native
  runtime surface that would require Deno FFI and platform artifacts.
- [Deno WebAssembly reference](https://docs.deno.com/runtime/reference/wasm/):
  native WebAssembly embedding does not provide deterministic instruction fuel.
- [Deno security model](https://docs.deno.com/runtime/fundamentals/security/):
  worker and native-code authority considerations.

## Business Requirements

### User Stories

**Primary user: Praxrr operator**

- As an operator who has not enabled plugins, I want the runtime to remain
  completely inert so that a rejected dependency cannot affect normal startup or
  core behavior.
- As an operator who enables plugins in a future phase, I want hostile or broken
  guests contained by real finite limits so that a plugin cannot exhaust or
  destabilize Praxrr.

**Secondary user: Praxrr maintainer**

- As a maintainer, I want an evidence-backed go/no-go result so that the project
  does not ship a sandbox whose implementation is weaker than its documented
  contract.
- As a maintainer, I want the `PluginExecutor` seam to remain runtime-neutral so
  that a compliant backend can replace the rejected candidate without contract
  churn.

### Business Rules

1. **All mandatory limits are conjunctive**: timeout, active cancellation, total
   guest memory, and deterministic fuel must all be enforced; one passing
   control cannot substitute for another.
2. **Default-off remains a hard no-op**: `PLUGINS_ENABLED=false` must not
   import, probe, or execute a runtime.
3. **No weaker fallback**: an unavailable or rejected runtime leaves
   `UnavailablePluginExecutor` selected; it may not silently activate a
   wall-clock-only executor.
4. **Frozen public seam**: no Extism, Worker, FFI, or backend type may enter the
   shared plugin contract, registry, validator, host context, or
   `PluginExecutionRequest`/result shape.
5. **No production trigger**: #262 does not wire sync/profile producers. Issues
   #263-#266 are sibling phases under #267 and remain out of scope and blocked.
6. **Evidence must distinguish SDKs**: JavaScript SDK behavior must not be
   inferred from native Rust/C APIs such as fuel-limited construction or
   cancellation handles.

### Edge Cases

| Scenario                                                | Required behavior                                  | Spike result                                              |
| ------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Deno worker receives SDK's Node-only default `execArgv` | Fail closed; record workaround                     | Worker failed until `execArgv: []` was supplied           |
| Infinite guest                                          | Stop underlying execution before the host deadline | SDK worker timeout passed                                 |
| Caller aborts an active call                            | Stop guest and settle promptly                     | No direct API; `close()` did not promptly settle the call |
| Guest grows its own linear memory past `maxPages`       | Reject before exceeding the ceiling                | Guest grew from 1 to 11 pages with `maxPages: 2`          |
| Guest consumes instruction budget                       | Deterministically trap on finite fuel              | No JS SDK fuel API exists                                 |
| Guest requests HTTP or WASI filesystem                  | Deny despite privileged host process               | Empty hosts and disabled WASI passed the scoped checks    |
| Runtime absent/unhealthy                                | App boots with inert executor                      | Existing Phase-1 design already provides this behavior    |

### Success Criteria

- [x] Record exact Deno, platform, SDK version, commands, and observed go/no-go
      evidence.
- [x] Demonstrate trivial execution, timeout, network denial, and disabled-WASI
      behavior.
- [x] Demonstrate the guest-memory counterexample and absence of
      fuel/cancellation APIs.
- [ ] Implement a real executor only after one backend proves every mandatory
      sandbox gate.
- [x] Preserve the Phase-1 production runtime and contract unchanged after the
      NO-GO.

## Technical Specifications

### Architecture Overview

- Current production state (preserved): `PluginHost` delegates through the
  unchanged `PluginExecutor` seam to `UnavailablePluginExecutor`, whose promise
  rejects with `PluginRuntimeUnavailableError`. Projection, scrubbing, the
  outer timeout, and per-plugin isolation remain in the host.
- Rejected candidate: the `@extism/extism` JavaScript SDK passes Deno execution
  with an `execArgv` workaround, worker timeout, empty HTTP allowlisting, and
  disabled WASI. It fails active `AbortSignal` cancellation, a total
  guest-memory ceiling, and deterministic fuel metering.
- Future approved path: `PluginHost` continues through the same
  `PluginExecutor` seam to a compliant backend adapter that provides timeout,
  cancellation, memory, and fuel controls while denying network, filesystem,
  WASI, and ambient host functions.

```text
PluginHost -> PluginExecutor -> compliant backend adapter
```

### Data Models

No database, persistent state, API schema, shared plugin type, or manifest field
changes are permitted. The durable artifact is documentation only. A future
runtime-result cache is explicitly unnecessary because #262 has no production
consumer; if later introduced, it must include runtime behavior version, API
version, normalized plugin id, plugin version, artifact digest, extension point,
and canonical input digest.

### System Integration

#### Files to Create

- `docs/plans/262-wasm-extism-runtime/research-*.md`: seven research
  perspectives and reproducible spike evidence.
- `docs/plans/262-wasm-extism-runtime/feature-spec.md`: consolidated design
  decision.
- `docs/prps/plans/completed/262-wasm-extism-no-go.plan.md`: validated and
  archived implementation plan.
- `docs/prps/reports/262-wasm-extism-no-go-report.md`: implementation/validation
  evidence.

#### Files to Modify

- `docs/plans/35-wasm-plugin-system/phase-1-foundation.md`: dated NO-GO result,
  exact evidence, corrected native-versus-JavaScript API distinction, and
  follow-up gates.
- `docs/architecture/plugins.md`: state that the runtime seam remains
  intentionally inert because the evaluated JavaScript SDK cannot satisfy
  mandatory controls.
- `ROADMAP.md`: record #262's spike result and keep compliant runtime delivery
  plus #263-#266 blocked.

#### Files Explicitly Unchanged

- `packages/praxrr-app/src/lib/server/plugins/**`
- `packages/praxrr-app/src/lib/shared/plugins/**`
- `packages/praxrr-app/src/hooks.server.ts`
- `deno.json` and `deno.lock`

## UX Considerations

### User Workflows

#### Maintainer spike workflow

1. Pin Deno 2.9.1 and `@extism/extism@2.0.0-rc13` outside the application
   dependency graph.
2. Run the positive and adversarial fixtures with exact finite settings.
3. Compare observed enforcement to the issue's conjunctive acceptance gates.
4. Record NO-GO when any hard gate fails; do not promote a partial runtime.

#### Operator workflow

There is no new UI or production execution path. Operators retain the Phase-1
experience: `PLUGINS_ENABLED` defaults off, and an unavailable executor cannot
abort normal application work.

### Feedback and State Design

| State               | Meaning                                          | Communication                                                             |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Disabled            | Intentional opt-out                              | Existing info-level disabled message                                      |
| Runtime unavailable | No compliant executor selected                   | Existing typed unavailable behavior; design/roadmap explain the gate      |
| Candidate rejected  | Spike failed mandatory controls                  | Dated design record with stable observations, never a partial-ready claim |
| Future ready        | Every sandbox gate passes on supported artifacts | Requires a separate reviewed decision before code selection               |

### Performance UX

No loading, optimistic-update, browser, or accessibility behavior changes. The
relevant performance contract is maintainer-facing: timeout evidence must prove
underlying guest termination, and a future backend must demonstrate a healthy
invocation after each resource failure.

## Recommendations

### Implementation Approach

**Recommended strategy:** land an evidence-only NO-GO change. Update the
existing design, architecture note, and roadmap; preserve all Phase-1 runtime
code and dependency metadata; then run the normal plugin baseline and
documentation validation to prove the production state did not drift.

### Technology Decisions

| Decision                           | Recommendation                   | Rationale                                                                            |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| JavaScript Extism executor         | Reject                           | Missing fuel, active cancellation, and total guest-memory enforcement                |
| Partial trusted-plugin preview     | Reject for #262                  | Would require an explicit threat-model and acceptance-policy change                  |
| Native `libextism` FFI             | Investigate separately           | Technically credible but adds native crash, ABI, permission, and release-matrix risk |
| Worker + QuickJS/other runtime     | Investigate as backend selection | Worker termination alone does not prove fuel/memory; QuickJS changes guest semantics |
| Production code/dependency changes | None in this PR                  | A failed spike must cost only the executor, as the foundation intended               |

### Future Enhancements

- A prerequisite backend-selection/native-runtime spike with adversarial
  fixtures and Linux/Windows compiled-artifact evidence.
- Runtime delivery only after that spike passes timeout, cancellation, fuel,
  total guest memory, forbidden I/O, cleanup, and optional-degradation gates.
- Resume #263-#266 only after a compliant runtime is shipped.

## Risk Assessment

### Technical Risks

| Risk                                                            | Likelihood | Impact   | Mitigation                                                                    |
| --------------------------------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| Documentation is mistaken for shipped runtime                   | Medium     | High     | State NO-GO and unchanged inert production state in every artifact            |
| A later contributor adds the rejected SDK as a partial executor | Medium     | High     | Preserve the hard-gate matrix and explicit dependency prohibition             |
| Native FFI is absorbed without release design                   | Medium     | Critical | Require separate approval, pins, checksums, ABI review, and platform evidence |
| Sibling phases proceed despite runtime blocker                  | Medium     | High     | Update #267/ROADMAP dependency language and keep #263-#266 blocked            |
| Spike evidence becomes stale                                    | Medium     | Medium   | Record exact date/version; require a fresh matrix for any later candidate     |

### Security Considerations

#### Critical — Hard Stops

| Finding                                                                | Risk                                                      | Required mitigation                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| No JS SDK fuel API                                                     | Unbounded deterministic computation cannot meet contract  | Select a backend with proven fuel accounting                               |
| `maxPages` misses guest-owned memory                                   | Guest can exceed the claimed memory ceiling               | Prove a backend-wide guest-memory limiter with adversarial growth          |
| Plugin entry path can become a host read primitive in a future adapter | Traversal/symlink escape under host permissions           | Canonical descendant check, bounded read, digest, bytes-only runtime input |
| Unreviewed native FFI                                                  | Native code can bypass Deno sandbox and crash the process | Separate native security/packaging design or supervised sidecar            |

#### Warnings — Must Address

| Finding                                                 | Risk                                                | Mitigation                               | Alternative                 |
| ------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------- |
| No active JS cancellation API                           | Caller may return while guest work survives         | Backend cancel handle plus cleanup proof | Supervised runtime process  |
| Experimental worker and Deno `execArgv` incompatibility | Runtime initialization can fail by platform/version | Exact pins and compiled-artifact probe   | Reject unsupported platform |
| Runtime errors can contain guest paths/URLs/data        | Log exfiltration/injection                          | Stable host-owned outcome codes only     | Opaque correlation id       |

#### Advisories — Best Practices

- Keep `UnavailablePluginExecutor` as the explicit default and never silently
  weaken limits.
- Do not add a result cache or mutable runtime-instance pool in the first
  compliant implementation.
- Test denial under a host process that has the relevant authority so outer Deno
  permissions do not produce false-positive sandbox evidence.

## Task Breakdown Preview

### Phase 1: Record the Viability Decision

**Focus:** turn validated research into the authoritative design record.

- Append the dated spike matrix and NO-GO rationale to the Phase-1 design.
- Correct architecture claims that conflate native Extism with the JavaScript
  SDK.
- Preserve exact reproduction commands and primary-source links.

### Phase 2: Update Project Status

**Focus:** make dependency ordering and production state unambiguous.

- Update `ROADMAP.md` with the completed spike and blocked runtime delivery.
- State that #263-#266 remain sibling phases blocked by a compliant runtime.

### Phase 3: Validate and Review

**Focus:** prove an evidence-only change did not drift runtime behavior.

- Run formatting, whitespace, focused plugin tests, type checking, and
  appropriate documentation checks.
- Review for claim fidelity, scope, security classification, and absence of
  dependency/source changes.
- Create the template-compliant PR, address findings, monitor CI, and merge only
  when green.

## Decisions Needed

The design decision for this worktree is resolved: choose the evidence-only
NO-GO and do not expand into native FFI or relax sandbox requirements. A future
native/backend implementation requires a new explicitly approved scope because
it changes packaging, permissions, release targets, and process risk.

## Research References

- [research-external.md](./research-external.md): official SDK APIs and
  reproducible Deno spike.
- [research-business.md](./research-business.md): issue hierarchy, invariants,
  workflows, and success criteria.
- [research-technical.md](./research-technical.md): architecture, limit policy,
  cache, fixtures, and backend options.
- [research-ux.md](./research-ux.md): maintainer/operator states, diagnostics,
  and failure recovery.
- [research-security.md](./research-security.md): severity-classified threat
  model and acceptance matrix.
- [research-practices.md](./research-practices.md): KISS, modularity,
  dependency, and testability guidance.
- [research-recommendations.md](./research-recommendations.md): decision matrix
  and PR/follow-up scope.
