# Lidarr Schema Gate (Task 1.3)

## Purpose

Lock the Phase 2 schema path and provide a fail-fast stop condition if runtime schema facts
contradict this plan.

## Gate Decision

- Selected path: `shared-table extension`.
- Rationale:
  - Task 1.1 contract (`requirements.md`) sets shared-table extension as the v1 baseline.
  - Current Phase 2 tasks in `parallel-plan.md` are sequenced for shared-path execution and
    explicitly require a stop-and-replan if this gate is broken.

## Phase 2 Table/Key Contract

- `custom_formats_target`: `custom_formats`
- `custom_formats_unique_key`: `(name, arr_type)`
- `quality_profiles_target`: `quality_profiles`
- `quality_profiles_unique_key`: `(name, arr_type)`
- `quality_definitions_target`: `quality_definitions`
- `quality_definitions_unique_key`: `(name, quality_name, arr_type)`
- `profile_format_target`: `quality_profile_custom_formats`
- `conditions_target`: `custom_format_conditions`

## Hard Stop Condition

Stop Phase 2 immediately and re-plan before any SQL implementation if one or more conditions are
true:

1. The pinned schema dependency in `pcd.json` (`https://github.com/yandy-r/praxrr-schema` @ `1.0.0`)
   does not expose one or more target tables listed above.
2. Any required contract column is missing for the selected target (`arr_type` on `custom_formats`,
   `quality_profiles`, or `quality_definitions`).
3. Uniqueness cannot be enforced with the exact tuples above without data-loss side effects or
   cross-arr collisions.
4. A downstream task requires dedicated `lidarr_*` entities to preserve correctness or idempotency.

When a hard stop triggers, do not start or continue Tasks 2.1-2.6. Record the conflict and create a
dedicated-entity re-plan before writing SQL.

## Approval Gate

- `phase_2_start_allowed`: `true`
- `approval_required`: `true`
- `approval_status`: `approved`
- `approval_reviewer`: `codex`
- `approval_date`: `2026-02-13`
- `approval_note`: Gate is approved. Phase 2 tasks may start, but hard-stop conditions above still
  apply.
