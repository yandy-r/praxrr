# Sync Preview / Dry-Run

The sync pipeline transforms PCD desired state into Arr API payloads through four registered sections (qualityProfiles, delayProfiles, mediaManagement, metadataProfiles), each following a handler/syncer/transformer pattern where all concrete syncers override `sync()` entirely rather than using the BaseSyncer template methods. Preview intercepts after the transform phase by adding parallel `generatePreview()` methods that reuse existing pure transformer functions (`transformQualityProfile`, `transformCustomFormatWithDiagnostics`, delay `transform()`, metadata `buildPayload()`) and PCD query functions, then diffs transformed payloads against live Arr remote state fetched via read-only GET endpoints on `BaseArrClient`. The cleanup module's `scanForStaleItems()` / `deleteStaleItems()` two-phase pattern and its API at `/api/v1/arr/cleanup` are the strongest architectural precedent, mapping 1:1 to preview/apply.

## Relevant Files

- `packages/praxrr-app/src/lib/server/sync/processor.ts`: Sync orchestrator with `syncInstance()` and `processPendingSyncs()`; preview orchestrator follows this structure
- `packages/praxrr-app/src/lib/server/sync/base.ts`: Abstract `BaseSyncer` class; all syncers override `sync()`, template methods are unused stubs
- `packages/praxrr-app/src/lib/server/sync/types.ts`: Core sync types (`SyncResult`, `SectionHandler`, `SectionType`, `InstanceSyncResult`); preview types extend this
- `packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry; `hasConfig(instanceId)` determines which sections to preview
- `packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Two-phase scan/execute pattern; direct precedent for preview/apply
- `packages/praxrr-app/src/lib/server/sync/namespace.ts`: Zero-width Unicode suffix system; preview must match on suffixed names, display stripped names
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`: Section support checks via `isSyncSectionSupported(arrType, section)` and quality/language mappings
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Most complex syncer; CF-before-QP ordering, multi-database batch grouping, namespace suffixing
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: Pure functions: `transformQualityProfile()`, `fetchQualityProfileFromPcd()`, `getReferencedCustomFormatNames()`, `getQualityApiMappings()`
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: `syncCustomFormats()` function; creates/updates CFs by suffixed name match, returns `pcdFormatIdMap`
- `packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: Pure functions: `transformCustomFormatWithDiagnostics()`, `fetchCustomFormatFromPcd()`; handles Lidarr condition filtering
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: Single profile sync; always update (never create); Lidarr resolves default at runtime
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: Three sub-sections (media settings, naming, quality definitions); GET-merge-PUT pattern, only managed fields change
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: Lidarr-only; `buildPayload()` pure function, schema normalization with fallback
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient` with all GET/POST/PUT/DELETE methods; preview uses only GETs
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: `getArrInstanceClient()` factory with credential decryption and optional caching
- `packages/praxrr-app/src/lib/server/utils/arr/types.ts`: Arr API types (`ArrCustomFormat`, `RadarrQualityProfile`, `ArrDelayProfile`, `ArrMediaManagementConfig`, `ArrNamingConfig`, `ArrQualityDefinition`)
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: `LidarrClient` with `getMetadataProfiles()` and `getMetadataProfileSchema()`
- `packages/praxrr-app/src/lib/server/pcd/index.ts`: Public PCD API; `getCache(databaseId)` returns `PCDCache`
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` class with Kysely query builder for in-memory SQLite
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Sync config queries; `getFullSyncData(instanceId)` retrieves all section configs
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance queries; `getById(instanceId)` for validation
- `packages/praxrr-app/src/lib/server/db/queries/arrNamespaces.ts`: Namespace management; `getOrCreate(instanceId, databaseId)` for suffix index
- `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: In-memory TTL cache pattern for preview store implementation
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Job handler for sync execution; preview bypasses job queue (synchronous)
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: Cleanup API with scan/execute pattern; direct template for preview API
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Sync config UI server-side logic; preview adds new UI entry point
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Sync config page UI
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`: Footer with trigger toggles, Save, Sync Now; preview adds a "Preview" button
- `packages/praxrr-app/src/lib/server/sync/index.ts`: Module barrel exports; add preview re-exports
- `docs/api/v1/openapi.yaml`: OpenAPI 3.1.0 root spec; add sync preview path references
- `docs/api/v1/paths/arr.yaml`: Cleanup endpoint pattern as contract precedent
- `docs/api/v1/schemas/arr.yaml`: Cleanup schemas (StaleItem, CleanupScanResult) as type precedent

## Relevant Tables

- `arr_instances`: Arr instance connections (id, name, type, url, enabled); validated before preview
- `arr_sync_quality_profiles`: Many-to-many selections (instance_id, database_id, profile_name); preview reads selections
- `arr_sync_quality_profiles_config`: Per-instance QP trigger config and sync_status; preview reads status, NEVER modifies
- `arr_sync_delay_profiles_config`: Single delay profile selection per instance with trigger config
- `arr_sync_media_management`: Three sub-section configs (naming, quality_definitions, media_settings) each with database_id + config_name
- `arr_sync_metadata_profiles_config`: Lidarr-only metadata profile selection with trigger config
- `arr_database_namespaces`: Namespace index per (instance_id, database_id) for zero-width suffix generation
- `database_instances`: Registered PCD database connections; validated for stale references

## Relevant Patterns

**Section Registry Pattern**: Sync sections register as `SectionHandler` objects in a global Map via `registerSection()`. Use `hasConfig(instanceId)` to determine which sections to preview, `createSyncer()` to get syncer instances. See [registry.ts](packages/praxrr-app/src/lib/server/sync/registry.ts).

**Scan-then-Execute Two-Phase**: The cleanup module separates `scanForStaleItems()` (read-only, returns `CleanupScanResult`) from `deleteStaleItems()` (destructive). The API uses an `action` discriminator on a single POST. Preview/apply follows this exactly. See [cleanup.ts](packages/praxrr-app/src/lib/server/sync/cleanup.ts) and [cleanup API](packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts).

**Syncer Override Pattern**: All four syncers override `sync()` entirely with inline fetch+transform+push logic; `BaseSyncer` template methods are dead stubs. Preview adds parallel `generatePreview()` methods sharing internal helpers but composing results differently. See [qualityProfiles/syncer.ts](packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts).

**Namespace Suffix Isolation**: Multi-database support uses zero-width Unicode chars appended to entity names. Match by suffixed name, display stripped name. `getNamespaceSuffix(index)`, `stripNamespaceSuffix(name)`, `hasNamespaceSuffix(name)`. See [namespace.ts](packages/praxrr-app/src/lib/server/sync/namespace.ts).

**Pure Transformer Functions**: `transformQualityProfile()`, `transformCustomFormatWithDiagnostics()`, `fetchQualityProfileFromPcd()`, `fetchCustomFormatFromPcd()`, `getQualityApiMappings()` are pure/read-only and directly reusable by preview without modification. See [QP transformer](packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts) and [CF transformer](packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts).

**In-Memory TTL Cache**: `$cache/cache.ts` provides a Map-based cache with expiration timestamps, `get()`/`set()`/`delete()`/`cleanup()` methods. Preview store follows this pattern. See [cache.ts](packages/praxrr-app/src/lib/server/utils/cache/cache.ts).

**Arr Client Lifecycle**: Create via `getArrInstanceClient()`, use `{ retries: 0 }` for fail-fast, always `client.close()` in `finally`. See [cleanup API](packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts).

**Contract-First API**: Per CLAUDE.md, define OpenAPI spec first, generate types via `deno task generate:api-types`, then implement endpoints. Preview must create `docs/api/v1/paths/sync.yaml` and `docs/api/v1/schemas/sync.yaml` before implementation.

**Logging Convention**: Async logger with `{ source: 'Sync:SectionName', meta: { instanceId, ... } }`. Preview should use `'Preview'` and `'Preview:QualityProfiles'` etc. See [logger.ts](packages/praxrr-app/src/lib/server/utils/logger/logger.ts).

## Relevant Docs

**CLAUDE.md**: You _must_ read this when working on any implementation -- covers path aliases, Cross-Arr Semantic Validation Policy (required checklist for Arr-touching changes), contract-first API requirement, Svelte 5 conventions, formatting standards.

**docs/plans/sync-preview-dry-run/feature-spec.md**: You _must_ read this when implementing any preview component -- complete architecture, data models (`SyncPreviewResult`, `EntityChange`, `FieldChange`), API design (POST/GET/DELETE/apply endpoints), UX workflows, phased task breakdown, and risk assessment.

**docs/plans/sync-preview-dry-run/research-technical.md**: You _must_ read this when working on the diff engine, preview types, or API design -- deep sync pipeline analysis, files to create/modify, five key technical decisions with rationale.

**docs/plans/sync-preview-dry-run/research-business.md**: You _must_ read this when implementing business rules or edge case handling -- 10 business rules, edge case matrix, domain model, staleness handling workflow.

**docs/plans/sync-preview-dry-run/research-ux.md**: You _must_ read this when building the preview UI -- diff visualization standards, color coding (green/amber/red with triple-encoding), 4-level information hierarchy, confirmation tiers, accessibility requirements (WCAG 2.2).

**docs/plans/sync-preview-dry-run/research-external.md**: You _must_ read this when working with Arr APIs or the diff library -- Arr endpoint inventory per app, microdiff evaluation, IaC format precedents.

**docs/plans/sync-preview-dry-run/research-recommendations.md**: Reference for phasing strategy, technology choices, quick wins, and alternative approaches considered.

**docs/api/v1/openapi.yaml**: Reference for OpenAPI spec structure and where to add new preview paths.

**docs/api/v1/paths/arr.yaml**: Reference for the cleanup endpoint two-phase pattern that preview API should follow.

**docs/api/v1/schemas/arr.yaml**: Reference for cleanup schema definitions as a type contract precedent.
