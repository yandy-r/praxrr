# Analysis: Task Structure

## Executive Summary

The plan should optimize for safe parallelism while preserving a strict compatibility-first
sequence. Consumer-readiness and release-gate decisions come first, then SQL publication, then
rollout verification/documentation. Tasks should stay small (1-3 files) and explicit about
dependencies.

## Recommended Phase Structure

### Phase 1: Compatibility Foundation

- Purpose: verify consumer handling of `arr_type='lidarr'` and define release gate criteria.
- Suggested tasks: compatibility audit, mixed-arr test coverage, gate/version policy definition.
- Parallelization: documentation and test scaffolding can run in parallel; final gate decision is a
  merge point.

### Phase 2: Database Publication

- Purpose: introduce Lidarr metadata and idempotent SQL seeds.
- Suggested tasks: `pcd.json` update, new ops for mappings/conditions/definitions, replay
  validation.
- Dependencies: requires Phase 1 gate and compatibility confirmation.

### Phase 3: Rollout Hardening

- Purpose: validate end-to-end readiness and publish support boundaries.
- Suggested tasks: integration verification, README/release updates, follow-up backlog definition.
- Integration focus: coordinate version matrix and rollout timing with consumer repo.

## Task Granularity Guidance

- Appropriate size: one logical change per task, 1-3 files.
- Split: large SQL bodies by semantic concern/table area.
- Combine: short documentation updates that share the same release context.

## Dependency Analysis

### Independent Tasks

- README/release drafting once scope is fixed.
- SQL seeds for distinct table areas after gate approval.
- Risk/decision documentation updates.

### Sequential Tasks

- Gate and compatibility tasks before DB publication.
- DB publication before rollout validation.
- Final readiness checks after SQL/data shape is fixed.

### Potential Bottlenecks

- `pcd.json` as shared gate and arr-type source of truth.
- Operation numbering and migration ordering in `ops/`.
- Cross-repo dependency on Praxrr compatibility timeline.

## Suggested Task Template

- Title format: `Task X.Y: <specific objective>`
- Dependency annotation: `Depends on [none|X.Y,...]`
- Instruction checklist: pre-read files, create/modify targets, implementation details, validation
  steps, expected outcome.
