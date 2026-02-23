# Recommendations: sync-preview-dry-run

## Executive Summary

Sync preview should be implemented as a **parallel code path within the existing sync pipeline**, not as a separate system. The current `BaseSyncer` architecture (fetch from PCD, transform to Arr format, push to Arr) already separates the three stages needed: the preview system reuses fetch and transform but replaces push with a diff computation against live Arr state. The existing cleanup module's `scanForStaleItems()` already demonstrates this pattern -- fetching remote state and comparing it to expected state -- and serves as the closest architectural precedent in the codebase. The primary risk is stale preview data from race conditions between preview generation and sync execution, mitigated by short-lived preview TTLs and re-validation at apply time.

## Implementation Recommendations

### Recommended Approach

The sync preview feature should be built as a **compute-on-demand diff engine** that sits alongside the existing syncer infrastructure. The key insight from reading the codebase is that every syncer already has the exact data pipeline needed for preview: `fetchFromPcd()` gathers intent, `transformToArr()` produces the desired Arr payload, and the Arr client's `get*()` methods retrieve current remote state. Preview adds a fourth step -- `computeDiff(desired, current)` -- and omits the write step.

The sync pipeline currently follows this flow per section:

```
PCD Cache -> fetch -> transform -> push to Arr
```

Preview mode would follow:

```
PCD Cache -> fetch -> transform -> fetch remote -> diff -> return preview
```

This approach has a critical advantage: **the preview and execute paths share the exact same fetch/transform logic**, preventing the preview/execute drift problem identified in the research. The `QualityProfileSyncer.sync()` method (line 79-159 in `qualityProfiles/syncer.ts`) already performs "fetch PCD, transform, check existing, decide create-vs-update" -- preview extracts that decision into a return value instead of an API call.

The existing `cleanup.ts` module (`scanForStaleItems()`) is the strongest precedent: it fetches remote CFs and QPs, compares against expected state, and returns a diff (`CleanupScanResult`) without modifying anything. The cleanup API route then requires a separate "execute" call with the scan result. This exact scan/execute pattern maps 1:1 to preview/apply.

### Technology Choices

| Component                | Recommendation                             | Rationale                                                                                               |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Diff engine              | New module `$sync/preview/`                | Keeps preview logic co-located with sync; reuses existing transformers                                  |
| Preview types            | Shared types in `$sync/types.ts`           | Extends existing `SyncResult`/`InstanceSyncResult` with diff data                                       |
| API surface              | `/api/v1/arr/sync/preview` (POST)          | Follows existing `/api/v1/arr/cleanup` scan/execute pattern                                             |
| Job integration          | `arr.sync.preview` job type                | Allows preview to run through the same job queue for consistency                                        |
| Diff storage             | In-memory with optional SQLite persistence | Short-lived previews (5-minute TTL) stay in memory; persisted plans use a new `arr_sync_previews` table |
| UI component             | New `PreviewModal` or dedicated route      | Could extend `SyncFooter.svelte` with a "Preview" button alongside "Sync Now"                           |
| Notification integration | New `sync.preview_ready` notification type | Leverages existing `NotificationManager.notify()` and `NotificationTypes` pattern                       |

### Phasing Strategy

#### Phase 1 - MVP: Inline Preview for Quality Profiles (Complexity: Medium)

Quality profiles are the most complex sync section (CFs + QPs + namespace suffixes) and the highest-risk operation. Start here because:

- It exercises the full pipeline (PCD fetch, CF transform, QP transform, remote fetch, namespace handling)
- The `QualityProfileSyncer` already separates "fetch + transform" from "push" cleanly
- The `syncCustomFormats()` function in `customFormats/syncer.ts` already tracks create-vs-update decisions (line 79-98)
- It is the section users care most about

**Scope:**

- Define preview types (`SyncPreviewResult`, `SectionPreviewDiff`, `EntityChange`)
- Extract diff logic from `QualityProfileSyncer.sync()` and `syncCustomFormats()`
- Add `preview()` method to `BaseSyncer` (or a parallel `BasePreviewEngine`)
- Create `/api/v1/arr/sync/preview` POST endpoint (scan phase only)
- Add "Preview" button to `SyncFooter.svelte`
- Display diff in a modal or expandable section

#### Phase 2 - Enhancement: Full Section Coverage + Apply-from-Preview (Complexity: Medium-High)

- Extend preview to delay profiles, media management, and metadata profiles
- Implement the "apply" step: POST to `/api/v1/arr/sync/preview` with `action: 'execute'`
- Add preview validation at apply time (detect if remote state changed since preview)
- Store preview results with a TTL in a new `arr_sync_previews` table
- Add preview results to job run history for audit trail
- Integrate with notification system (preview ready, preview expired, preview applied)

#### Phase 3 - Polish: Background Preview + Drift Detection Foundation (Complexity: High)

- Compute previews on PCD change events (reuse `triggerSyncs()` trigger points)
- Add preview staleness indicators in the UI
- Build drift detection as a natural extension (scheduled preview without the "apply" step)
- Enable canary sync (apply preview to one instance, verify, then propagate)
- State snapshot support (capture pre-apply state for rollback)

### Quick Wins

- **"Preview" button in SyncFooter**: Adding a third button alongside "Save" and "Sync Now" is a UI-only change that can land immediately with a stub endpoint. Estimated: 1-2 hours.
- **Diff type definitions**: Defining `SyncPreviewResult`, `EntityChange`, and `FieldDiff` types in `$sync/types.ts` provides the contract for all subsequent work. Estimated: 2-3 hours.
- **OpenAPI spec for preview endpoint**: Contract-first per codebase convention. Adding the spec to `docs/api/v1/paths/arr.yaml` unblocks parallel frontend/backend work. Estimated: 1-2 hours.
- **Extract create-vs-update logic from QP syncer**: The decision at `qualityProfiles/syncer.ts` lines 329-346 (checking `existingMap.has(suffixedName)`) can be refactored into a pure function that returns the decision without side effects. This refactor benefits both preview and the existing sync code. Estimated: 3-4 hours.

## Improvement Ideas

### Related Features Enabled

- **Drift Detection (#10)**: Preview without the "apply" step IS drift detection. Running preview on a schedule and comparing against "no changes expected" produces drift reports. The preview engine becomes the drift engine with zero additional code.
- **State Snapshots (#10)**: Capturing the "current remote state" fetched during preview provides a point-in-time snapshot. Persisting this alongside the preview result creates the restore-point data needed for rollback.
- **Rollback (#16)**: If previews store both "desired state" and "current state before apply," rollback becomes "apply the old current state as the new desired state." The preview infrastructure provides both halves of the rollback data.
- **Canary Sync (#19)**: Preview across N instances, apply to 1, re-preview the others to verify the change propagated correctly. The preview engine's ability to compare "desired vs. live" is the verification step.
- **Sync History Dashboard**: Every applied preview becomes a historical record of what changed, when, and whether it succeeded. The `job_run_history` table already captures timing and status; adding the preview diff as `output` JSON provides the content.

### Future Enhancements

- **Score Impact Visualization**: Preview data includes CF score changes per quality profile. Displaying "Profile X score goes from 150 to 175" helps users understand the impact of CF changes without reading individual scores.
- **Multi-Instance Diff Comparison**: For users syncing the same profiles to multiple instances, preview can show "Instance A already has this, Instance B does not." This surfaces configuration inconsistencies before they cause problems.
- **Preview-as-Documentation**: A preview of "everything that would sync" serves as living documentation of what Praxrr manages on each instance. Users who forget what they configured can run a preview to see the full managed surface.
- **Conflict Detection Enhancement**: Preview can detect when user-ops and base-ops produce conflicting changes (e.g., a user override that contradicts an upstream update), surfacing PCD conflicts before they reach the Arr instance.

### Notification Integration

The existing `NotificationManager` supports type-based routing and Discord embeds. Preview integrates naturally:

- `sync.preview_ready` - Notify when a background preview completes
- `sync.preview_conflict` - Notify when a preview detects unexpected remote state
- `sync.preview_applied` - Notify with diff summary when a preview is applied
- `sync.drift_detected` - Notify when scheduled preview finds differences (Phase 3)

These would be added to `NotificationTypes` in `$notifications/types.ts` and follow the same `generic` + `discord` payload pattern used by existing notification types.

## Risk Assessment

### Technical Risks

| Risk                                                           | Likelihood | Impact | Mitigation                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stale preview (remote state changes between preview and apply) | High       | High   | Re-fetch remote state at apply time and re-validate diff; abort with a clear message if drift detected. Short TTL (5 minutes) for preview data.                                            |
| API rate limiting from Arr instances                           | Medium     | Medium | Preview reuses existing `ArrInstanceClientCache` (line 249 in `processor.ts`) to deduplicate requests. Batch requests where possible. Add per-instance rate limit tracking.                |
| Preview/execute code path drift                                | Low        | High   | Both paths share the same `fetchFromPcd()` and `transformToArr()` functions. Only the final step differs (diff vs. push). Enforce this with shared helper functions, not duplicated logic. |
| Large preview payloads for many CFs                            | Medium     | Low    | Quality profiles referencing 100+ CFs produce large diffs. Paginate or summarize the diff (show counts, expand on demand).                                                                 |
| Namespace suffix complexity in diffs                           | Medium     | Medium | Strip namespace suffixes from display names in preview output (reuse `stripNamespaceSuffix()` from `namespace.ts`). Show suffixed names only in debug/verbose mode.                        |
| PCD cache unavailability during preview                        | Low        | Medium | Preview requires a compiled PCD cache. If cache is missing (line 213-228 in `qualityProfiles/syncer.ts`), return a clear "PCD cache not available" error rather than an empty diff.        |

### Integration Challenges

- **Arr client connection failures**: Preview requires connecting to the Arr instance to fetch current state. If the instance is unreachable, preview fails. Mitigation: use the same connection test and credential handling as the existing sync handler (`arrSync.ts` handler, lines 116-152), including the `isArrCredentialFailure()` check.
- **Job queue interaction**: Preview jobs should not block or interfere with active sync jobs for the same instance. Mitigation: use a separate `dedupeKey` namespace (e.g., `arr.sync.preview:${instanceId}`) and ensure preview jobs do not set `sync_status` to `pending`/`in_progress`.
- **Cross-Arr semantic validation**: Per the CLAUDE.md policy, preview must validate per `arr_type`. The existing syncer architecture already dispatches by section and validates per Arr type (e.g., `isSyncSectionSupported()` in `mappings.ts`). Preview inherits this.
- **Concurrent preview requests**: Multiple users could request previews for the same instance simultaneously. Mitigation: deduplicate using the job queue's `dedupeKey` pattern (already used in `triggerSyncs()` at `processor.ts` line 345).

### UX Risks

| Risk                                  | Likelihood | Impact | Mitigation                                                                                                                                                              |
| ------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview fatigue (users skip previews) | Medium     | Medium | Make preview optional, not mandatory. "Sync Now" remains unchanged. "Preview" is an additional option. Consider a user preference to auto-preview before sync.          |
| Information overload in diff display  | High       | Medium | Progressive disclosure: summary first (N creates, N updates, N deletes), expand for field-level detail. Follow the established pattern from the Svelte cleanup UI.      |
| Preview blocking workflow             | Low        | High   | Preview computation should be asynchronous (via job queue). Display a loading state and allow navigation away. The SyncFooter already handles `syncing` loading states. |

### Security Risks

| Risk                                         | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                    |
| -------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview data exposing API keys               | Low        | High   | Preview should never include API keys in diff output. The Arr client already handles authentication at the transport layer (`X-Api-Key` header in `base.ts` line 38). Preview data only includes entity payloads, not connection credentials. |
| Preview data persisted with sensitive values | Low        | Medium | CF specifications can contain regex patterns that might be considered proprietary. Ensure preview storage follows the same access control as sync configuration.                                                                              |

### Compatibility Risks

| Risk                                     | Likelihood | Impact | Mitigation                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream Arr API changes                 | Medium     | High   | Preview uses the same Arr client methods as sync (`getCustomFormats()`, `getQualityProfiles()`, etc.). Any API breakage affects both equally. The preview system does not introduce new API surface.                            |
| Arr version differences across instances | Medium     | Medium | Different Arr versions may return different response shapes. The existing client already handles this (e.g., Lidarr delay profile resolution in `delayProfiles/syncer.ts` lines 90-105). Preview inherits these accommodations. |

## Alternative Approaches

### Option A: Inline Preview (Compute diff on demand, show before executing)

- **Pros**: Simplest implementation. No storage needed. Always shows fresh data. Matches the cleanup scan/execute pattern already in the codebase. Natural extension of "Sync Now" button UX.
- **Cons**: Requires user to wait for Arr API calls before seeing preview. Cannot show previews proactively (e.g., after PCD changes). Preview data is ephemeral -- lost if user navigates away.
- **Best for**: MVP / Phase 1. Gets the feature to users fastest.

### Option B: Persistent Preview (Store preview as a "plan" that can be reviewed and applied later)

- **Pros**: Supports async workflows (start preview, come back later to review). Enables audit trail. Preview results can be shared between users. Foundation for drift detection (scheduled previews persisted as history). Enables "plan" concept from Terraform.
- **Cons**: Requires new database table (`arr_sync_previews`). Stale preview risk (remote state changes). Adds complexity: TTL management, storage cleanup, cache invalidation. More code to maintain.
- **Best for**: Phase 2. After inline preview validates the concept and user value.

### Option C: Background Preview (Compute previews continuously on schedule or on PCD change)

- **Pros**: Preview is always ready -- zero wait time for the user. Natural path to drift detection. Can proactively notify users of pending changes. Maximizes the "transparent automation" principle from the research.
- **Cons**: Generates API traffic to Arr instances continuously. Requires careful rate limiting. Preview may be stale by the time user views it. Highest implementation complexity. Runs whether or not users care about the preview.
- **Best for**: Phase 3. After persistent preview infrastructure exists and user feedback validates the value of proactive previews.

### Recommendation

**Start with Option A (Inline Preview), evolve to Option B (Persistent Preview), consider Option C (Background Preview) based on user feedback.**

The cleanup module already implements the Option A pattern (scan + execute with separate API calls). The job queue already supports Option B's async computation. Option C requires the most infrastructure but provides the most value -- it should be built only after validating that users actually use preview data.

The progression mirrors Terraform's history: `terraform plan` started as inline (compute on demand), then gained persistence (`-out=planfile`), then gained automation (CI/CD integration). Following this proven path reduces risk.

## Task Breakdown Preview

### Phase 1: Foundation and MVP (Relative Complexity: Medium)

**Dependencies: None (green-field within existing architecture)**

1. **Define preview types** in `$sync/types.ts` -- `SyncPreviewResult`, `SectionPreviewDiff`, `EntityChange`, `FieldDiff`
   - Parallelizable: Yes (no dependencies)
   - Complexity: Low

2. **Define OpenAPI spec** for `/api/v1/arr/sync/preview` in `docs/api/v1/paths/arr.yaml`
   - Parallelizable: Yes (parallel with types)
   - Complexity: Low

3. **Extract shared fetch/transform logic** from `QualityProfileSyncer.sync()` into reusable functions
   - Dependency: Types defined
   - Complexity: Medium -- requires careful refactoring of `fetchSyncBatchByDatabase()` and `syncQualityProfiles()` without breaking existing sync

4. **Implement diff engine** for quality profiles and custom formats
   - Dependency: Shared logic extracted
   - Complexity: Medium -- needs field-level comparison for CFs (specifications array), QPs (quality items, format items, cutoff, language)

5. **Create preview API endpoint** (`/api/v1/arr/sync/preview`)
   - Dependency: Diff engine
   - Complexity: Low -- follows `cleanup/+server.ts` pattern

6. **Add "Preview" button to SyncFooter** and preview display component
   - Parallelizable: Yes (parallel with backend once types are defined)
   - Complexity: Medium -- diff visualization UI

### Phase 2: Full Coverage and Persistence (Relative Complexity: Medium-High)

**Dependencies: Phase 1 complete**

1. **Extend preview to delay profiles** -- Diff is simpler (single profile, fewer fields)
   - Complexity: Low

2. **Extend preview to media management** -- Three sub-sections (naming, quality definitions, media settings) each need diff logic
   - Complexity: Medium

3. **Extend preview to metadata profiles** -- Lidarr-only, follows delay profile pattern
   - Complexity: Low

4. **Add `arr_sync_previews` table** via migration -- stores preview results with TTL
   - Complexity: Low

5. **Implement apply-from-preview** with re-validation
   - Dependency: Storage table
   - Complexity: Medium -- must re-fetch remote state and detect drift since preview

6. **Register `arr.sync.preview` job type** in job queue for async preview computation
   - Complexity: Low -- follows existing `arr.sync.*` handler pattern in `handlers/arrSync.ts`

7. **Add preview notification types** to notification system
   - Complexity: Low -- follows existing `NotificationTypes` pattern

### Phase 3: Background Preview and Drift Foundation (Relative Complexity: High)

**Dependencies: Phase 2 complete, user feedback validates value**

1. **Hook preview into PCD change events** (reuse `triggerSyncs()` trigger points in `processor.ts`)
   - Complexity: Medium

2. **Implement preview TTL and cleanup** job
   - Complexity: Low

3. **Build drift detection** as scheduled preview with "expected: no changes" baseline
   - Complexity: Medium

4. **Add preview staleness indicators** in the UI
   - Complexity: Low

5. **Canary sync support** -- apply preview to one instance, verify, propagate
   - Complexity: High -- requires multi-instance coordination

6. **State snapshot capture** for future rollback support
   - Complexity: Medium

### Parallelization Opportunities

- **Phase 1, tasks 1+2**: Type definitions and OpenAPI spec can be done simultaneously
- **Phase 1, tasks 3+6**: Backend refactoring and UI component development can proceed in parallel once types are stable
- **Phase 2, tasks 1+2+3**: Extending preview to additional sections can be parallelized across developers
- **Phase 2, tasks 4+5**: Storage and apply logic are sequential but can overlap with section extension work

## Key Decisions Needed

1. **Preview as separate button vs. preview-before-sync gate**: Should "Sync Now" always show a preview first, or should "Preview" and "Sync Now" remain independent actions? The research recommends independent actions (avoid preview fatigue), but a user preference could enable "always preview first."

2. **Preview scope: per-section vs. all-sections**: Should the user preview individual sections (quality profiles only) or get a unified preview across all configured sections? The existing UI has per-section "Sync Now" buttons, suggesting per-section preview is more consistent. However, dependencies (CFs synced before QPs) mean a quality-profiles preview implicitly includes CF changes.

3. **Diff granularity for custom formats**: CF specifications contain complex nested structures (implementation type, fields, negate/required flags). Should preview show individual specification changes, or treat each CF as an atomic unit (changed/not changed)? Recommendation: show CF-level changes (created/updated/deleted) with expandable specification-level detail.

4. **Preview storage vs. ephemeral**: For Phase 1, previews can be ephemeral (returned from the API, discarded after display). Persistent storage adds value but also complexity. Decision point: defer persistence to Phase 2 unless user feedback demands it earlier.

5. **Job queue vs. synchronous**: Should preview computation go through the job queue (async, background) or run synchronously in the API request? For most instances with reasonable numbers of profiles, synchronous is fast enough. The job queue adds latency (enqueue, dispatch, poll for result) but prevents long-running requests. Recommendation: synchronous for Phase 1 (same as cleanup scan), async via job queue for Phase 2 when background previews are needed.

## Open Questions

- How should preview handle CF specifications that are valid for one `arr_type` but skipped for another (e.g., Lidarr's unsupported condition types at `customFormats/syncer.ts` lines 44-67)? Should the preview show "this condition will be skipped" as a warning?
- Should preview capture and display the namespace suffix behavior (zero-width characters)? Most users do not know about namespacing. Showing suffixed vs. unsuffixed names could confuse rather than inform.
- What is the expected preview response time for an instance with 20+ quality profiles and 100+ custom formats? The Arr API round-trip for fetching CFs and QPs is the bottleneck. Should preview cache the remote state briefly?
- Should preview be available for instances with the `schedule` trigger, or only for `manual` trigger configurations? Users with automated sync may still want on-demand previews to understand what the next sync will do.
- How does preview interact with the `claimSync()` / `sync_status` mechanism? A preview should not change sync status, but it should be aware of an in-progress sync (to avoid conflicting reads).

## Relevant Files

### Sync Pipeline (Primary modification targets)

- `/packages/praxrr-app/src/lib/server/sync/base.ts`: Abstract `BaseSyncer` with `fetchFromPcd()` / `transformToArr()` / `pushToArr()` pipeline -- preview adds a `computeDiff()` step
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: `SyncResult`, `SectionType`, `SectionHandler`, `BaseSyncer` interface -- extend with preview types
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: `processPendingSyncs()`, `syncInstance()`, `triggerSyncs()` -- add `previewInstance()` parallel function
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry -- may need `createPreviewer()` factory method
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: `scanForStaleItems()` / `deleteStaleItems()` -- strongest architectural precedent for scan/execute pattern

### Syncer Implementations (Diff logic sources)

- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: `QualityProfileSyncer.sync()` -- extract create-vs-update decision logic for preview
- `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: `syncCustomFormats()` -- extract diff between PCD CFs and remote CFs
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: `DelayProfileSyncer.sync()` -- simpler diff (single profile update)
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: `MediaManagementSyncer.sync()` -- three sub-sections, each needs diff logic
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: Metadata profile syncer for Lidarr

### Transformers (Reused by preview)

- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: `transformQualityProfile()` -- produces the desired Arr payload for comparison
- `/packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: `transformCustomFormatWithDiagnostics()` -- produces desired CF payload
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Quality/language/source mappings per `arr_type`
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: `getNamespaceSuffix()`, `stripNamespaceSuffix()` -- namespace handling for preview display

### Arr Client (Remote state fetching)

- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient` with `getCustomFormats()`, `getQualityProfiles()`, etc. -- used by preview to fetch current remote state
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: Arr API response types for diff comparison
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Client factory and cache -- preview reuses this

### Job System (Async preview support)

- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Existing sync job handler -- model for preview job handler
- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: `JobType` union -- extend with `'arr.sync.preview'`
- `/packages/praxrr-app/src/lib/server/jobs/queueService.ts`: `enqueueJob()` -- used to queue preview jobs

### UI (Preview display)

- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`: Main sync configuration page -- add preview trigger
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Server-side sync page -- add preview action
- `/packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`: Footer with Save/Sync buttons -- add Preview button
- `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: Cleanup API route -- architectural pattern for preview API

### API Spec

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`: Root OpenAPI spec -- add preview paths
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/arr.yaml`: Arr API paths -- add preview endpoint definition

### PCD System (Data source for preview)

- `/packages/praxrr-app/src/lib/server/pcd/index.ts`: PCD public API -- `getCache()`, `getCachedDatabaseIds()` used by preview
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache` -- in-memory compiled PCD data
- `/packages/praxrr-app/src/lib/server/pcd/entities/`: Entity query modules used by syncers to fetch PCD data

### Database (Preview storage for Phase 2)

- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Reference schema -- new `arr_sync_previews` table needed
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Sync config queries -- preview queries follow same pattern

### Notifications (Preview notifications for Phase 2)

- `/packages/praxrr-app/src/lib/server/notifications/types.ts`: `NotificationTypes` -- extend with preview types
- `/packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`: Notification dispatch -- used by preview

## Architectural Patterns

- **Scan/Execute pattern**: The cleanup module (`cleanup.ts` + `api/v1/arr/cleanup/+server.ts`) implements a two-phase pattern: scan returns a diff, execute applies it. Preview should follow this exactly.
- **Section handler registry**: The `SectionHandler` interface in `registry.ts` provides a generic interface for all sync section types. Preview can extend this with a `createPreviewer()` factory or reuse `createSyncer()` with a `dryRun` flag.
- **Job queue with deduplication**: The existing `dedupeKey` pattern in `triggerSyncs()` prevents duplicate sync jobs. Preview should use its own dedupe namespace.
- **Namespace-aware comparison**: All remote entity names are suffixed with invisible Unicode characters for multi-database isolation. Preview diffs must strip suffixes for display using the existing `stripNamespaceSuffix()` utility.
- **Arr-type dispatch**: Every sync operation validates and dispatches per `arr_type` via `isSyncSectionSupported()` and Arr-specific transformers. Preview inherits this dispatch pattern.

## Edgecases

- Lidarr delay profiles resolve the "default" profile at runtime (`resolveTargetDelayProfile()` in `delayProfiles/syncer.ts` lines 90-105) -- preview must replicate this resolution logic, not assume id=1
- Custom formats with all conditions skipped for Lidarr produce empty specification arrays and are excluded from sync (`customFormats/syncer.ts` lines 56-67) -- preview should show these as "will be skipped" rather than "will be deleted"
- Quality profiles depend on CFs being synced first (section order matters per `SYNC_SECTION_ORDER` in `mappings.ts`) -- preview must compute CF changes before QP changes to produce accurate format ID mappings
- The `claimSync()` mechanism uses atomic DB operations to prevent double-processing -- preview must NOT call `claimSync()` or modify `sync_status`
- Namespace indices are assigned via `getOrCreate()` in `arrNamespaceQueries` -- preview should use `get()` (read-only) and handle the case where no namespace exists yet (first sync for a database)
- Media management sync modifies existing singleton configs (GET full config, modify specific fields, PUT back) -- the diff must only show Praxrr-managed fields, not the full remote config

## Other Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/report.md`: Comprehensive research report validating sync preview as highest-impact feature
- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/persona-findings/analogist.md`: Terraform plan/apply analogy analysis
- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/persona-findings/systems-thinker.md`: Blast radius analysis and safety infrastructure reasoning
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture documentation
