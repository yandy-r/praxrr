# Pattern Research: trash-guide-sync-ux

## Architectural Patterns

**Manager Service Layer**: `TrashGuideManager` is the single orchestrator for fetching, parsing,
transforming, persisting, and scheduling TRaSH Guide data; it layers on top of the `$db/queries/*`
modules, uses the fetcher/parser/transformer helpers, and triggers job queue work so that routes
only need this facade.

- Example: /packages/praxrr-app/src/lib/server/trashguide/manager.ts

**SvelteKit Layout + Page UI Flow**: `+layout.server.ts` loads the TRaSH source via
`trashGuideManager` (including ID parsing/404 mapping) and passes it to a `+page.svelte` that
renders the overview, formats sync cadence, and dispatches `fetch` calls to enqueue sync jobs while
keeping local UI state and alerts.

- Example: /packages/praxrr-app/src/routes/databases/trash/[id]/+layout.server.ts
- Example: /packages/praxrr-app/src/routes/databases/trash/[id]/+page.svelte

**API Route + Helpers for Validation and Logging**: Each API route
(`/routes/api/v1/trash-guide/sources`) defines handlers that parse JSON, validate fields, and map
rich domain errors to HTTP statuses; shared `_helpers.ts` modules centralize ID parsing, status
mapping, error message extraction, and structured logging so every handler stays focused on its
operation.

- Example: /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts
- Example: /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/\_helpers.ts

**Job-Queue Sync Enqueue Guardrails**: The sync POST route first validates the source exists,
enforces a dedupe key on `jobQueueQueries`, responds with 409 when work is already running, and uses
`jobDispatcher.notifyJobEnqueued` once it actually schedules the `trashguide.sync` job.

- Example: /packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts

## Code Conventions

Route-specific UI lives under `packages/praxrr-app/src/routes/<feature>/...`, with `+page.svelte`
and `+page.server.ts` pairing, nested `components/` folders for shared widgets, and layout files for
shared data. Domain types, helpers, and error classes are prefixed with `TrashGuide...` (for
example, `TrashGuideSourceResponse`, `TrashGuideSourceConflictError`, `TrashGuideArrType`) inside
`$lib/server/trashguide/` so the scope is explicit. Imports favor path aliases (`$lib`, `$alerts`,
`$ui`, `$db`) over deep relative paths, components use PascalCase, helper functions use camelCase,
and database access is centralized in query modules (`$db/queries/<entity>.ts`) that export method
objects such as `trashGuideSourcesQueries`.

## Error Handling

Error propagation is fail-fast with typed domain errors. `TrashGuideManager` throws specific classes
(`TrashGuideSourceNotFoundError`, `TrashGuideSourceValidationError`, `TrashGuideFetcherError`,
`TrashGuideTransformError`), API routes map them through `mapReadErrorStatus`/`mapWriteErrorStatus`,
and unexpected failures are logged with structured metadata (`logTrashGuideRouteError`) before
returning user-facing messages. Client pages inspect status codes and show alerts via `alertStore`
(success/warning/error), preserving actionable feedback while keeping network failures visible.

## Testing Approach

Tests are organized under `packages/praxrr-app/src/tests/<area>/...` and exercise real SvelteKit
`RequestHandler`s for route-level behavior. Deno’s standard assertions are used with helper patching
(`patchTarget`) to mock singleton methods like `trashGuideManager.createSource`, then restored after
each test to prevent cross-test contamination. Similar tests should cover status mapping, payload
validation, dedupe behavior in sync enqueue, and selection persistence paths.

## Patterns to Follow

Follow the existing `/databases/trash/[id]` route architecture: load source context in
`+layout.server.ts`, keep page components focused on presentation and user interaction, and push
business rules into `trashGuideManager`/query modules. Reuse the current API error mapping pattern
in `/api/v1/trash-guide/sources/*` so all new endpoints return consistent 4xx/5xx semantics. For
sync controls, keep the dedupe + queue path through `jobQueueQueries` and `jobDispatcher` (do not
bypass with direct job writes), and keep UI state updates based on returned HTTP status to match
existing alert behavior.
