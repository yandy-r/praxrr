> [!WARNING]
> Superseded on 2026-02-15 by the first-class Lidarr initiative plan in `docs/plans/enhance-lidarr-support/parallel-plan.md` (tracked by GitHub issue #130 and umbrella #13).
>
> This document captures the legacy Sonarr-reuse rollout model and is retained for historical context only. Do not use it for current implementation planning.

# Pattern Research: lidarr-support

## Architectural Patterns

**Section-based sync handler + registry**: Each sync concern (quality profiles, delay profiles, media management) registers a handler that talks to `arr_sync*` tables, claims runs, and instantiates a dedicated syncer tailored to the Arr type. The media-management handler delegates to `MediaManagementSyncer`, which fetches the arr-specific config, runs each sub-sync (media settings, naming, quality definitions), and logs capability gating for Lidarr.

- Example: `src/lib/server/sync/mediaManagement/handler.ts` / `src/lib/server/sync/mediaManagement/syncer.ts`

**PCD entity modules per feature + arr type**: Media-management entities live under `src/lib/server/pcd/entities/mediaManagement/{naming,media-settings,quality-definitions}` where each arr type has its own `read.ts`, `create.ts`, `update.ts`, and `delete.ts`, all re-exported from an `index.ts`. Importers (routes, deserialization, syncers) pick the arr namespace they need, pass a typed `OperationLayer`, and rely on `writeOperation` metadata for auditability.

- Example: `src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts` and `src/lib/server/pcd/entities/deserialize.ts`

**Arr-type–aware routing/UI**: The media-management UI rides under `/media-management/[databaseId]/media-settings/{radarr,sonarr}` and dispatches form submissions with `arrType`/`layer` validation, `pcdManager` cache lookup, and redirects back to the listing. Views render logos and routes based on `arr_type` from the PCD list item, making it easy to extend for new arr types once the data exists.

- Example: `src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts` and `src/routes/media-management/[databaseId]/media-settings/radarr/[name]/+page.server.ts`

## Code Conventions

PCD operations follow a strict naming schema: `createRadarrNaming`, `updateSonarrMediaSettings`, `removeRadarrQualityDefinitions`, etc., with the arr prefix indicating the target table. Each action checks for duplicates via case-insensitive comparisons, throws specific errors (e.g., “already exists”), and calls `writeOperation` with `description`, `desiredState`, and `metadata`. Server routes enforce `databaseId` parsing, `pcdManager.getCache`, `OperationLayer` permissions (`canWriteToBase`), and catch thrown errors to emit HTTP-friendly `fail` responses before redirecting. Shared helpers (e.g., `colonReplacementToDb`, `multiEpisodeStyleToDb`) keep UI values aligned with DB enums, and `media management` lists reuse the same `MediaSettingsListItem` type from `src/lib/shared/pcd/display.ts`.

## Error Handling

Server-side routes consistently validate inputs, return `fail(400)` for missing/invalid data, and escalate unexpected conditions with `fail(500)` after inspecting the caught `Error.message`. When a rename is detected, they update `arr_sync_media_management` to keep the sync config name in sync. Syncers log through `logger` at `info/debug/warn` granularity, capturing metadata such as unsupported Lidarr fields or missing PCD cache, and they wrap each sub-sync in try/catch so a failure (message derived from `Error`) populates the aggregated `SyncResult`. Lidarr-specific warnings cite reusable constants (e.g., `LIDARR_UNSUPPORTED_FIELD_REASON`) so capability gates stay auditable.

## Testing Approach

Unit and integration tests live under `src/tests/` and favor `Deno.test` suites that assert Arr capability logic (e.g., `getUnsupportedSyncSectionReason` always permitting Lidarr media management). Handler tests stub DB queries and job queues to assert statuses, while base tests (e.g., `src/tests/base/lidarrApiParity.test.ts`) patch `LidarrClient` methods, trigger syncs, and confirm the code skips unsupported conditions. Jobs tests like `src/tests/jobs/lidarrSync.test.ts` cover pure functions (`isSyncSectionSupported`, `SYNC_SECTION_ORDER`) and handler behavior for disabled instances, providing a template for future Lidarr-focused guards.

## Patterns to Follow

Reuse existing entities when Lidarr lacks first-class tables: the syncer reads from `sonarr_naming`/`sonarr_media_settings` and capability-gates unsupported fields (logging missing/unchanged keys, reusing generic `applyConfigUpdates`), so new UI routes should follow the same “route-by-arr-type” structure but handle Lidarr by mapping to Sonarr paths until dedicated tables exist. Any new creation/update logic should follow the `writeOperation` + metadata pattern, guarding against duplicates, honoring `OperationLayer`, and using shared helper imports (e.g., `PropersRepacks` from `$shared/pcd/mediaManagement.ts`). Testing should mirror existing strategies—importing job registries, swapping query implementations, and asserting both happy paths and capability-gated skips (see `src/tests/jobs/lidarrSync.test.ts` for guidance).

Next steps: 1. Extend the `/media-management/...` routes/views to surface Lidarr configs by reusing Sonarr entity data until dedicated tables exist; 2. Add Lidarr paths (e.g., `/media-management/[databaseId]/media-settings/lidarr/...`) that follow the same validation + `writeOperation` workflow; 3. Mirror the syncer’s capability-gating/logging for Lidarr naming, quality, and media settings so new UI surfaces are backed by the established sync + testing patterns.
