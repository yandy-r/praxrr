# Analysis: Context Synthesis (lidarr-support)

## Executive Summary

Profilarr should treat `lidarr` as a first-class Arr type by extending existing seams rather than creating a new pipeline. The feature should follow the current instance onboarding/validation, client factory, and section-based sync orchestration, while closing gaps in schemas, route branches, and UI capability messaging. A phased rollout is recommended: type/schema and onboarding parity first, then core library/releases and sync, then operational parity (rename/upgrades) with explicit gating when needed.

## Architecture Context

- System Structure: `arr_instances` persistence -> `createArrClient` factory -> type-specific route handlers (`/api/v1/arr/library`, `/api/v1/arr/releases`) and section-based sync jobs (`arrSync`) with shared client behavior.
- Data Flow: Creation/test paths validate Arr type and connectivity, persist instance credentials, then routes/jobs use the factory-selected client to call Lidarr API v1 endpoints.
- Integration Points: Onboarding routes/components, OpenAPI schemas and generated typings, shared PCD types, route branches, sync mappings, and capability-aware UI surfaces.

## Critical Files Reference

- `src/routes/arr/new/+page.server.ts`: onboarding validation and create path; currently blocks `lidarr`.
- `src/routes/arr/test/+server.ts`: test endpoint allowlist and client connectivity checks.
- `src/routes/arr/components/InstanceForm.svelte`: app selector/copy and onboarding UX assumptions.
- `src/lib/server/utils/arr/factory.ts`: central client factory that already includes Lidarr branch.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr API v1 client methods required by routes/sync.
- `src/routes/api/v1/arr/library/+server.ts`: per-type library branch + caching contract.
- `src/routes/api/v1/arr/releases/+server.ts`: per-type release search branch + error envelope.
- `src/lib/server/jobs/handlers/arrSync.ts`: section orchestration and sync execution model.
- `src/lib/server/sync/mappings.ts`: sync type mappings and section registration strategy.
- `docs/api/v1/schemas/arr.yaml`: source of `ArrType` in contract layer.
- `docs/api/v1/schemas/pcd.yaml`: source of PCD entity enums affected by Lidarr media-management support.
- `src/lib/api/v1.d.ts`: generated types that must be regenerated after schema changes.
- `src/lib/shared/pcd/types.ts`: shared Arr/PCD unions used by server and UI.
- `src/lib/server/jobs/handlers/arrRename.ts`: current rename type constraints.
- `src/routes/arr/[id]/upgrades/+page.server.ts`: current upgrades type constraints.

## Patterns to Follow

- Arr-Type Branching: Resolve `ArrType` once and branch to app-specific logic with normalized response contracts.
- Client Factory + Base Client: Keep transport/auth shared and implement app differences in subclasses selected by `createArrClient`.
- Section-Based Sync Orchestration: Reuse existing section handlers and registry; do not create a Lidarr-only sync path.
- Contract-First Type Alignment: Update OpenAPI schemas first, regenerate types, then align shared/runtime unions.
- Capability-Gated UX: Render explicit unsupported states for unimplemented Lidarr operations.

## Cross-Cutting Concerns

- Security: Keep API keys write-only in forms/logs and preserve existing error envelope discipline.
- Performance: Preserve current caching and avoid regressions in route latency for existing Arr types.
- Testing: Pair schema/type changes with typecheck and targeted regressions to ensure Radarr/Sonarr behavior remains stable.

## Parallelization Opportunities

- Independent work areas:
  - OpenAPI/shared/generated type alignment.
  - UI metadata/capability message generalization.
  - Lidarr client + library/releases branching (after type foundation).
- Coordination hotspots:
  - `docs/api/v1/schemas/*` and `src/lib/api/v1.d.ts` regeneration sequencing.
  - Capability map consistency between backend routes and UI controls.
  - Issue mapping requirement for `#1`-`#5` under umbrella `#6`.

## Implementation Constraints

- Technical: `ArrType` must stay aligned across schemas, generated types, shared types, and runtime checks.
- Business: Unsupported features (rename/upgrades) must be explicit; no silent backend-only failures.
- Operational: Existing Radarr/Sonarr behavior cannot regress during Lidarr rollout.

## Planning Recommendations

- Phase 1 (Issue #1): onboarding + schema/type parity + base capability metadata.
- Phase 2 (Issues #2 and #3): core route/client/sync support with endpoint and job validation.
- Phase 3 (Issues #4 and #5): UI control generalization + rename/upgrades decision + regression/E2E hardening.
