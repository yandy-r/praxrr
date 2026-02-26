# trash-guide-sync-ux

The feature sits at the intersection of three existing layers: TRaSH ingestion
(`trashGuideManager` + cache tables), entity browsing routes (`custom-formats` and
`quality-profiles`), and Arr sync orchestration (`arr/[id]/sync` + job queue). TRaSH data is already
normalized into `trash_guide_entity_cache` and synchronized through `trashguide.sync` jobs, so the
UX work should reuse those persisted artifacts instead of introducing new ingestion paths. On the
frontend, the existing Tabs + ActionsBar + DataPageStore pattern provides the extension point for
adding source-aware filters, badges, and “all sources” aggregation while preserving current
per-database flows. Integration must keep Arr-type scoping strict
(`trashGuideSyncQueries.assertScope`) and maintain dual persistence paths where PCD sync state and
TRaSH sync selections remain stored in their current tables.

## Relevant Files

- /packages/praxrr-app/src/hooks.server.ts: Startup wiring for config, DB, managers, and job
  initialization.
- /packages/praxrr-app/src/lib/server/trashguide/manager.ts: Core TRaSH source lifecycle, sync, and
  trigger orchestration.
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts: TRaSH cached entity
  reads/writes by source and type.
- /packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts: TRaSH sync config and selection
  persistence with scope checks.
- /packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts: Background `trashguide.sync`
  execution and retry/schedule handling.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts: Source CRUD contract and
  status/error mapping.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts: Entity
  listing API with type/search filters.
- /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts: Manual sync
  trigger with dedupe and queue integration.
- /packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte: Entity-listing UX shell
  (tabs, actions, table/card views).
- /packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte: Parallel listing UX
  shell for quality profiles.
- /packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts: Aggregates per-source sync data for
  Arr instance config UI.
- /packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte: Sync UI composition point for
  source-grouped selections.

## Relevant Tables

- trash_guide_sources: Linked TRaSH repository metadata and sync status.
- trash_guide_entity_cache: Parsed TRaSH entities used by list and sync UIs.
- trash_guide_sync_config: Per instance/source sync trigger and schedule state.
- trash_guide_sync_selections: Per instance/source selected sync items.
- trash_id_mappings: TRaSH ID to entity-name mappings for change detection.
- arr_instances: Arr app targets used for Arr-type scoping and sync dispatch.

## Relevant Patterns

**Manager-Service Orchestration**: Route handlers stay thin and delegate TRaSH lifecycle logic to
manager/query modules. See
[/packages/praxrr-app/src/lib/server/trashguide/manager.ts](/packages/praxrr-app/src/lib/server/trashguide/manager.ts).

**Route Helper Error Mapping**: API routes parse/validate input, then map domain errors to stable
HTTP statuses via shared helpers. See
[/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/\_helpers.ts](/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/_helpers.ts).

**Tabs + ActionsBar Listing Shell**: Entity pages compose tabs, search/actions, and table/card
renderers around `createDataPageStore`. See
[/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte](/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte).

**Job Queue Dedupe for Sync Triggering**: Manual and scheduled sync both use dedupe keys and queue
APIs instead of direct execution. See
[/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts](/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts).

**Arr-Type Scope Enforcement**: TRaSH sync reads/writes must validate instance/source app-type
compatibility before persistence. See
[/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts](/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts).

## Relevant Docs

**/docs/plans/trash-guide-sync-ux/feature-spec.md**: You _must_ read this when working on
multi-source UX behavior, tab/filter expectations, and sync UX acceptance criteria.

**/docs/plans/trash-guide-sync/research-technical.md**: You _must_ read this when working on TRaSH
API/table contracts, job flow, and backend integration boundaries.

**/docs/ARCHITECTURE.md**: You _must_ read this when touching startup flow, managers, job system, or
shared persistence architecture.

**/docs/api/README.md**: You _must_ read this when modifying `/api/v1` route contracts, status
semantics, or auth expectations.

**/docs/features/link-bridge-sync.md**: You _must_ read this when adjusting sync configuration UX so
behavior stays aligned with existing Link/Bridge/Sync workflows.

**/docs/DEVELOPMENT.md**: You _must_ read this when preparing verification scope, commands, and
contribution workflow for follow-up implementation.
