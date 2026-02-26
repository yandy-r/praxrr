# Recommendations: trash-guide-sync

## Executive Summary

TRaSH Guides integration should flow through the existing PCD ops pipeline (Option A) to leverage
Praxrr's battle-tested conflict resolution, value-guard validation, cache compilation, and sync
infrastructure. The primary technical risk is the schema impedance mismatch between TRaSH Guides'
JSON format (custom format specs with embedded regex, trash_ids, and trash_scores) and Praxrr's
normalized PCD relational model (separate tables for custom_formats, conditions, quality_profiles,
quality_profile_custom_formats). The recommended phasing starts with a read-only TRaSH Guide
browser, then custom format import, then full guide-backed quality profiles, and finally scheduled
auto-sync with diff detection.

## Implementation Recommendations

### Recommended Approach

Route TRaSH Guides data through the PCD pipeline as a new "source" type alongside the existing
`repo` and `local` sources. This means:

1. **Fetch**: Clone/pull the TRaSH Guides git repository (or fetch specific JSON files via GitHub
   raw URLs) into a managed directory, similar to how `pcdManager.link()` clones PCD repositories.
2. **Transform**: Parse TRaSH JSON into PCD-compatible structures using new transformer modules that
   produce the same `MigrationEntityCandidate` format used by `importBaseOps`.
3. **Store**: Write transformed data as PCD ops (origin=`base`, source=`trash`) into `pcd_ops`,
   giving users the same override/conflict/value-guard infrastructure they already have.
4. **Sync**: The existing sync pipeline (`processPendingSyncs`, `triggerSyncs`, section handlers)
   pushes compiled PCD data to Arr instances unchanged.

This approach maximizes code reuse and gives users a unified view of all configuration sources
through the existing PCD cache and UI.

### Technology Choices

| Component            | Recommendation                                                   | Rationale                                                                                                                     |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Guide data fetch     | Git clone via existing `$utils/git/` module                      | Reuses `clone()`, `pull()`, `checkForUpdates()` already in the codebase; supports offline use and version pinning             |
| Guide data format    | Parse JSON directly from cloned repo using `metadata.json` paths | TRaSH Guides publishes a `metadata.json` with all JSON directory paths; this is the same approach Recyclarr and Configarr use |
| Data transformation  | New `$pcd/migration/trash/` transformer module                   | Converts TRaSH JSON to `MigrationEntityCandidate` objects; integrates into `importBaseOps` pipeline                           |
| Scheduling           | Existing job queue (`$jobs/`) with new `trash.sync` job type     | Consistent with `pcd.sync` pattern; supports cron, manual trigger, and event-based triggers                                   |
| Diff detection       | Content hash comparison in `pcd_ops.content_hash`                | Already implemented for base ops; TRaSH ops get the same idempotent upsert behavior                                           |
| Conflict resolution  | Existing `conflict_strategy` (override/align/ask)                | User ops always take precedence over TRaSH base ops via the existing value-guard gate                                         |
| Real-time UI updates | Existing `alertStore` + job status polling                       | Consistent with current sync status feedback pattern                                                                          |

### Phasing Strategy

1. **Phase 1 - MVP (Foundation)**: TRaSH Guide repository linking, JSON parsing, custom format
   import as PCD base ops, basic UI for browsing available TRaSH custom formats
2. **Phase 2 - Quality Profiles**: Guide-backed quality profile import (quality items, groups, CF
   scores, quality definitions), profile selection UI, one-click "apply TRaSH profile" workflow
3. **Phase 3 - Full Sync**: Scheduled auto-sync of TRaSH Guide updates, diff detection with
   notifications, media management settings import (naming, quality sizes), selective sync (choose
   which TRaSH entities to track)
4. **Phase 4 - Polish**: Cross-instance template application, sync history/analytics, conflict
   resolution UI for TRaSH-vs-user changes, import/export of TRaSH sync configurations

### Quick Wins

- **TRaSH Guide browser**: Read-only JSON parsing + UI display of available CFs/profiles requires
  zero schema changes and provides immediate value for discovery
- **trash_id lookup table**: A simple mapping table (`trash_id` -> `pcd entity name`) enables future
  guide-backed references without modifying existing PCD tables
- **Job type registration**: Adding `trash.sync` to `JobType` union and a handler skeleton wires up
  the scheduling infrastructure with minimal effort

## Improvement Ideas

### Beyond Competitors

- **Visual diff previews**: Leverage the existing `preview/orchestrator.ts` system to show exactly
  what a TRaSH Guide update would change in each Arr instance before applying, with field-level
  diffs. Recyclarr and Configarr operate blindly -- they apply changes without showing what will
  change first.
- **Selective entity tracking**: Let users pick individual TRaSH custom formats or profiles to
  track, rather than all-or-nothing sync. The PCD ops model naturally supports this since each
  entity gets its own op chain.
- **User override preservation**: Because TRaSH data flows through PCD ops as `base` layer, any user
  customizations (score tweaks, condition modifications) in the `user` layer automatically take
  precedence. Neither Recyclarr nor Configarr offer this layered override model.
- **Multi-database composition**: Users could combine TRaSH Guides data with their own PCD database,
  applying TRaSH CFs alongside custom CFs in the same quality profile. The existing namespace system
  (`arr_database_namespaces`) handles name collision avoidance.
- **Guide version pinning**: Allow users to pin to a specific TRaSH Guides commit/tag, review
  changes before upgrading, and roll back if an update causes issues. The existing git integration
  supports this via `checkout()`.

### Related Features

- **Sync preview dry-run** (existing `docs/plans/sync-preview-dry-run/`): TRaSH Guide imports should
  integrate with the preview system to show "if we import this TRaSH profile, here is what changes
  in Radarr instance X."
- **Pull on startup** (existing `docs/plans/pull-on-startup/`): TRaSH Guide fetch could piggyback on
  the startup pull mechanism for fresh data on boot.
- **Notification integration**: The existing `NotificationManager` and `NotificationTypes` can be
  extended with `TRASH_SYNC_SUCCESS`, `TRASH_SYNC_FAILED`, `TRASH_UPDATES_AVAILABLE` types. Only
  Discord is currently implemented but the architecture is extensible.

### Future Enhancements

- **Smart conflict resolution**: When a TRaSH Guide update conflicts with a user override, show a
  three-way diff (previous TRaSH version, new TRaSH version, user version) and let the user choose.
  Complexity: medium-high.
- **Cross-instance sync coordination**: Apply the same TRaSH profile configuration to multiple Arr
  instances simultaneously with a single action. Complexity: medium (leverages existing
  multi-instance sync infrastructure).
- **TRaSH Guide changelog**: Parse git commit history of the TRaSH Guides repo to show users what
  changed between versions. Complexity: low-medium.
- **Analytics dashboard**: Track which TRaSH CFs are active across instances, score distribution,
  and sync history over time. Complexity: medium.
- **Import/export sync configurations**: Export the set of selected TRaSH entities + user overrides
  as a shareable configuration file. Complexity: medium.

## Risk Assessment

### Technical Risks

| Risk                                                                                | Likelihood | Impact | Mitigation                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRaSH JSON schema changes without notice                                            | Medium     | High   | Pin to known-good commit; validate JSON against expected schema before import; add schema version detection from `metadata.json`                                       |
| PCD schema impedance mismatch (TRaSH CFs use `trash_id` UUIDs not in PCD schema)    | High       | Medium | Add `trash_id` column to PCD custom_formats or maintain a separate lookup table; do not modify existing PCD schema columns                                             |
| Race condition between TRaSH sync and manual PCD edits                              | Low        | Medium | Leverage existing `claimSync()` / `setStatusPending()` atomic state machine; TRaSH imports use the same `writeContextStorage` AsyncLocalStorage scoping                |
| Large TRaSH repo clone slow on first link (repo is ~100MB+)                         | Medium     | Low    | Support shallow clone (`--depth 1`); add progress feedback to UI; cache repo locally and reuse across re-links                                                         |
| Custom format condition type mismatches between TRaSH JSON and PCD condition schema | High       | Medium | Build comprehensive mapping table; TRaSH condition types (release_group, edition, language, etc.) need verified parity with PCD `custom_format_conditions.type` values |
| Guide data available only for Radarr/Sonarr, not Lidarr                             | High       | Low    | Scope Phase 1-2 to Radarr/Sonarr only; guard with `arr_type` checks per Cross-Arr Semantic Validation Policy                                                           |

### Integration Challenges

- **PCD ops source taxonomy**: Current `pcd_ops.source` accepts `repo | local | import`. TRaSH Guide
  data needs a new source value (`trash`) or should use `import` with metadata tagging. A migration
  adding `trash` to the CHECK constraint is cleaner.
- **Entity naming collisions**: TRaSH custom format names may collide with existing PCD custom
  format names. The namespace system (`arr_database_namespaces`) already handles this for
  multi-database scenarios, but TRaSH data would need to be associated with a "virtual" database
  instance or a dedicated TRaSH database entry.
- **trash_scores mapping**: TRaSH CFs embed scores per profile (e.g.,
  `{"default": 50, "anime": 100}`). These need to be mapped to PCD's
  `quality_profile_custom_formats` table rows. The profile name mapping between TRaSH profile
  identifiers and PCD profile names requires a resolution layer.
- **Quality definition sync**: TRaSH quality size definitions use min/max/preferred values that map
  to Arr API's `qualityDefinitions` endpoint, which is separate from quality profiles. This is
  already handled by the `mediaManagement` sync section but the data source needs bridging.

### Performance Concerns

- **Initial clone time**: The TRaSH Guides repository is large. Shallow clones and sparse checkouts
  (fetching only `docs/json/`) would reduce initial setup time significantly.
- **Cache compilation after TRaSH import**: Importing hundreds of TRaSH custom formats triggers a
  full PCD cache rebuild. The existing `fastPathRepoImport` optimization in `writer.ts` (line 680)
  applies SQL directly to the in-memory cache without full recompile, which should be leveraged.
- **Memory usage**: Each PCD database gets an in-memory SQLite cache. A TRaSH-backed database with
  hundreds of CFs adds memory pressure. Monitor via the existing `CacheBuildStats` timing metrics.

### Security Considerations

- **Git credentials**: TRaSH Guides is a public repo, so no PAT is needed. However, if users
  configure private forks, the existing encrypted credential system
  (`database_instance_credentials`) handles this.
- **JSON injection**: TRaSH JSON files contain regex patterns used in custom format conditions.
  These are stored as data in PCD ops and compiled into the in-memory SQLite cache. The existing
  `cache.validateSql()` method validates all SQL before execution, preventing injection.
- **Repository trust**: Users should be warned if they point to a non-official TRaSH Guides fork.
  The metadata.json schema validation provides a basic trust check.

## Alternative Approaches

### Option A: PCD-First Pipeline (Recommended)

TRaSH Guides -> Parse JSON -> Generate PCD ops -> Write to pcd_ops table -> Compile PCD cache ->
Existing sync pipeline -> Arr API

- **Pros**: Maximum code reuse (sync, preview, conflict resolution, value-guard, notifications all
  work unchanged); unified data model; user overrides preserved; existing UI for browsing/editing
  entities works; rollback via ops history
- **Cons**: Requires transformer complexity to map TRaSH JSON to PCD SQL ops; adds load to PCD cache
  compilation; tight coupling to PCD schema evolution
- **Effort**: Medium-high for Phase 1 (transformer is the main work), low incremental effort for
  Phases 2-4

### Option B: Direct Sync Pipeline

TRaSH Guides -> Parse JSON -> Transform to Arr API payloads -> Push directly to Arr API

- **Pros**: Simplest implementation; no PCD schema involvement; fastest path to "something works"
- **Cons**: Bypasses all PCD infrastructure (no conflict resolution, no value-guards, no preview, no
  audit trail, no user overrides); creates a parallel sync path that must be maintained
  independently; no visibility into what was synced; cannot compose TRaSH data with PCD data
- **Effort**: Low for MVP, but high ongoing maintenance cost for feature parity

### Option C: Hybrid Approach

TRaSH Guides -> Parse JSON -> Store in dedicated TRaSH tables (not pcd_ops) -> Custom TRaSH sync
handlers -> Arr API, with PCD data merged at sync time

- **Pros**: Clean separation of TRaSH data from PCD data; avoids PCD schema constraints; can evolve
  TRaSH schema independently
- **Cons**: Duplicates significant infrastructure (storage, caching, diffing, conflict detection);
  sync handlers must merge two data sources at runtime; preview system needs custom TRaSH support;
  doubles testing surface
- **Effort**: High (essentially building a second PCD system for TRaSH data)

### Recommendation

**Option A (PCD-First Pipeline)** is strongly recommended. The PCD ops system was designed to handle
exactly this use case: external data sources that get compiled into a unified configuration view.
The `importBaseOps` pipeline already supports the pattern of reading external data, converting it to
SQL ops, and writing it with content-hash deduplication. The transformer module is the main new
work, and it follows the established pattern in `$pcd/migration/reader.ts` and
`$pcd/entities/deserialize.ts`.

Option B would be appropriate only if Praxrr wanted to offer TRaSH sync as a completely standalone
feature with no PCD integration, which contradicts the product vision of unified configuration
management.

## Task Breakdown Preview

### Phase 1: Foundation (TRaSH Guide Linking + Custom Format Import)

**Task Group 1a: Data Source Infrastructure**

- Add `trash` to `pcd_ops.source` CHECK constraint via migration
- Create `TrashGuideRepository` class in `$pcd/trash/` that wraps git clone/pull for the TRaSH repo
- Parse `metadata.json` to discover available JSON paths per arr_type
- Add `trash.sync` job type to `JobType` union in `queueTypes.ts`
- Register `trash.sync` handler in job handlers
- Add trash guide repository link/unlink to `database_instances` (or dedicated table)

**Task Group 1b: Custom Format Transformer**

- Create `$pcd/trash/transformers/customFormats.ts` that converts TRaSH CF JSON to
  `MigrationEntityCandidate`
- Map TRaSH condition types to PCD condition types (release_group, edition, language, indexer_flag,
  size, source, resolution, custom, release_title)
- Handle `trash_id` -> PCD entity name mapping (new lookup table or metadata field)
- Handle `trash_scores` extraction for later quality profile association
- Write integration tests for CF transformation

**Task Group 1c: Import Pipeline**

- Integrate TRaSH CF transformer with `importBaseOps` flow
- Add content-hash deduplication for TRaSH-sourced ops
- Test idempotent re-import (re-running import produces no new ops if data unchanged)

**Task Group 1d: UI - TRaSH Guide Browser**

- API endpoint: `GET /api/v1/trash/custom-formats` (list available TRaSH CFs with metadata)
- API endpoint: `POST /api/v1/trash/import` (import selected CFs into a PCD database)
- UI page for browsing/searching TRaSH custom formats
- Selection UI for choosing which CFs to import

**Parallel opportunities**: 1a and 1d (API contract definition) can start in parallel; 1b depends on
1a; 1c depends on 1b

### Phase 2: Quality Profile Integration

**Task Group 2a: Quality Profile Transformer**

- Create `$pcd/trash/transformers/qualityProfiles.ts`
- Map TRaSH quality profile JSON to PCD quality_profiles, quality_groups, quality_profile_qualities,
  quality_profile_custom_formats
- Handle `trash_scores` per-profile score assignment
- Handle quality group ordering and upgrade-until logic

**Task Group 2b: Quality Definitions Transformer**

- Create `$pcd/trash/transformers/qualityDefinitions.ts`
- Map TRaSH quality-size JSON to PCD quality_definitions entities

**Task Group 2c: Guide-Backed Profile Selection UI**

- UI for selecting a TRaSH quality profile to apply
- Preview integration showing what the profile would change
- One-click apply workflow

**Dependencies**: Phase 2 depends on Phase 1 completion (CF infrastructure)

### Phase 3: Scheduled Auto-Sync

**Task Group 3a: Sync Scheduling**

- Add TRaSH Guide sync schedule configuration to database_instances (or dedicated table)
- Implement `scheduleTRaSHSyncForDatabase()` in `$jobs/schedule.ts`
- Add `on_trash_update` trigger type to sync trigger events
- Connect TRaSH repo pull completion to `triggerSyncs()` with new event type

**Task Group 3b: Diff Detection + Notifications**

- Compare TRaSH JSON content hashes between pulls
- Generate human-readable changelogs from TRaSH git history
- Add `TRASH_SYNC_SUCCESS`, `TRASH_SYNC_FAILED`, `TRASH_UPDATES_AVAILABLE` notification types
- Wire notifications into the TRaSH sync handler

**Task Group 3c: Media Management Settings**

- Naming configuration transformer
- Media settings transformer
- Integration with existing `mediaManagement` sync section

### Phase 4: Polish + Advanced Features

**Task Group 4a: Cross-Instance Templates**

- Apply same TRaSH profile to multiple instances UI
- Bulk sync preview across instances

**Task Group 4b: Sync History + Analytics**

- Track TRaSH sync operations in job_run_history
- Dashboard showing sync activity over time
- Per-instance sync status for TRaSH-sourced entities

**Task Group 4c: Import/Export**

- Export selected TRaSH entities + user overrides as YAML/JSON
- Import configurations from other Praxrr installations

### Estimated Complexity

- **Total tasks**: ~35-45 discrete implementation tasks across all phases
- **Critical path**: TRaSH JSON parser -> CF transformer -> PCD ops integration -> Sync pipeline
  verification
- **Phase 1 estimate**: 2-3 weeks of focused development
- **Phase 2 estimate**: 1-2 weeks (leverages Phase 1 infrastructure)
- **Phase 3 estimate**: 1 week
- **Phase 4 estimate**: 2-3 weeks

## Relevant Files

- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Main sync orchestrator, entry point for
  all sync operations
- `/packages/praxrr-app/src/lib/server/sync/base.ts`: Abstract base syncer class (fetchFromPcd ->
  transformToArr -> pushToArr)
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry pattern for
  extensible sync sections
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: Sync type definitions (SectionType,
  SectionHandler, SyncResult)
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr API mapping constants (qualities,
  languages, sources, indexer flags)
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCD lifecycle orchestration (link,
  sync, compile, trigger)
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Base op import pipeline from YAML
  entities
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: PCD op writer with value-guard validation
  and conflict detection
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: In-memory SQLite cache for compiled
  PCD state
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: Cache compilation with
  auto-override conflict resolution
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: Migration entity source reader
  (pattern for TRaSH transformer)
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: Entity deserialization (pattern
  for TRaSH entity import)
- `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`: Job queue dispatcher
- `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`: Job scheduling functions (pattern for
  TRaSH sync scheduling)
- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: Job type definitions (needs `trash.sync`
  addition)
- `/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`: PCD sync job handler (pattern for
  TRaSH sync handler)
- `/packages/praxrr-app/src/lib/server/notifications/types.ts`: Notification type constants (needs
  TRaSH types)
- `/packages/praxrr-app/src/lib/server/utils/git/write.ts`: Git write operations for repository
  management
- `/packages/praxrr-app/src/lib/server/utils/git/read.ts`: Git read operations (clone, pull, status,
  checkForUpdates)
- `/packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Preview generation system
  (integrate for TRaSH import preview)
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: QP transformer
  (reference for TRaSH QP transformation)
- `/packages/praxrr-app/src/lib/server/pcd/stableIdentity.ts`: Entity stable key definitions per
  entity type
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: PCD database schema types (auto-generated from
  SQL schema)
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: App database schema reference
- `/packages/praxrr-app/src/hooks.server.ts`: Startup sequence (context for initialization order)

## Key Decisions Needed

- **TRaSH data as separate database instance or extension of existing PCD databases?**: Creating a
  dedicated "TRaSH Guide" database instance per arr_type (similar to how `pcdManager.link()` works)
  is cleanest architecturally, but users may want TRaSH CFs mixed into their existing PCD database.
  Decision impacts UI flow and namespace handling.
- **Granularity of trash_id tracking**: Should `trash_id` be stored as a column on `custom_formats`
  in the PCD schema (requires schema migration and `generate:pcd-types` regeneration), or as a
  separate lookup table in the app database? The column approach is simpler but couples PCD schema
  to TRaSH. The lookup table is more flexible but requires joins.
- **Auto-import vs manual selection**: Should linking a TRaSH Guide repository automatically import
  all CFs/profiles, or should users explicitly select which entities to import? Automatic is simpler
  but may overwhelm users with hundreds of CFs they do not need.
- **Guide version pinning strategy**: Should Praxrr default to `master` branch (always latest) or
  allow users to pin to a specific tag/commit? Latest is simpler but risks breaking changes. Pinning
  requires version management UI.

## Open Questions

- What is the desired relationship between TRaSH Guide custom formats and existing PCD custom
  formats? Should users be able to edit TRaSH-imported CFs (which would create user ops), or should
  TRaSH CFs be treated as read-only base data?
- Should TRaSH Guide sync be a first-class feature visible in the main navigation, or a sub-feature
  within the existing Databases page?
- Is there interest in supporting Configarr-style YAML configuration files as an additional import
  source, or is direct TRaSH Guide repository integration sufficient?
- What is the priority ordering among custom formats, quality profiles, naming, and quality
  definitions for TRaSH Guide import? This determines Phase 1 scope.
- Should the TRaSH Guide browser show raw JSON data or render a human-friendly view with condition
  descriptions and score tables?

## External References

- [TRaSH Guides Repository](https://github.com/TRaSH-Guides/Guides) - Source repository with JSON
  data in `docs/json/{radarr,sonarr}/`
- [TRaSH Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json) -
  Directory structure manifest for JSON data paths
- [Recyclarr](https://github.com/recyclarr/recyclarr) - Existing TRaSH Guide sync tool (C#,
  CLI-based)
- [Configarr](https://github.com/raydak-labs/configarr) - Alternative TRaSH Guide sync tool
  (TypeScript, Docker-based)
- [TRaSH Guides - Collection of Custom Formats (Radarr)](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [TRaSH Guides - How to Import Custom Formats](https://trash-guides.info/Radarr/Radarr-import-custom-formats/)
- [Recyclarr Quick Setup Templates](https://recyclarr.dev/wiki/guide-configs/)
