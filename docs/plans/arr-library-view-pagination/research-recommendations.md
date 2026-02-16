# Recommendations Synthesis: arr-library-view-pagination

### Executive Summary

The recommended direction is server-driven fixed pagination with default page size 100, plus configurable page size and optional lazy page loading after baseline stability. This provides deterministic performance and aligns with existing logs pagination UX patterns in the codebase. It also limits risk compared with making infinite scroll the primary mode.

### Recommended Implementation Strategy

- High-confidence approach:
  - Add paginated library API contract.
  - Migrate `/arr/{id}/library` to URL-backed pagination state.
  - Keep current row rendering components and progressively integrate lazy loading where useful.
- Rationale and tradeoffs:
  - Pros: predictable performance, easier testing/accessibility, better deep-link behavior.
  - Cons: more explicit navigation clicks than pure infinite scroll.

### Phased Rollout Suggestion

- Phase 1:
  - Ship fixed pagination with default `pageSize=100` and configurable control.
  - Add pagination metadata to API and UI summary text.
- Phase 2:
  - Make server-side sorting/filtering canonical for page correctness.
  - Expand test coverage (API + one E2E flow per Arr app).
- Phase 3:
  - Add optional load-more mode with IntersectionObserver.
  - Consider virtualization if performance still regresses on very large rows.

### Quick Wins

- Reuse logs page pagination control pattern.
- Keep maximum page-size guardrail in API validation.
- Preserve existing refresh and cache invalidation semantics.
- Maintain current column visibility persistence keys per app.

### Future Enhancements

- Adaptive defaults per app or instance size.
- Cursor-like pagination if server-side filtering grows complex.
- Background prefetch of next page after user idle.
- Telemetry for render time and page transition latency.

### Risk Mitigations

- Contract migration risk:
  - Keep additive API rollout until all consumers are moved.
- Data consistency risk:
  - Use stable server-side sort with deterministic tiebreakers before slicing.
- Cache growth risk:
  - Bound cache strategy and invalidate by instance on refresh.
- Arr semantic risk:
  - Keep explicit app-specific logic; do not assume endpoint parity.

### Decision Checklist

- Should the v1 default be fixed pagination only, with load-more deferred?
- Exact page-size range and max cap?
- Which filters/sorts are mandatory server-side in v1?
- Whether to store page-size preference globally or per app/instance?
- Performance SLO target for large Lidarr libraries?
