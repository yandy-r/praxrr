# Feature Spec: Sync Preview / Dry-Run

## Executive Summary

Sync Preview adds a Terraform-style plan/apply workflow to Praxrr's Arr sync pipeline, allowing users to see exactly what creates, updates, and deletes a sync would perform -- with field-level detail -- before any changes reach live Arr instances. The implementation reuses the existing syncer fetch+transform code path but intercepts before the push phase, diffing the transformed PCD desired state against current Arr remote state via a lightweight diff engine. This is the highest-consensus feature from research (7/8 independent research personas recommend it), no competitor offers it, and it resolves the centralization paradox where Praxrr's value (centralized config management) equals its greatest risk (blast radius of misconfiguration). Phase 1 targets quality profiles and custom formats via a new `/api/v1/sync/preview` endpoint with an inline diff UI; later phases extend to all section types, persistent plans, and background drift detection.

## External Dependencies

### APIs and Services

No new external API integrations required. All necessary Arr API endpoints are already implemented in `BaseArrClient`. Preview uses only existing GET endpoints for state comparison.

#### Radarr API (v3)

- **Documentation**: <https://radarr.video/docs/api/>
- **Key GET Endpoints**: `/api/v3/customformat`, `/api/v3/qualityprofile`, `/api/v3/qualitydefinition`, `/api/v3/delayprofile`, `/api/v3/config/mediamanagement`, `/api/v3/config/naming`, `/api/v3/tag`
- **Authentication**: `X-Api-Key` header (already wired)
- **Rate Limits**: None (local API). Praxrr uses `CONCURRENCY_LIMIT = 3` for parallel instance processing.

#### Sonarr API (v3)

- **Documentation**: <https://sonarr.tv/docs/api/>
- **Key GET Endpoints**: Same as Radarr plus `/api/v3/releaseprofile` (deprecated in v4)
- **Notes**: Sonarr v4 uses same v3 prefix. `colonReplacementFormat` is integer (not string like Radarr).

#### Lidarr API (v1)

- **Documentation**: <https://lidarr.audio/docs/api/>
- **Key GET Endpoints**: Same structure but `/api/v1/` prefix. Additional: `/api/v1/metadataprofile`
- **Notes**: `LidarrClient` already overrides `apiVersion = 'v1'`. Custom format conditions subset differs.

### Libraries and SDKs

| Library   | Version | Purpose                                                   | Installation                                      |
| --------- | ------- | --------------------------------------------------------- | ------------------------------------------------- |
| microdiff | ^1.3.1  | Lightweight JSON deep-diff (<1kb, zero deps, Deno-native) | `npm:microdiff` or `deno.land/x/microdiff@v1.3.1` |

**Why microdiff**: Deno-native via `deno.land/x`, <1kb, zero dependencies, TypeScript built-in, output format maps directly to Terraform-style actions (`CREATE`/`CHANGE`/`REMOVE` -> `create`/`update`/`delete`). `cyclesFix: false` optimization is safe for JSON API data.

**Alternative**: `json-diff-ts` if key-based array matching is needed for `formatItems` (matches by `name` instead of array index). Evaluate during implementation.

### External Documentation

- [Terraform JSON Output Format](https://developer.hashicorp.com/terraform/internals/json-format): Plan format precedent
- [ArgoCD Diff Strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/): Desired vs live comparison patterns
- [Ansible Check Mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html): `dryRun` flag propagation pattern

## Business Requirements

### User Stories

**Primary User: Praxrr Admin (Single Instance)**

- As a Praxrr admin, I want to preview what changes a sync will make to my quality profiles and custom formats so that
  I can verify correctness before applying changes that could affect my library's download behavior.
- As a Praxrr admin, I want to see field-level diffs (e.g., "score changed from 100 to 150 on custom format 'HDR10+'")
  so that I can understand the impact of upstream PCD changes.

**Primary User: Praxrr Admin (Multi-Instance)**

- As a Praxrr admin managing multiple Arr instances, I want to preview sync changes per-instance so that I can confirm each instance receives the correct configuration for its type.
- As a Praxrr admin, I want to preview changes across all my instances at once so I can do a single review pass before confirming a batch sync.

**Secondary User: API Consumer**

- As an API consumer, I want a preview endpoint that returns structured JSON with create/update/delete arrays and field-level diffs so I can build approval workflows or CI/CD gates around sync operations.

**Secondary User: Post-PCD-Update Admin**

- As a Praxrr admin who just pulled a PCD database update, I want to see what the auto-triggered sync would change on my instances so I can decide whether to let it proceed.

### Business Rules

1. **Same Code Path for Preview and Execute**: Preview must use the identical fetch-from-PCD and transform-to-Arr logic as sync. The divergence point is only at the push step: preview diffs, execute writes.

2. **Entity Matching by Suffixed Name**: Custom formats and quality profiles match by namespace-suffixed name (PCD name + zero-width Unicode suffix). Delay profiles match by resolved target ID. Media management and naming configs match by singleton config ID. Metadata profiles match by suffixed name.

3. **Change Classification**: Every entity classified as `create` (no match in Arr), `update` (match but fields differ), `unchanged` (match and identical), or `delete` (Arr entity not in expected set, cleanup-only).

4. **Field-Level Diff for Updates**: Updates must show which fields changed with before/after values for quality profiles (quality ordering, cutoff, format scores), custom formats (specifications, renaming flag), delay profiles (protocol settings, delays), media management (per-sub-section), and metadata profiles (album types, release statuses).

5. **Per-Instance Scoping**: Preview is always scoped to a single Arr instance. Multi-instance preview runs per-instance previews in parallel (up to `CONCURRENCY_LIMIT = 3`).

6. **Per-Section Scoping**: Preview can target specific section types or default to all configured sections.

7. **Arr Type Validation**: Per Cross-Arr Semantic Validation Policy, preview validates section support, quality definitions, language mappings, and condition transformations per `arr_type`.

8. **Read-Only Operations Only**: Preview performs only GET requests against Arr APIs. No POST, PUT, DELETE during preview generation. No database state modifications (`sync_status`, `should_sync`, `last_synced_at`).

9. **Preview Staleness Detection**: Previews include `createdAt` timestamp. Apply validates age. Stale previews (>5 min) show warning; very stale (>30 min) block apply.

### Edge Cases

| Scenario                                     | Expected Behavior                                         | Notes                                       |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| Empty sync config for instance               | Return empty changeset (not error)                        | Matches current sync behavior               |
| Missing PCD cache for a database             | Warning per-database, continue other databases            | Not a hard failure                          |
| Deleted database reference in sync selection | Skip with warning                                         | Matches `fetchSyncBatchByDatabase` behavior |
| Lidarr unsupported CF conditions             | Show as "skipped" info note                               | Language, source, resolution conditions     |
| Namespace overflow (>5 databases)            | Display database name, not invisible suffixes             | Zero-width space rendering                  |
| Quality profile assigned to media (cleanup)  | Flag as "delete blocked"                                  | Arr returns HTTP 500 on delete              |
| Concurrent sync during preview               | Preview succeeds (read-only), warn about in-progress sync | Preview may be stale when sync completes    |
| Arr instance unreachable                     | Immediate error with recovery action                      | Cannot preview without live state           |
| Zero-score format items                      | Not shown as "changes" unless score actually changed      | Arr requires all CFs in formatItems         |
| CF with all conditions skipped for Lidarr    | Excluded from diff (matches sync behavior)                | Show as informational note                  |

### Success Criteria

- [ ] Accurate diff for all four section types matching what actual sync would do
- [ ] Same transformation code path as sync (no duplicated transform logic)
- [ ] Zero write operations against Arr APIs during preview
- [ ] Zero app database state modifications during preview
- [ ] Correct multi-database namespace suffix handling
- [ ] Correct per-`arr_type` differences (Lidarr condition skipping, metadata profiles)
- [ ] Field-level diffs for updated entities
- [ ] Structured JSON API response for UI and programmatic consumption
- [ ] Stale preview detection prevents applying outdated diffs
- [ ] Clear create/update/unchanged/delete classification in UI

## Technical Specifications

### Architecture Overview

```
                               +---------------------------+
                               |       API Layer           |
                               |  POST /sync/preview       |
                               |  GET  /sync/preview/:id   |
                               |  POST /sync/preview/:id   |
                               |        /apply             |
                               +------------+--------------+
                                            |
                        +-------------------v-------------------+
                        |          PreviewOrchestrator          |
                        |  - coordinates per-section previews   |
                        |  - manages preview store (TTL cache)  |
                        +-------+------------------+------------+
                                |                  |
               +----------------v-----+   +-------v--------------+
               |   Section Syncers    |   |     DiffEngine       |
               | (existing code path) |   | - compare desired    |
               | fetchFromPcd()       |   |   vs remote state    |
               | transformToArr()     |   | - produce change set |
               | +--[pushToArr()      |   | - field-level detail |
               |    INTERCEPTED]      |   +-------+--------------+
               +----------------+-----+           |
                                |                 |
                    +-----------v-----------+     |
                    |   Arr Remote State    |     |
                    |   (fetched via Arr    |     |
                    |    API client)        |-----+
                    +-----------------------+
```

**Key design principle**: Same code path for preview and execute. Since syncers already separate fetch+transform from push, preview intercepts after transform but before push.

**Critical observation**: All four syncers override `sync()` entirely and do NOT use the base class template methods. The actual fetch+transform+push logic is inlined in each syncer's `sync()` method. Preview adds separate `generatePreview()` methods that call the same internal fetch/transform helpers but pass results to the DiffEngine instead of Arr write APIs.

**Strongest codebase precedent**: The cleanup module (`cleanup.ts`) already implements a scan-then-execute pattern: `scanForStaleItems()` computes what would be deleted, then `deleteStaleItems()` executes. The cleanup API route requires a separate "execute" call with the scan result. This maps 1:1 to preview/apply.

### Data Models

#### SyncPreviewResult (Top-Level)

| Field            | Type                     | Description                                                            |
| ---------------- | ------------------------ | ---------------------------------------------------------------------- |
| id               | `PreviewId` (string)     | Format: `preview_<instanceId>_<timestamp>`                             |
| instanceId       | number                   | Target Arr instance                                                    |
| instanceName     | string                   | Display name                                                           |
| arrType          | SyncArrType              | radarr / sonarr / lidarr                                               |
| createdAt        | string (ISO 8601)        | Generation timestamp                                                   |
| expiresAt        | string (ISO 8601)        | createdAt + TTL (10 min default)                                       |
| status           | enum                     | `generating` / `ready` / `applying` / `applied` / `failed` / `expired` |
| error            | string?                  | Error message if failed                                                |
| sections         | SectionType[]            | Which sections were previewed                                          |
| qualityProfiles  | QualityProfilesPreview?  | CF + QP changes                                                        |
| delayProfiles    | DelayProfilesPreview?    | Delay profile changes                                                  |
| mediaManagement  | MediaManagementPreview?  | Naming, quality defs, media settings                                   |
| metadataProfiles | MetadataProfilesPreview? | Lidarr-only                                                            |
| summary          | PreviewSummary           | Aggregate counts                                                       |

#### EntityChange (Per-Entity Diff)

| Field      | Type          | Description                                               |
| ---------- | ------------- | --------------------------------------------------------- |
| entityType | string        | `customFormat` / `qualityProfile` / `delayProfile` / etc. |
| name       | string        | Display name (stripped of namespace suffix)               |
| action     | ChangeAction  | `create` / `update` / `delete` / `unchanged`              |
| remoteId   | number / null | Arr API ID if exists                                      |
| fields     | FieldChange[] | Empty for unchanged/full-create                           |

#### FieldChange (Per-Field Diff)

| Field   | Type    | Description                                   |
| ------- | ------- | --------------------------------------------- |
| field   | string  | Dot-notation path (e.g., `cutoffFormatScore`) |
| type    | enum    | `added` / `changed` / `removed`               |
| current | unknown | Null for creates                              |
| desired | unknown | Null for deletes                              |

#### Section-Specific Preview Types

```typescript
interface QualityProfilesPreview {
  customFormats: EntityChange[];
  qualityProfiles: EntityChange[];
}

interface DelayProfilesPreview {
  profile: EntityChange | null;
}

interface MediaManagementPreview {
  naming: EntityChange | null;
  qualityDefinitions: EntityChange[];
  mediaSettings: EntityChange | null;
}

interface MetadataProfilesPreview {
  profile: EntityChange | null;
}
```

#### Preview Storage: Ephemeral In-Memory Cache

No new database tables. Previews stored in a TTL-based in-memory Map (`PreviewStore`). Rationale: previews are inherently ephemeral snapshots that become stale quickly, no need to survive restarts, avoids migration complexity, matches Terraform plans being ephemeral artifacts.

### API Design

#### `POST /api/v1/sync/preview`

**Purpose**: Generate a new sync preview for an instance.

**Request:**

```json
{
  "instanceId": 1,
  "sections": ["qualityProfiles", "delayProfiles"]
}
```

`sections` is optional; defaults to all configured sections.

**Response (200 OK or 202 Accepted):**

```json
{
  "id": "preview_1_1708454400",
  "status": "ready",
  "instanceId": 1,
  "instanceName": "My Radarr",
  "arrType": "radarr",
  "createdAt": "2026-02-20T20:00:00Z",
  "expiresAt": "2026-02-20T20:10:00Z",
  "sections": ["qualityProfiles"],
  "qualityProfiles": {
    "customFormats": [
      {
        "entityType": "customFormat",
        "name": "HDR10+",
        "action": "create",
        "remoteId": null,
        "fields": []
      },
      {
        "entityType": "customFormat",
        "name": "DV",
        "action": "update",
        "remoteId": 42,
        "fields": [
          {
            "field": "specifications[0].fields[0].value",
            "type": "changed",
            "current": "^dv$",
            "desired": "\\bdv\\b"
          }
        ]
      }
    ],
    "qualityProfiles": [
      {
        "entityType": "qualityProfile",
        "name": "HD Bluray + WEB",
        "action": "update",
        "remoteId": 5,
        "fields": [
          {
            "field": "cutoffFormatScore",
            "type": "changed",
            "current": 1500,
            "desired": 2000
          },
          {
            "field": "formatItems[HDR10+].score",
            "type": "changed",
            "current": 0,
            "desired": 1500
          }
        ]
      }
    ]
  },
  "summary": {
    "totalCreates": 1,
    "totalUpdates": 2,
    "totalDeletes": 0,
    "totalUnchanged": 15
  }
}
```

**Errors:** 400 (invalid instanceId, instance disabled), 409 (preview already generating), 500 (internal error).

**Behavior**: Hybrid sync/async. Tries to complete within 5s and return inline. If slower, returns `202` with `generating` status and client polls GET.

#### `GET /api/v1/sync/preview/:id`

**Purpose**: Get current state of a preview.
**Response**: Full `SyncPreviewResult` or 404 if not found/expired.

#### `POST /api/v1/sync/preview/:id/apply`

**Purpose**: Confirm and execute the previewed changes via regular sync.

**Request:**

```json
{
  "sections": ["qualityProfiles"]
}
```

**Response (200):**

```json
{
  "success": true,
  "results": {},
  "staleWarning": "Preview was generated 7 minutes ago."
}
```

**Behavior**: Validates preview is in `ready` status. Runs actual sync (same code path as "Sync Now"). Blocks if sync already in_progress. Includes staleness warning if preview age > 5 min.

**Errors:** 404 (not found/expired), 409 (not in `ready` state), 422 (stale, strict mode).

#### `DELETE /api/v1/sync/preview/:id`

**Purpose**: Discard a preview. **Response**: 204 No Content.

### System Integration

#### Files to Create

| File                                                      | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `$sync/preview/index.ts`                                  | Module barrel export                                         |
| `$sync/preview/types.ts`                                  | All preview TypeScript types                                 |
| `$sync/preview/store.ts`                                  | In-memory TTL cache for preview results                      |
| `$sync/preview/orchestrator.ts`                           | Coordinates preview generation across sections               |
| `$sync/preview/diff.ts`                                   | Generic deep-diff engine (wraps microdiff)                   |
| `$sync/preview/sectionDiffs.ts`                           | Section-specific diff logic (CF, QP, delay, media, metadata) |
| `routes/api/v1/sync/preview/+server.ts`                   | POST endpoint                                                |
| `routes/api/v1/sync/preview/[previewId]/+server.ts`       | GET and DELETE endpoints                                     |
| `routes/api/v1/sync/preview/[previewId]/apply/+server.ts` | POST apply endpoint                                          |
| `docs/api/v1/paths/sync.yaml`                             | OpenAPI path definitions                                     |
| `docs/api/v1/schemas/sync.yaml`                           | OpenAPI schema definitions                                   |

#### Files to Modify

| File                               | Change                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `$sync/qualityProfiles/syncer.ts`  | Extract fetch+transform logic; add `generatePreview()` method |
| `$sync/customFormats/syncer.ts`    | Extract transform-only path; add `previewCustomFormats()`     |
| `$sync/delayProfiles/syncer.ts`    | Add `generatePreview()` method                                |
| `$sync/mediaManagement/syncer.ts`  | Add `generatePreview()` for each sub-section                  |
| `$sync/metadataProfiles/syncer.ts` | Add `generatePreview()` method                                |
| `$sync/types.ts`                   | Add preview types to section handler interface                |
| `$sync/base.ts`                    | Optionally add `generatePreview()` to abstract interface      |
| `$sync/index.ts`                   | Add preview module re-exports                                 |
| `docs/api/v1/openapi.yaml`         | Add sync preview path references                              |

#### Database Migrations

**None.** Preview results are ephemeral (in-memory). If persistence is later needed for audit trail, a migration can add `arr_sync_previews` table.

## UX Considerations

### User Workflows

#### Primary Workflow: Preview -> Review -> Apply

1. **Initiate**: User clicks "Preview Sync" on `/arr/[id]/sync` page
   - System validates instance is enabled and reachable
2. **Loading**: Per-section progress indicators as state is fetched and diffed
3. **Review Summary**: Summary banner: "12 creates, 8 updates, 2 deletes, 45 unchanged"
   - Per-section breakdowns with entity-level changes
4. **Inspect Details**: Expand entity to see field-level before/after diffs
5. **Confirm**: Click "Apply Changes" with tiered confirmation:
   - Low risk (creates/minor updates): Standard confirm dialog
   - High risk (deletes): Type-to-confirm pattern (Terraform destroy style)
6. **Execute**: Real-time progress with per-entity success/failure
7. **Results**: Final summary of what was applied

#### Error Recovery Workflow

| Error                      | User Sees                                             | Recovery                                    |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| Instance unreachable       | Red banner: "Cannot connect to [name] at [host:port]" | "Retry Connection" button; link to settings |
| API auth failure           | Red banner: "Authentication failed"                   | "Check API Key" link                        |
| Partial preview failure    | Red on failed; green on successful instances          | "Retry Failed" button                       |
| PCD cache missing          | Amber warning within instance card                    | "Compile Database" action link              |
| Apply failure (per entity) | Red inline on specific entity row                     | "Retry" button per entity                   |

### UI Patterns

| Component              | Pattern                                | Notes                                                      |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Change type indicators | Color + icon + text triple-encoding    | Green/`+`/"Create", Amber/`~`/"Update", Red/`-`/"Delete"   |
| Instance grouping      | Accordion cards                        | Expanded if changes exist; collapsed if no changes         |
| Information hierarchy  | 4-level progressive disclosure         | Summary -> Instance -> Section -> Entity detail            |
| Field diffs            | Property-level before/after table      | CloudFormation-style: Field / Change Type / Before / After |
| Collection diffs       | Nested expandable section              | `[+] HDR10+ score: 1500`, `[~] DV score: 1000 -> 1200`     |
| Staleness              | Timestamp + amber warning after 5min   | Hard block after 30min                                     |
| Confirmation           | Tiered by risk level                   | Simple confirm vs type-to-confirm for destructive          |
| Filtering              | Toggle buttons for change types        | Show only creates/updates/deletes/unchanged                |
| Selective apply        | Per-instance and per-entity checkboxes | Tri-state parent checkbox for partial selection            |

### Accessibility Requirements

- **WCAG 2.2 SC 1.4.1**: Color never sole indicator. Every colored badge includes icon + text.
- **WCAG 2.2 SC 1.4.11**: Status indicators meet 3:1 contrast ratio (Tailwind 600 shades on white).
- **Keyboard navigation**: Tab through instance cards, Enter expand/collapse, arrow keys within sections.
- **ARIA live regions**: `aria-live="polite"` for staleness transitions and apply progress.
- **Screen reader**: Change counts announced in summary; expand/collapse states communicated.

### Performance UX

- **Loading States**: Per-instance streaming results. Instances that complete first are immediately reviewable while others load. Determinate progress ("Previewing instance 2 of 3").
- **Preview Generation Time**: Expected 1-5 seconds for single instance (dominated by Arr API latency). Hybrid sync/async: return inline if <5s, else return `generating` and client polls.
- **Optimistic UI**: Immediately transition to preview page with skeleton/loading state.
- **"No changes" state**: Friendly positive message: "All entities are up to date. No changes needed." with subtle green checkmark. Not an error, a success state.
- **Read-only emphasis**: Clear indicator: "Preview mode -- no changes will be applied until you confirm."

## Recommendations

### Implementation Approach

**Recommended Strategy**: Start with inline preview (compute on demand), evolve to persistent plans, then background drift detection. This mirrors Terraform's evolution: `plan` started inline, gained persistence (`-out=planfile`), then gained automation (CI/CD integration).

**Technology Decisions:**

| Decision           | Recommendation                         | Rationale                                                 |
| ------------------ | -------------------------------------- | --------------------------------------------------------- |
| Diff library       | microdiff                              | <1kb, Deno-native, zero deps, output maps to plan actions |
| Preview storage    | In-memory TTL Map (Phase 1)            | Ephemeral snapshots, no migration needed                  |
| Sync code reuse    | Separate `generatePreview()` methods   | Avoids branching in working sync path                     |
| Apply execution    | Trigger regular sync (not replay diff) | Same code path eliminates preview/execute drift           |
| Preview generation | Hybrid sync/async                      | Fast for common case, handles slow instances              |
| Section scoping    | Per-section optional                   | Users may preview only quality profiles                   |
| Apply from preview | Regular sync trigger                   | Idempotent sync = same result as preview                  |
| Job queue          | Synchronous for Phase 1                | Same as cleanup scan, add async in Phase 2                |

### Quick Wins

- **"Preview" button in SyncFooter**: UI-only addition alongside "Save" and "Sync Now"
- **Preview type definitions**: Define types in `$sync/types.ts` to establish the contract
- **OpenAPI spec**: Contract-first per codebase convention, unblocks parallel frontend/backend work
- **Extract create-vs-update logic**: Refactor decision logic in QP syncer into pure function (benefits both preview and existing sync)

### Future Enhancements

- **Drift Detection (#10)**: Preview without "apply" IS drift detection. Run on schedule, compare against "no changes expected".
- **State Snapshots (#10)**: Current remote state fetched during preview = restore-point data.
- **Rollback (#16)**: If previews store both desired and current state, rollback = "apply old current as new desired".
- **Canary Sync (#19)**: Preview across N instances, apply to 1, re-preview others to verify.
- **Score Impact Visualization**: "Profile X score goes from 150 to 175" from CF score changes.
- **Multi-Instance Diff Comparison**: Show "Instance A already has this, Instance B does not".
- **Preview-as-Documentation**: Preview of "everything that would sync" = living documentation.

## Risk Assessment

### Technical Risks

| Risk                                                           | Likelihood | Impact | Mitigation                                                          |
| -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------- |
| Stale preview (remote state changes between preview and apply) | High       | High   | Re-validate at apply time; short TTL (10 min); staleness warnings   |
| Preview/execute code path drift                                | Low        | High   | Both paths share fetch/transform functions; only final step differs |
| Large preview payloads (100+ CFs)                              | Medium     | Low    | Paginate/summarize diff; expand on demand                           |
| Namespace suffix complexity in diffs                           | Medium     | Medium | Strip suffixes for display via `stripNamespaceSuffix()`             |
| PCD cache unavailability                                       | Low        | Medium | Clear "PCD cache not available" error                               |
| Arr API rate from preview generation                           | Medium     | Medium | Reuse `ArrInstanceClientCache`; batch requests                      |

### Integration Challenges

- **Arr client connection failures**: Use same connection test and `isArrCredentialFailure()` as existing sync handler
- **Job queue interaction**: Preview must not block/interfere with active sync jobs; use separate `dedupeKey` namespace
- **Cross-Arr semantic validation**: Preview inherits existing per-`arr_type` dispatch via `isSyncSectionSupported()`
- **Concurrent preview requests**: Deduplicate via job queue `dedupeKey` pattern

### Security Considerations

- Preview never includes API keys in output (authentication at transport layer)
- Preview data follows same access control as sync configuration
- CF specifications may contain proprietary regex patterns -- handle with same auth gates

## Task Breakdown Preview

### Phase 1: Foundation and MVP (Quality Profiles + Custom Formats)

**Focus**: End-to-end preview for the highest-value sync section.
**Tasks**:

- Define preview types (`SyncPreviewResult`, `EntityChange`, `FieldChange`) in `$sync/preview/types.ts`
- Define OpenAPI spec for `/api/v1/sync/preview` endpoints
- Implement diff engine wrapping microdiff with normalization (field filtering, suffix handling)
- Extract shared fetch/transform logic from `QualityProfileSyncer.sync()` into reusable functions
- Implement `generatePreview()` for quality profiles (CFs + QPs)
- Create preview API endpoints (POST create, GET retrieve, POST apply, DELETE discard)
- Implement in-memory preview store with TTL
- Add "Preview" button to SyncFooter and preview display component
- Build diff visualization UI (summary banner, entity rows, field-level detail)

**Parallelization**: Types + OpenAPI spec can run parallel. Backend refactoring + UI work parallel once types stable.

### Phase 2: Full Section Coverage + Apply-from-Preview

**Focus**: Extend to all sync sections, add apply confirmation flow.
**Dependencies**: Phase 1 complete.
**Tasks**:

- Extend preview to delay profiles
- Extend preview to media management (naming, quality definitions, media settings)
- Extend preview to metadata profiles (Lidarr-only)
- Implement apply-from-preview with staleness validation
- Add tiered confirmation UX (simple confirm vs type-to-confirm for destructive)
- Add selective apply (per-section and per-entity checkboxes)
- Add filtering and search in preview UI

### Phase 3: Background Preview + Drift Foundation

**Focus**: Proactive previews, drift detection, infrastructure for rollback.
**Dependencies**: Phase 2 complete, user feedback validates value.
**Tasks**:

- Hook preview into PCD change events (reuse `triggerSyncs()` trigger points)
- Build drift detection as scheduled preview with "expected: no changes" baseline
- Add preview staleness indicators in UI
- Register `arr.sync.preview` notification types
- Canary sync support (apply to one instance, verify, propagate)
- State snapshot capture for future rollback support

## Decisions Needed

1. **Preview as separate button vs preview-before-sync gate**
   - Options: (A) Independent "Preview" and "Sync Now" buttons, (B) "Sync Now" always previews first
   - Impact: (B) maximizes safety but adds friction for users who trust their config
   - Recommendation: (A) Independent buttons. Avoid preview fatigue. Consider user preference for "always preview first" later.

2. **Diff granularity for custom format specifications**
   - Options: (A) CF-level (changed/not changed), (B) Specification-level (individual condition diffs)
   - Impact: (B) is more informative but significantly more complex
   - Recommendation: (A) CF-level changes with expandable specification-level detail for Phase 1. Deep spec diffs in Phase 2.

3. **Unchanged entity display**
   - Options: (A) Completely hidden (Terraform approach), (B) Collapsed summary row "N unchanged"
   - Impact: (A) is cleaner but loses context; (B) preserves awareness of managed scope
   - Recommendation: (B) Collapsed summary with expand option. Shows what Praxrr manages.

4. **Preview for event-triggered syncs**
   - Options: (A) Auto-preview on PCD pull (intercept trigger), (B) Preview remains manual-only
   - Impact: (A) is the most impactful UX change but requires intercepting existing trigger flow
   - Recommendation: (B) for Phase 1. Consider (A) for Phase 3 after validating manual preview usage.

5. **Cleanup integration**
   - Options: (A) Cleanup preview integrated into sync preview, (B) Separate operations
   - Impact: (A) gives complete picture but merges two distinct flows
   - Recommendation: (B) Keep separate for Phase 1. Evaluate merging in Phase 2.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Arr API endpoints, diff libraries (microdiff vs json-diff-ts), IaC precedents (Terraform, ArgoCD, Ansible, Pulumi), SSE streaming patterns
- [research-business.md](./research-business.md): User stories, business rules, domain model, existing sync pipeline analysis, cleanup scan/execute precedent
- [research-technical.md](./research-technical.md): Architecture design, data models, API design, system constraints, technical decisions (ephemeral vs persistent, sync reuse strategy, apply execution path)
- [research-ux.md](./research-ux.md): Diff visualization best practices, multi-instance layout, confirmation UX, competitive analysis (Terraform Cloud, ArgoCD, CloudFormation, Pulumi, GitHub PR), accessibility, responsive design
- [research-recommendations.md](./research-recommendations.md): Phasing strategy, technology choices, risk assessment, alternative approaches (inline vs persistent vs background), future enhancements (drift detection, rollback, canary sync)
