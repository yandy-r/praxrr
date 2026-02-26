# trash-guide-sync-ux Implementation Plan

This feature adds source-aware UX across TRaSH-backed entity browsing and Arr sync configuration
without changing ingestion architecture. The implementation strategy is to first stabilize shared
source metadata contracts and server payload shapes, then layer source filters/badges into existing
listing shells, and finally integrate source-grouped TRaSH sync controls into the Arr sync workflow.
Existing systems remain authoritative: TRaSH cache/query layers for entity data,
`trashGuideSyncQueries` for sync state, and queue dedupe for manual sync behavior. The plan
emphasizes wide parallel execution in phase 1 and phase 2 while protecting high-churn files
(`display.ts`, listing pages, sync loader) with explicit dependency boundaries.

## Critically Relevant Files and Documentation

- `packages/praxrr-app/src/lib/shared/pcd/display.ts`: shared display contracts consumed by listing
  pages and route loaders.
- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`: common badge primitive to extend for
  TRaSH source provenance.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`: source-scoped cached
  TRaSH entity reads.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: scoped sync config/selection
  persistence for TRaSH.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`: TRaSH
  entities API contract and filtering behavior.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`: manual sync
  trigger and dedupe behavior.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts`: custom-format data
  loading boundary.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: custom-format
  tabs/actions/listing shell.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`: quality-profile
  data loading boundary.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: quality-profile
  tabs/actions/listing shell.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Arr sync data aggregation and
  action wiring.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Arr sync section composition and
  save/preview UI.
- `packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`: existing route-level TRaSH
  contract coverage.
- `docs/plans/trash-guide-sync-ux/feature-spec.md`: acceptance criteria for multi-source UX
  behaviors.
- `docs/ARCHITECTURE.md`: startup/manager/query and route-layer architecture constraints.
- `docs/api/README.md`: API versioning and response semantics.
- `docs/features/link-bridge-sync.md`: sync UX consistency expectations.

## Implementation Plan

### Phase 1: Contracts and Backend Foundations

#### Task 1.1: Define shared source metadata contracts Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/trash-guide-sync-ux/feature-spec.md`
- `packages/praxrr-app/src/lib/shared/pcd/display.ts`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/shared/sources/types.ts`

Files to Modify

- `packages/praxrr-app/src/lib/shared/pcd/display.ts`

Create canonical source metadata interfaces (`SourceRef`, source-kind discriminators, and
sourced-entity wrappers) and thread optional source fields into display row contracts used by custom
formats and quality profiles. Keep names explicit and Arr-safe (no sibling-app assumptions), and
avoid loosening existing row typing. Outcome: route loaders and UI components can consume source
metadata with strict TypeScript support.

#### Task 1.2: Add reusable source badge primitives Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`
- `packages/praxrr-app/src/lib/client/ui/arr/CustomFormatBadge.svelte`
- `docs/plans/trash-guide-sync-ux/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/ui/badge/SourceBadge.svelte`

Files to Modify

- `packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`

Add a source-focused badge abstraction that can render TRaSH/PCD provenance consistently in table
and card contexts. Extend the base badge variant map for source usage while preserving existing
badge behavior for Arr app variants. Outcome: source provenance rendering is centralized and
reusable before page integrations begin.

#### Task 1.3: Extend TRaSH entities API with source metadata-safe filtering Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`
- `docs/api/README.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`

Add query/handler support for returning normalized source metadata fields alongside entity payloads
needed by source-aware list views, while preserving current validation rules for `type`, pagination,
and `arrType` scope checks. Keep handler error mapping consistent with existing helper behavior and
do not introduce a new ingestion path. Outcome: listing pages can consume source-rich TRaSH entity
responses without bypassing current guardrails.

#### Task 1.4: Add source-grouped TRaSH sync hydration for Arr sync loader Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `docs/features/link-bridge-sync.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`

Introduce read helpers that expose per-source TRaSH sync config/selections for a given Arr instance
and hydrate these into the sync page load payload. Preserve `assertScope` semantics and existing
sync payload keys so non-TRaSH sections continue to behave identically. Outcome: Arr sync UI
receives complete source-grouped TRaSH data without changing persistence topology.

### Phase 2: Source-Aware Listing UX

#### Task 2.1: Build reusable source filter action control Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/actions/SearchAction.svelte`
- `packages/praxrr-app/src/lib/client/ui/actions/ViewToggle.svelte`
- `docs/plans/trash-guide-sync-ux/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/ui/actions/SourceFilterAction.svelte`

Create a composable source-filter control for ActionsBar usage (single/multi-select behavior per
spec, explicit active state, accessible labels). Keep props typed to the source metadata contracts
and avoid embedding page-specific logic. Outcome: custom formats and quality profiles can integrate
the same filter primitive with minimal duplication.

#### Task 2.2: Add source-aware data loading for custom formats routes Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/custom-formats/+page.server.ts`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts`
- `packages/praxrr-app/src/lib/server/trashguide/manager.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/custom-formats/+page.server.ts`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts`

Update server loads to include source-aware tab/filter context (including TRaSH source inventory and
all-sources affordance conditions) while preserving current database validation and error behavior.
Define explicit payload keys and invariants for downstream UI tasks:
`sourceContext.availableSources` (typed `SourceRef[]`), `sourceContext.showAllSourcesTab` (true only
when 2+ total sources), `sourceContext.defaultSourceKey` (stable source key), and
`sourceContext.filterDisabledReason` (nullable string for empty/mismatch cases). Keep existing PCD
data loading intact and append source metadata without breaking current page data contracts.
Outcome: custom formats client page can render source-aware controls with a stable, testable server
contract.

#### Task 2.3: Integrate source filters and badges in custom formats UI Depends on [1.2, 2.1, 2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte`

Wire source filtering into the existing ActionsBar/data-store flow and render source badges in both
table and card variants. Preserve current search/filter persistence behavior and keep empty-state
messaging clear for source-filtered zero-results cases. Outcome: custom formats page supports
source-aware browsing without regressing existing local search and view toggles.

#### Task 2.4: Add source-aware data loading for quality profiles routes Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/quality-profiles/+page.server.ts`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`
- `packages/praxrr-app/src/lib/server/trashguide/manager.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/quality-profiles/+page.server.ts`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`

Mirror the custom-format server-side source context strategy for quality profiles, including
tab/filter metadata and all-sources visibility rules. Reuse the exact `sourceContext` payload
interface from task 2.2 (`availableSources`, `showAllSourcesTab`, `defaultSourceKey`,
`filterDisabledReason`) so both pages stay contract-identical and share UI primitives without
branching logic. Maintain existing database lookup/error handling behavior and avoid separate
data-loading conventions between the two pages. Outcome: quality profiles page receives source-aware
data context aligned with custom formats and free of contract drift.

#### Task 2.5: Integrate source filters and badges in quality profiles UI Depends on [1.2, 2.1, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/TableView.svelte`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/TableView.svelte`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte`

Apply the same source filter and provenance badge integration pattern used in custom formats,
adapted for quality profile fields and row/card shape. Keep existing search/view persistence
behavior unchanged and surface source-filter result feedback consistently. Outcome: quality profiles
page reaches parity with custom formats for source-aware browsing.

### Phase 3: Arr Sync UX Integration and Verification

#### Task 3.1: Add TRaSH source section component to Arr sync page Depends on [1.2, 1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/TrashGuideSources.svelte`

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`

Introduce a source-grouped TRaSH sync section that follows existing section patterns (dirty
tracking, preview gating, and section-level save/sync controls). Render source badges and selection
context without disturbing quality/delay/media sections, and explicitly define UI state behavior for
loading, no-sources, filtered-empty, and server-error conditions (including deterministic section
ordering and dirty-state transitions in each state). Outcome: Arr sync page visually and
structurally supports TRaSH source-specific configuration with predictable behavior across edge
states.

#### Task 3.2: Wire TRaSH source save/sync actions into Arr sync flow Depends on [3.1, 1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`

Add/update server actions and query calls so Arr sync can persist source selections/config triggers
and trigger manual source sync using existing dedupe semantics. Ensure status/errors map cleanly to
UI feedback and keep scope checks fail-fast. Outcome: users can configure and run TRaSH source sync
from Arr sync page with predictable behavior.

#### Task 3.3: Expand route and query contract coverage for source-aware behavior Depends on [1.3, 1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`
- `docs/DEVELOPMENT.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`

Files to Create

- `packages/praxrr-app/src/tests/base/trashGuideSyncSourceScope.test.ts`

Add tests for source metadata response shape, arr-type mismatch rejection, and dedupe/manual sync
edge cases that this feature depends on. Keep tests isolated with existing patch-target patterns and
assert explicit status/body behavior. Outcome: backend and API contract regressions for source-aware
sync/listing are caught early.

#### Task 3.4: Add UI-facing regression coverage and end-to-end verification checklist Depends on [2.3, 2.5, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`
- `docs/plans/trash-guide-sync-ux/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`
- `docs/plans/trash-guide-sync-ux/verification-checklist.md`

Files to Modify

- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`

Add regression tests that validate source-filter persistence expectations, source badge visibility
invariants, and Arr sync section compatibility with existing navigation/scope behavior. Include
explicit assertions for “all sources” visibility rules and zero-result/empty-state handling. In
`verification-checklist.md`, define required verification items mapped to feature-spec criteria,
including command gates (`deno task check`, `deno task test`, targeted route test run) and manual UI
checks for source filter state persistence and dedupe conflict messaging. Outcome: the integrated UX
is protected by tests plus an explicit verification checklist tied to acceptance criteria.

## Advice

- Keep shared source metadata fields additive and stable; changing field names later will cause
  simultaneous breakage across two listing pages and Arr sync rendering.
- Treat `trashGuideSyncQueries.assertScope` as a hard boundary in every write/read path touched by
  this feature, especially when adding grouped source operations.
- Avoid introducing page-specific filter state models; use one reusable filter contract so custom
  formats and quality profiles stay behaviorally aligned.
- Sequence high-churn files carefully: land `display.ts` typing and server payload shape before
  touching listing views to reduce cascade refactors.
- Validate manual sync UX against dedupe semantics (409 running case) early, so UI action flows are
  built around real queue behavior instead of optimistic assumptions.
