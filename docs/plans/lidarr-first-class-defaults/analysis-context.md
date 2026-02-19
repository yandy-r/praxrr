# Context Analysis: lidarr-first-class-defaults

## Executive Summary

Replace the single v1 `Lidarr Default` quality profile and its reused generic CFs (`AAC`, `FLAC`,
`Opus`) with three dedicated first-class tiers: `Lidarr - Lossless (Praxrr)`,
`Lidarr - High Quality Lossy (Praxrr)`, and `Lidarr - Lossy (Praxrr)`. Each tier gets its own
dedicated custom formats, conditions, condition_patterns, quality groups, quality rankings, language
preferences, and profile-format score mappings. Implementation is purely additive SQL ops files
followed by deletion of four obsolete v1 files (ops/50, 51, 53, 54). The database rebuilds from
scratch on each Praxrr startup, so "migration" means editing/deleting source SQL files, not writing
SQL DELETE statements.

## Architecture Context

- **System Structure**: `praxrr-db` is a SQL-only data package. All content lives in numbered
  `ops/*.sql` files executed sequentially. No application code, no build system, no runtime. The
  upstream schema (`yandy-r/praxrr-schema@1.0.0`) defines tables; this repo only has INSERT/UPDATE
  data.
- **Data Flow**: SQL files seed a database that Praxrr reads. Praxrr then pushes profiles/CFs to
  Lidarr via its REST API. This repo never talks to Lidarr directly.
- **Integration Points**: New SQL ops files numbered after 54 (current highest). `pcd.json` already
  declares `lidarr` in `arr_types` -- no manifest changes needed unless version gating changes.
- **Rebuild-from-scratch model**: The DB is rebuilt fresh each startup. No persistent state.
  Removing old data = deleting the source SQL file so rows stop being inserted.

## Critical Files Reference

- `ops/0.rosettarr.sql`: Canonical 25k-line seed with entity dependency order and insert patterns.
  Contains shared `AAC`/`FLAC`/`Opus` CFs + regex + conditions + condition_patterns.
- `ops/50.seed-lidarr-custom-formats.sql`: v1 Lidarr CFs -- **DELETE entire file** (no-ops since
  rosettarr creates them).
- `ops/51.seed-lidarr-quality-profiles.sql`: v1 `Lidarr Default` profile -- **DELETE entire file**.
- `ops/52.seed-lidarr-quality-definitions.sql`: Lidarr `quality_api_mappings` CTE for 38 quality
  names -- **KEEP**.
- `ops/53.seed-lidarr-profile-format-scores.sql`: v1 score mappings -- **DELETE entire file**.
  Triple-EXISTS guard pattern is the template to replicate.
- `ops/54.seed-lidarr-custom-format-conditions.sql`: v1 conditions -- **DELETE entire file**.
  CTE-based bulk insert pattern is the template to replicate.
- `ops/6.create-add-not-original-cf-to-profiles-sonarr-side.sql`: Full lifecycle reference (CF +
  conditions + scores in one migration).
- `pcd.json`: Already correct for Lidarr. No changes needed.
- `tasks/lessons.md`: Mandatory `(Praxrr)` suffix constraint.
- `docs/plans/lidarr-first-class-defaults/feature-spec.md`: Canonical spec with tier definitions,
  naming convention, no-reuse rule.

## Patterns to Follow

- **Idempotent INSERT with NOT EXISTS**: All incremental migrations guard inserts. Pattern:
  `INSERT INTO ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM ... WHERE name = ...)`. Example:
  `ops/50` lines 13-18.
- **Triple EXISTS Guard for Scores**: Profile-format score inserts validate BOTH parents exist AND
  target row does not. Example: `ops/53` lines 16-34.
- **CTE-Based Bulk Condition Insert**: Conditions defined in CTE `WITH ... AS (VALUES ...)` then
  inserted with dual guards. Example: `ops/54`.
- **Operation Block Comments**: `-- --- BEGIN op <id> ( <action> <entity_type> "<entity_name>" )` /
  `-- --- END op <id>`.
- **Migration Header**: 5-line metadata header. Example: `ops/52` lines 1-5.
- **Entity Dependency Order**: Tags -> Regular Expressions -> Custom Formats -> Quality Profiles ->
  Quality Groups -> Custom Format Conditions -> Condition Patterns -> Quality Group Members ->
  Quality Profile Languages -> Quality Profile Custom Formats -> Quality Profile Qualities.
- **Naming Convention**: `Lidarr - <Name> (Praxrr)` for CFs and quality profiles. `(Praxrr)` suffix
  is mandatory per lessons.md.

## Cross-Cutting Concerns

- **No-Reuse Rule**: New Lidarr defaults must NOT reuse existing generic CF names (`AAC`, `FLAC`,
  `Opus`). Every new entity must use `Lidarr - <Name> (Praxrr)` naming.
- **Missing Regex for Optional CFs**: Rosettarr only has regex for `AAC`, `FLAC`, and `Opus`. NO
  existing regex for `ALAC`, `MP3`, `WavPack`, `APE`. If expanded CFs are implemented, new
  `regular_expressions` rows must be created first.
- **Schema Constraint -- No `arr_type` on `custom_formats` or `quality_profiles`**: `UNIQUE(name)`
  only. The `Lidarr -` prefix is the isolation mechanism.
- **Condition Polymorphism**: `custom_format_conditions.type` determines sub-table join. For audio
  CFs: type=`release_title` -> `condition_patterns` -> `regular_expressions`. **Lidarr only supports
  4 condition types**: `release_title`, `release_group`, `indexer_flag`, `size`. The praxrr consumer
  skips all others for Lidarr instances.
- **arr_type for new conditions should be `'lidarr'`**: v1 used `'all'` for generic CFs; new
  Lidarr-specific CFs should use `'lidarr'`.

## Parallelization Opportunities

- **Independent**: CF creation, profile creation, v1 file deletion, regex creation (if needed)
- **Sequential**: CFs before conditions, conditions before condition_patterns, profiles before
  quality_groups/scores
- **Coordination point**: Entity naming must be finalized before any SQL writing begins

## Implementation Constraints

- Schema dependency: `yandy-r/praxrr-schema@1.0.0` -- cannot modify tables
- SQL only: no application code, no test framework
- Sequential file numbering: ops files execute by numeric prefix
- Idempotent inserts: all new inserts must use `NOT EXISTS` guards
- Name-based foreign keys: all references use string names
- Tier Completeness Rule: all three tiers must ship together
- `(Praxrr)` suffix is mandatory on all entity names

## Key Recommendations

- Start with minimum CF set (FLAC, AAC, Opus) -- these reuse existing regex. Defer ALAC/MP3
  expansions.
- Single new SQL file recommended: `ops/55.seed-lidarr-first-class-defaults.sql` containing all
  entities in dependency order.
- Delete ops/50, 51, 53, 54 in a dedicated commit after new seed is verified.
- Resolve open decisions before implementation: quality-to-tier assignment, score values, language
  preference, profile settings.
