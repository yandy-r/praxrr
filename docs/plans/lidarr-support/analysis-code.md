# Analysis: Code Patterns (lidarr-support)

## Executive Summary

The codebase already supports Arr integrations through shared flows, so Lidarr support should extend those existing seams with minimal branching expansion. The core implementation burden is not bootstrapping new infrastructure, but making Arr-type handling exhaustive and consistent across routes, sync mappings, schemas, shared types, and UI assumptions. Contract drift is the highest technical risk, so schema-first updates and regeneration must gate downstream code changes.

## Related Components

- `src/routes/arr/new/+page.server.ts`: onboarding allowlist and create validation.
- `src/routes/arr/test/+server.ts`: connectivity test allowlist and factory-based client checks.
- `src/lib/server/utils/arr/factory.ts`: central dispatch to `RadarrClient`, `SonarrClient`, `LidarrClient`.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr v1 endpoint client implementation area.
- `src/routes/api/v1/arr/library/+server.ts`: library branch, caching, normalized response.
- `src/routes/api/v1/arr/releases/+server.ts`: release search branch and standardized errors.
- `src/lib/server/jobs/handlers/arrSync.ts`: section-driven sync orchestration.
- `src/lib/server/sync/mappings.ts`: sync Arr type and section mapping surface.
- `src/lib/shared/pcd/types.ts`: shared Arr and entity unions.
- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`: binary app toggle assumptions.
- `docs/api/v1/schemas/arr.yaml` and `docs/api/v1/schemas/pcd.yaml`: contract source files.
- `src/lib/api/v1.d.ts`: generated output that must stay schema-aligned.

## Implementation Patterns

**Arr-Type Branching**: resolve instance type, run type-specific logic, preserve common envelope.

- Example: `src/routes/api/v1/arr/library/+server.ts`
- Apply to: onboarding, API routes, sync handlers.

**Client Factory + Base Client Reuse**: keep shared HTTP/auth semantics in base, specialize per app in clients.

- Example: `src/lib/server/utils/arr/factory.ts`
- Apply to: route handlers, sync sections, connection tests.

**Section-Based Sync Orchestration**: preserve section registry execution path regardless of Arr type.

- Example: `src/lib/server/jobs/handlers/arrSync.ts`
- Apply to: sync compatibility and media-management decisions.

**Contract-First Type Alignment**: schema changes first, generated/shared/runtime types next.

- Example: `docs/api/v1/schemas/arr.yaml`, `docs/api/v1/schemas/pcd.yaml`, `src/lib/api/v1.d.ts`
- Apply to: all arr/pcd unions.

**Capability-Gated UX**: explicit unsupported states for partial parity surfaces.

- Example: `src/routes/arr/[id]/upgrades/+page.server.ts`
- Apply to: rename/upgrades and dual-app UI controls.

## Integration Points

### Files to Create

- None required by current architecture.

### Files to Modify

- `src/routes/arr/new/+page.server.ts`: allow `lidarr`, maintain validation and error shape.
- `src/routes/arr/test/+server.ts`: allow `lidarr`, test Lidarr system-status path.
- `src/routes/arr/components/InstanceForm.svelte`: make app options/copy metadata-driven.
- `src/routes/api/v1/arr/library/+server.ts`: add Lidarr data branch and preserve cache/error behavior.
- `src/routes/api/v1/arr/releases/+server.ts`: add Lidarr release branch and preserve envelopes.
- `src/lib/server/utils/arr/clients/lidarr.ts`: implement required methods for routes/sync.
- `src/lib/server/sync/mappings.ts`: include Lidarr handling or explicit gating.
- `src/lib/shared/pcd/types.ts`: include `lidarr` and relevant entity updates.
- `docs/api/v1/schemas/arr.yaml`: extend `ArrType` and route contracts.
- `docs/api/v1/schemas/pcd.yaml`: extend entity enums where needed.
- `src/lib/api/v1.d.ts`: regenerate after schema edits.
- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`: remove binary app assumptions.

## Conventions

- Naming: Arr type unions must be exhaustive and shared across server/UI.
- Error Handling: keep structured route errors (`{ error: string }`, form `fail()` patterns).
- Testing: preserve fast connection tests and add targeted route/sync regressions.

## Gotchas and Warnings

- Lidarr API version differs from Radarr/Sonarr assumptions; endpoint/payload mismatches are likely if reused blindly.
- Schema/shared/runtime union drift will break typecheck or cause inconsistent behavior.
- Rename/upgrades remain constrained today; must be consciously implemented or capability-gated.
- Existing UI app toggles are often hardcoded for two apps and require generalized metadata.
- Sync mappings may need entity strategy decisions for media-management parity.

## Task Guidance by Area

- database: no `arr_instances` migration expected, but shared PCD entity typing strategy must be explicit.
- api: update schemas + regenerate types before route implementation changes.
- ui: centralize app metadata/capabilities and eliminate Radarr/Sonarr-only controls.
