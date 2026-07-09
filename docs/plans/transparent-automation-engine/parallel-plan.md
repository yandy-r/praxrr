# Transparent Automation Engine Completion Implementation Plan

Complete issue #21 by extending the existing pure narration engine into Sync
Preview, recording the exact applied Quality Goals rationale through bounded
sanitized metadata, explaining only proven Resolved Config provenance, and
making queued-workflow transparency coverage exhaustive. The change also
corrects the preview-apply portable contract, creates prerequisite and audit-gap
follow-ups with explicit acceptance criteria, and updates ROADMAP/issue tracking
without claiming missing evidence was implemented. Planned preview records
remain distinct from confirmed results, all cross-Arr semantics use explicit
`arrType`, and no new runtime dependency or database table is introduced.

## Worktree Setup

- **Parent**: ~/.claude-worktrees/praxrr-transparent-automation-engine/ (branch:
  feat/transparent-automation-engine)

## Critically Relevant Files and Documentation

- `CLAUDE.md`: project conventions, portable contract fidelity, and cross-Arr
  guardrails.
- `docs/plans/transparent-automation-engine/feature-spec.md`: binding design,
  scope, risks, and acceptance criteria.
- `docs/plans/transparent-automation-engine/shared.md`: verified architecture,
  files, patterns, and required reading.
- `docs/plans/issue-21/design.md`: foundation architecture and historical final
  scope.
- `docs/plans/issue-21/design-critique.md`: accepted constraints on error
  narration and core delegation.
- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`: existing pure
  narration core.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: authoritative
  planned-change contracts.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`:
  preview host surface.
- `packages/praxrr-app/src/lib/shared/goals/types.ts`: canonical GoalPlan and
  GoalReason contracts.
- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`: mandatory
  metadata redaction boundary.
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`: proven
  base-versus-user evidence.
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: closed
  queued-workflow inventory.
- `docs/api/v1/paths/sync.yaml`: portable preview-apply path contract.
- `.github/ISSUE_TEMPLATE/engineering-task.yml`: required follow-up issue
  structure.
- `.github/PULL_REQUEST_TEMPLATE.md`: required PR body structure.

## Implementation Plan

### Phase 0: Establish Follow-up Ownership

#### Task 0.1: Create prerequisite evidence-contract issues Depends on [none]

**READ THESE BEFORE TASK**

- `.github/ISSUE_TEMPLATE/engineering-task.yml`
- `docs/plans/transparent-automation-engine/feature-spec.md`
- `packages/praxrr-app/src/lib/server/sync/types.ts`
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`

**Instructions**

Use `gh issue create --template engineering-task.yml` (or a template-derived
body file accepted by GitHub) to create exactly two linked engineering tasks:

1. Confirmed per-entity post-apply outcomes: actual attempted action, stable
   entity identity, remote ID, terminal status, sanitized reason, explicit
   `arrType`, apply API and Sync History exposure, UI narration for
   success/partial/failure/skip, and tests proving preview intent is never
   confirmation.
2. Exact schema/default/base/tweaks/user lineage: nested field paths,
   explicit-versus-implicit default distinction, last establishing op/source,
   dropped/conflicted/pending semantics, portable API/UI exposure, and tests
   that reject absence-based inference.

Preserve every template section, link both issues to #21, and record their URLs
in the task result for later audit and ROADMAP work. Do not create a free-form
issue.

### Phase 1: Pure Foundations and Portable Contract

#### Task 1.1: Define narration v2 contracts and templates Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/shared/narration/types.ts`
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- `docs/plans/issue-21/design-critique.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/shared/narration/types.ts`
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`

Bump the single narration template version to `2`. Add section labels and safe
phrasing needed for planned summary, preview-generation coverage/skips/failures,
and generic error framing. `SyncPreviewSectionOutcome` describes preview
generation coverage, never apply execution success. Keep all sync imports
type-only and literal fallback for unknown Arr labels; do not create a generic
template framework or second version constant.

#### Task 1.2: Implement and test pure preview narration Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`
- `packages/praxrr-app/src/lib/shared/narration/index.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`
- `packages/praxrr-app/src/lib/shared/narration/index.ts`

Add pure narrators for the authoritative `SyncPreviewSummary`, one
`SyncPreviewSectionOutcome`, a list of `EntityChange`s, and free-form error
framing. Entity-list narration must delegate to `narrateEntityChange`; summary
counts must be read verbatim rather than re-tallied. Use planned tense for
entity actions, describe section outcomes only as preview-generation
coverage/skips/failures, preserve incomplete coverage, never substring-classify
errors, and stamp every line with version `2`. Add focused cases for zero/mixed
counts, contradictory visible rows versus supplied totals, all section outcomes,
all Arr types, literal fallback, XSS-shaped text, summary/verbose, and the
absence of completed-action wording. Export the new narrators from the barrel
only after their implementations exist.

#### Task 1.3: Build bounded Quality Goals decision metadata Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/shared/goals/types.ts`
- `packages/praxrr-app/src/lib/server/goals/responses.ts`
- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`
- `docs/internal-docs/quality-goals/design.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts`
- `packages/praxrr-app/src/tests/shared/goals/decisionLog.test.ts`

Implement a deterministic pure allowlist mapper from the exact server
`GoalPlan`. Include stable event name, database/profile target, explicit Arr
type, preset, engine version, coverage, thresholds, bounded decisions with their
structured reasons, uncategorized count, and omitted-decision count. Cap
decision entries and identifier lengths; exclude raw request bodies, URLs,
credentials, SQL, regex bodies, and arbitrary config values. Tests must cover
exact score/reason preservation, ceiling and uncategorized cases,
caps/truncation, secret-shaped nested values passed through the existing
sanitizer, and stable deterministic output.

#### Task 1.4: Add an exhaustive queued-workflow transparency registry Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- `packages/praxrr-app/src/lib/server/jobs/queueRegistry.ts`
- `packages/praxrr-app/src/lib/shared/arr/parity.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts`
- `packages/praxrr-app/src/tests/jobs/transparencyAudit.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`

Export one `JOB_TYPES` tuple and derive `JobType` from it without changing the
union's values. Define an evidence-oriented audit entry (inputs, decisions,
outputs, failures, user surface, disposition, rationale, follow-up URL) and
populate it with `satisfies Record<JobType, ...>` for every current job. Tests
must prove exact parity among `JOB_TYPES`, audit keys, and production handler
registrations. Import
`packages/praxrr-app/src/lib/server/jobs/handlers/index.ts` once so production
registration side effects populate `jobQueueRegistry`, then compare
`jobQueueRegistry.getAll()` without initializing the dispatcher, scheduler, or
database. Also enforce that a follow-up has a URL while not-applicable has
rationale. Do not turn the registry into a runtime scoring or execution service.

#### Task 1.5: Correct the preview-apply portable response contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`

**Instructions**

Files to Modify

- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`

Define a reusable response schema matching the actual coarse runtime result:
overall `success`, job `status`, output, optional sanitized error, and nullable
stale warning. Reference it from the 200 response and document that the route
executes selected sections afresh and does not provide per-entity confirmation.
Keep all existing error statuses and portable schema/runtime fidelity; do not
add fictional entity outcomes.

#### Task 1.6: Add evidence-backed Resolved Config explanations Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`
- `docs/plans/resolved-config-viewer/feature-spec.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`

Files to Create

- `packages/praxrr-app/src/lib/shared/pcd/resolvedProvenance.ts`
- `packages/praxrr-app/src/tests/shared/pcd/resolvedProvenance.test.ts`

Add a pure helper that maps existing layer/diff/conflict evidence to base-side,
user override, user-created, provenance unavailable, and pending-conflict
ambiguity, then render its result in the panel. Cover base-present, base-absent,
zero/nested overrides, and pending conflict with focused tests. Preserve
stale-request guards, raw values/diffs, and conflict links. Never render a
database-default or exact-op claim, and do not add an extra replay per field.

### Phase 2: Integrate Generated Contract and User/Server Surfaces

#### Task 2.1: Regenerate portable API artifacts Depends on [1.5]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/bundle-api.ts`
- `packages/praxrr-api/README.md`

**Instructions**

Files to Modify

- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`
- `packages/praxrr-app/src/lib/api/v1.d.ts`

Run the repository `bundle:api` and `generate:api-types` tasks rather than
hand-editing generated files. Verify the preview-apply response is present and
equivalent in the modular source, bundled package, and app type declarations.

#### Task 2.2: Type and test preview-apply runtime parity Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`
- `packages/praxrr-app/src/lib/api/v1.d.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`

Type the success/failure bodies against generated schema aliases and assert
contract parity for success, skipped, failed, stale-warning, malformed,
ineligible, and stale-blocked cases. Preserve runtime execution semantics and
errors; this task is contract hardening only.

#### Task 2.3: Integrate narrated Sync Preview UX Depends on [1.2, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`
- `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte`
- `packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`

Add a visible **Planned changes** decision log, one surface-wide summary/verbose
toggle with `aria-expanded`, complete-versus-partial coverage, section
skip/failure lines, and per-entity narration above existing raw field tables.
Pass explicit `arrType`, section, and level to entity rows. Preserve staleness,
destructive warning/typed confirmation, focused-section behavior, raw
current/desired values, and request race guards. Keep immediate execution
evidence under separate **Apply result** copy and never restyle planned entities
as confirmed successes. Avoid `{@html}` and duplicate live-region announcements.

#### Task 2.4: Emit the post-success Quality Goals decision event Depends on [1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`
- `packages/praxrr-app/src/tests/routes/goalsRoutes.test.ts`
- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`
- `packages/praxrr-app/src/tests/routes/goalsRoutes.test.ts`

Build metadata from the exact recomputed server plan and emit one `QualityGoals`
logger event only after both scoring persistence and binding upsert succeed.
Tests must assert one event on success and no event on validation, stale engine,
scoring, or binding failure; prove metadata derives from server decisions, not
client-authored prose or request objects.

### Phase 3: Audit, Follow-up Disposition, and Tracking

#### Task 3.1: Write the complete automation-transparency audit Depends on [0.1, 1.4, 1.6, 2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts`
- `packages/praxrr-app/src/lib/server/jobs/display.ts`
- `packages/praxrr-app/src/routes/settings/jobs/+page.svelte`
- `docs/plans/transparent-automation-engine/feature-spec.md`

**Instructions**

Files to Create

- `docs/internal-docs/automation-transparency-audit.md`

Document every queued job and these minimum direct workflows: sync-preview
create/apply, Quality Goals preview/apply, snapshot create/rollback,
resolved-config layer read/live diff, drift settings/manual check, canary
start/promote/abort, and TRaSH Guide manual sync. Use the deterministic
discovery gate
`rg -n "executeSyncJob|enqueue|updateScoring|rollback|manual.*sync|promote|abort" packages/praxrr-app/src/routes packages/praxrr-app/src/lib/server`
to identify any additional direct mutator and either add it or document why it
is not automation. For each stable ID, cite authoritative inputs,
decisions/skips, outputs and their granularity, sanitized failure/recovery
surface, user evidence surface, code/test paths, and a disposition of Pass, Not
Applicable with rationale, or a draft Follow-up gap label. Keep planned versus
actual limits visible. This task produces the complete evidence matrix and gap
list; Task 3.2 creates real issue URLs and finalizes every draft follow-up.

#### Task 3.2: Create targeted audit-gap follow-up issues Depends on [3.1]

**READ THESE BEFORE TASK**

- `.github/ISSUE_TEMPLATE/engineering-task.yml`
- `docs/internal-docs/automation-transparency-audit.md`

**Instructions**

Files to Modify

- `docs/internal-docs/automation-transparency-audit.md`

For every coherent audit gap not already owned by the two prerequisite issues,
create a templated engineering issue. Each must name the missing transparency
dimensions, authoritative data prerequisite, user surface, edge/failure cases,
and exact regression checks. Insert the resulting URLs into the audit and
revalidate that every queued/direct row is Pass, Not Applicable, or linked. Do
not create a vague umbrella issue and do not invent labels.

#### Task 3.3: Update ROADMAP and issue #21 tracking Depends on [3.2]

**READ THESE BEFORE TASK**

- `ROADMAP.md`
- `docs/internal-docs/automation-transparency-audit.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

**Instructions**

Files to Modify

- `ROADMAP.md`

Update the roadmap history and P3 row with the implemented completion slice,
[PR #213](https://github.com/yandy-r/praxrr/pull/213) foundation, and all real follow-up issue numbers without claiming
per-entity outcomes or exact default lineage shipped. Leave the completion PR
reference as a clearly marked pending link for Task 5.1 because no PR number
exists yet. Patch issue #21 through `gh` using a body file derived from its
existing body: mark implemented checklist items, link moved follow-ups with
their explicit criteria, and retain the closure rule. Keep issue, roadmap,
audit, and planned PR language identical.

### Phase 4: Validation and Graph Refresh

#### Task 4.1: Run focused and full validation Depends on [3.3]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/test.ts`
- `docs/plans/transparent-automation-engine/feature-spec.md`

**Instructions**

Run focused narration, goal decision mapper, audit registry, Goals route,
sync-preview route, and relevant resolved tests first. Then run
`deno task bundle:api`, `deno task generate:api-types`,
`deno task check:server`, `deno task check:client`, `deno task lint`,
`deno task test`,
`npx markdownlint-cli "**/*.md" --ignore-path .markdownlintignore`,
`npx prettier --check "**/*.{md,mdx,json,jsonc,yaml,yml}" --ignore-path .prettierignore`,
and `git diff --check`. This task is validation-only: report failures to the
task that owns the affected files, have that owner fix them, then rerun the
affected gates. Search for contradictory completed-action or database-default
claims and verify all audit follow-up URLs resolve.

#### Task 4.2: Refresh and verify graphify output Depends on [4.1]

**READ THESE BEFORE TASK**

- `/home/yandy/Projects/github.com/yandy-r/praxrr/graphify-out/graph.json`
- `docs/plans/transparent-automation-engine/parallel-plan.md`

**Instructions**

The canonical untracked graph currently exists only in the main checkout. From
the feature worktree, initialize a local graph with `graphify . --no-viz`, then
run the required incremental refresh with `graphify update .` after code
stability. Query it with
`graphify query "How does Transparent Automation connect narration, sync preview, Quality Goals, Resolved Config provenance, and the job audit?"`.
Treat `graphify-out/**` as local verification output only: inspect it, never
manually edit it, and explicitly exclude it from staging/PR content. Rerun
`graphify update .` after any review fix that changes code relationships.

### Phase 5: Publish, Review, Merge, and Cleanup

#### Task 5.1: Commit, push, and create the templated PR Depends on [4.2]

**READ THESE BEFORE TASK**

- `.github/PULL_REQUEST_TEMPLATE.md`
- `ROADMAP.md`
- `docs/internal-docs/automation-transparency-audit.md`

**Instructions**

Files to Modify

- `ROADMAP.md`

Confirm the diff contains only issue #21 work, stage all intended files, create
conventional commits, and push `feat/transparent-automation-engine` to `origin`.
Create the PR with `gh pr create --body-file` from the repository template, a
conventional title, `Closes #21`, all follow-up links, exact validation
evidence, and the cross-Arr checklist. After the PR number exists, replace
ROADMAP's pending completion-PR reference, commit/push that tracking update, and
patch issue #21 with the same PR link. Verify the PR head/base, template
sections, closing linkage, and changed-file set.

#### Task 5.2: Run and publish a formal PR review Depends on [5.1]

**READ THESE BEFORE TASK**

- `docs/plans/transparent-automation-engine/feature-spec.md`
- `docs/internal-docs/automation-transparency-audit.md`

**Instructions**

Files to Create

- `docs/prps/reviews/pr-<N>-review.md`

Run the PR-mode code-review workflow with three independent reviewers for
correctness/type safety, security/performance, and pattern/maintainability. Read
every changed file in full, run project validation, write the machine-parseable
`docs/prps/reviews/pr-<N>-review.md` artifact with stable finding IDs/status,
commit/push it, and publish a GitHub COMMENT review unless an independent
reviewer is available to approve (the PR author cannot self-approve). Gate on
the review artifact, validation, and finding disposition rather than an
impossible self-approval. Review specifically for planned-versus-confirmed
truth, cross-Arr semantics, XSS, log bounding/redaction, provenance precision,
contract lockstep, and audit completeness.

#### Task 5.3: Fix all review findings and re-review Depends on [5.2]

**READ THESE BEFORE TASK**

- `docs/prps/reviews/pr-<N>-review.md`

**Instructions**

Files to Create

- `docs/prps/reviews/fixes/pr-<N>-fixes.md` (only when findings require fixes)

If findings exist, run the review-fix workflow through every eligible finding,
update Status in place, write/commit/push the fix report, rerun focused and full
validation, refresh graphify after code fixes, and run a fresh PR review until
no Critical/High issue or validation failure remains. If no findings exist,
record that no fix run was necessary and preserve the zero-finding review
artifact as evidence. Fetch all top-level PR comments, file-level review
comments, inline comments, and review threads from humans and bots. Fix
actionable feedback or reply with a concrete skip rationale, resolve eligible
threads, and prove zero unresolved actionable threads before continuing.

#### Task 5.4: Monitor and repair CI until green Depends on [5.3]

**READ THESE BEFORE TASK**

- `.github/workflows/lint.yml`

**Instructions**

Monitor the PR status rollup and GitHub Actions checks until every required
check is successful or legitimately skipped. For an actionable failure, inspect
Actions logs, implement the focused fix in the feature worktree, validate,
commit, push, rerun review if code changed, and continue monitoring. Never
force-push or bypass hooks; distinguish external review latency from code
failure. On every CI iteration, also re-fetch review comments and unresolved
threads; new actionable feedback must return to Task 5.3 before merge.

#### Task 5.5: Squash merge, cleanup, and complete the final audit Depends on [5.4]

**READ THESE BEFORE TASK**

- `docs/internal-docs/automation-transparency-audit.md`
- `ROADMAP.md`

**Instructions**

Verify the PR is reviewed, required CI is green, issue linkage is correct, and
all follow-up URLs resolve. Squash merge the PR, confirm issue #21 is closed or
update it consistently with the merged linkage, update/fetch main, remove the
feature worktree, delete the local and remote feature branches (or verify GitHub
already deleted the remote), and prune stale refs. Perform a
requirement-by-requirement audit proving design, plan, implementation, tests,
ROADMAP, PR, review/fix disposition, green CI, squash merge, follow-up
ownership, branch/worktree cleanup, and a clean synchronized main checkout.

## Advice

- The strongest correctness invariant is epistemic: planned `EntityChange`
  records cannot become confirmed entity results through wording, CSS, or a
  successful section count.
- Keep all narration files under one implementor owner; the version constant and
  shared phrasing make parallel edits conflict-prone.
- Emit the Goals event after both writes succeed. Logging earlier creates a
  durable false statement even when the route ultimately fails.
- `base` combines schema, base, and tweaks replay. Use **Base-side** language
  and leave `database-default` unused until the lineage follow-up lands.
- The typed audit closes queued-job drift; the checked human document is still
  required for direct mutators outside `JobType`.
- If the API contract changes, modular YAML, bundled package output, generated
  app types, route responses, and tests must move together.
- The existing feature worktree already satisfies the single-worktree contract;
  every implementor must use it directly and avoid destructive git commands.
