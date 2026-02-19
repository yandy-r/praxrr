# Lidarr First-Class Defaults

This document defines the **target state** for first-class Lidarr defaults: three dedicated quality
profile tiers (`Lidarr - Lossless (Praxrr)`, `Lidarr - High Quality Lossy (Praxrr)`,
`Lidarr - Lossy (Praxrr)`) with matching `Lidarr - ... (Praxrr)` custom formats and no generic-row
reuse.

As of 2026-02-16, current repository seed files (`ops/50`, `ops/51`, `ops/53`, `ops/54`) still
contain legacy generic naming (`AAC`, `FLAC`, `Opus`, `Lidarr Default`). The cleanup approach
remains to directly remove/modify source SQL files (no SQL DELETE operations) because the database
is rebuilt from scratch on Praxrr startup. All entities use name-based primary keys with global
uniqueness (`UNIQUE(name)` on `custom_formats` and `quality_profiles`), so the `Lidarr - ...` prefix
is the collision guard, while `arr_type='lidarr'` scoping is applied downstream in junction tables
like `quality_profile_custom_formats`.

## V1 Lidarr Files to Modify or Remove

The database is rebuilt fresh on each Praxrr startup -- there is no migration path or persistent
state. The cleanup strategy is to **edit/delete the source SQL files** so the old Lidarr-only data
stops being seeded entirely.

### File-Level Actions

1. **`ops/50.seed-lidarr-custom-formats.sql`** -- **DELETE the entire file**. The generic CFs
   (`AAC`, `FLAC`, `Opus`) are already created by `ops/0.rosettarr.sql` (line 765 etc.) for
   Radarr/Sonarr. The ops/50 inserts are guarded by `WHERE NOT EXISTS` and are therefore no-ops when
   ops/0 runs first. Removing this file has zero effect on Radarr/Sonarr behavior and removes the
   misleading Lidarr-specific provenance.
2. **`ops/51.seed-lidarr-quality-profiles.sql`** -- **DELETE the entire file**. The `Lidarr Default`
   profile is replaced by the three new first-class tier profiles.
3. **`ops/52.seed-lidarr-quality-definitions.sql`** -- **KEEP this file**. The
   `quality_api_mappings` for Lidarr (38 quality names) are still needed by the new first-class
   profiles.
4. **`ops/53.seed-lidarr-profile-format-scores.sql`** -- **DELETE the entire file**. The score
   mappings for `Lidarr Default` -> `AAC`/`FLAC`/`Opus` are replaced by new first-class score
   mappings.
5. **`ops/54.seed-lidarr-custom-format-conditions.sql`** -- **DELETE the entire file**. The
   conditions for generic `AAC`/`FLAC`/`Opus` are already seeded by `ops/0.rosettarr.sql` (lines
   5570-5618). Any conditions uniquely added by ops/54 that duplicated rosettarr were no-ops anyway.
   New first-class CFs get their own dedicated conditions.

### What Stays Untouched

- **`ops/0.rosettarr.sql`**: Creates the shared `AAC`, `FLAC`, `Opus` custom formats, their
  conditions, and their Radarr/Sonarr profile score assignments. These are not Lidarr-specific.
- **`ops/52.seed-lidarr-quality-definitions.sql`**: The `quality_api_mappings` for Lidarr remain
  needed.
- **`regular_expressions`** for AAC/FLAC/Opus: Shared patterns used by all arr types, created by
  ops/0.
- **`pcd.json`**: Already declares `lidarr` in `arr_types`.

## Relevant Files

- /ops/0.rosettarr.sql: ~25k line initial seed establishing all Radarr/Sonarr entities; canonical
  reference for table insertion order, naming patterns, and entity relationships
- /ops/50.seed-lidarr-custom-formats.sql: v1 Lidarr CFs (`AAC`, `FLAC`, `Opus`); these CFs are
  shared with Radarr/Sonarr via rosettarr so the CFs themselves stay, but their Lidarr-specific
  usage is removed
- /ops/51.seed-lidarr-quality-profiles.sql: v1 `Lidarr Default` quality profile; **target for
  deletion** -- the profile itself is removed
- /ops/52.seed-lidarr-quality-definitions.sql: CTE-based `quality_api_mappings` for 38 Lidarr
  qualities; these mappings are **retained** for the new first-class profiles
- /ops/53.seed-lidarr-profile-format-scores.sql: v1 score mappings `Lidarr Default` ->
  `AAC`/`FLAC`/`Opus`; **target for deletion** -- all 3 rows removed. Also serves as the pattern to
  replicate for new scores
- /ops/54.seed-lidarr-custom-format-conditions.sql: v1 conditions for `AAC`/`FLAC`/`Opus`;
  conditions that duplicate rosettarr (ops/0) are no-ops, conditions uniquely added here may need
  deletion. Also serves as the pattern to replicate for new conditions
- /ops/6.create-add-not-original-cf-to-profiles-sonarr-side.sql: Full lifecycle reference showing CF
  creation, condition wiring, and profile score assignment in one migration
- /pcd.json: Manifest already declaring `arr_types: ["radarr", "sonarr", "lidarr"]` and
  `praxrr.minimum_version: "2.1.0"`
- /docs/plans/lidarr-first-class-defaults/feature-spec.md: Canonical spec with naming convention,
  tier definitions, no-reuse rule, success criteria, and open decisions
- /docs/plans/lidarr-support/lidarr-schema-gate.md: Schema gate approving shared-table extension
  path; documents table/key contracts and hard-stop conditions
- /docs/plans/lidarr-support/lidarr-seed-inventory.md: Authoritative v1 seed inventory with
  per-entity idempotency guard specifications
- /docs/plans/lidarr-support/requirements.md: v1 immutable contract with in-scope/out-of-scope
  boundaries and release blockers
- /AGENTS.md: SQL file naming, operation headers, validation commands, commit guidelines
- /tasks/lessons.md: Naming constraint lesson -- `(Praxrr)` suffix is mandatory, grep-verify before
  finalizing

## Relevant Tables

- custom_formats: Base CF definitions; `UNIQUE(name)` only, no `arr_type` column; new
  `Lidarr - FLAC (Praxrr)` etc. go here
- quality_profiles: Profile definitions; `UNIQUE(name)` only, no `arr_type` column; new 3-tier
  profiles go here
- custom_format_conditions: Conditions per CF; `UNIQUE(custom_format_name, name)`, has `arr_type`
  column; type field determines polymorphic sub-table join
- condition_patterns: Links conditions to `regular_expressions` via
  `(custom_format_name, condition_name, regular_expression_name)`; used for `release_title` and
  `release_group` type conditions
- quality_profile_custom_formats: Score mappings; has `arr_type` column; use `arr_type='lidarr'` for
  all new score rows
- quality_groups: Profile-scoped quality groupings; composite key `(quality_profile_name, name)`;
  each new profile needs its own groups
- quality_group_members: Maps qualities into groups; depends on `quality_groups` + `qualities`
- quality_profile_qualities: Quality ranking positions per profile; `position=0` with
  `upgrade_until=1` marks highest tier
- quality_profile_languages: Language preferences per profile; existing profiles use
  `Original`/`must`; Lidarr should use `Any` (music is language-agnostic for codec matching)
- quality_api_mappings: Already populated for Lidarr (38 entries) in ops/52; bridges quality names
  to API names
- regular_expressions: Audio regex patterns (`AAC`, `FLAC`, `Opus`, etc.) already exist from ops/0;
  reuse via `condition_patterns`

## Lidarr Native Parameter Constraints (Verified 2026-02-16)

### Custom Format Specification Types (4 only)

Lidarr supports a **significantly reduced** set of custom format specification types compared to
Radarr (10) and Sonarr (8). Source: `Lidarr/src/NzbDrone.Core/CustomFormats/Specifications/`.

| Type               | Lidarr Spec Class         | Praxrr Consumer Support | Notes                                     |
| ------------------ | ------------------------- | ----------------------- | ----------------------------------------- |
| `release_title`    | ReleaseTitleSpecification | Yes                     | Regex on release title or filename        |
| `release_group`    | ReleaseGroupSpecification | Yes                     | Regex on release group name               |
| `indexer_flag`     | IndexerFlagSpecification  | Yes                     | Bitmask on indexer flags                  |
| `size`             | SizeSpecification         | Yes                     | Min/max file size in GB                   |
| `language`         | **NOT IN LIDARR**         | **Skipped**             | No LanguageSpecification in Lidarr source |
| `resolution`       | **NOT IN LIDARR**         | **Skipped**             | Video concept, irrelevant for music       |
| `source`           | **NOT IN LIDARR**         | **Skipped**             | Video concept, irrelevant for music       |
| `quality_modifier` | **NOT IN LIDARR**         | **Skipped**             | Video concept (REMUX, BRDISK)             |
| `release_type`     | **NOT IN LIDARR**         | **Skipped**             | Sonarr-only (Season Pack)                 |

The praxrr consumer enforces this restriction in `src/lib/server/sync/customFormats/transformer.ts`:

```typescript
const LIDARR_SUPPORTED_CONDITION_TYPES = new Set([
  'release_title',
  'release_group',
  'indexer_flag',
  'size',
]);
```

### Lidarr Quality Definitions (38 total, verified against Quality.cs)

| Group               | Weight | Members                                                               |
| ------------------- | ------ | --------------------------------------------------------------------- |
| Unknown             | 1      | Unknown                                                               |
| Trash Quality Lossy | 2      | MP3-8, MP3-16, MP3-24, MP3-32, MP3-40, MP3-48, MP3-56, MP3-64, MP3-80 |
| Poor Quality Lossy  | 3      | MP3-96, MP3-112, MP3-128, OGG Vorbis Q5                               |
| Low Quality Lossy   | 4      | MP3-160, MP3-192, OGG Vorbis Q6, AAC-192, WMA, MP3-224                |
| Mid Quality Lossy   | 5      | OGG Vorbis Q7, MP3-VBR-V2, MP3-256, OGG Vorbis Q8, AAC-256            |
| High Quality Lossy  | 6      | MP3-VBR-V0, AAC-VBR, MP3-320, OGG Vorbis Q9, AAC-320, OGG Vorbis Q10  |
| Lossless            | 7      | FLAC, ALAC, APE, WavPack, FLAC 24bit, ALAC 24bit                      |
| Lossless Hi-Res     | 8      | WAV                                                                   |

Note: Lidarr natively keeps OGG Vorbis Q10 in High Quality Lossy. The only intentional tiering
deviation in this plan is grouping WAV with the practical lossless tier for user simplicity.

### Opus has no standalone Lidarr quality label

Lidarr does not expose a distinct `Opus` quality definition. `QualityParser.cs` detects Opus and
maps it into OGG Vorbis Q5-Q10 qualities based on bitrate. The `Lidarr - Opus (Praxrr)` CF remains
valid and useful for release title scoring.

### Size guidance from Servarr + community usage

- Servarr's Lidarr settings page documents that quality definition size values are for the whole
  music release, not per-minute runtime.
- Community tuning guidance (Davos Lidarr Guides) commonly lowers minimum size thresholds for short
  releases while keeping default max/preferred behavior for quality tiers.

### Lidarr API Uses v1 (Not v3)

The praxrr `LidarrClient` overrides `apiVersion = 'v1'`. Radarr and Sonarr use v3. All Lidarr API
calls use `/api/v1/` endpoints.

### Video Codec Negations Are Invalid for Music

Lidarr's native `QualityParser.cs` does NOT detect video codecs (Dolby Digital, DTS, TrueHD). PCM is
a valid lossless audio format (Quality ID 13 = WAV). Do NOT include video-codec negation conditions
(Not Dolby Digital, Not DTS, Not PCM, Not TrueHD) in Lidarr-specific custom formats. These were
removed from the first-class defaults plan after verification.

### Lidarr-Unique Concepts (Out of Scope)

- **Metadata Profiles**: Control which album types (Album, EP, Single, etc.) and release statuses
  (Official, Bootleg, etc.) are tracked. Endpoint: `/api/v1/metadataprofile`. Not synced by praxrr
  in v1.
- **Naming Tokens**: Music-specific: `{Artist Name}`, `{Album Title}`, `{Track Title}`,
  `{Medium Format}`, etc.

## Relevant Patterns

**Idempotent INSERT with NOT EXISTS**: All incremental migrations guard inserts with
`WHERE NOT EXISTS (SELECT 1 FROM ... WHERE name = ...)`. See
[ops/50.seed-lidarr-custom-formats.sql](/ops/50.seed-lidarr-custom-formats.sql) lines 13-18.

**Triple EXISTS Guard for Score Mappings**: Profile-format score inserts validate BOTH parent
entities exist AND the target row does not, using
`WHERE EXISTS (profile) AND EXISTS (cf) AND NOT EXISTS (mapping)`. See
[ops/53.seed-lidarr-profile-format-scores.sql](/ops/53.seed-lidarr-profile-format-scores.sql) lines
16-34.

**CTE-Based Bulk Condition Insert**: Conditions for a CF are defined in a CTE
`WITH ... AS (VALUES ...)` then inserted with `WHERE EXISTS (cf) AND NOT EXISTS (condition)`. See
[ops/54.seed-lidarr-custom-format-conditions.sql](/ops/54.seed-lidarr-custom-format-conditions.sql).

**Operation Block Comments**: Every logical operation wrapped in
`-- --- BEGIN op <id> ( <action> <entity_type> "<entity_name>" )` / `-- --- END op <id>`. Use
`ensure` verb for idempotent inserts. See any file in [ops/](/ops/).

**Migration Header**: 5-line metadata header (`@operation: export`, `@entity: batch`, `@name`,
`@exportedAt`, `@opIds`). See
[ops/52.seed-lidarr-quality-definitions.sql](/ops/52.seed-lidarr-quality-definitions.sql) lines 1-5.

**Entity Dependency Order**: custom_formats -> quality_profiles -> custom_format_conditions ->
condition_patterns -> quality_groups -> quality_group_members -> quality_profile_languages ->
quality_profile_custom_formats -> quality_profile_qualities. See
[ops/0.rosettarr.sql](/ops/0.rosettarr.sql) section ordering.

**File Removal for Cleanup (no SQL DELETEs)**: Since the database is rebuilt from scratch on each
Praxrr startup, removing old Lidarr data means deleting the source SQL files (ops/50, 51, 53, 54) so
the rows are never inserted. No migration-style DELETE statements are needed.

**Naming Convention**: `Lidarr - <Name> (Praxrr)` for both custom formats and quality profiles. This
is a new convention not used elsewhere in the codebase. The `Lidarr -` prefix ensures global
uniqueness against existing generic names. See
[feature-spec.md](/docs/plans/lidarr-first-class-defaults/feature-spec.md).

## Relevant Docs

**/docs/plans/lidarr-first-class-defaults/feature-spec.md**: You _must_ read this when working on
tier names, naming convention, no-reuse rule, edge cases, phased rollout, and open decisions.

**/docs/plans/lidarr-support/lidarr-schema-gate.md**: You _must_ read this when working on table/key
contracts, uniqueness constraints, and hard-stop conditions for the shared-table extension path.

**/docs/plans/lidarr-support/requirements.md**: You _must_ read this when working on v1 contract
boundaries, in-scope/out-of-scope entities, and release blockers.

**/docs/plans/lidarr-support/lidarr-seed-inventory.md**: You _must_ read this when working on
existing seed entity inventory and idempotency guard specifications.

**/AGENTS.md**: You _must_ read this when working on SQL file naming, operation headers, and
validation commands.

**/tasks/lessons.md**: You _must_ read this when working on naming conventions -- the `(Praxrr)`
suffix is mandatory per a prior correction.

**/ops/53.seed-lidarr-profile-format-scores.sql**: You _must_ read this when working on
profile-format score mappings -- it is the exact pattern to replicate.

**/ops/54.seed-lidarr-custom-format-conditions.sql**: You _must_ read this when working on condition
seeding -- it is the exact pattern to replicate.
