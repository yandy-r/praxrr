# Task Structure Analysis: Transparent Automation Engine

## Executive Summary

Implement the feature in dependency-safe batches: establish truthful contracts and pure
emitters first, integrate independent UI/server surfaces second, then close the exhaustive
audit, follow-up issues, ROADMAP, graph, and validation. Tasks should own one to three files;
the narration files must have one sequential owner because template/version conflicts would
make parallel edits unsafe.

## Recommended Phase Structure

- **Phase 0: Closure prerequisites** — create the two prerequisite follow-up issues from
  repository templates and capture their URLs. No code dependency.
- **Phase 1: Pure foundations and contracts** — narration v2, bounded goal metadata,
  audit registry, and the coarse preview-apply OpenAPI correction. These are parallel
  except for the two narration tasks.
- **Phase 2: Surface integration** — Sync Preview, Goals apply logging, and Resolved Config
  contextual provenance. Separate file ownership allows parallel work.
- **Phase 3: Audit disposition and tracking** — verify every queued/direct workflow,
  create issues for remaining gaps, update ROADMAP and issue #21.
- **Phase 4: Validation and graph** — focused/full tests, contract generation checks,
  `graphify update .`, adversarial review, and fix loop.

## Task Granularity

Each implementation task owns one coherent contract or surface and no more than three
files. Generated API artifacts are a separate mechanical task. Documentation/tracking
tasks do not share ownership with code tasks. Avoid parallel edits to:

- `$shared/narration/{types,templates,narrate,index}.ts`;
- `SyncPreviewPanel.svelte`;
- `docs/internal/automation-transparency-audit.md`;
- `ROADMAP.md`.

## Dependency Analysis

```text
F0 prerequisite issues ------------------------------------------┐
N1 narration contracts -> N2 narration emitters/tests -> U1 UI  |
A1 apply OpenAPI -> A2 generated/runtime contract -------> U1 UI|
G1 goal mapper/tests -------------------------------> G2 route   |-> C1 audit closure
J1 audit registry/tests -----------------------------------------|
R1 resolved-context UI ------------------------------------------┘

C1 audit closure -> F1 audit-gap issues -> D1 ROADMAP/issue update
all code/docs -> V1 validation -> V2 graph update -> V3 review/fix
```

There is no circular dependency. The audit can inventory workflows early, but final
dispositions wait for implementation evidence and follow-up URLs. Graph update runs after
the last code edit, and reruns if review fixes change code.

## Recommended Tasks

### Phase 0 — Follow-up Ownership

#### F0 — Create prerequisite follow-up issues

**Files:** none.

**Actions:**

1. Select the matching template under `.github/ISSUE_TEMPLATE/`; stop for direction if
   no matching template is clear.
2. Create a confirmed per-entity sync-outcomes issue requiring actual attempted action,
   entity identity, terminal outcome, remote ID, sanitized reason, Sync History/API/UI
   exposure, cross-Arr tests, and strict separation from preview intent.
3. Create an exact resolved-lineage issue requiring schema-default/base-op/tweaks-op/
   user-op attribution, nested paths, explicit-versus-default distinction, conflict/drop
   semantics, API/UI exposure, and tests.
4. Link both issues to #21 and retain their URLs for the audit/ROADMAP.

**Validation:** `gh issue view <number>` shows template structure, explicit acceptance
criteria, and #21 linkage.

### Phase 1 — Pure Foundations and Contracts

#### N1 — Narration v2 contracts and templates

**Owner files (3):**

- `packages/praxrr-app/src/lib/shared/narration/types.ts`
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`
- `packages/praxrr-app/src/lib/shared/narration/index.ts`

**Actions:** bump the single template version to `2`; add explicit section/summary/safe
error phrasing; export the new public functions/types. Preserve explicit `arrType` and
literal fallback.

**Validation:** `deno check` on the narration barrel; no second template-version constant.

#### N2 — Pure preview narrators and unit tests

**Depends on:** N1. Same owner as N1; run sequentially.

**Owner files (2):**

- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`

**Actions:** implement preview-summary, section-outcome, entity-list, and safe-error
narrators. Delegate entity phrasing to `narrateEntityChange`; read supplied totals and
section outcomes without re-tallying or error substring inference.

**Tests:** full/partial/failed/skipped/zero-change/focused-view fixtures, contradictory
visible rows versus authoritative summary, all Arr types, literal fallback, XSS-shaped
plain text, version stamp, and no completed-action wording.

#### G1 — Bounded Quality Goals decision metadata

**Owner files (2):**

- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts` (new)
- `packages/praxrr-app/src/tests/shared/goals/decisionLog.test.ts` (new)

**Actions:** create a pure allowlist mapper from the exact applied `GoalPlan`; cap decision
count/string length; record omitted and uncategorized counts; keep `engineVersion` and
`arrType`; exclude request bodies, URLs, SQL, credentials, and arbitrary payload fields.

**Tests:** exact reason arithmetic, ceiling/uncategorized cases, cap/omitted count,
secret-shaped nested strings, stable event class, and deterministic output.

#### J1 — Exhaustive queued-workflow audit registry

**Owner files (3):**

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts` (new)
- `packages/praxrr-app/src/tests/jobs/transparencyAudit.test.ts` (new)

**Actions:** expose a single runtime `JOB_TYPES` tuple and derive `JobType` from it; define
`TransparencyAuditEntry`; implement `satisfies Record<JobType, ...>` for every current
job. Entries record inputs, decisions, outputs, failure reasons, user surface,
disposition, and follow-up URL.

**Tests:** exact parity among `JOB_TYPES`, registry keys, and production handler
registrations; fail when a new job lacks an entry; validate follow-up disposition requires
a URL and `not-applicable` requires rationale.

#### A1 — Correct the coarse preview-apply source contract

**Owner files (2):**

- `docs/api/v1/schemas/sync.yaml`
- `docs/api/v1/paths/sync.yaml`

**Actions:** define/document the actual coarse response (`success`, run status/output/
optional error, nullable stale warning) and existing error statuses. Do not add
per-entity outcomes or describe planned entities as applied.

**Validation:** OpenAPI lint/bundle task succeeds before runtime edits begin.

### Phase 2 — Integration Batch

These tasks may run in parallel after their stated dependencies.

#### A2 — Regenerate and enforce apply response runtime contract

**Depends on:** A1.

**Owner files (3):**

- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`
- `packages/praxrr-app/src/lib/api/v1.d.ts`

Run the repository API bundle/type generators; do not hand-edit generated output. Validate
that the new apply response is present in all three artifacts.

#### A3 — Type the apply handler and test contract parity

**Depends on:** A2.

**Owner files (2):**

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`

Type every success/error response against generated schemas and add assertions for
success, skipped, failure, stale warning, and validation errors. Preserve current
execution behavior.

#### U1 — Narrated Sync Preview surface

**Depends on:** N2 and A2.

**Owner files (2):**

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`

**Actions:** add **Planned changes**, summary/verbose decision log, explicit partial
coverage, section failure/skip lines, per-entity narration, and one accessible
`aria-expanded` toggle. Keep raw diffs, staleness, destructive warning, and confirmation.
Show only coarse proven facts in **Apply result**; keep entity rows labeled planned.

**Validation:** `deno task check:client`; keyboard/disclosure inspection; no `{@html}`;
no whole-preview “up to date” state when any selected section lacks evidence.

#### G2 — Emit the Quality Goals decision event

**Depends on:** G1.

**Owner files (2):**

- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`
- `packages/praxrr-app/src/tests/routes/goalsRoutes.test.ts`

Emit one sanitized `QualityGoals` event only after scoring and binding persistence both
succeed. Tests assert no event on validation/version/write/binding failure, one event on
success, and metadata comes from the server plan rather than the request.

#### R1 — Evidence-backed Resolved Config explanation

**Owner files (1):**

- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`

Add contextual base/user/resolved definitions and truthful Base-side, User override,
User-created, Provenance unavailable, and pending-conflict language using existing layer
responses. Never render `database-default`; preserve stale-request guards and conflict
link.

**Validation:** `deno task check:client`; manually verify base-present, base-absent,
zero-override, nested override, and pending-conflict states.

### Phase 3 — Audit and Tracking

#### C1 — Complete the human automation-transparency audit

**Depends on:** F0, J1, U1, G2, R1, A3.

**Owner files (1):**

- `docs/internal/automation-transparency-audit.md` (new)

Document every queued job and material direct mutator (at minimum preview apply, Quality
Goals apply, rollback, and resolved computation). For each, cite authoritative inputs,
decisions, outputs, failure surface, user surface, disposition, evidence paths, and linked
follow-up. No unowned `Partial`/`Gap` is allowed.

#### F1 — Create audit-discovered gap issues

**Depends on:** C1 draft. **Files:** none.

Use matching repository issue templates. Each issue must name missing transparency
dimensions, authoritative data prerequisite, user surface, failure/edge cases, and
pass/fail tests. Insert URLs into the audit, then revalidate all dispositions.

#### D1 — Update project and issue tracking

**Depends on:** C1 and F1.

**Owner files (1):**

- `ROADMAP.md`

Record issue #21 completion scope, PR #213 foundation, this completion PR, and linked
prerequisite/audit-gap issues without claiming per-entity outcomes or default lineage.
Update issue #21's checklist/body through `gh` with the same links and accurate status.

### Phase 4 — Validation, Graph, and Review

#### V1 — Focused and full validation

**Files:** none unless fixes are required; fixes return to the owning task.

Run, in order:

1. narration, goal mapper, audit registry, Goals route, and sync-preview route tests;
2. API bundle/type generation diff check;
3. `deno task check`;
4. `deno task lint`;
5. `deno task test`;
6. docs markdown/prettier checks and `git diff --check`.

#### V2 — Refresh graphify output

**Depends on:** V1 code stability.

Run `graphify update .` from the feature worktree. Treat `graphify-out/**` as generated
ownership for this task only; inspect generated changes and do not mix manual edits. Rerun
after any review fix that changes code relationships.

#### V3 — Adversarial review and fix loop

Review the full diff for planned-versus-confirmed wording, cross-Arr fallback, secret/log
bounds, API lockstep, XSS, provenance overclaim, audit completeness, and ROADMAP/issue
truthfulness. Apply findings through the original file owner, rerun affected focused tests,
then repeat V1 and V2.

## Parallel Batch Plan

| Batch | Tasks                    | Parallel rule                                                                      |
| ----- | ------------------------ | ---------------------------------------------------------------------------------- |
| 0     | F0                       | External issue creation; can overlap local foundations after template is confirmed |
| 1     | N1 -> N2, G1, J1, A1, R1 | Narration sequential under one owner; all other columns independent                |
| 2     | A2 -> A3, U1, G2         | U1 waits for N2/A2; Goals is independent; generated artifacts single owner         |
| 3     | C1 -> F1 -> D1           | Sequential because issue URLs feed audit and tracking                              |
| 4     | V1 -> V2 -> V3 -> rerun  | Global integration gate                                                            |

## File-to-Task Mapping

- `$shared/narration/types.ts`, `templates.ts`, `index.ts`: N1 only.
- `$shared/narration/narrate.ts`, narration tests: N2 only.
- sync OpenAPI source: A1 only; generated API artifacts: A2 only.
- preview apply handler/test: A3 only.
- Sync Preview Svelte components: U1 only.
- Goals decision mapper/test: G1 only; apply route/test: G2 only.
- `queueTypes.ts`, audit registry/test: J1 only.
- `ResolvedStatePanel.svelte`: R1 only.
- internal audit document: C1/F1 serial ownership.
- `ROADMAP.md`: D1 only.
- `graphify-out/**`: V2 generated ownership only.

## Completion Gate

The implementation is not complete until every feature-spec success criterion has direct
evidence, every audit row is Pass/Not Applicable/linked Follow-up, both prerequisite
issues exist with explicit acceptance criteria, OpenAPI/runtime/generated types agree,
all validation passes, graphify is current, ROADMAP and issue #21 are accurate, and review
findings are fixed.
