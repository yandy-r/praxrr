# Plan: Issue #262 Extism Deno-WASM NO-GO

## Summary

Land the validated Deno/Extism viability decision for issue #262 as an
evidence-only NO-GO. Update the authoritative Phase-1 design, architecture note,
and roadmap while preserving the default-off, inert plugin foundation and adding
no runtime dependency, executor, lockfile change, or production call-site.

## User Story

As a Praxrr maintainer, I want the mandatory plugin sandbox gates evaluated and
recorded honestly, so that an executor is not shipped with weaker limits than
the public security contract.

## Problem → Solution

The Phase-1 design assumes the Deno JavaScript SDK exposes native Extism-style
timeout, memory, fuel, and cancellation controls → Record the proven
API/behavior gaps, correct the architecture assumption, and keep runtime
delivery plus dependent phases blocked until a compliant backend is approved.

## Metadata

- **Complexity**: Small
- **Source PRD**: `docs/plans/262-wasm-extism-runtime/feature-spec.md`
- **PRD Phase**: standalone viability decision
- **Estimated Files**: 3 implementation files plus design/research/report
  artifacts
- **Execution Mode**: Sequential
- **Worktree Mode**: Disabled in plan because execution already occurs in the
  isolated `feat/262-wasm-extism-runtime` worktree

---

## Testing Strategy

### Unit Tests

| Test                                   | Input                                                      | Expected Output                              | Edge Case?                             |
| -------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| Existing unavailable executor contract | Valid `PluginExecutionRequest`                             | Exact typed unavailable rejection            | Yes — rejected candidate remains inert |
| Existing host isolation                | Registered plugins with unavailable/throwing fake executor | Caller continues and later plugin dispatches | Yes — optional subsystem failure       |
| Existing disabled startup              | `PLUGINS_ENABLED=false`                                    | No plugin directory/runtime work             | Yes — default-off hard no-op           |
| Research validator                     | Seven research files                                       | Zero errors/warnings                         | No                                     |
| Spec validator                         | Consolidated feature spec                                  | Zero structural errors                       | No                                     |
| PRP plan validator                     | This plan                                                  | Zero structural errors                       | No                                     |

No new runtime unit test is appropriate because the selected SDK is
intentionally absent. The live spike observations are preserved as design
evidence; the repository tests prove only that the safe Phase-1 baseline remains
unchanged.

### Edge Cases Checklist

- [x] SDK import and trivial execution under exact Deno/npm versions recorded.
- [x] Node-only worker `execArgv` incompatibility and Deno override recorded.
- [x] Infinite guest worker timeout observed and distinguished from fuel.
- [x] Active abort counterexample recorded.
- [x] Guest-owned linear-memory growth beyond `maxPages` recorded.
- [x] Absent JavaScript fuel API confirmed against exact public/source
      interfaces.
- [x] Empty Extism HTTP allowlist and disabled WASI behavior recorded.
- [ ] Future backend cancellation, fuel, total-memory, and platform artifact
      matrix remains a blocker.

---

## Validation Commands

### Structural Design Validation

```bash
bash /home/yandy/.codex/plugins/cache/local-ycc-plugins/ycc/skills/feature-research/scripts/validate-research.sh \
  "$PWD/docs/plans/262-wasm-extism-runtime"
bash /home/yandy/.codex/plugins/cache/local-ycc-plugins/ycc/skills/feature-research/scripts/validate-spec.sh \
  "$PWD/docs/plans/262-wasm-extism-runtime/feature-spec.md"
bash /home/yandy/.codex/plugins/cache/local-ycc-plugins/ycc/skills/prp-plan/scripts/validate-prp-plan.sh \
  "$PWD/docs/prps/plans/262-wasm-extism-no-go.plan.md"
```

EXPECT: Research and plan validators report zero errors; spec validator reports
zero errors.

### Static Analysis and Formatting

```bash
deno fmt --check \
  ROADMAP.md \
  docs/architecture/plugins.md \
  docs/plans/35-wasm-plugin-system/phase-1-foundation.md \
  docs/plans/262-wasm-extism-runtime \
  docs/prps/plans/262-wasm-extism-no-go.plan.md
git diff --check
deno task check
```

EXPECT: Formatting and whitespace are clean; server/client type checks have zero
errors.

### Unit Tests

```bash
deno task test plugins
```

EXPECT: The complete shared/server plugin baseline passes unchanged.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions. If repository-wide infrastructure blocks the suite,
capture exact evidence and require all touched-scope and CI gates to pass before
merge.

### Build Check

```bash
deno task build
```

EXPECT: Build succeeds with no new runtime dependency or artifact.

### Scope Audit

```bash
git diff --name-only origin/main -- \
  packages/praxrr-app/src/lib/server/plugins \
  packages/praxrr-app/src/lib/shared/plugins \
  packages/praxrr-app/src/hooks.server.ts \
  deno.json deno.lock
```

EXPECT: No output.

### Manual Validation

- [ ] Read the NO-GO summary without the research files and confirm it does not
      imply runtime delivery.
- [ ] Confirm every pass/fail observation names the exact JavaScript SDK rather
      than generic Extism.
- [ ] Confirm native FFI and alternate backends are future candidates, not
      selected implementation.
- [ ] Confirm ROADMAP keeps #263-#266 blocked and preserves #35's promotion
      criteria.
- [ ] Confirm the diff contains no source, dependency, lockfile, production
      route, API, DB, UI, or SDK change.

---

## Acceptance Criteria

- [ ] The seven feature-research artifacts and consolidated feature spec are
      retained and validator-clean.
- [ ] The authoritative Phase-1 design records the dated exact-version NO-GO and
      reproducible evidence.
- [ ] Architecture documentation distinguishes JavaScript SDK limits from native
      Extism facilities.
- [ ] ROADMAP records the completed spike but does not call Phase 2 runtime
      delivery shipped.
- [ ] `UnavailablePluginExecutor`, `PLUGINS_ENABLED` default OFF, and every
      frozen contract/source file remain unchanged.
- [ ] No runtime dependency, lockfile entry, executor, production call-site,
      cache, API, persistence, SDK, or UI is added.
- [ ] GitHub's actual hierarchy is honored: #262 has no child issues; #263-#266
      remain sibling phases under #267.
- [ ] All structural, formatting, plugin-test, type-check, full-test, build, and
      scope-audit gates pass or are explicitly evidenced and resolved before
      merge.

## Completion Checklist

- [ ] Codebase and documentation patterns followed.
- [ ] Security claims match observed backend behavior.
- [ ] JavaScript and native Extism APIs are not conflated.
- [ ] Existing plugin tests remain green.
- [ ] No hardcoded or moving dependency reference is introduced into production
      metadata.
- [ ] Design, architecture, roadmap, PRP report, and PR body are mutually
      consistent.
- [ ] No unnecessary scope additions.
- [ ] Self-contained — no implementation question remains for the evidence-only
      decision.

## Risks

| Risk                                                 | Likelihood | Impact   | Mitigation                                                                     |
| ---------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------ |
| Evidence-only PR is mistaken for executor completion | Medium     | High     | Use NO-GO and inert-runtime wording in design, roadmap, report, and PR         |
| Reviewer treats worker timeout as fuel               | Medium     | Critical | Preserve the conjunctive gate and explicit counterexample                      |
| `maxPages` is overstated as total guest memory       | Medium     | Critical | Cite source and adversarial 1-to-11-page result                                |
| Native FFI silently becomes the implementation       | Low        | Critical | State separate approval, packaging, ABI, permission, and platform requirements |
| Later phases are unblocked prematurely               | Medium     | High     | Name #263-#266 and #267 dependency ordering in roadmap                         |
| Research evidence becomes stale                      | Medium     | Medium   | Pin date/version/platform and require a fresh matrix for future candidates     |

## Notes

- The worktree already exists at
  `/home/yandy/.codex/worktrees/praxrr-262-wasm-extism-runtime` on
  `feat/262-wasm-extism-runtime`; run PRP implementation with `--no-worktree` to
  avoid nesting another worktree.
- The plan is intentionally sequential because all three implementation files
  express one decision and should be updated atomically for wording consistency.
- A NO-GO completes the issue's viability gate but does not satisfy the
  conditional real-executor checkboxes. The PR and GitHub close linkage must
  state that distinction honestly; dependent runtime delivery remains deferred
  until a compliant backend is approved.

## Patterns to Mirror

Code and documentation patterns discovered in the repository. Follow these
exactly.

### DESIGN_GATE

```markdown
<!-- SOURCE: docs/plans/35-wasm-plugin-system/phase-1-foundation.md:376-386 -->

Before committing, validate on Deno that:

1. the dependency loads under Deno;
2. timeout + cancellation work; and
3. host functions + memory/fuel limits behave.
```

Mirror the existing conjunctive gate and its statement that a negative result
costs only the executor, never the foundation.

### RUNTIME_SEAM

```ts
// SOURCE: packages/praxrr-app/src/lib/server/plugins/executor.ts
export interface PluginExecutor {
  execute(req: PluginExecutionRequest): Promise<PluginJsonValue>;
}
```

The documentation must keep the seam runtime-neutral and explicitly state that
it is unchanged.

### OPTIONAL_DEGRADATION

```ts
// SOURCE: packages/praxrr-app/src/lib/server/plugins/executor.ts
execute(_req: PluginExecutionRequest): Promise<never> {
  return Promise.reject(new PluginRuntimeUnavailableError('wasm runtime not yet available'));
}
```

The default unavailable executor is the correct production state after the
NO-GO.

### ROADMAP_DEFERRED_ENTRY

```markdown
<!-- SOURCE: ROADMAP.md:298-305 -->

| Issue | Why Deferred | Promote When |
| ----- | ------------ | ------------ |
```

Update the existing #35 row and deferred checklist rather than creating a new
competing roadmap section.

### CLAIM_FIDELITY

```markdown
<!-- SOURCE: docs/plans/262-wasm-extism-runtime/research-external.md -->

This is a partial technical go but a product/acceptance no-go.
```

Separate observed passes from mandatory failures. Never describe timeout as
fuel, exchange-memory accounting as total guest memory, or native C/Rust APIs as
JavaScript SDK features.

### TEST_STRUCTURE

```ts
// SOURCE: packages/praxrr-app/src/tests/plugins/executor.test.ts
const error = await assertRejects(
  () => executor.execute(buildRequest()),
  PluginRuntimeUnavailableError
);
```

The existing plugin suites are the unchanged production baseline; no
runtime-shaped test should be added for a dependency deliberately not selected.

---

## UX Design

### Before

```text
Phase-1 docs describe Extism as the recommended Phase-2 runtime
  -> Deno viability is unproven
  -> later phases are deferred
```

### After

```text
@extism/extism@2.0.0-rc13 spike = NO-GO
  -> trivial execution + worker timeout passed
  -> active cancellation + total guest memory + fuel failed
  -> UnavailablePluginExecutor remains the only production executor
  -> compliant backend selection and #263-#266 remain blocked
```

### Interaction Changes

| Touchpoint        | Before                       | After                                           | Notes                                 |
| ----------------- | ---------------------------- | ----------------------------------------------- | ------------------------------------- |
| Operator runtime  | Default-off inert foundation | Unchanged                                       | No dependency or production execution |
| Maintainer design | Viability gate pending       | Dated, reproducible NO-GO                       | Exact SDK/Deno/platform evidence      |
| Roadmap           | Phase 2 generally deferred   | JS SDK spike complete; runtime delivery blocked | Sibling phases remain separate        |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority       | File                                                      | Lines   | Why                                                        |
| -------------- | --------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| P0 (critical)  | `docs/plans/262-wasm-extism-runtime/feature-spec.md`      | all     | Validated decision, scope, and acceptance gates            |
| P0 (critical)  | `docs/plans/262-wasm-extism-runtime/research-external.md` | all     | Exact live spike commands, observations, and official APIs |
| P0 (critical)  | `docs/plans/262-wasm-extism-runtime/research-security.md` | all     | Hard-stop findings and future acceptance matrix            |
| P1 (important) | `docs/plans/35-wasm-plugin-system/phase-1-foundation.md`  | 355-395 | Authoritative gate and negative-result contract            |
| P1 (important) | `docs/architecture/plugins.md`                            | 266-280 | Runtime-seam summary requiring correction                  |
| P1 (important) | `ROADMAP.md`                                              | 296-305 | Deferred feature table                                     |
| P1 (important) | `ROADMAP.md`                                              | 402-410 | Deferred tracking checklist                                |
| P2 (reference) | `packages/praxrr-app/src/lib/server/plugins/executor.ts`  | all     | Frozen seam and inert default that must remain unchanged   |

## External Documentation

| Topic              | Source                                                                       | Key Takeaway                                                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| JS SDK interfaces  | <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/interfaces.ts>        | No fuel or active cancellation API                                 |
| JS SDK memory      | <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/call-context.ts>      | `maxPages` bounds host exchange blocks, not every guest memory     |
| Worker timeout     | <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/background-plugin.ts> | Timeout terminates/restarts a worker; it is not deterministic fuel |
| Native runtime API | <https://extism.org/docs/concepts/runtime-apis/>                             | Fuel/cancel support belongs to a materially different FFI backend  |

---

## Files to Change

| File                                                     | Action | Justification                                                                               |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `docs/plans/35-wasm-plugin-system/phase-1-foundation.md` | UPDATE | Record the dated NO-GO evidence and correct JavaScript/native API assumptions               |
| `docs/architecture/plugins.md`                           | UPDATE | State the evaluated runtime result and preserved inert seam                                 |
| `ROADMAP.md`                                             | UPDATE | Record spike completion while keeping compliant runtime delivery and sibling phases blocked |

The eight files under `docs/plans/262-wasm-extism-runtime/` are
pre-implementation design artifacts created and validated by the required
feature-research workflow; retain them in the final change set.

## NOT Building

- No `ExtismPluginExecutor`, alternate executor, runtime selector, startup
  wiring, or production call-site.
- No `@extism/extism`, native library, other runtime dependency, `deno.json`, or
  `deno.lock` change.
- No change to the frozen `PluginExecutor`, shared contract, registry,
  validator, capability model, extension points, or host projection boundary.
- No runtime result/compiled-artifact cache, WASM fixture, API, persistence,
  SDK, management UI, or lifecycle state change.
- No implementation of sibling issues #263-#266; GitHub reports #262 has no
  child issues and those tasks are separate children of #267.
- No new GitHub follow-up issue in this PR unless separately authorized; the
  documents specify the prerequisite backend-selection scope without mutating
  external issue state.

---

## Step-by-Step Tasks

### Task 1: Record the dated Deno/Extism NO-GO in the authoritative design

- **ACTION**: Update `docs/plans/35-wasm-plugin-system/phase-1-foundation.md`
  section 9 and risk register with the 2026-07-11 spike outcome.
- **IMPLEMENT**: Preserve the original gate, then add Deno 2.9.1/Linux x86_64
  and exact `@extism/extism@2.0.0-rc13` evidence: npm works with `execArgv: []`,
  JSR is unpublished, trivial execution and worker timeout pass, direct
  cancellation/fuel/total guest-memory fail, HTTP denial and disabled WASI pass.
  Correct `with_fuel_limit`/memory wording as native rather than JS SDK and
  specify the separate backend-selection/native prerequisite.
- **MIRROR**: DESIGN_GATE and CLAIM_FIDELITY.
- **IMPORTS**: None; documentation only.
- **GOTCHA**: Do not claim issue #262's executor acceptance criteria or Phase 2
  runtime delivery are complete. Do not paste raw guest/SDK errors or temporary
  filesystem paths.
- **VALIDATE**:
  `deno fmt --check docs/plans/35-wasm-plugin-system/phase-1-foundation.md` and
  `rg -n "NO-GO|2.0.0-rc13|fuel|guest.*memory|UnavailablePluginExecutor" docs/plans/35-wasm-plugin-system/phase-1-foundation.md`.

### Task 2: Correct the plugin architecture runtime status

- **ACTION**: Update `docs/architecture/plugins.md` under Runtime Seam & Future
  Runtime.
- **IMPLEMENT**: Replace the pending/unqualified Extism recommendation with the
  dated JS SDK NO-GO, distinguish JavaScript and native APIs, and state that the
  default unavailable executor and zero production triggers remain intentional.
  Link the validated feature spec/research directory for detailed evidence.
- **MIRROR**: RUNTIME_SEAM, OPTIONAL_DEGRADATION, and CLAIM_FIDELITY.
- **IMPORTS**: None; documentation only.
- **GOTCHA**: Do not make native FFI sound selected or approved; it is only a
  future candidate with material packaging/security gates.
- **VALIDATE**: `deno fmt --check docs/architecture/plugins.md` and
  `rg -n "NO-GO|UnavailablePluginExecutor|native|fuel|guest.*memory" docs/architecture/plugins.md`.

### Task 3: Update ROADMAP.md without unblocking sibling phases

- **ACTION**: Update the #35 deferred row and deferred watchlist entry in
  `ROADMAP.md`; adjust the top reviewed summary only as needed to reflect the
  current decision.
- **IMPLEMENT**: Record that #262 completed the JS SDK viability spike as NO-GO
  while compliant runtime delivery remains deferred/blocked. Name #263-#266 as
  dependency-ordered sibling phases under #267, not completed child work, and
  preserve the promotion criteria.
- **MIRROR**: ROADMAP_DEFERRED_ENTRY and CLAIM_FIDELITY.
- **IMPORTS**: None; documentation only.
- **GOTCHA**: Do not add #262 to Recently Shipped, mark #35 complete, or imply a
  runtime executor exists.
- **VALIDATE**: `deno fmt --check ROADMAP.md` and
  `rg -n "#262|#263|#264|#265|#266|NO-GO|WASM Plugin System" ROADMAP.md`.

### Task 4: Prove scope fidelity and unchanged runtime behavior

- **ACTION**: Format and validate every design/implementation artifact, run the
  unchanged plugin baseline and type checks, and verify the diff contains no
  source/dependency/runtime drift.
- **IMPLEMENT**: Run the feature-research/spec/PRP validators, Markdown
  formatting, whitespace, `deno task test plugins`, `deno task check`, and a
  diff audit that rejects changes under plugin source, hooks, `deno.json`, or
  `deno.lock`. Record exact results in the PRP implementation report.
- **MIRROR**: TEST_STRUCTURE and CLAIM_FIDELITY.
- **IMPORTS**: Existing Deno tasks and bundled YCC validators only.
- **GOTCHA**: Existing plugin tests prove the preserved Phase-1 baseline, not a
  real executor. State that limitation explicitly in the report and PR.
- **VALIDATE**: All commands in Validation Commands pass, and
  `git diff --name-only origin/main...HEAD` plus working-tree paths contain no
  runtime/dependency file.

---
