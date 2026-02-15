# Post-Cutover Verification Checklist

This checklist is for maintainers verifying that the first-class Lidarr
media-management cutover is complete and correct.

## Database Migration

- [ ] Application starts without migration errors in logs
- [ ] `lidarr_naming` table exists in PCD cache with at least one row
- [ ] `lidarr_media_settings` table exists in PCD cache with at least one row
- [ ] `lidarr_quality_definitions` table exists in PCD cache with at least one row
- [ ] `quality_api_mappings` contains rows with `arr_type = 'lidarr'` using native quality names
- [ ] Migration reruns produce identical outcomes (idempotency)

**Test coverage:**
- `src/tests/arr/lidarrFirstClassMigration.test.ts` -- migration idempotency and conflict handling
- `src/tests/arr/lidarrBuiltInBaseOpsSeed.test.ts` -- seed registration for new databases

## Entity CRUD Operations

- [ ] Lidarr naming: create, list, get, update, rename, and delete work correctly
- [ ] Lidarr media settings: create, list, get, update, rename, and delete work correctly
- [ ] Lidarr quality definitions: create, list, get, update, and delete work correctly
- [ ] Case-insensitive name uniqueness is enforced for all three entity families
- [ ] No Sonarr rows appear in Lidarr entity listings
- [ ] No Lidarr rows appear in Sonarr entity listings

**Test coverage:**
- `src/tests/arr/lidarrMediaManagement.test.ts` -- end-to-end CRUD operations
- `src/tests/arr/lidarrMediaSettingsEntityOperations.test.ts` -- media settings entity ops
- `src/tests/arr/lidarrQualityDefinitionsEntityOperations.test.ts` -- quality definitions entity ops

## Sync Configuration

- [ ] Lidarr instances can be assigned naming, media-settings, and quality-definitions configs
- [ ] Sync resolves `lidarr_*` entity types directly (no Sonarr fallback)
- [ ] Sync logs reference `lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions`
- [ ] Rename propagation updates only Lidarr-targeted sync assignments

**Test coverage:**
- `src/tests/arr/lidarrFirstClassRouteAndSyncCutover.test.ts` -- route dispatch and sync resolution
- `src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts` -- config name propagation

## Import/Export

- [ ] Export includes `lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions` entity types
- [ ] Import accepts `lidarr_*` entity types and writes to dedicated tables
- [ ] Import rejects cross-family payload mixing (e.g., Radarr fields in `lidarr_naming`)
- [ ] Round-trip import/export produces identical payloads

**Test coverage:**
- `src/tests/arr/lidarrFirstClassRouteAndSyncCutover.test.ts` -- import/export contract parity
- `src/tests/base/lidarrApiParity.test.ts` -- API contract compliance

## API Contract Compliance

- [ ] `EntityType` enum in `docs/api/v1/schemas/pcd.yaml` includes all three `lidarr_*` types
- [ ] Portable type definitions (`PortableLidarrNaming`, `PortableLidarrMediaSettings`, `PortableLidarrQualityDefinitions`) are documented
- [ ] Runtime portable type registry (`src/lib/shared/pcd/portable.ts`) matches OpenAPI schema
- [ ] No "experimental", "reuse", or "backed by Sonarr" annotations remain in API docs

**Test coverage:**
- `src/tests/base/lidarrApiParity.test.ts` -- portable contract parity validation

## Quality Mappings

- [ ] Lidarr quality names are native (e.g., "FLAC", "MP3-320", "ALAC", "WAV")
- [ ] Non-native (Sonarr-derived) mappings have been removed for `arr_type = 'lidarr'`
- [ ] Quality definition creation/update validates entries against Lidarr-specific mappings
- [ ] Unmapped quality names produce explicit errors, not silent fallback

**Test coverage:**
- `src/tests/arr/lidarrQualityMappingPrereqs.test.ts` -- mapping prerequisite validation

## Legacy Cleanup

- [ ] No Sonarr-fallback code paths remain in naming/media-settings/quality-definitions read/write
- [ ] Sync resolver does not reference Sonarr entities for `arr_type = 'lidarr'`
- [ ] Route dispatch for Lidarr resolves to `lidarr_*` entity handlers directly
- [ ] No "reuse" or "backed by Sonarr" log messages are emitted for Lidarr operations

## Rollback Decision Criteria

Consider rollback if any of the following are true after upgrade:

1. **Migration failure**: Application fails to start due to migration errors
2. **Data loss**: Lidarr entity counts are lower than pre-migration Sonarr-backed counts
3. **Sync breakage**: Lidarr sync fails with "config not found" for previously working assignments
4. **Quality mapping gaps**: Lidarr quality definitions cannot be created due to missing mappings

Rollback procedure is documented in the
[migration runbook](migration-runbook.md#rollback-procedure).
