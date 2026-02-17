# Feature Spec: Arr Library View Pagination

## Executive Summary

This feature adds scalable pagination to `/arr/{id}/library` so large Radarr, Sonarr, and Lidarr libraries stay responsive. Today the route and API load full library arrays, then filter and sort client-side, which is expensive for large datasets. The recommended implementation is server-driven fixed pagination with default `pageSize=100`, configurable page size, and URL-backed state for page, size, filters, and query. This keeps behavior deterministic, aligns with existing logs pagination patterns, and allows optional lazy page loading later without making infinite scroll the default. The main constraint is that Arr upstream library endpoints are unpaged, so Praxrr must own pagination semantics.

## External Dependencies

### APIs and Services

#### Radarr API v3

- **Documentation**: <https://radarr.video/docs/api/>
- **OpenAPI**: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- **Authentication**: `X-Api-Key` header (query `apikey` is also supported)
- **Key Endpoints**:
  - `GET /api/v3/movie`: library-like source, no native `page` or `pageSize`
  - `GET /api/v3/moviefile`: file joins for quality/format info
  - `GET /api/v3/queue`: native paged endpoint
  - `GET /api/v3/history`: native paged endpoint
- **Rate Limits**: no explicit public limit documented
- **Pricing**: self-hosted OSS

#### Sonarr API v3

- **Documentation**: <https://sonarr.tv/docs/api/>
- **OpenAPI**: <https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json>
- **Authentication**: `X-Api-Key` header (query `apikey` is also supported)
- **Key Endpoints**:
  - `GET /api/v3/series`: library-like source, no native `page` or `pageSize`
  - `GET /api/v3/episode`: series-scoped lazy detail loading
  - `GET /api/v3/queue`: native paged endpoint
  - `GET /api/v3/history`: native paged endpoint
- **Rate Limits**: no explicit public limit documented
- **Pricing**: self-hosted OSS

#### Lidarr API v1

- **Documentation**: <https://lidarr.audio/docs/api/>
- **OpenAPI**: <https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- **Authentication**: `X-Api-Key` header (query `apikey` is also supported)
- **Key Endpoints**:
  - `GET /api/v1/artist`: library source, no native pagination
  - `GET /api/v1/album`: scoped filters but no native pagination
  - `GET /api/v1/track`: scoped filters but no native pagination
  - `GET /api/v1/queue`: native paged endpoint
  - `GET /api/v1/history`: native paged endpoint
- **Rate Limits**: no explicit public limit documented
- **Pricing**: self-hosted OSS

### Libraries and SDKs

| Library                           | Purpose                                         | Adoption Recommendation                   |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| existing SvelteKit fetch + stores | Keep parity with current app architecture       | Use in v1 pagination rollout              |
| `@tanstack/svelte-query`          | Advanced request-state and cache orchestration  | Optional, evaluate in phase 2/3           |
| `@tanstack/svelte-virtual`        | Virtualized rendering for very large row counts | Optional hardening if needed              |
| browser `IntersectionObserver`    | Optional lazy page loading trigger              | Use only after fixed pagination is stable |

### External Documentation

- [Radarr API docs](https://radarr.video/docs/api/): official API behavior
- [Sonarr API docs](https://sonarr.tv/docs/api/): official API behavior
- [Lidarr API docs](https://lidarr.audio/docs/api/): official API behavior
- [MDN IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver): lazy loading pattern reference

## Business Requirements

### User Stories

**Primary User: Arr Operator**

- As an operator, I want large libraries to load quickly so I can review quality and profile coverage without browser lockups.
- As an operator, I want predictable page navigation and rows-per-page controls so I can choose speed versus density.

**Secondary User: Power User**

- As a power user, I want pagination/filter/search state in the URL so refresh/back/forward retains my context.
- As a power user, I want refresh to invalidate stale data but keep my working view settings.

### Business Rules

1. **Bounded Library Fetches**: library responses must be paginated by `page` and `pageSize`.
   - Validation: requests with invalid page inputs return 400.
   - Exception: none for library workflow-capable apps.
2. **Cross-App Coverage**: pagination behavior must apply to `radarr`, `sonarr`, and `lidarr` library routes.
   - Validation: one contract with app-specific `items` payloads.
3. **State Persistence**: column toggles and search/filter state must remain stable across page changes.
   - Validation: existing storage keys and behavior are preserved.
4. **Deterministic Refresh**: refresh invalidates instance cache and reloads from page 1.
   - Validation: both server and client cache paths are invalidated.

### Edge Cases

| Scenario                                   | Expected Behavior                                     | Notes                                              |
| ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| `page` requested beyond available pages    | Clamp or return empty `items` with valid totals       | Prefer deterministic behavior and clear UI message |
| user changes `pageSize` while on high page | Reset to page 1                                       | Avoid invalid page state                           |
| Arr API error during page load             | Keep previous data if available and show retry error  | Avoid blanking entire table                        |
| filters remove all results                 | Show empty-state for filter result with clear message | Distinguish from empty library                     |
| Lidarr large expanded rows                 | Keep expansion lazy and bounded                       | Avoid reintroducing jank in expanded content       |

### Success Criteria

- [ ] `/arr/{id}/library` does not freeze on large libraries at default settings.
- [ ] API supports paginated library responses with metadata (`page`, `pageSize`, `totalRecords`).
- [ ] UI supports page navigation and rows-per-page controls with URL-backed state.
- [ ] Refresh and cache invalidation remain correct per instance.
- [ ] Regression coverage exists for all Arr apps and pagination edge cases.

## Technical Specifications

### Architecture Overview

```text
Arr Library UI (/arr/{id}/library)
    -> GET /api/v1/arr/library?instanceId&page&pageSize&...
        -> Arr instance resolver (radarr|sonarr|lidarr)
            -> Arr client library aggregation (existing getLibrary methods)
                -> server-side filter/sort/slice + pagination metadata
                    -> client page rendering + cached page state
```

### Data Models

#### `PaginatedLibraryQuery`

| Field         | Type    | Constraints             | Description            |
| ------------- | ------- | ----------------------- | ---------------------- |
| instanceId    | integer | required, positive      | selected Arr instance  |
| page          | integer | required, `>= 1`        | page number            |
| pageSize      | integer | required, bounded       | rows per page          |
| sortKey       | string  | optional, allowlisted   | server-side sort field |
| sortDirection | enum    | optional (`asc`,`desc`) | sort direction         |
| query         | string  | optional                | search text            |

#### `LibraryPageResponse`

| Field              | Type    | Constraints | Description                          |
| ------------------ | ------- | ----------- | ------------------------------------ |
| type               | enum    | required    | `radarr` or `sonarr` or `lidarr`     |
| items              | array   | required    | app-specific library item slice      |
| profilesByDatabase | array   | required    | profile metadata for filters/badges  |
| page               | integer | required    | current page                         |
| pageSize           | integer | required    | current page size                    |
| totalRecords       | integer | required    | total rows matching current criteria |
| totalPages         | integer | required    | derived from total/pageSize          |
| hasNext            | boolean | required    | quick next-page signal               |

### API Design

#### `GET /api/v1/arr/library`

**Purpose**: fetch paginated library results for one Arr instance.

**Authentication**: existing server-side auth model (same as current endpoint behavior).

**Request**:

```json
{
  "instanceId": 12,
  "page": 1,
  "pageSize": 100,
  "sortKey": "title",
  "sortDirection": "asc",
  "query": "beatles"
}
```

**Response (200)**:

```json
{
  "type": "lidarr",
  "items": [],
  "profilesByDatabase": [],
  "page": 1,
  "pageSize": 100,
  "totalRecords": 2450,
  "totalPages": 25,
  "hasNext": true
}
```

**Errors**:

| Status | Condition                                   | Response                                 |
| ------ | ------------------------------------------- | ---------------------------------------- |
| 400    | invalid `instanceId`, `page`, or `pageSize` | `{ "error": "..." }`                     |
| 404    | instance not found                          | `{ "error": "Instance not found" }`      |
| 500    | Arr fetch/join failure                      | `{ "error": "Failed to fetch library" }` |

#### `DELETE /api/v1/arr/library`

**Purpose**: invalidate server-side library cache for an instance.

**Request**:

```json
{
  "instanceId": 12
}
```

**Response (200)**:

```json
{
  "success": true
}
```

### System Integration

#### Files to Create

- None required for baseline feature; use existing route/store structures.

#### Files to Modify

- `src/routes/api/v1/arr/library/+server.ts`: pagination query parsing, response envelope, page-aware caching.
- `src/routes/arr/[id]/library/+page.svelte`: URL-backed page state, controls, page fetch lifecycle.
- `src/lib/client/stores/libraryCache.ts`: keying strategy to include page/query state.
- `docs/api/v1/schemas/arr.yaml`: paginated response schema updates.
- `docs/api/v1/paths/arr.yaml`: query parameter and response contract updates.

#### Configuration

- `library.pagination.defaultPageSize`: default `100`.
- `library.pagination.maxPageSize`: bounded value (decision needed; candidate `250` or `500`).

## UX Considerations

### User Workflows

#### Primary Workflow: Browse Large Library

1. **Open Library**
   - User: visits `/arr/{id}/library`.
   - System: loads page 1 quickly with totals and controls.
2. **Refine View**
   - User: applies search/filters and changes page size if needed.
   - System: updates URL and fetches matching page with consistent totals.
3. **Navigate and Inspect**
   - User: pages through results and opens row details.
   - System: preserves state and keeps expansions bounded/lazy.

#### Error Recovery Workflow

1. **Error Occurs**: page fetch fails.
2. **User Sees**: inline error with retry while preserving visible data when possible.
3. **Recovery**: user retries or refreshes; cache invalidates and page 1 reloads.

### UI Patterns

| Component            | Pattern                                   | Notes                                   |
| -------------------- | ----------------------------------------- | --------------------------------------- |
| library action bar   | add rows-per-page and refresh consistency | align with logs controls where possible |
| page summary         | `Showing X-Y of Z`                        | preserves orientation                   |
| top and bottom pager | Previous/Next plus page indicator         | improves navigation on long pages       |
| row details          | lazy expanded content                     | protects render performance             |

### Accessibility Requirements

- Pagination controls exposed in labeled navigation regions.
- Keyboard-operable page and size controls.
- Page changes announced with polite live region messaging.
- Focus remains predictable after navigation updates.
- Empty and error states use text and iconography, not color alone.

### Performance UX

- **Loading States**: skeletons for initial load and lightweight transition indicators for page changes.
- **Optimistic Updates**: not required for pagination navigation.
- **Error Feedback**: inline retry with preserved context.

## Recommendations

### Implementation Approach

**Recommended Strategy**: make fixed pagination the default now (`pageSize=100`, configurable), then optionally add lazy load-more behavior once baseline stability is confirmed.

**Phasing:**

1. **Phase 1 - Baseline Pagination**: API pagination contract, UI controls, URL state, and cache updates.
2. **Phase 2 - Server-Side Canonical Filtering/Sorting**: lock deterministic page correctness and add focused tests.
3. **Phase 3 - Optional Lazy Loading Enhancements**: sentinel-based load-more and virtualization only if needed.

### Technology Decisions

| Decision          | Recommendation                    | Rationale                                         |
| ----------------- | --------------------------------- | ------------------------------------------------- |
| default UX        | fixed pagination                  | deterministic behavior and accessibility          |
| default page size | 100                               | strong balance between scan speed and render cost |
| cache strategy    | page/query-aware keys             | avoid stale or cross-page collisions              |
| infinite scroll   | optional enhancement, not default | lower risk and clearer user orientation           |

### Quick Wins

- Reuse logs page pagination control language and interaction pattern.
- Keep existing `ExpandableTable` and row components; change data flow first.
- Add page-size guardrails in API validation early.

### Future Enhancements

- App-specific adaptive page-size defaults.
- Background prefetch for next page.
- Virtualization for heavy long-row render cases.

## Risk Assessment

### Technical Risks

| Risk                                                   | Likelihood | Impact | Mitigation                                          |
| ------------------------------------------------------ | ---------- | ------ | --------------------------------------------------- |
| inconsistent page results due mixed sort/filter timing | Medium     | High   | canonical server-side sort/filter before slicing    |
| cache growth from page/query keys                      | Medium     | Medium | bounded TTL and scoped invalidation by instance     |
| UI regressions across three Arr app layouts            | Medium     | Medium | shared pagination utilities plus app-specific tests |
| Lidarr expanded detail still expensive                 | High       | Medium | keep detail loading lazy and bounded                |

### Integration Challenges

- Updating OpenAPI/runtime/types/UI in lockstep.
- Preserving current unsupported-capability behavior while extending response contracts.
- Maintaining Arr-specific semantics rather than cross-app shortcuts.

### Security Considerations

- Keep Arr API keys server-only and out of client-visible URLs.
- Validate pagination and filter inputs strictly to prevent malformed query abuse.
- Continue existing error-handling patterns without leaking sensitive instance details.

## Task Breakdown Preview

### Phase 1: Contract and UI Foundation

**Focus**: establish server-driven pagination and visible controls.
**Tasks**:

- Add pagination query parsing and response metadata to library API.
- Update library page to include pagination state and navigation controls.
- Extend cache stores to handle page-aware keys.
  **Parallelization**: API and UI control skeleton can run in parallel, then integrate.

### Phase 2: Correctness and Coverage

**Focus**: deterministic filtering/sorting and robust tests.
**Dependencies**: Phase 1 API contract and UI wiring.
**Tasks**:

- Move canonical sort/filter logic server-side for page consistency.
- Add unit tests for page bounds, invalid inputs, and metadata correctness.
- Add one focused E2E scenario per Arr app for pagination flow.

### Phase 3: Performance Hardening

**Focus**: optional lazy-loading and advanced performance safeguards.
**Tasks**:

- Add optional load-more mode using `IntersectionObserver`.
- Evaluate virtualization on heavy rows if real-world data still causes jank.
- Tune page-size defaults from observed usage.

## Decisions Needed

Before implementation planning, confirm:

1. **Default UX Mode**
   - Options: fixed pagination only, or fixed pagination plus optional load-more in v1.
   - Impact: scope and QA complexity.
   - Recommendation: fixed pagination only in v1.
2. **Page Size Policy**
   - Options: default 100 with max 250, or default 100 with max 500.
   - Impact: performance envelope and operator flexibility.
   - Recommendation: start with max 250 unless benchmark data proves 500 is safe.
3. **Filter/Sort Scope**
   - Options: server-side canonical now, or staged mixed approach.
   - Impact: correctness guarantees versus initial delivery speed.
   - Recommendation: server-side canonical in v1 for deterministic paging.

## Research References

- [research-external.md](./research-external.md): external API behavior and integration constraints.
- [research-business.md](./research-business.md): user stories, business rules, and success criteria.
- [research-technical.md](./research-technical.md): architecture and contract implications.
- [research-ux.md](./research-ux.md): workflow, accessibility, and interaction guidance.
- [research-recommendations.md](./research-recommendations.md): phased strategy and decision checklist.
