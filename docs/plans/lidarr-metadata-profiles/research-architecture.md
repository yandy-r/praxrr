# Architecture Research: lidarr-metadata-profiles

## System Overview

Praxrr is organized around PCD-backed entities, sync section handlers, and Arr-specific clients; Lidarr metadata profiles fit naturally as another entity + sync section combination. The feature will extend the existing flow where UI/API writes create PCD operations, cache compilation materializes entity rows, and sync jobs push transformed state to Arr instances. The architecture already supports Arr-specific behavior gates, so metadata profiles should be added as a Lidarr-only path without sibling fallbacks.

## Relevant Components

- `src/lib/server/pcd/entities/delayProfiles/create.ts`: Minimal single-entity create pattern using `writeOperation` and metadata.
- `src/lib/server/pcd/entities/delayProfiles/update.ts`: Value-guard update pattern and rename-safe operation metadata.
- `src/lib/server/pcd/entities/qualityProfiles/index.ts`: Multi-part entity entrypoint pattern for list/get/update modules.
- `src/lib/server/pcd/entities/registry.ts`: Auto-align entity registration and table/key definitions.
- `src/lib/server/pcd/ops/writer.ts`: Canonical PCD operation writer used by all entity writes.
- `src/lib/server/pcd/database/cache.ts`: Cache access helpers and typed DB gateway used by entity reads.
- `src/lib/server/sync/types.ts`: Section contract (`SectionType`, `SectionHandler`, `InstanceSyncResult`).
- `src/lib/server/sync/registry.ts`: Section registration/discovery map used by processor.
- `src/lib/server/sync/processor.ts`: Runtime orchestration for trigger, claim, run, and completion/failure updates.
- `src/lib/server/sync/qualityProfiles/handler.ts`: Reference handler wiring section methods to `arrSyncQueries`.
- `src/lib/server/sync/qualityProfiles/syncer.ts`: End-to-end syncer pattern for read/transform/push/update outcomes.
- `src/lib/server/sync/delayProfiles/syncer.ts`: Smaller syncer pattern for single-profile-per-instance config.
- `src/lib/server/db/queries/arrSync.ts`: Persistence for section config, pending/claim/complete/fail state.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr API v1 client where metadata profile CRUD belongs.
- `src/lib/shared/arr/capabilities.ts`: User-facing workflow/sync surface gates per Arr app.
- `src/routes/arr/[id]/sync/+page.server.ts`: Sync config load/actions pattern that composes PCD + arrSync queries.
- `src/routes/delay-profiles/[databaseId]/new/+page.server.ts`: Typical server action validation/error handling flow.

## Data Flow

Metadata profile CRUD should follow the standard entity write path: route action validates inputs -> entity module compiles SQL with value guards -> `writeOperation` persists ops -> cache recompilation materializes rows in PCD tables. Sync configuration should store one selected metadata profile per instance (delay-profile model), then the sync processor picks pending jobs, claims section status, and invokes a metadata profile syncer. The syncer should read target profile rows from cache, transform into Lidarr `/api/v1/metadataprofile` payload shape, reconcile remote profiles by name (with namespace suffix handling), and mark sync completion/failure via `arrSyncQueries`.

## Integration Points

- Add a new PCD entity family under `src/lib/server/pcd/entities/metadataProfiles/` following delay/quality patterns.
- Extend shared PCD contracts in `src/lib/shared/pcd/types.ts`, `src/lib/shared/pcd/portable.ts`, and `src/lib/shared/pcd/display.ts`.
- Add a new sync section under `src/lib/server/sync/metadataProfiles/` and register it through `sync/types.ts`, `sync/mappings.ts`, `sync/registry.ts`, and `sync/processor.ts`.
- Extend `src/lib/server/db/queries/arrSync.ts` and app schema/migration files for metadata profile sync config/status.
- Extend `src/lib/server/utils/arr/clients/lidarr.ts` and `src/lib/server/utils/arr/types.ts` for metadata profile endpoints/payload types.
- Add API endpoints under `src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/` (new) and wire UI routes consistent with existing entity pages.

## Key Dependencies

- Internal: Kysely + SQLite PCD cache, PCD ops writer pipeline, sync registry/processor contracts, job queue handlers.
- Internal: Arr capability matrix (`supportsArrSyncSurface`) and sync section support matrix (`SUPPORTED_SYNC_SECTIONS`).
- External: Lidarr API v1 metadata profile endpoints (`GET/POST/PUT/DELETE /api/v1/metadataprofile`, `GET /schema`).
- External semantics: Lidarr-only entity rules and full type/status payload requirements from `docs/plans/lidarr-metadata-profiles/feature-spec.md`.
