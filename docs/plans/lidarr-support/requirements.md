# Lidarr v1 Support Contract

## Purpose

This document is the Task 1.1 implementation contract for Lidarr v1 support in
`praxrr-db`. It defines the non-negotiable v1 boundary, release blockers, and
verification steps that downstream SQL tasks must satisfy.

## Contract Baseline

- Contract scope is for the first Lidarr-enabled database release only.
- Required arr discriminator value is `arr_type='lidarr'`.
- Compatibility gate is `pcd.json.praxrr.minimum_version = 2.1.0`.
- V1 path is shared-table extension; if schema validation forces dedicated
  `lidarr_*` entities, publication is blocked until re-planning is complete.

## In Scope for v1

- Add Lidarr publication metadata in `pcd.json` (`arr_types` + minimum version
  gate).
- Seed Lidarr rows for the minimum complete dataset:
  - quality profiles
  - custom formats
  - custom format conditions
  - quality profile to custom format score mappings
  - quality definitions/mappings required by selected Lidarr profiles
- Keep SQL additive and replay-safe with deterministic duplicate guards.
- Produce validation evidence mapped to every contract requirement.

## Explicitly Out of Scope for v1

- Lidarr metadata profile seeding.
- Lidarr release profile seeding.
- SignalR/event-stream integration.
- Automatic OpenAPI client generation pipeline.
- Non-essential schema redesign beyond the shared-table path.

## Release Blockers

Release is blocked if any of the following is true:

- `pcd.json` does not include `lidarr` and minimum version `2.1.0`.
- Shared-table schema path is not validated (or requires dedicated entities
  without approved re-plan).
- Minimum complete dataset checks fail.
- Duplicate/idempotency checks fail.
- Out-of-scope features are introduced in v1 ops.
- Consumer compatibility evidence for `praxrr >= 2.1.0` is missing.

## Minimum Complete Dataset

The dataset is considered complete only when all checks pass.

| Dataset Component                | Requirement                                                                                                                     | Verification Step                                                                                                                                                                                                                                                                                                                                                 | Pass Condition                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Lidarr profile seed              | At least one Lidarr profile row exists in `<quality_profiles_target>`.                                                          | `SELECT COUNT(*) AS c FROM <quality_profiles_target> WHERE arr_type = 'lidarr';`                                                                                                                                                                                                                                                                                  | `c >= 1`                                         |
| Lidarr custom formats            | At least one Lidarr custom format row exists in `<custom_formats_target>`.                                                      | `SELECT COUNT(*) AS c FROM <custom_formats_target> WHERE arr_type = 'lidarr';`                                                                                                                                                                                                                                                                                    | `c >= 1`                                         |
| Condition coverage               | Every Lidarr custom format has at least one Lidarr condition row in `<conditions_target>`.                                      | `SELECT COUNT(*) AS missing_condition_formats FROM <custom_formats_target> cf WHERE cf.arr_type = 'lidarr' AND NOT EXISTS (SELECT 1 FROM <conditions_target> c WHERE c.custom_format_name = cf.name AND c.arr_type = 'lidarr');`                                                                                                                                  | `missing_condition_formats = 0`                  |
| Profile-format coverage          | Every Lidarr profile has at least one Lidarr score mapping in `<profile_format_target>`.                                        | `SELECT COUNT(*) AS missing_profile_mappings FROM <quality_profiles_target> qp WHERE qp.arr_type = 'lidarr' AND NOT EXISTS (SELECT 1 FROM <profile_format_target> qpf WHERE qpf.quality_profile_name = qp.name AND qpf.arr_type = 'lidarr');`                                                                                                                     | `missing_profile_mappings = 0`                   |
| Mapping referential integrity    | No Lidarr profile-format mapping references missing profile/custom format rows.                                                 | `SELECT COUNT(*) AS orphan_mappings FROM <profile_format_target> qpf WHERE qpf.arr_type = 'lidarr' AND (NOT EXISTS (SELECT 1 FROM <quality_profiles_target> qp WHERE qp.name = qpf.quality_profile_name AND qp.arr_type = 'lidarr') OR NOT EXISTS (SELECT 1 FROM <custom_formats_target> cf WHERE cf.name = qpf.custom_format_name AND cf.arr_type = 'lidarr'));` | `orphan_mappings = 0`                            |
| Quality-definition compatibility | Lidarr quality definitions exist and cover all quality names used by Lidarr profiles according to the schema gate key contract. | Query pair: (1) `SELECT COUNT(*) AS c FROM <quality_definitions_target> WHERE arr_type = 'lidarr';` (2) profile-to-definition coverage query in `lidarr-schema-gate.md` using approved quality key columns.                                                                                                                                                       | `(1) c >= 1` and `(2) unresolved references = 0` |

## Requirement-to-Verification Matrix

| ID        | Requirement                                                                                           | Verification Step                                                                                                                                                                                                                             | Pass Condition                                                                                          | Blocking |
| --------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| LID-V1-01 | Manifest gate is explicit: `arr_types` includes `lidarr` and `praxrr.minimum_version` equals `2.1.0`. | `jq -r '.arr_types, .praxrr.minimum_version' pcd.json`                                                                                                                                                                                        | Output contains `lidarr`; minimum version is exactly `2.1.0`.                                           | Yes      |
| LID-V1-02 | SQL implementation stays inside v1 scope entities only.                                               | `rg -n -e "metadata_profile" -e "release_profile" -e "lidarr_metadata" -e "lidarr_release" ops/5*.sql`                                                                                                                                        | No matches in Lidarr task ops.                                                                          | Yes      |
| LID-V1-03 | Shared-table path is used for v1; dedicated-table requirement triggers stop-and-replan.               | Review `docs/plans/lidarr-support/lidarr-schema-gate.md` contract fields against seeded targets.                                                                                                                                              | All targets match shared-table contract or release is explicitly blocked.                               | Yes      |
| LID-V1-04 | Minimum complete dataset is present.                                                                  | Execute all SQL checks in `## Minimum Complete Dataset`.                                                                                                                                                                                      | Every check meets pass condition.                                                                       | Yes      |
| LID-V1-05 | Arr-type isolation is enforced for seeded Lidarr rows.                                                | `rg -n "arr_type\\s*=\\s*'lidarr'" ops/5*.sql` plus SQL spot checks on seeded rows.                                                                                                                                                           | Required inserts/joins are explicitly scoped to `arr_type='lidarr'` unless documented exception exists. | Yes      |
| LID-V1-06 | Replay safety is proven.                                                                              | Apply new Lidarr ops twice to the same staging DB and run duplicate queries.                                                                                                                                                                  | Second replay produces no new rows; duplicate checks return zero.                                       | Yes      |
| LID-V1-07 | Duplicate guards align with unique-key tuples.                                                        | SQL zero-row checks for `(quality_profile_name, custom_format_name, arr_type)` in `quality_profile_custom_formats`, `(custom_format_name, name, type, arr_type)` in `custom_format_conditions`, and `(name, arr_type)` in `quality_profiles`. | All duplicate queries return zero rows.                                                                 | Yes      |
| LID-V1-08 | Out-of-scope disclosure is documented for release consumers.                                          | Verify `README.md` includes supported and unsupported Lidarr capability sections tied to this contract.                                                                                                                                       | Documentation published with explicit unsupported features.                                             | Yes      |
| LID-V1-09 | Validation evidence is traceable to each requirement ID.                                              | Verify requirement IDs are mapped in `docs/plans/lidarr-support/lidarr-validation.md`.                                                                                                                                                        | Every `LID-V1-*` requirement has pass/fail evidence.                                                    | Yes      |

## Handoff for SQL Tasks

- Treat this file as immutable baseline input for Tasks 1.2 onward.
- Resolve `<*_target>` placeholders through Task 1.3 schema-gate outputs before
  writing SQL.
- If any task finds a conflict with this contract, stop implementation, record
  the conflict, and re-plan before changing SQL scope.
