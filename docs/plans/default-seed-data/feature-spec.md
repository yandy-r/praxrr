# Feature Spec: default-seed-data

## Executive Summary

This feature replaces hardcoded form defaults in the naming config create flow with values loaded
from the PCD (Praxrr Config Database) seed data at request time. Currently, the three naming form
components (Radarr, Sonarr, Lidarr) each define their own `defaults` objects with simplified format
strings, while the PCD seed data contains comprehensive TRaSH-Guide-aligned naming patterns with
clean titles, TMDB/TVDB IDs, custom formats, media info tokens, and release groups. The
implementation adds `getFirst*()` read functions to the naming entity module, wires them into the
`new/+page.server.ts` load function, and passes seed data as `initialData` to form components --
leveraging the existing `mapToFormData()` pipeline that already handles the null-to-defaults
fallback. The change affects 7 files, requires no new dependencies, and preserves full backward
compatibility when PCD seed data is unavailable.

## External Dependencies

### APIs and Services

None. This is entirely an internal codebase refactoring. No external APIs, libraries, or third-party
services are involved.

### Internal Dependencies

| Component                    | Purpose                                                 | Location                                       |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| PCD Cache (in-memory SQLite) | Compiled configuration database per instance            | `$pcd/database/cache.ts`                       |
| Kysely Query Builder         | Type-safe SQL queries against PCD cache                 | `cache.kb` property                            |
| PCD Manager                  | Cache lifecycle, initialization, access                 | `$pcd/core/manager.ts`                         |
| Naming Read Functions        | Existing `getXxxByName()` query pattern                 | `$pcd/entities/mediaManagement/naming/read.ts` |
| Conversion Utilities         | `colonReplacementFromDb()`, `multiEpisodeStyleFromDb()` | `$shared/pcd/mediaManagement.ts`               |

### Seed Data Sources

| Arr Type | Source                     | Row Name                                              | File                                                                                      |
| -------- | -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Radarr   | PCD base op (rosettarr)    | `'default'` (renamed to `'Praxrr - Radarr'` by op 20) | `packages/praxrr-db/ops/0.rosettarr.sql` line 25008                                       |
| Sonarr   | PCD base op (rosettarr)    | `'default'` (renamed to `'Praxrr - Sonarr'` by op 20) | `packages/praxrr-db/ops/0.rosettarr.sql` line 25009                                       |
| Lidarr   | Built-in base op migration | `'Lidarr'`                                            | `packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts` |

### Target Default Values (TRaSH Guide Reference)

The following are the authoritative media management naming defaults aligned with TRaSH Guide
recommendations. These are the values the PCD seed data should contain and that should pre-populate
the create-mode form.

#### Radarr

| Setting                    | Value                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename Movies              | `true`                                                                                                                                                                                                                                                           |
| Replace Illegal Characters | `true`                                                                                                                                                                                                                                                           |
| Colon Replacement          | `smart`                                                                                                                                                                                                                                                          |
| Standard Movie Format      | `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}` |
| Movie Folder Format        | `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`                                                                                                                                                                                                            |

#### Sonarr

| Setting                    | Value                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rename Episodes            | `true`                                                                                                                                                                                                                                                                                                             |
| Replace Illegal Characters | `true`                                                                                                                                                                                                                                                                                                             |
| Colon Replacement          | `smart`                                                                                                                                                                                                                                                                                                            |
| Standard Episode Format    | `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                         |
| Daily Episode Format       | `{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                                        |
| Anime Episode Format       | `{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{Mediainfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}` |
| Series Folder Format       | `{Series TitleYear} {tvdb-{TVDbId}}`                                                                                                                                                                                                                                                                               |
| Season Folder Format       | `Season {season:00}`                                                                                                                                                                                                                                                                                               |
| Specials Folder Format     | `Specials`                                                                                                                                                                                                                                                                                                         |
| Multi Episode Style        | `prefixedRange`                                                                                                                                                                                                                                                                                                    |

> **Note**: `Specials Folder Format` is not currently in the `sonarr_naming` PCD schema
> (`SonarrNamingRow`). This is a schema gap -- see [Decisions Needed](#decisions-needed).

#### Lidarr

| Setting                    | Value                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename Tracks              | `true`                                                                                                                                      |
| Replace Illegal Characters | `true`                                                                                                                                      |
| Colon Replacement          | `smart`                                                                                                                                     |
| Standard Track Format      | `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}`             |
| Multi-Disc Track Format    | `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}` |
| Artist Folder Format       | `{Artist Name} ({Artist MbId})`                                                                                                             |

#### PCD Seed Data Discrepancies

The current PCD seed data in `0.rosettarr.sql` has differences from the target values above:

| Arr Type | Field                     | Current PCD Seed                                                                                    | Target Value                                                                                          | Difference                         |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Radarr   | `movie_format`            | `...{tmdb-{TmdbId}} {edition-{Edition Tags}} {[Custom Formats]}{[Quality Full]}{[MediaInfo 3D]}...` | `...{tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}...` | Dash before edition, token reorder |
| Sonarr   | `standard_episode_format` | `...{Episode CleanTitle} {[Custom Formats]}...`                                                     | `...{Episode CleanTitle:90} {[Custom Formats]}...`                                                    | `:90` truncation added             |
| Sonarr   | `daily_episode_format`    | `...{Episode CleanTitle} {[Custom Formats]}...`                                                     | `...{Episode CleanTitle:90} {[Custom Formats]}...`                                                    | `:90` truncation added             |
| Sonarr   | `anime_episode_format`    | `...{Episode CleanTitle} ...`                                                                       | `...{Episode CleanTitle:90} ...`                                                                      | `:90` truncation, token reorder    |
| Sonarr   | `series_folder_format`    | `{Series TitleYear} {tvdb-{TvdbId}}`                                                                | `{Series TitleYear} {tvdb-{TVDbId}}`                                                                  | `TvdbId` -> `TVDbId` casing        |
| Sonarr   | N/A                       | No `specials_folder_format` column                                                                  | `Specials`                                                                                            | Schema gap                         |
| Lidarr   | All fields                | Match target                                                                                        | Match target                                                                                          | No discrepancies                   |

These discrepancies should be resolved by updating the PCD seed data (`0.rosettarr.sql`) to match
the target values before or alongside this feature.

## Business Requirements

### User Stories

**Primary User: Praxrr Admin**

- As a Praxrr admin, I want the "New Naming Config" form to be pre-populated with the PCD database's
  recommended default values so that I can create configs aligned with curated seed data without
  manually entering each field.
- As a Praxrr admin, I want changes to PCD seed defaults (such as `colon_replacement_format`) to
  automatically propagate to the create-mode form without requiring code changes.

**Secondary User: PCD Maintainer**

- As a PCD maintainer, I want naming form defaults to be defined in one authoritative place (PCD
  seed data) so that I do not have to update hardcoded values in 3 Svelte form components when
  defaults change.

### Business Rules

1. **Single Source of Truth**: PCD seed data rows are the authoritative source for create-mode form
   defaults. Hardcoded `defaults` objects remain only as fallbacks when PCD data is unavailable.

2. **First-Row Lookup Strategy**: For each Arr type, the load function queries the PCD cache for the
   first available naming row ordered by `created_at ASC`. This returns the original seed row
   regardless of naming variations across PCD versions.

3. **Name Field Always Blank in Create Mode**: Even when pre-populating from PCD seed data, the
   `name` field must remain empty (`''`). The user must provide a unique name for each new config.

4. **Graceful Fallback**: If the PCD cache has no naming rows for an Arr type (empty database,
   failed compilation), the form falls back to existing hardcoded defaults via
   `mapToFormData(null)`. Zero behavioral regression.

5. **Edit Mode Unchanged**: This feature only affects create mode. Edit mode already loads from PCD
   correctly via `getXxxByName()`.

6. **Integer-to-String Conversions**: New `getFirst*()` functions must apply the same conversions as
   existing `getXxxByName()` functions: `colonReplacementFromDb()` for Sonarr/Lidarr,
   `multiEpisodeStyleFromDb()` for Sonarr.

### Edge Cases

| Scenario                                                          | Expected Behavior                                                   | Notes                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Empty PCD cache (no naming rows)                                  | Form uses hardcoded fallback defaults                               | `mapToFormData(null)` returns `defaults`   |
| PCD seed row renamed (e.g., `'default'` -> `'Praxrr - Radarr'`)   | `ORDER BY created_at ASC LIMIT 1` still finds the original seed row | Stable regardless of name changes          |
| User-modified seed row via user ops                               | Create-mode shows user's modified values                            | Correct: user's PCD state is authoritative |
| Multiple naming rows in PCD                                       | First (oldest) row selected as seed template                        | Deterministic, consistent                  |
| `custom_colon_replacement_format` is NULL in PCD but `''` in form | `mapToFormData` normalizes via `\|\| ''`                            | No visible difference                      |

### Success Criteria

- [ ] `new/+page.server.ts` load returns default naming rows from PCD cache for all 3 Arr types
- [ ] `+page.svelte` passes PCD seed data as `initialData` to form components in create mode
- [ ] Form components use PCD seed values when `initialData` is provided, with minimal hardcoded
      fallbacks
- [ ] `name` field is always blank in create mode regardless of PCD seed row name
- [ ] Creating a new naming config via UI pre-populates fields matching PCD seed data values
- [ ] Edit mode is unaffected (no regression)
- [ ] `deno task check` passes
- [ ] `deno task test` passes

## Technical Specifications

### Architecture Overview

```
Current Create Flow:
+page.server.ts (load)       +page.svelte              Form Component
---------------------         -----------               ---------------
returns { canWriteToBase }    passes initialData={null}  mapToFormData(null) -> hardcoded defaults
                                                         initCreate(defaults)

Target Create Flow:
+page.server.ts (load)                +page.svelte                     Form Component
---------------------------           ----------------------           ---------------
queries PCD cache for first           passes initialData from          mapToFormData(seedData) -> PCD values
naming row per Arr type               data.seedDefaults.radarr etc.    mapped.name = '' (cleared for create)
returns {                             (falls back to null if absent)   initCreate(pcdValues)
  canWriteToBase,
  seedDefaults: {
    radarr: RadarrNamingRow | null,
    sonarr: SonarrNamingRow | null,
    lidarr: LidarrNamingRow | null,
  }
}
```

### Data Models

#### RadarrNamingRow (existing, no changes)

| Field                      | Type        | Constraints | Description                |
| -------------------------- | ----------- | ----------- | -------------------------- |
| name                       | string      | PK          | Naming config identifier   |
| rename                     | boolean     | NOT NULL    | Enable renaming            |
| movie_format               | string      | NOT NULL    | Movie file format string   |
| movie_folder_format        | string      | NOT NULL    | Movie folder format string |
| replace_illegal_characters | boolean     | NOT NULL    | Replace illegal chars      |
| colon_replacement_format   | string enum | NOT NULL    | Colon replacement strategy |
| created_at                 | string      | NOT NULL    | Creation timestamp         |
| updated_at                 | string      | NOT NULL    | Last update timestamp      |

#### SonarrNamingRow (existing, no changes)

| Field                           | Type           | Constraints | Description                          |
| ------------------------------- | -------------- | ----------- | ------------------------------------ |
| name                            | string         | PK          | Naming config identifier             |
| rename                          | boolean        | NOT NULL    | Enable renaming                      |
| standard_episode_format         | string         | NOT NULL    | Standard episode format              |
| daily_episode_format            | string         | NOT NULL    | Daily episode format                 |
| anime_episode_format            | string         | NOT NULL    | Anime episode format                 |
| series_folder_format            | string         | NOT NULL    | Series folder format                 |
| season_folder_format            | string         | NOT NULL    | Season folder format                 |
| replace_illegal_characters      | boolean        | NOT NULL    | Replace illegal chars                |
| colon_replacement_format        | string enum    | NOT NULL    | Colon replacement (int->string)      |
| custom_colon_replacement_format | string \| null |             | Custom colon replacement             |
| multi_episode_style             | string enum    | NOT NULL    | Multi-episode handling (int->string) |
| created_at                      | string         | NOT NULL    | Creation timestamp                   |
| updated_at                      | string         | NOT NULL    | Last update timestamp                |

#### LidarrNamingRow (existing, no changes)

| Field                           | Type           | Constraints | Description                     |
| ------------------------------- | -------------- | ----------- | ------------------------------- |
| name                            | string         | PK          | Naming config identifier        |
| rename                          | boolean        | NOT NULL    | Enable renaming                 |
| standard_track_format           | string         | NOT NULL    | Standard track format           |
| artist_name                     | string         | NOT NULL    | Artist name format              |
| multi_disc_track_format         | string         | NOT NULL    | Multi-disc track format         |
| artist_folder_format            | string         | NOT NULL    | Artist folder format            |
| replace_illegal_characters      | boolean        | NOT NULL    | Replace illegal chars           |
| colon_replacement_format        | string enum    | NOT NULL    | Colon replacement (int->string) |
| custom_colon_replacement_format | string \| null |             | Custom colon replacement        |
| created_at                      | string         | NOT NULL    | Creation timestamp              |
| updated_at                      | string         | NOT NULL    | Last update timestamp           |

### Gap Analysis: Hardcoded Defaults vs Target Defaults

**All form default fields have PCD seed equivalents. No schema changes needed for naming fields.**
One Sonarr field (`specials_folder_format`) exists in the TRaSH Guide recommendations but not in the
current PCD schema.

#### Radarr (2 major mismatches)

| Form Field                                                     | Hardcoded Default                               | Target Value (TRaSH)                                                                                                                                                                                                                                             | Status             |
| -------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `movieFormat`                                                  | `{Movie Title} ({Release Year}) {Quality Full}` | `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}` | **MAJOR MISMATCH** |
| `movieFolderFormat`                                            | `{Movie Title} ({Release Year})`                | `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`                                                                                                                                                                                                            | **MISMATCH**       |
| `rename`, `replaceIllegalCharacters`, `colonReplacementFormat` | Match target                                    | -                                                                                                                                                                                                                                                                | OK                 |

#### Sonarr (5 format + 1 enum mismatch + 1 schema gap)

| Form Field                                                     | Hardcoded Default                                                             | Target Value (TRaSH)                                                                                                                                                                                                                                                                                               | Status                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `standardEpisodeFormat`                                        | `{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}` | `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                         | **MAJOR MISMATCH**          |
| `dailyEpisodeFormat`                                           | `{Series Title} - {Air-Date} - {Episode Title} {Quality Full}`                | `{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                                        | **MAJOR MISMATCH**          |
| `animeEpisodeFormat`                                           | Same as standard                                                              | `{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{Mediainfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}` | **MAJOR MISMATCH**          |
| `seriesFolderFormat`                                           | `{Series Title}`                                                              | `{Series TitleYear} {tvdb-{TVDbId}}`                                                                                                                                                                                                                                                                               | **MISMATCH**                |
| `seasonFolderFormat`                                           | `Season {season}`                                                             | `Season {season:00}`                                                                                                                                                                                                                                                                                               | **MISMATCH** (zero-padding) |
| `multiEpisodeStyle`                                            | `'extend'` (0)                                                                | `'prefixedRange'` (5)                                                                                                                                                                                                                                                                                              | **MISMATCH**                |
| N/A (not in schema)                                            | N/A                                                                           | `specialsFolderFormat`: `Specials`                                                                                                                                                                                                                                                                                 | **SCHEMA GAP**              |
| `colonReplacementFormat`, `replaceIllegalCharacters`, `rename` | Match target                                                                  | -                                                                                                                                                                                                                                                                                                                  | OK                          |

#### Lidarr (0 mismatches)

All format strings match exactly between hardcoded defaults and target values (synchronized by the
`20260217` migration). Only minor `customColonReplacementFormat` difference (`''` vs `NULL`,
normalized by `mapToFormData`).

### API Design

No new API endpoints required. The change is internal to SvelteKit server-side load functions and
form component initialization.

### System Integration

#### Files to Create

None.

#### Files to Modify

1. **`packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`**
   - Add `getFirstRadarr(cache)`, `getFirstSonarr(cache)`, `getFirstLidarr(cache)` functions
   - Each mirrors the existing `getXxxByName()` pattern but uses
     `orderBy('created_at', 'asc').limit(1)` instead of `where('name', '=', name)`
   - Must apply same integer-to-string conversions for Sonarr/Lidarr

2. **`packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/index.ts`**
   - Export the 3 new `getFirst*` functions

3. **`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`**
   - Add imports for `getFirstRadarr`, `getFirstSonarr`, `getFirstLidarr`
   - Expand load function to query PCD cache and return `seedDefaults` object with all 3 Arr types

4. **`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`**
   - Change `initialData={null}` to `initialData={data.seedDefaults?.radarr ?? null}` (and
     sonarr/lidarr)

5. **`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`**
   - Clear `name` field to `''` in create-mode initialization path when `initialData` is non-null

6. **`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`**
   - Same name-clearing change

7. **`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`**
   - Same name-clearing change

#### Files NOT Modified (Clarification from Issue)

The edit-mode route handlers (`radarr/[name]/+page.server.ts`, `sonarr/[name]/+page.server.ts`,
`lidarr/[name]/+page.server.ts`) do **not** need changes. They query by name and throw 404 if not
found -- no hardcoded fallbacks to remove.

## UX Considerations

### User Workflows

#### Primary Workflow: Create Naming Config

1. **Navigate**: User clicks "New" from naming list
   - System: Routes to `/media-management/{databaseId}/naming/new`, load function queries PCD cache
     for seed defaults

2. **Select Arr Type**: User clicks Radarr / Sonarr / Lidarr card
   - System: Renders corresponding form with seed defaults pre-populated (no server round-trip
     needed -- all 3 Arr types loaded upfront)

3. **Review Defaults**: User sees comprehensive TRaSH-style format strings in all fields
   - System: Live preview (NamingPreview) shows resolved sample output beneath format fields

4. **Customize**: User enters a unique name (required) and optionally adjusts fields
   - System: Dirty tracking active, save button enabled once name is non-empty

5. **Save**: User clicks "Create"
   - System: Validates, writes PCD op, redirects to listing with success alert

#### Fallback Workflow: No PCD Seed Data

1. **Same navigation and Arr type selection**
2. **Fallback activation**: No seed row found in PCD cache
3. **Form renders with hardcoded fallback defaults** (current behavior)
4. **No error shown** -- functionally identical to today's behavior

### Dirty Tracking

No changes needed. `initCreate()` already treats any defaults object identically -- it sets
`isNewMode = true`, making `isDirty` always return `true`. The effective save gate is `isValid`
(name is non-empty). PCD-derived defaults are functionally equivalent to hardcoded defaults from the
dirty store's perspective.

### Accessibility Requirements

No new accessibility concerns. The form structure and inputs remain unchanged. Only the
pre-populated values differ.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Add `getFirst*()` read functions to the existing naming entity module,
wire them into the create-mode load function, and pass seed data through to form components via the
existing `initialData` prop. Minimal changes, maximum leverage of existing infrastructure.

**Phasing:**

1. **Phase 1 - Read Functions**: Add `getFirstRadarr`, `getFirstSonarr`, `getFirstLidarr` to
   `read.ts` and export from `index.ts`
2. **Phase 2 - Wiring**: Update `new/+page.server.ts` load function and `new/+page.svelte` to pass
   seed data
3. **Phase 3 - Form Adjustments**: Clear `name` field in create-mode initialization in all 3 form
   components

### Technology Decisions

| Decision               | Recommendation                                  | Rationale                                            |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Query strategy         | `ORDER BY created_at ASC LIMIT 1`               | Stable across PCD versions, handles renamed rows     |
| Read function location | `read.ts` (alongside `getXxxByName`)            | Same query pattern, shared column mapping logic      |
| Fallback approach      | Keep hardcoded `defaults` as last resort        | Zero-risk degradation for empty PCDs                 |
| Name field clearing    | Override after `mapToFormData()` in create path | Keeps `mapToFormData` pure, no mode parameter needed |

### Quick Wins

- Lidarr defaults already match PCD seed -- main value is removing duplication
- All three form components follow identical patterns, so changes are mechanical

### Future Enhancements

- **MediaSettingsForm**: Same `initialData={null}` + hardcoded defaults pattern; should be addressed
  in a follow-up for consistency
- **"Reset to defaults" button**: Per-field revert to PCD seed values on edit pages
- **Route handler fallback alignment**: The `|| 'smart'` and `|| 'extend'` fallbacks (7 occurrences
  across 4 files) could be centralized as PCD-derived or schema-level constants

## Risk Assessment

### Technical Risks

| Risk                                       | Likelihood | Impact | Mitigation                                                                        |
| ------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------- |
| PCD cache not ready at load time           | Very Low   | High   | Startup sequence guarantees `pcdManager.initialize()` before routes               |
| PCD seed row name inconsistency            | Medium     | Low    | `ORDER BY created_at ASC LIMIT 1` handles any name                                |
| Sonarr `multiEpisodeStyle` behavior change | Certain    | Low    | Users get `prefixedRange` instead of `extend` -- aligns with TRaSH recommendation |
| Empty PCD database                         | Medium     | Low    | Graceful fallback to hardcoded defaults                                           |
| Breaking existing tests                    | Low        | Medium | No tests validate create-mode form defaults specifically                          |

### Integration Challenges

- **Sonarr/Lidarr integer-to-string conversion**: Existing `colonReplacementFromDb()` /
  `multiEpisodeStyleFromDb()` in read functions handle this. New `getFirst*()` functions must use
  them too.
- **Lidarr seed comes from built-in base ops, not rosettarr.sql**: `seedBuiltInBaseOps()` runs
  during PCD initialization, so data is present in cache.

### Security Considerations

- No new attack surface. PCD cache is server-side only; seed data flows through the existing
  SvelteKit load function pipeline.

## Task Breakdown Preview

### Phase 1: Read Functions

**Focus**: Add PCD cache query functions for seed/default naming rows **Tasks**:

- Add `getFirstRadarr()`, `getFirstSonarr()`, `getFirstLidarr()` to `read.ts`
- Export new functions from `index.ts` **Parallelization**: All three functions can be written
  simultaneously (no dependencies)

### Phase 2: Server + Page Wiring

**Focus**: Wire seed data from PCD cache through to form components **Dependencies**: Phase 1 (read
functions must exist) **Tasks**:

- Update `new/+page.server.ts` load function to query PCD cache
- Update `new/+page.svelte` to pass `data.seedDefaults.*` as `initialData`

### Phase 3: Form Component Adjustments

**Focus**: Ensure `name` field is cleared in create mode with non-null seed data **Dependencies**:
Phase 2 (seed data must flow to forms) **Tasks**:

- Update RadarrNamingForm.svelte create-mode initialization
- Update SonarrNamingForm.svelte create-mode initialization
- Update LidarrNamingForm.svelte create-mode initialization **Parallelization**: All three form
  changes are independent

### Phase 4: Verification

**Focus**: Validate correctness and no regressions **Tasks**:

- `deno task check` passes
- `deno task test` passes
- Manual: Navigate to create page, verify each Arr type shows PCD seed defaults
- Manual: Verify `colonReplacementFormat` shows `smart` for all Arr types
- Manual: Verify edit mode unchanged
- Manual: Verify creating with modified values saves correctly

## Decisions Needed

1. **Should hardcoded `defaults` objects be updated to match PCD seed values or left as-is?**
   - Options: Update to match PCD | Leave as simplified fallbacks
   - Impact: If updated, even the no-PCD fallback shows TRaSH-quality formats. If left, the fallback
     shows simplified formats.
   - Recommendation: Leave as-is. Hardcoded defaults are a safety net for edge cases. Updating them
     would re-introduce the synchronization problem this feature solves.

2. **Should MediaSettingsForm be included in this PR scope?**
   - Options: Include now | Defer to follow-up
   - Impact: Current defaults already match PCD, so the value is consistency/future-proofing
   - Recommendation: Defer. The naming forms are the primary issue scope per #71.

3. **Should `specials_folder_format` be added to the Sonarr naming schema?**
   - The TRaSH Guide recommends `Specials` as the Specials Folder Format, but `SonarrNamingRow` and
     the `sonarr_naming` PCD table have no `specials_folder_format` column.
   - Options: Add column now (schema migration + PCD seed update + form field) | Defer to follow-up
     issue
   - Impact: Without this column, the PCD cannot fully represent Sonarr's naming configuration.
   - Recommendation: Defer to a follow-up issue. This feature focuses on using existing PCD seed
     data for defaults.

4. **Should PCD seed data in `0.rosettarr.sql` be updated to match TRaSH Guide target values?**
   - The current PCD seed data has minor differences from the TRaSH Guide reference (see
     [PCD Seed Data Discrepancies](#pcd-seed-data-discrepancies)): `:90` truncation on Sonarr
     CleanTitle, token ordering, `TVDbId` casing, dash before Radarr edition tags.
   - Options: Update PCD seed data in this PR | Update in a separate PCD-DB PR first
   - Impact: If updated alongside, the feature works with the correct values immediately. If
     deferred, the feature still works but shows slightly outdated format strings.
   - Recommendation: Update PCD seed data in a preceding or companion PCD-DB commit.

## Suggested Issue #71 Updates

Based on gap analysis, the following corrections/additions are recommended:

1. **Add `multiEpisodeStyle` mismatch**: Sonarr form defaults to `'extend'` while PCD seed uses
   `'prefixedRange'` (DB value `5`). This is a visible behavioral difference not mentioned in the
   original issue.
2. **Correct `|| 'delete'` reference**: The actual code uses `|| 'smart'` for
   `colonReplacementFormat` (7 occurrences, not 4). The `?? 'delete'` only exists in
   `colonReplacementFromDb()` as a DB conversion fallback.
3. **Edit-mode route handlers need no changes**: The issue lists 3 edit-mode `+page.server.ts`
   files, but they have no hardcoded fallbacks -- they query by name and throw 404.
4. **Quantify mismatch severity**: Radarr: 2 format fields. Sonarr: 5 format + 1 enum. Lidarr: 0
   (already synchronized).
5. **Note Lidarr already matches**: The `20260217` migration synced Lidarr defaults. Main value is
   removing duplication.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): PCD cache architecture, seed data sources, query
  patterns
- [research-business.md](./research-business.md): Business logic, gap analysis, exact hardcoded
  defaults vs PCD values
- [research-technical.md](./research-technical.md): Technical specifications, data models,
  implementation design
- [research-ux.md](./research-ux.md): UX patterns, competitive analysis, dirty tracking behavior
- [research-recommendations.md](./research-recommendations.md): Full gap analysis tables, risk
  assessment, task breakdown
