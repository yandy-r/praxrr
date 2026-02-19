# Technical Specifications: Lidarr Metadata Profiles

## Executive Summary

Lidarr metadata profiles are a Lidarr-exclusive entity that controls which album types (primary and secondary) and release statuses are monitored per-artist. Implementation requires adding four new PCD cache tables, a new entity CRUD module following the delay-profile pattern, extending the `LidarrClient` with metadata profile API methods, creating a new `metadataProfiles` sync section, and adding a new app DB sync config table with corresponding arrSync queries. The feature touches every layer of the stack (PCD schema, PCD entities, app DB, sync pipeline, Arr client, API routes, shared types) but follows well-established patterns with no architectural novelty.

## Architecture Design

### Component Diagram

```
[PCD Writer] ──> [pcd_ops table] ──> [PCD Cache Compiler]
                                            │
                                            ▼
                                    [In-memory SQLite]
                                    (lidarr_metadata_profiles,
                                     lidarr_metadata_profile_primary_types,
                                     lidarr_metadata_profile_secondary_types,
                                     lidarr_metadata_profile_release_statuses)
                                            │
                                            ▼
                              [Sync Pipeline: MetadataProfiles Section]
                                            │
                                            ▼
                              [LidarrClient.updateMetadataProfile()]
                                            │
                                            ▼
                              [Lidarr API: PUT /api/v1/metadataprofile/{id}]
```

### New Components

- **PCD Entity Module (`packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/`)**: CRUD operations for metadata profiles following the delay-profiles pattern. Includes `create.ts`, `read.ts`, `update.ts`, `delete.ts`, `index.ts`.
- **Sync Handler (`packages/praxrr-app/src/lib/server/sync/metadataProfiles/`)**: New sync section with `handler.ts`, `syncer.ts`, `index.ts` following the delay-profiles sync pattern. Transforms PCD metadata profile rows into Lidarr API payloads.
- **LidarrClient Methods**: Metadata profile API methods added to `LidarrClient` (not `BaseArrClient`, since this is Lidarr-only).
- **App DB Sync Config Table**: New `arr_sync_metadata_profiles_config` table for sync trigger/status per instance.
- **API Routes**: New endpoints under `/api/v1/pcd/{databaseId}/lidarr-metadata-profiles/`.

### Integration Points

- **PCD Schema Layer** -> **PCD Cache**: New tables are created via a built-in base op that ships with the migration (same pattern as `20260215_add_lidarr_media_management_entities.ts`). The schema SQL is embedded in the migration and also registered in `seedBuiltInBaseOps.ts`.
- **PCD Cache** -> **Sync Pipeline**: The `MetadataProfileSyncer` reads from PCD cache using the entity read module, transforms to Lidarr API format, and pushes via `LidarrClient`.
- **Sync Registry** -> **Processor**: New `metadataProfiles` section type is registered, processor loops include it.
- **arrSync Queries** -> **Sync Handler**: New query functions for metadata profile sync config (get, set, claim, complete, fail, pending).

## Data Models

### New PCD Cache Tables (In-Memory SQLite)

These tables exist in the PCD in-memory SQLite cache, created by a schema op.

#### lidarr_metadata_profiles

| Column      | Type     | Constraints                                   | Description                                      |
| ----------- | -------- | --------------------------------------------- | ------------------------------------------------ |
| id          | INTEGER  | PK AUTOINCREMENT                              | Auto-increment primary key                       |
| name        | TEXT     | NOT NULL, UNIQUE (case-insensitive via CHECK) | Profile name, used as the stable key for PCD ops |
| description | TEXT     | NULL                                          | Optional markdown description                    |
| created_at  | DATETIME | DEFAULT CURRENT_TIMESTAMP                     | Creation timestamp                               |
| updated_at  | DATETIME | DEFAULT CURRENT_TIMESTAMP                     | Last update timestamp                            |

**Design note**: The `name` column is the stable key for all child tables (name-based FK pattern used by quality profiles, see `quality_profile_name` in `quality_profile_qualities`, line 56 of `packages/praxrr-app/src/lib/shared/pcd/types.ts`). This avoids integer ID coupling in PCD ops.

#### lidarr_metadata_profile_primary_types

| Column                | Type    | Constraints                                                                        | Description                                        |
| --------------------- | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| metadata_profile_name | TEXT    | NOT NULL, FK -> lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE | Parent profile reference                           |
| type_id               | INTEGER | NOT NULL                                                                           | Lidarr primary album type ID (0-4)                 |
| name                  | TEXT    | NOT NULL                                                                           | Display name (Album, EP, Single, Broadcast, Other) |
| allowed               | INTEGER | NOT NULL DEFAULT 0                                                                 | 1=allowed, 0=not allowed                           |

**PK**: `(metadata_profile_name, type_id)`

#### lidarr_metadata_profile_secondary_types

| Column                | Type    | Constraints                                                                        | Description                                          |
| --------------------- | ------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| metadata_profile_name | TEXT    | NOT NULL, FK -> lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE | Parent profile reference                             |
| type_id               | INTEGER | NOT NULL                                                                           | Lidarr secondary album type ID (0-12)                |
| name                  | TEXT    | NOT NULL                                                                           | Display name (Studio, Compilation, Soundtrack, etc.) |
| allowed               | INTEGER | NOT NULL DEFAULT 0                                                                 | 1=allowed, 0=not allowed                             |

**PK**: `(metadata_profile_name, type_id)`

#### lidarr_metadata_profile_release_statuses

| Column                | Type    | Constraints                                                                        | Description                                                   |
| --------------------- | ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| metadata_profile_name | TEXT    | NOT NULL, FK -> lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE | Parent profile reference                                      |
| status_id             | INTEGER | NOT NULL                                                                           | Lidarr release status ID (0-3)                                |
| name                  | TEXT    | NOT NULL                                                                           | Display name (Official, Promotional, Bootleg, Pseudo-Release) |
| allowed               | INTEGER | NOT NULL DEFAULT 0                                                                 | 1=allowed, 0=not allowed                                      |

**PK**: `(metadata_profile_name, status_id)`

### Canonical Type Enumerations

These values come directly from [Lidarr source code](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Music/Model/PrimaryAlbumType.cs) and [MusicBrainz taxonomy](https://musicbrainz.org/doc/Release_Group/Type).

**Primary Album Types:**

| ID  | Name      |
| --- | --------- |
| 0   | Album     |
| 1   | EP        |
| 2   | Single    |
| 3   | Broadcast |
| 4   | Other     |

**Secondary Album Types:**

| ID  | Name            |
| --- | --------------- |
| 0   | Studio          |
| 1   | Compilation     |
| 2   | Soundtrack      |
| 3   | Spokenword      |
| 4   | Interview       |
| 5   | Audiobook       |
| 6   | Live            |
| 7   | Remix           |
| 8   | DJ-mix          |
| 9   | Mixtape/Street  |
| 10  | Demo            |
| 11  | Audio Drama     |
| 12  | Field Recording |

**Note**: The Lidarr source code at `SecondaryAlbumType.cs` has 12 entries (0-11). However the `research-recommendations.md` and `research-business.md` documents list 13 entries (0-12) adding "Field Recording" at ID 12. The existing research docs should be treated as authoritative since they may reflect a newer Lidarr version. The implementation should use the list from `research-recommendations.md`.

**Release Statuses:**

| ID  | Name           |
| --- | -------------- |
| 0   | Official       |
| 1   | Promotional    |
| 2   | Bootleg        |
| 3   | Pseudo-Release |

### New App DB Table (praxrr.db)

#### arr_sync_metadata_profiles_config

Follows the same pattern as `arr_sync_delay_profiles_config` (single profile selection per instance).

| Column         | Type    | Constraints             | Description                                          |
| -------------- | ------- | ----------------------- | ---------------------------------------------------- |
| instance_id    | INTEGER | PK                      | FK -> arr_instances(id) ON DELETE CASCADE            |
| trigger        | TEXT    | NOT NULL DEFAULT 'none' | 'none', 'manual', 'on_pull', 'on_change', 'schedule' |
| cron           | TEXT    | NULL                    | Cron expression for schedule trigger                 |
| should_sync    | INTEGER | NOT NULL DEFAULT 0      | Legacy pending flag                                  |
| next_run_at    | TEXT    | NULL                    | Next scheduled run timestamp                         |
| database_id    | INTEGER | NULL                    | FK -> database_instances(id) ON DELETE SET NULL      |
| profile_name   | TEXT    | NULL                    | Selected metadata profile name from PCD              |
| sync_status    | TEXT    | NOT NULL DEFAULT 'idle' | idle, pending, in_progress, failed                   |
| last_error     | TEXT    | NULL                    | Last sync error message                              |
| last_synced_at | TEXT    | NULL                    | Last successful sync timestamp                       |

**Design rationale**: This follows the `arr_sync_delay_profiles_config` pattern exactly (single database_id + profile_name per instance, not many-to-many like quality profiles). A Lidarr instance syncs exactly one metadata profile.

### Schema Migrations

#### Migration: `YYYYMMDD_add_lidarr_metadata_profiles.ts`

This migration serves two purposes:

1. Creates the `arr_sync_metadata_profiles_config` table in the app DB (praxrr.db).
2. Inserts a built-in base PCD op that creates the four PCD cache tables (`lidarr_metadata_profiles`, `lidarr_metadata_profile_primary_types`, `lidarr_metadata_profile_secondary_types`, `lidarr_metadata_profile_release_statuses`).

The PCD schema SQL is embedded as a constant in the migration file (same pattern as `/packages/praxrr-app/src/lib/server/db/migrations/20260215_add_lidarr_media_management_entities.ts`, lines 1-100+).

The built-in base op must also be registered in `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` (per CLAUDE.md: "When introducing built-in PCD base-op migrations, also register them in `seedBuiltInBaseOps.ts`").

### PCD Schema SQL (Embedded in Migration)

```sql
-- Lidarr Metadata Profiles
CREATE TABLE IF NOT EXISTS lidarr_metadata_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Primary Album Types (junction)
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

-- Secondary Album Types (junction)
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

-- Release Statuses (junction)
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

## Shared Type Additions

### Kysely Table Interfaces (`packages/praxrr-app/src/lib/shared/pcd/types.ts`)

```typescript
// LIDARR METADATA PROFILES

export interface LidarrMetadataProfilesTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface LidarrMetadataProfilePrimaryTypesTable {
  metadata_profile_name: string;
  type_id: number;
  name: string;
  allowed: Generated<number>;
}

export interface LidarrMetadataProfileSecondaryTypesTable {
  metadata_profile_name: string;
  type_id: number;
  name: string;
  allowed: Generated<number>;
}

export interface LidarrMetadataProfileReleaseStatusesTable {
  metadata_profile_name: string;
  status_id: number;
  name: string;
  allowed: Generated<number>;
}
```

These must also be added to the `PCDDatabase` interface:

```typescript
export interface PCDDatabase {
  // ...existing tables...
  lidarr_metadata_profiles: LidarrMetadataProfilesTable;
  lidarr_metadata_profile_primary_types: LidarrMetadataProfilePrimaryTypesTable;
  lidarr_metadata_profile_secondary_types: LidarrMetadataProfileSecondaryTypesTable;
  lidarr_metadata_profile_release_statuses: LidarrMetadataProfileReleaseStatusesTable;
}
```

### Row Types (`packages/praxrr-app/src/lib/shared/pcd/types.ts`)

```typescript
export interface LidarrMetadataProfilesRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface LidarrMetadataProfilePrimaryTypesRow {
  metadata_profile_name: string;
  type_id: number;
  name: string;
  allowed: boolean;
}

export interface LidarrMetadataProfileSecondaryTypesRow {
  metadata_profile_name: string;
  type_id: number;
  name: string;
  allowed: boolean;
}

export interface LidarrMetadataProfileReleaseStatusesRow {
  metadata_profile_name: string;
  status_id: number;
  name: string;
  allowed: boolean;
}
```

### Display Types (`packages/praxrr-app/src/lib/shared/pcd/display.ts`)

```typescript
// Re-export row types
export type {
  LidarrMetadataProfilesRow,
  LidarrMetadataProfilePrimaryTypesRow,
  LidarrMetadataProfileSecondaryTypesRow,
  LidarrMetadataProfileReleaseStatusesRow,
} from './types.ts';

// Aggregate type for table/card views
export interface LidarrMetadataProfileTableRow {
  id: number;
  name: string;
  description: string; // Parsed HTML from markdown
  primaryTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  secondaryTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  releaseStatuses: Array<{ statusId: number; name: string; allowed: boolean }>;
}
```

### Portable Type (`packages/praxrr-app/src/lib/shared/pcd/portable.ts`)

```typescript
export interface PortableLidarrMetadataProfile {
  name: string;
  description: string | null;
  primaryTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  secondaryTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  releaseStatuses: Array<{ statusId: number; name: string; allowed: boolean }>;
}
```

Also add `'lidarr_metadata_profile'` to the `ENTITY_TYPES` array.

### Arr Client Types (`packages/praxrr-app/src/lib/server/utils/arr/types.ts`)

```typescript
// Lidarr Metadata Profile Types

export interface LidarrMetadataProfileAlbumTypeItem {
  albumType: {
    id: number;
    name: string;
  };
  allowed: boolean;
}

export interface LidarrMetadataProfileReleaseStatusItem {
  releaseStatus: {
    id: number;
    name: string;
  };
  allowed: boolean;
}

export interface LidarrMetadataProfile {
  id?: number;
  name: string;
  primaryAlbumTypes: LidarrMetadataProfileAlbumTypeItem[];
  secondaryAlbumTypes: LidarrMetadataProfileAlbumTypeItem[];
  releaseStatuses: LidarrMetadataProfileReleaseStatusItem[];
}
```

## API Design

### New Endpoints

All endpoints are scoped under the existing PCD entity route pattern. The routes live at `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/`.

#### `GET /api/v1/pcd/{databaseId}/lidarr-metadata-profiles`

List all metadata profiles in the given PCD database.

**Response** (200):

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
    "secondaryTypes": [
      { "typeId": 0, "name": "Studio", "allowed": true },
      ...
    ],
    "releaseStatuses": [
      { "statusId": 0, "name": "Official", "allowed": true },
      ...
    ]
  }
]
```

#### `GET /api/v1/pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Get a single metadata profile by PCD ID.

**Response** (200): Same shape as list item.

#### `POST /api/v1/pcd/{databaseId}/lidarr-metadata-profiles`

Create a new metadata profile.

**Request body**:

```json
{
  "name": "Standard",
  "description": "Albums and EPs only",
  "primaryTypes": [
    { "typeId": 0, "name": "Album", "allowed": true },
    { "typeId": 1, "name": "EP", "allowed": true },
    { "typeId": 2, "name": "Single", "allowed": false },
    { "typeId": 3, "name": "Broadcast", "allowed": false },
    { "typeId": 4, "name": "Other", "allowed": false }
  ],
  "secondaryTypes": [
    { "typeId": 0, "name": "Studio", "allowed": true },
    ...
  ],
  "releaseStatuses": [
    { "statusId": 0, "name": "Official", "allowed": true },
    ...
  ]
}
```

**Response** (200): `{ "success": true }` or `{ "success": false, "error": "..." }`

**Error cases**:

- 400: Missing name, duplicate name (case-insensitive), empty name
- 404: Database not found, PCD cache not built

#### `PUT /api/v1/pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Update an existing metadata profile. Supports partial updates (description, primaryTypes, secondaryTypes, releaseStatuses, name/rename).

**Request body**: Same shape as POST but all fields optional except the change being made.

**Response** (200): `{ "success": true }` or error.

#### `DELETE /api/v1/pcd/{databaseId}/lidarr-metadata-profiles/{id}`

Delete a metadata profile.

**Request body**:

```json
{
  "name": "Standard"
}
```

**Response** (200): `{ "success": true }` or error.

### Error Handling

Follows existing PCD entity error patterns:

- Missing PCD cache: `{ "success": false, "error": "PCD cache not found" }` (500)
- Validation failures from `writeOperation`: returned as `{ "success": false, "error": "Validation failed: ..." }` (400)
- Name uniqueness: checked against PCD cache before write, `throw new Error(...)` pattern from `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/create.ts` line 59.

### Sync API Extensions

The following arrSync query functions must be added (following the delay-profiles pattern exactly):

```
arrSyncQueries.getMetadataProfilesSync(instanceId)
arrSyncQueries.setMetadataProfilesSync(instanceId, { databaseId, profileName, trigger, cron })
arrSyncQueries.setMetadataProfilesShouldSync(instanceId, value)
arrSyncQueries.setMetadataProfilesNextRunAt(instanceId, nextRunAt)
arrSyncQueries.setMetadataProfilesStatusPending(instanceId)
arrSyncQueries.claimMetadataProfilesSync(instanceId)
arrSyncQueries.completeMetadataProfilesSync(instanceId)
arrSyncQueries.failMetadataProfilesSync(instanceId, error)
arrSyncQueries.getPendingSyncs() // extend to include .metadataProfiles
arrSyncQueries.getScheduledConfigs() // extend to include .metadataProfiles
arrSyncQueries.getSyncConfigStatus() // extend to include .metadataProfiles
```

## System Constraints

### Lidarr-Only Scoping

- The `LidarrClient` (not `BaseArrClient`) receives the metadata profile methods. The base class has no knowledge of metadata profiles.
- The sync section handler must verify `instance.type === 'lidarr'` before processing.
- UI components and API routes must be gated to Lidarr instances only.
- The PCD cache tables are prefixed `lidarr_` to follow the convention from `lidarr_naming`, `lidarr_media_settings`.

### Performance Requirements

- Metadata profiles are small entities (one parent row + ~20 child rows total). No performance concerns for cache compilation or sync.
- The sync operation is a single PUT per Lidarr instance. No batch concerns.
- List queries can be done with simple JOINs (no pagination needed, profile count will be low).

### Compatibility with PCD Ops System

- Create operations generate INSERT statements for the parent row plus INSERT statements for all child rows (all types and statuses). This is the same multi-query pattern used by quality profile create (`packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/create.ts`).
- Update operations use value-guard UPDATE statements on child rows (UPDATE ... WHERE metadata_profile_name = ? AND type_id = ? AND allowed = {old_value}).
- Delete operations cascade via FK constraints; the parent DELETE removes all children.
- Entity metadata uses `entity: 'lidarr_metadata_profile'` and `stableKey: { key: 'metadata_profile_name', value: profileName }`.

### Sync Pipeline Integration

- New `SectionType` literal `'metadataProfiles'` added to the union in `/packages/praxrr-app/src/lib/server/sync/types.ts` line 48.
- New `metadataProfiles?: SyncResult` field added to `InstanceSyncResult` in `/packages/praxrr-app/src/lib/server/sync/types.ts` line 38.
- Handler registered at import time in `/packages/praxrr-app/src/lib/server/sync/processor.ts` (add `import './metadataProfiles/handler.ts'` after line 30).
- The processor total-synced calculation at line 249 must include `metadataProfiles.itemsSynced`.
- `triggerSyncs()` at line 301 must check and trigger `metadataProfiles` status pending.
- The sync section order in `/packages/praxrr-app/src/lib/server/sync/mappings.ts` line 13 must include `'metadataProfiles'`.
- `SUPPORTED_SYNC_SECTIONS` at line 15 must include `'metadataProfiles'` for `lidarr` only (NOT for `radarr` or `sonarr`).

### Capabilities Registration

- Add `'metadata_profiles'` to the `ArrSyncSurface` type union in `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts` line 31.
- Add `metadata_profiles: boolean` to the capabilities records.
- Set `metadata_profiles: true` in `LIDARR_CAPABILITIES` only; set to `false` for `RADARR_CAPABILITIES` and `SONARR_CAPABILITIES`.
- Update the non-regression acceptance checks accordingly.

## Codebase Changes

### Files to Create

| Path                                                                                              | Purpose                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/create.ts`                      | Create metadata profile PCD operation            |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/read.ts`                        | Read/list metadata profiles from PCD cache       |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/update.ts`                      | Update metadata profile PCD operation            |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/delete.ts`                      | Delete metadata profile PCD operation            |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/index.ts`                       | Re-exports for entity module                     |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/handler.ts`                             | Sync section handler (registers with registry)   |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`                              | Sync logic: PCD read -> transform -> Lidarr push |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/index.ts`                               | Re-exports                                       |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_add_lidarr_metadata_profiles.ts`       | App DB migration + PCD built-in base op          |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts`      | GET (list), POST (create)                        |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts` | GET (single), PUT (update), DELETE               |

### Files to Modify

| Path                                                               | Changes                                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/pcd/types.ts`                  | Add 4 Kysely table interfaces, 4 Row types, add tables to `PCDDatabase` interface                                                              |
| `packages/praxrr-app/src/lib/shared/pcd/display.ts`                | Add display types for metadata profile list/detail views                                                                                       |
| `packages/praxrr-app/src/lib/shared/pcd/portable.ts`               | Add `PortableLidarrMetadataProfile`, add to `ENTITY_TYPES`                                                                                     |
| `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`           | Add `metadata_profiles` to `ArrSyncSurface`, update capabilities records and non-regression checks                                             |
| `packages/praxrr-app/src/lib/server/utils/arr/types.ts`            | Add `LidarrMetadataProfile`, `LidarrMetadataProfileAlbumTypeItem`, `LidarrMetadataProfileReleaseStatusItem`                                    |
| `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`   | Add `getMetadataProfiles()`, `getMetadataProfile(id)`, `createMetadataProfile()`, `updateMetadataProfile()`, `deleteMetadataProfile()` methods |
| `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`      | Add `lidarr_metadata_profile` entry to `AUTO_ALIGN_ENTITIES` map                                                                               |
| `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`     | Add `serializeLidarrMetadataProfile()` function                                                                                                |
| `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`   | Add `deserializeLidarrMetadataProfile()` function                                                                                              |
| `packages/praxrr-app/src/lib/server/pcd/entities/clone.ts`         | Add metadata profile clone support                                                                                                             |
| `packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`      | Add metadata profile validation                                                                                                                |
| `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`         | Add `mp(name)` helper function for metadata profile lookup (line ~336, follows `qp`, `cf`, `dp` pattern)                                       |
| `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` | Register the new built-in base op for metadata profile tables                                                                                  |
| `packages/praxrr-app/src/lib/server/sync/types.ts`                 | Add `'metadataProfiles'` to `SectionType`, add `metadataProfiles?: SyncResult` to `InstanceSyncResult`                                         |
| `packages/praxrr-app/src/lib/server/sync/processor.ts`             | Import handler, add to `totalSynced` calc, add to `triggerSyncs()`                                                                             |
| `packages/praxrr-app/src/lib/server/sync/mappings.ts`              | Add `'metadataProfiles'` to `SYNC_SECTION_ORDER`, update `SUPPORTED_SYNC_SECTIONS` (lidarr only)                                               |
| `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`         | Add all metadata profile sync query functions                                                                                                  |
| `packages/praxrr-app/src/lib/server/db/schema.sql`                 | Document the new `arr_sync_metadata_profiles_config` table                                                                                     |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`              | Register the new migration                                                                                                                     |

## Technical Decisions

### Decision 1: LidarrClient vs BaseArrClient for metadata profile methods

- **Options**: (A) Add methods to `BaseArrClient`, (B) Add methods to `LidarrClient` only
- **Recommendation**: B - `LidarrClient` only
- **Rationale**: Metadata profiles are a Lidarr-exclusive concept. Adding them to `BaseArrClient` would violate the Cross-Arr Semantic Validation Policy (CLAUDE.md). The existing `LidarrClient` already has Lidarr-specific methods (`getArtists()`, `getAlbums()`, `getReleases()`). Pattern is consistent.

### Decision 2: Sync config table pattern (single vs many-to-many)

- **Options**: (A) Many-to-many like `arr_sync_quality_profiles` (multiple profiles per instance), (B) Single profile like `arr_sync_delay_profiles_config`
- **Recommendation**: B - Single profile per instance
- **Rationale**: In Lidarr, there is exactly one "default" metadata profile that new artists receive. An instance typically has 1-3 metadata profiles. Unlike quality profiles where multiple profiles can be synced simultaneously, a Lidarr sync operation should push one managed profile. If multiple profiles are needed, the user can assign them manually in Lidarr after sync. This matches the delay profile sync semantics exactly.

### Decision 3: PCD schema table naming convention

- **Options**: (A) `metadata_profiles` (generic), (B) `lidarr_metadata_profiles` (Lidarr-prefixed)
- **Recommendation**: B - `lidarr_metadata_profiles`
- **Rationale**: Follows the established pattern from `lidarr_naming`, `lidarr_media_settings`. Since this entity has no cross-Arr equivalent, the `lidarr_` prefix makes the Arr-specific scoping explicit in the schema.

### Decision 4: Child table storage (only allowed types vs all types)

- **Options**: (A) Store only rows where `allowed = true`, (B) Store all known types with `allowed` boolean
- **Recommendation**: B - Store all types
- **Rationale**: The Lidarr API requires the full list in PUT/POST payloads. Storing all types in the PCD cache means the sync transformer can directly read the cache without needing to fill in missing types. This also makes user ops cleaner -- toggling a type is an UPDATE, not an INSERT/DELETE. The `create` operation populates all types with sensible defaults (Album + EP + Studio + Official = allowed, rest = not allowed).

### Decision 5: Entity type naming in PCD ops metadata

- **Options**: (A) `metadata_profile`, (B) `lidarr_metadata_profile`
- **Recommendation**: B - `lidarr_metadata_profile`
- **Rationale**: Consistent with `lidarr_naming`, `lidarr_media_settings` naming in PCD ops metadata. The `entity` field in `OperationMetadata` uses the Arr-prefixed name for Arr-specific entities.

## Open Questions

1. **Default profile sync behavior**: When syncing a metadata profile to Lidarr, should it create a new profile or update a specific existing one? Delay profiles update `id=1` (the default). Metadata profiles do not have a guaranteed default ID. The syncer may need to match by name (like quality profiles) or target a configurable profile ID. **Recommendation**: Match by name, create if not found, update if found -- same as quality profile sync semantics.

2. **Metadata profile assignment to artists**: Lidarr artists carry a `metadataProfileId`. Should Praxrr support bulk-assigning a synced metadata profile to all artists? This is a follow-up feature beyond the initial sync, but worth noting as a future enhancement.

3. **Schema endpoint usage**: Lidarr provides `GET /api/v1/metadataprofile/schema` which returns all types with `allowed: false`. Should the syncer call this to discover types dynamically, or hardcode the known types? **Recommendation**: Hardcode for the initial implementation (the types come from MusicBrainz and change extremely rarely -- last addition was years ago). Add a TODO to validate against the schema endpoint as a future enhancement.

4. **Field Recording vs Audio drama**: The Lidarr source code at `SecondaryAlbumType.cs` shows 12 entries (IDs 0-11 ending with `Audiodrama`). The existing research docs list 13 entries (IDs 0-12) with both "Audio Drama" (ID 11) and "Field Recording" (ID 12). Need to verify against a running Lidarr instance which set is correct. The implementation should support all values from the research docs and gracefully handle unknown types from the Lidarr API.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/` - Closest analog for a simple PCD entity (create, read, update, delete, index)
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/create.ts` - Multi-query create pattern with child table inserts
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts` - Complex list with JOINed child data
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/delete.ts` - Cascading delete with metadata snapshots
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts` - PCD cache with helper functions (line 332-376)
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` - PCD operation writer (validates, compiles, stores)
- `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` - Built-in base op registration
- `/packages/praxrr-app/src/lib/server/pcd/entities/registry.ts` - AUTO_ALIGN_ENTITIES map
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` - Entity serialization for clone/export
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts` - Sync handler pattern (simplest example)
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts` - Sync logic pattern (single profile sync)
- `/packages/praxrr-app/src/lib/server/sync/types.ts` - SectionType, SectionHandler, InstanceSyncResult
- `/packages/praxrr-app/src/lib/server/sync/registry.ts` - Section registry
- `/packages/praxrr-app/src/lib/server/sync/processor.ts` - Sync processor (imports handlers, processes pending)
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts` - SUPPORTED_SYNC_SECTIONS, SYNC_SECTION_ORDER
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts` - LidarrClient (API v1, line 18)
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts` - BaseArrClient (shared methods)
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts` - Arr API type definitions
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` - Arr sync queries (delay profile pattern at line 23-28)
- `/packages/praxrr-app/src/lib/server/db/schema.sql` - App DB schema reference
- `/packages/praxrr-app/src/lib/server/db/migrations/20260215_add_lidarr_media_management_entities.ts` - Migration pattern with embedded PCD ops
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts` - PCD Kysely types (Generated<T> interfaces + Row types)
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts` - Display types for UI
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts` - Portable types for clone/export, ENTITY_TYPES
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts` - ArrSyncSurface, capabilities matrix

## External References

- [Lidarr API Docs (Swagger UI)](https://lidarr.audio/docs/api/)
- [MetadataProfileResource.cs (Lidarr source)](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileResource.cs)
- [PrimaryAlbumType.cs (Lidarr source)](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Music/Model/PrimaryAlbumType.cs)
- [SecondaryAlbumType.cs (Lidarr source)](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Music/Model/SecondaryAlbumType.cs)
- [ReleaseStatus.cs (Lidarr source)](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Music/Model/ReleaseStatus.cs)
- [MetadataProfileController.cs (Lidarr source)](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileController.cs)
- [Lidarr Settings Wiki (Servarr)](https://wiki.servarr.com/lidarr/settings)
- [devopsarr/lidarr Terraform Provider - metadata_profile](https://registry.terraform.io/providers/devopsarr/lidarr/latest/docs/resources/metadata_profile)
- [starr Go package - Lidarr MetadataProfile type](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr)
