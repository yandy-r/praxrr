# Lidarr Seed Results

Task 2.6 consolidated reconciliation of planned seed inventory versus implemented
Phase 2 SQL operations.

## Phase 2 SQL Coverage

| planned_entity                        | outcome     | rationale                                                                              | implemented_sql                                                                                               |
| ------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `custom_format_seed`                  | implemented | Added Lidarr custom-format base rows (`AAC`, `FLAC`, `Opus`) with idempotent guards.   | [`ops/50.seed-lidarr-custom-formats.sql`](../../../ops/50.seed-lidarr-custom-formats.sql)                     |
| `quality_profile_seed`                | implemented | Added `Lidarr Default` profile with `(name, arr_type)` duplicate prevention.           | [`ops/51.seed-lidarr-quality-profiles.sql`](../../../ops/51.seed-lidarr-quality-profiles.sql)                 |
| `quality_definition_mapping_join`     | implemented | Added Lidarr `quality_api_mappings` rows before dependent definition inserts.          | [`ops/52.seed-lidarr-quality-definitions.sql`](../../../ops/52.seed-lidarr-quality-definitions.sql)           |
| `quality_definition_seed`             | implemented | Added `quality_definitions` rows keyed by `(name, quality_name, arr_type)`.            | [`ops/52.seed-lidarr-quality-definitions.sql`](../../../ops/52.seed-lidarr-quality-definitions.sql)           |
| `profile_custom_format_score_mapping` | implemented | Added profile-to-format score rows with existence checks on referenced entities.       | [`ops/53.seed-lidarr-profile-format-scores.sql`](../../../ops/53.seed-lidarr-profile-format-scores.sql)       |
| `custom_format_condition_seed`        | implemented | Added arr-scoped condition families for `AAC`, `FLAC`, and `Opus` using unique guards. | [`ops/54.seed-lidarr-custom-format-conditions.sql`](../../../ops/54.seed-lidarr-custom-format-conditions.sql) |

## Status Totals

- implemented: 6
- deferred: 0
- dropped: 0

## Condition-Level Match/Non-Match Examples

Published from
[`lidarr-condition-evidence.md`](./lidarr-condition-evidence.md) for condition rows
inserted by
[`ops/54.seed-lidarr-custom-format-conditions.sql`](../../../ops/54.seed-lidarr-custom-format-conditions.sql).

| Condition Family | Seeded Conditions                                                                                          | Expected Match Example                     | Expected Non-Match Example                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| `AAC`            | `AAC` + negated `Not Dolby Digital`, `Not Dolby Digital +`, `Not DTS`, `Not FLAC`, `Not PCM`, `Not TrueHD` | `Artist.Album.2024.AAC.256kbps.WEB-DL-GRP` | `Artist.Album.2024.AAC.FLAC.24bit.WEB-DL-GRP` |
| `FLAC`           | `FLAC` + negated `Not AAC`, `Not Dolby Digital`, `Not Dolby Digital +`, `Not DTS`, `Not PCM`, `Not TrueHD` | `Artist.Album.2024.FLAC.16bit.CD-GRP`      | `Artist.Album.2024.FLAC.AAC.320kbps.CD-GRP`   |
| `Opus`           | `Opus` + negated release-group condition `Not OPUS Release Group`                                          | `Artist.Album.2024.OPUS.320kbps-QxR`       | `Artist.Album.2024.OPUS.320kbps-OPUS`         |
