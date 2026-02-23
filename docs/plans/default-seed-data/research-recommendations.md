# Recommendations: default-seed-data

## Executive Summary

Three naming form components and one media-settings form component contain hardcoded defaults that
diverge significantly from the actual PCD seed data. The Radarr and Sonarr form defaults use
simplified format strings while the PCD seed uses comprehensive TRaSH-style patterns with clean
titles, custom formats, media info tokens, and release groups. The recommended approach is to load
the "default" naming row from PCD cache in the `new/+page.server.ts` load function and pass it as
`initialData`, with a shared `getNamingDefaults(cache, arrType)` utility that falls back to minimal
hardcoded values only when PCD seed data is missing. Four additional `|| 'fallback'` patterns in
route handlers should also derive from PCD seed data.

## Implementation Recommendations

### Recommended Approach

**Load seed defaults server-side in the `new/+page.server.ts` load function.** The PCD cache is
guaranteed to be available at load time because `pcdManager.initialize()` runs during server startup
(in `hooks.server.ts`, line 50) before any route handlers execute. The existing edit-mode routes
already demonstrate this pattern -- they call `getRadarrByName(cache, name)` /
`getSonarrByName(cache, name)` / `getLidarrByName(cache, name)`.

The new `+page.server.ts` load function should:

1. Get the PCD cache for the current database ID (already available via parent layout data)
2. Query for the default naming row per Arr type using a shared lookup utility
3. Return the seed data alongside `canWriteToBase` so the page can pass it as `initialData`

Since the `new/+page.svelte` uses a client-side Arr type selector (user picks Radarr/Sonarr/Lidarr
before rendering the form), the load function should return defaults for **all three Arr types** so
the form can be populated immediately without a round-trip when the user selects an Arr type.

**Key architectural decision:** The `new/+page.svelte` currently passes `initialData={null}` to each
form. Instead, it should pass the loaded seed data. The form's `mapToFormData(data)` function
already handles mapping from Row types to form data -- only the `name` field should be cleared to
empty string for create mode.

### Fallback Strategy

```
PCD seed "default" row -> PCD seed "Lidarr"/"Radarr"/"Sonarr" named row -> minimal hardcoded fallback
```

**Tier 1 - PCD seed lookup:** Query PCD cache for rows matching well-known seed names. For Radarr:
`'default'`. For Sonarr: `'default'`. For Lidarr: `'Lidarr'` (set by migration
`20260217_set_lidarr_naming_defaults.ts`). The lookup should try multiple candidate names since PCD
ops can rename the default row.

**Tier 2 - First-row fallback:** If no well-known name is found, take the first row from the naming
table for that Arr type. This handles cases where the user renamed the default.

**Tier 3 - Minimal hardcoded:** If the PCD has zero rows for that Arr type, fall back to a minimal
hardcoded defaults object. This object should match the schema's DEFAULT column values, not the rich
PCD seed formats.

**Important:** The `name` field must always be empty string in create mode regardless of which tier
provides defaults.

### Shared Utility Recommendation

Create a shared utility in `$pcd/entities/mediaManagement/naming/defaults.ts`:

```typescript
// Exports:
getNamingDefaults(cache: PCDCache): Promise<NamingDefaults>

interface NamingDefaults {
  radarr: RadarrNamingRow | null;
  sonarr: SonarrNamingRow | null;
  lidarr: LidarrNamingRow | null;
}
```

This utility:

- Queries all three naming tables for well-known default names
- Applies the `colonReplacementFromDb()` / `multiEpisodeStyleFromDb()` conversions (already done in
  `read.ts`)
- Returns null per Arr type when no seed data exists
- Can be reused by other features (sync preview, import, etc.)

The well-known name constants should go in `$pcd/entities/mediaManagement/naming/constants.ts`
alongside existing table name constants:

```typescript
export const RADARR_DEFAULT_NAMING_NAMES = ['default', 'radarr'] as const;
export const SONARR_DEFAULT_NAMING_NAMES = ['default', 'sonarr'] as const;
export const LIDARR_DEFAULT_NAMING_NAMES = ['lidarr', 'default'] as const;
```

### colonReplacementFromDb() Consistency

The `colonReplacementFromDb()` pattern is already consistently applied in `read.ts` for both Sonarr
(line 89) and Lidarr (line 112), where DB integer values are mapped to string enums. Radarr stores
strings directly so no conversion is needed (line 67). The shared utility should delegate to
existing read functions (`getRadarrByName`, `getSonarrByName`, `getLidarrByName`) which already
handle this correctly. No additional work needed for this pattern.

## Gap Analysis (Target Defaults vs Form Defaults)

### RadarrNamingForm Defaults vs Target (TRaSH Guide)

Target movie format (TRaSH Guide):
`{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`

| Form Field                 | Hardcoded Default                                 | Target Value (TRaSH Guide)                                                                                                                                                                                                                                         | Status                                      |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `name`                     | `''`                                              | `'default'`                                                                                                                                                                                                                                                        | OK (should always be empty for create mode) |
| `rename`                   | `true`                                            | `true`                                                                                                                                                                                                                                                             | Match                                       |
| `movieFormat`              | `'{Movie Title} ({Release Year}) {Quality Full}'` | `'{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}'` | **MAJOR MISMATCH**                          |
| `movieFolderFormat`        | `'{Movie Title} ({Release Year})'`                | `'{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}'`                                                                                                                                                                                                            | **MISMATCH**                                |
| `replaceIllegalCharacters` | `true`                                            | `true`                                                                                                                                                                                                                                                             | Match                                       |
| `colonReplacementFormat`   | `'smart'`                                         | `'smart'`                                                                                                                                                                                                                                                          | Match                                       |

**Summary:** Radarr has 2 fields with significantly different defaults. The hardcoded form defaults
use simplified placeholder-like formats, while the target uses comprehensive TRaSH-quality patterns
with clean titles, TMDB IDs, edition tags (with dash separator), custom formats, media info, and
release groups.

### SonarrNamingForm Defaults vs Target (TRaSH Guide)

Target standard episode format (TRaSH Guide):
`{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`

| Form Field                     | Hardcoded Default                                                               | Target Value (TRaSH Guide)                                                                                                                                                                                                                                                                                           | Status                                      |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `name`                         | `''`                                                                            | `'default'`                                                                                                                                                                                                                                                                                                          | OK (should always be empty for create mode) |
| `rename`                       | `true`                                                                          | `true`                                                                                                                                                                                                                                                                                                               | Match                                       |
| `standardEpisodeFormat`        | `'{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}'` | `'{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}'`                                                                         | **MAJOR MISMATCH**                          |
| `dailyEpisodeFormat`           | `'{Series Title} - {Air-Date} - {Episode Title} {Quality Full}'`                | `'{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}'`                                                                                        | **MAJOR MISMATCH**                          |
| `animeEpisodeFormat`           | `'{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}'` | `'{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{Mediainfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}'` | **MAJOR MISMATCH**                          |
| `seriesFolderFormat`           | `'{Series Title}'`                                                              | `'{Series TitleYear} {tvdb-{TVDbId}}'`                                                                                                                                                                                                                                                                               | **MISMATCH**                                |
| `seasonFolderFormat`           | `'Season {season}'`                                                             | `'Season {season:00}'`                                                                                                                                                                                                                                                                                               | **MISMATCH** (padding)                      |
| `specialsFolderFormat`         | N/A (not in schema)                                                             | `'Specials'`                                                                                                                                                                                                                                                                                                         | **SCHEMA GAP**                              |
| `replaceIllegalCharacters`     | `true`                                                                          | `true`                                                                                                                                                                                                                                                                                                               | Match                                       |
| `colonReplacementFormat`       | `'smart'`                                                                       | `'smart'` (DB integer `4`)                                                                                                                                                                                                                                                                                           | Match                                       |
| `customColonReplacementFormat` | `''`                                                                            | `NULL`                                                                                                                                                                                                                                                                                                               | **MINOR MISMATCH** (empty string vs null)   |
| `multiEpisodeStyle`            | `'extend'`                                                                      | `'prefixedRange'` (DB integer `5`)                                                                                                                                                                                                                                                                                   | **MISMATCH**                                |

**Summary:** Sonarr has 6 fields with mismatched defaults + 1 schema gap (`specials_folder_format`).
All format strings are simplified versions lacking clean titles, custom formats, media info, release
groups, and `:90` truncation. `multiEpisodeStyle` uses `'extend'` while target uses
`'prefixedRange'`.

> **Key difference from current PCD seed**: The TRaSH Guide target values include `:90` truncation
> on `{Episode CleanTitle}` and different token ordering (AudioCodec before VideoDynamicRangeType)
> compared to the current PCD seed data in `0.rosettarr.sql`. The PCD seed data should be updated to
> match.

### LidarrNamingForm Defaults vs Target (TRaSH Guide)

Target values from TRaSH Guide (match PCD seed from migration `20260217`):

- `standard_track_format`:
  `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}'`
- `artist_name`: `'{Artist Name}'`
- `multi_disc_track_format`:
  `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}'`
- `artist_folder_format`: `'{Artist Name} ({Artist MbId})'`
- `rename`: `true`
- `replace_illegal_characters`: `true`
- `colon_replacement_format`: `'smart'` (DB integer `4`)

| Form Field                     | Hardcoded Default                                                                                                                             | Target Value (TRaSH Guide)        | Status                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| `name`                         | `''`                                                                                                                                          | `'Lidarr'`                        | OK (should always be empty for create mode) |
| `rename`                       | `true`                                                                                                                                        | `true`                            | Match                                       |
| `standardTrackFormat`          | `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}'`             | Same                              | **Match**                                   |
| `artistName`                   | `'{Artist Name}'`                                                                                                                             | `'{Artist Name}'`                 | **Match**                                   |
| `multiDiscTrackFormat`         | `'{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}'` | Same                              | **Match**                                   |
| `artistFolderFormat`           | `'{Artist Name} ({Artist MbId})'`                                                                                                             | `'{Artist Name} ({Artist MbId})'` | **Match**                                   |
| `replaceIllegalCharacters`     | `true`                                                                                                                                        | `true`                            | Match                                       |
| `colonReplacementFormat`       | `'smart'`                                                                                                                                     | `'smart'` (DB integer `4`)        | Match                                       |
| `customColonReplacementFormat` | `''`                                                                                                                                          | `NULL`                            | **MINOR MISMATCH** (empty string vs null)   |

**Summary:** Lidarr form defaults were recently synced with PCD seed data during the `20260217`
migration. All format strings match exactly. Only minor `customColonReplacementFormat` mismatch
(empty string vs null).

### Fields Missing from PCD Seed

One Sonarr field lacks a PCD seed equivalent: `specials_folder_format` (`Specials`). This is a
Sonarr API setting recommended by TRaSH Guides but not currently represented in the `sonarr_naming`
PCD table schema. All other form fields map 1:1 to PCD table columns.

### Fields in PCD Seed Not Used by Forms

No PCD naming columns are missing from form defaults. The `created_at` and `updated_at` columns are
metadata and correctly excluded from form data.

### MediaSettingsForm (Bonus Finding)

The `MediaSettingsForm.svelte` at `/media-management/[databaseId]/media-settings/components/` also
has hardcoded defaults with `initialData={null}` pattern:

| Form Field        | Hardcoded Default | PCD Seed Value  | Status           |
| ----------------- | ----------------- | --------------- | ---------------- |
| `name`            | `''`              | `'default'`     | OK (create mode) |
| `propersRepacks`  | `'doNotPrefer'`   | `'doNotPrefer'` | Match            |
| `enableMediaInfo` | `true`            | `1` (true)      | Match            |

**Summary:** Media settings defaults actually match PCD seed data, but should still derive from PCD
for consistency and future-proofing. Note: Lidarr media settings are seeded by the `20260215`
migration, not `0.rosettarr.sql`.

## Improvement Ideas

### Other Features Using Similar Pattern

1. **MediaSettingsForm** (`media-settings/components/MediaSettingsForm.svelte`): Same
   `initialData={null}` + hardcoded `defaults` pattern. Should be refactored alongside naming forms
   for consistency. Currently defaults match PCD but this is fragile.

2. **Quality Definitions new page** (`quality-definitions/new/`): If it exists, likely has the same
   pattern. Quality definition defaults come from PCD seed data (e.g., `radarr_quality_definitions`
   with `name='default'`).

3. **Delay Profiles**: The initial PCD seed includes a default delay profile (`0.rosettarr.sql` op
   5). If there is a create form, it may have hardcoded defaults.

### Related Enhancements

1. **Server-side seed resolution should handle PCD databases without seed data.** A freshly created
   empty PCD database (no rosettarr.sql) would have zero naming rows. The utility must gracefully
   return null, and forms must render with minimal (not empty) defaults.

2. **The `|| 'smart'` and `|| 'extend'` fallbacks in route action handlers** (7 occurrences across
   `new/+page.server.ts` and three edit route handlers) could be centralized. These currently
   hardcode `'smart'` as the colon replacement fallback and `'extend'` as multi-episode style
   fallback. After this feature, these should either:
   - Derive from PCD seed data via the shared utility, or
   - Be declared as schema-level constants (matching the SQL DEFAULT values:
     `colon_replacement_format DEFAULT 'smart'` for Radarr, `DEFAULT 4` for Sonarr/Lidarr,
     `multi_episode_style DEFAULT 5` for Sonarr)

3. **The Sonarr `multi_episode_style` mismatch is particularly important.** The hardcoded default is
   `'extend'` (DB value 0) but the PCD seed uses `5` which maps to `'prefixedRange'`. This means
   users creating new Sonarr naming configs via the UI get a different multi-episode style than what
   the curated PCD database recommends.

### Potential Shared Utility Reuse

A `getNamingDefaults(cache)` utility could serve:

- The naming `new/+page.server.ts` (primary use case)
- Sync preview (showing what will change vs defaults)
- Import/export flows (resolving missing fields)
- A future "reset to defaults" button on edit pages

## Risk Assessment

### Technical Risks

| Risk                                               | Likelihood | Impact                                  | Mitigation                                                                                                                                                 |
| -------------------------------------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PCD cache not ready at load time                   | Very Low   | High (500 error)                        | Startup sequence guarantees `pcdManager.initialize()` completes before routes are served. Existing routes already depend on this.                          |
| PCD seed data has null/undefined fields            | Low        | Medium (form renders with empty inputs) | PCD schema has NOT NULL constraints on all format fields. The `read.ts` functions already handle integer->boolean and integer->enum conversions.           |
| PCD seed row name changes between versions         | Medium     | Low (falls back to Tier 2/3)            | Multi-name lookup with first-row fallback handles renamed defaults gracefully.                                                                             |
| Race condition between PCD recompile and page load | Very Low   | Medium (stale defaults)                 | PCD recompiles are synchronous within a write operation. The cache is always in a consistent state.                                                        |
| Breaking existing tests                            | Low        | Medium                                  | Only the test at `tests/base/namingTokensValidation.test.ts` references naming formats. No existing tests validate create-mode form defaults specifically. |
| Empty PCD databases (no seed ops)                  | Medium     | Low (graceful fallback)                 | Tier 3 hardcoded fallback catches this case. These should match SQL DEFAULT values from schema.                                                            |

### Integration Challenges

- **Sonarr/Lidarr integer-to-string conversion**: The `colonReplacementFromDb()` and
  `multiEpisodeStyleFromDb()` functions must be applied when reading seed data. The existing
  `read.ts` functions already do this, so the shared utility should delegate to them.
- **Lidarr naming seed comes from built-in base ops, not rosettarr.sql**: The Lidarr default naming
  row is injected by migration `20260217_set_lidarr_naming_defaults.ts` and registered in
  `seedBuiltInBaseOps.ts`. This means it exists in the PCD cache only after those ops are replayed.
  For fresh databases, `seedBuiltInBaseOps()` runs during PCD initialization, so the data will be
  present.
- **Type compatibility between Row types and form data**: The form components use camelCase
  interfaces (`movieFormat`, `standardEpisodeFormat`) while PCD rows use snake_case (`movie_format`,
  `standard_episode_format`). The existing `mapToFormData()` functions handle this mapping. The seed
  data should be passed as the Row type and let the form's existing mapping function transform it.

## Task Breakdown Preview

### Phase 1: Foundation (server-side utility)

- Create `$pcd/entities/mediaManagement/naming/defaults.ts` with `getNamingDefaults(cache)` function
- Add well-known default name constants to `constants.ts`
- Delegate to existing `getRadarrByName`, `getSonarrByName`, `getLidarrByName` read functions
- Add first-row fallback queries for each Arr type
- Write unit tests for the utility covering: seed found, renamed seed, empty database

### Phase 2: Core Implementation (wire up forms)

- Update `naming/new/+page.server.ts` load function to call `getNamingDefaults(cache)` and return
  results
- Update `naming/new/+page.svelte` to pass loaded seed data as `initialData` per Arr type
- The form components' existing `mapToFormData()` handles the rest -- no form changes needed beyond
  ensuring `name` is cleared for create mode
- Verify that each form's `mapToFormData(data)` correctly maps all fields from seed Row types

### Phase 3: Cleanup and Hardcoded Fallback Alignment

- Remove or reduce hardcoded `const defaults` objects in form components to only serve as Tier 3
  fallback (when `initialData` is null **and** no PCD seed exists)
- Align remaining hardcoded fallbacks with SQL schema DEFAULT values (not the rich PCD formats)
- Address `|| 'smart'` and `|| 'extend'` fallbacks in route handler action functions (7 occurrences)
- Optionally extend to `MediaSettingsForm` for consistency

### Phase 4: Testing and Verification

- Verify create-mode renders PCD seed formats in the form
- Verify edit-mode is unaffected (already works)
- Verify behavior with empty PCD database (no seed ops)
- Verify behavior after PCD seed row is renamed
- Run existing test suite (`deno task test`, `deno task check`)

### Parallelization Notes

- Phase 1 and Phase 2 are sequential (Phase 2 depends on the utility from Phase 1)
- Within Phase 2, all three Arr type forms can be updated in parallel
- Phase 3 cleanup can be done in parallel with Phase 4 testing
- MediaSettingsForm extension (Phase 3) is independent of naming form work

## Key Decisions Needed

- **Should seed defaults pre-populate `name` field?** Recommendation: No, keep `name` empty for
  create mode. The user should always provide a unique name. Only format strings, toggles, and enum
  selections should come from seed data.
- **Should fallback hardcoded defaults match PCD seed or schema defaults?** Recommendation: Match
  schema SQL DEFAULT values (e.g., `colon_replacement_format DEFAULT 'smart'`). The rich PCD seed
  formats should only come from PCD data, never hardcoded in form components. This keeps the form
  components schema-aware, not PCD-content-aware.
- **Should the shared utility live in `$pcd/entities/` or `$shared/pcd/`?** Recommendation:
  `$pcd/entities/mediaManagement/naming/defaults.ts` because it depends on `PCDCache` which is
  server-only. It cannot go in `$shared/` because it accesses the in-memory SQLite cache.
- **Should MediaSettingsForm be included in this feature scope?** Recommendation: Yes, for
  consistency, but it can be a fast-follow since its defaults already match PCD seed values.

## Suggested Issue Updates

Based on this gap analysis, the following updates are recommended for GitHub issue #71:

1. **Add `multiEpisodeStyle` mismatch to the issue description.** The Sonarr form defaults to
   `'extend'` while PCD seed uses `'prefixedRange'` (DB value `5`). This is a significant behavioral
   difference that should be explicitly called out.

2. **Add `customColonReplacementFormat` null vs empty string discrepancy.** Both Sonarr and Lidarr
   forms default to `''` while PCD seed stores `NULL`. The form's `mapToFormData()` already
   normalizes null to `''`, but this should be documented.

3. **Expand scope to include MediaSettingsForm.** The `MediaSettingsForm.svelte` follows the
   identical `initialData={null}` + hardcoded `defaults` pattern. While current defaults match PCD,
   it should be included for consistency.

4. **Note that Lidarr form defaults already match PCD seed.** The `20260217` migration synchronized
   these. The main value for Lidarr is removing the duplication, not fixing mismatches.

5. **Clarify the `|| 'fallback'` patterns in route handlers.** The issue mentions `|| 'delete'`
   fallbacks, but the actual code uses `|| 'smart'` for `colonReplacementFormat` and `|| 'extend'`
   for `multiEpisodeStyle`. These appear in 7 locations across 4 files, not 4 as originally stated.
   The fallbacks currently match schema defaults for colon replacement (`'smart'`) but do NOT match
   PCD seed for multi-episode style (schema default is `5`/`'prefixedRange'`, not `0`/`'extend'`).

6. **Add quantified mismatch severity.** Radarr: 2 format fields mismatched. Sonarr: 5 format
   fields + 1 enum field mismatched. Lidarr: 0 mismatches (only minor null vs empty string).

## Open Questions

- Should the well-known default name lookup be case-insensitive (using `lower(name)` like existing
  uniqueness checks)? The PCD seed uses lowercase `'default'` for Radarr/Sonarr but title-case
  `'Lidarr'` for Lidarr. Case-insensitive lookup would be more robust.
- If a PCD database has multiple naming rows but none with the expected default name, should the
  utility pick the first row alphabetically, the most recently updated, or return null? The
  first-row approach is simplest but may surprise users.
- Should there be a visual indicator in the create form that defaults came from PCD seed data (e.g.,
  a subtle "Pre-filled from database defaults" banner)?

## Relevant Files

### Primary Targets (Forms with Hardcoded Defaults)

- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/RadarrNamingForm.svelte`
  -- Hardcoded defaults at lines 36-43
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte`
  -- Hardcoded defaults at lines 66-78
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/components/LidarrNamingForm.svelte`
  -- Hardcoded defaults at lines 35-47
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte`
  -- Hardcoded defaults at lines 30-34

### Route Handlers (Fallback Patterns)

- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts` --
  Create action with `|| 'smart'` and `|| 'extend'` fallbacks
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte` -- Passes
  `initialData={null}` to all forms
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts`
  -- Edit action with `|| 'smart'` fallback
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts`
  -- Edit action with `|| 'smart'` and `|| 'extend'` fallbacks
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts`
  -- Edit action with `|| 'smart'` fallback

### PCD Seed Data Sources

- `/packages/praxrr-db/ops/0.rosettarr.sql` -- Lines 25008-25009: Radarr and Sonarr default naming
  INSERT
- `/packages/praxrr-app/src/lib/server/db/migrations/20260217_set_lidarr_naming_defaults.ts` --
  Lidarr default naming seed values
- `/packages/praxrr-app/src/lib/server/db/migrations/20260224_normalize_naming_character_replacement_defaults.ts`
  -- Normalizes character replacement to smart for all defaults

### PCD Infrastructure

- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts` -- Existing read
  functions with DB->UI type conversions
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/constants.ts` -- Table
  name constants (extend with default name constants)
- `/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts` -- Create
  input types showing expected field shapes
- `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` -- Built-in base ops seeding
  (includes Lidarr naming defaults)
- `/packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts` -- DB<->UI conversion functions for
  colon replacement and multi-episode style
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts` -- TypeScript types for naming row interfaces
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts` -- Re-exports naming row types
- `/packages/praxrr-schema/ops/0.schema.sql` -- SQL schema with column DEFAULT values (lines 371-462
  for naming tables)

### Startup and Initialization

- `/packages/praxrr-app/src/hooks.server.ts` -- Startup sequence; PCD initialization at line 50
  (before any route handlers)
- `/packages/praxrr-app/src/routes/media-management/[databaseId]/+layout.server.ts` -- Parent layout
  providing `canWriteToBase` and `currentDatabase`
