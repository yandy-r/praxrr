# Business Logic Research: default-seed-data

## Executive Summary

The naming form components (Radarr, Sonarr, Lidarr) each define hardcoded `defaults` objects used
when `initialData` is null in create mode. These defaults duplicate values already present as PCD
seed rows in the compiled cache (e.g., the "default"/"Radarr"/"Sonarr"/"Lidarr" naming rows). The
feature eliminates this duplication by having the `new/+page.server.ts` load function query the PCD
cache for the first available naming row per Arr type and pass it to the form component as
`initialData`, removing the need for hardcoded fallback objects.

## User Stories

### Primary User: Praxrr Admin

- As a Praxrr admin, I want the "New Naming Config" form to be pre-populated with the PCD database's
  recommended default values so that I can create configs that align with the curated PCD seed data
  without manually entering each field.
- As a Praxrr admin, I want changes to PCD seed defaults (such as `colon_replacement_format`) to
  automatically propagate to the create-mode form without requiring code changes to the form
  components.
- As a PCD maintainer, I want naming form defaults to be defined in one authoritative place (the PCD
  seed data) so that I do not have to update hardcoded values in 3 Svelte form components and 4
  route handler files when defaults change.

## Business Rules

### Core Rules

1. **Single Source of Truth**: PCD seed data rows are the authoritative source for create-mode form
   defaults. Hardcoded `defaults` objects in form components should be minimized or eliminated.
2. **First-Row Lookup Strategy**: For each Arr type, the load function should query the PCD cache
   for the first available naming row. The PCD DB seeds naming rows with well-known names ("default"
   for Radarr/Sonarr in rosettarr, "Lidarr" for Lidarr). After ops 20/21 rename them to
   "Radarr"/"Sonarr"/"Lidarr".
3. **Name Field Always Blank in Create Mode**: Even when pre-populating from PCD seed data, the
   `name` field must remain empty (`''`) in create mode. The user must choose a unique name for the
   new config.
4. **Graceful Fallback**: If the PCD cache has no naming rows for an Arr type (e.g., empty database,
   failed compilation), the form should still work with sensible fallback values. Completely
   removing all hardcoded defaults is risky; a minimal inline fallback or the existing defaults
   object should remain as a last resort.
5. **Route Handler Fallbacks**: The `|| 'smart'` and `|| 'extend'` fallbacks in route handler form
   data parsing protect against missing/empty form fields during submission. These are separate from
   form pre-population and should be preserved or replaced with PCD-derived constants.
6. **Edit Mode Unchanged**: This feature only affects create mode (`mode === 'create'`). Edit mode
   already receives full `initialData` from the route handler's load function via
   `getRadarrByName`/`getSonarrByName`/`getLidarrByName`.

### Edge Cases

- **Empty PCD Cache**: If no naming rows exist in the cache (newly initialized database before ops
  are compiled, or a PCD with no naming data), the form should fall back to minimal sensible
  defaults. The `mapToFormData(null)` path must still work.
- **Multiple Naming Rows**: The PCD DB may contain multiple naming configs per Arr type (e.g.,
  "default" and "Radarr" during transition). The load function should pick the first/canonical row,
  not an arbitrary one. Using `LIMIT 1` with a deterministic `ORDER BY` is important.
- **Sonarr Integer Storage**: Sonarr stores `colon_replacement_format` as an integer (0-5) and
  `multi_episode_style` as an integer (0-5) in the PCD cache. The read functions already convert
  these via `colonReplacementFromDb()` and `multiEpisodeStyleFromDb()`. The
  `colonReplacementFromDb()` function has a `?? 'delete'` fallback for unknown values, which should
  remain.
- **Radarr String Storage**: Radarr stores `colon_replacement_format` directly as a string
  ('delete', 'dash', 'spaceDash', 'spaceDashSpace', 'smart'). No conversion needed.
- **Lidarr Shares Sonarr's Integer Format**: Lidarr naming uses `colonReplacementFromDb()` for colon
  replacement, matching the Sonarr integer pattern.

## Workflows

### Create-Mode Workflow (Current)

1. User navigates to `/media-management/{databaseId}/naming/new`
2. `new/+page.server.ts` load returns only `canWriteToBase` (no naming data)
3. `new/+page.svelte` shows Arr type picker (Radarr/Sonarr/Lidarr)
4. User selects an Arr type
5. Form component mounts with `initialData={null}`
6. `mapToFormData(null)` returns the hardcoded `defaults` object
7. `initCreate(defaults)` initializes the dirty store
8. Form fields are pre-populated from hardcoded defaults
9. User fills in name, modifies format strings, and saves

### Create-Mode Workflow (Target)

1. User navigates to `/media-management/{databaseId}/naming/new`
2. `new/+page.server.ts` load queries PCD cache for default naming rows for all 3 Arr types
3. Load function returns `{ canWriteToBase, radarrDefaults, sonarrDefaults, lidarrDefaults }`
4. `new/+page.svelte` shows Arr type picker (same as today)
5. User selects an Arr type
6. Form component mounts with `initialData={data.radarrDefaults}` (or sonarr/lidarr)
7. `mapToFormData(data)` returns the PCD-derived data with `name` cleared to `''`
8. `initCreate(pcdDerivedData)` initializes the dirty store
9. Form fields are pre-populated from PCD seed data
10. User fills in name, modifies format strings, and saves

### Edit-Mode Workflow (Reference -- No Changes)

1. User navigates to `/media-management/{databaseId}/naming/{arrType}/{name}`
2. Route handler load function queries PCD cache by name: `getRadarrByName(cache, decodedName)`
3. Returns `{ namingConfig, canWriteToBase }`
4. `+page.svelte` passes `initialData={data.namingConfig}` to form component
5. `mapToFormData(data)` maps the full row to form data
6. `initEdit(formData)` initializes the dirty store
7. Form fields show current values

## Domain Model

### Key Entities

- **PCD Cache** (`PCDCache`): An in-memory compiled SQLite database per PCD instance. Contains the
  result of replaying all base + user ops. Accessed via `pcdManager.getCache(databaseId)` and
  exposes a `kb` Kysely query builder.
- **Naming Row Types**: `RadarrNamingRow`, `SonarrNamingRow`, `LidarrNamingRow` -- these are the
  display types with semantic values (booleans, string enums instead of integers).
- **Naming Tables**: `radarr_naming`, `sonarr_naming`, `lidarr_naming` -- PCD cache tables with
  `name` as primary key.
- **Seed Rows**: The PCD DB (`packages/praxrr-db/ops/0.rosettarr.sql`) inserts initial rows named
  "default" for Radarr and Sonarr. Op 20/21 renames them to "Radarr"/"Sonarr". The Lidarr naming
  seed comes from migration `20260217_set_lidarr_naming_defaults.ts` (inserted as "Lidarr").
- **Form Defaults Object**: Each form component defines a `const defaults: XxxNamingFormData` with
  hardcoded values used when `initialData === null`.
- **`mapToFormData()`**: Converts a `XxxNamingRow | null` to the form data interface. Returns
  `defaults` when null; maps DB column names to camelCase form field names when non-null.
- **Dirty Store**: Tracks form modifications. `initCreate()` marks all fields as "original" state so
  any user change shows as dirty. `initEdit()` records the server state.

## Existing Codebase Analysis

### Hardcoded Defaults (Exact Values)

#### RadarrNamingForm.svelte (line 36-43)

```typescript
const defaults: RadarrNamingFormData = {
  name: '',
  rename: true,
  movieFormat: '{Movie Title} ({Release Year}) {Quality Full}',
  movieFolderFormat: '{Movie Title} ({Release Year})',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'smart',
};
```

#### SonarrNamingForm.svelte (line 66-78)

```typescript
const defaults: SonarrNamingFormData = {
  name: '',
  rename: true,
  standardEpisodeFormat:
    '{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}',
  dailyEpisodeFormat:
    '{Series Title} - {Air-Date} - {Episode Title} {Quality Full}',
  animeEpisodeFormat:
    '{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}',
  seriesFolderFormat: '{Series Title}',
  seasonFolderFormat: 'Season {season}',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'smart',
  customColonReplacementFormat: '',
  multiEpisodeStyle: 'extend',
};
```

#### LidarrNamingForm.svelte (line 35-47)

```typescript
const defaults: LidarrNamingFormData = {
  name: '',
  rename: true,
  standardTrackFormat:
    '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}',
  artistName: '{Artist Name}',
  multiDiscTrackFormat:
    '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}',
  artistFolderFormat: '{Artist Name} ({Artist MbId})',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'smart',
  customColonReplacementFormat: '',
};
```

### PCD Seed Data Fields (After All Ops Applied)

#### Radarr (from `0.rosettarr.sql` line 25008, renamed to "Radarr" by op 21)

| DB Column                    | Seed Value                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                       | `'Radarr'` (originally `'default'`)                                                                                                                                                                                                                              |
| `rename`                     | `1` (true)                                                                                                                                                                                                                                                       |
| `movie_format`               | `'{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} {edition-{Edition Tags}} {[Custom Formats]}{[Quality Full]}{[MediaInfo 3D]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[Mediainfo VideoCodec]}{-Release Group}'` |
| `movie_folder_format`        | `'{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}'`                                                                                                                                                                                                          |
| `replace_illegal_characters` | `1` (true, normalized by migration 20260224)                                                                                                                                                                                                                     |
| `colon_replacement_format`   | `'smart'` (normalized by migration 20260224)                                                                                                                                                                                                                     |

#### Sonarr (from `0.rosettarr.sql` line 25009, renamed to "Sonarr" by op 21)

| DB Column                         | Seed Value                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                            | `'Sonarr'` (originally `'default'`)                                                                                                                                                                                                                                                                                 |
| `rename`                          | `1` (true)                                                                                                                                                                                                                                                                                                          |
| `standard_episode_format`         | `'{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoCodec]}{-Release Group}'`                                                                           |
| `daily_episode_format`            | `'{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoCodec]}{-Release Group}'`                                                                                          |
| `anime_episode_format`            | `'{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}[{MediaInfo VideoBitDepth}bit]{[MediaInfo VideoCodec]}[{Mediainfo AudioCodec} { Mediainfo AudioChannels}]{MediaInfo AudioLanguages}{-Release Group}'` |
| `series_folder_format`            | `'{Series TitleYear} {tvdb-{TvdbId}}'`                                                                                                                                                                                                                                                                              |
| `season_folder_format`            | `'Season {season:00}'`                                                                                                                                                                                                                                                                                              |
| `replace_illegal_characters`      | `1` (true, normalized by migration 20260224)                                                                                                                                                                                                                                                                        |
| `colon_replacement_format`        | `4` (= `'smart'`, normalized by migration 20260224)                                                                                                                                                                                                                                                                 |
| `custom_colon_replacement_format` | `NULL` (normalized by migration 20260224)                                                                                                                                                                                                                                                                           |
| `multi_episode_style`             | `5` (= `'prefixedRange'`)                                                                                                                                                                                                                                                                                           |

#### Lidarr (from migration `20260217_set_lidarr_naming_defaults.ts`)

| DB Column                         | Seed Value                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                            | `'Lidarr'`                                                                                                                                    |
| `rename`                          | `1` (true)                                                                                                                                    |
| `standard_track_format`           | `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}'`             |
| `artist_name`                     | `'{Artist Name}'`                                                                                                                             |
| `multi_disc_track_format`         | `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}'` |
| `artist_folder_format`            | `'{Artist Name} ({Artist MbId})'`                                                                                                             |
| `replace_illegal_characters`      | `1` (true, normalized by migration 20260224)                                                                                                  |
| `colon_replacement_format`        | `4` (= `'smart'`, normalized by migration 20260224)                                                                                           |
| `custom_colon_replacement_format` | `NULL` (normalized by migration 20260224)                                                                                                     |

### Gap Analysis: Hardcoded Defaults vs Target Defaults (TRaSH Guide)

**CRITICAL FINDING: ALL form default fields have PCD seed data equivalents.** There are no fields in
the hardcoded defaults that lack a corresponding PCD seed column. The mapping is complete. One
Sonarr field (`specials_folder_format`) exists in TRaSH Guide recommendations but not in the PCD
schema.

The **values differ significantly** between the hardcoded defaults and the TRaSH Guide target
values:

| Arr Type   | Field                      | Hardcoded Default                                                             | Target Value (TRaSH Guide)                                                                                                                                                                                                                                                                                         | Different?                               |
| ---------- | -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **Radarr** | `movieFormat`              | `{Movie Title} ({Release Year}) {Quality Full}`                               | `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                   | YES -- target is much richer             |
| **Radarr** | `movieFolderFormat`        | `{Movie Title} ({Release Year})`                                              | `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`                                                                                                                                                                                                                                                              | YES -- target includes TmdbId            |
| **Radarr** | `colonReplacementFormat`   | `'smart'`                                                                     | `'smart'`                                                                                                                                                                                                                                                                                                          | NO -- same                               |
| **Radarr** | `rename`                   | `true`                                                                        | `true`                                                                                                                                                                                                                                                                                                             | NO -- same                               |
| **Radarr** | `replaceIllegalCharacters` | `true`                                                                        | `true`                                                                                                                                                                                                                                                                                                             | NO -- same                               |
| **Sonarr** | `standardEpisodeFormat`    | `{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}` | `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                         | YES -- target is richer with `:90` trunc |
| **Sonarr** | `dailyEpisodeFormat`       | `{Series Title} - {Air-Date} - {Episode Title} {Quality Full}`                | `{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`                                                                                        | YES -- target is richer with `:90` trunc |
| **Sonarr** | `animeEpisodeFormat`       | Same as standard                                                              | `{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{Mediainfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}` | YES -- anime-specific with absolute+lang |
| **Sonarr** | `seriesFolderFormat`       | `{Series Title}`                                                              | `{Series TitleYear} {tvdb-{TVDbId}}`                                                                                                                                                                                                                                                                               | YES -- target includes year+TVDbId       |
| **Sonarr** | `seasonFolderFormat`       | `Season {season}`                                                             | `Season {season:00}`                                                                                                                                                                                                                                                                                               | YES -- target zero-pads                  |
| **Sonarr** | `specialsFolderFormat`     | N/A (not in schema)                                                           | `Specials`                                                                                                                                                                                                                                                                                                         | **SCHEMA GAP** -- no PCD column          |
| **Sonarr** | `multiEpisodeStyle`        | `'extend'` (0)                                                                | `'prefixedRange'` (5)                                                                                                                                                                                                                                                                                              | YES -- different style                   |
| **Sonarr** | `colonReplacementFormat`   | `'smart'`                                                                     | `'smart'` (4)                                                                                                                                                                                                                                                                                                      | NO -- same after conversion              |
| **Lidarr** | `standardTrackFormat`      | Same as target                                                                | Same                                                                                                                                                                                                                                                                                                               | NO -- identical                          |
| **Lidarr** | `artistName`               | Same as target                                                                | Same                                                                                                                                                                                                                                                                                                               | NO -- identical                          |
| **Lidarr** | `multiDiscTrackFormat`     | Same as target                                                                | Same                                                                                                                                                                                                                                                                                                               | NO -- identical                          |
| **Lidarr** | `artistFolderFormat`       | Same as target                                                                | Same                                                                                                                                                                                                                                                                                                               | NO -- identical                          |
| **Lidarr** | `colonReplacementFormat`   | `'smart'`                                                                     | `'smart'` (4)                                                                                                                                                                                                                                                                                                      | NO -- same after conversion              |

**Key Insight**: The Radarr and Sonarr hardcoded defaults are **simplified placeholders** (basic
token usage), while the target values contain the **full TRaSH-recommended format strings** with
clean titles, custom formats, media info, release groups, and `:90` truncation. Switching to PCD
seed data will give users much better starting templates.

> **Note**: The current PCD seed data in `0.rosettarr.sql` also has minor differences from the TRaSH
> Guide target values documented above (no `:90` truncation, slightly different token ordering,
> `TvdbId` vs `TVDbId` casing). The PCD seed data should be updated to match the target values. See
> [feature-spec.md](./feature-spec.md#pcd-seed-data-discrepancies) for the full discrepancy table.

### Route Handler Fallbacks

All route handlers (create and update) have `|| 'smart'` fallbacks for `colonReplacementFormat` and
`|| 'extend'` for `multiEpisodeStyle`:

| File                            | Fallback                                       | Line |
| ------------------------------- | ---------------------------------------------- | ---- |
| `new/+page.server.ts`           | `colonReplacementFormat \|\| 'smart'` (Radarr) | 94   |
| `new/+page.server.ts`           | `colonReplacementFormat \|\| 'smart'` (Sonarr) | 151  |
| `new/+page.server.ts`           | `multiEpisodeStyle \|\| 'extend'` (Sonarr)     | 153  |
| `new/+page.server.ts`           | `colonReplacementFormat \|\| 'smart'` (Lidarr) | 206  |
| `radarr/[name]/+page.server.ts` | `colonReplacementFormat \|\| 'smart'`          | 109  |
| `sonarr/[name]/+page.server.ts` | `colonReplacementFormat \|\| 'smart'`          | 122  |
| `sonarr/[name]/+page.server.ts` | `multiEpisodeStyle \|\| 'extend'`              | 124  |
| `lidarr/[name]/+page.server.ts` | `colonReplacementFormat \|\| 'smart'`          | 129  |

These fallbacks guard against empty/missing form data values during POST submission. They are
**not** about pre-populating form fields. The issue mentions replacing `|| 'delete'` fallbacks, but
actually the code uses `|| 'smart'` and `|| 'extend'` throughout. The `?? 'delete'` fallback exists
only in `colonReplacementFromDb()` (line 38 of `mediaManagement.ts`) as a default for unrecognized
integer values from the DB.

**Recommendation**: These route handler fallbacks are defensive form-data parsing guards. They could
be derived from PCD seed data instead of hardcoded, but they serve a different purpose than form
pre-population. The immediate priority is the load-function and form-component changes.

### Existing Read Functions Available

The `read.ts` file exports:

- `list(cache)` -- returns `NamingListItem[]` (all naming configs, all Arr types)
- `getRadarrByName(cache, name)` -- returns `RadarrNamingRow | null`
- `getSonarrByName(cache, name)` -- returns `SonarrNamingRow | null`
- `getLidarrByName(cache, name)` -- returns `LidarrNamingRow | null`

**Missing**: There is no "get first" or "get default" function. A new read function (or inline
query) is needed to retrieve the first row from each naming table. This could be:

- A `getFirstRadarrNaming(cache)` function
- Or an inline Kysely query in the load function:
  `db.selectFrom('radarr_naming').selectAll().limit(1).executeTakeFirst()`

## Relevant Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`:
  Load function (needs PCD cache queries) and form actions (has `|| 'smart'`/`|| 'extend'`
  fallbacks)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`:
  Passes `initialData={null}` to all forms (needs to pass PCD seed data instead)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`:
  Hardcoded `defaults` at line 36-43, `mapToFormData` at line 45-55
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`:
  Hardcoded `defaults` at line 66-78, `mapToFormData` at line 80-95
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`:
  Hardcoded `defaults` at line 35-47, `mapToFormData` at line 49-62
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`:
  Edit-mode route handler (reference pattern, has `|| 'smart'` fallback)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts`:
  Edit-mode route handler (reference pattern, has `|| 'smart'`/`|| 'extend'` fallbacks)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts`:
  Edit-mode route handler (reference pattern, has `|| 'smart'` fallback)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`:
  PCD cache read functions (needs new "get first" functions)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/constants.ts`:
  Table name constants
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/index.ts`:
  Entity exports (needs new exports)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts`:
  `colonReplacementFromDb()` with `?? 'delete'` fallback, `multiEpisodeStyleFromDb()` with
  `?? 'extend'` fallback
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/types.ts`:
  Row types (`RadarrNamingRow`, `SonarrNamingRow`, `LidarrNamingRow`) at lines 676-715
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/display.ts`:
  Re-exports Row types
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts`:
  Create functions show the input interfaces and validation
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/ops/0.rosettarr.sql`: PCD seed
  data for Radarr/Sonarr naming (line 25008-25009)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts`:
  Lidarr naming seed data
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/20260224_normalize_naming_character_replacement_defaults.ts`:
  Normalization of replace_illegal_characters and colon_replacement_format for all Arr types
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`:
  Ensures built-in base ops are present for new databases
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/+layout.server.ts`:
  Parent layout providing `currentDatabase` and `canWriteToBase`

## Architectural Patterns

- **PCD Cache Query Pattern**: Read functions in `naming/read.ts` use `cache.kb` (Kysely query
  builder) to select from PCD cache tables. They convert raw integer values to semantic types (e.g.,
  `colonReplacementFromDb(row.colon_replacement_format)`). New "get first/default" functions should
  follow this exact pattern.
- **Server Load -> Page Data -> Component Prop Flow**: The `+page.server.ts` load function returns
  data, `+page.svelte` receives it as `data: PageData`, and passes properties to form components.
  The edit-mode pages demonstrate the pattern: `initialData={data.namingConfig}`.
- **Dirty Store Initialization**: `initCreate(formData)` sets all fields as the baseline for dirty
  tracking. When PCD seed data is used, the baseline will be the seed values, meaning only user
  changes from that baseline will show as dirty.
- **Name-Cleared Override**: The `mapToFormData` function maps `data.name` directly. In create mode,
  the name should be blank. The load function should clear the name field before returning, or
  `mapToFormData` should handle this.

## Edgecases

- The PCD DB names naming rows "default" initially (op 0), then renames to "Radarr"/"Sonarr" (op
  21). The "get first" query must not depend on a specific row name but should use `LIMIT 1` or
  `ORDER BY name LIMIT 1`.
- The `colonReplacementFromDb()` function (line 38 of mediaManagement.ts) uses `?? 'delete'` as its
  fallback for unknown integer values, but the form components use `'smart'` as their default. After
  the change, if PCD seed data is available, this mismatch disappears because the actual stored
  value will be used.
- Sonarr's `multi_episode_style` default in the PCD seed is `5` (`'prefixedRange'`), but the
  hardcoded form default is `'extend'` (0). Switching to PCD seed will change the user-visible
  default.
- Lidarr's hardcoded defaults exactly match the PCD seed data, so there is no behavior change for
  Lidarr create mode.
- If a user has a PCD with custom user ops that modify or delete the default naming rows, the "get
  first" query will return whatever remains (or null). This is correct behavior -- user-modified PCD
  data should be respected.
- The `LidarrNamingForm.svelte` component uses `SONARR_COLON_REPLACEMENT_OPTIONS` (not a
  Lidarr-specific variant) for its colon replacement UI options. This is an existing pattern, not
  introduced by this feature.
- The Sonarr `customColonReplacementFormat` field is an empty string in the hardcoded defaults but
  `NULL` in PCD seed data. The `mapToFormData` function handles this:
  `data.custom_colon_replacement_format || ''`.

## Success Criteria

- [ ] `new/+page.server.ts` load function queries PCD cache for default naming rows for all 3 Arr
      types
- [ ] `+page.svelte` passes PCD seed data as `initialData` to form components in create mode
- [ ] Form components use PCD seed values when `initialData` is provided, with minimal hardcoded
      fallbacks only for the null/missing-cache case
- [ ] Route handler `|| 'smart'` and `|| 'extend'` fallbacks are reviewed (these protect against
      empty form fields, not about defaults -- decision needed on whether to derive from PCD)
- [ ] Creating a new naming config via UI pre-populates fields matching PCD seed data values
- [ ] `name` field is always blank in create mode regardless of PCD seed row name
- [ ] `deno task check` passes
- [ ] `deno task test` passes
- [ ] Edit mode is unaffected

## Open Questions

1. **What row name to query?** Should the load function look for a specific well-known name (e.g.,
   "Radarr"/"Sonarr"/"Lidarr") or just take the first row (`LIMIT 1`)? Using `LIMIT 1` is more
   resilient to naming variations; using a specific name is more deterministic. The PCD DB has
   settled on "Radarr"/"Sonarr"/"Lidarr" as canonical default names after all migrations are
   applied.
2. **Should route handler fallbacks change?** The `|| 'smart'` and `|| 'extend'` fallbacks in form
   data parsing protect against empty form submissions. They could be left as-is (they are safe
   guards), or replaced with PCD-derived constants for consistency. This is a lower-priority change.
3. **Should the hardcoded `defaults` objects be removed entirely or kept as ultimate fallbacks?** If
   the PCD cache is unavailable (compilation failed, empty database), the form still needs some
   baseline. Keeping a minimal fallback is safer. Alternatively, the `mapToFormData(null)` path
   could use schema defaults (all fields empty/zero).
4. **Should the "get first" read functions live in `read.ts` or be inline in the load function?**
   Adding them to `read.ts` follows the existing pattern and makes them reusable, but they are only
   needed by the create page. Either approach is valid.
