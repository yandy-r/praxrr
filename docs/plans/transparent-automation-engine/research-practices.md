# Practices Research: Transparent Automation Engine

## Executive Summary

The remaining work should extend the small pure narration foundation from
[PR #213](https://github.com/yandy-r/praxrr/pull/213), not create an “automation engine” framework. Praxrr already has
authoritative sync diffs, Quality Goals reason objects, resolved-layer
responses, job history, a reusable renderer, and strong pure-unit-test patterns.
The highest-value new abstraction is a typed transparency audit keyed by
`JobType`; most other changes should be narrow narrator functions plus additive
UI wiring.

## Existing Reusable Code

| Module/Utility                  | Location                                                                                   | Purpose                                                                                  | How to Reuse for This Feature                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Narration contracts and version | `packages/praxrr-app/src/lib/shared/narration/types.ts`                                    | Defines `NarrationLine`, level, tone, template version, and provenance seam              | Keep one output shape and one template version for all new narrators. Do not add surface-specific narration DTOs.                                                                    |
| Pure narration core             | `packages/praxrr-app/src/lib/shared/narration/narrate.ts`                                  | Renders entity changes, drift reasons, and counts without I/O or re-diffing              | Add sync summary/section and Quality Goal narrators here or in one adjacent domain file if the module becomes unwieldy. Continue delegating entity wording to `narrateEntityChange`. |
| Template registry               | `packages/praxrr-app/src/lib/shared/narration/templates.ts`                                | Centralizes labels and reason wording with explicit Arr type and literal fallback        | Add only shared labels/reason codes. Preserve explicit `arrType`; never duplicate labels in page components.                                                                         |
| Narration renderer              | `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte`                    | Renders headline plus optional verbose details with escaped Svelte text                  | Reuse unchanged on sync-preview, goals, resolved-config, and result surfaces. Hosts own toggles and placement.                                                                       |
| Preview contracts               | `packages/praxrr-app/src/lib/server/sync/preview/types.ts`                                 | Authoritative summaries, section outcomes, entity changes, and field changes             | Narrate these records directly. Do not recalculate counts or create a second diff shape.                                                                                             |
| Preview UI grouping             | `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`          | Groups section entities and currently formats summaries                                  | Replace local prose with pure narrators but keep view-only grouping local unless a third consumer needs it.                                                                          |
| Sync history                    | `packages/praxrr-app/src/lib/server/sync/syncHistory/{types,record}.ts`                    | Stores trigger, section outcomes, counts, failures, and pre-sync planned changes         | Use as the durable run/section result source. Preserve the documented distinction that its changes are captured before writes.                                                       |
| Quality Goals reasons           | `packages/praxrr-app/src/lib/shared/goals/types.ts` and `engine.ts`                        | Produces versioned `GoalReason` objects with rule, base, axis contributions, and ceiling | Render and log the existing reason; never reconstruct rationale from final scores.                                                                                                   |
| Goals response mapper           | `packages/praxrr-app/src/lib/server/goals/responses.ts`                                    | Defines the server-to-wire boundary                                                      | Keep internal scoring input out of narration/log payloads and add only contract-approved fields.                                                                                     |
| Existing goal explanation       | `packages/praxrr-app/src/lib/client/ui/goals/GeneratedConfig.svelte`                       | Contains the current local `reasonLine` formatter                                        | Move this wording into a pure shared goal narrator when both the UI and decision logging/results consume it.                                                                         |
| Resolved layer service          | `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts` and `layers.ts`             | Computes base, user-override, and resolved state plus conflicts                          | Narrate the evidence it already returns; do not add another replay or provenance store for layer-level explanations.                                                                 |
| Resolved state UI               | `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`    | Displays layer tabs, override diffs, absent states, and conflict warning                 | Add concise layer narration around current state. Keep exact per-field attribution out until lineage exists.                                                                         |
| Job type union and registry     | `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts` and `queueRegistry.ts`             | Enumerates automated jobs and registered handlers                                        | Make `JobType` the exhaustive key for the transparency audit and test registry/audit parity.                                                                                         |
| Job labels/history              | `packages/praxrr-app/src/lib/server/jobs/display.ts`, `dispatcher.ts`, and job-run queries | Provides readable names and terminal run evidence                                        | Reuse for audit/result links. The current missing explicit `trashguide.sync` label is an example the audit can surface.                                                              |
| Logger sanitizer                | `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`                             | Recursively redacts sensitive keys and common token shapes                               | Use for bounded, allowlisted Quality Goals decision metadata; do not introduce another logging wrapper.                                                                              |
| Pure scoring/check registries   | `packages/praxrr-app/src/lib/shared/health/criteria.ts` and `shared/security/checks.ts`    | Demonstrate pure records, closed IDs, narration outputs, and exhaustive tests            | Mirror the “closed typed registry + pure result” pattern for the automation audit, without copying their scoring machinery.                                                          |

## Modularity Design

### Recommended Module Boundaries

1. **`$shared/narration` remains the pure wording boundary.** Add small
   functions that accept existing domain records and return `NarrationLine`; no
   fetch, logger, store, or Svelte imports.
2. **Pages remain composition boundaries.** `SyncPreviewPanel`,
   `GeneratedConfig`, and `ResolvedStatePanel` decide placement, verbosity, and
   navigation. They must not own duplicated decision logic.
3. **Goal logging stays server-side.** Build an allowlisted metadata object
   beside the goals server code and emit it only after a successful apply. The
   shared narrator must not know about logging.
4. **The transparency audit lives with jobs.** A small
   `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts` can export a
   `Record<JobType, TransparencyAuditEntry>`. This is separate because it
   describes operational coverage, not human-language rendering.
5. **Per-entity execution outcomes remain a follow-up boundary.** Do not stretch
   preview/history types to imply actual outcomes. Extend `SyncResult`
   deliberately when syncers can report them.

### Shared vs. Feature-Specific Code

| Component                              | Shared or Feature-Specific                        | Rationale                                                                                                                   |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NarrationLine`, tone, level, renderer | Shared                                            | Already used by drift, health, and security; more automated surfaces are the intended extension.                            |
| Entity change narration                | Shared                                            | Preview, drift, resolved live diff, and history use the same `EntityChange` contract.                                       |
| Sync summary/section narration         | Shared                                            | Preview and sync-history/result views need identical count/status wording.                                                  |
| Goal decision narration                | Shared                                            | The same `GoalReason` must explain preview, apply response, and server decision record.                                     |
| Sync-preview section grouping          | Feature-specific                                  | It is layout data, currently only needed by the preview page; history flattening has different tagging/filtering semantics. |
| Resolved layer copy                    | Shared pure helper, UI placement feature-specific | Base/user/resolved meanings are contract facts, but tabs and conflict links belong to the page.                             |
| Quality Goal log metadata builder      | Server feature-specific                           | Logging policy and redaction do not belong in client-safe shared code.                                                      |
| Automation audit registry              | Server shared                                     | It must cover every job handler and can later feed docs/tests or an authenticated operational view.                         |

## KISS Assessment

| Area                   | Current Proposal                                               | Simpler Alternative                                                                                    | Trade-off                                                                                                                  |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Narration architecture | A generic plugin/registry with arbitrary templates and context | Add explicit typed functions returning the existing `NarrationLine`                                    | Less runtime extensibility, but exhaustive types and far less indirection.                                                 |
| Sync preview           | New narrated API payload persisted with each snapshot          | Derive narration on the client/shared layer from existing typed snapshot data                          | Wording changes affect old snapshots when re-rendered; template version remains available and no duplicate payload drifts. |
| Goal rationale         | New rationale model or natural-language generation             | Render the existing `GoalReason`                                                                       | Tied to current engine reason schema, which is correct because it is authoritative.                                        |
| Provenance             | New per-field provenance database/migration in this issue      | Explain current layers and create a lineage follow-up                                                  | Does not deliver exact op/default attribution now, but avoids false precision and a large schema project.                  |
| Decision logging       | Generic event bus/telemetry dependency                         | One allowlisted structured logger call after goal apply                                                | Less general, but matches the one proven requirement and existing infrastructure.                                          |
| Automation audit       | Manually maintained prose checklist only                       | One typed `Record<JobType, Entry>` plus a focused parity test and human notes                          | Requires updating code when a job is added; that friction is the guardrail.                                                |
| Contextual help        | New global tooltip/help framework                              | Add concise copy to the remaining named settings/results using existing components and engine metadata | Some local markup repeats, but avoids framework work unrelated to issue #21.                                               |

## Abstraction vs. Repetition

### Extract (Worth Abstracting)

- **Sync summary wording:** already duplicated in `SyncPreviewTrigger.svelte`
  and `SyncPreviewPanel.svelte`, and required again for narration/results.
  Extract one pure narrator.
- **Entity decision wording:** already centralized in `narrateEntityChange`; all
  preview/drift/history consumers should delegate to it.
- **Quality Goal reason wording:** currently local to `GeneratedConfig.svelte`,
  but the remaining issue requires server-side decision rationale and result
  explanations. Extract one pure goal narrator now.
- **Automation coverage metadata:** at least 17 `JobType` members and matching
  handlers need the same inputs/decisions/outputs/failures review. A typed
  registry is materially safer than repeated prose.
- **Resolved-layer meaning:** the API, UI, and narration all need the same
  base/user/resolved semantics. Put the short canonical wording in one pure
  helper or template map.

### Repeat (Acceptable Duplication)

- **Preview section grouping versus sync-history flattening:** only two
  occurrences and their output semantics differ (UI grouping includes unchanged
  entries; history tags changed-only entries). Combining them would require
  options that obscure intent.
- **Verbose toggle state:** each host surface can own a local boolean and
  `NarrationLevel` derivation. A global narration store would couple unrelated
  pages.
- **Contextual explanatory markup:** a few settings paragraphs should remain
  near their controls until three surfaces need the exact same interactive help
  component.
- **Route-specific error placement:** reuse reason mapping, but let each page
  position alerts according to its workflow instead of creating a universal
  operation-result component.

## Interface Design

### Public API Surfaces

Prefer narrow functions over an open-ended context bag:

```ts
function narrateSyncSummary(
  summary: SyncPreviewSummary,
  outcomes: readonly SyncPreviewSectionOutcome[],
  level: NarrationLevel
): NarrationLine;

function narrateSyncSectionResult(
  result: SyncSectionResult,
  level: NarrationLevel
): NarrationLine;

function narrateGoalDecision(
  decision: GoalCfDecision,
  level: NarrationLevel
): NarrationLine;

function narrateResolvedLayer(
  layer: ResolvedLayer,
  present: boolean,
  hasPendingConflict: boolean,
  level: NarrationLevel
): NarrationLine;
```

Do not add a per-entity “applied” narrator until a distinct actual-outcome type
exists. When it does, its signature should accept that outcome, not an
`EntityChange` plus a success boolean.

The audit contract should be closed and evidence-oriented:

```ts
type TransparencyAuditEntry = {
  inputs: readonly string[];
  decisions: readonly string[];
  outputs: readonly string[];
  failureReasons: readonly string[];
  userSurface: string | null;
};

const TRANSPARENCY_AUDIT = {
  // every JobType
} satisfies Record<JobType, TransparencyAuditEntry>;
```

### Extension Points

- Add new narrator functions to `$shared/narration/index.ts`; keep template
  resolvers internal.
- Add verified per-Arr labels under the existing explicit Arr maps; unknown
  terms keep literal fallback.
- New automated job types fail compilation until the audit record is supplied.
- A future operations UI can consume a sanitized projection of the audit
  registry without changing job execution.
- Future per-entity outcomes can reuse entity labels and renderer while
  remaining type-distinct from planned changes.

## Testability Patterns

### Recommended Patterns

- **Pure table-driven narration tests:** extend
  `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts` for every
  action/status, zero/mixed counts, summary/verbose, partial section errors,
  template version, and all three Arr types.
- **Golden reason coverage:** use actual `GoalReason` fixtures from goal engine
  tests and assert score explanations come from base/contributions/ceiling
  without reclassification.
- **Cross-Arr negative tests:** unknown labels fall back literally; unsupported
  combinations never borrow a sibling mapping.
- **Planned-versus-actual tests:** section result narration may say
  succeeded/failed; preview entity narration must remain future/planned tense.
- **Audit exhaustiveness:** compare registered job types with audit keys at
  runtime in addition to the compile-time `satisfies Record<JobType, ...>`
  check. Include `trashguide.sync` and cleanup jobs.
- **Log metadata unit test:** test a pure allowlist/bounding builder, then
  separately reuse existing sanitizer tests for nested sensitive values. Avoid
  mocking the entire logger.
- **Route contract tests:** update sync apply route tests and OpenAPI types
  together if the response shape is corrected; assert authenticated failures and
  sanitized messages.
- **Renderer safety:** fixture headlines/details with HTML-shaped strings and
  keep `NarrationBlock.svelte` on escaped interpolation.

### Anti-patterns to Avoid

- Snapshot tests of whole pages: they are brittle and obscure incorrect business
  wording; test pure narrator outputs and a few structural UI assertions
  instead.
- Recomputing summaries in tests from entity arrays: this would validate the
  same mistake the implementation must avoid. Pass contradictory fixture counts
  and assert the narrator trusts the authoritative summary.
- Global module mocking for logger/database/fetch when a pure mapper can be
  tested directly.
- Testing only Radarr and assuming Sonarr/Lidarr parity.
- Using preview changes as fixtures for successful per-entity apply results.

## Build vs. Depend

| Need                     | Build Custom                                | Use Library                      | Recommendation                          | Rationale                                                                                                                |
| ------------------------ | ------------------------------------------- | -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Human-readable narration | A few pure typed functions                  | Template/i18n framework          | Build small functions                   | Existing engine already establishes the pattern; a framework adds runtime indirection without localization requirements. |
| UI rendering             | Existing `NarrationBlock`                   | Markdown/rich-text renderer      | Reuse existing component                | Plain escaped text is safer and sufficient.                                                                              |
| Decision logging         | Existing logger + sanitizer                 | OpenTelemetry/event-bus package  | Reuse existing logger                   | One bounded event does not justify a new dependency or migration.                                                        |
| Diffing and counts       | Existing preview/resolved engines           | Generic JSON-diff library        | Reuse existing records                  | Correct Arr/Portable semantics and keyed-array behavior already live in repo-specific code.                              |
| Provenance               | Current layer services                      | Lineage/provenance library       | Build only when exact lineage is scoped | Generic libraries cannot infer PCD op replay semantics.                                                                  |
| Audit coverage           | Typed object + tests                        | Governance/compliance framework  | Build tiny registry                     | `JobType` is already the complete local domain enum.                                                                     |
| Component testing        | Existing Deno/Svelte checks and route tests | New browser/component test stack | Use existing test stack                 | Pure logic carries most risk; avoid introducing tooling for a small rendering change.                                    |

## Open Questions

1. Should the corrected apply response return inline section results or a
   sync-history ID as the durable source of truth?
2. Is layer-level resolved-config provenance sufficient for issue #21, with
   per-field op/default lineage moved to an explicit follow-up?
3. Should the audit registry describe only queued `JobType` automation, with a
   separate small list for synchronous automated routes such as
   goals/preview/apply and resolved live diff?
4. How many Quality Goal decisions may enter one structured log event before the
   mapper summarizes counts and stores only reason-code aggregates?
5. Does the product want long-term localization? If not, keep versioned English
   templates as simple functions rather than adopting i18n infrastructure in
   this issue.
