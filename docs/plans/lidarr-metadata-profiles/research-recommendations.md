# Recommendations: Lidarr Metadata Profiles

## Executive Summary

Lidarr metadata profiles are a Lidarr-exclusive concept (not present in Radarr or Sonarr) that control which album types and release statuses are monitored per-artist. They consist of three configurable dimensions: Primary Album Types, Secondary Album Types, and Release Statuses, each with an `allowed` boolean toggle. The recommended approach is full PCD integration following the existing quality-profile pattern, implemented through four phases: PCD schema foundation, API layer, sync pipeline, and UI. The key risk is ensuring strict Cross-Arr Semantic Validation Policy compliance since this entity family is entirely Lidarr-scoped with no cross-Arr equivalent.

## Lidarr Metadata Profile Domain

### API Endpoint

- `GET /api/v1/metadataprofile` - list all metadata profiles
- `POST /api/v1/metadataprofile` - create a metadata profile
- `GET /api/v1/metadataprofile/{id}` - get a metadata profile by ID
- `PUT /api/v1/metadataprofile/{id}` - update a metadata profile
- `DELETE /api/v1/metadataprofile/{id}` - delete a metadata profile
- `GET /api/v1/metadataprofile/schema` - get the metadata profile schema (with all type/status options)

Note: Lidarr uses API v1, not v3 like Radarr/Sonarr (see `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts` line 18).

### Data Shape (from Lidarr API)

```json
{
  "id": 1,
  "name": "Standard",
  "primaryAlbumTypes": [
    { "albumType": { "id": 0, "name": "Album" }, "allowed": true },
    { "albumType": { "id": 1, "name": "EP" }, "allowed": true },
    { "albumType": { "id": 2, "name": "Single" }, "allowed": false },
    { "albumType": { "id": 3, "name": "Broadcast" }, "allowed": false },
    { "albumType": { "id": 4, "name": "Other" }, "allowed": false }
  ],
  "secondaryAlbumTypes": [
    { "albumType": { "id": 0, "name": "Studio" }, "allowed": true },
    { "albumType": { "id": 1, "name": "Compilation" }, "allowed": false },
    { "albumType": { "id": 2, "name": "Soundtrack" }, "allowed": false },
    { "albumType": { "id": 3, "name": "Spokenword" }, "allowed": false },
    { "albumType": { "id": 4, "name": "Interview" }, "allowed": false },
    { "albumType": { "id": 5, "name": "Audiobook" }, "allowed": false },
    { "albumType": { "id": 6, "name": "Live" }, "allowed": false },
    { "albumType": { "id": 7, "name": "Remix" }, "allowed": false },
    { "albumType": { "id": 8, "name": "DJ-mix" }, "allowed": false },
    { "albumType": { "id": 9, "name": "Mixtape/Street" }, "allowed": false },
    { "albumType": { "id": 10, "name": "Demo" }, "allowed": false },
    { "albumType": { "id": 11, "name": "Audio Drama" }, "allowed": false },
    { "albumType": { "id": 12, "name": "Field Recording" }, "allowed": false }
  ],
  "releaseStatuses": [
    { "releaseStatus": { "id": 0, "name": "Official" }, "allowed": true },
    { "releaseStatus": { "id": 1, "name": "Promotional" }, "allowed": false },
    { "releaseStatus": { "id": 2, "name": "Bootleg" }, "allowed": false },
    { "releaseStatus": { "id": 3, "name": "Pseudo-Release" }, "allowed": false }
  ]
}
```

These values are sourced from the MusicBrainz Release Group Type taxonomy. Primary types: Album, EP, Single, Broadcast, Other. Secondary types: Studio, Compilation, Soundtrack, Spokenword, Interview, Audiobook, Live, Remix, DJ-mix, Mixtape/Street, Demo, Audio Drama, Field Recording. Release statuses: Official, Promotional, Bootleg, Pseudo-Release.

## Implementation Recommendations

### Recommended Approach

Model the implementation after the quality profile entity pattern, which is the closest analog. Quality profiles have a main entity table plus several junction/child tables (qualities, groups, scores, languages). Metadata profiles follow a similar pattern: main entity table plus three child tables (primary types, secondary types, release statuses). The key difference is that metadata profiles are dramatically simpler -- each child is just a type/status ID + allowed boolean, with no grouping, scoring, or cross-Arr scoping.

### Technology Choices

| Component          | Recommendation                                                                                                                 | Rationale                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| PCD storage        | Dedicated `lidarr_metadata_profiles` table in PCD schema + 3 child tables                                                      | Follows entity-per-arr-type pattern from `lidarr_naming`, `lidarr_media_settings` |
| Sync integration   | New `SectionType` entry `'metadataProfiles'` in sync registry                                                                  | Extends existing registry pattern; keeps Lidarr-specific logic isolated           |
| API endpoints      | `POST/PUT/DELETE /api/v1/pcd/{databaseId}/lidarr-metadata-profiles`                                                            | Follows existing PCD entity route pattern                                         |
| Arr client methods | Add `getMetadataProfiles()`, `createMetadataProfile()`, `updateMetadataProfile()`, `deleteMetadataProfile()` to `LidarrClient` | Keeps Lidarr-specific methods on the Lidarr client, not BaseArrClient             |
| UI                 | New route at `/metadata-profiles` with Lidarr-only filter                                                                      | Follows existing route-per-entity-family pattern                                  |

### Phasing Strategy

1. **Phase 1 - PCD Foundation** (schema, types, ops, cache)
   - Add PCD schema tables for metadata profiles via built-in base ops (migration pattern from `20260215_add_lidarr_media_management_entities.ts`)
   - Add Kysely table interfaces to `packages/praxrr-app/src/lib/shared/pcd/types.ts`
   - Register entity in `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts` AUTO_ALIGN_ENTITIES
   - Add serialization/deserialization support
   - Add portable types to `packages/praxrr-app/src/lib/shared/pcd/portable.ts`

2. **Phase 2 - API Layer** (CRUD endpoints, entity operations)
   - Create PCD entity directory at `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/`
   - Implement `create.ts`, `list.ts`, `delete.ts`, `index.ts` following quality profile pattern
   - Add API routes under `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/`
   - Update OpenAPI spec with new endpoints

3. **Phase 3 - Sync Pipeline** (Lidarr sync integration)
   - Add `LidarrMetadataProfile` types to `packages/praxrr-app/src/lib/server/utils/arr/types.ts`
   - Add metadata profile methods to `LidarrClient` (not BaseArrClient)
   - Create `packages/praxrr-app/src/lib/server/sync/metadataProfiles/` directory with handler, syncer, transformer
   - Register new `SectionType = 'metadataProfiles'` in sync types and registry
   - Add `arr_sync_metadata_profiles` and `arr_sync_metadata_profiles_config` tables via migration
   - Add trigger wiring in `processor.ts`

4. **Phase 4 - UI** (management pages, sync configuration)
   - Add `/metadata-profiles` route with list page
   - Add `[databaseId]/[name]` detail/edit page
   - Add metadata profile selection to Lidarr instance sync settings
   - Add display types to `packages/praxrr-app/src/lib/shared/pcd/display.ts`

### Quick Wins

- **Lidarr client methods**: Adding `getMetadataProfiles()` / `getMetadataProfile(id)` / `createMetadataProfile()` / `updateMetadataProfile()` / `deleteMetadataProfile()` to `LidarrClient` is low-risk and immediately useful for manual testing.
- **Type definitions**: Adding `LidarrMetadataProfile` and related types to `packages/praxrr-app/src/lib/server/utils/arr/types.ts` establishes the contract with zero runtime risk.
- **Capability surface**: Adding `'metadata_profiles'` to `ArrSyncSurface` and `LIDARR_CAPABILITIES` in `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` is a small, low-risk change that enables gated feature access.

## Improvement Ideas

### Related Features

- **Profile Templates**: Pre-built metadata profiles (e.g., "Albums Only", "Everything", "Albums + EPs + Singles") could be seeded as base ops, similar to how quality profiles have default templates.
- **Artist-level Override**: The Lidarr API assigns metadata profiles at the artist level (via `metadataProfileId` on the Artist resource). A future enhancement could expose per-artist metadata profile assignment from within Praxrr.
- **Profile Comparison**: Side-by-side diff view for metadata profiles would help users understand what each profile includes/excludes before syncing.
- **Bulk Operations**: Apply a metadata profile change across multiple Lidarr instances simultaneously.

### Future Enhancements

- **Profile Validation against Library**: Warn users when a metadata profile would exclude albums they already have monitored.
- **Profile Sync Status Dashboard**: Show which Lidarr instances are using which metadata profiles, similar to quality profile sync status.
- **Import from Lidarr**: Pull existing metadata profiles from a running Lidarr instance into PCD storage for management.
- **Metadata Profile in Library View**: Display the metadata profile name alongside quality profile in the Lidarr library view.

### How Metadata Profiles Work with PCD Ops

The PCD ops system stores append-only SQL operations that replay into an in-memory SQLite cache. Metadata profiles would follow this pattern:

- **Schema ops** (layer: schema): `CREATE TABLE lidarr_metadata_profiles`, plus child tables
- **Base ops** (layer: base): Seed default profiles (e.g., "Standard" with Albums only)
- **User ops** (layer: user): User creates/modifies profiles, generating INSERT/UPDATE/DELETE ops
- **Value guards**: Updates use old-value checks for conflict detection, same as quality profiles
- **Cache compilation**: Metadata profile tables compiled alongside all other PCD tables

## Risk Assessment

### Technical Risks

| Risk                                                                                    | Likelihood | Impact | Mitigation                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Lidarr API schema changes (type/status enum expansion)                                  | Low        | Medium | Use `GET /api/v1/metadataprofile/schema` at sync time to discover available types dynamically rather than hard-coding enum values |
| PCD cache compilation performance with new entity type                                  | Low        | Low    | Metadata profiles are tiny (max ~5 profiles x ~20 child rows each); negligible impact on in-memory SQLite                         |
| Sync conflict with manually-created metadata profiles in Lidarr                         | Medium     | Medium | Use name-based matching (same as quality profiles) with create-or-update semantics                                                |
| Cross-Arr policy violation (Radarr/Sonarr accidentally receiving metadata profile data) | Low        | High   | Gate all metadata profile sync paths behind explicit `arr_type === 'lidarr'` checks; fail-fast on any other type                  |
| Namespace suffix collision for metadata profile names                                   | Low        | Medium | Reuse existing `getNamespaceSuffix()` pattern from quality profile syncer                                                         |

### Integration Challenges

- **No BaseArrClient methods**: Unlike quality profiles and delay profiles which exist on `BaseArrClient`, metadata profile API methods must be Lidarr-only. The `LidarrClient` class already overrides `apiVersion` to `'v1'`, so methods added there will use the correct API version automatically.
- **Sync section expansion**: Adding a fourth `SectionType` requires changes to `InstanceSyncResult`, `SYNC_SECTION_ORDER`, `SUPPORTED_SYNC_SECTIONS`, `triggerSyncs()`, and `processPendingSyncs()`. Each of these currently hard-codes the three existing sections.
- **Lidarr API v1 vs v3**: The metadata profile endpoint is `/api/v1/metadataprofile`. The `LidarrClient` already handles this via `protected override apiVersion: string = 'v1'`.
- **App DB sync tables**: A new migration is needed for `arr_sync_metadata_profiles` and `arr_sync_metadata_profiles_config`, following the pattern in migration 015.

### Cross-Arr Validation Compliance

Per CLAUDE.md Cross-Arr Semantic Validation Policy:

- [x] **API semantics verified per Arr app**: Metadata profiles are a Lidarr-only concept. Radarr and Sonarr have no equivalent endpoint.
- [x] **Schema/field mappings validated per Arr app**: Primary types, secondary types, and release statuses are Lidarr-specific enums with no Radarr/Sonarr mapping.
- [x] **Read/write/sync dispatch resolves by explicit `arr_type`**: All metadata profile operations must guard on `arr_type === 'lidarr'`. No implicit sibling fallback allowed.
- [x] **Migration/import/export mappings are per Arr app**: Metadata profile entities must be prefixed `lidarr_metadata_profile` to prevent ambiguity.

Per Arr Cutover Guardrails:

- Metadata profiles must use **dedicated** Lidarr tables from inception (no shared/transitional tables).
- Built-in base ops for default metadata profiles must be registered in `seedBuiltInBaseOps.ts`.
- The `SUPPORTED_SYNC_SECTIONS` map in `mappings.ts` must only add `'metadataProfiles'` for `lidarr`, explicitly excluding `radarr` and `sonarr`.

## Alternative Approaches

### Option A: Full PCD Integration

**Description**: Metadata profiles become a first-class PCD entity with schema tables, ops, cache compilation, CRUD, serialization, sync, and UI -- following the same pattern as quality profiles, delay profiles, and media management entities.

- **Pros**:
  - Full ops history, conflict detection, and value guards
  - Users can manage metadata profiles across databases with override/align strategy
  - Export/import works out of the box
  - Base ops can seed sensible defaults from PCD repos
  - Consistent UX with all other managed entities
- **Cons**:
  - Most complex implementation (~60-80 files touched)
  - Requires PCD schema update (new tables in the `praxrr-schema` repo)
  - Longer time to first working feature

### Option B: Lightweight Direct API Management

**Description**: Bypass PCD entirely. Add metadata profile methods to `LidarrClient`, expose them through API routes, and sync directly from user-configured JSON payloads stored in a simple app DB table (not PCD ops).

- **Pros**:
  - Much simpler implementation (~15-25 files)
  - No PCD schema changes needed
  - Faster time to first working feature
  - Metadata profiles rarely change, so ops history has limited value
- **Cons**:
  - No conflict detection, value guards, or ops history
  - No base-ops seeding from PCD repos
  - Inconsistent with all other entity management patterns
  - No export/import through the standard PCD portable format
  - Would need to be retrofitted to PCD eventually if the pattern becomes standard

### Option C: Hybrid Approach

**Description**: Start with PCD schema and cache tables but skip full ops writer integration initially. Use direct SQL inserts for CRUD and layer in ops support later. Sync pipeline integrated from the start.

- **Pros**:
  - Gets the data model right from day one
  - Sync works correctly
  - Can be extended to full PCD ops later without schema changes
  - Moderate complexity (~35-50 files)
- **Cons**:
  - No conflict detection until ops are added
  - Creates technical debt that must be addressed
  - Temporary inconsistency with other entity patterns

### Recommendation

**Option A: Full PCD Integration** is recommended. Metadata profiles are a perfect fit for the PCD ops system -- they are named entities with a fixed schema that users will want to share across databases and sync to instances. The additional complexity is bounded and well-understood since the pattern is thoroughly established by quality profiles. The incremental cost of full PCD integration over a hybrid approach is modest, and it avoids accruing technical debt.

## Task Breakdown Preview

### Phase 1: Foundation (~10-15 tasks)

**Focus**: Schema, types, and base ops.

- **PCD Schema** (can be parallelized):
  - Create `lidarr_metadata_profiles` table definition (PK: name)
  - Create `lidarr_metadata_profile_primary_types` child table (FK to parent by name)
  - Create `lidarr_metadata_profile_secondary_types` child table
  - Create `lidarr_metadata_profile_release_statuses` child table
  - Add Kysely table interfaces to `packages/praxrr-app/src/lib/shared/pcd/types.ts` (auto-generated, but need manual additions to `PCDDatabase` interface)
  - Register entity in `AUTO_ALIGN_ENTITIES` in `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`

- **Types and Contracts** (can be parallelized):
  - Add `LidarrMetadataProfile` API type to `packages/praxrr-app/src/lib/server/utils/arr/types.ts`
  - Add portable type `PortableLidarrMetadataProfile` to `packages/praxrr-app/src/lib/shared/pcd/portable.ts`
  - Add display types to `packages/praxrr-app/src/lib/shared/pcd/display.ts`
  - Add `'metadata_profiles'` to `ArrSyncSurface` in `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`

- **Base Ops and Migration**:
  - Create built-in base ops migration for schema tables (following `20260215_add_lidarr_media_management_entities.ts` pattern)
  - Register in `seedBuiltInBaseOps.ts`
  - Create app DB migration for `arr_sync_metadata_profiles` + `arr_sync_metadata_profiles_config` tables

### Phase 2: Core Implementation (~15-20 tasks)

**Focus**: Entity operations, API routes, and sync pipeline.

- **PCD Entity Operations** (`packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/`):
  - `index.ts` - query functions (getByName, list)
  - `create.ts` - create operation with ops writer
  - `delete.ts` - delete operation with ops writer
  - Update `serialize.ts` and `deserialize.ts` for metadata profiles
  - Update `clone.ts` for metadata profiles

- **API Routes** (`packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/`):
  - `+server.ts` - GET (list) and POST (create)
  - `[name]/+server.ts` - GET (detail), PUT (update), DELETE

- **Lidarr Client Methods** (`packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`):
  - `getMetadataProfiles()`
  - `getMetadataProfile(id)`
  - `getMetadataProfileSchema()`
  - `createMetadataProfile(profile)`
  - `updateMetadataProfile(id, profile)`
  - `deleteMetadataProfile(id)`

- **Sync Pipeline** (`packages/praxrr-app/src/lib/server/sync/metadataProfiles/`):
  - `transformer.ts` - Transform PCD metadata profile to Lidarr API payload
  - `syncer.ts` - `MetadataProfileSyncer` extending `BaseSyncer`
  - `handler.ts` - `SectionHandler` implementation + register on import
  - `index.ts` - module exports
  - Update `packages/praxrr-app/src/lib/server/sync/types.ts` - add `'metadataProfiles'` to `SectionType`, add `metadataProfiles?: SyncResult` to `InstanceSyncResult`
  - Update `packages/praxrr-app/src/lib/server/sync/mappings.ts` - add `'metadataProfiles'` to `SYNC_SECTION_ORDER` and `SUPPORTED_SYNC_SECTIONS` (lidarr only)
  - Update `packages/praxrr-app/src/lib/server/sync/processor.ts` - import handler, add trigger wiring, update totalSynced calculation
  - Update `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` - add metadata profile sync queries

### Phase 3: UI and Integration (~10-15 tasks)

**Focus**: UI pages, sync settings, and testing.

- **Page Routes**:
  - `/metadata-profiles/+page.server.ts` and `+page.svelte` - list view
  - `/metadata-profiles/[databaseId]/+page.server.ts` and `+page.svelte` - database-scoped list
  - `/metadata-profiles/[databaseId]/[name]/+page.server.ts` and `+page.svelte` - detail/edit view
  - Create form components for toggling primary types, secondary types, and release statuses

- **Sync Settings UI**:
  - Add metadata profile selection to Lidarr instance sync configuration page
  - Add metadata profile sync status display

- **Testing**:
  - Unit tests for transformer (PCD -> Lidarr API format)
  - Unit tests for entity CRUD operations
  - E2E test for metadata profile lifecycle (create, sync, verify in Lidarr)

### Parallel Opportunities

- Phase 1 tasks (schema, types, migration) are largely independent of each other
- Lidarr client methods (Phase 2) can be developed in parallel with PCD entity operations
- UI work (Phase 3) can begin as soon as API routes are functional (does not need sync)
- Sync pipeline development can happen in parallel with UI once types are defined

### Estimated Complexity

- **Total tasks**: ~35-50 discrete implementation items
- **Files created**: ~20-25 new files
- **Files modified**: ~15-20 existing files
- **Critical path**: PCD schema -> Kysely types -> entity operations -> API routes -> sync pipeline -> UI
- **Estimated effort**: Medium-large feature (comparable to the Lidarr media management cutover)

## Key Decisions Needed

1. **PCD Schema Repo Update**: The PCD schema is sourced from `praxrr-schema` (referenced in type generation header). Metadata profile tables need to be added there first, or handled via built-in base ops like the Lidarr media management migration. Built-in base ops are recommended for the initial implementation to avoid blocking on schema repo changes.

2. **Default Metadata Profiles**: What default profiles should be seeded via base ops? Lidarr ships with a "Standard" profile (Albums only). Options: seed a "Standard" profile matching Lidarr defaults, or leave PCD empty and let users create their own.

3. **Sync Section Order**: Where does `'metadataProfiles'` go in `SYNC_SECTION_ORDER`? It has no dependency on custom formats or quality profiles, so it could be synced first or independently. Recommendation: add it after `'mediaManagement'` since it is similarly configuration-oriented.

4. **UI Placement**: Should metadata profiles get their own top-level route (`/metadata-profiles`) or be nested under an existing section? Recommendation: own top-level route, consistent with `/quality-profiles`, `/delay-profiles`, `/media-management`.

5. **Name vs ID Matching in Sync**: Should metadata profile sync use name-based matching (like quality profiles) or ID tracking? Recommendation: name-based, consistent with the existing namespace suffix pattern.

## Open Questions

- What are the exact integer IDs Lidarr assigns to each primary type, secondary type, and release status? The `GET /api/v1/metadataprofile/schema` endpoint should return the complete enumeration. This needs to be verified against a running Lidarr instance before finalizing the PCD schema seed data.
- Does Lidarr support metadata profile deletion via API when artists are using that profile? If not, what is the error response? This affects sync cleanup behavior.
- Can Lidarr's metadata profile list change between versions (e.g., new secondary album types added in future Lidarr releases)? If so, the sync pipeline should dynamically discover available types via the schema endpoint rather than hard-coding them.

## Relevant Files

### Closest Pattern to Follow (Quality Profiles)

- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/create.ts`: Entity creation with ops writer
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`: Entity listing with arr-type filtering
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/delete.ts`: Entity deletion with ops writer
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Quality profile sync implementation
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts`: Section handler registration pattern
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: PCD -> Arr API transformation

### Key Infrastructure Files to Modify

- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: Add Kysely table interfaces for metadata profile tables + update `PCDDatabase` interface
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Add `'metadata_profiles'` to sync surfaces and `LIDARR_CAPABILITIES`
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: Add `LidarrMetadataProfile` API types
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: Add metadata profile client methods
- `/packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`: Register metadata profile entity for auto-align
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: Add metadata profile serialization
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: Add metadata profile deserialization
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: Add `'metadataProfiles'` to `SectionType` union and `InstanceSyncResult`
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Update `SYNC_SECTION_ORDER`, `SUPPORTED_SYNC_SECTIONS`
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Import handler, add trigger wiring
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Add metadata profile sync queries
- `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Register built-in base ops for metadata profile schema

### Migration Pattern References

- `/packages/praxrr-app/src/lib/server/db/migrations/20260215_add_lidarr_media_management_entities.ts`: Pattern for adding Lidarr-specific PCD schema tables via base-op seeded migration
- `/packages/praxrr-app/src/lib/server/db/migrations/015_create_arr_sync_tables.ts`: Pattern for app DB sync tables
- `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Pattern for registering built-in base ops for newly initialized databases

## Other Docs

- [Lidarr API Documentation](https://lidarr.audio/docs/api/) - Official Swagger UI
- [Lidarr OpenAPI Spec](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json) - Raw OpenAPI JSON
- [MusicBrainz Release Group Types](https://musicbrainz.org/doc/Release_Group/Type) - Source taxonomy for primary/secondary album types
- [Starr Go Client - MetadataProfile](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr) - Third-party Go client showing MetadataProfile struct
- [Terraform Lidarr Provider - metadata_profile resource](https://registry.terraform.io/providers/devopsarr/lidarr/latest/docs/resources/metadata_profile) - Terraform resource documentation
- [Servarr Wiki - Lidarr Settings](https://wiki.servarr.com/lidarr/settings) - User-facing documentation for metadata profiles
- `/docs/plans/enhance-lidarr-support/feature-spec.md` - Previous Lidarr enhancement feature spec (media management cutover)
