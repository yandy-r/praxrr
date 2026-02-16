# UX Research: arr-library-view-pagination

### Executive Summary

Fixed pagination should be the primary interaction model for library management because it gives users stable orientation, repeatability, and easier recovery on large datasets. Infinite scroll can feel smoother, but it creates ambiguity about position and complicates accessibility and QA for large operational tables. A hybrid approach is best: fixed pages plus optional lazy loading inside page boundaries.

### Core User Workflows

- Happy path flow:
  - User opens library and sees page 1 quickly.
  - User applies search/filters and gets updated totals.
  - User navigates pages and inspects row details without losing context.
- Recovery/error flow:
  - Page fetch fails.
  - Existing content remains visible where possible.
  - Inline error offers retry and keeps current filters/search/page state.

### UI and Interaction Patterns

- Add top and bottom pagination controls similar to logs view pattern.
- Show result summary: `Showing X-Y of Z`.
- Keep rows-per-page control with practical choices (for example 50/100/200).
- Persist pagination/search/filter/sort in URL to support back/forward and refresh.
- For Lidarr-heavy content, keep album-first table rows and lazy-load expensive detail content on expansion.

### Accessibility Considerations

- Wrap controls in `nav` with clear `aria-label` for pagination.
- Mark current page with `aria-current="page"` when page list controls are used.
- Announce page changes using polite live regions.
- Ensure keyboard access for all navigation and page-size controls.
- Keep focus management predictable after page changes (for example move to table heading or first row).

### Feedback and State Design

- Loading state:
  - Skeleton rows for initial load.
  - Small inline spinner for page transitions.
- Empty state:
  - Differentiate no-library-data from no-filter-matches.
- Success state:
  - Subtle refresh confirmation and updated counts.
- Error state:
  - Inline actionable errors with retry; avoid blank table resets when stale data is usable.

### UX Risks

- User confusion over whether filters are global or page-local.
  - Mitigation: explicit label and server-side canonical filtering in v1.
- Losing context after page-size changes.
  - Mitigation: reset to page 1 with clear status message.
- Large expanded rows still causing jank.
  - Mitigation: lazy detail loading and cap rendered detail sections.
- Cross-app inconsistency.
  - Mitigation: shared pagination model with app-specific detail loading only.
