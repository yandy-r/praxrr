# Code Analysis: lidarr-first-class-defaults

## Executive Summary

The praxrr-db codebase is a pure SQL seed repository with 55 ordered operation files in `ops/`. All
entity creation follows a strict dependency chain. The new Lidarr first-class defaults feature fits
cleanly as new `ops/<next>.sql` files that replace v1 Lidarr files (ops/50, 51, 53, 54) and
introduce `Lidarr - ... (Praxrr)` entities using established idempotent insert patterns.

## Implementation Patterns

### Pattern: Idempotent INSERT with NOT EXISTS

**Example**: `ops/50.seed-lidarr-custom-formats.sql` lines 13-18

```sql
INSERT INTO custom_formats (name, description)
SELECT 'AAC', 'Matches ...'
WHERE NOT EXISTS (
  SELECT 1 FROM custom_formats WHERE name = 'AAC'
);
```

**Apply to**: All new `custom_formats` and `quality_profiles` inserts.

### Pattern: Triple EXISTS Guard for Score Mappings

**Example**: `ops/53.seed-lidarr-profile-format-scores.sql` lines 16-34

```sql
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr Default', 'AAC', 'lidarr', 200
WHERE EXISTS (SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr Default')
AND EXISTS (SELECT 1 FROM custom_formats cf WHERE cf.name = 'AAC')
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr Default'
    AND qpf.custom_format_name = 'AAC'
    AND qpf.arr_type = 'lidarr'
);
```

**Apply to**: All new `quality_profile_custom_formats` inserts. Change names to
`Lidarr - ... (Praxrr)`, keep `arr_type = 'lidarr'`.

### Pattern: CTE-Based Bulk Condition Insert

**Example**: `ops/54.seed-lidarr-custom-format-conditions.sql` lines 17-41

```sql
WITH aac_conditions (custom_format_name, name, type, negate, required) AS (
  VALUES
    ('AAC', 'AAC', 'release_title', 0, 1),
    ('AAC', 'Not Dolby Digital', 'release_title', 1, 1)
)
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT seed.custom_format_name, seed.name, seed.type, 'all', seed.negate, seed.required
FROM aac_conditions seed
WHERE EXISTS (SELECT 1 FROM custom_formats cf WHERE cf.name = seed.custom_format_name)
AND NOT EXISTS (
  SELECT 1 FROM custom_format_conditions existing
  WHERE existing.custom_format_name = seed.custom_format_name AND existing.name = seed.name
);
```

**Apply to**: All new `custom_format_conditions` inserts. Use new CF names and set
`arr_type = 'lidarr'`.

### Pattern: Condition-to-Pattern Linkage

**Example**: `ops/0.rosettarr.sql` lines 21996-22023

```sql
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'AAC', 'AAC', re.name
FROM regular_expressions re
WHERE re.name = 'AAC';
```

**Apply to**: Every new condition of type `release_title` must also get a `condition_patterns` row.

### Pattern: Quality Profile Full Setup Chain

A complete profile requires inserts into 5 tables: (1) `quality_profiles`, (2) `quality_groups`, (3)
`quality_group_members`, (4) `quality_profile_languages`, (5) `quality_profile_qualities`.

## Available Regex Patterns (Reusable from ops/0)

- `AAC`: `\bAAC(\b|\d)` -- line 90
- `FLAC`: `\bFLAC(\b|\d)` -- line 249
- `Opus`: `\bOPUS(\b|\d)(?!.*[ ._-](\d{3,4}p))` -- line 409
- `Dolby Digital`, `Dolby Digital +`, `DTS`, `PCM`, `TrueHD`: Used as negation patterns

## Missing Regex (Must Create If Optional CFs Added)

- No existing regex for `ALAC`, `MP3 V0`, `MP3 320` -- these would need new `regular_expressions`
  rows.

## Entity Dependency Order (Required Insertion Sequence)

1. `custom_formats`
2. `quality_profiles`
3. `custom_format_conditions`
4. `condition_patterns`
5. `quality_groups`
6. `quality_group_members`
7. `quality_profile_languages`
8. `quality_profile_custom_formats`
9. `quality_profile_qualities`

## Gotchas and Warnings

- `(Praxrr)` suffix is mandatory per `tasks/lessons.md` -- grep-verify before finalizing.
- `arr_type` for new conditions should be `'lidarr'`, not `'all'`.
- `position = 0` with `upgrade_until = 1` in `quality_profile_qualities` marks top-tier quality
  (inverse of expectation).
- **Video-codec negation conditions REMOVED (verified 2026-02-16)**: The v1 audio CF conditions
  negated video codecs (Dolby Digital, DTS, PCM, TrueHD). These have been removed for Lidarr
  first-class defaults because: (1) Lidarr's QualityParser does not detect video codecs, (2) PCM is
  a valid lossless audio format in Lidarr (WAV = Quality ID 13), (3) simpler conditions are more
  appropriate for the music domain. Use positive-match + mutual-exclusion negations only.
- **Only 4 condition types are valid for Lidarr**: `release_title`, `release_group`, `indexer_flag`,
  `size`. The praxrr consumer skips all other types via `LIDARR_SUPPORTED_CONDITION_TYPES`.
- No `lidarr_quality_definitions` table exists -- quality definitions are handled solely through
  `quality_api_mappings` in ops/52.
- **Opus has no standalone Lidarr quality label**: Lidarr does not define a dedicated `Opus`
  quality, but `QualityParser` maps Opus into OGG Vorbis Q5-Q10 tiers by bitrate. The Opus CF is
  still valid for title matching/scoring.
- **OGG Vorbis Q10 is High Quality Lossy in Lidarr**: Lidarr natively groups Q10 in High Quality
  Lossy (weight 6).
