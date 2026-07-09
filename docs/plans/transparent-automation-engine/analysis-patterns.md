# Pattern & Code Analysis: Transparent Automation Engine

## Executive Summary

The feature fits existing Praxrr patterns without new infrastructure: pure typed decision/rendering cores,
thin route and Svelte adapters, exhaustive maps for closed unions, centralized log sanitization, and focused
Deno tests. The safest implementation extends `$shared/narration`, derives provenance from the existing
base-versus-resolved diff, emits one bounded post-success goal event, and makes audit coverage compile-time
exhaustive rather than relying on prose alone.

## Implementation Patterns

- **Pure Evidence Renderer**: Narrators accept already-computed domain records and return immutable
  `NarrationLine` values; they perform no fetch, diff, tally, or persistence. Follow
  `narrateEntityChange` and `narrateDriftCounts` in
  `packages/praxrr-app/src/lib/shared/narration/narrate.ts`.

- **Single Version Source**: `NARRATION_TEMPLATE_VERSION` is declared once in
  `packages/praxrr-app/src/lib/shared/narration/types.ts` and stamped onto every line. New sync phrasing
  should bump that constant once; templates and tests import it rather than duplicate a literal.

- **Delegate to One Core**: `narrateDriftEntity` normalizes its input, delegates field narration to
  `narrateEntityChange`, then adds only drift framing/tone. Implement `narrateEntityChanges` as a map/filter
  over the existing core rather than a parallel switch.

- **Typed Inputs, Type-Only Cross-Layer Imports**: `$shared/narration` imports sync/drift contracts with
  `import type`. Preserve this client/server boundary for `SyncPreviewSummary`,
  `SyncPreviewSectionOutcome`, `EntityChange`, `SyncPreviewArrType`, and `SyncPreviewSection`.

- **Closed Union Switches**: `resolveFieldVerb`, `resolveDriftCategoryPhrase`, resolved readers, and TRaSH
  transforms use exhaustive switches; some assign the default to `never`. New section/action/provenance
  mappings should fail compilation when a union grows.

- **Explicit Arr Dispatch with Literal Fallback**: `resolveEntityLabel` and `resolveFieldLabel` check the
  explicit `arrType`, then common labels, then return the raw name. Unknown labels are correct-but-plain;
  never borrow a Radarr/Sonarr/Lidarr sibling mapping. See
  `packages/praxrr-app/src/lib/shared/narration/templates.ts`.

- **Authoritative Aggregate Reuse**: `narrateDriftCounts` consumes supplied counts verbatim. Sync-summary
  narration must likewise use `SyncPreviewResult.summary`, even when the UI filters visible section rows.

- **Thin Contract-Typed Routes**: Goals apply parses through shared request helpers, performs domain work,
  and returns an object checked with `satisfies GoalApplyResponse`. Follow
  `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`; avoid route-local duplicate DTOs.

- **Post-Success Side Effect Ordering**: Goals apply currently writes scoring first and upserts the binding
  second. Build and emit the decision event only after both succeed, from the same `plan` used by
  `updateScoring`. A failed write/binding must never produce `quality_goal.applied`.

- **Bounded Allowlist Mapper**: Create a pure server mapper that selects only approved goal metadata,
  truncates bounded strings/arrays, and records `omittedDecisionCount`. Pass the result through the normal
  logger; `packages/praxrr-app/src/lib/server/utils/logger/logger.ts` already invokes
  `sanitizeLogMeta` recursively from `sanitizer.ts`.

- **Diff as Provenance Ground Truth**: User overrides are already computed as base-versus-resolved
  `FieldChange[]` in `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`. Reuse that result for
  `user-override`, treat base-absent/resolved-present as user-created, and preserve
  `hasPendingConflict` ambiguity.

- **Host-Owned Progressive Disclosure**: `NarrationBlock.svelte` is deliberately dumb; the host owns one
  `verbose` state. Reuse the accessible disclosure pattern from
  `packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte` (`aria-expanded`, `aria-controls`)
  and `CollapsibleCard.svelte`, without moving interaction state into the renderer.

- **Stale Async Result Guard**: Resolved Config components capture request context/IDs and discard older
  responses after selection changes. Preserve this pattern for any added layer fetch or refreshed
  narration; never let a response for a previous entity/instance overwrite the current view.

- **Exhaustive Static Registry**: The parity subsystem uses
  `as const satisfies Record<Union, Value>` to make missing entries compile errors
  (`packages/praxrr-app/src/lib/shared/arr/parity.ts`). The queued-workflow audit should use the same pattern:
  `satisfies Record<JobType, TransparencyAuditEntry>`.

- **Layered Tests**: Pure decisions use direct table-like `Deno.test` cases; routes use real in-memory
  SQLite/cache fixtures with narrowly patched dependencies and `finally` restoration. See
  `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`,
  `src/tests/routes/goalsRoutes.test.ts`, and `src/tests/pcd/resolved/layerDiff.test.ts`.

## Existing Code Structure

### Shared narration boundary

- `lib/shared/narration/types.ts`: stable contracts and version constant.
- `lib/shared/narration/templates.ts`: wording/label registry only.
- `lib/shared/narration/narrate.ts`: pure composition logic.
- `lib/shared/narration/index.ts`: public barrel.
- `lib/client/ui/narration/NarrationBlock.svelte`: presentation-only renderer.

Keep this separation: new sentences belong in templates/narrators, not `.svelte` conditionals. Raw current
and desired values remain owned by the existing diff components.

### Sync-preview boundary

- `lib/server/sync/preview/types.ts`: authoritative summary, section outcomes, entity/field atoms.
- `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`: fetch lifecycle, grouping, staleness,
  destructive confirmation, and apply state.
- `SyncPreviewEntityDiff.svelte`: expandable entity and raw field table.
- `routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: validation, eligible-section selection,
  staleness/state transitions, and coarse job result.

The panel already has every pre-apply input; do not add a narration endpoint. Pass `arrType`, `section`, and
`verbose` into entity rows and render a pure line above the current table.

### Goals boundary

- `lib/shared/goals/types.ts` and `engine.ts`: canonical `GoalPlan`, `GoalReason`, score arithmetic.
- `lib/server/goals/planRequest.ts`: validated materialization/plan construction.
- `routes/api/v1/goals/apply/+server.ts`: guarded write and binding persistence.
- `lib/client/ui/goals/GeneratedConfig.svelte`: current UI-only friendly reason formatter.

The new server mapper should consume `GoalPlan`; it must not reverse-engineer reasons from persisted scores.
Friendly wording should have one shared source so server and UI do not drift.

### Resolved-config boundary

- `lib/server/pcd/resolved/layers.ts`: ephemeral base/full replay helpers.
- `lib/server/pcd/resolved/layerDiff.ts`: entity-specific diff strategies and layer resolution.
- `routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`: layer fetch/state, conflict banner,
  overrides table, raw resolved view.

Base includes schema + base + tweaks. The current model does not retain exact schema-default/base-op lineage.

### Audit boundary

- `lib/server/jobs/queueTypes.ts`: `JobType` union and payload map; authoritative queued-work inventory.
- `lib/server/jobs/display.ts`: current labels/display-name lookup, but its default string formatter is not
  an exhaustiveness guarantee.
- direct mutators (preview apply, goal apply, rollback) require separate checked-document rows because they
  are not `JobType` members.

## Code Conventions

### Naming and module design

- Use verbs for pure renderers/mappers: `narrateSyncPreviewSummary`, `narrateSyncSectionOutcome`,
  `buildGoalDecisionLogMeta`.
- Use domain nouns for contracts: `TransparencyAuditEntry`, `GoalDecisionLogMeta`.
- Keep modules narrowly scoped and exported through the existing barrel only when client/shared consumers
  need them.
- Prefer readonly inputs/outputs and `as const satisfies` for authored catalogs.

### Style

- TypeScript/Svelte formatting: tabs, single quotes, no trailing commas, 100-character print width.
- Svelte 5 without runes. Use current project event-attribute conventions for new code (`onclick`), but do
  not perform unrelated wholesale event-syntax conversion in touched components.
- Use path aliases (`$shared`, `$sync`, `$ui`, `$logger`, `$pcd`) and `.ts` suffixes consistently with the
  surrounding module.

### Error handling

- Closed reason unions may receive specific narration.
- Arbitrary preview/apply error text receives a neutral safe frame; never substring-classify it.
- Route validation returns existing 400/404/409/422 distinctions and preserves the preview state machine.
- Unsupported cross-Arr behavior fails closed; unknown display labels fall back literally.
- Logger metadata is allowlisted/bounded before the centralized recursive sanitizer.

### Testing

- Pure narration tests assert the entire `NarrationLine`, including tone, detail, and template version.
- Add adversarial totals where supplied summary differs from visible entity arrays to prove no retallying.
- Cover every `SyncPreviewSection`, successful/skipped/error outcomes, empty/free-form errors, and all Arr
  types/literal fallback.
- Goal mapper tests cover cap boundaries, omitted counts, exact reason math, uncategorized decisions,
  control characters, secret-shaped nested values, and post-success emission ordering.
- Resolved tests cover base-present/user-change, base-absent user-created, nested/top-level field paths, and
  pending conflict ambiguity; assert `database-default` is never emitted.
- Audit tests assert exact key parity with `JobType`; compile-time `satisfies Record` is the first guard.
- UI/E2E tests follow `2.50-progressive-disclosure.spec.ts`: assert toggle text, `aria-expanded`, controlled
  visibility, and stable state through interaction.

## Integration Points

### Files to create

- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts`: pure bounded goal event mapper.
- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts`: exhaustive queued-job registry.
- `docs/internal/automation-transparency-audit.md`: human evidence matrix including direct mutators.
- Focused decision-log and audit-completeness test files.

### Files to modify

- `packages/praxrr-app/src/lib/shared/narration/types.ts`: template version bump.
- `.../narration/templates.ts`: section/summary phrasing registry.
- `.../narration/narrate.ts`: pure sync summary/outcome/batch/error functions.
- `.../narration/index.ts`: public exports.
- `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`: planned decision log, coverage, accessible
  surface toggle.
- `SyncPreviewEntityDiff.svelte`: pure entity narration and accessible row disclosure.
- `routes/api/v1/goals/apply/+server.ts`: post-success event emission.
- `routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`: proven layer explanations/provenance.
- `ROADMAP.md`: completion and linked prerequisite follow-ups.
- OpenAPI/generated API artifacts only if correcting the existing coarse apply-response contract.

### Dependency ordering

1. Define truth/stage language and follow-up contracts.
2. Implement/test pure narration functions.
3. Wire Sync Preview UI.
4. Implement Goals mapper/logging and Resolved provenance in parallel.
5. Finalize exhaustive audit, gap issues, tracking, and full validation.

## Gotchas and Warnings

- **`NarrationProvenance` is a seam, not evidence**: its current `database-default` member does not mean the
  compiler can prove that source. Do not emit it.
- **Preview changes are planned**: `SyncResult` and the apply response lack per-entity terminal outcomes.
  Never convert preview rows into success rows after apply.
- **Apply is section execution, not stored entity execution**: the route resolves eligible sections and
  calls `executeSyncJob`; wording must not claim every stored preview action was executed exactly.
- **Legacy snapshot fallback exists**: `resolveEligibleSections` falls back when `sectionOutcomes` is empty.
  Narration must handle old snapshots without declaring false completeness.
- **A preview-level error blocks apply** even if some outcomes exist. Preserve route/UI state behavior.
- **`skipped` is treated as a successful coarse job terminal state by apply**; display the returned status,
  not an unconditional "all changes applied" sentence.
- **Audit display labels are not audit completeness**: `formatJobTypeLabel` has a generic default, so a new
  job can render while lacking transparency evidence. The new registry must be exhaustive.
- **Do not log the raw `GoalPlan` or request body**: custom-format/profile names and policy are operationally
  sensitive; arrays and strings need explicit caps even though logger sanitization is recursive.
- **Do not add `{@html}`**: names, fields, and errors are untrusted operational text; use escaped Svelte
  interpolation.
- **Do not rebuild base state per field**: provenance should reuse existing layer results/diffs.
- **Do not duplicate value rendering**: narration describes decisions; current/desired values stay in the
  existing diff tables and `formatFieldValue` paths.
- **Keep versions distinct**: narration template, Goals engine, and API schema versions represent different
  contracts.
- **Contract fidelity is all-or-nothing**: if the apply response schema changes, update OpenAPI, runtime
  validation/handler, app generated types, and package API artifacts together.
