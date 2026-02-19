# Code Analysis: enhance-lidarr-support

## Executive Summary

Current code paths already support arr-type dispatch, but Lidarr media-management branches still rely on Sonarr-backed entities. The most reliable implementation is to preserve existing module boundaries and add first-class Lidarr branches/tables across CRUD, sync, and portable serialization. This minimizes architectural churn while removing reuse-specific warnings and behavior.

## Existing Code Structure

### Related Components

- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`: action validation and dispatch to create helpers.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`: arr-type list/read behavior.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`: deterministic write pattern with metadata.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`: quality mapping + filtering behavior.
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: media-management sync pipeline.
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: persisted sync selections and rename updates.

### File Organization Pattern

Media-management functionality is partitioned by domain (`naming`, `media-settings`, `quality-definitions`) and operation (`read/create/update/delete`). Route/API layers remain thin and call into server-side helpers.

## Implementation Patterns

### Pattern: Deterministic Write Operation

**Description**: Mutations use `writeOperation` with explicit metadata and layer.
**Example**: `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`
**Apply to**: New Lidarr create/update/delete helpers.

### Pattern: Explicit Arr-Type Routing

**Description**: Actions validate arr type and dispatch to app-specific helpers.
**Example**: `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`
**Apply to**: All Lidarr route action updates.

### Pattern: Mapping-Aware Quality Handling

**Description**: Quality definitions depend on mapping lookups and explicit unmapped handling.
**Example**: `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`
**Apply to**: Lidarr quality-definition reads/writes and sync application.

## Integration Points

### Files to Create

- `/packages/praxrr-app/src/lib/server/db/migrations/*`: migration for `lidarr_*` entities and mapping seeds.

### Files to Modify

- `/docs/pcdReference/0.schema.sql`: add first-class Lidarr tables/mapping coverage.
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: align runtime schema docs/definitions.
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: register `lidarr_*` entity families.
- `/docs/api/v1/schemas/pcd.yaml`: document first-class Lidarr portable types.
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/**`: switch Lidarr from reuse to dedicated tables.
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/**/+page.server.ts`: route actions to dedicated Lidarr helpers.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: import support for first-class Lidarr entities.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: export support for first-class Lidarr entities.
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: dedicated Lidarr sync source resolution.
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: deterministic rename/config propagation for Lidarr names.

## Code Conventions

### Naming

Use existing family naming pattern (`radarr_*`, `sonarr_*`, `lidarr_*`) and keep helper naming explicit per arr type.

### Error Handling

Retain `fail(400|500)` route behavior and explicit log reasons in syncer; avoid silent fallback.

### Testing

Add tests in existing domains (`packages/praxrr-app/src/tests/arr`, `packages/praxrr-app/src/tests/base`, sync/job suites), following positive + failure coverage patterns.

## Dependencies and Services

### Available Utilities

- `pcdManager` + `writeOperation` for cache/write orchestration.
- `arrSyncQueries` for config selection persistence.
- portable validators/serializers for import/export contracts.

### Required Dependencies

No new external dependency is required; changes should fit current Deno/SvelteKit + internal service stack.

## Gotchas and Warnings

- Existing Lidarr list/read paths may duplicate Sonarr-derived views; migration must prevent duplicate semantics.
- Missing Lidarr `quality_api_mappings` coverage will break quality-definition writes/sync.
- Rename propagation must track new config names or sync jobs will drift.

## Task-Specific Guidance

- **Database tasks**: Add tables + mappings + idempotent migration first.
- **API tasks**: Update portable contracts and import/export handlers in lockstep.
- **UI tasks**: Keep route parity and explicit arr-type validation while switching helper dispatch.
