# UX Research: default-seed-data

## Executive Summary

Form defaults for the naming config create flow should be derived from the PCD seed data "default"
row for each Arr type, with hardcoded fallbacks only when seed data is unavailable. The recommended
approach mirrors the existing `metadata-profiles/new` pattern in this codebase: the server-side
`load` function queries the PCD cache for the seed row, merges it with hardcoded fallbacks for any
missing fields, and passes the result as `initialData` to the form component. The dirty store should
treat PCD-derived defaults identically to the current hardcoded defaults -- `initCreate()` marks the
form as always-dirty since the user has not yet committed the configuration. No visual "default vs
modified" badge is needed in create mode; the existing live preview already communicates what each
format string produces.

## User Workflows

### Primary Flow: Create Naming Config

1. **Navigate**: User clicks "New" from the naming list at `/media-management/{databaseId}/naming`
   -- System routes to `/media-management/{databaseId}/naming/new`
2. **Select Arr Type**: User clicks one of the Radarr / Sonarr / Lidarr cards -- System renders the
   corresponding naming form
3. **Form Pre-population**: System displays the form with fields pre-populated from the PCD
   "default" naming row for that Arr type -- Live preview shows resolved sample output beneath each
   format field
4. **Customize**: User modifies the config name (required) and optionally adjusts format strings,
   toggles, colon replacement settings -- Live preview updates reactively; dirty tracking remains
   true (create mode)
5. **Save**: User clicks "Create" -- Form submits, server validates, writes PCD op, redirects to
   listing
6. **Feedback**: Success alert "Naming config created!" appears on the listing page

**Confidence**: High -- This flow is already implemented in the codebase; only the source of default
values changes.

### Alternative Flow: PCD Seed Data Unavailable

1. **Navigate + Select Arr Type**: Same as primary flow
2. **Fallback Activation**: System detects no "default" naming row exists in the PCD cache for the
   selected Arr type
3. **Hardcoded Defaults Applied**: Form renders with the same hardcoded defaults currently embedded
   in each form component (e.g., `{Movie Title} ({Release Year}) {Quality Full}` for Radarr)
4. **Optional Info Banner**: A subtle informational note appears below the form header: "Using
   built-in defaults. Link a database with seed data for recommended naming formats."
5. **Remainder**: User proceeds as in the primary flow -- no functional difference

**Confidence**: High -- The fallback path is the current behavior, so this degrades gracefully.

### Edge Case: Partial Seed Data

1. **Partial Row Found**: The "default" naming row exists but some fields contain empty strings or
   schema-level defaults that differ from the curated recommendation
2. **Field-Level Merge**: The server load function applies a per-field merge: if a PCD field is
   present and non-empty, use it; otherwise fall back to the hardcoded default for that specific
   field
3. **Transparency**: No special UI indicator is needed because partial data still produces a
   complete, valid form -- the user sees the merged result and customizes from there

**Confidence**: Medium -- This depends on how the PCD data is structured; the "default" rows in the
current PCD DB (`0.rosettarr.sql`) are fully populated, so partial data is unlikely but should be
handled defensively.

## Form Default Best Practices

### Pre-population Patterns

#### Server-Side Load with Fallback (Recommended)

The server `load` function queries the PCD cache for the seed row and merges with hardcoded
fallbacks before sending to the client. This is consistent with the existing `metadata-profiles/new`
page in this codebase, which derives `initialData` from PCD profiles with `fallbackSectionRows()`.

**Implementation approach:**

```typescript
// In +page.server.ts load function
const seedDefaults = await getSeedNamingDefaults(cache, arrType);
return { seedDefaults }; // null if not found, form handles fallback
```

```typescript
// In form component
const pcdDefaults = initialData ? mapToFormData(initialData) : null;
const formDefaults = pcdDefaults ?? hardcodedDefaults;
initCreate(formDefaults);
```

**Confidence**: High -- This pattern is already proven in the
`metadata-profiles/new/+page.server.ts` file (lines 195-248) where PCD data is merged with
`DEFAULT_PRIMARY_TYPES`, `DEFAULT_SECONDARY_TYPES`, and `DEFAULT_RELEASE_STATUSES`.

#### Good Defaults Pattern (Industry Standard)

The "Good Defaults" UX pattern (documented at ui-patterns.com) prescribes pre-filling form fields
with "best guesses at what the user wants." The PCD seed data represents curated,
community-validated naming conventions (based on TRaSH Guides recommendations), making it the ideal
source for defaults. The key principle: defaults should reduce cognitive load without forcing
unwanted assumptions.

**Confidence**: High -- Well-documented UX pattern; the PCD seed data represents expert curation,
not arbitrary guesses.

#### Competitive Reference: Recyclarr and Configarr

Both Recyclarr and Configarr treat naming configuration as optional overrides on top of curated
defaults. If a property is not specified in the YAML config, the tool does not sync that setting --
leaving the Arr instance's current value intact. Profilarr uses a similar "database-backed defaults"
model where configurations are stored as append-only SQL operations and synced to instances.

This validates the Praxrr approach: the PCD is the authoritative source of curated defaults, and the
UI should surface those defaults in the create flow.

**Confidence**: High -- Multiple tools in the ecosystem follow this pattern.

### Default vs Modified Indicators

In the create flow, visual indicators differentiating "default" from "modified" fields add
complexity without clear user benefit. The rationale:

- **Create mode is inherently "all new"**: The user is building a config from scratch. Every field
  is editable and equally important.
- **Live preview already communicates format meaning**: Each format field has a `NamingPreview`
  component that resolves tokens with sample data in real time. This gives immediate feedback on
  what the format produces.
- **Dirty tracking is always true in create mode**: The existing `initCreate()` function sets
  `isNewMode = true`, which makes `isDirty` always return `true`. There is no "original" state to
  compare against.

If a future requirement adds a "reset to default" per-field action, a small "revert" icon could
appear next to fields that differ from the PCD seed value. This would require storing the seed
defaults separately for comparison. This is a "Nice to Have" enhancement, not a launch requirement.

**Confidence**: Medium -- No user research validates the need for per-field default indicators in
this specific domain; the recommendation is based on complexity/value tradeoff.

### Dirty Tracking with Defaults

The current dirty store implementation already handles this correctly:

- **`initCreate(defaults)`**: Sets `isNewMode = true`, stores defaults in `currentData`, sets
  `originalSnapshot = null`. The `isDirty` derived store returns `true` whenever `isNewMode` is
  true.
- **PCD-derived defaults change nothing**: Whether the defaults object comes from hardcoded
  constants or PCD seed data, `initCreate` treats them identically. The "Name" field starts empty
  regardless (the user must provide a unique name), which means the form is correctly
  non-submittable until the user enters a name (the `isValid` check requires
  `formData.name.trim() !== ''`).
- **No new dirty logic needed**: The Save button is gated by
  `disabled={saving || !isValid || !$isDirty}`. Since `isDirty` is always true in create mode, the
  effective gate is `isValid` (name is non-empty) and `saving` (not in flight).

**Confidence**: High -- This is verified by reading the dirty store source code at
`packages/praxrr-app/src/lib/client/stores/dirty.ts`.

## Error Handling

### Error States

| Error                                   | User Message                                                     | Recovery Action                                                         |
| --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| PCD cache not available                 | "Database cache not available" (existing 500 error)              | User returns to database list, verifies database is linked and compiled |
| No "default" naming row in PCD          | No error; form uses hardcoded fallback defaults silently         | Optional info banner suggests linking a database with seed data         |
| Partial seed data (some fields empty)   | No error; empty fields fall back to hardcoded defaults per-field | User sees complete form and can modify any field                        |
| Arr type not supported in PCD           | No error; form renders with hardcoded defaults for that Arr type | Same as missing seed data                                               |
| PCD cache query throws unexpected error | Log error server-side, fall back to hardcoded defaults           | User sees form with defaults; admin can check server logs               |

### Fallback Strategy

The fallback strategy uses a three-tier approach:

1. **PCD seed row for the selected Arr type** (e.g.,
   `SELECT * FROM radarr_naming WHERE name = 'default'`)
2. **Per-field merge with hardcoded defaults** (if PCD row exists but some fields are empty or
   missing)
3. **Full hardcoded defaults** (if no PCD seed row exists at all)

This is a "silent degradation" strategy: the user always sees a complete, valid form. The only
visible difference is an optional informational banner when falling back entirely to hardcoded
defaults.

**Confidence**: High -- This follows the same defensive pattern used by `fallbackSectionRows()` in
the metadata profiles create page.

### Error UX Principles Applied

- **Fail fast on the server, degrade gracefully on the client**: If the PCD cache is truly
  unavailable, the existing 500 error handler fires before the form loads. If the seed row is simply
  missing, the form still renders with defaults.
- **Do not block the user**: Missing seed data should never prevent creating a naming config. The
  hardcoded defaults remain valid and usable.
- **Log and surface, do not alarm**: Server-side logging captures seed data lookup failures for
  debugging. The user sees at most an informational banner, not an error.

## Competitive Analysis

### Radarr/Sonarr Native Behavior

Radarr and Sonarr ship with built-in naming defaults that are displayed in the Media Management
settings page. When a user first installs Radarr:

- **Rename is OFF by default**: The naming format fields are hidden until the user enables renaming
- **Default format strings are simple**: Radarr's built-in default is
  `{Movie Title} ({Release Year}) [{Quality Full}]`, which differs from the TRaSH-recommended format
- **No external data source for defaults**: The Arr apps use compile-time constants; there is no
  concept of deriving defaults from a configuration database
- **Single naming config per instance**: Unlike Praxrr which manages multiple named configs, each
  Arr instance has exactly one naming configuration

**Key takeaway**: Praxrr improves on the native experience by offering curated, community-validated
defaults (TRaSH-derived) as the starting point, rather than the Arr apps' bare-minimum defaults.

**Confidence**: High -- Verified by Servarr Wiki documentation and TRaSH Guides.

### TRaSH Guides Naming Pattern

TRaSH Guides provides specific recommended naming schemes for each Arr type:

**Radarr recommended:**

- Movie:
  `{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} - {edition-{Edition Tags}} {[MediaInfo 3D]}{[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`
- Folder: `{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}`
- Colon replacement: Smart Replace

**Sonarr recommended:**

- Standard:
  `{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`
- Daily:
  `{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}`
- Anime:
  `{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{Mediainfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}`
- Series folder: `{Series TitleYear} {tvdb-{TVDbId}}`
- Season folder: `Season {season:00}`
- Specials folder: `Specials`
- Multi-episode style: Prefixed Range

**Lidarr recommended:**

- Standard track:
  `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}`
- Multi-disc track:
  `{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}`
- Artist folder: `{Artist Name} ({Artist MbId})`
- Colon replacement: Smart Replace

**Key takeaway**: The PCD seed data in `0.rosettarr.sql` already contains naming rows that closely
align with TRaSH recommendations. Using PCD seed data as defaults means the create form will show
community-validated formats rather than arbitrary placeholders.

**Confidence**: High -- Verified by fetching the TRaSH Guides pages directly.

### Recyclarr / Configarr / Profilarr Pattern

All three tools in the Arr configuration management ecosystem follow a "database-backed defaults
with optional override" model:

- **Recyclarr**: YAML config references named presets (e.g., `standard: default`). If a naming
  property is not specified, Recyclarr does not sync it. The `default` key maps to TRaSH-recommended
  values.
- **Configarr**: Similar YAML-driven approach with support for TRaSH Guide integration and local
  overrides. Missing properties are not synced.
- **Profilarr**: Visual dashboard for managing Radarr/Sonarr profiles from a configuration database
  (Dictionarry). Uses append-only SQL operations and community-curated defaults.

**Key takeaway**: The Praxrr PCD model is architecturally closest to Profilarr's approach (SQL-based
configuration database), and the "defaults from curated data" pattern is well-established across the
ecosystem.

**Confidence**: High -- Verified by documentation for all three tools.

### Comparison Matrix

| Feature                | Radarr/Sonarr Native   | TRaSH Guides         | Recyclarr           | Praxrr (Current)                      | Praxrr (Proposed)       |
| ---------------------- | ---------------------- | -------------------- | ------------------- | ------------------------------------- | ----------------------- |
| Default source         | Compile-time constants | Documentation        | YAML presets        | Hardcoded in form                     | PCD seed data           |
| Community-curated      | No                     | Yes (docs)           | Yes (presets)       | Partially (formats differ from TRaSH) | Yes (PCD mirrors TRaSH) |
| Fallback on missing    | N/A                    | N/A                  | Skip sync           | Always available                      | Hardcoded fallback      |
| Multiple named configs | No (1 per instance)    | N/A                  | N/A                 | Yes                                   | Yes                     |
| Per-Arr-type defaults  | N/A                    | Yes (separate pages) | Yes (separate YAML) | Yes (separate form components)        | Yes (separate PCD rows) |
| Real-time preview      | No                     | No                   | No                  | Yes (NamingPreview)                   | Yes (NamingPreview)     |

## Data Architecture: PCD Seed Row Lookup

### Current PCD Seed Data

The PCD database (`packages/praxrr-db/ops/0.rosettarr.sql`) contains seed naming rows:

**Radarr** (line 25008):

```sql
INSERT INTO radarr_naming (name, rename, movie_format, movie_folder_format,
  replace_illegal_characters, colon_replacement_format)
VALUES ('default', 1,
  '{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} {edition-{Edition Tags}} ...',
  '{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}',
  1, 'smart');
```

**Sonarr** (line 25009):

```sql
INSERT INTO sonarr_naming (name, rename, standard_episode_format, daily_episode_format,
  anime_episode_format, series_folder_format, season_folder_format,
  replace_illegal_characters, colon_replacement_format, custom_colon_replacement_format,
  multi_episode_style)
VALUES ('default', 1,
  '{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} ...',
  '{Series TitleYear} - {Air-Date} - {Episode CleanTitle} ...',
  '{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} ...',
  '{Series TitleYear} {tvdb-{TvdbId}}',
  'Season {season:00}',
  1, 4, NULL, 5);
```

**Lidarr**: Seeded via built-in base ops migration (`20260217_set_lidarr_naming_defaults.ts`),
registered in `seedBuiltInBaseOps.ts`.

### Lookup Strategy

The naming read module (`$pcd/entities/mediaManagement/naming/read.ts`) already exports
`getRadarrByName`, `getSonarrByName`, and `getLidarrByName`. The seed lookup is simply:

```typescript
const seedRow = await getRadarrByName(cache, 'default');
```

The name `'default'` is the conventional seed row name in the PCD DB. This should be defined as a
constant (e.g., `SEED_NAMING_CONFIG_NAME = 'default'`) to prevent magic strings.

**Confidence**: High -- The read functions and seed data already exist; only the wiring in the
create page's `load` function is needed.

## Recommendations

### Must Have

1. **Server-side seed lookup in `naming/new/+page.server.ts`**: Query the PCD cache for the
   "default" naming row for each Arr type and pass as `seedDefaults` to the page data. Use the
   existing `getRadarrByName`, `getSonarrByName`, `getLidarrByName` functions.

2. **Per-Arr-type seed data in page data**: The `load` function should return seed data for all
   three Arr types so that switching between Radarr/Sonarr/Lidarr cards does not require a server
   round-trip.

3. **Fallback to hardcoded defaults**: Each form component retains its hardcoded `defaults` constant
   as the fallback when `initialData` is null. The `initialData` prop (currently always `null` for
   create) will be populated from PCD seed data when available.

4. **Name field always starts empty**: Regardless of whether PCD seed data populates other fields,
   the `name` field must always start as an empty string in create mode. The user must provide a
   unique name.

5. **Seed row name constant**: Define `SEED_NAMING_CONFIG_NAME = 'default'` in the naming constants
   module to avoid magic strings.

### Should Have

6. **Informational banner for fallback state**: When PCD seed data is not available, display a
   subtle info banner below the form title: "Using built-in defaults. Your database's recommended
   naming formats will be used when available." This uses the existing `alertStore.add('info', ...)`
   or an inline banner component.

7. **Per-field merge for partial seed data**: If a seed row exists but some string fields are empty,
   merge with hardcoded defaults on a per-field basis rather than discarding the entire seed row.

8. **Consistent with existing patterns**: Follow the same architecture as
   `metadata-profiles/new/+page.server.ts` which already derives `initialData` from PCD data with
   `fallbackSectionRows()`.

### Nice to Have

9. **"Reset to defaults" action**: A button in the form that resets all fields (except name) back to
   the PCD seed values. This would require storing the seed defaults in a separate reactive
   reference for comparison.

10. **Per-field "modified" indicator**: A small visual cue next to fields that differ from the seed
    default. Only valuable if the "Reset to defaults" feature is also implemented.

11. **Seed data provenance tooltip**: A tooltip on the form header or Info modal noting that
    defaults come from the linked database's recommended configuration, with the database name.

## Open Questions

1. **Should the seed row name be configurable?** The current assumption is `'default'` as the seed
   row name. If PCDs can define multiple seed rows (e.g., "trash-recommended", "plex-optimized"),
   which one should be used as the create-mode default? Current recommendation: use `'default'` as
   the convention and revisit if the PCD schema evolves.

2. **Should switching Arr type in the create page trigger a server fetch?** The current UI allows
   switching Arr types client-side without a page navigation. If seed defaults for all three Arr
   types are loaded in the initial `load()`, no additional fetch is needed. If seed data is large or
   expensive, lazy loading per Arr type could be considered.

3. **Should the Lidarr naming form get TokenAutocomplete?** The Lidarr form currently uses plain
   `FormInput` components without `TokenAutocomplete`. This is orthogonal to the defaults feature
   but could be addressed in the same change for consistency.

4. **How should this interact with user ops overrides?** If a user has written user-layer ops that
   modify the "default" naming row, should the create form use the user-modified version or the
   base-layer version? Current recommendation: use whatever the compiled PCD cache returns (which
   includes both base and user ops), since the cache represents the user's intended state.

5. **Should PCD-derived defaults replace the hardcoded `defaults` object in each form component
   entirely?** Or should the hardcoded defaults remain as the in-component fallback and the PCD data
   be passed via `initialData`? Current recommendation: keep hardcoded defaults as the fallback and
   pass PCD data via `initialData` -- this matches the existing prop contract and requires minimal
   component changes.

## Search Queries Executed

- `Radarr naming format defaults recommended settings 2025 2026`
- `TRaSH Guides recommended naming scheme Radarr Sonarr 2025 2026`
- `form pre-population server defaults best practices UX pattern SvelteKit`
- `Recyclarr naming scheme config defaults Radarr Sonarr YAML`
- `UX best practices form defaults from external data source fallback behavior missing data`
- `"form dirty tracking" "pre-populated defaults" "clean state" UX pattern web application`
- `visual indicator "default value" form field modified changed UX design pattern`
- `Profilarr Dictionarry configuration management Radarr Sonarr naming defaults`
- `Configarr naming configuration sync Radarr Sonarr defaults template`
- `Radarr Sonarr naming config API endpoint defaults NamingConfig`

## Uncertainties and Gaps

- **Lidarr naming seed data timing**: The Lidarr naming seed is applied via built-in base ops
  (`seedBuiltInBaseOps.ts`), not via the PCD DB's `0.rosettarr.sql`. Need to verify the seed row
  name matches `'default'` and that the data is available in the cache at form load time.
- **No user research on naming config creation frequency**: It is unknown how often users create new
  naming configs vs. editing the existing "default". If creation is rare, the investment in
  sophisticated "default vs modified" indicators has diminishing returns.
- **PCD-less databases**: Some users may run Praxrr without linking any PCD database. In this
  scenario, the seed lookup returns null for all Arr types and the fallback to hardcoded defaults
  activates universally. This is functionally identical to today's behavior.

## Sources

- [TRaSH Guides - Radarr Recommended Naming Scheme](https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/)
- [TRaSH Guides - Sonarr Recommended Naming Scheme](https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/)
- [Recyclarr - Media Naming Configuration Reference](https://recyclarr.dev/wiki/yaml/config-reference/media-naming/)
- [Profilarr - Configuration Management Platform](https://github.com/Dictionarry-Hub/profilarr)
- [Configarr - Configuration File Documentation](https://configarr.de/docs/configuration/config-file/)
- [Servarr Wiki - Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [UI Patterns - Good Defaults](https://ui-patterns.com/patterns/GoodDefaults)
- [NN/g - Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)
- [SvelteKit - Form Actions Documentation](https://svelte.dev/docs/kit/form-actions)
- [Baymard Institute - Inline Form Validation](https://baymard.com/blog/inline-form-validation)
