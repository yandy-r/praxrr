# Analysis: Context Synthesis

## Executive Summary

Lidarr support extends the existing SQL-first data model by introducing `arr_type='lidarr'` rows and
gating rollout through manifest metadata. The core strategy is compatibility-first: ensure Praxrr
consumer readiness before publishing Lidarr data. Work should stay additive and idempotent, reusing
shared-table patterns unless schema validation forces dedicated Lidarr entities.

## Architecture Context

- System Structure: `praxrr-db` publishes ordered SQL operations and metadata; `yandy-r/praxrr`
  consumes arr-scoped rows and applies them to Arr APIs.
- Data Flow: new ops seed Lidarr rows into shared tables with guard predicates; `pcd.json`
  advertises support and minimum compatible consumer version.
- Integration Points: `pcd.json`, new `ops/<next-number>.*.sql`, `README.md`, and cross-repo release
  coordination.

## Critical Files Reference

- `docs/plans/lidarr-support/shared.md`: consolidated architecture/files/patterns baseline.
- `docs/plans/lidarr-support/feature-spec.md`: scope, success criteria, risk, and phased rollout.
- `docs/plans/lidarr-support/research-technical.md`: schema/table implications and file impact.
- `docs/plans/lidarr-support/research-business.md`: business constraints and acceptance
  requirements.
- `docs/plans/lidarr-support/research-external.md`: Lidarr endpoint and mapping constraints.
- `docs/plans/lidarr-support/research-recommendations.md`: rollout sequencing and mitigation
  strategy.
- `docs/plans/lidarr-support/research-ux.md`: user workflow and error-state expectations.

## Patterns to Follow

- Idempotent Arr-Type Seeding: `NOT EXISTS` + restrictive predicates
  (`ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql`).
- Arr-Type Discriminator Expansion: shared-table row extension + manifest alignment (`pcd.json`,
  `ops/30.fix-720p-web-dl-scoring.sql`).
- Ordered Operation Evolution: next-numbered SQL operations
  (`ops/34.add-remux-negation-to-release-group-missing.sql`).

## Cross-Cutting Concerns

- Security: seeded data must remain data-only; avoid unvalidated values in SQL.
- Performance: preserve index-friendly joins and keep operations replay-safe.
- Testing: mixed-arr regression expectations and replay validation are mandatory.
- Release Coordination: publish only when `praxrr.minimum_version` gate is satisfied.

## Parallelization Opportunities

- Independent: docs/release notes, SQL workstreams per table area, and compatibility documentation.
- Coordination hotspots: release gate version, shared manifest changes, and cross-repo readiness
  checks.

## Implementation Constraints

- External schema dependency may constrain dedicated `lidarr_*` tables.
- `pcd.json` must carry explicit `arr_types` and minimum version guard.
- All operations must remain idempotent and additive.

## Planning Recommendations

- Phase 1: consumer compatibility and gate definition.
- Phase 2: DB metadata + Lidarr SQL seeding with replay validation.
- Phase 3: rollout validation, documentation, and hardening.
