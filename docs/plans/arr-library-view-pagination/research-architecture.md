# Architecture Research: arr-library-view-pagination

## System Overview

The Arr library view currently uses a single page-level Svelte route to fetch and render a full library payload per instance. Backend orchestration for that payload lives in `src/routes/api/v1/arr/library/+server.ts`, which resolves Arr instance metadata, enriches response data with Profilarr profile information, and caches results. Pagination will fit between existing server-side aggregation and the current table rendering pipeline by introducing page-aware query params and metadata while preserving Arr-specific response envelopes.

## Relevant Components

- `src/routes/arr/[id]/library/+page.svelte`: Owns library screen state, API fetch lifecycle, and table rendering inputs.
- `src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Owns search/filter/refresh actions that must stay synchronized with pagination state.
- `src/lib/client/ui/table/ExpandableTable.svelte`: Core table renderer that receives row data and sort/filter configuration.
- `src/lib/client/stores/libraryCache.ts`: Client cache currently keyed by instance, likely to become page/query aware.
- `src/lib/client/stores/search.ts`: Persistent search state used by the library page.
- `src/routes/api/v1/arr/library/+server.ts`: Main backend endpoint to validate params, aggregate data, and return paginated responses.
- `src/routes/api/v1/arr/library/episodes/+server.ts`: Sonarr row expansion endpoint that must remain compatible after list pagination.
- `src/lib/server/utils/arr/clients/radarr.ts`: Radarr upstream client used before server-side slicing.
- `src/lib/server/utils/arr/clients/sonarr.ts`: Sonarr upstream client used before server-side slicing.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr upstream client used before server-side slicing.
- `src/lib/server/utils/cache/cache.ts`: Shared server-side cache used by Arr library GET/DELETE flows.

## Data Flow

The page route fetches `/api/v1/arr/library` and currently receives full app-specific item arrays plus profile metadata, then applies UI state and renders through table components. The API route validates `instanceId`, loads Arr instance connection details, fetches upstream entities via Arr clients, enriches with Profilarr-managed profile names, caches results, and responds. Pagination introduces query-driven slicing and metadata at the API layer, then propagates page navigation state through client cache, URL/search state, and table inputs without changing app-specific row rendering components.

## Integration Points

Pagination hooks into `fetchLibrary` and refresh flows in `src/routes/arr/[id]/library/+page.svelte`, request parsing and response shaping in `src/routes/api/v1/arr/library/+server.ts`, and both client/server caching layers (`src/lib/client/stores/libraryCache.ts`, `src/lib/server/utils/cache/cache.ts`). Integration must preserve quality-profile enrichment from `src/lib/server/pcd/entities/qualityProfiles/index.ts` and Arr-instance resolution from `src/lib/server/db/queries/arrInstances.ts`. URL/query persistence and filter/search behavior remain anchored in existing page/store patterns.

## Key Dependencies

- `src/lib/server/db/queries/arrInstances.ts`: Resolves Arr instance type/credentials used for data fetches.
- `src/lib/server/pcd/entities/qualityProfiles/index.ts`: Supplies managed profile names included in library responses.
- `docs/plans/arr-library-view-pagination/feature-spec.md`: Source requirements for pagination params, metadata, and UX behavior.
- `docs/plans/arr-library-view-pagination/research-technical.md`: Proposed server/client architecture adjustments for pagination.
- `docs/api/v1/paths/arr.yaml`: Existing API path contract to update for paginated query params.
- `docs/api/v1/schemas/arr.yaml`: Existing response schemas to expand with pagination metadata.
