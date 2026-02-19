# Analysis: Code Patterns

## Executive Summary

This repository is operation-driven; implementation centers on SQL seeds and metadata rather than runtime code. Existing Radarr/Sonarr patterns provide direct templates for Lidarr rows through `arr_type`-scoped operations. The plan should prioritize deterministic SQL, explicit manifest gating, and documentation updates.

## Related Components

- `pcd.json`: supported arr types and `praxrr.minimum_version` gate.
- `README.md`: user-facing support scope and compatibility notes.
- `ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql`: idempotent insert pattern.
- `ops/30.fix-720p-web-dl-scoring.sql`: arr-type-scoped update/insert pattern.
- `ops/34.add-remux-negation-to-release-group-missing.sql`: custom format condition insertion pattern.
- `ops/0.rosettarr.sql`: baseline entity/table landscape.

## Implementation Patterns

**Idempotent Shared-Table Seeding**: use `INSERT ... SELECT ... WHERE NOT EXISTS` for replay-safe rows.

- Example: `ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql:8`
- Apply to: Lidarr profile/custom-format mapping seed tasks.

**Arr-Type-Scoped Updates**: guard updates by `arr_type` and exact keys to avoid cross-app mutation.

- Example: `ops/30.fix-720p-web-dl-scoring.sql:8`
- Apply to: corrective score or mapping adjustments.

**Condition-Level Arr Typing**: set explicit arr scope on custom format condition rows.

- Example: `ops/34.add-remux-negation-to-release-group-missing.sql:8`
- Apply to: Lidarr condition seeds.

## Integration Points

### Files to Create

- `ops/<next-number>.add-lidarr-support-*.sql`: new additive Lidarr seed operations.

### Files to Modify

- `pcd.json`: add `lidarr` in `arr_types`; adjust `praxrr.minimum_version`.
- `README.md`: document Lidarr support and compatibility expectations.

## Conventions

- Naming: keep `arr_type='lidarr'` explicit and consistent.
- Error handling: fail fast on invalid mappings; avoid silent coercion.
- Testing: verify operation order, SQL diff scope, and replay idempotency.

## Gotchas and Warnings

- Publishing before consumer readiness is a release risk.
- Music semantics may not map 1:1 to existing video-focused assumptions.
- Schema choice (shared vs dedicated Lidarr tables) must follow dependency validation.

## Task Guidance by Area

- database: seed shared tables with guarded Lidarr rows.
- api: maintain current contract shape; ensure consumer arr-type compatibility.
- ui: no direct repo UI work; keep UX expectations reflected in docs and release guidance.
