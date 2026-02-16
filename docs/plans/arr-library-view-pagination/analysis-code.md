# Code Analysis: arr-library-view-pagination

## Executive Summary

The existing implementation already has clear seams for pagination: the API route centralizes Arr fetch orchestration and the page route centralizes client state and rendering. Pagination can be added with minimal architectural churn by extending API query parsing/response metadata and threading page/pageSize into existing route/store patterns. Most UI components can remain unchanged if the page route continues to provide the same item shape per Arr type.

## Existing Code Structure

### Related Components

- `/src/routes/api/v1/arr/library/+server.ts`: GET/DELETE handler with Arr dispatch, profile enrichment, cache usage, and structured error handling.
- `/src/routes/arr/[id]/library/+page.svelte`: Library page state manager for fetching, refresh, search/filter/column state, and table rendering.
- `/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Search/filter/column/refresh control surface.
- `/src/lib/client/stores/libraryCache.ts`: Client-side library payload cache.
- `/src/lib/server/utils/cache/cache.ts`: Server-side in-memory cache.

### File Organization Pattern

Route files own orchestration (`+page.svelte`, `+server.ts`) while reusable controls and table primitives live in component/store utility paths. Arr-specific data transformation and integration logic is concentrated in server-side route/client wrapper modules.

## Implementation Patterns

### Pattern: Arr-Type Dispatch

**Description**: API handler validates instance and branches by Arr type to maintain app-specific semantics.
**Example**: `/src/routes/api/v1/arr/library/+server.ts`
**Apply to**: Pagination query handling, metadata population, and schema typing.

### Pattern: Dual Cache Coordination

**Description**: Server cache and client cache are both used; invalidation paths must remain aligned.
**Example**: `/src/lib/server/utils/cache/cache.ts`, `/src/lib/client/stores/libraryCache.ts`
**Apply to**: Composite page/query cache keys and refresh behavior.

### Pattern: Route-Level State Orchestration

**Description**: `+page.svelte` aggregates UI state and passes prepared data to component tree.
**Example**: `/src/routes/arr/[id]/library/+page.svelte`
**Apply to**: Pagination state, URL sync, loading/error transitions, and table input shaping.

## Integration Points

### Files to Create

- None required for baseline; optional helper modules may be added if state logic needs extraction.

### Files to Modify

- `/src/routes/api/v1/arr/library/+server.ts`: Parse/validate pagination query params and return metadata.
- `/src/routes/arr/[id]/library/+page.svelte`: Manage page/pageSize state and request pagination params.
- `/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Add/adjust page-size and pager control hooks.
- `/src/lib/client/stores/libraryCache.ts`: Cache keying by instance + page/query dimensions.
- `/src/lib/server/utils/cache/cache.ts`: Cache keying/invalidation updates for page-aware results.
- `/docs/api/v1/paths/arr.yaml`: Document new query params and behavior.
- `/docs/api/v1/schemas/arr.yaml`: Document new pagination metadata in response schemas.
- `/src/tests/base/lidarrApiParity.test.ts`: Add backend pagination coverage.
- `/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`: Extend UI contract checks for pagination.

## Code Conventions

### Naming

Keep Arr-specific terminology explicit and follow existing SvelteKit/file naming conventions.

### Error Handling

Preserve explicit status/error envelopes in API handlers; map unsupported/workflow errors distinctly in UI.

### Testing

Use Deno base tests for API contract validation and Playwright specs for route-level behavior.

## Dependencies and Services

### Available Utilities

- `arrInstancesQueries`: Arr instance metadata resolution.
- `qualityProfileQueries` (via PCD entities): Profile-name enrichment.
- Arr clients (`radarr.ts`, `sonarr.ts`, `lidarr.ts`): Upstream library retrieval.
- `cache` and `libraryCache`: Existing caching primitives.

### Required Dependencies

- Existing internal modules are sufficient; no new external package is required for baseline pagination.

## Gotchas and Warnings

- Current cache keys are instance-centric; page collisions will occur unless page/query dimensions are included.
- Any response-shape change requires synchronized OpenAPI and test fixture updates.
- Sonarr episode lazy-loading and Arr capability gating must remain unaffected by pagination updates.
- Refresh invalidation must clear all relevant cached page variants for the instance.

## Task-Specific Guidance

- **For API tasks**: Validate query bounds early, apply sorting/filtering before slice, emit deterministic pagination metadata.
- **For UI tasks**: Keep existing filters/search/column persistence intact while adding pager state and URL synchronization.
- **For testing tasks**: Cover invalid params, boundary pages, metadata correctness, refresh invalidation, and Arr-type parity.
