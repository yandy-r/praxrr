# Context Analysis: arr-library-view-pagination

## Executive Summary

The feature adds server-driven fixed pagination to `/arr/{id}/library` while preserving existing Arr-specific response semantics and UI behavior. Core work spans `src/routes/api/v1/arr/library/+server.ts` (query validation, metadata, slicing), `src/routes/arr/[id]/library/+page.svelte` (page state + controls), and both cache layers (server + client) so refresh, search, filters, and navigation remain coherent. Existing feature docs already define acceptance criteria and UX constraints; implementation should follow those artifacts directly.

## Architecture Context

- **System Structure**: Route-level Svelte page orchestrates state and renders through shared table/action components; API handler orchestrates Arr-instance lookup, Arr-client fetch, profile enrichment, and caching.
- **Data Flow**: UI requests library data by instance; API dispatches by Arr type, enriches response, caches payload, and returns typed envelopes; UI persists search/filter/column state and renders table rows.
- **Integration Points**: API handler pagination/query logic, client pagination/URL state, and page-aware cache keying for `src/lib/server/utils/cache/cache.ts` and `src/lib/client/stores/libraryCache.ts`.

## Critical Files Reference

- `/src/routes/api/v1/arr/library/+server.ts`: Add `page`/`pageSize`/query validation, slicing, and metadata.
- `/src/routes/arr/[id]/library/+page.svelte`: Add pagination state, controls, URL sync, and API request params.
- `/src/lib/client/stores/libraryCache.ts`: Expand keying strategy for page/query combinations.
- `/src/lib/server/utils/cache/cache.ts`: Expand keying/invalidation strategy for paginated responses.
- `/src/lib/server/db/queries/arrInstances.ts`: Preserve Arr instance resolution before fetch dispatch.
- `/src/lib/server/pcd/entities/qualityProfiles/index.ts`: Preserve profile enrichment behavior across pages.
- `/docs/api/v1/paths/arr.yaml`: Update endpoint query contract.
- `/docs/api/v1/schemas/arr.yaml`: Update response schema with pagination metadata.

## Patterns to Follow

- **Page-Orchestrator Pattern**: Keep state orchestration in `+page.svelte`; child components remain focused on rendering/actions.
- **Explicit Arr-Type Dispatch Pattern**: Keep Arr-specific branch logic explicit; no sibling-app fallback.
- **Layered Cache Pattern**: Maintain server + client cache coherence with consistent invalidation behavior.
- **Persistent Query-State Pattern**: Preserve current search/filter persistence and extend it with page/pageSize URL-backed state.

## Cross-Cutting Concerns

- Caching correctness across page/query variants.
- URL synchronization and back/forward behavior.
- Input validation and stable error envelopes (`400`/`404`/`500`).
- Accessibility expectations for pagination controls and live updates.
- Arr-specific semantic isolation (Sonarr/Radarr/Lidarr differences retained).

## Parallelization Opportunities

- API contract updates and UI control scaffolding can run in parallel once metadata fields are agreed.
- Cache key refactors can run concurrently with OpenAPI schema/path updates.
- Backend unit tests and E2E pagination flows can be prepared in parallel after API payload shape stabilizes.

## Implementation Constraints

- Upstream Arr library APIs are unpaginated; pagination must be applied in Praxrr after retrieval/filter/sort.
- No new DB tables are required for baseline pagination.
- OpenAPI/runtime contract fidelity must remain aligned.
- Existing search/filter/column persistence must not regress.

## Key Recommendations

- Ship fixed server-driven pagination first (default `pageSize=100`, bounded upper limit), with deterministic metadata fields in every response.
- Keep filtering/sorting canonical on server prior to slicing to avoid cross-page inconsistency.
- Extend cache keying and refresh invalidation together to prevent stale page collisions.
- Add API + E2E coverage focused on bounds validation, metadata correctness, and Arr-specific behavior parity.
