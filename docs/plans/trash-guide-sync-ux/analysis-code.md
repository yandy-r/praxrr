### Executive Summary

Code structure favors incremental extension: TRaSH lifecycle is centralized in manager/query
modules, listing pages share a reusable UI shell, and sync orchestration already models sectioned
save/preview flows. This enables feature delivery by layering source metadata and filters onto
established patterns rather than introducing new subsystems. Main risk is contract drift across
shared types and route payloads consumed by multiple pages.

### Related Components

- `packages/praxrr-app/src/lib/server/trashguide/manager.ts`: orchestration for source sync, cache
  refresh, and trigger behavior.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: scope-checked config/selections
  persistence.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts`: cache query surface for
  source/entity filtering.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`: list
  endpoint parsing/filtering.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts`: sync trigger
  API + queue dedupe.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: tabs/actions/list view
  baseline.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: same baseline for
  quality profiles.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: server aggregation for sync page.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: section composition + footer/preview
  behavior.

### Implementation Patterns

**Manager-led TRaSH lifecycle**: backend writes and sync orchestration remain in manager/query
layer.

- Example: `packages/praxrr-app/src/lib/server/trashguide/manager.ts:345`
- Apply to: backend data/precondition tasks and sync trigger wiring.

**Tabs + ActionsBar + DataPageStore shell**: extend existing list pages with new source controls.

- Example: `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte:2`
- Apply to: filter UX, source badges, all-sources view wiring.

**Arr-type scoped persistence guard**: enforce source-instance app compatibility on every sync
write/read.

- Example: `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts:159`
- Apply to: sync config updates, selection writes, aggregated sync reads.

**Queue dedupe handshake for manual sync**: treat existing queue state as first-class UX state.

- Example: `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts:30`
- Apply to: manual sync affordances and status messaging.

### Integration Points

#### Files to Create

- `packages/praxrr-app/src/lib/shared/sources/sourceRef.ts`: source metadata contract used across
  routes/UI.
- `packages/praxrr-app/src/lib/client/ui/badge/SourceBadge.svelte`: source-provenance UI wrapper.
- `packages/praxrr-app/src/lib/client/ui/actions/SourceFilter.svelte`: reusable source filter
  control for listing shells.

#### Files to Modify

- `packages/praxrr-app/src/lib/shared/pcd/display.ts`: extend display typing to carry source
  metadata.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`: inject source
  filters/badges into listing flow.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`: mirror source-aware
  listing behavior.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: include source-scoped sync data in
  load payload.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: render source-grouped sync
  controls/summary.
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts`: optionally
  support multi-source metadata responses.
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`: add helpers for source-grouped
  sync hydration.

### Conventions

- naming: keep explicit `TrashGuide*`/source-oriented naming in new server and shared types.
- error handling: fail fast in handlers, map domain errors to stable statuses, log server failures
  with context.
- testing: use existing Deno task workflow (`check`, `lint`, `test`) and add focused coverage for
  source-aware paths.

### Gotchas and Warnings

- `assertScope` failures will surface if any mixed Arr-type source data leaks into write/read
  operations.
- Manual sync endpoint can return dedupe conflicts when a run is already active; UI must represent
  this cleanly.
- Cache replacement is full-source replace, so consumers should not assume incremental mutation
  semantics.
- Sync state spans config + selections tables; updates must maintain both consistently.

### Task Guidance by Area

- database: introduce query helpers that preserve scope checks and existing table boundaries.
- api: evolve payloads with backward-safe field additions and consistent validation semantics.
- ui: add source controls via existing shell components and preserve current per-database
  navigation/dirty behavior.
