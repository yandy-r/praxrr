# Lidarr Business Logic Research

## Executive Summary

Profilarr’s current product behavior is explicitly optimized for `radarr` and `sonarr`, while `lidarr` exists only in low-level client plumbing. Adding Lidarr with equivalent value means extending instance onboarding, sync orchestration, library visibility, and operational workflows (rename/upgrades/cleanup) without regressing existing Arr behavior. The critical business rule is consistency: users should not need a separate mental model for Lidarr.

## User Stories

- Primary:
  - As a Profilarr admin, I want to add and manage Lidarr instances so my music stack uses the same governance model as Radarr/Sonarr.
  - As a Profilarr admin, I want Lidarr sync to reuse the same quality profile, delay profile, and media-management workflows so operations stay uniform across apps.
- Secondary:
  - As an operator, I want clear status when a feature is unsupported for Lidarr (instead of hidden failures) so I can trust the platform behavior.
  - As an end user, I want to inspect Lidarr library/release data with the same confidence signals (`isProfilarrProfile`, score context) available in current flows.

## Business Rules

- Core rules
  - Arr instances must pass the same creation, uniqueness, and connection test guarantees (`src/routes/arr/new/+page.server.ts`, `src/routes/arr/test/+server.ts`).
  - Sync jobs must remain section-oriented and idempotent (`qualityProfiles`, `delayProfiles`, `mediaManagement`) via the existing registry and queue model (`src/lib/server/jobs/handlers/arrSync.ts`).
  - Library/release APIs must preserve current validation and error shape contracts (`src/routes/api/v1/arr/library/+server.ts`, `src/routes/api/v1/arr/releases/+server.ts`).
- Validations and exceptions
  - Arr type allowlists currently block Lidarr in onboarding/test paths (`VALID_TYPES` includes only Radarr/Sonarr).
  - Several operational areas intentionally gate to Radarr/Sonarr only and must either be expanded or explicitly excluded with UX messaging:
    - rename (`src/routes/arr/[id]/rename/+page.server.ts`, `src/lib/server/jobs/handlers/arrRename.ts`)
    - upgrades (Radarr-only: `src/routes/arr/[id]/upgrades/+page.server.ts`)

## Workflows

- Primary flow
  - Add instance -> validate connection -> save -> configure sync -> execute/manual schedule -> inspect results in library/release pages.
  - Existing reference paths:
    - onboarding: `src/routes/arr/new/+page.server.ts`, `src/routes/arr/components/InstanceForm.svelte`
    - sync config/execution: `src/routes/arr/[id]/sync/+page.server.ts`, `src/lib/server/jobs/handlers/arrSync.ts`
    - library/release consumption: `src/routes/arr/[id]/library/+page.svelte`, `src/routes/api/v1/arr/library/+server.ts`, `src/routes/api/v1/arr/releases/+server.ts`
- Error recovery flow
  - Connection failures stay local to creation/test UI and do not persist invalid instances.
  - Sync failures are section-scoped and rescheduled according to existing job strategy.
  - Unsupported-type behavior should move from backend-only errors to explicit UI capability signaling.

## Domain Concepts

- Arr instance lifecycle (`arr_instances`)
  - Source of truth for app type, credentials, and enablement.
- Sync sections
  - Stable operational boundary for scheduled/manual pushes; this abstraction should remain unchanged.
- PCD entity families
  - Current media-management entities are split by arr type (`radarr_*`, `sonarr_*`) and need explicit Lidarr expansion for parity.
- Library profile alignment
  - `isProfilarrProfile` and profile-name mappings are key trust indicators in UI and should be preserved for Lidarr.

## Success Criteria

- `lidarr` can be created/tested/managed through standard instance flows with no special admin workaround.
- Sync configuration UI can select Lidarr-compatible naming/media/quality definitions from the same PCD source.
- At least one customer-visible read path (library and/or releases) returns valid Lidarr data with profile metadata.
- Unsupported advanced features are intentionally marked as unsupported (or implemented), not silently broken.
- Existing Radarr/Sonarr behavior remains unchanged by regression tests.

## Open Questions

- Is true “same functionality” expected for v1, or is a phased parity acceptable (core sync first, advanced ops later)?
- Are Lidarr upgrades a required launch feature, given current upgrades are Radarr-only?
- Should rename be required at launch for Lidarr, or deferred with explicit capability flags?
- What minimum feature set constitutes “done” for stakeholders: onboarding + sync only, or onboarding + sync + library + operations?
