# Integration Research: arr-library-view-pagination

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/arr/library`: Returns Arr library data for an instance (currently full payload, cached).
- `DELETE /api/v1/arr/library`: Invalidates server cache for a specific Arr instance.
- `GET /api/v1/arr/library/episodes`: Loads Sonarr episodes for row expansion.

### Route Organization

The route handler in `src/routes/api/v1/arr/library/+server.ts` validates `instanceId`, resolves Arr instance connection metadata, dispatches by Arr type (Radarr/Sonarr/Lidarr), enriches payload with Praxrr profile mappings, and caches responses through `src/lib/server/utils/cache/cache.ts`. Frontend consumption is centralized in `src/routes/arr/[id]/library/+page.svelte`, where refresh and cache invalidation are coordinated with client-side state.

## Database

### Relevant Tables

- `arr_instances`: Stores Arr instance identity, type, URL, API key, tags, and enablement state.

### Schema Details

`arr_instances` is queried through `src/lib/server/db/queries/arrInstances.ts` before any upstream Arr call. Library responses are enriched using Praxrr metadata from PCD services/queries (`src/lib/server/pcd/entities/qualityProfiles/index.ts`) rather than new pagination-specific DB tables. Pagination logic is expected to operate over fetched datasets and cache layers, not via additional DB persistence.

## External Services

Radarr, Sonarr, and Lidarr HTTP APIs are the primary upstream data sources, accessed through typed client wrappers:

- `src/lib/server/utils/arr/clients/radarr.ts`
- `src/lib/server/utils/arr/clients/sonarr.ts`
- `src/lib/server/utils/arr/clients/lidarr.ts`

Current library endpoints consumed from Arr APIs are unpaginated; Praxrr pagination will be applied server-side after data retrieval/filtering/sorting.

## Internal Services

- `src/lib/server/utils/cache/cache.ts`: In-memory server cache used by Arr library route.
- `src/lib/client/stores/libraryCache.ts`: Client cache to reduce redundant page fetches.
- `src/lib/server/db/queries/arrInstances.ts`: Arr instance lookup and lifecycle operations.
- `src/lib/server/pcd/entities/qualityProfiles/index.ts`: Praxrr-managed profile-name lookups used in response enrichment.
- `src/lib/server/jobs/cleanup.ts`: Instance cleanup integration invoked on Arr instance delete paths.

## Configuration

Required runtime configuration for Arr library fetches is sourced from `arr_instances` (URL, API key, type). Pagination contract additions will require API/OpenAPI updates in:

- `docs/api/v1/paths/arr.yaml` (query params + endpoint behavior)
- `docs/api/v1/schemas/arr.yaml` (response metadata fields)

Client state persistence also relies on existing local storage keys for library columns and search-related store persistence in route/store layers.
