# Task Structure Analysis: sync-preview-reviewed-plan

## Executive Summary

Implement issue #234 in the existing worktree
`/home/yandy/Projects/github.com/yandy-r/praxrr-issue-234` on branch
`feat/issue-234-reviewed-sync-plan`. The implementation should be a contract-first, fail-closed
integrity layer around the existing preview and sync paths: create a private versioned review
binding, capture separate PCD/config and live Arr evidence through the real section preparation
logic, atomically claim the preview and every selected sync section, revalidate the complete selected
subset before any write-side effect, and execute the existing writers with the exact reviewed
configuration only after every fingerprint matches.

The critical path is OpenAPI source and binding primitives -> atomic preview-store invariants ->
evidence capture/config parity -> all-section claims and reviewed executor -> route/UI recovery ->
cross-Arr and zero-write acceptance proof. Contract generation, the pure binding core, and the
database claim primitive can begin as file-disjoint parallel tasks, but their integration points must
be completed sequentially. Every task below is explicitly marked **Parallel** or **Sequential** for
this one existing worktree; no additional worktree or branch should be created.

Keep tasks to one to three owned files where practical. Generated API mirrors, Graphify output, and
review/fix artifacts are mechanical exceptions. There is no database migration, durable preview
table, new dependency, sibling-Arr fallback, executable-payload replay engine, or change to ordinary
scheduled/manual/canary sync semantics in scope.

## Recommended Phase Structure

### Phase 0: Baseline and acceptance freeze

#### T00 — Baseline and requirement matrix — **Sequential**

- **Files**: none.
- **Action**: Verify the specified worktree/branch, inspect issue #234 and the completed design
  artifacts, and freeze an acceptance matrix for exact instance/`arrType`/section/config binding;
  PCD-only, Arr-only, combined, scope, config, TTL, lifecycle, and unverifiable invalidation; all
  selected claims before any write; zero snapshots/history/outcomes on rejection; Radarr/Sonarr/
  Lidarr explicit dispatch; accessible regeneration recovery; and generated-contract parity.
- **Dependencies**: none.
- **Validation**: `git status --short --branch`, `git branch --show-current`, issue inspection,
  `shared.md`, and `feature-spec.md` agree. Preserve all pre-existing plan artifacts and unrelated
  worktree changes.

### Phase 1: Independent contract and integrity foundations

#### T01 — Define the reviewed-apply wire contract — **Parallel**

- **Files**:
  - `docs/api/v1/schemas/sync.yaml`
  - `docs/api/v1/paths/sync.yaml`
- **Action**: Document `sectionConfigs` in the create contract and define a closed apply invalidation
  schema with stable codes `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`, `scope_drift`, and
  `unverifiable_review`; bounded changed sections/evidence, `regenerateRequired: true`, nullable
  `staleWarning`, and sanitized copy. Update apply semantics to reviewed revalidation, retaining
  `404`, lifecycle/claim `409`, invalidation `422`, and unexpected `500` distinctions.
- **Dependencies**: T00.
- **Validation**: Schema and path references resolve; runtime-accepted fields are documented; no raw
  hashes, source values, credentials, upstream bodies, outcomes, or history IDs appear in pre-write
  invalidation responses.

#### T02 — Implement the pure versioned review binding — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` (new)
  - `packages/praxrr-app/src/tests/base/syncPreviewReviewBinding.test.ts` (new)
- **Action**: Add immutable binding/evidence types, bounded canonical projections, explicit semantic
  array handling, domain-separated SHA-256 hashes, config clone/normalization, selected-subset
  comparison, and the typed invalidation result/error. Reject unknown versions, missing/duplicate
  evidence, non-finite or unsupported values, ambiguous evidence, and plan-only mismatch.
- **Dependencies**: T00.
- **Validation**: Pure mutation-table tests prove stable key-order hashing, material ordering rules,
  exact section/config preservation, PCD/Arr/both classifications, scope/unverifiable results,
  plan-hash guarding, unselected-section isolation, immutability, and no secret/raw evidence in the
  returned public-safe error.

#### T03 — Add atomic all-section claim primitives — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`
  - `packages/praxrr-app/src/tests/jobs/reviewedSyncClaims.test.ts` (new)
- **Action**: Add the smallest transaction-backed exact-section claim/release/fail operation across
  current sync-config tables. It must never call unconditional pending setters, never overwrite
  `in_progress`, acquire all requested supported rows or roll back all acquisitions, preserve exact
  section order at the caller boundary, and enforce Lidarr-only metadata semantics explicitly.
- **Dependencies**: T00.
- **Validation**: Migrated SQLite tests cover all-or-none acquisition, an already-active first/middle/
  last section, missing config, rollback state restoration, duplicate section input, concurrent
  contenders, and Radarr/Sonarr/Lidarr metadata restrictions.

#### T04 — Regenerate and verify portable API mirrors — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/lib/api/v1.d.ts`
  - `packages/praxrr-api/openapi.json`
  - `packages/praxrr-api/types.ts`
- **Action**: Generate declarations and the bundled portable API from T01; never hand-edit generated
  files. Read `docs/api/README.md` and `packages/praxrr-api/README.md` before generation.
- **Dependencies**: T01.
- **Validation**: `deno task generate:api-types`; `deno task bundle:api`; format the bundled JSON as
  required; rerun generation and require no unexplained churn. The create config and every typed
  invalidation field/code must appear in both mirrors.

### Phase 2: Private lifecycle and evidence capture

#### T05 — Make preview completion and apply claim atomic — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/preview/store.ts`
  - `packages/praxrr-app/src/tests/base/syncPreviewStore.test.ts` (new)
- **Action**: Keep the binding private beside `StoredPreview`; add atomic `completeGeneration` and
  `claimReadyForApply` operations. A preview must never become `ready` without a valid binding;
  claim must check TTL, lifecycle, binding version/coverage, and exact eligible non-empty subset in
  one operation before `ready -> applying`. Keep GET/public snapshots free of private evidence and
  preserve original timestamps.
- **Dependencies**: T02.
- **Validation**: Tests cover complete-without-binding failure, private/public separation, subset
  order, skipped/failed-section rejection, missing/unknown binding, concurrent double apply, expiry
  during claim, immutable timestamps/config, terminal failed invalidation, delete/cleanup coupling,
  and existing lifecycle transitions.

#### T06 — Add optional evidence capture to the shared preview path — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/base.ts`
  - `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
  - `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- **Action**: Add an internal evidence recorder/preparation result that is optional for drift,
  history, and MCP callers. Attach and clear it beside preview config, capture explicit instance/type/
  capability context, return complete private evidence only to reviewed create/revalidation callers,
  and keep `SyncPreviewResult` byte-compatible/public-only. Ensure failures and `finally` paths clear
  config and evidence state.
- **Dependencies**: T02 and T05.
- **Validation**: Focused orchestrator tests prove exact ordered subset dispatch, successful-section
  evidence coverage, partial-generation behavior, one client lifecycle, optional-caller compatibility,
  no public leakage, and recorder/config cleanup after thrown reads.

#### T07 — Capture quality-profile evidence and config parity — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
  - `packages/praxrr-app/src/tests/sync/qualityProfilesSyncer.test.ts`
- **Action**: Record normalized reviewed selections, namespace/source identity, PCD/TRaSH profiles
  and custom formats, quality mappings, transformed desired values, live custom formats/profiles, and
  material capability/version inputs at their authoritative read seams. Make reviewed `sync()` use
  the same effective config getter as preview without changing ordinary sync behavior.
- **Dependencies**: T06.
- **Validation**: Tests mutate every write-relevant identity/mapping/field, distinguish true-set order
  from semantic order, preserve exact config names, prove all three Arr types use explicit mappings,
  prove transient reviewed config reaches execution, and show no sibling fallback.

#### T08 — Capture delay-profile evidence and config parity — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`
  - `packages/praxrr-app/src/tests/sync/delayProfilesSyncer.test.ts` (new)
- **Action**: Record exact selected database/profile config, selected PCD materialization, per-app live
  delay-profile state, target identity, and material version/capability data. Route reviewed execution
  through the existing preview-aware config helper and retain explicit Radarr/Sonarr/Lidarr semantics.
- **Dependencies**: T06.
- **Validation**: Tests cover PCD/config/live mutations, exact-name preservation, app-specific payload
  differences, transient-config parity, deterministic collection handling, and no cross-Arr fallback.

#### T09 — Capture media-management evidence and config parity — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`
  - `packages/praxrr-app/src/tests/sync/mediaManagementSyncer.test.ts` (new)
- **Action**: Record subsection selections, PCD/TRaSH source identities, naming, quality-definition,
  media-setting rows/mappings and transformed desired values, matching live configurations, and
  material target capabilities. Reuse the preview-aware reviewed config across validation and writes.
- **Dependencies**: T06.
- **Validation**: Tests cover each subsection independently and combined, disabled/absent selections,
  mapping and quality-order mutations, app-specific unsupported fields, transient-config parity,
  deterministic evidence, and explicit Arr dispatch.

#### T10 — Capture Lidarr metadata evidence and config parity — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
  - `packages/praxrr-app/src/tests/jobs/lidarrMetadataProfilesSync.test.ts`
- **Action**: Record exact database/profile config, PCD row/namespace, transformed desired profile,
  live Lidarr schema/profile state including the material schema-`null` result, and target capability
  inputs. Use the same effective reviewed config for validation and execution and fail closed for any
  non-Lidarr target.
- **Dependencies**: T06.
- **Validation**: Tests cover PCD/config/schema/profile mutation, namespace and remote-ID targeting,
  schema-null stability, transient-config parity, and explicit rejection for Radarr/Sonarr rather
  than shared-table or sibling fallback.

### Phase 3: Reviewed execution boundary

#### T11 — Implement the all-selected reviewed executor — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
  - `packages/praxrr-app/src/tests/jobs/reviewedSyncExecution.test.ts` (new)
- **Action**: Add object-based `executeReviewedSyncJob`. Reload the exact enabled instance, compare
  the bound explicit `arrType` and current capability, acquire every selected claim through T03,
  recheck expiry, regenerate every selected section through T06-T10 with stored configs, compare all
  PCD/Arr/plan evidence, and only then cross the first snapshot/history/outcome/Arr-write boundary.
  On mismatch or unreadable evidence, release/fail only owned claims and return/throw a typed safe
  invalidation with zero write-side evidence. On match, run existing writers with the exact reviewed
  configs and preserve issue #232 outcome/history correlation. Leave `executeSyncJob` unchanged.
- **Dependencies**: T03 and T07-T10.
- **Validation**: Instrumented tests prove PCD-only, Arr-only, both, config, plan-only, scope, TTL,
  missing input, later-section drift, and active-claim conflicts cause zero Arr writes, snapshots,
  Sync History rows, and outcomes. Matching tests cover exact selected subset/order/config, success/
  partial/failure outcomes, history `previewId`, claim cleanup, all explicit Arr types, and ordinary
  unreviewed executor regression behavior.

#### T12 — Prove planned-versus-confirmed separation — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`
  - `packages/praxrr-app/src/tests/jobs/arrSyncVersionGate.test.ts`
- **Action**: Extend existing regression suites so review evidence authorizes an attempt but never
  becomes a `SyncEntityOutcome`; pre-write invalidation never records Sync History; and changed
  target/version support becomes scope drift before mutation rather than an ordinary skipped write.
- **Dependencies**: T11.
- **Validation**: Existing issue #232 confirmed-outcome assertions remain green, while new negative
  assertions prove no planned change is promoted into execution proof.

### Phase 4: Route, UI, contract, and acceptance integration

#### T13 — Persist bindings and map reviewed apply responses — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`
  - `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
  - `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`
- **Action**: Create the private binding from exact successful evidence and atomically complete the
  preview. Replace route-level `get()` plus `transition()` and advisory execution with T05's atomic
  claim and T11's reviewed executor. Preserve body/eligibility/TTL guards and exact selected order;
  map typed drift/scope/unverifiable failures to contract-safe `422`, claim/lifecycle conflicts to
  `409`, and unexpected sanitized errors to `500`; terminally invalidate old previews without
  discarding their public diff.
- **Dependencies**: T04, T05, and T11.
- **Validation**: Direct route tests cover create binding installation, public response secrecy,
  default versus explicit subset, ineligible sections, TTL edges, concurrent apply, every typed
  invalidation response, success/failure outcomes, and dependency injection of clock/executor.

#### T14 — Add persistent accessible regeneration recovery — **Parallel**

- **Files**:
  - `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`
  - `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
  - `packages/praxrr-app/src/tests/e2e/specs/sync-preview-reviewed-plan.spec.ts` (new)
- **Action**: Preserve exact transient configs through preview creation; show “Validating reviewed
  preview…” until authorization completes; exhaustively map safe evidence classes; retain the old
  diff read-only; disable further Apply; state “Nothing was applied”; focus a persistent
  `role="alert"` recovery region; and offer “Generate a new preview.” Keep exact target Arr type and
  selected sections visible without color-only meaning or optimistic success.
- **Dependencies**: T04 and T13.
- **Validation**: Browser coverage exercises each invalidation class, focus movement, keyboard
  regeneration, duplicate-submit prevention, retained diff, disabled Apply, successful regeneration,
  exact selected subset/config request, safe text rendering, and a 320-CSS-pixel viewport.

#### T15 — Prove bundled contract fidelity — **Sequential**

- **Files**:
  - `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`
- **Action**: Extend portable-contract assertions for documented `sectionConfigs`, the closed reason
  enum, required invalidation fields, nullable warning, response statuses, and matching app/package
  generated artifacts.
- **Dependencies**: T04 and T13.
- **Validation**: Contract tests reject undocumented runtime fields, missing codes, or divergence
  between OpenAPI, generated declarations, handler responses, and portable package output.

### Phase 5: Documentation, quality gates, and delivery lifecycle

#### T16 — Document the reviewed validation phase and delivery — **Sequential**

- **Files**:
  - `docs/site/src/content/docs/app/sync-pipeline.md`
  - `ROADMAP.md`
- **Action**: Document private ephemeral binding, exact reviewed scope/config, atomic selected claims,
  separate PCD/Arr revalidation, zero-write invalidation, explicit Arr dispatch, regeneration UX,
  residual external-writer race, and issue #234 delivery in existing roadmap style. Distinguish
  reviewed-plan authorization from issue #232 confirmed outcomes and do not claim merge before merge.
- **Dependencies**: T14 and T15.
- **Validation**: Docs match implemented ordering and API terms; no durable persistence, upstream
  atomicity, automatic retry, or sibling compatibility is claimed.

#### T17 — Run repository and graph quality gates — **Sequential**

- **Files**: `graphify-out/**` only if `graphify update .` changes generated graph artifacts.
- **Action**: Format scoped changes, rerun deterministic generation, execute focused tests followed
  by broad static/runtime/browser gates, inspect all diffs, and refresh Graphify after source edits.
- **Dependencies**: T12 and T14-T16.
- **Validation sequence**:
  1. `deno task format:plans` and repository-scoped formatting; inspect unintended changes.
  2. `deno task generate:api-types`; `deno task bundle:api`; rerun both and require deterministic output.
  3. Focused binding/store/claim/syncer/reviewed-executor/route/contract tests.
  4. Existing sync preview, sync outcome, sync history, version-gate, Lidarr, drift, and MCP preview regressions.
  5. `deno task check`.
  6. `deno task lint`.
  7. The reviewed-plan Playwright spec, then the repository-required E2E scope.
  8. `deno task test`.
  9. `deno task check:dist-paths` and `git diff --check`.
  10. `graphify update .`, followed by graph/status inspection.
- **Failure rule**: Fix the owning task, rerun its focused proof, then rerun all downstream gates; do
  not treat a narrow pass as evidence for the broad zero-write or cross-Arr requirement.

#### T18 — Publish the issue-closing PR — **Sequential**

- **Files**: none beyond the validated implementation and required plan/design artifacts.
- **Action**: Audit the full changed-file set, stage intended source/tests/docs/generated files,
  create conventional commit(s), push `feat/issue-234-reviewed-sync-plan`, and create the PR against
  the real default branch using the repository PR template via `--body-file`. Include `Closes #234`,
  design/plan links, security/Arr checklist results, and validation evidence.
- **Dependencies**: T17.
- **Validation**: PR title/body/template/base/issue linkage are correct and the remote diff matches
  the validated local branch.

#### T19 — Perform formal review and apply fixes — **Sequential**

- **Files**: formal review artifact and fix report under the repository-selected
  `docs/prps/reviews/` paths; source/test files retain their original task ownership.
- **Action**: Review the actual PR for correctness, security, cross-Arr semantics, contract fidelity,
  concurrency/TOCTOU, private-evidence leakage, accessibility, and test adequacy. Apply every accepted
  finding through the proper review-fix workflow, update finding statuses in place, commit/push fixes,
  and rerun affected focused plus downstream broad gates.
- **Dependencies**: T18.
- **Validation**: No open accepted finding remains, every fix is evidenced, unresolved actionable PR
  threads are zero, and the PR head contains the review fixes.

#### T20 — Monitor, squash merge, and clean up — **Sequential**

- **Files**: none.
- **Action**: Monitor all required GitHub checks to green, distinguish external review latency from
  code failures, repair genuine CI failures and repeat review if material code changes, then squash
  merge. Confirm issue #234 closes, remove the remote feature branch, remove the issue worktree, prune
  stale worktree metadata/remotes, and delete the local feature branch from the primary checkout.
- **Dependencies**: T19.
- **Validation**: PR is merged by squash, required checks are green at the merged head, issue #234 is
  closed, the default branch contains the squash commit, no local/remote
  `feat/issue-234-reviewed-sync-plan` remains, and
  `/home/yandy/Projects/github.com/yandy-r/praxrr-issue-234` is no longer registered as a worktree.

## Task Granularity Recommendations

- Keep the pure binding (T02), private store (T05), claim transaction (T03), and reviewed executor
  (T11) separate. They encode different atomicity boundaries and need independently falsifiable tests.
- Give each concrete syncer its own task (T07-T10). Evidence completeness is domain-specific, and a
  combined four-syncer task would be too large to review or prove against the cross-Arr policy.
- Keep production and its focused test together except where an existing broad regression suite is a
  deliberate downstream join point (T12 and T15).
- Treat `reviewBinding.ts` as the only owner of hashing/canonical comparison. Syncers should emit
  explicit evidence projections, not implement section-local hashing algorithms.
- Treat `arrSync.ts` as the reviewed first-write choke point and `arrSyncQueries` as the claim
  primitive owner. Do not distribute reviewed orchestration across route and syncers.
- Keep contract source (T01) separate from generated output (T04); generated files are mechanical and
  must not conceal design edits.
- Keep route mapping (T13) separate from UI recovery (T14), so server zero-write guarantees can be
  proved without a browser and browser behavior can use deterministic intercepted responses.
- Do not split small same-file edits across tasks. In particular, all changes to each large concrete
  syncer belong to its one evidence/config task to avoid overlapping writers in the single worktree.

## Dependency Analysis

The dependency graph is:

```text
T00
├── T01 -> T04 -------------------------------┐
├── T02 -> T05 -> T06 -> T07 ─┐              │
│                        -> T08 ├-> T11 -> T12│
│                        -> T09 │             │
│                        -> T10 ┘             │
└── T03 --------------------------> T11       │
                              T04 + T05 + T11 -> T13
                                            T13 + T04 -> T14
                                            T13 + T04 -> T15
                                   T12 + T14 + T15 -> T16 -> T17
                                                               -> T18 -> T19 -> T20
```

- **Critical path**: T00 -> T02 -> T05 -> T06 -> longest concrete syncer task -> T11 -> T13 ->
  T14 -> T16 -> T17 -> T18 -> T19 -> T20.
- **Parallel wave 1**: T01, T02, and T03 are file-disjoint after T00.
- **Parallel wave 2**: T07-T10 are file-disjoint after T06. They share an interface but must not
  change T06-owned files; interface adjustments return to T06 before continuing.
- **Parallel wave 3**: T14 may proceed beside T15 after T13, with generated contract types already
  stable from T04.
- **Sequential joins**: T05, T06, T11, T13, and every delivery task are integration joins and should
  be performed one at a time in the single worktree.
- **No unsafe parallelism**: Do not run generators, formatters, broad tests, Graphify updates, commits,
  pushes, reviews, merge, or cleanup while any implementation task is editing the worktree.

## File-to-Task Mapping

| Task | Primary file ownership                                                                    |
| ---- | ----------------------------------------------------------------------------------------- |
| T01  | `docs/api/v1/schemas/sync.yaml`; `docs/api/v1/paths/sync.yaml`                            |
| T02  | `sync/preview/reviewBinding.ts`; `tests/base/syncPreviewReviewBinding.test.ts`            |
| T03  | `db/queries/arrSync.ts`; `tests/jobs/reviewedSyncClaims.test.ts`                          |
| T04  | generated app declarations; portable `openapi.json`; portable `types.ts`                  |
| T05  | `sync/preview/store.ts`; `tests/base/syncPreviewStore.test.ts`                            |
| T06  | `sync/base.ts`; `sync/preview/orchestrator.ts`; `sync/preview/types.ts`                   |
| T07  | `sync/qualityProfiles/syncer.ts`; `tests/sync/qualityProfilesSyncer.test.ts`              |
| T08  | `sync/delayProfiles/syncer.ts`; `tests/sync/delayProfilesSyncer.test.ts`                  |
| T09  | `sync/mediaManagement/syncer.ts`; `tests/sync/mediaManagementSyncer.test.ts`              |
| T10  | `sync/metadataProfiles/syncer.ts`; `tests/jobs/lidarrMetadataProfilesSync.test.ts`        |
| T11  | `jobs/handlers/arrSync.ts`; `tests/jobs/reviewedSyncExecution.test.ts`                    |
| T12  | `tests/sync/syncEntityOutcomes.test.ts`; `tests/jobs/arrSyncVersionGate.test.ts`          |
| T13  | preview create route; preview apply route; `tests/base/syncPreviewRouteHardening.test.ts` |
| T14  | `SyncPreviewTrigger.svelte`; `SyncPreviewPanel.svelte`; reviewed-plan E2E spec            |
| T15  | `tests/base/bundleApiContract.test.ts`                                                    |
| T16  | site `sync-pipeline.md`; `ROADMAP.md`                                                     |
| T17  | `graphify-out/**` only when regenerated                                                   |
| T19  | formal review artifact and fix report paths chosen by the review workflow                 |

Files named in `shared.md` but not mapped for modification are read/validation dependencies:
`preview/diff.ts`, `preview/sectionDiffs.ts`, `sync/mappings.ts`, `sync/registry.ts`,
`db/queries/arrInstances.ts`, `pcd/snapshots/fingerprint.ts`, architecture/development/testing docs,
and API package READMEs. Modify one only if implementation evidence proves a required change; if so,
add a dedicated task or explicitly expand the nearest owner task before editing.

## Optimization Opportunities

- Run T01, T02, and T03 concurrently only with strict file ownership; they have no source overlap.
- After T06 freezes the recorder interface, fan out T07-T10. This is the largest safe latency
  reduction and keeps domain review manageable.
- Start pure tests before integration: binding mutation tests and claim transaction tests can expose
  design errors before expensive Arr/syncer fixtures are wired.
- Reuse one explicit Arr client/cache for revalidation and keep the established section order. Avoid
  parallel Arr reads unless existing client/domain semantics prove they are independent; correctness
  and rate predictability are more important than shaving the bounded preview pass.
- Hash explicit normalized projections once per evidence class and section. Do not hash whole raw
  upstream payloads, repeat canonicalization in the route, or recompute public summaries as evidence.
- Use dependency-injected clock, executor, evidence source, and write-side spies so TTL/concurrency/
  zero-write tests remain deterministic and fast.
- Run focused tests immediately after each task, but defer full check/lint/E2E/generation determinism
  and Graphify to T17 when all writers have stopped.
- Preserve ordinary executor code paths and extract only the minimum shared internal function needed
  by T11. This limits regression scope for scheduler, canary, drift, history, and MCP callers.

## Implementation Strategy Recommendations

1. Work only in the specified issue worktree and branch. Before each task, confirm the owned files
   have not changed unexpectedly; after it, inspect the scoped diff and run the task's focused proof.
2. Implement contract and pure invariants before wiring. The API error taxonomy, binding version,
   canonical evidence model, and atomic claims are the foundation; routes must not invent them.
3. Capture evidence beside authoritative reads and transformations. Every field that can change a
   target, payload, action, mapping, namespace, or capability decision must be represented; exclude
   only demonstrated volatile/write-irrelevant data.
4. Maintain three independent hashes per selected section: PCD/config, live Arr, and material plan.
   Never use summary counts as authorization, never infer equality when evidence is missing, and never
   let drift in an unselected section block an exact selected subset.
5. Enforce the first-write boundary literally. All selected section claims and revalidation must
   finish before snapshot creation, history recording, confirmed outcomes, or any Arr mutation. A
   failure in the last selected section must still prove zero writes in the first.
6. Thread the exact normalized reviewed `sectionConfigs` into both revalidation and existing writers,
   clear them in `finally`, and keep normal unreviewed execution unchanged.
7. Validate Arr semantics independently for Radarr, Sonarr, and Lidarr: API inputs, field mappings,
   read/write dispatch, version/capability gates, and metadata-profile restrictions. No shared API
   shape is proof of semantic parity.
8. Keep private evidence private. GET and create responses expose only existing public preview data;
   logs and typed responses expose bounded safe codes/sections, never raw PCD/Arr/config evidence.
9. Complete the full delivery lifecycle: deterministic generation, focused and broad tests, docs and
   roadmap, Graphify update, template-derived issue-closing PR, formal review, fixes, green CI, squash
   merge, and verified local/remote branch plus worktree cleanup.
