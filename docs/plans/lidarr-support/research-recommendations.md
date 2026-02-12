# Lidarr Implementation Recommendations

## Executive Summary

Deliver Lidarr support in phased, testable increments instead of a large parity rewrite. The codebase already has reusable seams; the key is to standardize arr-type handling across API contracts, data models, and UX capabilities before adding advanced workflows. This approach minimizes regressions for existing Radarr/Sonarr users while providing predictable progress.

## Recommended Implementation Strategy

- High-confidence approach
  - Introduce a single capability map keyed by arr type (`radarr`, `sonarr`, `lidarr`) and consume it in backend routes and UI navigation.
  - Normalize arr type unions across server/shared/OpenAPI layers before feature expansion.
  - Implement `LidarrClient` endpoints required for first shipped scope (not every endpoint at once).
- Tradeoffs
  - Pros: safer rollout, fewer regressions, clear unsupported behavior.
  - Cons: temporary partial parity and additional short-term capability plumbing.

## Phased Rollout Suggestion

- Phase 1: Foundation and type parity
  - Enable instance create/test/manage for Lidarr.
  - Extend OpenAPI/shared unions and generated API types.
  - Add capability-gated UX and remove hardcoded two-app assumptions in onboarding surfaces.
- Phase 2: Core functional parity
  - Add Lidarr library/release API support and UI rendering.
  - Extend sync/media-management data paths to include Lidarr-compatible entities.
  - Add integration tests for Lidarr API behavior.
- Phase 3: Advanced workflows and polish
  - Decide and implement rename/upgrades support (or enforce explicit non-support with UX).
  - Harden E2E coverage and observability.
  - Stabilize docs and release strategy.

## Quick Wins

- Add `'lidarr'` to `VALID_TYPES` in `/arr/new` and `/arr/test`.
- Add Lidarr option and copy updates in `InstanceForm` and Arr landing page.
- Update `ArrType` enum in OpenAPI and regenerate `src/lib/api/v1.d.ts`.
- Add explicit unsupported UI state where backend currently throws `Unsupported instance type`.

## Future Enhancements

- Generate arr client types from OpenAPI to reduce manual drift.
- Add optional webhook-triggered refresh from Lidarr notifications.
- Introduce richer music-specific library views (artist/album/track granularity).
- Move to capability detection from server introspection instead of static mapping.

## Risk Mitigations

- Type drift mitigation
  - Compile-time exhaustive switches for arr type in core pathways.
- Contract drift mitigation
  - Keep OpenAPI schema + generated types as release gate.
- Regression mitigation
  - Add targeted tests for Radarr/Sonarr unchanged behavior alongside Lidarr coverage.
- UX confusion mitigation
  - Enforce explicit capability messaging for partially supported pages.

## Decision Checklist

- What exact feature set defines “Lidarr support” for first release?
- Are rename and upgrades required in v1 or deferred?
- Which Lidarr version(s) are officially supported?
- Should rollout be behind feature flag or default-on after merge?
- Is OpenAPI-generated typing in scope now or later?
