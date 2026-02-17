# Business Logic Analysis: arr-library-view-pagination

### Executive Summary

The current library experience loads all items at once, which causes browser stalls for large libraries and blocks core operator workflows. Business value comes from making `/arr/{id}/library` consistently usable at scale across Radarr, Sonarr, and Lidarr. The functional target is a predictable, fast browsing workflow with explicit pagination state and clear recovery behavior.

### User Stories

- Primary: As an operator, I want large libraries to load without freezing so I can review quality and profile coverage quickly.
- Primary: As an operator, I want to navigate pages and change rows-per-page to control performance on my device.
- Secondary: As a power user, I want pagination/filter/search state reflected in the URL so I can refresh or share links without losing context.
- Secondary: As an operator, I want refresh to invalidate stale data without clearing my view configuration.

### Business Rules

- Library fetches must be bounded by `page` and `pageSize`; default page size should be 100.
- Pagination behavior must be available for all Arr apps; no app should keep unbounded table rendering.
- Column visibility preferences remain app-specific and must persist across pagination actions.
- Refresh should invalidate cached library data for the instance and refetch page 1.
- Result counts and page metadata must be visible so users can orient themselves in large libraries.
- Search/filter semantics must be explicit to users (global/server-scoped versus page-scoped).

### Workflows

- Primary flow:
  - User opens `/arr/{id}/library`.
  - UI requests page 1 using default page size.
  - User searches/filters, navigates pages, and optionally changes page size.
  - UI preserves column toggles and returns consistent stats for total records.

- Error recovery flow:
  - API call fails or returns unsupported capability error.
  - UI keeps prior state when possible and shows actionable inline error.
  - User can retry via refresh; unsupported cases show capability-specific messaging.

### Domain Concepts

- Arr Instance: selected server (`radarr`, `sonarr`, `lidarr`) that scopes every request.
- Library Item: app-specific row model already used in current route.
- Pagination State: `page`, `pageSize`, `totalRecords`, and navigation affordances.
- Profiles By Database: cross-database profile metadata used for filtering/badging.
- Cache Scope: server and client caches keyed by instance and pagination/filter state.

### Success Criteria

- Browser remains responsive on large Lidarr libraries with default settings.
- Page navigation requests only fetch needed page slices from Praxrr API contract.
- Users can change page size without losing search/filter/column settings.
- Refresh path invalidates stale cache and reloads cleanly.
- Accessibility and usability are not worse than current logs pagination behavior.

### Open Questions

- Should search/filter be strictly server-side in v1, or partially client-side on fetched pages?
- Should page-size preference be persisted globally, per app, or per instance?
- Should a load-more mode ship in v1 or wait until baseline pagination is stable?
- For Lidarr, is album-first with lazy detail enough, or do we need explicit track view pagination in scope?
