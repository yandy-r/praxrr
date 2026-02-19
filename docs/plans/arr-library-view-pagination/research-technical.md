# Technical Specification Analysis: arr-library-view-pagination

### Executive Summary

Current library loading is a single bulk fetch on both server and client, then in-memory filtering/sorting in the Svelte route. That architecture must shift to a paginated contract to cap payload size and DOM pressure for large datasets. The lowest-risk design is additive: keep current route and item shapes, add pagination metadata and query params, and evolve caches to be page-aware.

### Architecture Approach

- Backend route (`packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`):
  - Add query params: `page`, `pageSize`, optional `query`, `sortKey`, `sortDirection`, and selected filters.
  - Return a paginated envelope with existing app-specific item arrays.
  - Keep app-specific fetch/join logic in Arr clients, but slice/filter server-side before response.
- Frontend route (`packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`):
  - Move from single `library` array assumptions to page state plus current-page items.
  - Preserve existing column toggle stores and action bar behaviors.
  - Optionally layer lazy page loading with a sentinel after baseline fixed pagination works.
- Cache stores:
  - Server cache key currently `library:${instanceId}` should become pagination-aware.
  - Client cache in `packages/praxrr-app/src/lib/client/stores/libraryCache.ts` should key by instance and query state.

### Data Model Implications

- No new DB tables required for v1.
- Runtime contract additions needed in OpenAPI and generated types:
  - `page`
  - `pageSize`
  - `totalRecords`
  - `totalPages`
  - `hasNext`
- `profilesByDatabase` should remain available and stable across pages.
- Optional: cache normalized full snapshot then serve filtered/sorted slices to avoid repeated upstream Arr calls during TTL window.

### API Design Considerations

- Proposed endpoint:
  - `GET /api/v1/arr/library?instanceId=12&page=1&pageSize=100&sortKey=title&sortDirection=asc&query=...`
- Proposed response shape (all app types):
  - `type`
  - `items`
  - `profilesByDatabase`
  - `page`
  - `pageSize`
  - `totalRecords`
  - `totalPages`
  - `hasNext`
- Validation:
  - `instanceId` required, integer.
  - `page` >= 1.
  - `pageSize` within bounded range (for example 25 to 250 or 500).
  - Unknown sort/filter keys should fail fast with 400.
- Backward compatibility:
  - Prefer additive rollout; keep existing payload compatibility short-term if other consumers depend on full arrays.

### System Constraints

- Arr upstream library endpoints are unpaged (`movie`, `series`, `artist/album/track`), so pagination in Praxrr may still start from full upstream fetches unless further endpoint-level optimization is introduced.
- Lidarr remains highest-risk for memory/render time; expanded detail rendering should stay lazy and bounded.
- Keep strict app-specific handling (`arr_type`) to avoid semantic drift between Sonarr/Radarr/Lidarr.

### File-Level Impact Preview

- Likely modify:
  - `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
  - `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
  - `packages/praxrr-app/src/lib/client/stores/libraryCache.ts`
  - `docs/api/v1/schemas/arr.yaml`
  - `docs/api/v1/paths/arr.yaml`
  - generated API types surface (`packages/praxrr-app/src/lib/server/api/v1.d.ts` or generation source)
- Likely review/adjust:
  - `packages/praxrr-app/src/lib/server/utils/arr/clients/radarr.ts`
  - `packages/praxrr-app/src/lib/server/utils/arr/clients/sonarr.ts`
  - `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`
  - `packages/praxrr-app/src/routes/arr/[id]/logs/+page.svelte` (for reusable pagination interaction pattern)
