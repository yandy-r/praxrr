# External API Research: arr-library-view-pagination

### Executive Summary

Arr core library endpoints for Radarr, Sonarr, and Lidarr are not natively paginated, while queue and history endpoints are paginated. That means Praxrr must implement server-side pagination over aggregated Arr datasets if we want deterministic browser performance for large libraries. The strongest default UX is fixed pagination with configurable page size (default 100), with optional lazy page loading on scroll as a secondary mode.

### Candidate APIs and Services

#### Radarr API v3

- Documentation URL: https://radarr.video/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json
- Auth model: API key (`X-Api-Key` header; query `apikey` supported)
- Key endpoints/capabilities:
  - `GET /api/v3/movie` has query params like `tmdbId` but no `page` or `pageSize`
  - `GET /api/v3/moviefile` supports joins by movie IDs
  - `GET /api/v3/queue` and `GET /api/v3/history` include `page` and `pageSize`
- Rate limits/quotas: no explicit public limit in official docs/OpenAPI
- Pricing notes: self-hosted OSS

#### Sonarr API v3

- Documentation URL: https://sonarr.tv/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
- Auth model: API key (`X-Api-Key` header; query `apikey` supported)
- Key endpoints/capabilities:
  - `GET /api/v3/series` has query params like `tvdbId` but no `page` or `pageSize`
  - `GET /api/v3/episode` and `GET /api/v3/episodefile` support lazy, series-scoped detail loading
  - `GET /api/v3/queue` and `GET /api/v3/history` include `page` and `pageSize`
- Rate limits/quotas: no explicit public limit in official docs/OpenAPI
- Pricing notes: self-hosted OSS

#### Lidarr API v1

- Documentation URL: https://lidarr.audio/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- Auth model: API key (`X-Api-Key` header; query `apikey` supported)
- Key endpoints/capabilities:
  - `GET /api/v1/artist` has `mbId` filter but no pagination params
  - `GET /api/v1/album` has `artistId`, `albumIds`, and related filters, but no pagination params
  - `GET /api/v1/track` has scoped filters (`artistId`, `albumId`) but no pagination params
  - `GET /api/v1/queue` and `GET /api/v1/history` include `page` and `pageSize`
- Rate limits/quotas: no explicit public limit in official docs/OpenAPI
- Pricing notes: self-hosted OSS

Validation note (2026-02-16): endpoint query-parameter checks were verified against the three official OpenAPI JSON specs.

### Libraries and SDKs

- `@tanstack/svelte-query`: strong request state and cache orchestration for page navigation and optional lazy page prefetch.
- `@tanstack/svelte-virtual`: row virtualization for very large pages or heavy expanded content.
- `IntersectionObserver` (native browser API): sentinel-based loading of next page for optional load-more mode.

### Integration Patterns

- Recommended auth flow:
  - Keep Arr credentials server-side only.
  - Continue proxying all Arr access through Praxrr API routes.
- Sync/event strategy:
  - Keep explicit manual refresh for operators.
  - Optionally add polling or webhook invalidation later; not required for v1 pagination.
- Pagination/error handling:
  - Introduce server-driven `page` and `pageSize` on Praxrr `/api/v1/arr/library`.
  - Return stable pagination metadata (`totalRecords`, `page`, `pageSize`, `totalPages`, `hasNext`).
  - Validate and clamp page size, return 400 for invalid pagination inputs.

### Constraints and Gotchas

- Arr library endpoints are unpaged, so backend pagination still requires full upstream fetch unless we redesign by narrower scope (for example, album-scoped track fetches).
- Lidarr has the highest UI lock risk because of large album/track datasets.
- Sonarr/Radarr are v3 while Lidarr is v1; keep app-specific semantics explicit.
- Infinite scroll as the default complicates deep linking, accessibility, and deterministic QA.

### Open Decisions

- Default mode: fixed pagination only, or fixed pagination plus optional load-more mode.
- Page-size policy: default 100, selectable options, and max ceiling.
- Filtering/sorting authority: server-side canonical for v1, or mixed server/client.
- Lidarr detail model: keep album-first rows and load tracks lazily per expanded album, or build a dedicated track-focused endpoint.
