# Lidarr Support - Technical Specification Analysis

## Executive Summary

The technical path is to extend current SQL-first patterns with Lidarr-aware data while preserving
existing Radarr/Sonarr query contracts. The repository currently seeds extensive arr-scoped data via
`ops/*.sql` and identifies supported apps in `pcd.json`, so Lidarr support can be delivered by
additive operations and metadata updates. Main technical risk is semantic mismatch: music-specific
Lidarr models do not always fit existing video-oriented assumptions.

## Architecture Approach

- Component/service boundaries:
  - Keep `praxrr-db` as canonical configuration data source.
  - Keep runtime orchestration and API consumption logic in `yandy-r/praxrr`.
- Integration points with existing system:
  - Update `pcd.json` `arr_types` to include `lidarr`.
  - Add SQL operation(s) that insert Lidarr-scoped records in existing shared tables where supported
    by schema (`arr_type` discriminator pattern).
  - Extend any required mapping entities (for example quality API mappings) with Lidarr-specific API
    names/constraints.

## Data Model Implications

- Entities/tables/collections:
  - Existing shared entities that already carry `arr_type` should receive `lidarr` rows where
    semantics fit.
  - Existing per-app structures visible in seed data include `radarr_media_settings`,
    `sonarr_media_settings`, `radarr_naming`, `sonarr_naming`, `radarr_quality_definitions`, and
    `sonarr_quality_definitions` (`ops/0.rosettarr.sql:25003`, `ops/0.rosettarr.sql:25004`,
    `ops/0.rosettarr.sql:25008`, `ops/0.rosettarr.sql:25009`, `ops/0.rosettarr.sql:25013`,
    `ops/0.rosettarr.sql:25133`).
  - Decision needed: introduce `lidarr_*` app-specific tables (if schema supports) or initially map
    Lidarr through shared + existing compatible structures.
- Indexes and migration considerations:
  - Follow ordered operation-file pattern and idempotent guards (`NOT EXISTS`, restrictive
    predicates).
  - Ensure joins used by consumer queries remain index-friendly when lidarr rows are added
    (especially arr_type and profile-name joins).

## Task 1.2 Inventory Baseline

- Authoritative Task 1.2 artifact: `docs/plans/lidarr-support/lidarr-seed-inventory.md`.
- Inventory rows now lock pre-SQL targets and key assumptions for: `quality_profiles`,
  `custom_formats`, `custom_format_conditions`, `quality_profile_custom_formats`, quality
  definitions, and quality-definition mapping joins.
- Rows are intentionally status-tagged (`ready` vs `blocked`) so Task 1.3 can finalize one schema
  path before Phase 2 SQL starts.

## Schema Decisions Still Open (Can Force Dedicated `lidarr_*` Tables)

- `quality_profiles` and `custom_formats` need schema confirmation for arr-scoped uniqueness
  (`arr_type`) before shared-path inserts are possible.
- Quality definitions still require a hard target decision: shared arr-typed target vs dedicated
  `lidarr_quality_definitions`.
- `quality_api_mappings` needs explicit Lidarr mapping coverage confirmation; lack of deterministic
  `arr_type='lidarr'` mapping rows blocks quality definition seeding and can force dedicated Lidarr
  mapping entities.

## API Design Considerations

- Endpoints/interfaces:
  - No new endpoint in this repo; contract is data consumed by Praxrr.
  - Praxrr-facing query paths must accept/handle `arr_type='lidarr'` consistently.
- Request/response shape guidance:
  - Preserve existing payload shape where possible and add Lidarr-compatible enum/value support.
  - Favor additive fields over breaking changes.
- Error handling model:
  - Fail fast on unsupported mapping/quality names.
  - Surface deterministic migration-time errors for duplicate/missing dependency records.

## System Constraints

- Performance:
  - Large seed operations already exist; Lidarr additions should remain batched and idempotent.
- Security:
  - Maintain current trust boundary; avoid introducing unvalidated free-form data that downstream
    code executes.
- Compatibility:
  - Protect existing Radarr/Sonarr behavior and maintain backward compatibility of data contracts.
  - Coordinate release order so Praxrr consumes new lidarr rows only once its parser/mapping logic
    is ready.

## File-Level Impact Preview

- Likely files to create:
  - One or more new `ops/<next-number>.*.sql` files for Lidarr rows/mappings.
- Likely files to modify:
  - `pcd.json` for supported arr types and possibly minimum consumer version.
  - `README.md` for support surface documentation.
  - potentially earlier operation docs only if cross-referenced by convention.
