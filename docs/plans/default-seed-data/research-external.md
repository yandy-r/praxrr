# External/Internal Dependencies Research: default-seed-data

## Executive Summary

This feature is entirely internal -- no external APIs, libraries, or third-party services are
involved. The implementation requires adding new PCD cache read functions that query default/seed
naming rows per Arr type, wiring those into the `new/+page.server.ts` load function, and passing the
result through to form components as `initialData` instead of `null`. The PCD cache is guaranteed to
be compiled and available before any SvelteKit request reaches the server (confirmed by the
`hooks.server.ts` startup sequence), making the data flow straightforward.

**Confidence**: High -- All findings are based on direct codebase inspection of current source
files.

---

## PCD Cache System

### Architecture

The PCD cache is an **in-memory SQLite database** (`Database(':memory:')`) managed per linked
database instance. Each `PCDCache` instance holds its own `@jsr/db__sqlite` `Database` handle and a
`Kysely<PCDDatabase>` query builder.

**Key files:**

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` -- `PCDCache` class
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` -- `compile()` orchestration
- `packages/praxrr-app/src/lib/server/pcd/database/registry.ts` -- Global `Map<number, PCDCache>`
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` -- `PCDManager.initialize()` and
  `getCache(id)`

**Confidence**: High

### Compilation Flow

Operations are loaded in strict layer order and executed sequentially against the in-memory DB:

1. **Schema layer** -- DDL from `packages/praxrr-schema/ops/0.schema.sql` (creates tables including
   `radarr_naming`, `sonarr_naming`, `lidarr_naming`)
2. **Base layer** (published) -- Seed data from `pcd_ops` table with `origin='base'`,
   `state='published'` (includes `0.rosettarr.sql` which INSERTs the `'default'` naming rows)
3. **Base layer** (drafts) -- Draft base ops at a higher sequence offset
4. **Tweaks layer** -- Optional file-based tweaks
5. **User layer** -- User-created ops from `pcd_ops` with `origin='user'`, `state='published'`

After compilation, the cache is registered via `setCache(databaseInstanceId, cache)`.

**Source:** `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` lines 57-81

**Confidence**: High

### Startup Timing Guarantee

The `hooks.server.ts` startup sequence ensures caches are built before any HTTP request:

```
config.init() -> db.initialize() -> runMigrations() -> logSettings.load()
  -> pcdManager.initialize() -> initializeJobs() -> auth middleware
```

`pcdManager.initialize()` (line 50 of `hooks.server.ts`) iterates all enabled database instances,
seeds built-in base ops, validates dependencies, imports base ops, and compiles each cache. Only
after this completes does the SvelteKit request handler become active.

**Source:** `packages/praxrr-app/src/hooks.server.ts` lines 49-50

**Confidence**: High

### Query Patterns

The cache exposes two query interfaces:

1. **Kysely query builder** via `cache.kb` -- Type-safe queries against `PCDDatabase` schema
2. **Raw SQL** via `cache.query<T>(sql, ...params)` and `cache.queryOne<T>(sql, ...params)`

All existing naming reads use the Kysely builder pattern:

```typescript
// Example from read.ts - getRadarrByName
const row = await db
  .selectFrom(RADARR_NAMING_TABLE)
  .selectAll()
  .where('name', '=', name)
  .executeTakeFirst();
```

**Source:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`

**Confidence**: High

---

## Seed Data: What Default Naming Rows Exist

### Radarr Seed Row (from `0.rosettarr.sql`)

The PCD base op `0.rosettarr.sql` inserts a row named `'default'`:

```sql
INSERT INTO radarr_naming (name, rename, movie_format, movie_folder_format,
  replace_illegal_characters, colon_replacement_format)
VALUES ('default', 1,
  '{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} {edition-{Edition Tags}} ...',
  '{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}',
  1, 'smart');
```

**Source:** `packages/praxrr-db/ops/0.rosettarr.sql` line 25008

> **PCD update needed**: The TRaSH Guide target format uses a dash before edition tags and different
> token ordering:
> `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}...`

**Confidence**: High

### Sonarr Seed Row (from `0.rosettarr.sql`)

Also named `'default'`, with full format strings:

```sql
INSERT INTO sonarr_naming (name, rename, standard_episode_format, daily_episode_format,
  anime_episode_format, series_folder_format, season_folder_format,
  replace_illegal_characters, colon_replacement_format,
  custom_colon_replacement_format, multi_episode_style)
VALUES ('default', 1,
  '{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} ...',
  '{Series TitleYear} - {Air-Date} - {Episode CleanTitle} ...',
  '{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - ...',
  '{Series TitleYear} {tvdb-{TvdbId}}',
  'Season {season:00}',
  1, 4, NULL, 5);
```

Note: `colon_replacement_format=4` maps to `'smart'` and `multi_episode_style=5` maps to
`'prefixedRange'` via the integer-to-string conversion functions in `mediaManagement.ts`.

**Source:** `packages/praxrr-db/ops/0.rosettarr.sql` line 25009

> **PCD updates needed for Sonarr**: Add `:90` truncation to `{Episode CleanTitle}` in all formats,
> reorder tokens (AudioCodec before VideoDynamicRangeType), fix `{TvdbId}` -> `{TVDbId}` casing in
> series folder format. Schema gap: no `specials_folder_format` column (TRaSH recommends
> `Specials`).

**Confidence**: High

### Lidarr Seed Row (from built-in base op)

Lidarr naming is seeded by a built-in base op migration (`20260217_set_lidarr_naming_defaults.ts`),
not from the PCD repository. The seed row is named `'Lidarr'`:

```sql
INSERT INTO lidarr_naming (name, rename, standard_track_format, artist_name,
  multi_disc_track_format, artist_folder_format, replace_illegal_characters,
  colon_replacement_format, custom_colon_replacement_format)
VALUES ('Lidarr', 1,
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/...',
  '{Artist Name}',
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/...',
  '{Artist Name} ({Artist MbId})',
  1, 4, NULL)
ON CONFLICT(name) DO NOTHING;
```

**Source:**
`packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts`

**Confidence**: High

### Character Replacement Normalization

A subsequent seed op (`20260224_normalize_naming_character_replacement_defaults.ts`) normalizes all
default naming rows to `replace_illegal_characters=1` and `colon_replacement_format='smart'` (or
integer `4` for Sonarr/Lidarr). This runs for rows where `lower(name) IN ('default', 'radarr')` or
`IN ('default', 'sonarr')` or `IN ('default', 'lidarr', 'sonarr')`.

**Source:**
`packages/praxrr-app/src/lib/server/db/migrations/20260224_normalize_naming_character_replacement_defaults.ts`

**Confidence**: High

### Seed Row Name Variance

The seed row names differ by Arr type:

| Arr Type | Seed Row Name | Source                       |
| -------- | ------------- | ---------------------------- |
| Radarr   | `'default'`   | `0.rosettarr.sql` (PCD repo) |
| Sonarr   | `'default'`   | `0.rosettarr.sql` (PCD repo) |
| Lidarr   | `'Lidarr'`    | Built-in base op (migration) |

This means a "get first/default row" query cannot rely on a fixed name. The implementation should
use a query that retrieves the first row (e.g., `LIMIT 1` ordered by creation) or look for a
well-known name with fallback.

**Confidence**: High

---

## SvelteKit Data Loading Patterns

### Edit-Mode Pattern (Reference Implementation)

The edit-mode pages demonstrate the exact pattern to follow:

**1. `+page.server.ts` load function queries PCD cache:**

```typescript
// radarr/[name]/+page.server.ts
export const load: PageServerLoad = async ({ params, parent }) => {
  const cache = pcdManager.getCache(currentDatabaseId);
  const namingConfig = await getRadarrByName(cache, decodedName);
  const parentData = await parent();
  return {
    namingConfig,
    canWriteToBase: parentData.canWriteToBase,
  };
};
```

**2. `+page.svelte` passes data to form component:**

```svelte
<RadarrNamingForm
  mode="edit"
  databaseName={data.currentDatabase.name}
  canWriteToBase={data.canWriteToBase}
  actionUrl="?/update"
  initialData={data.namingConfig}
/>
```

**3. Form component uses `mapToFormData()` to transform DB row to form state:**

```typescript
function mapToFormData(data: RadarrNamingRow | null): RadarrNamingFormData {
  if (!data) return defaults;
  return {
    name: data.name,
    rename: data.rename,
    movieFormat: data.movie_format,
    // ...
  };
}
```

**Source files:**

- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.svelte`

**Confidence**: High

### Create-Mode Current State (What Needs to Change)

**Current `new/+page.server.ts` load function** returns only `canWriteToBase`:

```typescript
export const load: ServerLoad = async ({ parent }) => {
  const parentData = await parent();
  return {
    canWriteToBase: parentData.canWriteToBase,
  };
};
```

**Current `new/+page.svelte`** passes `initialData={null}` to all forms:

```svelte
<RadarrNamingForm mode="create" ... initialData={null} />
<SonarrNamingForm ... initialData={null} />
<LidarrNamingForm mode="create" ... initialData={null} />
```

When `initialData` is `null`, `mapToFormData` falls through to hardcoded `defaults` objects defined
in each form component.

**Source files:**

- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`

**Confidence**: High

### Parent Layout Data

The parent layout at `media-management/[databaseId]/+layout.server.ts` provides:

- `databases` -- All PCD database instances
- `currentDatabase` -- The current database instance object
- `canWriteToBase` -- Whether the user can write to the base layer

The `currentDatabase.id` is the `databaseInstanceId` needed to retrieve the PCD cache.

**Source:** `packages/praxrr-app/src/routes/media-management/[databaseId]/+layout.server.ts`

**Confidence**: High

---

## Existing Patterns in the Codebase

### Hardcoded Defaults Comparison

All three form components follow the identical pattern of hardcoded defaults:

**RadarrNamingForm.svelte (lines 36-43):**

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

**SonarrNamingForm.svelte (lines 66-78):**

```typescript
const defaults: SonarrNamingFormData = {
  name: '',
  rename: true,
  standardEpisodeFormat: '{Series Title} - S{season:00}E{episode:00} - {Episode Title} ...',
  dailyEpisodeFormat: '{Series Title} - {Air-Date} - {Episode Title} ...',
  animeEpisodeFormat: '{Series Title} - S{season:00}E{episode:00} - {Episode Title} ...',
  seriesFolderFormat: '{Series Title}',
  seasonFolderFormat: 'Season {season}',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'smart',
  customColonReplacementFormat: '',
  multiEpisodeStyle: 'extend',
};
```

**LidarrNamingForm.svelte (lines 35-47):**

```typescript
const defaults: LidarrNamingFormData = {
  name: '',
  rename: true,
  standardTrackFormat: '{Artist Name} - {Album Type} - {Album Title} ...',
  artistName: '{Artist Name}',
  multiDiscTrackFormat: '{Artist Name} - {Album Type} - {Album Title} ...',
  artistFolderFormat: '{Artist Name} ({Artist MbId})',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'smart',
  customColonReplacementFormat: '',
};
```

Note the drift: The hardcoded Radarr defaults use simplified formats (`{Movie Title}`) while the
actual PCD seed data uses the full Rosettarr format
(`{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} ...`). Similarly for Sonarr. This confirms the
value of deriving defaults from PCD.

**Confidence**: High

### MediaSettings Form Pattern (Same Limitation)

The `MediaSettingsForm.svelte` follows the exact same hardcoded defaults pattern:

```typescript
const defaults: RadarrMediaSettingsRowFormData = {
  name: '',
  propersRepacks: 'doNotPrefer',
  enableMediaInfo: true,
};
```

This confirms this is a systemic pattern, not specific to naming forms. The naming feature is the
target for this PR, but the pattern could extend to other entity types later.

**Source:**
`packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`

**Confidence**: High

### Naming Read Functions (Current API)

The existing read API in
`packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts` provides:

| Function          | Signature                                           | Purpose           |
| ----------------- | --------------------------------------------------- | ----------------- |
| `list(cache)`     | `Promise<NamingListItem[]>`                         | List all naming   |
| `getRadarrByName` | `(cache, name) => Promise<RadarrNamingRow \| null>` | Get by exact name |
| `getSonarrByName` | `(cache, name) => Promise<SonarrNamingRow \| null>` | Get by exact name |
| `getLidarrByName` | `(cache, name) => Promise<LidarrNamingRow \| null>` | Get by exact name |

**Missing:** There are no `getFirst*` or `getDefault*` functions. New query functions will be needed
to retrieve seed/default rows without knowing the exact name.

**Confidence**: High

### Naming Table Constants

Defined in `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/constants.ts`:

```typescript
export const RADARR_NAMING_TABLE = 'radarr_naming' as const;
export const LIDARR_NAMING_TABLE = 'lidarr_naming' as const;
export const SONARR_NAMING_TABLE = 'sonarr_naming' as const;
```

**Confidence**: High

### Row Type Definitions

Defined in `packages/praxrr-app/src/lib/shared/pcd/types.ts`:

- `RadarrNamingRow` -- `name`, `rename`, `movie_format`, `movie_folder_format`,
  `replace_illegal_characters`, `colon_replacement_format`, `created_at`, `updated_at`
- `SonarrNamingRow` -- `name`, `rename`, `standard_episode_format`, `daily_episode_format`,
  `anime_episode_format`, `series_folder_format`, `season_folder_format`,
  `replace_illegal_characters`, `colon_replacement_format`, `custom_colon_replacement_format`,
  `multi_episode_style`, `created_at`, `updated_at`
- `LidarrNamingRow` -- `name`, `rename`, `standard_track_format`, `artist_name`,
  `multi_disc_track_format`, `artist_folder_format`, `replace_illegal_characters`,
  `colon_replacement_format`, `custom_colon_replacement_format`, `created_at`, `updated_at`

These are re-exported from `packages/praxrr-app/src/lib/shared/pcd/display.ts`.

**Confidence**: High

---

## Constraints and Gotchas

### 1. Seed Row Name Inconsistency

**Constraint:** Radarr and Sonarr seed rows are named `'default'`, but Lidarr's is named `'Lidarr'`.
A query for seed data cannot use a hardcoded name.

**Impact:** The "get default" query must use a strategy like `LIMIT 1` ordered by `created_at ASC`
(oldest row = seed), or check for well-known names (`'default'`, the Arr type name) with fallback.

**Recommended approach:** Query for the first row ordered by `created_at ASC` with `LIMIT 1`. This
naturally returns the seed row since it is inserted during base op compilation before any user rows.

**Confidence**: High

### 2. Empty PCD Cache (Fresh Database Without Seed Data)

**Constraint:** If no PCD database is linked yet, or if the linked PCD has no naming seed data, the
query will return `null`.

**Impact:** The form components already handle `initialData={null}` by falling through to hardcoded
defaults. The hardcoded `defaults` objects should remain as ultimate fallbacks, ensuring the form
always renders with valid initial state.

**Workaround:** Keep the existing `defaults` const in each form. The `mapToFormData` function
already returns `defaults` when `data` is `null`. No change needed in form components themselves.

**Confidence**: High

### 3. Name Field Must Be Empty for Create Mode

**Constraint:** When pre-populating from seed data, the `name` field must remain empty (or blank)
for create mode. The seed row's name (`'default'`) should not carry over, since the user must
provide a unique name.

**Impact:** The load function or `mapToFormData` needs to strip/blank the `name` field from the seed
data before passing it as `initialData`.

**Recommended approach:** In the `+page.server.ts` load function, set `name: ''` on the returned row
before sending to the client. Alternatively, handle it in the form's `mapToFormData`.

**Confidence**: High

### 4. Sonarr/Lidarr Integer-to-String Conversion

**Constraint:** The raw PCD cache stores `colon_replacement_format` and `multi_episode_style` as
integers for Sonarr and Lidarr tables. The existing `getByName` read functions handle this
conversion using `colonReplacementFromDb()` and `multiEpisodeStyleFromDb()`.

**Impact:** Any new "getDefault" query function must also apply these conversions, consistent with
the existing `getByName` pattern. The existing conversion functions in
`$shared/pcd/mediaManagement.ts` handle this.

**Confidence**: High

### 5. PCD Cache Always Available for Active Routes

**Constraint:** The `new/+page.server.ts` already validates cache availability for the POST action.
The load function should do the same.

**Impact:** The load function needs to get the cache via `pcdManager.getCache(currentDatabaseId)`.
If the cache is not available (unlikely given the startup guarantee, but defensive), return `null`
for default data so forms fall back to hardcoded defaults.

**Confidence**: High

### 6. Create-Mode Form Already Receives `initialData` Prop

**Constraint:** Each form component (`RadarrNamingForm`, `SonarrNamingForm`, `LidarrNamingForm`)
already accepts an `initialData` prop of the appropriate Row type or `null`. The `mapToFormData`
function already transforms this into form state.

**Impact:** No changes needed to the form component interface. Just pass the seed row (with blanked
`name`) as `initialData` instead of `null`.

**Confidence**: High

---

## Implementation Approach

### Step 1: Add "Get First/Default" Read Functions

Add to `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`:

```typescript
export async function getRadarrDefault(cache: PCDCache): Promise<RadarrNamingRow | null> {
  const db = cache.kb;
  const row = await db
    .selectFrom(RADARR_NAMING_TABLE)
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    name: '', // Blank for create mode
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

Repeat for Sonarr and Lidarr with their respective field mappings and conversions.

### Step 2: Update `new/+page.server.ts` Load Function

Query all three default rows and pass them down:

```typescript
export const load: ServerLoad = async ({ params, parent }) => {
  const parentData = await parent();
  const databaseId = parseInt(params.databaseId!, 10);
  const cache = pcdManager.getCache(databaseId);

  let radarrDefaults = null;
  let sonarrDefaults = null;
  let lidarrDefaults = null;

  if (cache) {
    [radarrDefaults, sonarrDefaults, lidarrDefaults] = await Promise.all([
      getRadarrDefault(cache),
      getSonarrDefault(cache),
      getLidarrDefault(cache),
    ]);
  }

  return {
    canWriteToBase: parentData.canWriteToBase,
    radarrDefaults,
    sonarrDefaults,
    lidarrDefaults,
  };
};
```

### Step 3: Update `new/+page.svelte`

Pass the appropriate defaults to each form:

```svelte
<RadarrNamingForm mode="create" ... initialData={data.radarrDefaults} />
<SonarrNamingForm ... initialData={data.sonarrDefaults} />
<LidarrNamingForm mode="create" ... initialData={data.lidarrDefaults} />
```

### Step 4: Keep Hardcoded Fallbacks

The `defaults` const in each form component stays as-is. If PCD seed data is not available
(`initialData` is `null`), the form falls back to the existing hardcoded defaults via the
`mapToFormData` function. Zero behavioral regression.

---

## Search Queries Executed

All findings are from direct codebase inspection (file reads, grep searches, glob patterns). No
external web searches were needed for this internal architecture research.

**Files examined (key subset):**

- `packages/praxrr-app/src/hooks.server.ts` -- Startup sequence
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` -- PCDCache class
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` -- Compilation flow
- `packages/praxrr-app/src/lib/server/pcd/database/registry.ts` -- Cache registry
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` -- PCDManager lifecycle
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` -- Op loading order
- `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` -- Built-in base ops
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts` -- Read queries
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts` -- Create ops
- `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/constants.ts` -- Table
  names
- `packages/praxrr-app/src/lib/shared/pcd/types.ts` -- Row type definitions
- `packages/praxrr-app/src/lib/shared/pcd/display.ts` -- Display type re-exports
- `packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts` -- Value conversion functions
- `packages/praxrr-app/src/routes/media-management/[databaseId]/+layout.server.ts` -- Parent layout
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts` --
  Create page load
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte` -- Create
  page view
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`
  -- Edit load
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.svelte`
  -- Edit view
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`
- `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`
- `packages/praxrr-db/ops/0.rosettarr.sql` -- PCD seed data
- `packages/praxrr-schema/ops/0.schema.sql` -- Table DDL
- `packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260224_normalize_naming_character_replacement_defaults.ts`

---

## Uncertainties and Gaps

### 1. "Default" Row Selection Strategy

**Uncertainty:** Should the implementation pick the first row by `created_at` (oldest = seed), or
look for a well-known name like `'default'`? The Radarr/Sonarr seed uses `'default'`, Lidarr uses
`'Lidarr'`. Using `ORDER BY created_at ASC LIMIT 1` is simplest and most resilient to PCD
variations, but a name-based lookup could be more explicit.

**Recommendation:** Use `ORDER BY created_at ASC LIMIT 1`. This works regardless of seed row naming
conventions and naturally picks the earliest (seed) row.

### 2. User-Modified Seed Rows

**Uncertainty:** If a user modifies the seed row's field values via a user op, the "default" query
will return the modified values. Is this desirable? The user might expect create-mode defaults to
match the original PCD-published values, not their custom overrides.

**Assessment:** This is likely desirable behavior -- the user's PCD represents their preferred
configuration, so create-mode defaults should reflect their current PCD state (base + user overrides
applied). If original base-only values are needed, a separate query filtering to base layer would be
required, which is significantly more complex and likely not worth the effort.

### 3. Multiple Named Rows

**Uncertainty:** The PCD could contain multiple naming rows (e.g., `'default'` and `'4k'`). The "get
first" strategy picks one deterministically but ignores others. This is fine for initial defaults
but may not cover all use cases.

**Assessment:** Acceptable for this feature. Users can always clone from an existing config via the
edit-mode flow if they want to base a new config on a non-default row.

### 4. Scope for Other Entity Types

**Uncertainty:** Media settings and quality definitions forms have the same hardcoded defaults
pattern. Should they be addressed in this PR or deferred?

**Recommendation:** Defer to a follow-up. The naming forms are the stated scope of issue #71. The
pattern established here can be replicated for other entity types later.
