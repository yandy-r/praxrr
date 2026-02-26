# Architecture Research: trash-guide-sync-ux

## System Overview

The Deno 2.x + SvelteKit runtime in `packages/praxrr-app` boots via `hooks.server.ts`, which loads
config, initializes the SQLite-backed app DB/migrations, starts the PCD cache manager, spins up the
TRaSH guide manager, and registers the job queue + scheduler that keeps Arr syncs and TRaSH pulls
running (`packages/praxrr-app/src/hooks.server.ts:17-80`). UI routes are under
`packages/praxrr-app/src/routes/*` and mostly mirror that server structure: entity listings live in
`custom-formats`, `quality-profiles`, `media-management`, and `metadata-profiles`, while the Arr
sync surface lives in `routes/arr/[id]/sync`; they all reuse shared UI atoms (`Tabs`, `ActionsBar`,
`SearchAction`, `ViewToggle`, etc.) built in `$ui/` to keep the UX consistent.

## Relevant Components

- `/packages/praxrr-app/src/hooks.server.ts:17-80`: bootstraps config/migrations, initializes
  `pcdManager` and `trashGuideManager`, and wires the job queue so background TRaSH pulls and Arr
  sync jobs run before any request is served.
- `/packages/praxrr-app/src/lib/server/trashguide/manager.ts:1-220`: links TRaSH Git repos,
  validates inputs, records sources in `trash_guide_sources`, orchestrates clones/pulls via
  `$utils/git`, parses with `parser.ts`, transforms via `$lib/server/trashguide/transformer.ts`,
  writes into the cache tables, and calls `triggerSyncs` so Arr sync sections rerun once new TRaSH
  data arrives.
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts:1-230`: stores
  per-source, per-entity-type JSON blobs and metadata (CFs, quality profiles, naming, quality sizes)
  that the new “All Sources” UX and Arr sync selectors will read, so TRaSH data can be queried
  without re-parsing the Git repo on every request.
- `/packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts:1-220`: exposes the schema for
  `trash_guide_sync_config`/`_selections`, including scope validation against `arr_instances`, so
  the sync page can persist TRaSH selections separately from legacy `arr_sync_*` tables while
  enforcing Arr-type alignment.
- `/packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts:1-220`: the `trashguide.sync`
  job handler that the scheduler enqueues; it validates schedule state, calls
  `trashGuideManager.checkForUpdates()`/`sync()`, updates sync metadata
  (`trashGuideSourcesQueries.updateSyncMetadata`), and reschedules or retries via
  `calculateNextRunFromMinutes`.
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte:1-200`: canonical entity
  listing view with `Tabs` for each database, `ActionsBar` search/filter controls, and
  `TableView`/`CardView` outputs; `createDataPageStore` persists view/search state, so the new “All
  Sources” tab can reuse the same store & action components while injecting TRaSH badges/filters.
- `/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte:1-200`: same shell as
  custom formats (Tabs, ActionsBar, ViewToggle) but for quality profiles, providing the pattern for
  source-filter toggles plus the cloning/export workflows that the TRaSH UX extensions must
  preserve.
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte:1-200`: arr sync config page that
  composes `QualityProfiles`, `DelayProfiles`, `MediaManagement`, `SyncFooter`, and
  `SyncPreviewPanel`, sharing dirty tracking and preview state; data arrives via the server load
  which glues together `pcdManager` caches (quality/delay/media/metadata entities) with `arrSync`
  persistence data.
- `/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts:1-120`: CRUD entry point
  for linking TRaSH repos, validates user payloads, invokes `trashGuideManager` methods, and
  surfaces conflicts, validation, and Git/transform errors through typed HTTP statuses so the UX can
  show precise feedback.

## Data Flow

1. **Backend ingestion:** `trashGuideManager` clones/pulls TRaSH Git repos (using `$utils/git`),
   hands raw JSON to `parser.ts`, feeds parsed entities into
   `trashGuideEntityCacheQueries.replaceSourceCache`, and then writes metadata into
   `trashGuideSources`/`trashGuideSync` so the rest of the system treats TRaSH data like any other
   cache. When updates are detected, the manager calls `triggerSyncs` so the usual Arr sync pipeline
   sees `should_sync` flags just like a PCD database change
   (`packages/praxrr-app/src/lib/server/trashguide/manager.ts:1-220` /
   `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts:1-230` /
   `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts:1-220`).
2. **Background scheduling:** `jobs/schedule.ts` enqueues `trashguide.sync` via `jobQueueRegistry`,
   and the handler in `jobs/handlers/trashGuideSync.ts` validates the payload, checks the Git clone
   via `trashGuideManager.checkForUpdates()`, records sync metadata, and either reschedules (using
   `calculateNextRunFromMinutes`) or retries on transient Git/network errors before handing control
   back to Arr sync once `triggerSyncs` fires.
3. **UI surfaces:** Entity pages call `pcdManager.getAll()`/`getCache()` and list entities via query
   modules (`packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.server.ts` /
   `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.server.ts`). The Arr sync
   page’s load function acts as the canonical data aggregator, collecting
   `arrSyncQueries.getFullSyncData`, per-database profile lists (quality, delay, naming, quality
   definitions, media settings, metadata) from the PCD caches, and preview state from
   `$sync/preview/store.ts` (`packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts:1-240`).
   The new TRaSH UX will layer in data from `trashGuideEntityCache` and
   `trashGuideManager.listSources()` so “All Sources”/per-source filters and the TRaSH sync sections
   share the same front-end plumbing as existing database tabs.

## Integration Points

The new “All Sources” tab and source filters should plug into the existing Tabs/ActionsBar pattern
from `custom-formats` and `quality-profiles`, reusing `SearchAction`, `ViewToggle`, and
`createDataPageStore` while adding source badges that drive filter state stored in `localStorage`
alongside search + view mode. Aggregating data requires combining `pcdManager.getCache(id)` output
with TRaSH rows from `trashGuideEntityCache` (for CFs/quality profiles/naming) and source metadata
from `trashGuideManager.listSources()` or `trashGuideEntityCacheQueries.getBySource()`, so the load
actions will need to fetch both PCD data and TRaSH cache rows before rendering. On the Arr sync
side, add TRaSH sections in `arr/[id]/sync/+page.svelte` that read persisted selection state from
`trashGuideSyncQueries` (to mirror how `arrSync` persists per-section selections) and use the same
`SyncFooter`/preview wiring so the UX for saving/syncing remains unified. All backend interactions
(sync toggles, manual sync triggers) can reuse the existing `/api/v1/trash-guide/sources/*` routes
plus `trashGuideManager` methods to keep validation, git fetch, and sync metadata centralized, and
the scheduler/job handler already ensures `trashguide.sync` updates the cache so the UI never shows
stale data.

## Key Dependencies

- Deno 2.x runtime with Svelte 5 + SvelteKit (`@sveltejs/kit`, `sveltekit-adapter-deno`, `vite`) for
  server rendering, routing, and build tooling.
- SQLite via `@jsr/db__sqlite`/`better-sqlite3` plus `kysely` for typed queries (`$db/queries/*`)
  powering `pcdManager`, `trashGuide*` tables, and `arrSync` persistence.
- `croner` for job scheduling, `jobQueue` infrastructure under `$lib/server/jobs`, and
  `calculateNextRun*` helpers that manage TRaSH sync cadence.
- Shared UI primitives in `$ui/` (Tabs, ActionsBar, Toggle, modal components) combined with
  `lucide-svelte` icons and Tailwind v4 for consistent action bars, badges, and responsive layouts.
- `trashGuide` modules (`fetcher.ts`, `parser.ts`, `transformer.ts`, `types.ts`) plus `$utils/git`
  to turn TRaSH Git JSON into in-app caches without disrupting the existing PCD workflow.
