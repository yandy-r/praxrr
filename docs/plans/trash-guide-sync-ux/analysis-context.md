### Executive Summary

The `trash-guide-sync-ux` feature adds source-aware browsing and sync controls for TRaSH entities
across custom formats, quality profiles, and Arr sync pages without changing ingestion architecture.
Existing TRaSH cache and sync persistence (`trash_guide_entity_cache`, `trash_guide_sync_config`,
`trash_guide_sync_selections`) remain authoritative. The implementation should extend existing
Tabs + ActionsBar + DataPageStore UI patterns and keep Arr-type scope enforcement intact.

### Architecture Context

- System Structure: `trashGuideManager` drives source lifecycle and sync orchestration; query
  modules back cached reads/writes; feature routes compose UI and API surfaces.
- Data Flow: sources and parsed entities land in TRaSH tables, listing routes consume cached
  entities, sync pages read/write per-instance per-source config/selections, manual sync triggers
  enqueue `trashguide.sync` jobs.
- Integration Points: listing routes (`custom-formats`, `quality-profiles`), Arr sync route
  (`arr/[id]/sync`), TRaSH source API routes, sync job handler, and sync query scope checks.

### Critical Files Reference

- `packages/praxrr-app/src/lib/server/trashguide/manager.ts`: source lifecycle, sync trigger
  orchestration.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`: TRaSH cached entity
  reads/writes.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: sync config/selections + Arr
  scope enforcement.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`:
  source-scoped entity list contract.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`: manual sync
  trigger + queue dedupe.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: listing shell extension
  point.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: parallel listing
  shell extension point.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: sync data aggregation for Arr
  config UI.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: sync UI composition and save/preview
  controls.

### Patterns to Follow

- Pattern: Manager-service orchestration with thin routes; keep route handlers focused on
  parse/validate/map errors.
- Pattern: Tabs + ActionsBar + `createDataPageStore` for filter/search/view composition in listing
  pages.
- Pattern: Arr-type guard (`trashGuideSyncQueries.assertScope`) on all TRaSH sync reads/writes.
- Pattern: Job queue dedupe for manual sync triggers instead of direct execution.

### Cross-Cutting Concerns

- Security: preserve auth + scoping behavior on all new route inputs and filtered responses.
- Performance: reuse cache tables and server-side filtering; avoid introducing new ingestion or
  expensive fan-out fetches.
- Testing: add coverage for source-aware listing/sync paths and regression coverage for existing
  per-database behavior.

### Parallelization Opportunities

- Independent work areas: frontend source-filter/badge UI, backend query/API shape updates, Arr sync
  page rendering updates.
- Coordination hotspots: shared response/type contracts between listing routes and UI stores;
  unified source metadata fields across pages.

### Implementation Constraints

- Preserve dual persistence behavior (PCD sync state and TRaSH sync selections in current tables).
- Do not add new TRaSH ingestion paths; consume existing cache/job system.
- Keep strict Arr-type compatibility checks for source/instance scope.
- Maintain current route/error semantics for `/api/v1/trash-guide/sources/*`.

### Planning Recommendations

- Organize phases as: foundation contracts/types, cross-source UI integration, sync-page
  refinement + verification.
- Lock API/query payload shape early so frontend tasks can run in parallel with minimal rework.
- Keep high-churn shared files (`display` typing, listing page shells, sync server loader)
  coordinated explicitly.
