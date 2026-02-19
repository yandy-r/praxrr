# Lidarr SQL Validation Evidence (Task 3.1)

Verification run date: `2026-02-13`

This document captures Task 3.1 SQL verification evidence for the Lidarr ops
set (`ops/50` through `ops/54`) with explicit commands, pass criteria, and
requirement-level status mapping.

## Command Verification Matrix

| Command                                             | Pass Criteria                                                                                                | Observed Result                                                                                                                                 | Status |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `ls ops/*.sql \| sort -V`                           | Lidarr ops are ordered with no numbering conflicts and appear after existing ops.                            | Output includes sequential `ops/50.seed-lidarr-custom-formats.sql` through `ops/54.seed-lidarr-custom-format-conditions.sql` after `ops/49...`. | Pass   |
| `git diff -- ops/`                                  | Diff scope is limited to intended Lidarr operations only (no unrelated tracked ops edits).                   | Command output is empty. `git status --short ops/` shows only untracked `ops/50`-`ops/54` files.                                                | Pass   |
| Replay procedure (same staging dataset, two passes) | Applying `ops/50`-`ops/54` twice yields identical row counts and zero duplicate rows on required key tuples. | First-pass and second-pass row counts are identical; duplicate assertions returned zero rows.                                                   | Pass   |

## Replay Procedure (Executed)

The replay used a temporary staging SQLite database at
`/tmp/lidarr_validation.sqlite` with the required tables:

- `qualities`
- `custom_formats`
- `quality_profiles`
- `quality_api_mappings`
- `quality_definitions`
- `quality_profile_custom_formats`
- `custom_format_conditions`

The procedure applied the same ops list twice in this exact order:

1. `ops/50.seed-lidarr-custom-formats.sql`
2. `ops/51.seed-lidarr-quality-profiles.sql`
3. `ops/52.seed-lidarr-quality-definitions.sql`
4. `ops/53.seed-lidarr-profile-format-scores.sql`
5. `ops/54.seed-lidarr-custom-format-conditions.sql`

Executed command sequence:

```bash
sqlite3 /tmp/lidarr_validation.sqlite ".read /tmp/lidarr_validation_setup.sql"

# pass 1
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/50.seed-lidarr-custom-formats.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/51.seed-lidarr-quality-profiles.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/52.seed-lidarr-quality-definitions.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/53.seed-lidarr-profile-format-scores.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/54.seed-lidarr-custom-format-conditions.sql"

# pass 2 (same dataset)
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/50.seed-lidarr-custom-formats.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/51.seed-lidarr-quality-profiles.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/52.seed-lidarr-quality-definitions.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/53.seed-lidarr-profile-format-scores.sql"
sqlite3 /tmp/lidarr_validation.sqlite ".read ops/54.seed-lidarr-custom-format-conditions.sql"
```

### Replay Row-Count Evidence

| Table (`arr_type='lidarr'`)      | Pass 1 | Pass 2 | Pass Criteria                 | Status |
| -------------------------------- | ------ | ------ | ----------------------------- | ------ |
| `custom_formats`                 | 3      | 3      | Counts unchanged after replay | Pass   |
| `quality_profiles`               | 1      | 1      | Counts unchanged after replay | Pass   |
| `quality_api_mappings`           | 38     | 38     | Counts unchanged after replay | Pass   |
| `quality_definitions`            | 38     | 38     | Counts unchanged after replay | Pass   |
| `quality_profile_custom_formats` | 3      | 3      | Counts unchanged after replay | Pass   |
| `custom_format_conditions`       | 16     | 16     | Counts unchanged after replay | Pass   |

## Table-Level Duplicate Assertions (Required Zero-Row Results)

Pass criterion for each query: result set must contain zero rows.

```sql
SELECT quality_profile_name, custom_format_name, arr_type, COUNT(*) AS duplicate_count
FROM quality_profile_custom_formats
GROUP BY quality_profile_name, custom_format_name, arr_type
HAVING COUNT(*) > 1;
```

Result: zero rows (Pass)

```sql
SELECT custom_format_name, name, type, arr_type, COUNT(*) AS duplicate_count
FROM custom_format_conditions
GROUP BY custom_format_name, name, type, arr_type
HAVING COUNT(*) > 1;
```

Result: zero rows (Pass)

```sql
SELECT name, arr_type, COUNT(*) AS duplicate_count
FROM quality_profiles
GROUP BY name, arr_type
HAVING COUNT(*) > 1;
```

Result: zero rows (Pass)

## Minimum Complete Dataset Assertions

| Assertion                                 | Query Result                           | Pass Criteria | Status |
| ----------------------------------------- | -------------------------------------- | ------------- | ------ |
| Lidarr profile exists                     | `lidarr_profile_count=1`               | `>= 1`        | Pass   |
| Lidarr custom format exists               | `lidarr_custom_format_count=3`         | `>= 1`        | Pass   |
| Every Lidarr custom format has conditions | `missing_condition_formats=0`          | `= 0`         | Pass   |
| Every Lidarr profile has score mappings   | `missing_profile_mappings=0`           | `= 0`         | Pass   |
| No orphan profile-format mappings         | `orphan_mappings=0`                    | `= 0`         | Pass   |
| Lidarr quality definitions exist          | `lidarr_quality_definition_count=38`   | `>= 1`        | Pass   |
| No unresolved definition references       | `unresolved_quality_definition_refs=0` | `= 0`         | Pass   |

## Requirement-to-Evidence Status Matrix

Source requirements:
[`requirements.md`](./requirements.md)

| Requirement ID | Evidence                                                                                                                                                                                                                                              | Pass/Fail |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `LID-V1-01`    | `jq -r '.arr_types, .praxrr.minimum_version' pcd.json` returned `["radarr","sonarr","lidarr"]` and `2.1.0`, satisfying both manifest-gate requirements.                                                                                            | Pass      |
| `LID-V1-02`    | `rg -n -e "metadata_profile" -e "release_profile" -e "lidarr_metadata" -e "lidarr_release" ops/50...54` returned no matches.                                                                                                                          | Pass      |
| `LID-V1-03`    | Schema gate confirms `shared-table extension` with targets `custom_formats`, `quality_profiles`, `quality_definitions`, `quality_profile_custom_formats`, and `custom_format_conditions`; `INSERT INTO` targets in `ops/50...54` match these exactly. | Pass      |
| `LID-V1-04`    | Minimum complete dataset query set in this document returned all pass criteria (`>=1` or `=0` as required).                                                                                                                                           | Pass      |
| `LID-V1-05`    | `rg -n "arr_type\\s*=\\s*'lidarr'" ...` plus literal `'lidarr'` checks across `ops/50...54` show explicit Lidarr scoping across inserts and guards.                                                                                                   | Pass      |
| `LID-V1-06`    | Two-pass replay on the same staging dataset produced unchanged row counts and zero duplicate rows.                                                                                                                                                    | Pass      |
| `LID-V1-07`    | Duplicate-key assertion queries for required tuples returned zero rows for `quality_profile_custom_formats`, `custom_format_conditions`, and `quality_profiles`.                                                                                      | Pass      |
| `LID-V1-08`    | `rg -n "Lidarr Support Scope" README.md`, `rg -n "Compatibility Gate" README.md`, and `rg -n "Known Limitations" README.md` matched required disclosure sections (`README.md:30`, `README.md:40`, `README.md:47`).                                    | Pass      |
| `LID-V1-09`    | This artifact maps every `LID-V1-*` requirement to concrete evidence and status.                                                                                                                                                                      | Pass      |

## Overall Blocking Status

- `blocking_requirements_passed`: `true`
- Blocking failures: none
- Release status at Task 3.1 completion: validation requirements satisfied
