# Technical Specifications: sync-preview-dry-run

## Executive Summary

Sync Preview adds a Terraform-style plan/apply workflow to Praxrr's Arr sync pipeline. The implementation introduces a diff engine that reuses the existing syncer fetch+transform code path but intercepts before the push phase, comparing the transformed PCD desired state against the current Arr remote state to produce a field-level change set. Preview results are ephemeral (in-memory with TTL), avoiding new database tables while keeping the architecture stateless-friendly.

## Architecture Design

### Component Diagram

```
                               +---------------------------+
                               |       API Layer           |
                               |  POST /sync/preview       |
                               |  GET  /sync/preview/:id   |
                               |  POST /sync/preview/:id   |
                               |        /apply             |
                               |  DELETE /sync/preview/:id  |
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

### Current Sync Pipeline Analysis

The sync system is built on a section-handler registry pattern with four sync section types:

**Core flow** (`/packages/praxrr-app/src/lib/server/sync/processor.ts`):

1. `processPendingSyncs()` or `syncInstance()` called
2. For each instance, sections are processed sequentially (dependency order: QP depends on CF)
3. Each section handler creates a syncer via `handler.createSyncer(client, instance)`
4. Syncer calls `sync()` which orchestrates `fetchFromPcd()` -> `transformToArr()` -> `pushToArr()`

**Section handlers** (registered in `registry.ts`):

- `qualityProfiles` - Complex: syncs CFs first (per-database namespace suffixed), then QPs
- `delayProfiles` - Simple: single profile update to default delay profile
- `mediaManagement` - Multi-config: naming, quality definitions, media settings
- `metadataProfiles` - Lidarr-only: single profile create/update

**Key abstractions**:

- `BaseSyncer` (`/packages/praxrr-app/src/lib/server/sync/base.ts`) - Template method pattern with `sync()` calling `fetchFromPcd()`, `transformToArr()`, `pushToArr()`
- `SectionHandler` (`/packages/praxrr-app/src/lib/server/sync/types.ts`) - Registry interface for status management and syncer factory
- `BaseArrClient` (`/packages/praxrr-app/src/lib/server/utils/arr/base.ts`) - HTTP client with typed methods for all Arr API endpoints

**Critical observation**: All four syncers override `sync()` entirely and do NOT use the base class template method. The `fetchFromPcd()`, `transformToArr()`, `pushToArr()` methods are stub implementations. The actual fetch+transform+push logic is inlined in each syncer's `sync()` method.

### Preview Integration Design

The key design principle is: **same code path for preview and execute**. Since the syncers already separate fetch+transform from push, the preview intercepts after transform but before push.

**Approach: Add a `dryRun` mode parameter to each syncer.**

Each syncer gets a `preview()` method (or a `mode` parameter on `sync()`) that:

1. Executes all fetch and transform logic identically to `sync()`
2. Fetches current remote state from Arr API (same GET calls sync already makes)
3. Instead of POST/PUT/DELETE, passes (desired, current) to the DiffEngine
4. Returns a `SectionPreviewResult` with the change set

This avoids code duplication because:

- QualityProfileSyncer already calls `fetchSyncBatchByDatabase()` and `syncCustomFormats()` (which does GET existing + transform). Preview reuses these but skips the PUT/POST calls.
- The cleanup scanner (`/packages/praxrr-app/src/lib/server/sync/cleanup.ts`) already implements a scan-before-execute pattern (`scanForStaleItems` + `deleteStaleItems`) which validates this approach.

**Integration point per syncer**:

| Syncer           | Current Remote Fetch                                                                              | Desired State Source                   | Diff Granularity                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| QualityProfiles  | `client.getQualityProfiles()` + `client.getCustomFormats()`                                       | PCD cache -> transform                 | CF: create/update by name. QP: create/update by suffixed name, field-level diff on items/formatItems/cutoff/scores |
| DelayProfiles    | `client.getDelayProfiles()` (for target profile)                                                  | PCD cache -> transform                 | Single profile update, field-level diff                                                                            |
| MediaManagement  | `client.getMediaManagementConfig()`, `client.getNamingConfig()`, `client.getQualityDefinitions()` | PCD cache -> transform per sub-section | Per-field diff on config objects                                                                                   |
| MetadataProfiles | `lidarrClient.getMetadataProfiles()`                                                              | PCD cache -> transform                 | Create or update, type/status toggle diffs                                                                         |

### Diff Engine Design

The diff engine compares two JSON-serializable objects and produces a structured change record.

**Algorithm**:

1. For **collection entities** (CFs, QPs, metadata profiles): match by name (with namespace suffix)
   - Present in desired but not in remote -> `create`
   - Present in both -> deep-compare fields -> `update` (if changed) or `unchanged`
   - Present in remote but not in desired -> `delete` (only if namespace-managed)
2. For **singleton configs** (delay profile, media management, naming): always `update`
   - Deep-compare only managed fields (not the entire config object)
3. Field-level diff: for each changed field, record `{ field, current, desired }`

**Matching strategy considerations**:

- CF and QP names are namespace-suffixed. The diff engine must strip suffixes for display but match on suffixed names.
- For quality profiles, `formatItems` comparison should be by format ID, not array index.
- For quality items (in quality profiles), comparison should be by quality name, not position.
- Arr API payloads include `id` fields that the diff engine should exclude from change detection.

## Data Models

### Preview Result Schema

```typescript
/**
 * Unique preview identifier
 * Format: `preview_<instanceId>_<timestamp>`
 */
type PreviewId = string;

/**
 * Top-level preview result stored in the preview cache
 */
interface SyncPreviewResult {
  id: PreviewId;
  instanceId: number;
  instanceName: string;
  arrType: SyncArrType;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (createdAt + TTL)
  status: 'generating' | 'ready' | 'applying' | 'applied' | 'failed' | 'expired';
  error?: string;

  // Scoping: which sections were previewed
  sections: SectionType[];

  // Per-section preview results
  qualityProfiles?: QualityProfilesPreview;
  delayProfiles?: DelayProfilesPreview;
  mediaManagement?: MediaManagementPreview;
  metadataProfiles?: MetadataProfilesPreview;

  // Summary counts
  summary: PreviewSummary;
}

interface PreviewSummary {
  totalCreates: number;
  totalUpdates: number;
  totalDeletes: number;
  totalUnchanged: number;
}
```

### Diff Representation

```typescript
type ChangeAction = 'create' | 'update' | 'delete' | 'unchanged';

/**
 * A single field-level change
 */
interface FieldChange {
  field: string;
  current: unknown; // null for creates
  desired: unknown; // null for deletes
}

/**
 * A change record for a single entity (CF, QP, delay profile, etc.)
 */
interface EntityChange {
  entityType: string; // 'customFormat' | 'qualityProfile' | 'delayProfile' | etc.
  name: string; // Display name (stripped of namespace suffix)
  action: ChangeAction;
  remoteId: number | null; // Arr API ID if exists
  fields: FieldChange[]; // Empty for unchanged/create-from-scratch
}

/**
 * Quality Profiles section preview
 * Includes both CFs and QPs since they are synced together
 */
interface QualityProfilesPreview {
  customFormats: EntityChange[];
  qualityProfiles: EntityChange[];
}

/**
 * Delay Profiles section preview
 */
interface DelayProfilesPreview {
  profile: EntityChange | null; // null if no delay profile configured
}

/**
 * Media Management section preview
 * Three sub-sections, each optional
 */
interface MediaManagementPreview {
  naming: EntityChange | null;
  qualityDefinitions: EntityChange[];
  mediaSettings: EntityChange | null;
}

/**
 * Metadata Profiles section preview (Lidarr only)
 */
interface MetadataProfilesPreview {
  profile: EntityChange | null;
}
```

### Preview Storage (Ephemeral In-Memory Cache)

No new database tables. Previews are stored in a TTL-based in-memory Map.

```typescript
/**
 * In-memory preview store with automatic expiration
 * Located at: packages/praxrr-app/src/lib/server/sync/preview/store.ts
 */
class PreviewStore {
  private previews: Map<PreviewId, SyncPreviewResult>;
  private readonly ttlMs: number; // Default: 10 minutes

  generate(id: PreviewId): SyncPreviewResult; // Create placeholder
  update(id: PreviewId, result: Partial<SyncPreviewResult>): void;
  get(id: PreviewId): SyncPreviewResult | null;
  delete(id: PreviewId): boolean;
  cleanup(): void; // Remove expired entries
}
```

**Rationale for ephemeral over persistent**:

- Previews are snapshots of remote state that become stale quickly
- No need to survive server restarts (just regenerate)
- Avoids migration complexity and DB bloat
- Matches the pattern of Terraform plans being ephemeral artifacts
- Cleanup API route already uses scan-then-execute ephemeral pattern

## API Design

### New Endpoints

#### POST /api/v1/sync/preview

Generate a new sync preview for an instance.

**Request**:

```typescript
interface CreatePreviewRequest {
  instanceId: number;
  sections?: SectionType[]; // Optional; defaults to all configured sections
}
```

**Response** (202 Accepted):

```typescript
interface CreatePreviewResponse {
  id: PreviewId;
  status: 'generating';
  instanceId: number;
  sections: SectionType[];
}
```

**Behavior**: Creates a preview record with `generating` status and kicks off async generation. The caller polls `GET /sync/preview/:id` for completion. For small instances, generation may complete synchronously and return `ready` immediately.

**Error responses**:

- 400: Invalid instanceId, instance not found, or instance disabled
- 409: Preview already generating for this instance
- 500: Internal error

#### GET /api/v1/sync/preview/:id

Get the current state of a preview.

**Response** (200 OK):

```typescript
// Returns full SyncPreviewResult
```

**Error responses**:

- 404: Preview not found or expired

#### POST /api/v1/sync/preview/:id/apply

Confirm and execute the previewed changes. This runs the actual sync using the same code path.

**Request**:

```typescript
interface ApplyPreviewRequest {
  sections?: SectionType[]; // Optional: apply only specific sections
}
```

**Response** (200 OK):

```typescript
interface ApplyPreviewResponse {
  success: boolean;
  results: InstanceSyncResult; // Reuses existing type
  staleWarning?: string; // Set if preview age > threshold (e.g., > 5 minutes)
}
```

**Behavior**:

1. Validates preview exists and is in `ready` status
2. Marks preview as `applying`
3. Runs actual sync (via existing syncer code path)
4. Marks preview as `applied` on success or `failed` on error
5. If preview is older than a configurable threshold, includes a staleness warning

**Error responses**:

- 404: Preview not found or expired
- 409: Preview not in `ready` state (already applying or applied)
- 422: Preview is stale (optional strict mode)

#### DELETE /api/v1/sync/preview/:id

Discard a preview.

**Response** (204 No Content)

**Error responses**:

- 404: Preview not found

### OpenAPI Spec Additions

New path group at `docs/api/v1/paths/sync.yaml` referenced from `openapi.yaml`:

```yaml
paths:
  /sync/preview:
    $ref: './paths/sync.yaml#/preview'
  /sync/preview/{previewId}:
    $ref: './paths/sync.yaml#/previewById'
  /sync/preview/{previewId}/apply:
    $ref: './paths/sync.yaml#/previewApply'
```

## System Constraints

### Performance

- **Arr API calls**: Preview generation requires the same GET calls as sync (getCustomFormats, getQualityProfiles, etc.). For an instance with multiple databases, this means N+1 API calls per section.
- **PCD cache reads**: Already in-memory SQLite, no concern.
- **Concurrency limit**: Reuse the existing `CONCURRENCY_LIMIT = 3` for parallel instance previews.
- **Expected preview generation time**: 1-5 seconds for a single instance (dominated by Arr API latency). Could be longer for instances with many CFs (hundreds).
- **Mitigation**: Generate async, return immediately with `generating` status, client polls.

### Staleness

- Remote Arr state can change between preview generation and apply.
- **Mitigation 1**: Include `createdAt` in preview, client UI shows age with visual warning after threshold.
- **Mitigation 2**: Apply endpoint includes optional staleness check; returns warning but still applies.
- **Mitigation 3**: The existing sync code is idempotent (creates if missing, updates if exists) so staleness does not cause data corruption -- at worst it creates something the user did not see in preview.
- **Not recommended**: Re-validating remote state on apply would double API calls and still have a TOCTOU race.

### Concurrency

- **Multiple previews**: Only one active preview per instance at a time. Generating a new one discards the old.
- **Preview while sync running**: If a sync is in_progress for the instance, preview generation should still work (read-only operation). Apply should be blocked if sync is in_progress.
- **Multiple users**: The preview store is global singleton. Last-writer-wins for same instance. Acceptable for single-user expected usage pattern.

### Arr API Rate Limits

- Preview generation makes the same GET calls that sync already makes.
- No additional write calls during preview (only reads).
- Apply phase makes the same write calls as regular sync.
- No new rate limit concerns beyond what already exists.

## Codebase Changes

### Files to Create

| File                                                                              | Purpose                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/sync/preview/index.ts`                        | Module barrel export                                                                                             |
| `packages/praxrr-app/src/lib/server/sync/preview/types.ts`                        | All preview-related TypeScript types (PreviewId, SyncPreviewResult, EntityChange, FieldChange, etc.)             |
| `packages/praxrr-app/src/lib/server/sync/preview/store.ts`                        | In-memory TTL cache for preview results                                                                          |
| `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                 | Coordinates preview generation across sections; reuses existing syncers in preview mode                          |
| `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`                         | Generic deep-diff engine for comparing desired vs current state                                                  |
| `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`                 | Section-specific diff logic (knows how to compare QPs, CFs, delay profiles, media management, metadata profiles) |
| `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`                   | POST /sync/preview endpoint                                                                                      |
| `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`       | GET /sync/preview/:id, DELETE /sync/preview/:id                                                                  |
| `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` | POST /sync/preview/:id/apply                                                                                     |
| `docs/api/v1/paths/sync.yaml`                                                     | OpenAPI path definitions for sync preview endpoints                                                              |
| `docs/api/v1/schemas/sync.yaml`                                                   | OpenAPI schema definitions for preview types                                                                     |

### Files to Modify

| File                                                                 | Change                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/sync/index.ts`                   | Add preview module re-exports                                                                                                                                               |
| `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`  | Extract fetch+transform logic into a reusable method that both `sync()` and preview can call. Add a `generatePreview()` method that runs fetch+transform+diff without push. |
| `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`    | Extract transform-only path. Add `previewCustomFormats()` that returns desired state without writing.                                                                       |
| `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`    | Add `generatePreview()` method returning desired vs current diff                                                                                                            |
| `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`  | Add `generatePreview()` method for each sub-section                                                                                                                         |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` | Add `generatePreview()` method                                                                                                                                              |
| `packages/praxrr-app/src/lib/server/sync/base.ts`                    | Optionally add `generatePreview()` to abstract interface                                                                                                                    |
| `packages/praxrr-app/src/lib/server/sync/types.ts`                   | Add `SectionPreviewResult` type to section handler interface; add `BaseSyncer.generatePreview()` signature                                                                  |
| `docs/api/v1/openapi.yaml`                                           | Add sync preview path references                                                                                                                                            |

### Database Migrations Needed

**None.** Preview results are ephemeral (in-memory). This is a deliberate design choice to avoid:

- Schema migration overhead
- Stale preview data accumulating in SQLite
- Cleanup job complexity

If persistence is later required (e.g., for audit trail), a migration can add a `sync_previews` table.

## Technical Decisions

### Decision 1: Ephemeral vs Persistent Preview Storage

**Options**:

- (A) In-memory Map with TTL -- simpler, no migration, auto-cleanup
- (B) SQLite table -- survives restarts, supports audit trail

**Recommendation**: (A) In-memory. Previews are inherently ephemeral snapshots. Persistence adds complexity without clear value. If audit trails are needed later, sync execution already logs to job_run_history.

### Decision 2: Sync Code Reuse Strategy

**Options**:

- (A) Add `mode: 'preview' | 'execute'` parameter to existing `sync()` methods
- (B) Add separate `generatePreview()` methods that share fetch/transform code
- (C) Create wrapper functions that call existing syncers with a mock client

**Recommendation**: (B) Separate `generatePreview()` methods. Rationale:

- All four syncers override `sync()` entirely, so parameterizing them would add branching complexity
- `generatePreview()` can call the same internal methods (e.g., `fetchSyncBatchByDatabase()`) but compose results differently
- Does not risk regressions in the working sync path
- Option (C) is fragile: mock clients would need to track all mutations and reconstruct state

### Decision 3: Apply Execution Path

**Options**:

- (A) Apply replays the preview diff (only execute the changes listed in the preview)
- (B) Apply triggers a regular sync (same as "Sync Now" button)

**Recommendation**: (B) Regular sync. Rationale:

- Using the exact same code path eliminates preview/execute drift by definition
- The sync is idempotent, so running it produces the same result as the preview (modulo staleness)
- Replaying a diff would require building a custom execution engine that duplicates sync logic
- This matches the Terraform model: `plan` shows what will happen, `apply` runs the real thing

### Decision 4: Preview Generation -- Sync vs Async

**Options**:

- (A) Fully synchronous: POST returns the complete preview
- (B) Async: POST returns an ID, client polls GET
- (C) Hybrid: Try sync with timeout, fall back to async

**Recommendation**: (C) Hybrid. Most previews for a single instance should complete within 2-3 seconds (Arr API GETs). Return the result inline if generation completes within a threshold (e.g., 5 seconds). For longer generations, return `generating` status and the client polls. This avoids unnecessary polling for the common case while handling slow instances gracefully.

### Decision 5: Section Scoping

**Options**:

- (A) Always preview all configured sections
- (B) Allow per-section scoping in the request

**Recommendation**: (B) Per-section scoping. Users may only want to preview quality profiles without waiting for media management diff. The `sections` parameter defaults to all configured sections if omitted.

## Open Questions

1. **Should preview show cleanup candidates?** The existing cleanup scan (`scanForStaleItems`) identifies CFs/QPs that would be deleted. Should preview integrate this, showing "these items exist in Arr but are not in your sync config"? This would make preview a superset of the cleanup scan.

2. **Custom format specification-level diffing**: CFs have nested specifications (conditions). Should the diff engine produce field-level diffs within each specification, or treat the entire specifications array as a single field? Deep diffing is more informative but significantly more complex.

3. **Preview for multi-database instances**: A single Arr instance can sync from multiple PCD databases (each with a namespace suffix). Should the preview show per-database grouping, or a flat list of all changes?

4. **UI scope**: This spec covers the API layer. The UI for showing the preview (diff viewer, confirm/cancel flow) needs separate design. Should the preview page be a route or a modal? Per CLAUDE.md convention: "Routes over modals."

5. **Staleness threshold configuration**: Should the staleness warning threshold be configurable, or hardcoded? Recommendation: Start hardcoded at 5 minutes, make configurable later.

6. **Preview generation during active sync**: If a sync is currently running for the same instance, should preview generation be blocked or allowed? Recommendation: Allow, since preview is read-only. But include a warning in the response that a sync is in progress.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/sync/processor.ts` - Sync orchestration, entry points for sync execution
- `/packages/praxrr-app/src/lib/server/sync/base.ts` - BaseSyncer abstract class
- `/packages/praxrr-app/src/lib/server/sync/types.ts` - Core sync types (SyncResult, SectionHandler, SectionType)
- `/packages/praxrr-app/src/lib/server/sync/registry.ts` - Section handler registry
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts` - Arr API mappings (qualities, languages, sources, etc.)
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts` - Zero-width namespace suffix system
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts` - Existing scan-then-execute pattern (model for preview)
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` - Most complex syncer; CFs + QPs with namespacing
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts` - PCD -> Arr QP transformation + PCD queries
- `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts` - CF sync with namespace suffixing
- `/packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts` - PCD -> Arr CF transformation + PCD queries
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts` - Single profile sync with Lidarr special handling
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` - Multi-config sync (naming, quality defs, media settings)
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` - Lidarr-only metadata profile sync
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts` - Example section handler registration
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts` - BaseArrClient with all Arr API methods
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts` - Arr API type definitions
- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` - Job handler for sync execution
- `/packages/praxrr-app/src/lib/server/jobs/queueTypes.ts` - Job type definitions
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts` - Sync config queries (40+ methods)
- `/packages/praxrr-app/src/lib/server/db/schema.sql` - App DB schema (arr*sync*\* tables at line 458+)
- `/packages/praxrr-app/src/lib/server/pcd/index.ts` - PCD public API (getCache, compile, etc.)
- `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts` - Existing scan/execute API pattern
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` - Sync config UI server-side logic
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` - Arr client factory and cache
- `docs/api/v1/openapi.yaml` - OpenAPI spec entry point

## Architectural Patterns

- **Section Registry Pattern**: Sync sections are registered handlers with a common interface (`SectionHandler`). Preview should follow this by adding a `generatePreview()` to the handler interface or keeping it on the syncer.
- **Scan-then-Execute Pattern**: Already established in `cleanup.ts` with `scanForStaleItems()` + `deleteStaleItems()`. Preview extends this to the full sync pipeline.
- **Namespace Suffixing**: All CF and QP names are suffixed with invisible zero-width Unicode characters per database. The diff engine must account for this in matching and display.
- **Contract-First API**: Per CLAUDE.md, define OpenAPI spec first, generate types, then implement endpoints.
- **Job Queue Integration**: The apply step should NOT go through the job queue. It should execute synchronously (like the cleanup execute action) to give the user immediate feedback. The user already confirmed; queuing adds unnecessary latency.

## Edge Cases

- Quality profile sync with zero selections for an instance should return an empty preview, not an error.
- If PCD cache is not available for a database referenced in sync config, the preview should include a warning per-database (matching existing syncer behavior) rather than failing the entire preview.
- Lidarr metadata profiles are only applicable when `arr_type === 'lidarr'`; requesting metadata profile preview for Radarr/Sonarr should be a no-op, not an error.
- Delay profile sync targets the default profile (id=1 for Radarr/Sonarr, resolved at runtime for Lidarr). Preview must resolve the same target.
- Custom formats with all conditions skipped for an arr_type (e.g., Lidarr unsupported conditions) are excluded from sync. Preview should show these as "skipped" rather than "create" or "unchanged".
- Media management naming sync uses arr-type-specific config structures (RadarrNamingConfig vs SonarrNamingConfig). The diff engine must handle polymorphic config objects.
- Empty preview (no changes detected) is a valid result, not an error. The UI should show "No changes needed."
