# Task Structure Analysis: lidarr-metadata-profiles

## Executive Summary

Lidarr metadata profiles introduce a Lidarr-only PCD entity with four new cache tables, a dedicated sync section, API routes, Lidarr client methods, and a suite of UI views. The work sits on top of the existing `pcd_ops`/cache pipeline, Arr sync registry, and UI patterns already used by quality profiles, delay profiles, and media management. The required work spans database schema/migrations, shared types and contracts, entity CRUD, sync configuration, API routes, sync handlers, Lidarr client calls, and UI + testing. A phased approach that aligns schema foundations, core service surface, and UI/test polish keeps the dependency path clear while enabling some components to be developed in parallel.

## Recommended Phase Structure

### Phase 1: Foundation

**Purpose:** Establish the schema, typing, and capability scaffolding so that other layers can build against concrete tables and entities.  
**Suggested Tasks:**

- Add the `arr_sync_metadata_profiles_config` table migration plus `seedBuiltInBaseOps` registration to create the four `lidarr_` PCD tables (primary, secondary, release) used by metadata profiles.
- Extend `packages/praxrr-app/src/lib/shared/pcd/types.ts`, `display.ts`, and `portable.ts` with the new tables, rows, portable model, and `ENTITY_TYPES` entry; update `packages/praxrr-app/src/lib/shared/pcd/database/cache.ts` helpers for metadata profiles.
- Wire the capability surface (`packages/praxrr-app/src/lib/shared/arr/capabilities.ts`) and entity registry (`packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`) so metadata profiles show up in Arr sync gating and PCD auto-alignment.
- Add Lidarr-specific metadata profile API types to `packages/praxrr-app/src/lib/server/utils/arr/types.ts`.  
  **Dependencies:** Migration + type additions must land before entity CRUD, API routes, or sync handlers reference the new tables/types.  
  **Parallelization:** Schema/migration work can proceed alongside capability + portable type updates; entity registry changes can happen once types exist while Lidarr client type additions can proceed without waiting on cache helpers.

### Phase 2: Core Implementation

**Purpose:** Implement the runtime behavior (CRUD, API surface, sync job, Arr client) that lets metadata profiles be created in PCD and synced to Lidarr.  
**Suggested Tasks:**

- Create the `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/{create,read,update,delete,index}.ts` modules following the delay-profile pattern (writeOperation metadata, value guards, stable key on `name`).
- Add serialization/deserialization/clone/validate hooks (`serialize.ts`, `deserialize.ts`, `clone.ts`, `validate.ts`) and expose metadata profile display types for portable export/import.
- Build API handlers at `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts` and the `[id]/+server.ts` child route, wiring `pcd_ops` writes and validation similar to other entity routes.
- Extend `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts` with metadata profile CRUD methods plus optional schema call; update `packages/praxrr-app/src/lib/server/utils/arr/types.ts` accordingly.
- Introduce the `metadataProfiles` sync section (handler, syncer, transformer) under `packages/praxrr-app/src/lib/server/sync/metadataProfiles`, update `sync/types.ts`, `sync/mappings.ts`, `sync/processor.ts`, and add the new arrSync query helpers in `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`.  
  **Dependencies:** Requires Phase 1 schema/types plus migration registration before touching entity reads/writes or sync handlers. Migration must run before API or sync tries to build caches.  
  **Parallelization:** The Arr client updates and API route wiring can proceed in parallel with entity CRUD once the type definitions exist; sync handler construction can start once the cache read helpers and arrSync queries are available, while arrSync query + config table work can run concurrently with handler development.

### Phase 3: UI & Testing

**Purpose:** Surface metadata profile management to users and prove correctness via tests.  
**Suggested Tasks:**

- Build list/create/edit pages under `packages/praxrr-app/src/routes/metadata-profiles/` (list card/table views, sticky card header, create/edit forms) reusing StickyCard, ViewToggle/ActionsBar, `CloneModal`, and the new `CheckboxGroup.svelte` component for the three checkbox sections.
- Ensure Lidarr instance sync settings (`packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` and UI stores) can load/select metadata profiles, and enforce `arr_type === 'lidarr'` gating in the dropdown.
- Add tests covering entity CRUD, arrSync logic, transformer accuracy, and UI flows (unit tests for syncer, entity ops, and a focused Playwright/E2E spec for the metadata profile list/edit lifecycle).  
  **Dependencies:** Requires API routes + entity CRUD (Phase 2) before UI components can fetch/save real data; sync config UI needs arrSync queries for metadata profiles.  
  **Parallelization:** UI can be split between list, edit, and instance-sync pages, allowing a frontend engineer to work on forms/cards while another builds sync dropdowns/tests. Testing can proceed once backend APIs are functional; test fixtures can reuse quality-profile mocks.

## Task Granularity Recommendations

### Appropriate Task Sizes

- Keep schema/migration work self-contained (single migration file plus seed registration) to ensure database state is well-defined before downstream work.
- Group entity CRUD files (`create`, `read`, `update`, `delete`, `index`) into a single Task but allow separate PRs if needed; the create/read/update/delete files share patterns and can be reviewed as a batch.
- Treat the sync section (handler + syncer + transformer + arrSync queries) as a cohesive Task because the consistency between configuration, transformation, and API calls is critical.

### Tasks to Split

- Split the UI work into (a) metadata profile management views (list/create/edit forms) and (b) Lidarr instance sync integration (dropdown, sync config store updates). Each has different dependencies and reviewers.
- Divide arrSync query additions into (a) config getters/setters and (b) pending/scheduled logic to avoid a monolithic migration of the existing query module.

### Tasks to Combine

- Combine Lidarr client method additions with the new API types (`packages/praxrr-app/src/lib/server/utils/arr/types.ts`) because they evolve together and share acceptance criteria.
- Pair the portable/clone/serialize updates (`serialize.ts`, `deserialize.ts`, `clone.ts`, `portable.ts`) with entity validation changes to keep the PCD import/export surface coherent.

## Dependency Analysis

### Independent Tasks

- Capability/capability-surface updates (`arr/capabilities.ts`) can land independently of entity CRUD because they merely expose the new surface without touching data.
- The CheckboxGroup component and frontend UX scaffolding can be prototyped early; they do not require the API to be fully implemented if mock data is used.
- Documentation updates (notes on metadata profile defaults) can proceed while backend work is ongoing.

### Sequential Dependencies

- Database migration → shared type extensions → entity CRUD/api routes → sync handler & arrSync queries → UI/test. Each layer depends on its predecessor to know what tables/types/APIs exist.
- Sync processor changes (`sync/processor.ts`, `sync/mappings.ts`) must wait for the new section handler and arrSync queries to exist so they can reference items like `metadataProfiles` in the `SectionType` union and `SUPPORTED_SYNC_SECTIONS`.

### Potential Bottlenecks

- The arrSync query module already spans many sections; adding metadata-profile logic requires careful coordination to avoid regressions in `getPendingSyncs`, `getScheduledConfigs`, and status setters.
- Sync handler/test coverage needs live Arr client interactions; without a mocked Lidarr response that includes the full set of types/statuses, iteration may stall.
- UI validation around the three checkbox groups must enforce at least one primary type and at least one release status; misunderstanding Lidarr's rules (from `MetadataValidator.cs`) could lead to backend sync errors.

## File-to-Task Mapping

### Files to Create

| File                                                                          | Task                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_add_lidarr_metadata_profiles.ts`       | Create the app DB `arr_sync_metadata_profiles_config` table and embed the PCD schema for the four `lidarr_metadata_profile` tables plus register the built-in op. |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/create.ts`                      | Persist parent profile rows plus all primary/secondary/release rows using `writeOperation` metadata.                                                              |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/read.ts`                        | Load metadata profile summary/detail data from the cache, including all child rows for sync/UI.                                                                   |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/update.ts`                      | Implement value-guard updates for `allowed` flags and rename support via `writeOperation`.                                                                        |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/delete.ts`                      | Remove a profile and cascade child rows through the cache schema.                                                                                                 |
| `packages/praxrr-app/src/lib/server/pcd/entities/metadataProfiles/index.ts`                       | Re-export CRUD helpers and expose metadata profile-specific helpers (e.g., `getDisplayRows`).                                                                     |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/handler.ts`                             | Register the new sync section, check `instance.type === 'lidarr'`, and claim the arrSync config before invoking the syncer.                                       |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`                              | Read the profile from cache, transform to Lidarr shape, reconcile names with namespace suffixes, and call Lidarr API.                                             |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/index.ts`                               | Gather handler/syncer exports and trigger registration for `sync/processor.ts`.                                                                                   |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts`      | Expose list/create actions for metadata profiles (similar to other PCD entity routes).                                                                            |
| `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]/+server.ts` | Provide get/update/delete operations including validation helpers that enforce name rules + checkbox constraints.                                                 |

### Files to Modify

| File                                         | Task                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/shared/pcd/types.ts`                | Add four table interfaces and row types for the `lidarr_metadata_profile*` tables and register them on `PCDDatabase`.                      |
| `packages/praxrr-app/src/lib/shared/pcd/display.ts`              | Export metadata profile display rows and the aggregated view type used by list/detail UI.                                                  |
| `packages/praxrr-app/src/lib/shared/pcd/portable.ts`             | Add `PortableLidarrMetadataProfile` and register the entity in `ENTITY_TYPES` for import/export/clone paths.                               |
| `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`    | Include `lidarr_metadata_profile` in `AUTO_ALIGN_ENTITIES` with the new table names and stable key.                                        |
| `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`   | Implement `serializeLidarrMetadataProfile()` for portable exports.                                                                         |
| `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts` | Add deserialization logic that writes metadata profile ops (matching create/update semantics).                                             |
| `packages/praxrr-app/src/lib/server/pcd/entities/clone.ts`       | Support cloning with the new entity and ensure namespace suffixes rename clones.                                                           |
| `packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`    | Enforce case-insensitive name uniqueness plus reserved-name guard (reject `"None"`) and checkbox validations.                              |
| `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`       | Provide `mp(name)` helpers that load metadata profile rows for sync.                                                                       |
| `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts` | Add metadata profile CRUD methods plus optional schema fetch, built on `/api/v1/metadataprofile`.                                          |
| `packages/praxrr-app/src/lib/server/utils/arr/types.ts`          | Define the client-facing metadata profile types and nested album/status items.                                                             |
| `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`         | Extend `ArrSyncSurface` with `metadata_profiles`, set it true for Lidarr only, and update `supportsFeature` helpers.                       |
| `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`       | Implement metadata-profile-specific config getters/setters, status updates, and integrate them into scheduled/pending query helpers.       |
| `packages/praxrr-app/src/lib/server/sync/types.ts`               | Add `'metadataProfiles'` to `SectionType` and `InstanceSyncResult` so processor code can reference counts.                                 |
| `packages/praxrr-app/src/lib/server/sync/mappings.ts`            | Include the new section in `SYNC_SECTION_ORDER` and `SUPPORTED_SYNC_SECTIONS` (Lidarr only).                                               |
| `packages/praxrr-app/src/lib/server/sync/processor.ts`           | Import `metadataProfiles` handler, update `totalSynced` calculations, and ensure thread-safe trigger/claim logic includes the new section. |
| `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`   | Load metadata profile options for Lidarr instances and expose them to the frontend sync form.                                              |
| `packages/praxrr-app/src/routes/metadata-profiles/...`           | Various list/edit form files (cards, checkboxes, actions) that render and submit metadata profile data via the new API.                    |
| `packages/praxrr-app/src/tests/...`                              | Add coverage for entity CRUD, sync transformer, arrSync queries, and UI flows (unit + e2e).                                                |

## Optimization Opportunities

- Reuse the delay-profile and quality-profile patterns: follow their `writeOperation` metadata, CRUD structure, serialize/deserialize/clone helpers, and sync handler shape to avoid reinventing cross-layer behavior.
- Share the `CheckboxGroup` component across Primary/Secondary/Release sections to reduce duplication, and pair `toggle-all`/count UI logic with the existing `dirty` store.
- Reuse `createProgressiveList`, `StickyCard`, and `CloneModal` from quality profiles for the list/edit UX to keep navigation and alerts consistent with existing entities.
- Build the Lidarr client methods and arrSync queries early to unblock sync handler/unit tests, then wire the UI to the same APIs so frontend engineers can mock real endpoints instead of stubs.

## Implementation Strategy Recommendations

- Start with the schema and shared type/base-op work so that entity, API, and sync-code targets have stable contracts; treat the migration as source-of-truth for both the app DB table and the PCD cache tables.
- Parallelize the backend by allowing the entity CRUD module, API routes, and Lidarr client updates to proceed as soon as the new tables/types exist; sync handler construction can follow once arrSync queries and metadata profile reads from `cache.ts` are available.
- Once backend endpoints and sync support are proven (unit tests plus arrSync query coverage), layer in the UI: list view, edit form with CheckboxGroup, and sync configuration updates. Tie the UI submission flow directly to the API routes to keep validation centralized.
- Cap the initial release by gating all behavior on `arr_type === 'lidarr'`, documenting that metadata profile config only applies to Lidarr instances, and verifying through tests that unsupported Arr types gracefully skip the new sync section.
