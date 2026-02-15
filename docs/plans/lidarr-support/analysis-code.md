> [!WARNING]
> Superseded on 2026-02-15 by the first-class Lidarr initiative plan in `docs/plans/enhance-lidarr-support/parallel-plan.md` (tracked by GitHub issue #130 and umbrella #13).
>
> This document captures the legacy Sonarr-reuse rollout model and is retained for historical context only. Do not use it for current implementation planning.

### Executive Summary

The media-management stack is already modular by entity and arr type, which makes Lidarr support a targeted extension rather than a new subsystem. Route actions currently gate `arrType` to Radarr/Sonarr and entity modules read/write only Radarr/Sonarr tables, so Lidarr never appears in UI flows. The syncer already handles Lidarr through capability-gated reuse, so code changes should align UI CRUD and portable contracts with that existing behavior.

### Related Components

- `/src/routes/media-management/[databaseId]/naming/+page.server.ts`: naming list load path.
- `/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`: naming create action arr-type gate and dispatch.
- `/src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts`: quality definitions list load path.
- `/src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts`: quality definitions create action arr-type gate.
- `/src/routes/media-management/[databaseId]/media-settings/+page.server.ts`: media settings list load path.
- `/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`: media settings create action arr-type gate.
- `/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: naming list/read combines Radarr/Sonarr only.
- `/src/lib/server/pcd/entities/mediaManagement/naming/create.ts`: naming create helpers for Radarr/Sonarr.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`: media settings list/read for Radarr/Sonarr.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`: media settings create helpers for Radarr/Sonarr.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: quality list and quality API mapping lookups.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts`: quality definitions create helpers.
- `/src/lib/server/sync/mediaManagement/syncer.ts`: Lidarr Sonarr-reuse behavior and unsupported-field gating.
- `/src/lib/shared/pcd/portable.ts`: entity type list used by import/export paths.
- `/docs/api/v1/schemas/pcd.yaml`: public schema contract for portable entity types.

### Implementation Patterns

**Arr-Type Validation Gate**: Actions validate `arrType` before invoking writes and return `fail(400)` on unsupported types.

- Example: `/src/routes/media-management/[databaseId]/naming/new/+page.server.ts:40`
- Apply to: naming/media-settings/quality-definitions `new` and edit actions.

**Per-Arr CRUD Modules**: Entity folders keep arr-specific helpers and aggregated list/query logic.

- Example: `/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:12`
- Apply to: list/create/update/delete support for Lidarr branches.

**Quality Mapping Lookup**: Quality availability and API names derive from `quality_api_mappings` by `arr_type`.

- Example: `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts:17`
- Apply to: Lidarr quality-definition creation, listing, and sync compatibility.

**Sync Capability Gating**: Lidarr sync path reuses Sonarr entities and logs skipped unsupported fields.

- Example: `/src/lib/server/sync/mediaManagement/syncer.ts:343`
- Apply to: UI field constraints and portable payload expectations.

### Integration Points

#### Files to Create

- None required; existing modules can be extended for Lidarr support.

#### Files to Modify

- `/src/routes/media-management/[databaseId]/naming/+page.server.ts`: include Lidarr in list/filter/surface logic.
- `/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`: accept Lidarr and route to Lidarr-aware create logic.
- `/src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts`: include Lidarr quality configs in list responses.
- `/src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts`: accept Lidarr, use Lidarr mappings.
- `/src/routes/media-management/[databaseId]/media-settings/+page.server.ts`: include Lidarr media settings entries.
- `/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`: accept Lidarr and route writes correctly.
- `/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: Lidarr-aware list/read behavior.
- `/src/lib/server/pcd/entities/mediaManagement/naming/create.ts`: Lidarr-aware create behavior.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`: Lidarr-aware list/read behavior.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`: Lidarr-aware create behavior.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: Lidarr-aware list/read and mapping lookup.
- `/src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts`: Lidarr-aware create behavior.
- `/src/lib/shared/pcd/portable.ts`: add/adjust Lidarr-compatible entity type handling.
- `/docs/api/v1/schemas/pcd.yaml`: document portable Lidarr media-management behavior.

### Conventions

- naming: Keep existing function naming conventions (`createRadarr...`, `createSonarr...`) and introduce Lidarr variants or explicit reuse wrappers consistently.
- error handling: Keep `fail(400)` for validation and explicit error messages; preserve duplicate checks and write-operation metadata.
- testing: Follow existing Deno test structure by domain; add Lidarr cases alongside Radarr/Sonarr paths.

### Gotchas and Warnings

- Do not introduce unsupported Lidarr-specific media-management fields that syncer explicitly gates.
- Missing `quality_api_mappings` for Lidarr will make quality-definition workflows appear broken.
- Portable import/export must stay aligned with public schema and internal `ENTITY_TYPES` validation.

### Task Guidance by Area

- database: ensure Lidarr mapping coverage in `quality_api_mappings` and table/query paths used by entity helpers.
- api: update route action validation and portable entity contract handling for Lidarr.
- ui: ensure Lidarr appears in arr-type selectors and listing/edit navigation for all three media-management sections.
