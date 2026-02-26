# Technical Specifications: default-seed-data

## Executive Summary

Replace hardcoded form defaults in naming form components with values loaded from the PCD cache at
request time. The `new/+page.server.ts` load function will query the first naming row per Arr type
from the PCD cache and pass it to the page, which passes it to form components as `initialData`.
Form components already accept `initialData` via `mapToFormData()` and only fall back to hardcoded
`defaults` when `initialData` is `null` -- so the core plumbing already exists and the change is
primarily a server-side data loading addition plus a thin client-side wiring change.

## Architecture Design

### Current Data Flow (Create Mode)

```
+page.server.ts (load)       +page.svelte              Form Component
---------------------         -----------               ---------------
returns { canWriteToBase }    passes initialData={null}  mapToFormData(null) -> hardcoded defaults
                              for each arr type          initCreate(defaults)
```

The load function returns no naming data. The page always passes `initialData={null}` to every form
component. Each form component defines a `const defaults: XxxNamingFormData` with hardcoded values
and `mapToFormData(null)` returns that defaults object.

### Target Data Flow (Create Mode)

```
+page.server.ts (load)                +page.svelte                     Form Component
---------------------------           ----------------------           ---------------
queries PCD cache for first           passes initialData from          mapToFormData(seedData) -> PCD values
naming row per arr type               data.seedDefaults.radarr etc.    initCreate(pcdValues)
returns {                             (falls back to null if absent)   (name field always empty string)
  canWriteToBase,
  seedDefaults: {
    radarr: RadarrNamingRow | null,
    sonarr: SonarrNamingRow | null,
    lidarr: LidarrNamingRow | null,
  }
}
```

### Edit Mode Reference (Existing Pattern)

Edit-mode route handlers follow this pattern (all three Arr types are identical structurally):

1. **Load function** in `radarr/[name]/+page.server.ts`:
   - Parses `databaseId` and `name` from route params
   - Gets cache via `pcdManager.getCache(currentDatabaseId)`
   - Calls `getRadarrByName(cache, decodedName)` to load the specific row
   - Returns `{ namingConfig, canWriteToBase }`

2. **Page component** in `radarr/[name]/+page.svelte`:
   - Passes `initialData={data.namingConfig}` to `RadarrNamingForm`

3. **Form component** receives non-null `initialData`:
   - `mapToFormData(initialData)` maps PCD row columns to camelCase form fields
   - `initEdit(formData)` initializes dirty tracking in edit mode

The key insight is that `mapToFormData()` already handles the `null` vs populated case. In create
mode, the form component calls `initCreate(mapToFormData(initialData))` -- if `initialData` is a
valid `RadarrNamingRow`, it extracts all field values. The only adjustment needed is to clear the
`name` field for create mode so the user provides a new unique name.

## Data Models

### PCD Naming Row Schemas

**RadarrNamingRow** (`$shared/pcd/types.ts` line 676):

```typescript
interface RadarrNamingRow {
  name: string;
  rename: boolean;
  movie_format: string;
  movie_folder_format: string;
  replace_illegal_characters: boolean;
  colon_replacement_format:
    | 'delete'
    | 'dash'
    | 'spaceDash'
    | 'spaceDashSpace'
    | 'smart';
  created_at: string;
  updated_at: string;
}
```

**SonarrNamingRow** (`$shared/pcd/types.ts` line 687):

```typescript
interface SonarrNamingRow {
  name: string;
  rename: boolean;
  standard_episode_format: string;
  daily_episode_format: string;
  anime_episode_format: string;
  series_folder_format: string;
  season_folder_format: string;
  replace_illegal_characters: boolean;
  colon_replacement_format:
    | 'delete'
    | 'dash'
    | 'spaceDash'
    | 'spaceDashSpace'
    | 'smart'
    | 'custom';
  custom_colon_replacement_format: string | null;
  multi_episode_style:
    | 'extend'
    | 'duplicate'
    | 'repeat'
    | 'scene'
    | 'range'
    | 'prefixedRange';
  created_at: string;
  updated_at: string;
}
```

**LidarrNamingRow** (`$shared/pcd/types.ts` line 703):

```typescript
interface LidarrNamingRow {
  name: string;
  rename: boolean;
  standard_track_format: string;
  artist_name: string;
  multi_disc_track_format: string;
  artist_folder_format: string;
  replace_illegal_characters: boolean;
  colon_replacement_format:
    | 'delete'
    | 'dash'
    | 'spaceDash'
    | 'spaceDashSpace'
    | 'smart'
    | 'custom';
  custom_colon_replacement_format: string | null;
  created_at: string;
  updated_at: string;
}
```

### Form Data Models

Each form component defines a local interface and a `mapToFormData` function:

**RadarrNamingFormData** (RadarrNamingForm.svelte line 20):

```typescript
interface RadarrNamingFormData {
  name: string;
  rename: boolean;
  movieFormat: string;
  movieFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: RadarrColonReplacementFormat;
  [key: string]: unknown;
}
```

**SonarrNamingFormData** (SonarrNamingForm.svelte line 29):

```typescript
interface SonarrNamingFormData {
  name: string;
  rename: boolean;
  standardEpisodeFormat: string;
  dailyEpisodeFormat: string;
  animeEpisodeFormat: string;
  seriesFolderFormat: string;
  seasonFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: SonarrColonReplacementFormat;
  customColonReplacementFormat: string;
  multiEpisodeStyle: MultiEpisodeStyle;
  [key: string]: unknown;
}
```

**LidarrNamingFormData** (LidarrNamingForm.svelte line 16):

```typescript
interface LidarrNamingFormData {
  name: string;
  rename: boolean;
  standardTrackFormat: string;
  artistName: string;
  multiDiscTrackFormat: string;
  artistFolderFormat: string;
  replaceIllegalCharacters: boolean;
  colonReplacementFormat: LidarrNamingRow['colon_replacement_format'];
  customColonReplacementFormat: string;
  [key: string]: unknown;
}
```

### Mapping Analysis (PCD Column -> Form Field)

All three `mapToFormData()` functions already handle this mapping. The PCD row uses `snake_case`
columns; the form uses `camelCase` fields:

| PCD Column                        | Form Field                     | Notes                         |
| --------------------------------- | ------------------------------ | ----------------------------- |
| `name`                            | `name`                         | Must be empty for create      |
| `rename`                          | `rename`                       | boolean (1/0 in DB)           |
| `movie_format`                    | `movieFormat`                  | Radarr only                   |
| `movie_folder_format`             | `movieFolderFormat`            | Radarr only                   |
| `standard_episode_format`         | `standardEpisodeFormat`        | Sonarr only                   |
| `daily_episode_format`            | `dailyEpisodeFormat`           | Sonarr only                   |
| `anime_episode_format`            | `animeEpisodeFormat`           | Sonarr only                   |
| `series_folder_format`            | `seriesFolderFormat`           | Sonarr only                   |
| `season_folder_format`            | `seasonFolderFormat`           | Sonarr only                   |
| `standard_track_format`           | `standardTrackFormat`          | Lidarr only                   |
| `artist_name`                     | `artistName`                   | Lidarr only                   |
| `multi_disc_track_format`         | `multiDiscTrackFormat`         | Lidarr only                   |
| `artist_folder_format`            | `artistFolderFormat`           | Lidarr only                   |
| `replace_illegal_characters`      | `replaceIllegalCharacters`     | boolean (1/0 in DB)           |
| `colon_replacement_format`        | `colonReplacementFormat`       | int->string for Sonarr/Lidarr |
| `custom_colon_replacement_format` | `customColonReplacementFormat` | Sonarr/Lidarr only            |
| `multi_episode_style`             | `multiEpisodeStyle`            | Sonarr only (int->string)     |

## Implementation Design

### new/+page.server.ts Changes

Add PCD cache queries to the load function to fetch the first naming row per Arr type.

**Required imports** (add to existing):

```typescript
import {
  getRadarrByName,
  getSonarrByName,
  getLidarrByName,
} from '$pcd/entities/mediaManagement/naming/index.ts';
```

Note: The existing `getXxxByName` functions require a specific name. Since we need the "first row"
as a seed template, we need a new query pattern. Two approaches:

**Option A -- New `getFirst` read functions** (recommended): Add `getFirstRadarr()`,
`getFirstSonarr()`, `getFirstLidarr()` to `read.ts` that return the first row ordered by
`created_at ASC` (oldest row = original seed). This is clean and reusable.

**Option B -- Use `list()` and take first**: The existing `list()` function returns
`NamingListItem[]` which only has `name`, `arr_type`, `rename`, `updated_at` -- not the full row
data needed for form defaults. So this won't work.

**Option C -- Inline Kysely queries in load function**: Query directly using
`cache.kb.selectFrom(table).selectAll().limit(1).executeTakeFirst()`. This avoids new read.ts
functions but duplicates the column mapping logic already in read.ts.

**Recommended approach: Option A** -- Add three `getFirst` functions to read.ts that mirror the
existing `getXxxByName` functions but select the first row ordered by `created_at ASC`.

**Load function changes**:

```typescript
export const load: ServerLoad = async ({ params, parent }) => {
  const parentData = await parent();
  const { databaseId } = params;

  let seedDefaults: {
    radarr: RadarrNamingRow | null;
    sonarr: SonarrNamingRow | null;
    lidarr: LidarrNamingRow | null;
  } = { radarr: null, sonarr: null, lidarr: null };

  if (databaseId) {
    const currentDatabaseId = parseInt(databaseId, 10);
    if (!isNaN(currentDatabaseId)) {
      const cache = pcdManager.getCache(currentDatabaseId);
      if (cache) {
        const [radarr, sonarr, lidarr] = await Promise.all([
          getFirstRadarr(cache),
          getFirstSonarr(cache),
          getFirstLidarr(cache),
        ]);
        seedDefaults = { radarr, sonarr, lidarr };
      }
    }
  }

  return {
    canWriteToBase: parentData.canWriteToBase,
    seedDefaults,
  };
};
```

### new/+page.svelte Changes

Pass seed data from load to each form component. The `initialData` prop already exists on each form
component and currently receives `null`.

```svelte
{:else if selectedArrType === 'radarr'}
  <RadarrNamingForm
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    initialData={data.seedDefaults.radarr}
  />
{:else if selectedArrType === 'lidarr'}
  <LidarrNamingForm
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    initialData={data.seedDefaults.lidarr}
  />
{:else}
  <SonarrNamingForm
    arrType={selectedArrType}
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    initialData={data.seedDefaults.sonarr}
  />
{/if}
```

### Form Component Changes

Each form component's `mapToFormData` must clear the `name` field in create mode so the user
provides a new unique name. Currently, `mapToFormData` returns `data.name` from the PCD row. The
form already calls `initCreate()` vs `initEdit()` based on mode, but the `name` field still gets
populated from the seed row.

**Approach**: Modify `mapToFormData` to accept a mode parameter, or (simpler) just override the name
after mapping:

```typescript
// In each form component, change the initialization block:
if (mode === 'create') {
  const mapped = mapToFormData(initialData);
  mapped.name = ''; // Always start with empty name for create
  initCreate(mapped);
} else {
  initEdit(mapToFormData(initialData));
}
```

This is the minimal change needed. The `mapToFormData` function itself stays unchanged, and the
existing `defaults` const can remain as the ultimate fallback (when `initialData` is null,
`mapToFormData` returns `defaults` which already has `name: ''`).

**No other changes needed in form components.** The hardcoded `defaults` const stays as the fallback
for when PCD has no naming rows at all.

### Route Handler Fallback Changes (radarr/sonarr/lidarr [name] edit routes)

The issue mentions removing hardcoded fallbacks from edit-mode route handlers. After reviewing these
files, **there are no hardcoded fallbacks in edit-mode route handlers**. They all query
`getXxxByName()` and throw 404 if not found. The hardcoded fallbacks live exclusively in the form
components' `defaults` const.

The edit-mode route handlers need no changes.

## PCD Cache Query Patterns

### Existing Edit-Mode Queries

All edit-mode queries use `getXxxByName(cache, name)` which runs:

```typescript
// From read.ts (Radarr example, line 54-71)
export async function getRadarrByName(
  cache: PCDCache,
  name: string
): Promise<RadarrNamingRow | null> {
  const db = cache.kb;
  const row = await db
    .selectFrom(RADARR_NAMING_TABLE)
    .selectAll()
    .where('name', '=', name)
    .executeTakeFirst();
  if (!row) return null;
  return {
    name: row.name!,
    rename: row.rename === 1,
    movie_format: row.movie_format,
    movie_folder_format: row.movie_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format:
      row.colon_replacement_format as RadarrNamingRow['colon_replacement_format'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
```

Key patterns:

- Uses `cache.kb` (Kysely query builder against in-memory SQLite)
- Boolean columns stored as `INTEGER 0/1`, converted with `=== 1`
- Sonarr/Lidarr colon_replacement_format stored as integers, converted via
  `colonReplacementFromDb()`
- Sonarr multi_episode_style stored as integer, converted via `multiEpisodeStyleFromDb()`
- `name` is PRIMARY KEY (typed as nullable by Kysely generator, asserted with `!`)

### Required Seed Data Queries (New Functions)

Add three new functions to `read.ts`. These select the first (oldest) row from each naming table as
a seed template:

```typescript
export async function getFirstRadarr(
  cache: PCDCache
): Promise<RadarrNamingRow | null> {
  const db = cache.kb;
  const row = await db
    .selectFrom(RADARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    name: row.name!,
    rename: row.rename === 1,
    movie_format: row.movie_format,
    movie_folder_format: row.movie_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format:
      row.colon_replacement_format as RadarrNamingRow['colon_replacement_format'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getFirstSonarr(
  cache: PCDCache
): Promise<SonarrNamingRow | null> {
  const db = cache.kb;
  const row = await db
    .selectFrom(SONARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    name: row.name!,
    rename: row.rename === 1,
    standard_episode_format: row.standard_episode_format,
    daily_episode_format: row.daily_episode_format,
    anime_episode_format: row.anime_episode_format,
    series_folder_format: row.series_folder_format,
    season_folder_format: row.season_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format: colonReplacementFromDb(
      row.colon_replacement_format
    ),
    custom_colon_replacement_format: row.custom_colon_replacement_format,
    multi_episode_style: multiEpisodeStyleFromDb(row.multi_episode_style),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getFirstLidarr(
  cache: PCDCache
): Promise<LidarrNamingRow | null> {
  const db = cache.kb;
  const row = await db
    .selectFrom(LIDARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    name: row.name!,
    rename: row.rename === 1,
    standard_track_format: row.standard_track_format,
    artist_name: row.artist_name,
    multi_disc_track_format: row.multi_disc_track_format,
    artist_folder_format: row.artist_folder_format,
    replace_illegal_characters: row.replace_illegal_characters === 1,
    colon_replacement_format: colonReplacementFromDb(
      row.colon_replacement_format
    ),
    custom_colon_replacement_format: row.custom_colon_replacement_format,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } satisfies LidarrNamingRow;
}
```

These must also be exported from the naming index:

```typescript
// In index.ts
export {
  list,
  getFirstRadarr,
  getFirstSonarr,
  getFirstLidarr,
  getLidarrByName,
  getRadarrByName,
  getSonarrByName,
} from './read.ts';
```

## PCD Seed Data Reality

### What Seed Rows Exist in the Praxrr-DB PCD

The official Praxrr-DB (`packages/praxrr-db/ops/0.rosettarr.sql`) seeds these naming rows:

**Radarr** (name `'default'`, later renamed to `'Praxrr - Radarr'` by op 20):

- `movie_format`:
  `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} {edition-{Edition Tags}} {[Custom Formats]}{[Quality Full]}{[MediaInfo 3D]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[Mediainfo VideoCodec]}{-Release Group}`
- `movie_folder_format`: `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`
- `rename`: 1, `replace_illegal_characters`: 1, `colon_replacement_format`: `'smart'`

> **PCD update needed**: The TRaSH Guide target format is
> `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`
> (dash before edition, token reorder: MediaInfo 3D before Custom Formats/Quality Full).

**Sonarr** (name `'default'`, later renamed to `'Praxrr - Sonarr'` by op 20):

- `standard_episode_format`:
  `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoCodec]}{-Release Group}`
- `daily_episode_format`:
  `{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}...`
- `anime_episode_format`:
  `{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}...`
- `series_folder_format`: `{Series TitleYear} {tvdb-{TvdbId}}`
- `season_folder_format`: `Season {season:00}`
- `rename`: 1, `replace_illegal_characters`: 1, `colon_replacement_format`: 4 (smart),
  `multi_episode_style`: 5 (prefixedRange)

> **PCD updates needed for Sonarr**:
>
> - Add `:90` truncation to `{Episode CleanTitle}` in standard, daily, and anime formats (becomes
>   `{Episode CleanTitle:90}`)
> - Reorder tokens in standard/daily: AudioCodec before VideoDynamicRangeType
> - Reorder tokens in anime: AudioCodec/AudioChannels before AudioLanguages,
>   VideoCodec/VideoBitDepth reordered
> - Fix `{TvdbId}` casing to `{TVDbId}` in series folder format
> - Schema gap: Sonarr's `Specials Folder Format` (`Specials`) has no corresponding
>   `specials_folder_format` column

**Lidarr** (seeded by built-in base op `20260217_set_lidarr_naming_defaults`):

- `standard_track_format`:
  `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}`
- `artist_name`: `{Artist Name}`
- `multi_disc_track_format`:
  `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}`
- `artist_folder_format`: `{Artist Name} ({Artist MbId})`
- `rename`: 1, `replace_illegal_characters`: 1, `colon_replacement_format`: 4 (smart)

> Lidarr seed data matches TRaSH Guide target values exactly. No updates needed.

### Seed vs User Naming Rows

Seed rows come from base ops (PCD repository data + built-in base ops). They are the "canonical"
configuration. User ops can create additional naming rows or override seed row values. The
`getFirst` functions return whatever row has the earliest `created_at` timestamp after all ops are
compiled, which is the original seed row.

### Empty PCD Edge Case

If a PCD has no naming rows for a given Arr type (e.g., a fresh custom PCD with no naming ops),
`getFirst` returns null, `initialData` is null, and the form falls back to its hardcoded `defaults`
constant. This is the existing behavior today and remains the correct fallback.

## Codebase Changes

### Files to Modify

1. **`/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`**
   - Add `getFirstRadarr()`, `getFirstSonarr()`, `getFirstLidarr()` functions
   - Each mirrors the existing `getXxxByName()` but uses `orderBy('created_at', 'asc').limit(1)`
     instead of `where('name', '=', name)`

2. **`/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/index.ts`**
   - Add `getFirstRadarr`, `getFirstSonarr`, `getFirstLidarr` to the Read exports

3. **`/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`**
   - Add imports for `getFirstRadarr`, `getFirstSonarr`, `getFirstLidarr`
   - Expand load function to query PCD cache and return `seedDefaults` object
   - Add types import for `RadarrNamingRow`, `SonarrNamingRow`, `LidarrNamingRow` (already imported)

4. **`/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`**
   - Change `initialData={null}` to `initialData={data.seedDefaults.radarr}` (and sonarr/lidarr)

5. **`/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`**
   - Modify initialization block to clear `name` field when mode is `'create'` and `initialData` is
     non-null

6. **`/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`**
   - Same name-clearing change as RadarrNamingForm

7. **`/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`**
   - Same name-clearing change as LidarrNamingForm

### Files NOT Modified (Clarification)

The edit-mode route handlers (`radarr/[name]/+page.server.ts`, `sonarr/[name]/+page.server.ts`,
`lidarr/[name]/+page.server.ts`) do not need changes. They have no hardcoded fallbacks -- they query
by name and throw 404 if not found, which is correct behavior.

### Dependencies

No new external dependencies. All imports are from existing internal modules:

- `$pcd/entities/mediaManagement/naming/index.ts` (existing module, new exports)
- `$shared/pcd/display.ts` (existing types, already imported)

## Technical Decisions

### Fallback Strategy

- **Option 1: Hardcoded defaults as ultimate fallback** (recommended)
  - If PCD cache is unavailable or has no naming rows, `getFirst*()` returns null
  - Form component's `mapToFormData(null)` returns the existing hardcoded `defaults` constant
  - This means the hardcoded `defaults` const stays in each form component as a safety net
  - **Rationale**: Zero-risk degradation. The feature works exactly as today if PCD has no seed
    data.

- **Option 2: Fail/error when PCD has no seed data**
  - Rejected: Would break create-mode for empty/custom PCDs that don't ship naming defaults.

- **Option 3: Remove hardcoded defaults entirely**
  - Not recommended for this change. The `defaults` const costs nothing and provides a safety net.
  - Could be a future cleanup once PCD seed data is guaranteed across all database instances.

### Query Strategy: "First Row" Semantics

- **`ORDER BY created_at ASC LIMIT 1`**: Returns the oldest row, which is the original seed. This is
  stable even when users add additional naming configs later.
- Alternative considered: `ORDER BY ROWID ASC LIMIT 1` -- equivalent for SQLite but less
  semantically clear.
- Alternative considered: Query by well-known name like `'default'` or `'Praxrr - Radarr'` --
  rejected because PCD row names are user-mutable (they get renamed, as seen in op 20).

### Name Field Clearing

In create mode, the `name` field from the seed row must be cleared so the user provides a fresh
name. This is handled by overriding `mapped.name = ''` after `mapToFormData()` in the create-mode
initialization path, rather than modifying `mapToFormData()` itself. This keeps `mapToFormData()`
pure and avoids adding a mode parameter to it.

## Relevant Files

| Path                                                                                                            | Description                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`                      | Create-mode load + action handler (primary change)              |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`                         | Create-mode page (wires seed data to forms)                     |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`       | Radarr form (name clearing for create)                          |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`       | Sonarr form (name clearing for create)                          |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`       | Lidarr form (name clearing for create)                          |
| `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`                               | PCD cache read queries (add getFirst functions)                 |
| `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/index.ts`                              | Naming entity barrel exports (add new exports)                  |
| `/packages/praxrr-app/src/lib/shared/pcd/types.ts`                                                              | Row type definitions (reference only)                           |
| `/packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts`                                                    | Colon/multi-episode conversion utils (reference only)           |
| `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/constants.ts`                          | Table name constants (reference only)                           |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`            | Edit-mode Radarr handler (no changes needed, reference pattern) |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.svelte`               | Edit-mode page (reference pattern for initialData wiring)       |
| `/packages/praxrr-app/src/routes/media-management/[databaseId]/+layout.server.ts`                               | Layout providing parent data (canWriteToBase, databases)        |
| `/packages/praxrr-db/ops/0.rosettarr.sql`                                                                       | PCD seed data (Radarr/Sonarr naming rows at line 25008)         |
| `/packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts`                      | Lidarr naming defaults built-in base op                         |
| `/packages/praxrr-app/src/lib/server/db/migrations/20260224_normalize_naming_character_replacement_defaults.ts` | Normalizes colon replacement to smart across all naming         |

## Open Questions

1. **Should hardcoded `defaults` constants be left unchanged or updated to match current PCD seed
   values?** Currently the hardcoded defaults diverge from PCD seed data (e.g., Radarr hardcoded
   default uses `{Movie Title} ({Release Year}) {Quality Full}` but PCD uses the much more detailed
   `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} ...` format). Recommendation: Leave them
   as-is for now since they only fire when PCD has no data, and updating them is a separate concern.

2. **Should the `getFirst*` functions live in `read.ts` alongside `getXxxByName`, or in a separate
   `defaults.ts` module?** Recommendation: `read.ts` -- they follow the exact same query pattern and
   share the same column mapping logic. A separate file would duplicate the row-to-type mapping.

3. **Dirty tracking behavior**: When seed data populates a create-mode form, `initCreate()` treats
   those values as the "initial" state. The form starts as "not dirty" since no user changes have
   been made. The save button requires `$isDirty` to be true. This means the user must change at
   least one field (minimally, the name) before saving. This is correct behavior since a name is
   required anyway and starts empty.
