# Research: Business Logic

## Executive Summary

The core business requirement is domain correctness: Lidarr must no longer behave like Sonarr for media-management persistence and sync. Users need predictable Lidarr-native CRUD, import/export, and sync behavior with transparent migration from legacy reused data. Success depends on deterministic migration semantics, explicit collision handling, and preserving operator trust through clear diagnostics.

## User Stories

- Primary user story:
  - As a Lidarr operator, I want naming/media-settings/quality-definition presets saved as first-class Lidarr entities so my music workflows are not constrained by TV-oriented models.
- Secondary user stories:
  - As an API/automation user, I want `lidarr_*` entities available in import/export so backups and portability remain deterministic.
  - As an administrator, I want migration outcomes (migrated/skipped/conflicted) to be explicit so I can resolve edge cases without guessing.

## Business Rules

- Rule 1: Lidarr defaults must not use Sonarr-backed entities in CRUD/list/read paths.
  - Validation: route/server actions must resolve `arr_type = 'lidarr'` to `lidarr_*` tables.
  - Exception: temporary read-compatibility may exist during migration window only.
- Rule 2: Migration must be deterministic and idempotent.
  - Validation: rerunning migration produces no duplicate records and stable outcomes.
- Rule 3: Collision policy must be explicit.
  - Validation: same-name conflicts across families must use documented precedence and logs.
- Rule 4: Quality mappings must be complete for Lidarr.
  - Validation: mapping coverage exists before quality-definition writes/sync.

## Workflows

- Primary flow:
  - User creates/edits Lidarr presets from media-management pages and data persists to dedicated Lidarr entities.
  - Sync picks Lidarr-native config names and applies to Lidarr instances without reuse warnings.
- Error recovery flow:
  - Validation errors return explicit failure context (input errors, mapping gaps, permission/layer constraints).
  - Migration conflicts provide deterministic skip/report behavior and retry-safe reruns.

## Domain Concepts

- `arr_instances` and `database_instances` define scope and target behavior.
- `arr_sync_media_management` links instances to named media-management configs.
- Existing media-management entities are split by family; Lidarr requires its own first-class family.
- `quality_api_mappings` is a dependency for valid quality-definition behavior.

## Success Criteria

- Lidarr CRUD/list/get paths are first-class and no longer default to Sonarr-backed storage.
- Import/export contracts support `lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions`.
- Sync path no longer depends on reuse behavior and no longer emits reuse-specific warnings by default.
- Migration executes deterministically with explicit reporting of moved/skipped/conflicting records.

## Open Questions

- Should new Lidarr tables mirror Sonarr shape initially, or adopt Lidarr-native naming semantics immediately?
- Should migration copy all legacy Lidarr-tagged rows or only rows referenced by sync configuration?
- What is the required deprecation window for read-compatibility with legacy reused rows?

## Evidence (Code + Issue)

- `src/lib/server/pcd/entities/mediaManagement/naming/read.ts`
- `src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts`
- `src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts`
- `src/lib/server/sync/mediaManagement/syncer.ts`
- `src/lib/server/db/queries/arrSync.ts`
- `docs/api/v1/schemas/pcd.yaml`
- <https://github.com/yandy-r/profilarr/issues/130>
