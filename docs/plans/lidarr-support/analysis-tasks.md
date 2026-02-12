# Analysis: Task Structure (lidarr-support)

## Executive Summary

The recommended plan shape is three phases with a feed-forward dependency chain: establish Arr-type and capability foundations, deliver core Lidarr data/sync functionality, then finalize operational parity and regression hardening. The plan should maximize parallelism inside each phase by splitting schema/type work from UI generalization and client/route work, while enforcing strict sequencing around generated types and shared mappings.

## Recommended Phase Structure

### Phase 1: Foundation and Type Parity

- Purpose: make `lidarr` valid and consistent across onboarding, schemas, generated/shared types, and capability metadata.
- Suggested tasks:
  - Extend onboarding/test allowlists and instance form options.
  - Update `ArrType`/entity schemas and regenerate `src/lib/api/v1.d.ts`.
  - Align shared PCD/sync type unions.
  - Add initial capability-gated UX messaging for unsupported surfaces.
- Parallelization notes:
  - Schema/type work can run parallel to UI metadata/copy updates.
  - Regeneration must happen after schema edits and before downstream compile-sensitive changes.

### Phase 2: Core Lidarr Data and Sync

- Purpose: enable useful Lidarr behavior through library/release routes and sync compatibility.
- Suggested tasks:
  - Implement missing `LidarrClient` methods.
  - Add `lidarr` branches in library and release APIs.
  - Extend sync mappings/media-management handling strategy.
  - Add route/sync tests for new paths and existing-app regressions.
- Dependencies:
  - Requires Phase 1 Arr-type/type-system alignment.
  - Sync mapping changes depend on chosen PCD entity strategy.

### Phase 3: Operational Parity and UX Polish

- Purpose: close deliberate gaps (rename/upgrades) and harden user-facing behavior.
- Suggested tasks:
  - Implement or capability-gate rename/upgrades for Lidarr.
  - Generalize remaining dual-app UI controls (including condition controls).
  - Add E2E and mixed-environment regression coverage.
  - Finalize rollout/readiness documentation.
- Integration focus:
  - Ensure capability map drives both backend guards and UI affordances.

## Task Granularity Guidance

- Appropriate task size: each task should target a coherent scope in 1-3 files where possible.
- Tasks to split:
  - schema update vs generated types vs shared type alignment.
  - capability metadata introduction vs per-component UI rewiring.
- Tasks to combine:
  - tightly coupled route + client method additions when owned by one track.

## Dependency Analysis

### Independent Tasks

- UI metadata/copy updates in onboarding surfaces.
- OpenAPI enum updates and documentation alignment.
- Unsupported-state UX content updates once capability keys are defined.

### Sequential Tasks

- `docs/api/v1/schemas/*` changes -> regenerate `src/lib/api/v1.d.ts`.
- shared PCD/sync unions update after schema contracts are stable.
- route branches after required Lidarr client methods exist.

### Potential Bottlenecks

- shared schema files (`arr.yaml`, `pcd.yaml`) and generated types (`src/lib/api/v1.d.ts`) are convergence points.
- sync mapping and media-management strategy touches shared backend/UI assumptions.
- rename/upgrades scope decisions can block final parity and test matrix completion.

## Suggested Task Template

- Title format: `[Issue #] Area: Goal`.
- Dependency annotation format: `Depends on [Task IDs]` and issue mapping `Issue: #n`.
- Instruction checklist:
  - Explicit file targets (1-3 files per task).
  - Expected behavior change and validation command(s).
  - Regression considerations for Radarr/Sonarr.
  - Mapping to issue `#1`-`#5` with umbrella linkage `#6`.
