# External API Research: Lidarr Metadata Profiles

## Executive Summary

Lidarr exposes a full CRUD REST API at `/api/v1/metadataprofile` for managing metadata profiles -- a Lidarr-exclusive concept that controls which album types (primary and secondary) and release statuses an artist will track. Each artist in Lidarr carries a `metadataProfileId` foreign key, so metadata profiles govern what albums appear in an artist's library. This feature has no equivalent in Sonarr or Radarr. Integration requires adding metadata profile CRUD methods to the existing `LidarrClient`, defining TypeScript types for the three nested sub-object arrays (primary types, secondary types, release statuses), and wiring a new `metadataProfiles` sync section gated exclusively to the `lidarr` arr type.

## Primary APIs

### Lidarr Metadata Profile API

- **Documentation**: [Lidarr API Docs (Swagger UI)](https://lidarr.audio/docs/api/) backed by [openapi.json on GitHub](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/openapi.json)
- **Source Code**: [MetadataProfileController.cs](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileController.cs), [MetadataProfileResource.cs](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileResource.cs)
- **Base URL**: `http://<lidarr-host>:<port>` (default port 8686)
- **API Version**: `v1` (Lidarr uses `/api/v1/`, unlike Sonarr/Radarr which use `/api/v3/`)
- **Authentication**: `X-Api-Key` HTTP header or `?apikey=` query parameter. The API key is found in Lidarr under Settings > General.
- **Rate Limits**: None documented. Lidarr is a self-hosted application; no external rate limiting applies. However, metadata profiles trigger artist refresh operations that can be slow for artists with many album types enabled.

**Confidence**: High -- verified from Lidarr source code on GitHub (controller, resource, model files) and corroborated by the devopsarr SDK documentation and Terraform provider.

### Key Endpoints

| Method   | Endpoint                         | Description                                               | Request Body              | Response                                 |
| -------- | -------------------------------- | --------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `GET`    | `/api/v1/metadataprofile`        | List all metadata profiles                                | None                      | `MetadataProfileResource[]`              |
| `GET`    | `/api/v1/metadataprofile/{id}`   | Get a single metadata profile by ID                       | None                      | `MetadataProfileResource`                |
| `POST`   | `/api/v1/metadataprofile`        | Create a new metadata profile                             | `MetadataProfileResource` | `MetadataProfileResource` (201 Created)  |
| `PUT`    | `/api/v1/metadataprofile/{id}`   | Update an existing metadata profile                       | `MetadataProfileResource` | `MetadataProfileResource` (202 Accepted) |
| `DELETE` | `/api/v1/metadataprofile/{id}`   | Delete a metadata profile                                 | None                      | void (200 OK)                            |
| `GET`    | `/api/v1/metadataprofile/schema` | Get schema with all possible types (all `allowed: false`) | None                      | `MetadataProfileResource`                |

**Confidence**: High -- endpoints confirmed from [MetadataProfileController.cs source code](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileController.cs) and [devopsarr/lidarr-py MetadataProfileApi docs](https://github.com/devopsarr/lidarr-py/blob/main/docs/MetadataProfileApi.md).

### Schema Endpoint

The `GET /api/v1/metadataprofile/schema` endpoint returns a template `MetadataProfileResource` with **all** known primary types, secondary types, and release statuses populated, each with `allowed: false`. This is served by [`MetadataProfileSchemaController.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileSchemaController.cs). It constructs the lists from `PrimaryAlbumType.All`, `SecondaryAlbumType.All`, and `ReleaseStatus.All` (ordered by ID descending). This endpoint is useful for discovering all available types without hardcoding them.

**Confidence**: High -- confirmed from source code.

---

## Metadata Profile Object Structure

### MetadataProfileResource

```typescript
interface LidarrMetadataProfile {
  id: number; // Lidarr-assigned profile ID
  name: string; // Profile name (must not be "None")
  primaryAlbumTypes: LidarrProfilePrimaryAlbumTypeItem[]; // Which primary types are allowed
  secondaryAlbumTypes: LidarrProfileSecondaryAlbumTypeItem[]; // Which secondary types are allowed
  releaseStatuses: LidarrProfileReleaseStatusItem[]; // Which release statuses are allowed
}
```

**Confidence**: High -- confirmed from [MetadataProfileResource.cs](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileResource.cs) and [Go starr library MetadataProfile struct](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr).

### ProfilePrimaryAlbumTypeItemResource

```typescript
interface LidarrProfilePrimaryAlbumTypeItem {
  albumType: {
    id: number; // PrimaryAlbumType ID
    name: string; // PrimaryAlbumType name
  };
  allowed: boolean; // Whether this type is enabled in the profile
}
```

### ProfileSecondaryAlbumTypeItemResource

```typescript
interface LidarrProfileSecondaryAlbumTypeItem {
  albumType: {
    id: number; // SecondaryAlbumType ID
    name: string; // SecondaryAlbumType name
  };
  allowed: boolean; // Whether this type is enabled in the profile
}
```

### ProfileReleaseStatusItemResource

```typescript
interface LidarrProfileReleaseStatusItem {
  releaseStatus: {
    id: number; // ReleaseStatus ID
    name: string; // ReleaseStatus name
  };
  allowed: boolean; // Whether this status is enabled in the profile
}
```

**Confidence**: High -- confirmed from source code and Go starr library.

---

## Enum Definitions (from Lidarr Source Code)

### PrimaryAlbumType

Source: [`src/NzbDrone.Core/Music/Model/PrimaryAlbumType.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/PrimaryAlbumType.cs)

| ID  | Name      | MusicBrainz Equivalent | Description                                                 |
| --- | --------- | ---------------------- | ----------------------------------------------------------- |
| 0   | Album     | Album                  | Full-length LP release with previously unreleased material  |
| 1   | EP        | EP                     | Extended play, shorter than full album                      |
| 2   | Single    | Single                 | One main song, potentially with additional tracks           |
| 3   | Broadcast | Broadcast              | Episodic release originally broadcast via radio/TV/internet |
| 4   | Other     | Other                  | Releases that do not fit other categories                   |

**Confidence**: High -- extracted directly from Lidarr source code. Corroborated by [MusicBrainz Release Group/Type documentation](https://musicbrainz.org/doc/Release_Group/Type).

### SecondaryAlbumType

Source: [`src/NzbDrone.Core/Music/Model/SecondaryAlbumType.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/SecondaryAlbumType.cs)

| ID  | Name           | MusicBrainz Equivalent    | Description                                             |
| --- | -------------- | ------------------------- | ------------------------------------------------------- |
| 0   | Studio         | (none -- Lidarr-specific) | Standard studio album (default for null/unknown)        |
| 1   | Compilation    | Compilation               | Collections from various sources grouped by theme/era   |
| 2   | Soundtrack     | Soundtrack                | Musical score for movies, TV, games, etc.               |
| 3   | Spokenword     | Spokenword                | Non-music spoken word content                           |
| 4   | Interview      | Interview                 | Interview release, generally with an artist             |
| 5   | Audiobook      | Audiobook                 | A book read by a narrator without music                 |
| 6   | Live           | Live                      | Material recorded live                                  |
| 7   | Remix          | Remix                     | Primarily remixed material                              |
| 8   | DJ-mix         | DJ-mix                    | Continuous flow created by blending multiple recordings |
| 9   | Mixtape/Street | Mixtape/Street            | Promotional releases with new material                  |
| 10  | Demo           | Demo                      | Distributed for limited circulation or reference use    |
| 11  | Audio drama    | Audio drama               | Audio-only theatrical performance                       |

**Important note**: The source code defines `Audiobook` (ID 5) as a static property but **excludes it from the `All` collection**. This means `Audiobook` is defined in the codebase but not exposed via the schema endpoint or standard profile operations. The `Studio` type (ID 0) is a Lidarr-specific addition not present in MusicBrainz.

**Confidence**: High -- extracted directly from Lidarr source code. The Audiobook exclusion was explicitly noted in the code analysis.

### ReleaseStatus

Source: [`src/NzbDrone.Core/Music/Model/ReleaseStatus.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/ReleaseStatus.cs)

| ID  | Name           | MusicBrainz Equivalent | Description                                              |
| --- | -------------- | ---------------------- | -------------------------------------------------------- |
| 0   | Official       | Official               | Officially sanctioned by artist/label                    |
| 1   | Promotion      | Promotion              | Give-away or pre-release promotional material            |
| 2   | Bootleg        | Bootleg                | Unofficial/underground release not sanctioned by artist  |
| 3   | Pseudo-Release | Pseudo-Release         | Alternate version with changed titles (transliterations) |

**Note**: MusicBrainz also defines Withdrawn, Expunged, and Cancelled statuses, but Lidarr only supports these four.

**Confidence**: High -- extracted directly from Lidarr source code.

---

## Validation Rules

From [`MetadataValidator.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataValidator.cs) and the controller constructor:

1. **Name must not be empty** -- enforced by FluentValidation `NotEmpty()`
2. **Name must not be "None"** -- "None" is a reserved profile name (error message: `'None' is a reserved profile name`)
3. **At least one primary type must have `allowed: true`** -- validated by `PrimaryTypeValidator`
4. **At least one secondary type must have `allowed: true`** -- validated by `SecondaryTypeValidator`
5. **At least one release status must have `allowed: true`** -- validated by `ReleaseStatusValidator`

The validators check that the arrays are non-empty AND that at least one element in each array has `allowed == true`.

**Confidence**: High -- verified from source code.

---

## Artist-Profile Relationship

Each Lidarr artist carries a `metadataProfileId` integer field (from [`ArtistResource.cs`](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Artist/ArtistResource.cs)). When Lidarr refreshes an artist, it uses the linked metadata profile to determine which album types and release statuses to fetch from MusicBrainz. Albums that do not match the allowed types/statuses are **not created** in the database.

Key behaviors:

- **Profile assignment is at the artist level** -- all albums for an artist share the same metadata profile
- **Changing a metadata profile triggers re-evaluation** -- Lidarr will add/remove albums from an artist's library based on the new profile settings
- **Mass editor support** -- Lidarr supports changing metadata profiles in bulk via the mass editor (per [Issue #2302](https://github.com/Lidarr/Lidarr/issues/2302))
- **Default profile** -- Lidarr ships with a default metadata profile (typically ID 1) that includes only "Album" primary type, "Studio" secondary type, and "Official" release status
- **Warning**: Enabling many types for prolific artists can significantly slow down artist refresh operations

**Confidence**: High -- confirmed from source code and [Servarr Wiki](https://wikiold.servarr.com/Lidarr_Settings).

---

## Libraries and SDKs

### No TypeScript/JavaScript Library Available

There is no published TypeScript or JavaScript client library for the Lidarr API on npm. The Praxrr project already has its own `LidarrClient` class extending `BaseArrClient`, so adding metadata profile methods directly to this existing client is the recommended approach.

**Confidence**: High -- searched npm and major package registries; no TS/JS Lidarr client package exists.

### Available SDKs in Other Languages

| Language  | Library                     | Repository                                                                                                                             | Notes                                                                       |
| --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Python    | `lidarr-py`                 | [devopsarr/lidarr-py](https://github.com/devopsarr/lidarr-py)                                                                          | Auto-generated from OpenAPI spec. Has `MetadataProfileApi` class.           |
| Go        | `starr`                     | [golift/starr](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr)                                                             | Manually maintained. `MetadataProfile` struct with `GetMetadataProfiles()`. |
| Go        | `lidarr-go`                 | [devopsarr/lidarr-go](https://github.com/devopsarr/lidarr-go)                                                                          | Auto-generated from OpenAPI spec.                                           |
| Rust      | `lidarr`                    | [crates.io/crates/lidarr](https://crates.io/crates/lidarr)                                                                             | Auto-generated from OpenAPI spec.                                           |
| Terraform | `terraform-provider-lidarr` | [devopsarr/terraform-provider-lidarr](https://registry.terraform.io/providers/devopsarr/lidarr/latest/docs/resources/metadata_profile) | Full CRUD for metadata profiles.                                            |

**Confidence**: High -- verified from package registries and GitHub.

### Configarr (Related Tool)

[Configarr](https://configarr.de/docs/configuration/experimental-support/) added experimental Lidarr v2 support in v1.8.0, and metadata profile management in v1.19.0. Their approach:

- Metadata profiles defined in YAML configuration
- Only listed types/statuses are enabled; all others disabled
- `delete_unmanaged_metadata_profiles` setting to clean up unmanaged profiles
- The "None" profile is protected from deletion
- No TRaSH-Guides presets available for Lidarr metadata profiles

**Confidence**: High -- confirmed from Configarr documentation.

---

## Integration Patterns

### Recommended Approach for Praxrr

#### 1. Extend LidarrClient with Metadata Profile Methods

Add CRUD methods to the existing `LidarrClient` class at `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`:

```typescript
// In LidarrClient class

getMetadataProfiles(): Promise<LidarrMetadataProfile[]> {
  return this.get<LidarrMetadataProfile[]>(`/api/${this.apiVersion}/metadataprofile`);
}

getMetadataProfile(id: number): Promise<LidarrMetadataProfile> {
  return this.get<LidarrMetadataProfile>(`/api/${this.apiVersion}/metadataprofile/${id}`);
}

getMetadataProfileSchema(): Promise<LidarrMetadataProfile> {
  return this.get<LidarrMetadataProfile>(`/api/${this.apiVersion}/metadataprofile/schema`);
}

createMetadataProfile(profile: Omit<LidarrMetadataProfile, 'id'>): Promise<LidarrMetadataProfile> {
  return this.post<LidarrMetadataProfile>(`/api/${this.apiVersion}/metadataprofile`, profile);
}

updateMetadataProfile(id: number, profile: LidarrMetadataProfile): Promise<LidarrMetadataProfile> {
  return this.put<LidarrMetadataProfile>(`/api/${this.apiVersion}/metadataprofile/${id}`, profile);
}

deleteMetadataProfile(id: number): Promise<void> {
  return this.delete(`/api/${this.apiVersion}/metadataprofile/${id}`);
}
```

#### 2. Add TypeScript Types to `packages/praxrr-app/src/lib/server/utils/arr/types.ts`

```typescript
// =============================================================================
// Lidarr Metadata Profile Types
// =============================================================================

/**
 * Primary album type value object from /api/v1/metadataprofile
 */
export interface LidarrPrimaryAlbumTypeValue {
  id: number;
  name: string;
}

/**
 * Secondary album type value object from /api/v1/metadataprofile
 */
export interface LidarrSecondaryAlbumTypeValue {
  id: number;
  name: string;
}

/**
 * Release status value object from /api/v1/metadataprofile
 */
export interface LidarrReleaseStatusValue {
  id: number;
  name: string;
}

/**
 * Primary album type item within a metadata profile
 */
export interface LidarrProfilePrimaryAlbumTypeItem {
  albumType: LidarrPrimaryAlbumTypeValue;
  allowed: boolean;
}

/**
 * Secondary album type item within a metadata profile
 */
export interface LidarrProfileSecondaryAlbumTypeItem {
  albumType: LidarrSecondaryAlbumTypeValue;
  allowed: boolean;
}

/**
 * Release status item within a metadata profile
 */
export interface LidarrProfileReleaseStatusItem {
  releaseStatus: LidarrReleaseStatusValue;
  allowed: boolean;
}

/**
 * Metadata profile from /api/v1/metadataprofile
 * Lidarr-specific: controls which album types and release statuses
 * are tracked for artists assigned to this profile.
 */
export interface LidarrMetadataProfile {
  id: number;
  name: string;
  primaryAlbumTypes: LidarrProfilePrimaryAlbumTypeItem[];
  secondaryAlbumTypes: LidarrProfileSecondaryAlbumTypeItem[];
  releaseStatuses: LidarrProfileReleaseStatusItem[];
}
```

#### 3. Add Static Mappings to `packages/praxrr-app/src/lib/server/sync/mappings.ts`

```typescript
// =============================================================================
// Lidarr Metadata Profile Enums
// =============================================================================

export const LIDARR_PRIMARY_ALBUM_TYPES = {
  Album: { id: 0, name: 'Album' },
  EP: { id: 1, name: 'EP' },
  Single: { id: 2, name: 'Single' },
  Broadcast: { id: 3, name: 'Broadcast' },
  Other: { id: 4, name: 'Other' },
} as const;

export const LIDARR_SECONDARY_ALBUM_TYPES = {
  Studio: { id: 0, name: 'Studio' },
  Compilation: { id: 1, name: 'Compilation' },
  Soundtrack: { id: 2, name: 'Soundtrack' },
  Spokenword: { id: 3, name: 'Spokenword' },
  Interview: { id: 4, name: 'Interview' },
  // Note: Audiobook (id: 5) exists in code but is excluded from All collection
  Live: { id: 6, name: 'Live' },
  Remix: { id: 7, name: 'Remix' },
  'DJ-mix': { id: 8, name: 'DJ-mix' },
  'Mixtape/Street': { id: 9, name: 'Mixtape/Street' },
  Demo: { id: 10, name: 'Demo' },
  'Audio drama': { id: 11, name: 'Audio drama' },
} as const;

export const LIDARR_RELEASE_STATUSES = {
  Official: { id: 0, name: 'Official' },
  Promotion: { id: 1, name: 'Promotion' },
  Bootleg: { id: 2, name: 'Bootleg' },
  'Pseudo-Release': { id: 3, name: 'Pseudo-Release' },
} as const;
```

#### 4. Sync Section Architecture

Metadata profiles should be added as a new `SectionType` gated exclusively to `lidarr`:

```typescript
// Updated SectionType union
export type SectionType = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

// Updated SUPPORTED_SYNC_SECTIONS
const SUPPORTED_SYNC_SECTIONS: Record<SyncArrType, readonly SectionType[]> = {
  radarr: ['qualityProfiles', 'delayProfiles', 'mediaManagement'],
  sonarr: ['qualityProfiles', 'delayProfiles', 'mediaManagement'],
  lidarr: ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'],
};
```

### Authentication Flow

1. User configures Lidarr instance in Praxrr with URL + API key
2. Praxrr stores API key in the `arr_instances` database table
3. `LidarrClient` is instantiated via `createArrClient('lidarr', url, apiKey)`
4. All requests include `X-Api-Key` header (handled by `BaseArrClient` constructor)
5. No OAuth, no token refresh, no session management needed

### Data Synchronization Pattern

The sync flow for metadata profiles should follow the existing pattern used for quality profiles:

1. **Read local PCD state** -- Get the desired metadata profile configuration from PCD
2. **Read remote state** -- Call `GET /api/v1/metadataprofile` on the target Lidarr instance
3. **Diff** -- Compare local desired state against remote current state by profile name
4. **Create/Update/Delete** -- Apply changes:
   - New profiles: `POST /api/v1/metadataprofile`
   - Modified profiles: `PUT /api/v1/metadataprofile/{id}`
   - Orphaned profiles: optionally `DELETE /api/v1/metadataprofile/{id}`
5. **Full type arrays required** -- When creating/updating, all primary types, secondary types, and release statuses must be included in the payload with their `allowed` flags set appropriately

---

## Constraints and Gotchas

### 1. "None" is a Reserved Profile Name

**Impact**: Creating or updating a profile with the name "None" will fail with a validation error.
**Workaround**: Validate profile names client-side before sending to the API. This is already consistent with Praxrr's case-insensitive uniqueness enforcement.

**Confidence**: High -- confirmed from controller source code.

### 2. Must Include All Types in Payload

**Impact**: When creating or updating a profile, the payload must include entries for **all** primary types, **all** secondary types, and **all** release statuses. Types not in the profile should have `allowed: false`. Sending a partial list may cause undefined behavior.
**Workaround**: Use the `/api/v1/metadataprofile/schema` endpoint to get the full template, then set `allowed: true` only for desired types.

**Confidence**: Medium -- inferred from the schema endpoint design pattern and Terraform provider behavior. The API may accept partial lists, but all reference implementations send full lists.

### 3. Audiobook (ID 5) Is Excluded from Standard Operations

**Impact**: Although `Audiobook` (ID 5) exists as a static field in `SecondaryAlbumType.cs`, it is deliberately excluded from the `All` collection. The schema endpoint will not return it, and it should not be included in profile payloads.
**Workaround**: Exclude ID 5 from any hardcoded secondary type lists. If using the schema endpoint dynamically, this is handled automatically.

**Confidence**: High -- confirmed from source code analysis showing explicit exclusion from `All` list.

### 4. Profile Deletion Fails if Artists Are Assigned

**Impact**: Attempting to delete a metadata profile that is currently assigned to one or more artists will likely fail (similar to quality profile deletion behavior).
**Workaround**: Check for artist assignments before deletion, or reassign artists to a different profile first.

**Confidence**: Medium -- inferred from analogous quality profile behavior; not explicitly tested.

### 5. No Rate Limiting but Performance Concerns

**Impact**: Enabling many album types (especially secondary types like Live, Compilation, Remix) for artists with large discographies can make artist refresh operations very slow, as Lidarr pulls all matching data from MusicBrainz.
**Workaround**: Document this in the UI with appropriate warnings. Consider defaulting to conservative profiles (Album + Studio + Official).

**Confidence**: High -- confirmed from [Servarr Wiki documentation](https://wikiold.servarr.com/Lidarr_Settings).

### 6. ID Gap in SecondaryAlbumType (ID 5 Skipped)

**Impact**: The secondary album type IDs are not contiguous: 0, 1, 2, 3, 4, **skip 5**, 6, 7, 8, 9, 10, 11. This is because Audiobook (ID 5) is excluded from the active set.
**Workaround**: Do not assume contiguous IDs when iterating over secondary types.

**Confidence**: High -- confirmed from source code.

### 7. Lidarr API v1 (Not v3)

**Impact**: Lidarr uses `/api/v1/` while Sonarr and Radarr use `/api/v3/`. The existing `LidarrClient` already handles this with `apiVersion = 'v1'`.
**Workaround**: None needed -- already handled in the codebase.

**Confidence**: High -- confirmed from existing codebase.

### 8. Metadata Profiles Are Lidarr-Exclusive

**Impact**: This feature must be strictly gated to `arr_type = 'lidarr'`. Sonarr and Radarr have no concept of metadata profiles. Any UI, sync, or PCD entity code must enforce this boundary.
**Workaround**: Use the existing `SUPPORTED_SYNC_SECTIONS` pattern to gate the feature, and filter UI components by `arr_type`.

**Confidence**: High -- fundamental architectural fact.

---

## Code Examples

### Basic Metadata Profile API Call

```typescript
import { LidarrClient } from '$arr/clients/lidarr.ts';

const client = new LidarrClient('http://localhost:8686', 'your-api-key-here');

// List all metadata profiles
const profiles = await client.getMetadataProfiles();
console.log(profiles);

// Get schema (all types with allowed: false)
const schema = await client.getMetadataProfileSchema();

// Create a profile: Albums + EPs, Studio + Live, Official only
const newProfile = await client.createMetadataProfile({
  name: 'Albums and EPs',
  primaryAlbumTypes: schema.primaryAlbumTypes.map((item) => ({
    ...item,
    allowed: ['Album', 'EP'].includes(item.albumType.name),
  })),
  secondaryAlbumTypes: schema.secondaryAlbumTypes.map((item) => ({
    ...item,
    allowed: ['Studio', 'Live'].includes(item.albumType.name),
  })),
  releaseStatuses: schema.releaseStatuses.map((item) => ({
    ...item,
    allowed: item.releaseStatus.name === 'Official',
  })),
});
```

### Metadata Profile Object Example (Full API Response)

```json
{
  "id": 1,
  "name": "Standard",
  "primaryAlbumTypes": [
    {
      "albumType": { "id": 0, "name": "Album" },
      "allowed": true
    },
    {
      "albumType": { "id": 1, "name": "EP" },
      "allowed": false
    },
    {
      "albumType": { "id": 2, "name": "Single" },
      "allowed": false
    },
    {
      "albumType": { "id": 3, "name": "Broadcast" },
      "allowed": false
    },
    {
      "albumType": { "id": 4, "name": "Other" },
      "allowed": false
    }
  ],
  "secondaryAlbumTypes": [
    {
      "albumType": { "id": 0, "name": "Studio" },
      "allowed": true
    },
    {
      "albumType": { "id": 1, "name": "Compilation" },
      "allowed": false
    },
    {
      "albumType": { "id": 2, "name": "Soundtrack" },
      "allowed": false
    },
    {
      "albumType": { "id": 3, "name": "Spokenword" },
      "allowed": false
    },
    {
      "albumType": { "id": 4, "name": "Interview" },
      "allowed": false
    },
    {
      "albumType": { "id": 6, "name": "Live" },
      "allowed": false
    },
    {
      "albumType": { "id": 7, "name": "Remix" },
      "allowed": false
    },
    {
      "albumType": { "id": 8, "name": "DJ-mix" },
      "allowed": false
    },
    {
      "albumType": { "id": 9, "name": "Mixtape/Street" },
      "allowed": false
    },
    {
      "albumType": { "id": 10, "name": "Demo" },
      "allowed": false
    },
    {
      "albumType": { "id": 11, "name": "Audio drama" },
      "allowed": false
    }
  ],
  "releaseStatuses": [
    {
      "releaseStatus": { "id": 0, "name": "Official" },
      "allowed": true
    },
    {
      "releaseStatus": { "id": 1, "name": "Promotion" },
      "allowed": false
    },
    {
      "releaseStatus": { "id": 2, "name": "Bootleg" },
      "allowed": false
    },
    {
      "releaseStatus": { "id": 3, "name": "Pseudo-Release" },
      "allowed": false
    }
  ]
}
```

### Schema Endpoint Response (All Types, All Disallowed)

The response from `GET /api/v1/metadataprofile/schema` has the same structure as above but:

- No `id` field (or `id: 0`)
- No `name` field (or empty string)
- All `allowed` values are `false`
- Types are ordered by ID **descending** (e.g., Other first, Album last for primary types)

---

## MusicBrainz Type Correspondence

Lidarr's type system is derived from MusicBrainz but is not identical:

| Category  | MusicBrainz Types                                                                                                                  | Lidarr Types                                                                                                   | Differences                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Primary   | Album, Single, EP, Broadcast, Other                                                                                                | Album, EP, Single, Broadcast, Other                                                                            | Order differs (MB: Album first; Lidarr IDs: Album=0, EP=1, Single=2)                                   |
| Secondary | Compilation, Soundtrack, Spokenword, Interview, Audiobook, Audio drama, Live, Remix, DJ-mix, Mixtape/Street, Demo, Field recording | Studio, Compilation, Soundtrack, Spokenword, Interview, Live, Remix, DJ-mix, Mixtape/Street, Demo, Audio drama | Lidarr adds "Studio" (ID 0); excludes "Audiobook" from active set; excludes "Field recording" entirely |
| Status    | Official, Promotion, Bootleg, Pseudo-Release, Withdrawn, Expunged, Cancelled                                                       | Official, Promotion, Bootleg, Pseudo-Release                                                                   | Lidarr excludes Withdrawn, Expunged, Cancelled                                                         |

**Confidence**: High -- cross-referenced Lidarr source code with [MusicBrainz Release Group/Type](https://musicbrainz.org/doc/Release_Group/Type) and [MusicBrainz Release](https://musicbrainz.org/doc/Release) documentation.

---

## Existing Praxrr Architecture Context

### Current LidarrClient Location

- **File**: `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`
- **Base class**: `BaseArrClient` (at `packages/praxrr-app/src/lib/server/utils/arr/base.ts`)
- **Types**: `packages/praxrr-app/src/lib/server/utils/arr/types.ts`
- **Factory**: `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`

### Current Sync Architecture

- **Section types**: `qualityProfiles | delayProfiles | mediaManagement`
- **Mappings**: `packages/praxrr-app/src/lib/server/sync/mappings.ts`
- **Section dispatch**: `packages/praxrr-app/src/lib/server/sync/types.ts` (`SectionType` union)
- **Supported sections**: Gated per `arr_type` in `SUPPORTED_SYNC_SECTIONS`

### Relevant CLAUDE.md Policies

- **Cross-Arr Semantic Validation**: Must validate behavior per target `arr_type`; no cross-Arr fallback
- **Arr Cutover Guardrails**: When introducing Lidarr-specific features, register built-in base ops in `seedBuiltInBaseOps.ts`
- **Contract-first API**: Define OpenAPI spec first, generate types, then implement
- **Svelte 5, no runes**: UI components use `onclick` handlers

---

## Open Questions

1. **PCD Entity Design**: Should metadata profiles be a new top-level PCD entity type (like quality profiles and custom formats), or should they be nested under media management? Quality profiles already have their own entity category; metadata profiles feel analogous enough to warrant the same treatment.

2. **Default Profile Contents**: What should the Praxrr default metadata profile include? The Lidarr default is conservative (Album + Studio + Official). Should Praxrr provide multiple presets (e.g., "Standard", "Comprehensive", "Singles + EPs")?

3. **Schema Endpoint vs. Hardcoded Constants**: Should the sync pipeline call the schema endpoint on each Lidarr instance to discover available types, or rely on hardcoded constants from the source code? The schema endpoint is more future-proof but adds an API call. Hardcoded constants are faster but need updating if Lidarr adds new types.

4. **Delete Protection**: Should Praxrr protect the default "None" profile or any profile with assigned artists from deletion? The API validates this server-side, but client-side guards would provide better UX.

5. **Rename Propagation**: If a metadata profile is renamed in Praxrr, should the rename propagate to all synced Lidarr instances? This is consistent with quality profile rename behavior but needs explicit implementation.

6. **Library View Impact**: Should the Lidarr library view (`/arr/[id]/library`) display metadata profile information alongside quality profile data? This could help users understand why certain albums appear or are missing for an artist.

---

## Sources

- [Lidarr API Docs (Swagger UI)](https://lidarr.audio/docs/api/)
- [MetadataProfileController.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileController.cs)
- [MetadataProfileResource.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileResource.cs)
- [MetadataProfileSchemaController.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataProfileSchemaController.cs)
- [MetadataValidator.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Profiles/Metadata/MetadataValidator.cs)
- [PrimaryAlbumType.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/PrimaryAlbumType.cs)
- [SecondaryAlbumType.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/SecondaryAlbumType.cs)
- [ReleaseStatus.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Music/Model/ReleaseStatus.cs)
- [ArtistResource.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/Lidarr.Api.V1/Artist/ArtistResource.cs)
- [MetadataProfile.cs - Lidarr/Lidarr GitHub](https://github.com/Lidarr/Lidarr/blob/f6a3e7370540cc25caf3aaf0f1c91e7c085585ac/src/NzbDrone.Core/Profiles/Metadata/MetadataProfile.cs)
- [Lidarr API Wiki](https://github.com/lidarr/Lidarr/wiki/API)
- [devopsarr/lidarr-py MetadataProfileApi docs](https://github.com/devopsarr/lidarr-py/blob/main/docs/MetadataProfileApi.md)
- [devopsarr/lidarr-py MetadataProfileResource docs](https://github.com/devopsarr/lidarr-py/blob/main/docs/MetadataProfileResource.md)
- [starr Go package - Lidarr MetadataProfile](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr)
- [Terraform Provider devopsarr/lidarr - metadata_profile resource](https://registry.terraform.io/providers/devopsarr/lidarr/latest/docs/resources/metadata_profile)
- [Configarr Experimental Support - Lidarr metadata profiles](https://configarr.de/docs/configuration/experimental-support/)
- [MusicBrainz Release Group/Type](https://musicbrainz.org/doc/Release_Group/Type)
- [MusicBrainz Release (statuses)](https://musicbrainz.org/doc/Release)
- [Servarr Wiki - Lidarr Settings](https://wiki.servarr.com/lidarr/settings)
- [Servarr Wiki (old) - Lidarr Settings](https://wikiold.servarr.com/Lidarr_Settings)
- [Lidarr Issue #2302 - Mass editor metadata profile support](https://github.com/Lidarr/Lidarr/issues/2302)
- [Lidarr Issue #1098 - Featured albums in metadata profiles](https://github.com/lidarr/Lidarr/issues/1098)

## Search Queries Executed

1. `Lidarr API v1 metadata profile endpoints documentation`
2. `Lidarr metadata profile schema primary types secondary types release statuses`
3. `Lidarr GitHub API MetadataProfileController source code`
4. `MusicBrainz release group primary type secondary type release status IDs`
5. `site:github.com/Lidarr/Lidarr MetadataProfileResource.cs source code`
6. `Lidarr API metadataprofile JSON response example primary album types secondary album types`
7. `site:github.com/Lidarr/Lidarr PrimaryAlbumType.cs enum values`
8. `site:github.com/Lidarr/Lidarr SecondaryAlbumType.cs ReleaseStatus.cs enum`
9. `Lidarr API authentication X-Api-Key header rate limits`
10. `github.com/Lidarr/Lidarr blob PrimaryAlbumType.cs "new PrimaryAlbumType" Album Single EP`
11. `Lidarr "SecondaryAlbumType" Compilation Soundtrack Spokenword Interview Audiobook Live Remix`
12. `devopsarr lidarr-py MetadataProfileResource primary_album_types IDs values`
13. `TypeScript JavaScript Lidarr API client library npm package`
14. `configarr lidarr metadata profile integration management`
15. `devopsarr lidarr terraform metadata_profile example primary_album_types secondary_album_types release_statuses complete`
16. `Lidarr artist API metadataProfileId artist configuration metadata profile assignment`
17. `Lidarr API "metadataprofile/schema" endpoint all types default values`
18. GitHub API code search: `PrimaryAlbumType repo:Lidarr/Lidarr filename:PrimaryAlbumType.cs`
19. GitHub API code search: `SecondaryAlbumType repo:Lidarr/Lidarr filename:SecondaryAlbumType.cs`
20. GitHub API code search: `ReleaseStatus repo:Lidarr/Lidarr filename:ReleaseStatus.cs`
21. GitHub API code search: `MetadataProfile repo:Lidarr/Lidarr filename:MetadataProfile.cs`
22. GitHub API code search: `MetadataProfileSchema repo:Lidarr/Lidarr`
23. GitHub API code search: `MustHaveAllowedPrimaryType repo:Lidarr/Lidarr`
24. GitHub API code search: `metadataProfileId repo:Lidarr/Lidarr filename:ArtistResource.cs`

## Uncertainties and Gaps

1. **Partial payload acceptance** -- It is unclear whether the Lidarr API will accept a metadata profile with only a subset of primary/secondary types (e.g., only the types with `allowed: true`). All reference implementations send all types. Testing against a live Lidarr instance would resolve this. **Confidence**: Low.

2. **Delete cascade behavior** -- The exact error returned when deleting a profile with assigned artists has not been verified against a live instance. **Confidence**: Low.

3. **Schema endpoint ordering** -- The schema controller orders types by ID descending, but it is not confirmed whether this ordering is preserved in the JSON response or if JSON serialization changes it. **Confidence**: Medium.

4. **Profile ID stability** -- It is assumed that metadata profile IDs are stable within a Lidarr instance (auto-incrementing integers), but this has not been explicitly verified. **Confidence**: Medium -- consistent with all other Arr profile ID behavior.

5. **Future type additions** -- If Lidarr adds new primary/secondary types (e.g., Audiobook being re-added, or Field Recording from MusicBrainz), hardcoded constants would need updating. The schema endpoint approach would handle this automatically. **Confidence**: Medium.
