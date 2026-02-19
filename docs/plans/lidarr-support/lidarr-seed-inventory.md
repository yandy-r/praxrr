# Lidarr Seed Inventory and Mapping Checklist

Task 1.2 output for Lidarr support planning, reconciled by Task 2.6 into the
authoritative post-Phase-2 seed inventory state.

## Strict Inventory Rows (Authoritative Post-Phase-2 State)

| entity                              | source                                                              | target_table                     | unique_key_tuple                                       | arr_type_scope                                                  | status                                                                            | evidence_link                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quality_profile_seed                | v1 minimum dataset + Lidarr quality-profile API                     | `quality_profiles`               | `(name, arr_type)`                                     | `arr_type='lidarr'` only                                        | implemented: inserted `Lidarr Default` with deterministic key guard.              | [`ops/51.seed-lidarr-quality-profiles.sql`](../../../ops/51.seed-lidarr-quality-profiles.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#phase-2-sql-coverage)                                    |
| custom_format_seed                  | v1 minimum dataset + Lidarr custom-format API                       | `custom_formats`                 | `(name, arr_type)`                                     | `arr_type='lidarr'` only                                        | implemented: inserted `AAC`, `FLAC`, and `Opus` with `NOT EXISTS`.                | [`ops/50.seed-lidarr-custom-formats.sql`](../../../ops/50.seed-lidarr-custom-formats.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#phase-2-sql-coverage)                                        |
| custom_format_condition_seed        | v1 minimum dataset + existing condition table family                | `custom_format_conditions`       | `(custom_format_name, name, type, arr_type)`           | lidarr rows only; no `all` reuse unless exception is documented | implemented: inserted arr-scoped condition families for all seeded formats.       | [`ops/54.seed-lidarr-custom-format-conditions.sql`](../../../ops/54.seed-lidarr-custom-format-conditions.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#condition-level-matchnon-match-examples) |
| profile_custom_format_score_mapping | v1 profile-format coverage + existing join pattern                  | `quality_profile_custom_formats` | `(quality_profile_name, custom_format_name, arr_type)` | `arr_type='lidarr'` only                                        | implemented: inserted profile-to-format scores with referential guards.           | [`ops/53.seed-lidarr-profile-format-scores.sql`](../../../ops/53.seed-lidarr-profile-format-scores.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#phase-2-sql-coverage)                          |
| quality_definition_seed             | v1 quality-definition compatibility + Lidarr quality-definition API | `quality_definitions`            | `(name, quality_name, arr_type)`                       | lidarr-only definitions                                         | implemented: seeded `default` Lidarr definitions from mapping-backed API names.   | [`ops/52.seed-lidarr-quality-definitions.sql`](../../../ops/52.seed-lidarr-quality-definitions.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#phase-2-sql-coverage)                              |
| quality_definition_mapping_join     | quality definitions are sourced through quality API name mapping    | `quality_api_mappings`           | `(arr_type, api_name)`                                 | mapping rows for `arr_type='lidarr'` only                       | implemented: inserted Lidarr `quality_api_mappings` join rows before definitions. | [`ops/52.seed-lidarr-quality-definitions.sql`](../../../ops/52.seed-lidarr-quality-definitions.sql), [`lidarr-seed-results.md`](./lidarr-seed-results.md#phase-2-sql-coverage)                              |

## Task 2.6 Reconciliation Summary

- implemented: 6
- deferred: 0
- dropped: 0
- published examples: [`lidarr-seed-results.md`](./lidarr-seed-results.md)

## Per-Target Clarifications

| entity                              | source_rationale                                                                     | arr_type_scope_expectation                                                                                  | idempotency_guard_expectation                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| quality_profile_seed                | Required by v1 minimum dataset and Lidarr `/api/v1/qualityprofile` parity.           | Must resolve to `lidarr`-scoped records, not global-only rows.                                              | `INSERT ... SELECT ... WHERE NOT EXISTS` keyed by `(name, arr_type)` on shared path; if dedicated table is chosen, guard on dedicated unique identity. |
| custom_format_seed                  | Required by v1 minimum dataset and Lidarr `/api/v1/customformat` parity.             | Must resolve to `lidarr`-scoped records, not `all` spillover.                                               | `NOT EXISTS` guard keyed by `(name, arr_type)` on shared path; dedicated-table fallback uses dedicated unique identity.                                |
| custom_format_condition_seed        | Required for condition coverage for every Lidarr custom format.                      | Conditions must explicitly carry `arr_type='lidarr'` unless one documented cross-arr exception is approved. | `NOT EXISTS` keyed by `(custom_format_name, name, type, arr_type)` before inserts; deterministic literal values only.                                  |
| profile_custom_format_score_mapping | Required for profile-format coverage and referential integrity checks.               | Every mapping row must be `arr_type='lidarr'`.                                                              | Insert guard keyed by `(quality_profile_name, custom_format_name, arr_type)` and reference checks for profile/custom-format existence.                 |
| quality_definition_seed             | Required to satisfy Lidarr quality-definition compatibility checks.                  | Lidarr definitions must not mutate Radarr/Sonarr definitions in place.                                      | Idempotent insert guard keyed by approved schema-gate tuple; fail fast if required mappings are missing.                                               |
| quality_definition_mapping_join     | `quality_api_mappings` is the observed join source for existing quality definitions. | Mapping rows must be Lidarr-only and isolated from Radarr/Sonarr names.                                     | Insert missing mappings with `NOT EXISTS` on `(arr_type, api_name)`; block SQL if required Lidarr API names cannot resolve deterministically.          |

## Task 1.3 Schema-Gate Resolution

- Gate artifact: [`lidarr-schema-gate.md`](./lidarr-schema-gate.md)
- Locked path: `shared-table extension`
- Hard-stop behavior:
  - If schema dependency facts conflict with any approved table/key contract,
    stop Phase 2 immediately and re-plan before writing SQL.
  - Do not start Tasks 2.1-2.6 until gate approval is explicitly marked
    `approved` in the gate file.

## Mapping Checklist (Post Task 1.3)

- [x] Schema gate approval is marked `approved` in `lidarr-schema-gate.md`.
- [x] Concrete target selected for `quality_profile_seed`.
- [x] Concrete target selected for `custom_format_seed`.
- [x] Concrete target selected for `quality_definition_seed`.
- [x] Approved key tuples are copied into Task 1.3 gate outputs.
- [x] Quality-definition mapping source contract is fixed to `quality_api_mappings`.
- [x] Previous blocked rows are converted to ready with hard-stop fallback.
