# Business Logic Research: Lidarr Metadata Profiles

## Executive Summary

Lidarr metadata profiles control which album release types (primary types, secondary types) and release statuses an artist's library should monitor. Adding metadata profile management to Profilarr enables centralized, templated control over what music content Lidarr considers for download -- a critical filtering mechanism that currently has no Profilarr equivalent and must be configured manually per-artist or per-instance. This feature follows the established PCD entity pattern used by quality profiles, delay profiles, and media management entities, and would become a new Lidarr-only sync section.

## User Stories

### Primary User: Profilarr Administrator Managing Music Libraries

- As a Profilarr user, I want to define metadata profiles in my PCD database so that I can curate which album types (Albums, EPs, Singles, etc.) and release statuses (Official, Bootleg, etc.) Lidarr monitors across all my instances.
- As a Profilarr user, I want to sync metadata profiles to my Lidarr instances so that new artists automatically inherit the correct monitoring filters without manual configuration.
- As a Profilarr user, I want to manage multiple metadata profiles (e.g., "Discography" for completists vs. "Studio Albums Only" for casual listening) so I can assign different profiles to different instances or use cases.
- As a Profilarr user, I want metadata profiles to participate in the PCD system (base ops + user ops, import/export, clone) so they are portable and version-controlled like all other Profilarr entities.
- As a Profilarr user managing multiple Lidarr instances, I want changes to a metadata profile to propagate to all synced instances so I do not have to reconfigure each instance individually.

### Secondary User: PCD Database Author

- As a PCD database author, I want to ship opinionated metadata profile presets (e.g., "Standard - Albums + EPs + Official Only") so community members can use curated defaults.
- As a PCD database author, I want metadata profiles to support user-layer overrides so administrators can customize base presets without forking.

## Business Rules

### Core Rules

1. **Lidarr-Only Entity**: Metadata profiles are a Lidarr-exclusive concept. Radarr and Sonarr have no equivalent. The entity, its PCD tables, sync handler, and UI routes must be scoped to `arr_type = 'lidarr'` only. This is unlike quality profiles or custom formats which are cross-Arr.

2. **Exhaustive Type Enumeration**: A metadata profile must enumerate ALL known primary album types, ALL known secondary album types, and ALL known release statuses, each with an explicit `allowed` boolean. The Lidarr API expects the full list to be present in PUT/POST payloads (similar to how quality profiles must list all qualities). Missing entries are treated as `allowed: false` by Lidarr.

3. **Primary Album Types** (from Lidarr/MusicBrainz, integer ID -> name):
   - `0` = Album
   - `1` = EP
   - `2` = Single
   - `3` = Broadcast
   - `4` = Other

4. **Secondary Album Types** (from Lidarr/MusicBrainz, integer ID -> name):
   - `0` = Studio
   - `1` = Compilation
   - `2` = Soundtrack
   - `3` = Spokenword
   - `4` = Interview
   - `5` = Audiobook
   - `6` = Live
   - `7` = Remix
   - `8` = DJ-mix
   - `9` = Mixtape/Street
   - `10` = Demo
   - `11` = Field Recording

5. **Release Statuses** (from Lidarr/MusicBrainz, integer ID -> name):
   - `0` = Official
   - `1` = Promotional
   - `2` = Bootleg
   - `3` = Pseudo-Release

6. **Name Uniqueness**: Metadata profile names must be case-insensitively unique within a PCD database, following the existing convention enforced on all PCD entity create/rename paths (see `src/lib/server/pcd/entities/validate.ts`).

7. **Default Profile Handling**: Lidarr instances always have at least one metadata profile. When syncing, Profilarr should create/update profiles by name match (the same pattern used for quality profiles). Profilarr does NOT manage the "default" assignment to artists -- that is done in Lidarr itself. Profilarr only ensures the profile definition exists and is up to date.

8. **Profile-in-Use Protection**: Metadata profiles assigned to artists in Lidarr cannot be deleted via the Lidarr API (the API returns an error). The sync pipeline should handle this gracefully: sync creates and updates, but does not delete metadata profiles from Lidarr instances.

### Edge Cases

- **New Type Added Upstream**: If a future Lidarr version adds a new primary/secondary type or release status, existing PCD metadata profiles will not include it. The sync should include all types currently known to Profilarr. Unknown types returned by the Lidarr API should be preserved (pass-through) during updates, similar to how `applyConfigUpdates` works in the media management syncer.
- **Empty Profile (All Disallowed)**: A metadata profile where all types are `allowed: false` is technically valid but would cause Lidarr to monitor nothing. Validation should warn but not reject this configuration.
- **Artist-Level Override**: Lidarr allows changing a metadata profile per-artist. Profilarr's sync only manages the profile definition, not the artist-to-profile assignment. This is consistent with how quality profiles work -- Profilarr syncs the profile, but does not assign it to movies/series/artists.
- **Multiple Databases**: When multiple PCD databases are synced to the same Lidarr instance, namespace suffixes apply (same as quality profiles). Metadata profile names would need the same invisible namespace suffix treatment.

## Workflows

### Primary Workflow: Create Metadata Profile

1. User navigates to metadata profiles page within a PCD database view
2. User clicks "New Metadata Profile"
3. System presents a form with:
   - Profile name (text input, required)
   - Primary album types (list of checkboxes: Album, EP, Single, Broadcast, Other)
   - Secondary album types (list of checkboxes: Studio, Compilation, Soundtrack, Spokenword, Interview, Audiobook, Live, Remix, DJ-mix, Mixtape/Street, Demo, Field Recording)
   - Release statuses (list of checkboxes: Official, Promotional, Bootleg, Pseudo-Release)
4. User configures desired types and submits
5. System validates name uniqueness, writes PCD ops to `pcd_ops` table
6. PCD cache is recompiled to include the new entity

### Primary Workflow: Edit Metadata Profile

1. User navigates to an existing metadata profile
2. System displays current configuration (all types with their allowed/disallowed state)
3. User toggles types and submits
4. System generates update operations with value guards (old-value checks) per the PCD ops pattern
5. Cache is recompiled

### Primary Workflow: Sync Metadata Profiles to Lidarr

1. Sync trigger fires (manual, on_pull, on_change, or schedule)
2. Sync processor checks if the instance is Lidarr type
3. Metadata profile section handler fetches configured profile selections from `arr_sync_metadata_profiles`
4. For each selected profile:
   a. Fetch profile from PCD cache
   b. Transform to Lidarr API format (`/api/v1/metadataprofile` payload)
   c. GET existing metadata profiles from Lidarr
   d. Match by name (with namespace suffix): create if missing, update if existing
5. Report sync results

### Secondary Workflow: Import/Export

1. Export serializes metadata profiles into portable JSON format
2. Import deserializes portable JSON and creates PCD ops
3. Clone duplicates a metadata profile with a new name

## Domain Model

### Key Entities

- **MetadataProfile**: The top-level entity. Contains a `name` and references to three child collections. Stored in a `lidarr_metadata_profiles` PCD table.
  - Key attributes: `name` (PK, unique, case-insensitive), `created_at`, `updated_at`

- **MetadataProfilePrimaryType**: Junction row linking a metadata profile to a primary album type with an `allowed` flag.
  - Key attributes: `metadata_profile_name` (FK), `primary_type_id` (integer), `allowed` (boolean)
  - Table: `lidarr_metadata_profile_primary_types`

- **MetadataProfileSecondaryType**: Junction row linking a metadata profile to a secondary album type with an `allowed` flag.
  - Key attributes: `metadata_profile_name` (FK), `secondary_type_id` (integer), `allowed` (boolean)
  - Table: `lidarr_metadata_profile_secondary_types`

- **MetadataProfileReleaseStatus**: Junction row linking a metadata profile to a release status with an `allowed` flag.
  - Key attributes: `metadata_profile_name` (FK), `release_status_id` (integer), `allowed` (boolean)
  - Table: `lidarr_metadata_profile_release_statuses`

### Lidarr API Contract

**Endpoint**: `GET/POST/PUT/DELETE /api/v1/metadataprofile` (Lidarr uses v1 API, not v3)

**Response/Request Schema**:

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
    ...
  ],
  "releaseStatuses": [
    { "releaseStatus": { "id": 0, "name": "Official" }, "allowed": true },
    { "releaseStatus": { "id": 1, "name": "Promotional" }, "allowed": false },
    ...
  ]
}
```

### Artist Relationship

In Lidarr, each artist has a `metadataProfileId` field. When an artist is added to Lidarr, it gets assigned a metadata profile. The profile controls which albums are fetched from MusicBrainz and monitored. Profilarr does not manage artist assignments -- it only ensures the profile definitions exist in Lidarr. Artists reference profiles by ID (assigned at the Lidarr level).

### State Transitions and Lifecycle

1. **Created** in PCD via user ops or base ops -> exists in PCD cache
2. **Synced** to Lidarr instance -> exists as Lidarr metadata profile (matched by name)
3. **Updated** in PCD -> sync propagates changes to all linked Lidarr instances
4. **Deleted** in PCD -> sync does NOT delete from Lidarr (profiles may be in use by artists; deletion requires manual action in Lidarr)

## Existing Codebase Integration

### Related Features (Models to Follow)

- `/src/lib/server/pcd/entities/delayProfiles/`: Simplest PCD entity pattern -- single table, no arr-type branching. Good starting template for the core entity.
- `/src/lib/server/pcd/entities/mediaManagement/naming/`: Arr-type-branched entity (radarr_naming, sonarr_naming, lidarr_naming). Demonstrates the pattern for Lidarr-specific entities with create/read/update/delete/override.
- `/src/lib/server/pcd/entities/mediaManagement/media-settings/`: Another arr-type-branched entity, simpler than naming. Good model for the entity operations.
- `/src/lib/server/sync/qualityProfiles/syncer.ts`: Most complex syncer -- demonstrates database batching, namespace suffixes, and per-database sync. Metadata profiles would follow a similar but simpler pattern (no custom format dependency).
- `/src/lib/server/sync/mediaManagement/syncer.ts`: Demonstrates the "GET existing, modify, PUT back" pattern for config-style sync. Metadata profiles use a different pattern (create/update by name match on a collection endpoint).

### Patterns to Follow

- **PCD Entity CRUD**: Follow the pattern in `src/lib/server/pcd/entities/mediaManagement/media-settings/` -- separate files for `create.ts`, `read.ts`, `update.ts`, `delete.ts`, `index.ts`, and `override.ts`.
- **Entity Registry**: Register the new entity in `src/lib/server/pcd/entities/registry.ts` under `AUTO_ALIGN_ENTITIES` with the appropriate table name, key column, and fields.
- **Portable Types**: Add `PortableLidarrMetadataProfile` to `src/lib/shared/pcd/portable.ts` and register in `ENTITY_TYPES`.
- **Serialize/Deserialize**: Add functions in `src/lib/server/pcd/entities/serialize.ts` and `deserialize.ts`.
- **Sync Section**: Create a new sync section type. Currently `SectionType = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement'`. Add `'metadataProfiles'`. This requires updates to:
  - `src/lib/server/sync/types.ts` (SectionType union)
  - `src/lib/server/sync/mappings.ts` (SYNC_SECTION_ORDER, SUPPORTED_SYNC_SECTIONS for lidarr only)
  - New `src/lib/server/sync/metadataProfiles/` directory with handler.ts, syncer.ts, transformer.ts
  - `src/lib/server/sync/registry.ts` (registration)
- **Capabilities**: Update `src/lib/shared/arr/capabilities.ts` to add `metadata_profiles` to `ArrSyncSurface`. Set it to `true` for Lidarr, `false` for Radarr/Sonarr.
- **App DB Tables**: Add sync configuration tables following the pattern of `arr_sync_delay_profiles_config` (single profile selection per instance, with database_id reference).
- **LidarrClient**: Add `getMetadataProfiles()`, `createMetadataProfile()`, `updateMetadataProfile()` methods to `src/lib/server/utils/arr/clients/lidarr.ts`. These use `/api/v1/metadataprofile`.
- **PCD Schema**: Add tables to `docs/pcdReference/0.schema.sql` and create a migration in `src/lib/server/db/migrations/`.

### Components to Leverage

- **WriteOperation Pipeline**: `src/lib/server/pcd/ops/writer.ts` -- all entity writes go through `writeOperation()` which handles SQL compilation, validation, and cache recompile.
- **Value Guards**: The PCD ops system uses value guards for updates/deletes to detect upstream changes. Metadata profile updates should use guards on the `allowed` boolean values.
- **Conflict System**: `src/lib/server/pcd/conflicts/` handles base vs. user op conflicts and auto-alignment. Register metadata profile fields in the auto-align rules if needed.
- **Namespace Suffixes**: `src/lib/server/sync/namespace.ts` -- invisible Unicode suffixes for multi-database coexistence. Metadata profile names need the same treatment during sync.
- **Display Types**: Add list item and detail types to `src/lib/shared/pcd/display.ts`.

### Key Files for Reference

- `/src/lib/server/pcd/entities/registry.ts`: Entity auto-align registry
- `/src/lib/shared/pcd/types.ts`: PCD database table interfaces (auto-generated from schema)
- `/src/lib/shared/pcd/portable.ts`: Portable entity types for import/export/clone
- `/src/lib/shared/arr/capabilities.ts`: Arr capability definitions
- `/src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr API client
- `/src/lib/server/utils/arr/types.ts`: Arr client type definitions
- `/src/lib/server/utils/arr/base.ts`: Base arr client with shared methods
- `/src/lib/server/sync/types.ts`: Sync type definitions (SectionType)
- `/src/lib/server/sync/mappings.ts`: Sync section support matrix
- `/src/lib/server/sync/registry.ts`: Sync section registration
- `/src/lib/server/sync/qualityProfiles/handler.ts`: Example section handler
- `/src/lib/server/sync/qualityProfiles/syncer.ts`: Example complex syncer
- `/src/lib/server/sync/mediaManagement/syncer.ts`: Example config syncer (Lidarr-aware)
- `/src/lib/server/db/schema.sql`: App database schema reference
- `/src/lib/server/db/migrations/20260215_add_lidarr_media_management_entities.ts`: Recent Lidarr migration example
- `/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Built-in base ops seeding for new databases
- `/src/lib/server/pcd/entities/serialize.ts`: Entity serialization for export/clone
- `/src/lib/server/pcd/entities/deserialize.ts`: Entity deserialization for import/clone
- `/src/lib/server/pcd/entities/validate.ts`: Entity validation (name uniqueness)
- `/src/lib/server/pcd/entities/clone.ts`: Entity cloning
- `/docs/pcdReference/0.schema.sql`: PCD schema definition
- `/docs/plans/enhance-lidarr-support/research-technical.md`: Prior Lidarr enhancement research
- `/docs/plans/enhance-lidarr-support/research-business.md`: Prior Lidarr business research

## PCD Schema Design (Proposed)

```sql
-- Lidarr metadata profiles
-- Controls which album types and release statuses to monitor
CREATE TABLE lidarr_metadata_profiles (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Primary album type allowed flags per metadata profile
CREATE TABLE lidarr_metadata_profile_primary_types (
    metadata_profile_name VARCHAR(100) NOT NULL,
    primary_type_id INTEGER NOT NULL,  -- 0=Album, 1=EP, 2=Single, 3=Broadcast, 4=Other
    allowed INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (metadata_profile_name, primary_type_id),
    FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Secondary album type allowed flags per metadata profile
CREATE TABLE lidarr_metadata_profile_secondary_types (
    metadata_profile_name VARCHAR(100) NOT NULL,
    secondary_type_id INTEGER NOT NULL,  -- 0=Studio .. 11=Field Recording
    allowed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (metadata_profile_name, secondary_type_id),
    FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Release status allowed flags per metadata profile
CREATE TABLE lidarr_metadata_profile_release_statuses (
    metadata_profile_name VARCHAR(100) NOT NULL,
    release_status_id INTEGER NOT NULL,  -- 0=Official, 1=Promotional, 2=Bootleg, 3=Pseudo-Release
    allowed INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (metadata_profile_name, release_status_id),
    FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);
```

## App DB Schema Design (Proposed)

```sql
-- Metadata profile sync selections (many-to-many: instance <-> profile)
CREATE TABLE arr_sync_metadata_profiles (
    instance_id INTEGER NOT NULL,
    database_id INTEGER NOT NULL,
    profile_name TEXT NOT NULL,
    PRIMARY KEY (instance_id, database_id, profile_name),
    FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
    FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
);

-- Metadata profile sync configuration (one per instance)
CREATE TABLE arr_sync_metadata_profiles_config (
    instance_id INTEGER PRIMARY KEY,
    trigger TEXT NOT NULL DEFAULT 'none',
    cron TEXT,
    should_sync INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT,
    last_synced_at TEXT,
    FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
);
```

## Success Criteria

- [ ] PCD schema includes `lidarr_metadata_profiles` and child tables for primary types, secondary types, and release statuses
- [ ] PCD entity operations (create, read, update, delete, list) work for metadata profiles
- [ ] Metadata profiles support PCD ops pipeline (base ops, user ops, value guards)
- [ ] Metadata profiles are included in portable types for import/export/clone
- [ ] Lidarr client has `getMetadataProfiles()`, `createMetadataProfile()`, `updateMetadataProfile()` methods
- [ ] Sync section handler exists for metadata profiles with handler, syncer, and transformer
- [ ] Sync is gated to Lidarr instances only (Radarr/Sonarr skip metadata profiles)
- [ ] Namespace suffixes are applied to metadata profile names during sync
- [ ] App DB has sync configuration tables for metadata profile selections and triggers
- [ ] Capabilities system reflects metadata_profiles as a Lidarr-only sync surface
- [ ] UI routes exist for listing, creating, editing metadata profiles within a database
- [ ] Metadata profiles appear in the Lidarr instance sync configuration UI

## Open Questions

1. **Sync Section vs. Extension of Media Management**: Should metadata profiles be a new top-level sync section (like quality profiles, delay profiles, media management) or be folded into the existing media management section? A new section is cleaner architecturally and follows the Lidarr-only scoping requirement, but adds more sync configuration UI. **Recommendation**: New section -- metadata profiles are conceptually independent from media settings/naming/quality-definitions.

2. **Schema Normalization**: Should the primary type, secondary type, and release status IDs be stored in reference tables (like `qualities` for quality profiles) or as inline integer IDs? The values are fixed by MusicBrainz/Lidarr and unlikely to change. **Recommendation**: Inline integer IDs with a constants file mapping IDs to names (simpler, matches the fixed enumeration nature).

3. **Default Profile Seeding**: Should Profilarr include a built-in default metadata profile (e.g., "Standard - Albums + Official") as a base op seed? **Recommendation**: Yes, seed a sensible default in `seedBuiltInBaseOps.ts` so newly initialized databases have a usable metadata profile out of the box.

4. **Delete Behavior on Sync**: When a metadata profile is deleted from PCD, should the sync actively delete it from Lidarr? Lidarr prevents deleting profiles in use by artists. **Recommendation**: Do NOT delete on sync. Only create and update. Document this as a conscious design choice.

5. **Cross-Arr Semantic Validation**: Per the project's Cross-Arr Semantic Validation Policy, metadata profile sync must verify that the target instance is actually Lidarr before attempting any metadata profile operations. This is already inherent in the section support matrix (`SUPPORTED_SYNC_SECTIONS`).

## External References

- [Lidarr API Docs](https://lidarr.audio/docs/api/)
- [Lidarr Settings - Servarr Wiki](https://wiki.servarr.com/lidarr/settings)
- [Go starr/lidarr package (MetadataProfile type)](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr)
- [golift.io/starr/lidarr package](https://pkg.go.dev/golift.io/starr/lidarr)
- [Lidarr GitHub Repository](https://github.com/Lidarr/Lidarr)
- [Lidarr Issue #1021 - Audio drama in Metadata Profiles](https://github.com/lidarr/Lidarr/issues/1021)
- [Lidarr Issue #589 - DJ-mix secondary type](https://github.com/lidarr/Lidarr/issues/589)
