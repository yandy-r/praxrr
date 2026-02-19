# Pattern Research: arr-library-view-pagination

## Architectural Patterns

**Page-Orchestrator Pattern**: The library route centralizes page state (loading/errors/search/filters/cache refresh) and delegates UI rendering to focused child components.

- Example: `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`

**API Aggregation + Arr-Type Dispatch Pattern**: One API handler validates request input, dispatches by Arr instance type, enriches upstream data, and returns a normalized envelope.

- Example: `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`

**Shared Table + App-Specific Rows Pattern**: A common table wrapper renders shared interactions while app-specific row components render domain details.

- Example: `packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte`

**Persistent State Store Pattern**: Search and page-level view state are persisted through dedicated stores and local storage keys to survive reload/navigation.

- Example: `packages/praxrr-app/src/lib/client/stores/search.ts`
- Example: `packages/praxrr-app/src/lib/client/stores/dataPage.ts`

## Code Conventions

Svelte routes use `+page.svelte`/`+server.ts` conventions with focused helper functions and explicit typed state objects. Files follow `camelCase.ts` for utilities/stores and component names in `PascalCase.svelte`. Import aliases (`$client`, `$server`, `$shared`, `$pcd`) are preferred over long relative imports in route and server modules.

## Error Handling

The library API route performs fast input validation and returns explicit HTTP status codes (`400`, `404`, `500`) with structured error payloads. UI code maintains separate error states for unsupported capabilities versus generic fetch failure and maps server errors to user-friendly messages. Server handlers log both success and failure contexts for library fetch and cache invalidation paths.

## Testing Approach

Backend parity and error behavior are tested with Deno tests that patch upstream Arr clients and assert response shape/status behavior.

- Example: `packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`

UI behavior is covered with E2E specs that route API calls, assert rendered library data, and validate user feedback behavior for supported/unsupported flows.

- Example: `packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`

## Patterns to Follow

- Keep Arr-type dispatch explicit in API logic (no cross-app semantic shortcuts) when adding pagination and sorting/query handling.
- Keep the library route as state orchestrator; add pagination state beside existing search/filter/column visibility state rather than duplicating logic in child components.
- Keep caching layered: client store for UX smoothness, server cache for API efficiency; extend keys/contracts to include pagination dimensions.
- Reuse existing persistent-store patterns (`SearchStore`, `createDataPageStore` style) for URL/state restoration and predictable navigation behavior.
