# Lidarr First-Class Defaults Implementation Plan

Replace the single v1 `Lidarr Default` quality profile and its reused generic CFs (`AAC`, `FLAC`,
`Opus`) with three dedicated first-class tier profiles: `Lidarr - Lossless (Praxrr)`,
`Lidarr - High Quality Lossy (Praxrr)`, and `Lidarr - Lossy (Praxrr)`. Each tier gets its own custom
formats, conditions, condition_patterns, quality groups, quality rankings, language preferences, and
profile-format score mappings -- all using the `Lidarr - <Name> (Praxrr)` naming convention.
Implementation is purely additive SQL (one new ops file) plus deletion of four obsolete v1 files
(ops/50, 51, 53, 54), with ops/52 retained for the 38 Lidarr quality API mappings.

## Critically Relevant Files and Documentation

- ops/0.rosettarr.sql: Canonical 25k-line seed; defines entity dependency order, insert syntax
  patterns, and existing AAC/FLAC/Opus regex+CFs+conditions
- ops/50.seed-lidarr-custom-formats.sql: v1 Lidarr CFs to DELETE; idempotent INSERT pattern to
  replicate
- ops/51.seed-lidarr-quality-profiles.sql: v1 `Lidarr Default` profile to DELETE; profile insert
  pattern to replicate
- ops/52.seed-lidarr-quality-definitions.sql: Lidarr quality_api_mappings CTE (38 qualities) to
  KEEP; reference for tier membership
- ops/53.seed-lidarr-profile-format-scores.sql: v1 score mappings to DELETE; triple-EXISTS guard
  pattern to replicate exactly
- ops/54.seed-lidarr-custom-format-conditions.sql: v1 conditions to DELETE; CTE-based bulk condition
  pattern to replicate exactly
- ops/6.create-add-not-original-cf-to-profiles-sonarr-side.sql: Full lifecycle migration reference
  (CF + conditions + scores in one file)
- pcd.json: Manifest already correct (`arr_types` includes `lidarr`)
- AGENTS.md: SQL file naming, operation headers, validation commands
- tasks/lessons.md: Mandatory `(Praxrr)` suffix rule -- grep-verify before finalizing
- docs/plans/lidarr-first-class-defaults/feature-spec.md: Canonical spec with tier definitions,
  naming convention, no-reuse rule, and open decisions
- docs/plans/lidarr-first-class-defaults/shared.md: Master context with file actions, relevant
  tables, relevant patterns, and dependency order

## Implementation Plan

### Phase 1: Cleanup and Foundation

#### Task 1.1: Delete legacy v1 Lidarr seed files Depends on [none]

**READ THESE BEFORE TASK**

- docs/plans/lidarr-first-class-defaults/shared.md (V1 Lidarr Files to Modify or Remove section)
- ops/52.seed-lidarr-quality-definitions.sql (verify this is the one to KEEP)

**Instructions**

Files to Modify

- (none)

Files to Delete

- ops/50.seed-lidarr-custom-formats.sql
- ops/51.seed-lidarr-quality-profiles.sql
- ops/53.seed-lidarr-profile-format-scores.sql
- ops/54.seed-lidarr-custom-format-conditions.sql

Delete all four files via `git rm`. These files contain v1 Lidarr data that reused generic CFs and
the `Lidarr Default` profile. Since the database rebuilds from scratch on each Praxrr startup,
removing the files prevents the old data from being seeded.

**Critical**: Do NOT delete `ops/52.seed-lidarr-quality-definitions.sql` -- it contains the 38
Lidarr quality API mappings needed by the new profiles.

After deletion, verify with `ls ops/5*.sql` that only `ops/52.seed-lidarr-quality-definitions.sql`
remains in the 50-range.

#### Task 1.2: Create new Lidarr custom formats Depends on [none]

**READ THESE BEFORE TASK**

- ops/50.seed-lidarr-custom-formats.sql (idempotent INSERT pattern -- read before deleting in Task
  1.1)
- ops/0.rosettarr.sql lines 608-900 (existing CF insert patterns)
- tasks/lessons.md (`(Praxrr)` suffix requirement)
- docs/plans/lidarr-first-class-defaults/feature-spec.md (Data Models > Proposed Naming Set)

**Instructions**

Files to Create

- ops/55.seed-lidarr-first-class-defaults.sql (begin this file; other tasks will append to it)

Create the new SQL file with the standard migration header:

```sql
-- @operation: export
-- @entity: batch
-- @name: Seed Lidarr First-Class Defaults
-- @exportedAt: <ISO 8601 timestamp>
-- @opIds: 5501, 5502, 5503, 5504, 5505, 5506, 5507, 5508, 5509
```

Insert three custom formats using the idempotent NOT EXISTS pattern:

1. `Lidarr - FLAC (Praxrr)` -- description: "Matches FLAC lossless audio codec for Lidarr."
2. `Lidarr - AAC (Praxrr)` -- description: "Matches AAC lossy audio codec for Lidarr."
3. `Lidarr - Opus (Praxrr)` -- description: "Matches Opus audio codec for Lidarr."

Each insert must be wrapped in operation block comments:

```sql
-- --- BEGIN op 5501 ( ensure custom_format "Lidarr - FLAC (Praxrr)" exists )
INSERT INTO custom_formats (name, description)
SELECT 'Lidarr - FLAC (Praxrr)', 'Matches FLAC lossless audio codec for Lidarr.'
WHERE NOT EXISTS (
  SELECT 1 FROM custom_formats WHERE name = 'Lidarr - FLAC (Praxrr)'
);
-- --- END op 5501
```

Also insert `custom_format_tags` rows linking each new CF to the `Audio` tag:

```sql
INSERT INTO custom_format_tags (custom_format_name, tag_name)
SELECT cf.name, t.name
FROM custom_formats cf, tags t
WHERE cf.name = 'Lidarr - FLAC (Praxrr)' AND t.name = 'Audio'
AND NOT EXISTS (
  SELECT 1 FROM custom_format_tags
  WHERE custom_format_name = 'Lidarr - FLAC (Praxrr)' AND tag_name = 'Audio'
);
```

#### Task 1.3: Create new Lidarr quality profiles Depends on [none]

**READ THESE BEFORE TASK**

- ops/51.seed-lidarr-quality-profiles.sql (profile insert pattern -- read before deleting in Task
  1.1)
- ops/0.rosettarr.sql lines 916-922 (existing profile insert patterns)
- ops/52.seed-lidarr-quality-definitions.sql (38 Lidarr quality names for tier assignment)
- docs/plans/lidarr-first-class-defaults/feature-spec.md (Tier Mapping Intent section)

**Instructions**

Files to Modify

- ops/55.seed-lidarr-first-class-defaults.sql (append after custom formats section)

Insert three quality profiles using the idempotent NOT EXISTS pattern:

1. `Lidarr - Lossless (Praxrr)` -- targets: FLAC, ALAC, APE, WavPack, FLAC 24bit, ALAC 24bit, WAV
2. `Lidarr - High Quality Lossy (Praxrr)` -- targets: AAC-320, AAC-VBR, MP3-320, MP3-VBR-V0, OGG
   Vorbis Q9, OGG Vorbis Q10, Opus
3. `Lidarr - Lossy (Praxrr)` -- targets: AAC-192, AAC-256, MP3-192 through MP3-256, OGG Vorbis Q6-Q8

Profile column values (follow existing Radarr/Sonarr patterns unless justified otherwise):

- `upgrades_allowed`: 1
- `minimum_custom_format_score`: 0
- `upgrade_until_score`: 999999
- `upgrade_score_increment`: 1

Wrap each insert in operation block comments with unique op IDs.

Also insert `quality_profile_tags` rows linking each new profile to a `Lidarr` or `Music` tag (if
such a tag exists; create if needed).

### Phase 2: Wiring and Dependencies

#### Task 2.1: Seed custom format conditions and condition patterns Depends on [1.2]

**READ THESE BEFORE TASK**

- ops/54.seed-lidarr-custom-format-conditions.sql (CTE-based bulk condition pattern -- replicate
  this exactly)
- ops/0.rosettarr.sql lines 21996-22023 (AAC condition_patterns linkage)
- ops/0.rosettarr.sql lines 23061-23087 (FLAC condition_patterns linkage)
- ops/0.rosettarr.sql lines 23393-23399 (Opus condition_patterns linkage)
- docs/plans/lidarr-first-class-defaults/analysis-code.md (Pattern sections)

**Instructions**

Files to Modify

- ops/55.seed-lidarr-first-class-defaults.sql (append after quality profiles section)

For each of the 3 new CFs, create conditions using the CTE-based bulk insert pattern. Each CF needs:

**Lidarr - FLAC (Praxrr)** conditions:

- `FLAC` (type: release_title, negate: 0, required: 1) -- positive match
- `Not AAC` (type: release_title, negate: 1, required: 1) -- negation

**Lidarr - AAC (Praxrr)** conditions:

- `AAC` (type: release_title, negate: 0, required: 1)
- `Not FLAC` (type: release_title, negate: 1, required: 1)

**Lidarr - Opus (Praxrr)** conditions:

- `Opus` (type: release_title, negate: 0, required: 1)
- `Not OPUS Release Group` (type: release_group, negate: 1, required: 1)

**Important -- Music-specific condition design (verified 2026-02-16)**:

The v1 Lidarr conditions copied video-codec negations (Not Dolby Digital, Not DTS, Not PCM, Not
TrueHD) from the Radarr/Sonarr audio CFs in rosettarr. These have been **intentionally removed** for
the first-class Lidarr defaults because:

1. Lidarr's native `QualityParser.cs` does NOT detect video codecs (Dolby Digital, DTS, TrueHD).
   They never appear in music release titles.
2. PCM is a **valid lossless audio format** in Lidarr (Quality ID 13 = WAV). Negating PCM is
   counterproductive in a music context.
3. Lidarr only supports 4 custom format specification types: `release_title`, `release_group`,
   `indexer_flag`, and `size`. The praxrr consumer (`LIDARR_SUPPORTED_CONDITION_TYPES`) enforces
   this restriction.
4. Simpler conditions are easier to audit and less prone to false negatives.

**Critical**: Set `arr_type = 'lidarr'` for all new conditions (NOT `'all'` -- these are
Lidarr-specific CFs).

After conditions, insert `condition_patterns` rows linking each condition to existing regex
patterns:

```sql
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - FLAC (Praxrr)', 'FLAC', re.name
FROM regular_expressions re
WHERE re.name = 'FLAC'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - FLAC (Praxrr)' AND condition_name = 'FLAC'
);
```

Map each condition to its corresponding regex:

- `FLAC` condition -> `FLAC` regex
- `Not AAC` condition -> `AAC` regex
- `AAC` condition -> `AAC` regex
- `Not FLAC` condition -> `FLAC` regex
- `Opus` condition -> `Opus` regex
- `Not OPUS Release Group` condition -> `Opus (Negation)` regex

#### Task 2.2: Seed quality groups and quality group members Depends on [1.3]

**READ THESE BEFORE TASK**

- ops/0.rosettarr.sql lines 996-999 (quality_groups insert pattern)
- ops/0.rosettarr.sql lines 13192-13195 (quality_group_members insert pattern)
- ops/52.seed-lidarr-quality-definitions.sql (38 Lidarr quality names)

**Instructions**

Files to Modify

- ops/55.seed-lidarr-first-class-defaults.sql (append after conditions section)

Create quality groups for each profile. Each profile needs at least one quality group. Group naming
should be descriptive:

**Lidarr - Lossless (Praxrr)** groups:

- `Lossless` -- members: FLAC, ALAC, APE, WavPack, WAV
- `Lossless Hi-Res` -- members: FLAC 24bit, ALAC 24bit

**Lidarr - High Quality Lossy (Praxrr)** groups:

- `High Quality Lossy` -- members: AAC-320, AAC-VBR, MP3-320, MP3-VBR-V0, OGG Vorbis Q9, OGG Vorbis
  Q10

**Lidarr - Lossy (Praxrr)** groups:

- `Lossy` -- members: AAC-192, AAC-256, MP3-192, MP3-224, MP3-256, MP3-VBR-V2, OGG Vorbis Q6, OGG
  Vorbis Q7, OGG Vorbis Q8

Use idempotent inserts with NOT EXISTS guards for both quality_groups and quality_group_members.

**Note**: The exact quality names must match those in the `quality_api_mappings` CTE in ops/52.
Cross-reference carefully -- music quality names like `FLAC 24bit` and `AAC-320` are specific to
Lidarr and differ from Radarr/Sonarr quality names.

**Lidarr native grouping discrepancy (verified 2026-02-16)**:

Lidarr's native `Quality.cs` groups qualities differently from this plan:

- Lidarr puts `OGG Vorbis Q10` in **High Quality Lossy** (group weight 6), which matches this plan.
- Lidarr puts `WAV` in **Lossless Hi-Res** (group weight 8). This plan puts WAV with standard
  Lossless.
- These are intentional design choices for the Praxrr defaults, not oversights.

**Excluded qualities (intentional)**: The following 16 low-quality definitions are intentionally
excluded from all three profiles: Unknown, MP3-8 through MP3-128, MP3-160, OGG Vorbis Q5, and WMA.
No user should be downloading music at these bitrates as a default preference.

**Opus quality limitation**: Lidarr has no standalone `Opus` quality label. Opus files are mapped by
`QualityParser` into OGG Vorbis Q5-Q10 tiers based on bitrate. The `Lidarr - Opus (Praxrr)` CF
remains valid for release-title matching and scoring, but users will see Vorbis-tier quality labels
in Lidarr instead of an explicit `Opus` quality.

#### Task 2.3: Seed profile languages, CF scores, and quality rankings Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- ops/53.seed-lidarr-profile-format-scores.sql (triple-EXISTS score guard pattern -- replicate
  exactly)
- ops/0.rosettarr.sql lines 13910-13913 (quality_profile_languages pattern)
- ops/0.rosettarr.sql lines 19520-19523 (quality_profile_qualities pattern)
- docs/plans/lidarr-first-class-defaults/feature-spec.md (Tier Mapping Intent)

**Instructions**

Files to Modify

- ops/55.seed-lidarr-first-class-defaults.sql (append after quality groups section)

**Part A: Quality Profile Languages**

Insert language preferences for each profile:

```sql
INSERT INTO quality_profile_languages (quality_profile_name, language_name, required)
SELECT 'Lidarr - Lossless (Praxrr)', 'Any', 'must'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)'
);
```

Repeat for all 3 profiles. Use `Any` language for Lidarr (music is language-agnostic for codec
matching).

**Part B: Quality Profile Custom Format Scores**

Insert score mappings using the triple-EXISTS guard pattern from ops/53:

| Profile                              | Custom Format          | Score |
| ------------------------------------ | ---------------------- | ----- |
| Lidarr - Lossless (Praxrr)           | Lidarr - FLAC (Praxrr) | 50000 |
| Lidarr - Lossless (Praxrr)           | Lidarr - AAC (Praxrr)  | 10000 |
| Lidarr - Lossless (Praxrr)           | Lidarr - Opus (Praxrr) | 20000 |
| Lidarr - High Quality Lossy (Praxrr) | Lidarr - FLAC (Praxrr) | 20000 |
| Lidarr - High Quality Lossy (Praxrr) | Lidarr - AAC (Praxrr)  | 40000 |
| Lidarr - High Quality Lossy (Praxrr) | Lidarr - Opus (Praxrr) | 50000 |
| Lidarr - Lossy (Praxrr)              | Lidarr - FLAC (Praxrr) | 10000 |
| Lidarr - Lossy (Praxrr)              | Lidarr - AAC (Praxrr)  | 50000 |
| Lidarr - Lossy (Praxrr)              | Lidarr - Opus (Praxrr) | 30000 |

All scores use `arr_type = 'lidarr'`.

**Note**: Score values above are suggested starting points. The exact values should reflect the tier
hierarchy -- higher scores for preferred formats within each tier's context. FLAC scores highest in
Lossless, AAC/Opus score highest in their respective lossy tiers.

**Part C: Quality Profile Qualities (Rankings)**

Insert quality ranking positions for each profile. `position = 0` with `upgrade_until = 1` marks the
highest tier quality group:

For **Lidarr - Lossless (Praxrr)**:

- Position 0: `Lossless Hi-Res` group (upgrade_until = 1)
- Position 1: `Lossless` group (upgrade_until = 0)

For **Lidarr - High Quality Lossy (Praxrr)**:

- Position 0: `High Quality Lossy` group (upgrade_until = 1)

For **Lidarr - Lossy (Praxrr)**:

- Position 0: `Lossy` group (upgrade_until = 1)

Use idempotent inserts with NOT EXISTS guards.

### Phase 3: Verification

#### Task 3.1: Verify idempotency and completeness Depends on [2.1, 2.2, 2.3]

**READ THESE BEFORE TASK**

- ops/55.seed-lidarr-first-class-defaults.sql (the file created in prior tasks)
- docs/plans/lidarr-first-class-defaults/feature-spec.md (Success Criteria section)
- tasks/lessons.md (`(Praxrr)` suffix requirement)

**Instructions**

Files to Modify

- (none -- verification only)

Run the following verification checks:

1. **Naming convention check**: Grep for any new Lidarr entities missing the `(Praxrr)` suffix:

   ```bash
   grep -n "Lidarr -" ops/55.seed-lidarr-first-class-defaults.sql | grep -v "(Praxrr)"
   ```

   Expected: zero matches.

2. **No-reuse check**: Grep for old generic names used as primary entities (not as regex
   references):

   ```bash
   grep -n "WHERE.*name = 'AAC'" ops/55.seed-lidarr-first-class-defaults.sql | grep -v "re\.name\|regular_expressions\|condition_name\|tag_name"
   ```

   Expected: zero matches (generic names should only appear as regex references in
   condition_patterns, never as CF or profile names).

3. **Tier completeness**: Verify all three profile names appear:

   ```bash
   grep -c "Lidarr - Lossless (Praxrr)\|Lidarr - High Quality Lossy (Praxrr)\|Lidarr - Lossy (Praxrr)" ops/55.seed-lidarr-first-class-defaults.sql
   ```

   Expected: each name appears multiple times (in profiles, scores, languages, qualities).

4. **Entity dependency order**: Verify the file follows the correct insertion order (CFs before
   conditions, profiles before groups, etc.) by scanning section headers.

5. **Operation block integrity**: Verify every `BEGIN op` has a matching `END op`:

   ```bash
   grep -c "BEGIN op" ops/55.seed-lidarr-first-class-defaults.sql
   grep -c "END op" ops/55.seed-lidarr-first-class-defaults.sql
   ```

   Expected: counts match.

6. **ops/52 retained**: Verify ops/52 still exists and is unchanged:

   ```bash
   git diff ops/52.seed-lidarr-quality-definitions.sql
   ```

   Expected: no changes.

## Advice

- **Resolve open decisions first**: Before writing any SQL, lock down: (1) exact quality-to-tier
  assignment from the 38 Lidarr qualities, (2) score values per CF-profile pair, (3) language
  preference (`Any` recommended for music), (4) whether to include optional expanded CFs (ALAC, MP3
  V0, MP3 320) or defer. The feature-spec.md "Decisions Needed" section lists these explicitly.
- **Music-specific condition design (RESOLVED)**: Video-codec negation conditions (Not Dolby
  Digital, Not DTS, Not PCM, Not TrueHD) have been removed from the Lidarr CF conditions. Lidarr's
  native QualityParser does not detect video codecs, PCM is a valid lossless music format in Lidarr,
  and simpler conditions are more appropriate for the music domain. Use positive-match +
  mutual-exclusion negations only (FLAC negates AAC and vice versa).
- **Lidarr supports only 4 CF condition types**: `release_title`, `release_group`, `indexer_flag`,
  `size`. The praxrr consumer enforces this via `LIDARR_SUPPORTED_CONDITION_TYPES`. Do NOT use
  `language`, `resolution`, `source`, `quality_modifier`, or `release_type` conditions for Lidarr
  CFs.
- **Lidarr API is v1, not v3**: The LidarrClient in praxrr overrides `apiVersion = 'v1'`. All API
  endpoint references should use `/api/v1/`.
- **Single file simplicity**: All new entities fit cleanly in one
  `ops/55.seed-lidarr-first-class-defaults.sql` file with sections ordered by entity dependency
  chain. This is simpler to review and maintain than splitting across multiple files.
- **File numbering gap**: After deleting ops/50, 51, 53, 54 and keeping ops/52, the new file at
  ops/55 creates a numbering gap (52, 55). This is intentional and matches the sequential execution
  model -- file numbers determine order, not contiguity.
- **Score tuning is iterative**: The suggested scores in Task 2.3 are starting points. Real-world
  testing with Lidarr will reveal whether score differentials are sufficient for proper upgrade
  behavior. Plan for a follow-up ops file (ops/56+) to adjust scores based on testing.
- **condition_patterns uses idempotent NOT EXISTS**: Unlike rosettarr which uses bare inserts, the
  new file must guard condition_patterns inserts since this is an incremental ops file (not the
  initial seed).
- **The `(Praxrr)` suffix is non-negotiable**: Per `tasks/lessons.md`, this was a prior correction.
  Every entity name must include it. Run grep verification before considering any task complete.
