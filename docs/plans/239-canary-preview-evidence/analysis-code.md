# Code Analysis: Canary Remaining-Target Preview Evidence

## Executive Summary

Issue #239 is a cross-layer contract correction centered on one unsafe
ambiguity. The current coordinator catches every remaining-preview exception and
returns `[]`
(`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts:109-139`), while
the start result exposes that transient array outside the persisted rollout
(`packages/praxrr-app/src/lib/server/sync/canary/types.ts:198-205`). The start
page then ignores the array and redirects to detail
(`packages/praxrr-app/src/routes/canary/+page.svelte:72-84`). The detail page
instead presents the canary's historical Sync History diff as a representative
remaining preview
(`packages/praxrr-app/src/routes/canary/[id]/+page.svelte:203-243`). Thus
neither reload nor Proceed has authoritative evidence for the exact remaining
targets.

The implementation should add a nullable versioned JSON evidence column,
strictly decode it to an `available`/`unavailable` union, build evidence before
entering the gate, and persist it in the same guarded update as canary
outcome/status/token. Proceed should synchronously validate the persisted
decoded evidence before its existing state-token transition and enqueue. No new
service or dependency is needed. The difficult parts are strict runtime
validation, exact target-set equality, partial section detection, portable
schema fidelity, and tests that prove unavailable evidence can never enqueue
while Abort remains independent.

## Existing Code Structure

`packages/praxrr-app/src/lib/server/sync/canary/types.ts` owns three
representations: raw SQLite rows (`CanaryRolloutRow`, lines 69-92), summary DTOs
(lines 110-130), and full detail DTOs (lines 132-155). Add
`remaining_preview_evidence: string | null` only to the row, and a required
decoded `remainingPreview` to detail, not summary. Replace the gated
`CanaryStartResult` arm's separate `GeneratePreviewResult[]` with
`{ skipped: false; rollout: CanaryRolloutDetail }` so the response and detail
route share one source of truth.

`packages/praxrr-app/src/lib/server/sync/canary/selection.ts` resolves the
canary and remaining cohort using explicit `arrType`; `computeRemaining`
excludes the canary and filters exact sibling type. This module should remain
unchanged. Evidence validation must compare against the persisted
`remainingTargets`, not recompute a potentially different cohort.

`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts` owns policy.
`startRollout` inserts the running row at lines 174-185, runs/classifies the
canary at 187-193, records the gate decision at 195-203, and only then builds
the preview at 213-214. Reorder only the gate-eligible path: classify the
canary, build an evidence object from the persisted exact targets, then call one
guarded `recordCanaryOutcome` carrying status, rotated token, and evidence.
Canary failure/skipped or partial+abort remains terminal and does not preview
remaining instances. A preview failure does not abort the canary result; it
persists `awaiting_confirmation + unavailable`.

`packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts` maps rows and
implements all guarded mutations. Its generic parser deliberately turns
malformed/non-array JSON into `[]` (lines 58-65), which must not be reused for
authorizing evidence. `recordCanaryOutcome` is a single guarded update at lines
167-184; extend its input/SQL with serialized evidence. `rowToDetail` (lines
95-120) should invoke a strict decoder with the row's `arr_type` and decoded
`remainingTargets` as validation context.

The API detail handler already returns `getById()` directly, so it will expose
the new DTO without a second read model. The Svelte server load likewise returns
the rollout plus confirmed diagnostics. The Proceed handler preserves bounded
input parsing and typed status mapping
(`packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts:39-92`).
Only a new typed unavailable-evidence mapping to 409 is needed.

## Implementation Patterns

Define the union near the Canary target/result types:

```ts
type CanaryRemainingPreviewEvidence =
  | {
      version: 1;
      availability: 'available';
      generatedAt: string;
      previews: GeneratePreviewResult[];
    }
  | {
      version: 1;
      availability: 'unavailable';
      generatedAt: string;
      failure: SyncPreviewFailureReason;
      partialPreviews: GeneratePreviewResult[];
    };
```

Use separate builders for creation and decoding. The creation builder takes
`arrType`, persisted targets, requested sections, and a clock; it does not
silently drop missing/disabled targets. The processor throws for
missing/disabled instances
(`packages/praxrr-app/src/lib/server/sync/processor.ts:64-78`) and runs batches
with bounded concurrency (lines 88-101). Catch a batch throw once and convert it
with `classifyPreviewFailure`. Returned previews also require aggregate
validation because section-level exceptions are captured, not thrown:
`generatePreview` writes typed failures into `sectionOutcomes`
(`packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts:240-273`). Any
such failure produces aggregate `sectionErrors`; any retained successful results
are diagnostic `partialPreviews` only.

The decoder must parse `unknown`, reject arrays/non-records, require exact
`version: 1` and discriminator, validate `generatedAt`, validate every failure
field against the closed vocabulary, and structurally validate preview identity
fields and section outcomes. For an available value, compare a set of preview
IDs to a set of persisted target IDs: equal cardinality, no duplicates, no
extras/missing IDs, and every preview `arrType === rollout.arrType`. Any
invalidity returns a newly built safe unavailable read model; it never throws
from detail reads and never returns available with an empty fallback. Preserve
`available` with zero mutation totals as valid.

Keep the existing transition pattern. `proceedRollout` reads detail, checks
`awaiting_confirmation`, checks `remainingPreview.availability === 'available'`
and exact targets, then calls `markRollingOut` with the supplied token before
enqueueing (`coordinator.ts:222-244`). Abort continues to check only lifecycle
state/token (`coordinator.ts:252-266`). Add a named
`CanaryPreviewUnavailableError` and `is*` predicate beside the errors in
`packages/praxrr-app/src/lib/server/sync/canary/errors.ts`; do not string-match.

## Integration Points

- **Database:** create
  `packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts`
  with `ALTER TABLE canary_rollouts ADD COLUMN remaining_preview_evidence TEXT`.
  Register its static import and list entry after 20260721 in
  `packages/praxrr-app/src/lib/server/db/migrations.ts` (current tail: lines
  79-85 and 396-402). Update `packages/praxrr-app/src/lib/server/db/schema.sql`
  for reference parity.
- **Runtime contracts:** update `canary/types.ts`, `canaryRollouts.ts`, and
  coordinator imports. `CanaryRolloutRow` must reflect the nullable raw column
  while detail always exposes a decoded evidence branch.
- **Start/detail APIs:** update comments and response construction in
  `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`; the detail
  route needs no new query. Update `docs/api/v1/schemas/canary.yaml`,
  `docs/api/v1/paths/canary.yaml`, and `docs/api/v1/openapi.yaml`, then
  regenerate `packages/praxrr-app/src/lib/api/v1.d.ts` and `packages/praxrr-api`
  artifacts.
- **Proceed/Abort:** map unavailable evidence to safe 409 in
  `routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`. Do not modify Abort's
  evidence independence in
  `routes/api/v1/canary/rollouts/[id]/abort/+server.ts`.
- **UI:** replace the representative Sync History block at
  `routes/canary/[id]/+page.svelte:203-243` with branches over
  `rollout.remainingPreview`. Use actual canary diagnostics only in the
  preceding section. Gate Proceed currently depends only on `submitting` (lines
  290-299); add availability to `disabled`, persistent `aria-describedby` reason
  text, and keep Abort enabled except during a submission (lines 300-307).
- **Documentation:** update `ROADMAP.md` only when implementation is complete.

## Code Conventions

Follow the repo's TypeScript path aliases, snake_case row/camelCase DTO
boundary, static migration imports, and raw SQL query modules. Keep Svelte 5
without runes: `export let data`, reactive `$:` derivations, current `on:click`
style, `Badge`, `Modal`, and `alertStore`. Use tabs/single quotes/no trailing
commas under the repository formatter rather than manually restyling unrelated
code.

Use exhaustive switches or explicit predicates for discriminators. Runtime
validation must not rely on TypeScript casts. Closed error copy belongs in
`packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`, whose
status/type-only mapping is at lines 89-129. Log static messages and keep raw
errors only in sanitized logger metadata. Keep summary projections light:
`SUMMARY_COLUMNS` intentionally omits heavy blobs and the state token
(`canaryRollouts.ts:67-92`), so evidence should not be added to rollout-list
responses.

## Dependencies and Services

No package, external API, configuration, or environment variable is added. The
feature reuses:

- SQLite through the existing `db` singleton and migration runner.
- `generateInstancePreviews` and `GeneratePreviewResult` from the Sync Preview
  pipeline.
- `SyncPreviewFailureReason`, `classifyPreviewFailure`, and
  `buildPreviewFailure` for safe evidence.
- Existing Arr clients indirectly through `generatePreview`.
- `enqueueJob` and the existing `sync.canary.rollout` handler; job payloads are
  unchanged.
- SvelteKit server loads/JSON handlers, existing UI primitives, OpenAPI
  generation tasks, and Deno tests.

The portable schema needs a Canary-specific preview payload matching
`GeneratePreviewResult`. `GeneratePreviewResult` has `createdAtMs` and no
stored-preview `id`/`expiresAt`, whereas the portable `SyncPreviewResult` schema
represents a different lifecycle. Do not paper over that mismatch by declaring
the evidence array as `SyncPreviewResult[]`.

## Gotchas and Warnings

1. **Do not persist after entering the gate.** Current ordering records
   `awaiting_confirmation` before preview generation. Build evidence first, then
   atomically persist outcome/status/token/evidence, or a crash recreates the
   gap.
2. **Check the guarded outcome write.** `startRollout` currently ignores the
   boolean returned by `recordCanaryOutcome` (`coordinator.ts:195-203`). The
   refactor should fail fast if this write loses its `canary_running` guard;
   otherwise it may return a stale row/evidence combination.
3. **Do not re-filter target drift to success.** Current code intersects targets
   with a fresh enabled set and silently drops missing targets
   (`coordinator.ts:121-129`). For issue #239, any persisted target
   missing/disabled/wrong-Arr makes evidence unavailable.
4. **Section failures are data, not exceptions.** A fulfilled
   `GeneratePreviewResult` can still be incomplete. Inspect every
   `sectionOutcomes[].failure`.
5. **Batch throws can discard partial values.** `processBatches` may reject
   without returning prior successful results. `partialPreviews` may validly be
   empty on a thrown batch; do not claim it is a complete diagnostic record.
6. **Legacy/null must remain abortable.** The decoder should surface safe
   unavailable evidence, but Abort must not require a valid evidence payload.
7. **Available-empty is not unavailable.** Use mutation totals only for UI copy,
   never for gate authorization.
8. **Do not leak failure input.** The existing classifier deliberately ignores
   raw error messages. Secret fixtures in
   `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts:42-89`
   establish the non-leak expectation.
9. **Keep stale-token semantics.** Evidence rejection is 409; a valid available
   gate with an old token remains 422. Validation ordering should not
   accidentally mask a stale-token test unless the test row itself lacks
   available evidence.
10. **Current offline coordinator tests expect `[]`.** Tests around
    `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts:265-291`
    depend on failed live preview generation. Add deterministic seams/fixtures
    for explicit available and unavailable evidence instead of relabeling that
    incidental empty array as no changes.

## Task-Specific Guidance

Implement in dependency order:

1. Add the TypeScript/OpenAPI union and dated migration; register it and update
   generated/reference artifacts.
2. Add a pure strict decoder/validator and query round-trip. Unit-test null,
   malformed JSON, wrong version/discriminator, bad failure code,
   duplicate/missing/extra/wrong-Arr targets, section failure, zero changes, and
   valid changes.
3. Refactor coordinator evidence creation. Use a small test seam or pure
   result-classification helper so unreachable, unauthorized, partial, and
   complete cases are deterministic. Persist the evidence with the guarded
   canary outcome update.
4. Enforce available exact-target evidence in Proceed before `markRollingOut`;
   add typed 409 mapping and prove the job count remains zero. Re-run existing
   stale/wrong-state and Abort tests.
5. Render the three evidence states on detail: `Available · Changes planned`,
   `Available · No changes`, and `Remaining preview unavailable` with safe
   recovery copy. Proceed is disabled and described when unavailable; Abort
   remains enabled; actual canary evidence stays separate.
6. Extend the existing real-DB harnesses in
   `packages/praxrr-app/src/tests/db/canaryMigration.test.ts:13-35`,
   `packages/praxrr-app/src/tests/db/canaryQueries.test.ts:68-124`, and
   `packages/praxrr-app/src/tests/routes/canary.test.ts:293-384`. Add a focused
   Svelte source test following
   `packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts` for
   discriminator branches, disabled/accessible Proceed, enabled Abort, and
   removal of misleading copy.
7. Run focused Canary migration/query/coordinator/route/source tests,
   OpenAPI/type generation checks, `deno task check`, `deno task lint`, and
   broader relevant tests. Then update `ROADMAP.md` and the project graph as the
   final documentation steps.
