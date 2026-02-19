# Lidarr Compatibility Matrix

This matrix publishes Task 3.3 support and compatibility scope for the Lidarr v1 contract.

## DB Version

- Published value: `v1` (first Lidarr-enabled database release scope).
- requirements.md evidence: [Contract Baseline](./requirements.md#contract-baseline).
- lidarr-validation.md evidence:
  [Command Verification Matrix](./lidarr-validation.md#command-verification-matrix) confirms the
  validated Lidarr ops payload is `ops/50` through `ops/54`.

## Minimum Praxrr Version

- Published value: `2.1.0`.
- Compatibility gate: release is blocked if `lidarr` is missing from `arr_types` or
  `praxrr.minimum_version` is not `2.1.0`.
- requirements.md evidence: [Contract Baseline](./requirements.md#contract-baseline) and
  [Release Blockers](./requirements.md#release-blockers).
- lidarr-validation.md evidence:
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix)
  shows `LID-V1-01` is blocking when this gate is unmet.

## Supported Lidarr Features

- Quality profile seeding is supported. requirements.md evidence:
  [In Scope for v1](./requirements.md#in-scope-for-v1). lidarr-validation.md evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions)
  with `lidarr_profile_count=1`.
- Custom format seeding is supported. requirements.md evidence:
  [In Scope for v1](./requirements.md#in-scope-for-v1). lidarr-validation.md evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions)
  with `lidarr_custom_format_count=3`.
- Custom format condition coverage is supported. requirements.md evidence:
  [Minimum Complete Dataset](./requirements.md#minimum-complete-dataset). lidarr-validation.md
  evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions)
  with `missing_condition_formats=0`.
- Profile-to-format score mappings with referential integrity are supported. requirements.md
  evidence: [Minimum Complete Dataset](./requirements.md#minimum-complete-dataset).
  lidarr-validation.md evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions)
  with `missing_profile_mappings=0` and `orphan_mappings=0`.
- Quality definitions and profile coverage are supported. requirements.md evidence:
  [Minimum Complete Dataset](./requirements.md#minimum-complete-dataset). lidarr-validation.md
  evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions)
  with `lidarr_quality_definition_count=38` and `unresolved_quality_definition_refs=0`.
- Replay-safe, duplicate-guarded seeding is supported. requirements.md evidence: `LID-V1-06` and
  `LID-V1-07` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence:
  [Replay Row-Count Evidence](./lidarr-validation.md#replay-row-count-evidence) and
  [Table-Level Duplicate Assertions](./lidarr-validation.md#table-level-duplicate-assertions-required-zero-row-results).

## Unsupported Features

- Lidarr metadata profile seeding is unsupported in v1. requirements.md evidence:
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence: `LID-V1-02` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix)
  confirms these entities are absent from Lidarr task SQL.
- Lidarr release profile seeding is unsupported in v1. requirements.md evidence:
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence: `LID-V1-02` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix)
  confirms these entities are absent from Lidarr task SQL.
- SignalR/event-stream integration is unsupported in v1. requirements.md evidence:
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence:
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix)
  documents Task 3.1 evidence as SQL-only.
- Automatic OpenAPI client generation pipeline is unsupported in v1. requirements.md evidence:
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence:
  [Overall Blocking Status](./lidarr-validation.md#overall-blocking-status) confirms non-SQL release
  work remained outside Task 3.1 SQL evidence.
- Non-essential schema redesign beyond the shared-table path is unsupported in v1. requirements.md
  evidence: [Contract Baseline](./requirements.md#contract-baseline),
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1), and
  `LID-V1-03` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence: `LID-V1-03` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix).

## Claim-to-Evidence Map

- `LIDC-01`: Lidarr support is documented for the v1 database release boundary only. requirements.md
  evidence: [Contract Baseline](./requirements.md#contract-baseline). lidarr-validation.md evidence:
  [Command Verification Matrix](./lidarr-validation.md#command-verification-matrix).
- `LIDC-02`: The compatibility gate requires `praxrr.minimum_version = 2.1.0`. requirements.md
  evidence: [Contract Baseline](./requirements.md#contract-baseline),
  [Release Blockers](./requirements.md#release-blockers), and `LID-V1-01` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence: `LID-V1-01` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix).
- `LIDC-03`: v1 supports seeding Lidarr profiles, custom formats, conditions, score mappings, and
  quality definitions. requirements.md evidence:
  [In Scope for v1](./requirements.md#in-scope-for-v1) and
  [Minimum Complete Dataset](./requirements.md#minimum-complete-dataset). lidarr-validation.md
  evidence:
  [Minimum Complete Dataset Assertions](./lidarr-validation.md#minimum-complete-dataset-assertions).
- `LIDC-04`: v1 seeding is replay-safe and duplicate-guarded. requirements.md evidence: `LID-V1-06`
  and `LID-V1-07` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence:
  [Replay Row-Count Evidence](./lidarr-validation.md#replay-row-count-evidence) and
  [Table-Level Duplicate Assertions](./lidarr-validation.md#table-level-duplicate-assertions-required-zero-row-results).
- `LIDC-05`: Metadata profile and release profile seeding are not included in v1. requirements.md
  evidence: [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence: `LID-V1-02` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix).
- `LIDC-06`: SignalR/event-stream integration and OpenAPI client generation are not included in v1.
  requirements.md evidence:
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1).
  lidarr-validation.md evidence:
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix)
  (Task 3.1 evidence scope is SQL-only).
- `LIDC-07`: Non-essential schema redesign is excluded; v1 stays on shared-table extension.
  requirements.md evidence: [Contract Baseline](./requirements.md#contract-baseline),
  [Explicitly Out of Scope for v1](./requirements.md#explicitly-out-of-scope-for-v1), and
  `LID-V1-03` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence: `LID-V1-03` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix).
- `LIDC-08`: Public release documentation must include support scope, compatibility gate, and
  limitations. requirements.md evidence: `LID-V1-08` in
  [Requirement-to-Verification Matrix](./requirements.md#requirement-to-verification-matrix).
  lidarr-validation.md evidence: `LID-V1-08` in
  [Requirement-to-Evidence Status Matrix](./lidarr-validation.md#requirement-to-evidence-status-matrix).
