# Feature Spec: Lidarr Metadata Profiles

## Executive Summary

Lidarr metadata profiles are a Lidarr-exclusive entity that controls which MusicBrainz album types (primary and secondary) and release statuses are monitored per-artist -- a critical filtering mechanism with no Radarr/Sonarr equivalent. Adding metadata profile management to Praxrr enables centralized, templated control over what music content Lidarr considers for download, synced to instances via the existing PCD ops pipeline. The implementation follows the quality-profile entity pattern (parent table + three child junction tables), adds a new `metadataProfiles` sync section gated exclusively to `arr_type = 'lidarr'`, and extends the `LidarrClient` with CRUD methods against `/api/v1/metadataprofile`. The primary risk is ensuring strict Cross-Arr Semantic Validation Policy compliance since this entity family has zero cross-Arr overlap; the primary challenge is the moderate surface area (~35-50 tasks across PCD schema, entity CRUD, sync pipeline, API routes, and UI).

## External Dependencies

### APIs and Services

#### Lidarr Metadata Profile API

- **Documentation**: [Lidarr Swagger UI](https://lidarr.audio/docs/api/) | [OpenAPI spec](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/openapi.json)
- **Source Code**: [MetadataProfileController.cs](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileController.cs), [MetadataProfileResource.cs](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileResource.cs)
- **Authentication**: `X-Api-Key` header or `?apikey=` query param (same as all Arr apps)
- **API Version**: `v1` (Lidarr uses `/api/v1/`, unlike Sonarr/Radarr which use `/api/v3/`)
- **Key Endpoints**:
  - `GET /api/v1/metadataprofile`: List all metadata profiles
  - `GET /api/v1/metadataprofile/{id}`: Get single profile
  - `GET /api/v1/metadataprofile/schema`: Template with all types (`allowed: false`)
  - `POST /api/v1/metadataprofile`: Create profile (201)
  - `PUT /api/v1/metadataprofile/{id}`: Update profile (202)
  - `DELETE /api/v1/metadataprofile/{id}`: Delete profile (200)
- **Rate Limits**: None (self-hosted). Enabling many types for prolific artists causes slow refreshes.
- **Pricing**: N/A (self-hosted)

### Libraries and SDKs

No TypeScript/JavaScript Lidarr client library exists on npm. The project's existing `LidarrClient` class will be extended directly.

| Library                     | Language    | Purpose                  | Notes                                                   |
| --------------------------- | ----------- | ------------------------ | ------------------------------------------------------- |
| `starr` (golift)            | Go          | Reference implementation | `MetadataProfile` struct confirms API shape             |
| `lidarr-py` (devopsarr)     | Python      | Reference implementation | Auto-generated from OpenAPI, `MetadataProfileApi` class |
| `terraform-provider-lidarr` | Terraform   | Reference implementation | Full CRUD for metadata profiles                         |
| Configarr                   | YAML config | Competitive reference    | Added metadata profiles in v1.19.0 (experimental)       |

### External Documentation

- [MusicBrainz Release Group/Type](https://musicbrainz.org/doc/Release_Group/Type): Source taxonomy for primary/secondary types
- [MusicBrainz Release Statuses](https://musicbrainz.org/doc/Release): Source for release status values
- [Servarr Wiki - Lidarr Settings](https://wiki.servarr.com/lidarr/settings): User-facing metadata profile docs
- [Lidarr GitHub](https://github.com/Lidarr/Lidarr): Source code for API controllers, validators, and enum definitions

## Business Requirements

### User Stories

**Primary User: Praxrr Administrator**

- As a Praxrr user, I want to define metadata profiles in my PCD database so that I can curate which album types and release statuses Lidarr monitors across all my instances.
- As a Praxrr user, I want to sync metadata profiles to my Lidarr instances so that new artists automatically inherit correct monitoring filters without manual per-instance configuration.
- As a Praxrr user, I want to manage multiple metadata profiles (e.g., "Discography" vs "Studio Albums Only") to assign different filtering strategies to different instances.
- As a Praxrr user, I want metadata profiles to participate in the PCD system (base ops, user ops, import/export, clone) so they are portable and version-controlled like all other entities.

**Secondary User: PCD Database Author**

- As a PCD database author, I want to ship opinionated metadata profile presets so community members can use curated defaults.
- As a PCD database author, I want metadata profiles to support user-layer overrides so administrators can customize base presets without forking.

### Business Rules

1. **Lidarr-Only Entity**: Metadata profiles are exclusively a Lidarr concept. All PCD tables, sync handlers, API routes, and UI must be scoped to `arr_type = 'lidarr'`. Radarr and Sonarr must never see metadata profile code paths.

2. **Exhaustive Type Enumeration**: A metadata profile must enumerate ALL known primary types (5), ALL secondary types (11-13), and ALL release statuses (4), each with an explicit `allowed` boolean. The Lidarr API expects the full list in PUT/POST payloads.

3. **Primary Album Types** (from Lidarr source, MusicBrainz-derived):

   | ID  | Name      | Description                  |
   | --- | --------- | ---------------------------- |
   | 0   | Album     | Full-length LP release       |
   | 1   | EP        | Extended play                |
   | 2   | Single    | One main song + extras       |
   | 3   | Broadcast | Episodic broadcast content   |
   | 4   | Other     | Doesn't fit other categories |

4. **Secondary Album Types** (from Lidarr source):

   | ID  | Name           | Notes                                       |
   | --- | -------------- | ------------------------------------------- |
   | 0   | Studio         | Lidarr-specific (not in MusicBrainz)        |
   | 1   | Compilation    | Various sources grouped by theme/era        |
   | 2   | Soundtrack     | Movies, TV, games                           |
   | 3   | Spokenword     | Non-music spoken content                    |
   | 4   | Interview      | Artist interviews                           |
   | 5   | Audiobook      | **Excluded from Lidarr's `All` collection** |
   | 6   | Live           | Recorded live                               |
   | 7   | Remix          | Remixed material                            |
   | 8   | DJ-mix         | Blended continuous flow                     |
   | 9   | Mixtape/Street | Promotional releases                        |
   | 10  | Demo           | Limited circulation                         |
   | 11  | Audio drama    | Audio-only theatrical                       |

   **Important**: Audiobook (ID 5) exists in Lidarr source but is deliberately excluded from the `All` collection and schema endpoint. ID gap at 5 means IDs are not contiguous.

5. **Release Statuses** (from Lidarr source):

   | ID  | Name           | Description                          |
   | --- | -------------- | ------------------------------------ |
   | 0   | Official       | Sanctioned by artist/label           |
   | 1   | Promotion      | Pre-release promotional              |
   | 2   | Bootleg        | Unofficial/underground               |
   | 3   | Pseudo-Release | Alternate version (transliterations) |

6. **Name Uniqueness**: Case-insensitive uniqueness enforced on create/rename (existing PCD convention).

7. **Reserved Name**: "None" is a reserved profile name in Lidarr; validation must reject it.

8. **Minimum Selection**: At least one primary type, at least one secondary type, and at least one release status must have `allowed: true` (enforced by Lidarr's `MetadataValidator`).

9. **Profile-in-Use Protection**: Lidarr prevents deleting profiles assigned to artists. Sync should NOT delete profiles from Lidarr -- only create and update.

10. **Artist Assignment**: Praxrr manages profile definitions only. Artist-to-profile assignment is done in Lidarr itself (via `metadataProfileId` on artist resource).

### Edge Cases

| Scenario                                      | Expected Behavior                                                       | Notes                                        |
| --------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| New type added in future Lidarr version       | Unknown types from API preserved during updates; hardcoded list may lag | Consider schema endpoint for future-proofing |
| All types disallowed                          | Valid but useless -- Lidarr monitors nothing                            | Warn user, don't reject                      |
| Profile deleted from PCD while synced         | Do NOT delete from Lidarr (may be in use by artists)                    | Sync only creates/updates                    |
| Multiple PCD databases syncing to same Lidarr | Namespace suffixes applied to profile names                             | Same pattern as quality profiles             |
| Metadata profile renamed in Praxrr         | Rename propagates to synced instances                                   | Consistent with QP rename behavior           |

### Success Criteria

- [ ] PCD schema includes `lidarr_metadata_profiles` and three child tables
- [ ] PCD entity CRUD operations work (create, read, update, delete, list)
- [ ] PCD ops pipeline works (base ops, user ops, value guards, conflicts)
- [ ] Portable types support import/export/clone
- [ ] LidarrClient has metadata profile CRUD methods
- [ ] Sync section exists for metadata profiles (handler, syncer, transformer)
- [ ] Sync is gated to Lidarr instances only
- [ ] Namespace suffixes applied during sync
- [ ] App DB has sync configuration tables
- [ ] Capabilities system reflects metadata_profiles as Lidarr-only
- [ ] UI routes exist for list, create, edit metadata profiles
- [ ] Sync configuration UI includes metadata profile selection for Lidarr instances

## Technical Specifications

### Architecture Overview

```
[PCD Writer] ──> [pcd_ops table] ──> [PCD Cache Compiler]
                                            |
                                            v
                                    [In-memory SQLite]
                                    (lidarr_metadata_profiles,
                                     lidarr_metadata_profile_primary_types,
                                     lidarr_metadata_profile_secondary_types,
                                     lidarr_metadata_profile_release_statuses)
                                            |
                                            v
                              [Sync Pipeline: MetadataProfiles Section]
                                            |
                                            v
                              [LidarrClient.updateMetadataProfile()]
                                            |
                                            v
                              [Lidarr API: PUT /api/v1/metadataprofile/{id}]
```

### Data Models

#### PCD Cache Tables (In-Memory SQLite)

##### lidarr_metadata_profiles

| Column      | Type     | Constraints                     | Description                          |
| ----------- | -------- | ------------------------------- | ------------------------------------ |
| id          | INTEGER  | PK AUTOINCREMENT                | Auto-increment primary key           |
| name        | TEXT     | NOT NULL, UNIQUE COLLATE NOCASE | Profile name, stable key for PCD ops |
| description | TEXT     | NULL                            | Optional markdown description        |
| created_at  | DATETIME | DEFAULT CURRENT_TIMESTAMP       | Creation timestamp                   |
| updated_at  | DATETIME | DEFAULT CURRENT_TIMESTAMP       | Last update timestamp                |

##### lidarr_metadata_profile_primary_types

| Column                | Type    | Constraints          | Description                  |
| --------------------- | ------- | -------------------- | ---------------------------- |
| metadata_profile_name | TEXT    | NOT NULL, FK CASCADE | Parent profile reference     |
| type_id               | INTEGER | NOT NULL             | Lidarr primary type ID (0-4) |
| name                  | TEXT    | NOT NULL             | Display name                 |
| allowed               | INTEGER | NOT NULL DEFAULT 0   | 1=allowed, 0=not             |

**PK**: `(metadata_profile_name, type_id)`

##### lidarr_metadata_profile_secondary_types

| Column                | Type    | Constraints          | Description                               |
| --------------------- | ------- | -------------------- | ----------------------------------------- |
| metadata_profile_name | TEXT    | NOT NULL, FK CASCADE | Parent profile reference                  |
| type_id               | INTEGER | NOT NULL             | Lidarr secondary type ID (0-11, gap at 5) |
| name                  | TEXT    | NOT NULL             | Display name                              |
| allowed               | INTEGER | NOT NULL DEFAULT 0   | 1=allowed, 0=not                          |

**PK**: `(metadata_profile_name, type_id)`

##### lidarr_metadata_profile_release_statuses

| Column                | Type    | Constraints          | Description                    |
| --------------------- | ------- | -------------------- | ------------------------------ |
| metadata_profile_name | TEXT    | NOT NULL, FK CASCADE | Parent profile reference       |
| status_id             | INTEGER | NOT NULL             | Lidarr release status ID (0-3) |
| name                  | TEXT    | NOT NULL             | Display name                   |
| allowed               | INTEGER | NOT NULL DEFAULT 0   | 1=allowed, 0=not               |

**PK**: `(metadata_profile_name, status_id)`

#### PCD Schema SQL

```sql
CREATE TABLE IF NOT EXISTS lidarr_metadata_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_primary_types (
    metadata_profile_name TEXT NOT NULL,
    type_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (metadata_profile_name, type_id),
    FOREIGN KEY (metadata_profile_name)
        REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_secondary_types (
    metadata_profile_name TEXT NOT NULL,
    type_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (metadata_profile_name, type_id),
    FOREIGN KEY (metadata_profile_name)
        REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS lidarr_metadata_profile_release_statuses (
    metadata_profile_name TEXT NOT NULL,
    status_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (metadata_profile_name, status_id),
    FOREIGN KEY (metadata_profile_name)
        REFERENCES lidarr_metadata_profiles(name)
        ON DELETE CASCADE ON UPDATE CASCADE
);
```

#### App DB Table (praxrr.db)

##### arr_sync_metadata_profiles_config

| Column         | Type    | Constraints             | Description                                |
| -------------- | ------- | ----------------------- | ------------------------------------------ |
| instance_id    | INTEGER | PK                      | FK -> arr_instances(id) CASCADE            |
| trigger        | TEXT    | NOT NULL DEFAULT 'none' | none, manual, on_pull, on_change, schedule |
| cron           | TEXT    | NULL                    | Cron expression for schedule               |
| should_sync    | INTEGER | NOT NULL DEFAULT 0      | Pending flag                               |
| next_run_at    | TEXT    | NULL                    | Next scheduled run                         |
| database_id    | INTEGER | NULL                    | FK -> database_instances(id) SET NULL      |
| profile_name   | TEXT    | NULL                    | Selected PCD profile name                  |
| sync_status    | TEXT    | NOT NULL DEFAULT 'idle' | idle, pending, in_progress, failed         |
| last_error     | TEXT    | NULL                    | Last sync error                            |
| last_synced_at | TEXT    | NULL                    | Last success timestamp                     |

**Design note**: Single profile per instance (delay-profiles pattern), not many-to-many (quality-profiles pattern).

### API Design

All endpoints under existing PCD entity route pattern.

#### `GET /api/v1/pcd/{databaseId}/lidarr-metadata-profiles`

**Purpose**: List all metadata profiles in PCD database.

**Response (200)**:

```json
[
  {
    "id": 1,
    "name": "Standard",
    "description": "<p>Albums and EPs only</p>",
    "primaryTypes": [
      { "typeId": 0, "name": "Album", "allowed": true },
      { "typeId": 1, "name": "EP", "allowed": true },
      { "typeId": 2, "name": "Single", "allowed": false },
      { "typeId": 3, "name": "Broadcast", "allowed": false },
      { "typeId": 4, "name": "Other", "allowed": false }
    ],
    "secondaryTypes": [{ "typeId": 0, "name": "Studio", "allowed": true }],
    "releaseStatuses": [{ "statusId": 0, "name": "Official", "allowed": true }]
  }
]
```

#### `POST /api/v1/pcd/{databaseId}/lidarr-metadata-profiles`

**Purpose**: Create metadata profile.

**Request**: Same shape as list item (minus `id`). All types/statuses with `allowed` flags.

**Response (200)**: `{ "success": true }` or `{ "success": false, "error": "..." }`

**Errors**:

| Status | Condition                             | Response                |
| ------ | ------------------------------------- | ----------------------- |
| 400    | Empty/duplicate name, reserved "None" | Validation error        |
| 400    | No allowed primary types/statuses     | Minimum selection error |
| 404    | Database not found                    | Not found               |

#### `PUT /api/v1/pcd/{databaseId}/lidarr-metadata-profiles/{id}`

**Purpose**: Update metadata profile (partial updates supported).

#### `DELETE /api/v1/pcd/{databaseId}/lidarr-metadata-profiles/{id}`

**Purpose**: Delete metadata profile.
**Request**: `{ "name": "Standard" }` (name for PCD ops metadata).

### Lidarr API Types

```typescript
interface LidarrMetadataProfileAlbumTypeItem {
  albumType: { id: number; name: string };
  allowed: boolean;
}

interface LidarrMetadataProfileReleaseStatusItem {
  releaseStatus: { id: number; name: string };
  allowed: boolean;
}

interface LidarrMetadataProfile {
  id?: number;
  name: string;
  primaryAlbumTypes: LidarrMetadataProfileAlbumTypeItem[];
  secondaryAlbumTypes: LidarrMetadataProfileAlbumTypeItem[];
  releaseStatuses: LidarrMetadataProfileReleaseStatusItem[];
}
```

### System Integration

#### Files to Create

| Path                                                                          | Purpose                              |
| ----------------------------------------------------------------------------- | ------------------------------------ |
| `src/lib/server/pcd/entities/metadataProfiles/create.ts`                      | PCD create operation                 |
| `src/lib/server/pcd/entities/metadataProfiles/read.ts`                        | Read/list from PCD cache             |
| `src/lib/server/pcd/entities/metadataProfiles/update.ts`                      | PCD update operation                 |
| `src/lib/server/pcd/entities/metadataProfiles/delete.ts`                      | PCD delete operation                 |
| `src/lib/server/pcd/entities/metadataProfiles/index.ts`                       | Module re-exports                    |
| `src/lib/server/sync/metadataProfiles/handler.ts`                             | Sync section handler                 |
| `src/lib/server/sync/metadataProfiles/syncer.ts`                              | PCD read -> transform -> Lidarr push |
| `src/lib/server/sync/metadataProfiles/index.ts`                               | Module re-exports                    |
| `src/lib/server/db/migrations/YYYYMMDD_add_lidarr_metadata_profiles.ts`       | App DB + PCD base op migration       |
| `src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts`      | GET list, POST create                |
| `src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts` | GET single, PUT, DELETE              |

#### Files to Modify

| Path                                           | Changes                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/shared/pcd/types.ts`                  | 4 Kysely table interfaces + 4 Row types + PCDDatabase additions |
| `src/lib/shared/pcd/display.ts`                | Display types for list/detail views                             |
| `src/lib/shared/pcd/portable.ts`               | `PortableLidarrMetadataProfile` + ENTITY_TYPES                  |
| `src/lib/shared/arr/capabilities.ts`           | `metadata_profiles` in ArrSyncSurface + LIDARR_CAPABILITIES     |
| `src/lib/server/utils/arr/types.ts`            | Lidarr metadata profile API types                               |
| `src/lib/server/utils/arr/clients/lidarr.ts`   | 6 metadata profile methods                                      |
| `src/lib/server/pcd/entities/registry.ts`      | AUTO_ALIGN_ENTITIES entry                                       |
| `src/lib/server/pcd/entities/serialize.ts`     | Serialization function                                          |
| `src/lib/server/pcd/entities/deserialize.ts`   | Deserialization function                                        |
| `src/lib/server/pcd/entities/clone.ts`         | Clone support                                                   |
| `src/lib/server/pcd/entities/validate.ts`      | Validation rules                                                |
| `src/lib/server/pcd/database/cache.ts`         | `mp(name)` helper function                                      |
| `src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` | Register built-in base op                                       |
| `src/lib/server/sync/types.ts`                 | `'metadataProfiles'` in SectionType + InstanceSyncResult        |
| `src/lib/server/sync/processor.ts`             | Import handler, trigger wiring, totalSynced                     |
| `src/lib/server/sync/mappings.ts`              | SYNC_SECTION_ORDER + SUPPORTED_SYNC_SECTIONS (lidarr only)      |
| `src/lib/server/db/queries/arrSync.ts`         | Metadata profile sync query functions                           |
| `src/lib/server/db/schema.sql`                 | Document new table                                              |
| `src/lib/server/db/migrations.ts`              | Register migration                                              |

## UX Considerations

### User Workflows

#### Primary Workflow: Create Metadata Profile

1. **Navigate**: User clicks "Metadata Profiles" in navigation.
   - System shows list page with existing profiles (card/table view).

2. **Initiate**: User clicks "+" action button.
   - System navigates to create route.

3. **Configure**: User enters name, optionally description/tags.
   - System validates name uniqueness (case-insensitive).
   - Dirty tracking activates.

4. **Select Types**: User configures three checkbox groups:
   - **Primary Album Types** (5 checkboxes): Default = Album checked
   - **Secondary Album Types** (11 checkboxes): Default = Studio checked
   - **Release Statuses** (4 checkboxes): Default = Official checked
   - Each group has Toggle All control with count badge ("N of M allowed").

5. **Save**: User clicks "Create" in StickyCard header.
   - System validates minimum selections, writes PCD ops.
   - Navigates to list with success alert.

#### Edit Workflow

1. User clicks profile card/row -> navigates to edit route.
2. Toggles checkboxes in any group -> dirty tracking marks form modified.
3. Saves -> PCD ops with value guards for conflict detection.
4. Navigation guard (DirtyModal) prevents accidental loss.

#### Delete Workflow

1. User clicks "Delete" in StickyCard header -> confirmation modal.
2. System checks sync configuration references.
3. If in use: error alert ("Reassign instances first").
4. If not in use: writes delete PCD op, navigates to list.

#### Sync Workflow

1. User assigns metadata profile to Lidarr instance in sync config (dropdown).
2. Sync fires -> reads PCD -> transforms to Lidarr API format -> GET existing profiles -> match by name -> create or update.
3. Error states shown in sync status UI.

### UI Patterns

| Component      | Pattern                            | Notes                                                     |
| -------------- | ---------------------------------- | --------------------------------------------------------- |
| List Page      | CardView/TableView with ActionsBar | Reuse quality profile list pattern                        |
| Edit Page      | Single-page form (no tabs)         | StickyCard header + 3 checkbox groups                     |
| Checkbox Group | New `CheckboxGroup.svelte`         | Toggle-all, count badge, fieldset accessibility           |
| Checkboxes     | `IconCheckbox` with `Check` icon   | Full-row clickable, 44px touch targets                    |
| Profile Pills  | `Label` component                  | Primary=secondary variant, Secondary=info, Status=success |
| Clone          | `CloneModal`                       | Existing reusable modal                                   |
| Dirty Tracking | `dirty` store                      | Same pattern as quality profiles                          |

**Layout**:

```
[StickyCard: "Edit Metadata Profile" | Delete | Save]

[Name Input]
[Description Input] (optional, Praxrr-only, not synced)

[Primary Album Types]     "1 of 5 allowed"  [Toggle All]
  [ ] Album  [x] EP  [ ] Single  [ ] Broadcast  [ ] Other

[Secondary Album Types]   "1 of 11 allowed" [Toggle All]
  [x] Studio  [ ] Compilation  [ ] Soundtrack  ...

[Release Statuses]        "1 of 4 allowed"  [Toggle All]
  [x] Official  [ ] Promotional  [ ] Bootleg  [ ] Pseudo-Release
```

### Accessibility Requirements

- **Checkbox grouping**: `<fieldset>` with `<legend>` or `role="group"` with `aria-labelledby`
- **Tri-state Toggle All**: `aria-checked="mixed"` for indeterminate state
- **Keyboard**: `Space` to toggle, `Tab` between items
- **Touch targets**: 44x44px minimum (full row clickable)
- **Focus indicator**: Visible keyboard focus ring on checkbox rows
- **Contrast**: 3:1 minimum for checkbox indicators (WCAG 1.4.11)

### Performance UX

- **Loading States**: Skeleton cards during list fetch; spinner in content area during edit fetch
- **Optimistic Updates**: Checkbox toggles are instant (client-side dirty store); no server round-trip until Save
- **Sync Progress**: Per-instance status (pending, syncing, success, failed) matching existing pattern
- **Progressive Loading**: `createProgressiveList` with `pageSize: 30` (safeguard; profile count will be low)

### Performance Warning

Display an informational note near checkbox groups: "Enabling many types for prolific artists can significantly increase loading times in Lidarr. A conservative profile (Album + Studio + Official) is recommended for most use cases."

## Recommendations

### Implementation Approach

**Recommended Strategy**: Full PCD integration (Option A) following the quality-profile entity pattern. Metadata profiles are named entities with a fixed schema that users will want to share across databases and sync to instances. The additional complexity over a lightweight approach is bounded and well-understood.

**Phasing**:

1. **Phase 1 - PCD Foundation**: Schema tables, Kysely types, entity registry, base ops migration, portable types, capabilities
2. **Phase 2 - API + Sync**: PCD entity CRUD, API routes, LidarrClient methods, sync pipeline (handler/syncer/transformer), app DB sync tables
3. **Phase 3 - UI**: List/detail pages, checkbox group component, sync settings integration
4. **Phase 4 - Testing**: Unit tests for transformer, entity CRUD, E2E sync lifecycle

### Technology Decisions

| Decision              | Recommendation                                       | Rationale                                                                  |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Client methods        | LidarrClient only (not BaseArrClient)                | Cross-Arr policy: metadata profiles are Lidarr-exclusive                   |
| Sync config           | Single profile per instance (delay-profiles pattern) | Lidarr instances typically need 1-3 profiles; simpler model                |
| PCD table prefix      | `lidarr_` prefix on all tables                       | Follows `lidarr_naming`, `lidarr_media_settings` convention                |
| Child table storage   | Store all types with `allowed` boolean               | Lidarr API requires full list; makes ops cleaner (UPDATE vs INSERT/DELETE) |
| Entity type in ops    | `lidarr_metadata_profile`                            | Consistent with Arr-prefixed naming for Arr-specific entities              |
| Name matching in sync | By name with namespace suffix                        | Consistent with quality profile sync semantics                             |

### Quick Wins

- **Type definitions**: Adding `LidarrMetadataProfile` types to `arr/types.ts` (zero runtime risk)
- **LidarrClient methods**: Adding CRUD methods (low risk, immediately testable)
- **Capability surface**: Adding `'metadata_profiles'` to `ArrSyncSurface` (small change, enables gating)

### Future Enhancements

- **Profile Templates**: Pre-built profiles seeded as base ops ("Albums Only", "Everything", "Albums + EPs")
- **Import from Lidarr**: Pull existing profiles from a running instance into PCD
- **Artist Assignment**: Expose per-artist metadata profile assignment from Praxrr
- **Profile Comparison**: Side-by-side diff view for comparing profiles
- **Library View Integration**: Display metadata profile info alongside quality profile in Lidarr library view

## Risk Assessment

### Technical Risks

| Risk                                      | Likelihood | Impact | Mitigation                                                |
| ----------------------------------------- | ---------- | ------ | --------------------------------------------------------- |
| Lidarr API schema changes (new types)     | Low        | Medium | Use schema endpoint at sync time or maintain update path  |
| Cross-Arr policy violation                | Low        | High   | Gate ALL paths behind `arr_type === 'lidarr'`; fail-fast  |
| Sync conflict with manual Lidarr profiles | Medium     | Medium | Name-based matching with create-or-update semantics       |
| Namespace suffix collision                | Low        | Medium | Reuse existing `getNamespaceSuffix()` from QP syncer      |
| Audiobook/Field Recording ID ambiguity    | Medium     | Low    | Verify against live Lidarr schema endpoint before release |

### Integration Challenges

- **Sync section expansion**: Adding a 4th `SectionType` requires changes to `InstanceSyncResult`, `SYNC_SECTION_ORDER`, `SUPPORTED_SYNC_SECTIONS`, `triggerSyncs()`, and `processPendingSyncs()`. Each currently hard-codes three sections.
- **No BaseArrClient methods**: Metadata profile methods on `LidarrClient` only, not shared base class. `LidarrClient` already handles API v1 correctly.
- **App DB migration**: New `arr_sync_metadata_profiles_config` table + arrSync queries (~10 query functions).

### Cross-Arr Validation Compliance

Per CLAUDE.md Cross-Arr Semantic Validation Policy:

- [x] API semantics verified: Lidarr-only concept, zero Radarr/Sonarr equivalent
- [x] Schema/field mappings: Lidarr-specific enums with no cross-Arr mapping
- [x] Read/write/sync dispatch: All paths guard on `arr_type === 'lidarr'`, no sibling fallback
- [x] Migration/import/export: Entity prefixed `lidarr_metadata_profile`

Per Arr Cutover Guardrails:

- [x] Dedicated Lidarr tables from inception (no shared/transitional)
- [x] Built-in base ops registered in `seedBuiltInBaseOps.ts`
- [x] `SUPPORTED_SYNC_SECTIONS` only adds `'metadataProfiles'` for `lidarr`

### Security Considerations

- API keys stored in `arr_instances` table (existing pattern) -- no new credential storage needed
- Profile names validated server-side for uniqueness and reserved names
- No new external network calls beyond existing Lidarr API pattern

## Task Breakdown Preview

### Phase 1: Foundation

**Focus**: Schema, types, migration, base ops

**Tasks**:

- PCD schema SQL for 4 tables (embedded in migration)
- App DB migration for `arr_sync_metadata_profiles_config`
- Kysely table interfaces + Row types in `src/lib/shared/pcd/types.ts`
- Portable type in `src/lib/shared/pcd/portable.ts` + ENTITY_TYPES
- Display types in `src/lib/shared/pcd/display.ts`
- Capabilities update in `src/lib/shared/arr/capabilities.ts`
- Entity registry in `src/lib/server/pcd/entities/registry.ts`
- Built-in base ops in `seedBuiltInBaseOps.ts`
- Arr client types in `src/lib/server/utils/arr/types.ts`

**Parallelization**: Types, capabilities, and registry updates are independent of each other.

### Phase 2: Core Implementation

**Focus**: Entity CRUD, API routes, sync pipeline

**Dependencies**: Phase 1 (schema and types must exist)

**Tasks**:

- PCD entity module (`create.ts`, `read.ts`, `update.ts`, `delete.ts`, `index.ts`)
- Serialize/deserialize/clone/validate updates
- PCD cache helper (`mp(name)`)
- API routes (list, create, get, update, delete)
- LidarrClient methods (6 methods)
- Sync handler + syncer + transformer
- Sync type/mapping/processor updates
- arrSync query functions (~10 functions)

**Parallelization**: LidarrClient methods can be developed in parallel with PCD entity operations. Sync pipeline can begin once types are defined.

### Phase 3: UI + Testing

**Focus**: Management pages, sync settings, tests

**Dependencies**: Phase 2 (API routes must be functional)

**Tasks**:

- `CheckboxGroup.svelte` reusable component
- List page (card + table views)
- Create/edit page with form
- Metadata profile selection in Lidarr sync settings
- Unit tests for transformer + entity CRUD
- E2E test for metadata profile lifecycle

**Parallelization**: UI and testing can overlap once API is functional.

### Estimated Complexity

- **Total tasks**: ~35-50 discrete items
- **Files created**: ~20-25 new
- **Files modified**: ~15-20 existing
- **Critical path**: Schema -> Types -> Entity CRUD -> API Routes -> Sync -> UI
- **Comparable scope**: Similar to Lidarr media management cutover

## Decisions Needed

1. **Default Profile Seeding**
   - Options: (A) Seed "Standard" profile matching Lidarr defaults, (B) Leave empty, (C) Multiple presets
   - Impact: Determines out-of-box experience for new databases
   - Recommendation: (A) Seed "Standard" (Album + Studio + Official) via built-in base ops

2. **UI Navigation Placement**
   - Options: (A) Top-level `/metadata-profiles` route, (B) Nested under Lidarr section, (C) Under existing quality profiles
   - Impact: Affects discoverability and navigation structure
   - Recommendation: (A) Top-level route, consistent with `/quality-profiles` and `/delay-profiles`

3. **Schema Endpoint vs Hardcoded Constants**
   - Options: (A) Hardcode type/status enums, (B) Fetch from Lidarr schema endpoint at sync time
   - Impact: (A) is simpler but needs manual updates; (B) is future-proof but adds API call
   - Recommendation: (A) Hardcode initially, add schema validation as future enhancement

4. **Secondary Type Set Verification**
   - Issue: Discrepancy between research docs on Audiobook inclusion and exact secondary type count
   - Action needed: Verify against a running Lidarr instance's `/api/v1/metadataprofile/schema` response
   - Impact: Determines exact PCD seed data

5. **Sync Section Order**
   - Options: After `mediaManagement`, before `qualityProfiles`, or last
   - Recommendation: After `mediaManagement` (configuration-oriented, no dependency on other sections)

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Lidarr API details, type enumerations, validation rules, code examples
- [research-business.md](./research-business.md): User stories, business rules, PCD integration patterns, codebase analysis
- [research-technical.md](./research-technical.md): Architecture, data models, API design, file paths, sync integration
- [research-ux.md](./research-ux.md): Workflows, checkbox patterns, accessibility, competitive analysis
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, risk assessment, alternative approaches, task breakdown
