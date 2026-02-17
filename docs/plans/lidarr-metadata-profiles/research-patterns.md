# Pattern Research: lidarr-metadata-profiles

## Architectural Patterns

**PCD Entity Module Pattern**: Entity operations are split by concern (`create.ts`, `read.ts`, `update.ts`, `delete.ts`, `index.ts`) and execute through `writeOperation` with operation metadata and stable keys.

- Example: `src/lib/server/pcd/entities/delayProfiles/create.ts`

**Arr-Specific Table Dispatch Pattern**: Arr-specific entities use explicit app tables (`radarr_*`, `sonarr_*`, `lidarr_*`) with no implicit sibling fallback.

- Example: `src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`

**Sync Section Handler Pattern**: Each sync section has a handler that maps section lifecycle operations (`claim`, `complete`, `fail`, pending/schedule lookups) to `arrSyncQueries`.

- Example: `src/lib/server/sync/delayProfiles/handler.ts`

**Sync Orchestration Pattern**: `processor.ts` discovers pending section work per instance, claims section status atomically, then runs syncers sequentially inside instance scope.

- Example: `src/lib/server/sync/processor.ts`

**Capability Gate Pattern**: Feature surfaces are declared in `ArrSyncSurface`/`ArrCapabilities` and consumed by predicate helpers.

- Example: `src/lib/shared/arr/capabilities.ts`

## Code Conventions

- File/module naming is feature-scoped and lowercase/camelCase (`delayProfiles`, `mediaManagement`, `qualityProfiles`).
- Route server actions parse params/form data early, fail fast on invalid state, then delegate to entity/query modules.
- PCD write metadata includes explicit `operation`, `entity`, `stableKey`, `summary`, and `title` for auditability.
- Sync sections are registered by side-effect import of `handler.ts` modules in `src/lib/server/sync/processor.ts`.

## Error Handling

- Entity create/update throws explicit errors for invariant violations (duplicate names, invalid selection combinations).
- Route actions map known domain errors to 400/403, and unexpected failures to 500 with controlled messages.
- Sync runtime catches section-level exceptions and persists failed status + error via section handlers.
- Query-layer validation is strict and throws immediately when partial/invalid configurations are submitted.

## Testing Approach

- Arr-scoped entity operation tests validate dedicated table usage and Arr-gating behavior.
- Sync mapping/handler tests verify supported sections and stable section order assumptions.
- Capability regression tests assert exact workflow/sync surface contracts for Radarr/Sonarr/Lidarr.
- Job and query tests validate deterministic rename propagation and fail-fast validation semantics.
- Relevant suites:
- `src/tests/arr/lidarrQualityDefinitionsEntityOperations.test.ts`
- `src/tests/jobs/lidarrSync.test.ts`
- `src/tests/jobs/arrSyncLidarrConfigPropagation.test.ts`
- `src/tests/upgrades/lidarrCapabilityGates.test.ts`

## Patterns to Follow

- Use delay profile section as baseline for metadata profile selection/config table shape (single selection per instance).
- Use quality profile syncer style for name-based reconciliation and remote state diffing in Lidarr.
- Keep metadata profile capability and section support explicit: add support for Lidarr only in both capability and sync matrices.
- Reuse existing value-guard updates for child table boolean toggles to keep conflict behavior aligned with current PCD ops.
- Follow existing docs/tests pattern: add targeted regression tests before wiring broad UI behavior.
