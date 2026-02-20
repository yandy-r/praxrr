# Pattern Research: sync-preview-dry-run

This document catalogs the concrete coding patterns, conventions, and architectural decisions in the Praxrr sync module that are directly relevant to implementing the sync preview feature. It is based on source-level analysis of all sync section handlers, syncers, transformers, the cleanup module, API routes, and the job system.

## Architectural Patterns

### Section Registry Pattern

Sync sections use a registry (`Map<SectionType, SectionHandler>`) where each section type self-registers on import. Handlers are plain objects (not classes) conforming to the `SectionHandler` interface. Registration happens as a side effect of importing the handler file.

- Registry: `/packages/praxrr-app/src/lib/server/sync/registry.ts`
- Handler interface: `/packages/praxrr-app/src/lib/server/sync/types.ts` (lines 64-86)
- Example handler: `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts`
- Registration trigger: `/packages/praxrr-app/src/lib/server/sync/processor.ts` (lines 28-31) imports handler files to trigger registration

Key aspects for preview: The `SectionHandler` interface includes `createSyncer()`, `hasConfig()`, and status management methods. Preview will likely add `createPreviewer()` or similar to this interface, or keep preview logic on the syncer class itself.

### BaseSyncer Template Method (Overridden in Practice)

`BaseSyncer` defines a template method pattern with `sync()` calling `fetchFromPcd()` -> `transformToArr()` -> `pushToArr()`. However, **every single syncer overrides `sync()` entirely** and provides stub implementations of the abstract methods.

- Base class: `/packages/praxrr-app/src/lib/server/sync/base.ts`
- QP syncer override: `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` (line 79: `override async sync()`)
- Delay syncer override: `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts` (line 26: `override async sync()`)
- Media management override: `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` (line 76: `override async sync()`)
- Metadata profiles override: `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` (line 271: `override async sync()`)

All four syncers include the comment `// Base class abstract methods - implemented but not used since we override sync()` with empty stub implementations.

Implication for preview: Adding `generatePreview()` as a new method on each syncer (alongside `sync()`) is the natural pattern. Both methods share internal helper methods (e.g., `fetchSyncBatchByDatabase()` on QP syncer) but compose results differently. Adding it to `BaseSyncer` as an abstract method is optional since the base template is already unused.

### Cleanup Scan-then-Execute Pattern (Closest Precedent)

The cleanup module (`cleanup.ts`) is the strongest existing precedent for preview/apply. It separates concerns into two functions:

1. `scanForStaleItems(client, instanceId)` -- read-only scan producing a `CleanupScanResult`
2. `deleteStaleItems(client, scanResult)` -- destructive execution consuming the scan result

The API route (`/api/v1/arr/cleanup/+server.ts`) requires the caller to make two separate POST requests: one with `action: 'scan'` and one with `action: 'execute'` passing the scan result back.

- Scan function: `/packages/praxrr-app/src/lib/server/sync/cleanup.ts` (line 43)
- Execute function: `/packages/praxrr-app/src/lib/server/sync/cleanup.ts` (line 117)
- API route: `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`
- Result types: `CleanupScanResult` and `CleanupDeleteResult` (lines 28-37)

Key pattern: scan returns structured data, execute takes that data as input. The route is a single POST endpoint with an `action` discriminator field, not separate endpoints.

### Processor Orchestration

The `processor.ts` file coordinates section execution. Two main entry points:

1. `processPendingSyncs()` -- evaluates schedules, finds all pending, processes in batches
2. `syncInstance(instanceId)` -- manual sync, runs all configured sections for one instance

Both create an `ArrInstanceClientCache` per instance and process sections sequentially within an instance (dependency order: QP depends on CF).

- Processor: `/packages/praxrr-app/src/lib/server/sync/processor.ts`
- Concurrency limit: `CONCURRENCY_LIMIT = 3` (line 36)
- Client cache per instance: `createArrInstanceClientCache()` (line 249, 298)

Preview orchestration should follow `syncInstance()` structure: take an instanceId, iterate configured sections, collect results.

### Per-Section File Organization

Each sync section follows a consistent file structure:

```
sync/{sectionName}/
  handler.ts      -- SectionHandler object (plain object, not class)
  syncer.ts       -- Syncer class extending BaseSyncer
  transformer.ts  -- Pure transform functions + PCD query functions (QP, CF only)
  index.ts        -- Barrel exports
```

Not all sections have a `transformer.ts`. Delay profiles and metadata profiles inline their transform logic in the syncer. Media management inlines transforms too but references PCD entity reader modules from `$pcd/entities/`.

- QP section (all 4 files): `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/`
- CF section (3 files, no handler): `/packages/praxrr-app/src/lib/server/sync/customFormats/`
- Delay section (2 files): `/packages/praxrr-app/src/lib/server/sync/delayProfiles/`
- Media management (3 files): `/packages/praxrr-app/src/lib/server/sync/mediaManagement/`
- Metadata profiles (3 files): `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/`

Custom formats are a helper module, not a registered section. They are synced as part of quality profiles (`syncCustomFormats()` is called from `QualityProfileSyncer.sync()`).

### Namespace Suffixing

All CF and QP names pushed to Arr get an invisible zero-width Unicode suffix based on a per-(instance, database) namespace index. This enables multi-database coexistence.

- Suffix logic: `/packages/praxrr-app/src/lib/server/sync/namespace.ts`
- Suffix assignment: `arrNamespaceQueries.getOrCreate(instanceId, databaseId)` (in QP syncer line 195)
- Strip for display: `stripNamespaceSuffix(name)`
- Match detection: `hasNamespaceSuffix(name)`

Preview must match entities by suffixed name but display stripped names. The cleanup scan already demonstrates this pattern (lines 81-95 in `cleanup.ts`).

## Code Conventions

### Naming Conventions

- **Files**: camelCase for all TypeScript files (`syncer.ts`, `handler.ts`, `transformer.ts`, `processor.ts`)
- **Classes**: PascalCase with section prefix (`QualityProfileSyncer`, `MediaManagementSyncer`, `MetadataProfileSyncer`)
- **Interfaces**: PascalCase, often prefixed with `Pcd` for PCD-sourced data or `Arr` for API payloads (`PcdQualityProfile`, `ArrCustomFormat`, `CleanupScanResult`)
- **Handler objects**: camelCase with section suffix (`qualityProfilesHandler`, `delayProfilesHandler`)
- **Source constants**: All-caps `SOURCE` local constant for logger source strings (`const SOURCE = 'Cleanup'`)
- **Logger source strings**: Colon-separated hierarchy (`'Sync:QualityProfiles'`, `'Sync:DelayProfile'`, `'Sync:MediaManagement'`, `'Compile:QualityProfile'`, `'Compile:CustomFormat'`)

Preview should use `'Sync:Preview'` or `'Preview:QualityProfiles'` as the source string pattern.

### Import/Export Patterns

- **Barrel exports**: Each section has an `index.ts` that re-exports handler, syncer, and types
- **Path aliases**: Used extensively (`$sync/`, `$db/`, `$pcd/`, `$arr/`, `$logger/`, `$http/`, `$utils/`, `$shared/`)
- **Type re-exports**: Types are re-exported from barrel files with `export type { ... }` syntax
- **Side-effect imports**: Handler files are imported purely for registration side effects in `processor.ts` (e.g., `import './qualityProfiles/handler.ts'`)
- **Sync module barrel**: `/packages/praxrr-app/src/lib/server/sync/index.ts` re-exports everything from submodules

### Type Definition Patterns

- **Result types**: `SyncResult` has `{ success: boolean; itemsSynced: number; error?: string }` pattern
- **Per-instance results**: `InstanceSyncResult` has optional section result properties keyed by `SectionType`
- **Config data types**: Defined in `$db/queries/arrSync.ts` (`QualityProfilesSyncData`, `DelayProfilesSyncData`, etc.)
- **PCD types**: Defined inline in transformer files (`PcdQualityProfile`, `PcdCustomFormat`, `PcdCondition`)
- **Arr API types**: Defined in `$arr/types.ts` (`ArrQualityProfilePayload`, `ArrCustomFormat`, `ArrDelayProfile`)

Preview types should follow the same naming: `SyncPreviewResult`, `EntityChange`, `FieldChange`, etc. Place in `$sync/preview/types.ts`.

### Sync Module Type Infrastructure

- `SyncResult`: Returned by every syncer's `sync()` method
- `InstanceSyncResult`: Aggregates per-section results with optional section keys
- `ProcessSyncsResult`: Top-level result from `processPendingSyncs()`
- `SectionType`: Union type `'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles'`
- `SectionHandler`: Registry interface with factory, status, and query methods
- `SyncArrType`: `Exclude<ArrType, 'all'>` -- the concrete arr types supported by sync runtime

All defined in `/packages/praxrr-app/src/lib/server/sync/types.ts`.

## Error Handling

### Syncer Error Pattern

Every syncer wraps its entire `sync()` body in try/catch. Errors are caught, logged, and returned as `SyncResult` with `success: false`:

```typescript
try {
  // ... sync logic
  return { success: true, itemsSynced: N };
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  await logger.error(`Failed ${this.syncType} sync for "${this.instanceName}"`, {
    source: 'Sync:SectionName',
    meta: { instanceId: this.instanceId, error: errorMsg },
  });
  return { success: false, itemsSynced: 0, error: errorMsg };
}
```

This pattern is repeated in all four syncers: QP syncer (line 149-158), delay syncer (inline), media management syncer (individual try/catch per sub-section), metadata syncer (line 350-357).

### Per-Entity Error Handling (Non-Fatal)

Within a syncer, individual entity failures (e.g., failing to create one CF out of many) are caught and logged but do NOT abort the entire sync. The syncer continues with the next entity.

- CF syncer: `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts` (lines 99-111)
- QP syncer: `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts` (lines 362-374)
- Media management: Each sub-section has its own try/catch (lines 93-107, 110-122, 125-140)

### HTTP Error Handling

`HttpError` class from `$http/types.ts` carries `status` and `response` fields. The cleanup module and metadata syncer specifically check for `HttpError` to extract response details.

- HttpError: `/packages/praxrr-app/src/lib/server/utils/http/types.ts`
- Cleanup usage: `/packages/praxrr-app/src/lib/server/sync/cleanup.ts` (lines 144-149, checks `err.status === 500`)
- QP syncer `extractErrorDetails()`: lines 384-405 of syncer.ts -- handles generic error objects
- CF syncer `extractErrorDetails()`: lines 120-136 of syncer.ts -- same pattern duplicated

### API Route Error Pattern

API routes use SvelteKit's `json()` helper with explicit status codes. The cleanup route follows this pattern:

```typescript
try {
  // ... business logic
  return json(result);
} catch (err) {
  const message = err instanceof Error ? err.message : 'Operation failed';
  return json({ error: message }, { status: 500 });
}
```

The library route uses typed error responses: `json({ error: message } satisfies ErrorResponse, { status: 400 })`.

Input validation is done with early returns:

```typescript
if (!instanceId || typeof instanceId !== 'number') {
  return json({ error: 'instanceId is required' }, { status: 400 });
}
```

### Logging Conventions

- Logger is async: `await logger.info(message, options)`, `await logger.error(...)`, `await logger.debug(...)`, `await logger.warn(...)`
- Options format: `{ source: string, meta?: Record<string, unknown> }`
- Source strings: Hierarchical with colons (`'Sync:QualityProfiles'`, `'SyncProcessor'`, `'Cleanup'`)
- Meta object: Contains `instanceId`, `error`, and operation-specific fields
- Logger import: `import { logger } from '$logger/logger.ts'`
- Debug for routine operations, info for sync start/complete, warn for skipped/missing, error for failures

### Arr Client Connection and Lifecycle

- Clients are created via `getArrInstanceClient(type, id, url, options?, cache?)` from `$arr/arrInstanceClients.ts`
- Client credentials are decrypted on creation (async)
- Clients should be `close()`d after use (cleanup route does this in `finally` block)
- `ArrInstanceClientCache` is a per-session cache (`Map`) to avoid recreating clients for the same instance
- `createArrInstanceClientCache()` creates a fresh cache
- The cleanup route explicitly disables retries: `{ retries: 0 }`

Preview should follow the cleanup route pattern: create client, use it, close in finally.

## Testing Approach

### Test Infrastructure

- Test runner: Deno test runner (`deno test`)
- Assertions: `@std/assert` module (`assertEquals`, `assertMatch`)
- Test base class: `BaseTest` in `/packages/praxrr-app/src/tests/base/BaseTest.ts`
- Test file naming: `*.test.ts` in `/packages/praxrr-app/src/tests/` directories
- Test organization: By feature area (`/tests/arr/`, `/tests/base/`)
- E2E tests: Playwright in `/tests/e2e/specs/`

### No Existing Sync Unit Tests

There are **no unit tests** in the `/tests/sync/` directory or anywhere targeting the sync module directly. Sync testing is done via e2e tests and through higher-level tests that exercise PCD entity operations.

### Test Patterns

Tests use a `BaseTest` class that manages test context including database setup, PCD cache creation, and teardown. Tests create `FormData` requests to simulate route actions.

- Base test: `/packages/praxrr-app/src/tests/base/BaseTest.ts`
- Example: `/packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts` -- tests media management entities via route handlers
- Patching pattern: Tests use a manual `patch()` helper for monkey-patching modules during test (lines 49-55)

For sync preview testing, the most practical approach would be:

1. Unit tests for the diff engine (pure function, no I/O)
2. Unit tests for preview type construction
3. Integration tests that mock the Arr client and PCD cache to verify end-to-end preview generation

### E2E Test Helpers

- Sync helpers: `/packages/praxrr-app/src/tests/e2e/helpers/sync.ts`
- DB helpers: `/packages/praxrr-app/src/tests/e2e/helpers/db.ts`
- Entity helpers: `/packages/praxrr-app/src/tests/e2e/helpers/entity.ts`

## Patterns to Follow

### For the Preview Module Structure

Follow the existing section organization:

```
sync/preview/
  index.ts        -- Barrel exports
  types.ts        -- PreviewId, SyncPreviewResult, EntityChange, FieldChange, etc.
  store.ts        -- In-memory TTL cache (follow $cache/cache.ts pattern)
  orchestrator.ts -- Coordinates preview generation (follow processor.ts pattern)
  diff.ts         -- Generic deep-diff engine
  sectionDiffs.ts -- Section-specific diff logic
```

### For Adding generatePreview() to Syncers

Add a new method alongside `sync()` on each syncer class. Share internal helper methods between `sync()` and `generatePreview()`. Do NOT modify the existing `sync()` method's behavior.

Example for QualityProfileSyncer:

- `fetchSyncBatchByDatabase()` (private, line 164) -- already extracts fetch logic, reuse as-is
- `getQualityMappings()` (private, line 282) -- reuse as-is
- `syncQualityProfiles()` (private, line 296) -- has push logic, preview equivalent skips push and diffs instead

### For the API Route

Follow the cleanup route pattern:

- Single POST endpoint at `/api/v1/sync/preview` with `action` discriminator
- OR separate endpoints (POST create, GET retrieve, POST apply, DELETE discard) per the feature spec
- Use `json()` for responses with explicit status codes
- Create and close Arr client in the route handler with `try/finally`
- Input validation with early returns and `{ status: 400 }` responses

### For the In-Memory Preview Store

Follow the existing `Cache` class pattern from `$cache/cache.ts`:

- Simple `Map<string, CacheEntry>` with expiration timestamps
- `get()`, `set()`, `delete()`, `cleanup()` methods
- TTL-based expiration checked on read
- Singleton instance exported from module

### For Logging

Use the established source string hierarchy:

- `'Preview'` for the preview orchestrator
- `'Preview:QualityProfiles'`, `'Preview:DelayProfile'`, etc. for section-specific preview logic
- `'Preview:Diff'` for the diff engine if needed
- Include `instanceId`, `section`, and timing info in meta objects

### For Cross-Arr Handling

Follow the existing per-`arr_type` dispatch pattern:

- Use `isSyncSectionSupported(arrType, section)` before generating section previews
- Handle Lidarr-specific metadata profiles as conditional (only when `arr_type === 'lidarr'`)
- Custom format condition skipping for Lidarr should appear in preview diagnostics
- Quality API mappings are already per-`arr_type`

## Gotchas and Edge Cases

- **All syncers override sync() entirely**: The base class template methods (`fetchFromPcd`, `transformToArr`, `pushToArr`) are never used. Any preview implementation that tries to hook into these will get empty results.
- **Custom formats are not a registered section**: CFs are synced as a sub-step of quality profiles, not as an independent section. Preview must handle CF diffing within the quality profiles preview.
- **QP syncer refreshes CF list mid-sync**: After syncing CFs, the QP syncer calls `client.getCustomFormats()` again to build `allFormatIdMap` (line 112-113 in `qualityProfiles/syncer.ts`). Preview must do the same GET call to compare against current state, even though it does not write CFs.
- **Namespace suffix in matching**: CFs and QPs are matched by their suffixed name. The diff must match on suffixed names but strip suffixes for display. Use existing `stripNamespaceSuffix()` and `hasNamespaceSuffix()`.
- **Zero-score formatItems in QP payloads**: Arr requires every CF to appear in `formatItems` with score 0 if not explicitly scored. These should NOT appear as "changes" in the diff unless the score actually changed.
- **Media management is three independent sub-syncs**: Naming, quality definitions, and media settings each have separate PCD sources and Arr endpoints. Each can succeed/fail independently within a single section sync.
- **Delay profile target resolution**: Radarr/Sonarr always target profile id=1. Lidarr resolves the default profile at runtime (untagged, lowest order). Preview must perform this same resolution.
- **`extractErrorDetails()` is duplicated**: The same error detail extraction logic appears in both `customFormats/syncer.ts` and `qualityProfiles/syncer.ts`. Consider extracting to a shared utility for preview.
- **Lidarr metadata profile schema fallback**: The metadata syncer has a hardcoded `METADATA_PROFILE_SCHEMA_FALLBACK` used when the Lidarr API schema endpoint fails. Preview should handle this same fallback.
- **Client close required**: `BaseArrClient` extends `BaseHttpClient` which requires `close()`. The cleanup route does this in a `finally` block. Preview route must do the same.
- **No sync tests exist**: There are zero unit tests for the sync module. The diff engine and preview types will be the first unit-testable components in this area.

## Relevant Files

### Core Sync Infrastructure

- `/packages/praxrr-app/src/lib/server/sync/base.ts`: BaseSyncer abstract class (template method pattern)
- `/packages/praxrr-app/src/lib/server/sync/types.ts`: All sync type definitions (SyncResult, SectionHandler, SectionType)
- `/packages/praxrr-app/src/lib/server/sync/registry.ts`: Section handler registry (Map-based)
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Sync orchestration and entry points
- `/packages/praxrr-app/src/lib/server/sync/index.ts`: Module barrel exports
- `/packages/praxrr-app/src/lib/server/sync/namespace.ts`: Zero-width Unicode namespace suffix system
- `/packages/praxrr-app/src/lib/server/sync/mappings.ts`: Arr API mappings and section support checks
- `/packages/praxrr-app/src/lib/server/sync/utils.ts`: Cron utilities and startup recovery
- `/packages/praxrr-app/src/lib/server/sync/cleanup.ts`: Scan-then-execute pattern (closest precedent)

### Section Syncers and Handlers

- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Most complex syncer (CFs + QPs + namespacing)
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`: PCD-to-Arr QP transformation + PCD queries
- `/packages/praxrr-app/src/lib/server/sync/qualityProfiles/handler.ts`: QP section handler registration
- `/packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: CF sync with namespace suffixing
- `/packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: PCD-to-Arr CF transformation + PCD queries
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: Single profile sync with Lidarr resolution
- `/packages/praxrr-app/src/lib/server/sync/delayProfiles/handler.ts`: Delay section handler registration
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: Multi-config sync (naming, quality defs, media settings)
- `/packages/praxrr-app/src/lib/server/sync/mediaManagement/handler.ts`: Media management handler registration
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: Lidarr-only metadata profile sync
- `/packages/praxrr-app/src/lib/server/sync/metadataProfiles/handler.ts`: Metadata handler registration

### API Routes (Patterns to Follow)

- `/packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: Scan/execute API pattern (closest to preview/apply)
- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: Complex GET API route with caching and pagination
- `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: Sync config UI server-side logic (form actions)

### Supporting Infrastructure

- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: BaseArrClient with all Arr API GET/POST/PUT/DELETE methods
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Client factory with credential decryption
- `/packages/praxrr-app/src/lib/server/utils/http/types.ts`: HttpError class
- `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: In-memory TTL cache (pattern for preview store)
- `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Async logger with source/meta pattern
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Sync config database queries
- `/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Job handler for sync execution

### Existing Research

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/feature-spec.md`: Complete feature specification
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-technical.md`: Technical architecture decisions

## Other Docs

- [feature-spec.md](./feature-spec.md): Complete feature specification with phasing, data models, API design, and UX
- [research-technical.md](./research-technical.md): Architecture decisions, data models, API spec, codebase change list
- [research-business.md](./research-business.md): Business rules, user stories, edge cases
- [research-external.md](./research-external.md): Arr API details, diff library evaluation (microdiff), IaC precedents
- [research-ux.md](./research-ux.md): UI patterns, accessibility, diff visualization approaches
