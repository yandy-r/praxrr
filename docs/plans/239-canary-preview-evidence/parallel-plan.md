# Canary Remaining-Target Preview Evidence Implementation Plan

Issue #239 replaces Canary's exception-to-empty remaining preview with durable,
explicit evidence that survives redirect and reload. A versioned
`available`/`unavailable` union will be stored on `canary_rollouts`, strictly
decoded against the exact persisted same-Arr target set, exposed by start/detail
contracts, and enforced by Proceed before the existing state-token transition
can enqueue work. Confirmed canary Sync History, selection, batching, execution,
and Abort-without-rollback stay unchanged. Implementation proceeds through a
small contract/persistence spine, then parallel API/UI surfaces, followed by
generated artifacts and full verification.

## Worktree Setup

- **Parent**: ~/.claude-worktrees/praxrr-239-canary-preview-evidence/ (branch:
  feat/239-canary-preview-evidence)

## Critically Relevant Files and Documentation

- `docs/plans/239-canary-preview-evidence/feature-spec.md`: Selected version-1
  evidence and UX contract.
- `docs/plans/239-canary-preview-evidence/shared.md`: Verified architecture,
  files, tables, and patterns.
- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`: Runtime
  rollout/evidence contract spine.
- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`: Evidence
  construction and promotion policy.
- `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`: Typed
  route-mappable coordinator errors.
- `packages/praxrr-app/src/lib/server/sync/canary/selection.ts`: Exact same-Arr
  cohort source to preserve.
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`: Closed
  safe failure classifier to reuse.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`:
  `GeneratePreviewResult` and section failures.
- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`: Strict
  persistence and guarded transitions.
- `packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts`:
  Baseline Canary schema.
- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`: Reloadable
  verification gate UI.
- `docs/api/v1/schemas/canary.yaml`: Portable contract source.
- `docs/api/v1/paths/canary.yaml`: Endpoint behavior source.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`: Safe
  failure/non-leak patterns.
- `docs/internal-docs/automation-transparency-audit.md`: Originating
  direct-canary evidence gap.
- `docs/plans/canary-sync-blast-radius/design.md`: Original state/token/Abort
  architecture to preserve.
- GitHub issue #239: Authoritative scope, exclusions, acceptance criteria, and
  minimum tests.

## Implementation Plan

### Phase 1: Contract and Persistence Foundation

#### Task 1.1: Define the versioned runtime evidence contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/239-canary-preview-evidence/feature-spec.md`
- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`
- `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`
- `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`

Add the exact version-1 `CanaryRemainingPreviewEvidence` union selected in the
feature spec: available carries `generatedAt` and `previews`; unavailable
carries `generatedAt`, a shared `SyncPreviewFailureReason`, and diagnostic
`partialPreviews`. Add the raw nullable SQLite column to `CanaryRolloutRow`, add
required decoded evidence to `CanaryRolloutDetail`, and remove the gated start
arm's separate transient array so its rollout is the single evidence source. Add
a typed preview-unavailable error/predicate for safe 409 mapping. Keep the
`skipped: true` arm, lifecycle unions, exact Arr types, and Abort errors
unchanged; do not add a failure taxonomy or dependency.

#### Task 1.2: Add and verify the nullable evidence migration Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260720_add_sync_history_entity_outcomes.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260723_add_canary_preview_evidence.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`

Add `remaining_preview_evidence TEXT` as a nullable column on `canary_rollouts`,
register migration version `20260722` immediately after `20260721`, and extend
the real migration-chain test to prove the column exists, new/legacy rows
default to null, ordering is correct, and down behavior follows
SQLite-compatible repository conventions. Do not backfill or rewrite historical
rollout state: null deliberately means unavailable/in-progress and must be
handled by the strict query layer.

#### Task 1.3: Update reference application schema parity Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/schema.sql`
- `packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts`
- `docs/plans/239-canary-preview-evidence/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/db/schema.sql`

Bring the reference schema's Canary definitions into parity with the executable
migrations and include nullable `remaining_preview_evidence`. Preserve all
existing constraints, indexes, foreign keys, and defaults from
migration 20260715. This file is documentation/reference only; do not use it
instead of Task 1.2 or add unrelated later-schema cleanup.

#### Task 1.4: Define the portable Canary evidence contract Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/plans/239-canary-preview-evidence/feature-spec.md`
- `docs/api/v1/schemas/canary.yaml`
- `docs/api/v1/schemas/sync.yaml`
- `docs/api/v1/paths/canary.yaml`
- `docs/api/v1/openapi.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/api/v1/schemas/canary.yaml`
- `docs/api/v1/paths/canary.yaml`
- `docs/api/v1/openapi.yaml`

Add named available/unavailable schemas using `oneOf`, required `version`,
`availability`, and constant discriminator values. Reuse
`SyncPreviewFailureReason`, but define a Canary preview payload that matches the
runtime `GeneratePreviewResult` fields rather than incorrectly reusing stored
`SyncPreviewResult`. Make `CanaryRolloutDetail.remainingPreview` required,
remove the duplicate transient array from `CanaryStartGated`, and document that
unavailable evidence makes Proceed return a safe 409 while Abort remains usable.
Keep portable fields and runtime shapes byte-for-byte aligned; do not generate
artifacts in this task.

#### Task 1.5: Implement the strict persistence codec and atomic evidence write Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
- `packages/praxrr-app/src/tests/db/canaryQueries.test.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`
- `docs/plans/239-canary-preview-evidence/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`
- `packages/praxrr-app/src/tests/db/canaryQueries.test.ts`

Create feature-local strict decoders/validators separate from
`parseJsonArray()`. First validate authorizing `remaining_targets` itself:
malformed JSON/shape, invalid or duplicate IDs, invalid names, or an invalid Arr
scope must force unavailable evidence rather than collapse to `[]`. Then
validate evidence object shape, version, discriminator, timestamp, preview
identity/Arr type, unique cardinality, every section outcome, and exact equality
with valid remaining targets. Validate the closed failure code and reconstruct
canonical `{ code, message, recoveryAction }` through
`buildPreviewFailure(code, arrType)` (or require exact equality with that
canonical result) so arbitrary stored copy can never be transported. Null,
corrupt, unsupported, partial, duplicate, missing, extra, or wrong-Arr content
must decode to safe unavailable evidence and never throw from detail reads.
Extend `RecordCanaryOutcomeInput` and its guarded SQL update to store evidence
atomically with status, canary outcome, rotated token, and finish time; assert
the boolean guard result and keep summaries free of the heavy blob. Add
round-trip and adversarial raw-SQL fixtures for both valid branches,
available-zero-change, legacy null, malformed/duplicate `remaining_targets`,
malformed evidence JSON, unsupported version, invalid/canonicalized failure,
target mismatch, and second-write rejection.

### Phase 2: Coordinator, API, and User Gate

#### Task 2.1: Build explicit preview evidence and enforce fail-closed promotion Depends on [1.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`
- `packages/praxrr-app/src/lib/server/sync/canary/selection.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`
- `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`
- `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`

Replace `buildRemainingPreview(): GeneratePreviewResult[]` and
`catch { return [] }` with a deterministic evidence builder using the exact
persisted remaining target IDs. Never silently drop, substitute, or cross-map a
missing/disabled/wrong-Arr target. Classify thrown
unreachable/unauthorized/timeout/internal errors through
`classifyPreviewFailure`; inspect fulfilled `sectionOutcomes` and make any
failure aggregate `sectionErrors`. Log caught raw errors only under sanitized
logger metadata with a static message; never interpolate or persist raw URL, API
key, response body, instance name, or stack text. Build evidence before entering
`awaiting_confirmation`, persist it in the guarded outcome write, and fail fast
if that write loses its guard. In Proceed, require decoded available evidence
and exact target parity before `markRollingOut`; then preserve the final
status/token atomic guard and enqueue only after it succeeds. Canary abort
paths, confirmed Sync History linkage, and Abort remain unchanged. Add
deterministic tests for unreachable, unauthorized, partial section, complete
zero-change, exact IDs/Arr type, null/corrupt evidence, no enqueue, stale token,
and Abort retention. Add a logger-spy regression with secret-shaped
URL/key/response data and prove it appears nowhere in evidence, persistence,
API-facing values, or unsanitized log output.

#### Task 2.2: Map the new HTTP contract and conflict behavior Depends on [1.4, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`
- `packages/praxrr-app/src/tests/routes/canary.test.ts`
- `docs/api/v1/paths/canary.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`
- `packages/praxrr-app/src/tests/routes/canary.test.ts`

Return the gated rollout containing persisted evidence, update
comments/contracts, and map the typed preview-unavailable error to a safe 409
without raw exception data. Preserve 400 validation, 404 missing rollout, 409
wrong state, and 422 stale token semantics. Extend direct route tests for
available/unavailable start and detail shapes, safe reasons/recovery,
unavailable/corrupt Proceed with zero queued jobs, exact same-Arr IDs,
successful zero-change Proceed, and successful Abort that leaves confirmed
canary evidence untouched. Include secret-shaped fixtures or reuse the
established non-leak assertions so API output never contains raw
URL/key/response text.

#### Task 2.3: Render planned evidence separately and gate actions accessibly Depends on [1.1, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`
- `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts`
- `docs/plans/239-canary-preview-evidence/research-ux.md`
- `packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`

Replace the misleading representative canary-diff block with explicit branches
over `rollout.remainingPreview`: available with planned changes, available with
no changes, and unavailable with safe message/recovery. Keep confirmed canary
Sync History in its existing actual-evidence section. For unavailable evidence,
keep Proceed visible but natively disabled with persistent explanatory text and
`aria-describedby`; keep Abort enabled except during a request and retain copy
that remaining targets are untouched while canary changes are not rolled back.
Use text/icons beyond color, semantic target lists, generation time, Svelte 5
non-rune patterns, and existing UI primitives. Do not add in-place retry, live
GET regeneration, or UI-only authorization.

### Phase 3: Generated Contracts, Documentation, and Verification

#### Task 3.1: Regenerate and verify API distribution artifacts Depends on [1.4, 2.2]

**READ THESE BEFORE TASK**

- `docs/api/README.md`
- `deno.json`
- `docs/api/v1/openapi.yaml`
- `packages/praxrr-api/README.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`

Before generation, explicitly compare the runtime union from Task 1.1 with the
portable schemas from Task 1.4: discriminator/property names, required fields,
`createdAtMs`, failure references, and the absence of stored-preview-only
`id`/`expiresAt` fields must match. Run `deno task generate:api-types` and
`deno task bundle:api` once after source/runtime naming has stabilized. Verify
the generated union, required detail field, safe failure reference, and Proceed
conflict match runtime exactly, and ensure no manual edits or unrelated
generator drift are mixed in. Run the relevant OpenAPI validation/contract
checks documented by the repo.

#### Task 3.2: Add focused UI contract assertions Depends on [2.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`
- `packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`
- `packages/praxrr-app/src/tests/routes/canary.test.ts`
- `docs/plans/239-canary-preview-evidence/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/canaryPreviewEvidenceUx.test.ts`

Files to Modify

- None.

Add a focused Svelte source-contract test following existing fixture-read
patterns. Assert all three evidence branches, planned-versus-confirmed wording,
safe failure/recovery rendering, available-empty copy, native disabled Proceed
plus its accessible explanation, enabled Abort under unavailable evidence, and
explicit non-rollback copy. Keep this a narrow wiring/copy regression layer;
route/domain behavior remains owned by Tasks 2.1 and 2.2.

#### Task 3.3: Run the serialized acceptance and regression gate Depends on [1.3, 3.1, 3.2]

**READ THESE BEFORE TASK**

- GitHub issue #239
- `docs/plans/239-canary-preview-evidence/feature-spec.md`
- `deno.json`
- `scripts/test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- None.

This is a validation-only checkpoint: do not make code or documentation edits in
this task. Run these exact focused commands:

- `deno task test packages/praxrr-app/src/tests/db/canaryMigration.test.ts`
- `deno task test packages/praxrr-app/src/tests/db/canaryQueries.test.ts`
- `deno task test packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`
- `deno task test packages/praxrr-app/src/tests/routes/canary.test.ts`
- `deno task test packages/praxrr-app/src/tests/base/canaryPreviewEvidenceUx.test.ts`
- `deno task check`
- `deno task lint:modified`
- `git diff --check`

Also verify `deno task generate:api-types` and `deno task bundle:api` are
idempotent with no unexplained drift, then run `deno task test` for the broader
regression gate. Inspect the actual assertions to prove unreachable,
unauthorized, partial section, complete zero-change, exact same-Arr targets,
malformed/duplicate target data, canonical safe failure copy, secret
non-leakage, no enqueue, stale token, Abort/no-rollback, and portable contract
fidelity. Any failure reopens the smallest owning task; after its fix, rerun the
affected focused gate and this checkpoint. Do not claim completion while any
required command or acceptance assertion is failing.

#### Task 3.4: Update roadmap and transparency audit after acceptance Depends on [3.3]

**READ THESE BEFORE TASK**

- `ROADMAP.md`
- `docs/internal-docs/automation-transparency-audit.md`
- GitHub issue #239
- `docs/plans/239-canary-preview-evidence/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `ROADMAP.md`
- `docs/internal-docs/automation-transparency-audit.md`

Only after Task 3.3 passes, update the transparent-automation/Canary entries to
state that #239 is implemented by this feature branch, describe the explicit
durable evidence and fail-closed promotion behavior, and remove the open
audit-gap wording without overstating retry/freshness work. Preserve historical
PR/issue links and do not invent a PR number before PR creation; the PR
lifecycle may add the final link in a follow-up commit if repository convention
requires it.

#### Task 3.5: Refresh the graph and audit final scope Depends on [3.4]

**READ THESE BEFORE TASK**

- `CLAUDE.md`
- `docs/plans/239-canary-preview-evidence/parallel-plan.md`
- `ROADMAP.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `graphify-out/`

Run `deno task format:modified` only if the accepted implementation/docs need
repository formatting, then rerun `deno task lint:modified` and
`git diff --check`. Run `graphify update .` exactly once after the final
documentation edits so the graph includes the completed code and docs. Inspect
`git status --short`, `git diff --stat`, and the full scoped diff; confirm every
changed file belongs to issue #239 or an expected generated artifact, no
unrelated worktree changes were absorbed, and all plan/design artifacts remain
in this feature worktree.

## Advice

- Build remaining evidence before persisting `awaiting_confirmation`; writing
  status first recreates the crash window even with a new column.
- The existing `parseJsonArray()` malformed-to-empty behavior is safe for
  display blobs but categorically unsafe for authorizing evidence; keep a
  separate strict decoder.
- `generateInstancePreviews()` can throw while section failures can also arrive
  inside fulfilled results. The evidence builder must handle both channels, and
  thrown batches may legitimately retain no partial previews.
- Evidence validity is the exact set of persisted IDs plus explicit `arrType`
  and clean section outcomes, not mutation count. A zero-change complete preview
  remains available.
- Keep planned remaining evidence structurally and visually separate from
  confirmed canary Sync History. The canary diff is never proof that peers were
  previewed.
- Preserve the final `awaiting_confirmation + state_token` SQL guard after
  evidence validation. Evidence and token are independent authorization
  requirements, and enqueue remains strictly downstream of a successful
  transition.
- Null, legacy, corrupt, unsupported, or target-mismatched evidence must remain
  abortable but never promotable; do not rewrite historical rollout facts.
- Source YAML is authoritative; generated files are updated once after contracts
  stabilize. Parallel agents must not run generators, format the whole repo,
  commit, or update Graphify independently.
- The worktree already exists at the plan's parent path. Use it directly; never
  copy or sync plan artifacts back to the main checkout.
