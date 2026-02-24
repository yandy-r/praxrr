### Executive Summary

The most reliable plan is a dependency-first rollout: remove mode/config branches and SQL import
logic first, then update tooling that depends on SQL files, then delete SQL artifacts and clean
docs. This ordering maximizes parallelism while protecting shared ingestion files from conflicting
changes. Verification gates should be attached to each phase.

### Recommended Phase Structure

#### Phase 1: Runtime Ingestion Cutover

- purpose: enforce YAML-only base ingestion in app runtime.
- suggested tasks: config mode removal, manager orchestration simplification, `importBaseOps`
  SQL-path deletion, tests rewritten for YAML-only behavior.
- parallelization notes: config + manager tasks can run in parallel after agreeing on new import
  function contract.

#### Phase 2: Tooling and CI Realignment

- purpose: remove SQL-file assumptions from scripts and workflows.
- suggested tasks: rework `compat-check.ts`, retire or adapt parity/conversion tooling, review
  export/git helper assumptions.
- dependencies: requires Phase 1 API/behavior to be stable.

#### Phase 3: Artifact and Documentation Cleanup

- purpose: remove legacy SQL files and align documentation.
- suggested tasks: delete `packages/praxrr-db/ops/*.sql`, update architecture/runbook/readme docs,
  adjust workflow docs and references.
- integration focus: ensure tests and CI pass without SQL artifact presence.

### Task Granularity Guidance

- appropriate task sizes: 1-3 primary files per task, plus paired tests/docs updates.
- tasks to split: do not combine runtime ingestion edits with tooling or docs in a single task.
- tasks to combine: tightly coupled updates in one subsystem (e.g., config + its test cleanup).

### Dependency Analysis

#### Independent Tasks

- docs updates that only describe finalized behavior.
- non-runtime tooling audits that do not modify shared ingestion interfaces.

#### Sequential Tasks

- manager/config cleanup depends on agreed YAML-only import contract.
- SQL artifact deletion depends on all runtime and script references being removed.
- final docs updates depend on implementation decisions in exporter/tooling track.

#### Potential Bottlenecks

- `importBaseOps.ts` as central ingestion file.
- export/tooling decisions where `.sql` naming is used for sequencing/history.
- CI compatibility checks tied to old SQL artifacts.

### Suggested Task Template

- title format: `remove-sql-files: <scope> <action>`
- dependency annotation format: `Depends on [task-id, ...]`
- instruction completeness checklist:
  - explicit target files and acceptance criteria
  - verification commands/tests
  - backward-compatibility notes (schema SQL + `pcd_ops` replay)
