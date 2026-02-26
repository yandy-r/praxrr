# UX Research: trash-guide-sync-ux

## Executive Summary

Praxrr needs a unified multi-source filtering and selection system that lets users browse, search,
and sync entities (custom formats, quality profiles, quality definitions, naming configs) across PCD
databases and TRaSH Guide sources without cluttering the existing interface. The recommended
approach is a **horizontal filter bar with toggle-pill source selectors** above existing content
views, combined with **source badges on entity cards/rows** and **grouped-by-source sections in Arr
sync configuration**. This pattern aligns with Praxrr's existing `ActionsBar` + `Tabs` architecture,
avoids navigation redesign, scales to 3-5 sources, and follows established design system patterns
from PatternFly, Carbon, and Helios.

**Confidence**: High -- based on convergent recommendations across 6+ design systems, competitive
analysis of Recyclarr/Configarr/Sonarr/Radarr, and direct analysis of the existing Praxrr UI
component library.

## User Workflows

### Primary Flow: Multi-Source Entity Browsing

This flow covers the custom formats page, quality profiles page, and similar entity list pages where
users need to see and filter entities from multiple PCD databases and TRaSH Guide sources.

1. **User navigates to Custom Formats page** -> System loads entities from all linked databases (PCD
   and TRaSH) and displays the current database tab as today, but with a new "All Sources" option.
2. **User sees database tabs with source indicators** -> Each tab shows the database name plus a
   small source-type badge (PCD icon, TRaSH icon). A new "All" tab is the leftmost option when
   multiple sources exist.
3. **User clicks "All" tab** -> System displays a unified list of all custom formats across all
   databases. Each entity card/row includes a source badge showing which database it belongs to
   (e.g., "Praxrr-DB", "TRaSH Radarr").
4. **User optionally applies source filter pills** -> Below the tabs, a horizontal filter bar with
   toggle pills lets the user filter by source type: "PCD Databases", "TRaSH Guides", or individual
   database names. Active pills are highlighted; inactive are muted. OR logic within the source
   group.
5. **User searches within filtered view** -> The existing `SearchAction` component filters within
   the currently displayed (source-filtered) entities. Search operates across name, tags, and
   description per existing `SearchFilterAction` behavior.
6. **Success state** -> User sees a filtered, searchable list with clear source provenance for every
   entity. Active filter pills and result count provide immediate feedback ("Showing 47 of 203
   custom formats").

**Confidence**: High -- this flow directly extends Praxrr's existing Tabs + ActionsBar +
SearchAction architecture without breaking changes.

### Primary Flow: Arr Sync Configuration with Source Filtering

This flow covers the `/arr/[id]/sync` page where users select which profiles and settings to sync
from which databases to an Arr instance.

1. **User navigates to Arr instance sync page** -> System loads the sync configuration page with all
   linked databases (PCD and TRaSH) grouped in each section (Quality Profiles, Media Management,
   Delay Profiles).
2. **User sees databases grouped by source type** -> Within each sync section (e.g., Quality
   Profiles), databases are grouped under source-type headers: "PCD Databases" and "TRaSH Guide
   Sources". Each group is visually distinct with a subtle background color or left-border accent.
3. **User expands/collapses source groups** -> Each source-type group header is collapsible
   (accordion pattern). Default state: all expanded if total items < 20, otherwise collapsed with
   item counts shown.
4. **User toggles individual profiles for sync** -> The existing `Toggle` component behavior is
   preserved. Users click individual profile toggles within each database group. Each profile shows
   its database name alongside the toggle label when in "All Sources" view.
5. **User uses "Select All" within a database** -> A "Select All" / "Deselect All" link at the
   database group header level lets users quickly select all profiles from a single database (e.g.,
   "Select all from TRaSH Radarr").
6. **User previews and saves** -> The existing SyncFooter + SyncPreviewPanel workflow is preserved.
   Preview now shows source provenance for each entity in the diff view.
7. **Success state** -> User has a clear mental model of what is being synced from which source,
   with the ability to selectively include/exclude entire sources or individual profiles.

**Confidence**: High -- extends the existing `QualityProfiles.svelte` component's database iteration
pattern with visual grouping.

### Alternative Flows

- **Single-source user (no TRaSH)**: For users with only one PCD database and no TRaSH sources, the
  "All" tab and source filter pills are hidden. The UI behaves identically to today. No added
  complexity for simple setups.
- **TRaSH-only user**: For users who only use TRaSH Guide sources, the entity pages show TRaSH
  databases in tabs. No PCD-specific UI appears.
- **Source conflict resolution**: When a user browses "All" and finds two custom formats with the
  same name from different sources, each shows its source badge prominently. On the sync page,
  selecting both would trigger a validation warning: "Multiple sources define 'FLAC'. Only one will
  be synced per instance." The user must deselect one or the sync preview will show the conflict.
- **Entity comparison across sources**: User clicks a "Compare" action on an entity visible in "All"
  view to see a diff between the PCD version and TRaSH version of the same-named entity. This is a
  "Nice to Have" and not required for initial implementation.

**Confidence**: Medium -- alternative flows are based on common patterns from Grafana (mixed data
sources), Configarr (source priority), and Cloudflare (multi-zone management), but specific user
behavior with TRaSH data in Praxrr has not been validated.

## UI/UX Best Practices

### Source Filtering Patterns

Based on research across PatternFly, Carbon Design System, Helios (HashiCorp), and 20+ SaaS filter
UI examples, four patterns are viable for Praxrr's multi-source filtering. The recommended approach
combines patterns 1 and 2.

#### Pattern 1: Toggle Pills in Filter Bar (Recommended Primary)

Toggle pills (also called "filter chips" or "segmented controls") are small, interactive buttons
arranged horizontally that toggle source visibility on/off.

- **When to use**: When there are 2-6 source categories that users frequently switch between. This
  is Praxrr's exact case (1-3 PCD databases + 0-2 TRaSH sources = 2-5 total).
- **Layout**: Horizontal row below the Tabs component, above the content area. Integrates naturally
  into the existing `ActionsBar` position.
- **Behavior**: OR logic within pills -- toggling a pill on adds that source's entities to the view;
  toggling off removes them. At least one pill must always be active.
- **Visual**: Active pills use the accent color fill; inactive pills use a neutral outline. Each
  pill shows the source name and entity count (e.g., "Praxrr-DB (142)").
- **Trade-offs**: Compact, always visible, immediate feedback. Breaks down at 7+ sources (unlikely
  for Praxrr).

**Confidence**: High -- this pattern is explicitly recommended by PatternFly's Toggle Group filter
guidelines for "few filter options that should remain visible" and by Carbon Design System for
interactive filtering.

Sources:

- [PatternFly Filters Design Guidelines](https://www.patternfly.org/patterns/filters/design-guidelines/)
- [Carbon Design System Filtering Pattern](https://carbondesignsystem.com/patterns/filtering/)
- [Helios Filter Patterns](https://helios.hashicorp.design/patterns/filter-patterns)

#### Pattern 2: Source Badges on Entity Items (Recommended Companion)

Small colored badges on each entity card/row indicating the source database.

- **When to use**: Always, when displaying entities from multiple sources in a unified view ("All"
  tab).
- **Visual**: Small pill-shaped badge to the right of the entity name. Color-coded by source type:
  accent for PCD, a distinct color (e.g., green/teal) for TRaSH. Badge text is the database name,
  truncated with tooltip for long names.
- **Behavior**: Clicking the badge could optionally filter to that source (progressive disclosure).
- **Trade-offs**: Provides provenance at a glance without requiring the filter bar. Essential for
  the "All" view.

**Confidence**: High -- source badges are a universal pattern in multi-source UIs (Grafana panels,
Cloudflare zones, Portainer environments).

#### Pattern 3: Dropdown Select Filter (Alternative)

A single dropdown that lists all available sources with checkboxes for multi-select.

- **When to use**: When source count exceeds 6 or screen space is constrained (mobile).
- **Layout**: Replaces toggle pills with a single "Source" dropdown button in the ActionsBar.
- **Behavior**: Opens a checkbox list of sources. "Apply" button or auto-apply on selection.
- **Trade-offs**: More compact than pills but hides active state. Better for mobile, worse for
  desktop discoverability.

**Confidence**: Medium -- viable fallback but toggle pills are preferable for Praxrr's expected
source count.

#### Pattern 4: Tab-Per-Database (Current Praxrr Pattern)

The existing Tabs component where each database gets its own tab.

- **When to use**: Preserved for single-database views and backward compatibility.
- **Enhancement**: Add an "All Sources" tab as the first tab when multiple sources exist.
- **Trade-offs**: Familiar to current users. Does not scale well beyond 5 databases (tabs overflow).
  Does not support viewing entities across sources simultaneously.

**Confidence**: High -- this is the current pattern and should be preserved alongside the new filter
bar, not replaced.

### Industry Standards

#### Active Filter Indication (Required)

Active filters must be clearly communicated at all times. Best practices from NNG (Nielsen Norman
Group) and PatternFly:

- Show active filter count or applied filter labels above the content area.
- Provide a "Clear all filters" action that returns to the default view.
- Use dismissible tags/chips for each active filter (PatternFly Applied Filter Labels pattern).
- Never let the user reach a state where they do not understand why results are filtered.

**Confidence**: High

Sources:

- [NNG Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/)
- [PatternFly Filters](https://www.patternfly.org/patterns/filters/design-guidelines/)

#### Result Count Feedback (Required)

Always show the count of displayed items relative to total items when filters are active.

Format: "Showing X of Y custom formats" or "X custom formats" when unfiltered.

This is critical for Praxrr because users with TRaSH sources may have 200+ custom formats, and
filtering by source dramatically changes the result set.

**Confidence**: High -- universally recommended across Carbon, PatternFly, and Helios design
systems.

#### Batch vs. Interactive Filtering

Carbon Design System distinguishes two approaches:

- **Interactive filtering** (recommended for Praxrr): Results update immediately upon each
  selection. Best when the user makes one filter change at a time and data loads quickly (local
  SQLite, no network delay).
- **Batch filtering**: Multiple filters are selected, then applied with a button. Best for slow data
  loads or many simultaneous filter changes.

Praxrr's entity lists are loaded from local SQLite and filtered client-side, so interactive
filtering with instant updates is the correct choice. No "Apply" button needed.

**Confidence**: High

Source: [Carbon Design System Filtering](https://carbondesignsystem.com/patterns/filtering/)

### Accessibility (WCAG 2.2)

#### Toggle Pills / Filter Controls

- **`aria-pressed`**: Each toggle pill must use `aria-pressed="true"` or `"false"` to communicate
  state to screen readers. This is the correct ARIA attribute for on/off toggle buttons per WAI-ARIA
  Authoring Practices.
- **Keyboard navigation**: Toggle pills must respond to both Space and Enter keys. Tab key moves
  focus between pills. Arrow keys optionally navigate within the pill group (roving tabindex
  pattern).
- **Focus indicators**: Visible focus ring with at least 3:1 contrast ratio against adjacent colors
  per WCAG 2.4.7 and 2.4.11 (Focus Appearance).
- **Touch targets**: Minimum 44x44 CSS pixels per WCAG 2.5.5 (Target Size).
- **Role**: Use `role="group"` on the filter bar container with `aria-label="Filter by source"`.

**Confidence**: High

Sources:

- [WCAG 2.1.1 Keyboard Accessibility](https://wcag.dock.codes/documentation/wcag211/)
- [Accessible Toggle Buttons Guide](https://testparty.ai/blog/accessible-toggle-buttons-modern-web-apps-complete-guide)
- [WAI-ARIA 1.3](https://w3c.github.io/aria/)

#### Source Badges

- Badges must not rely on color alone for source identification (WCAG 1.4.1). Include text labels or
  distinct icons alongside color.
- Badge text must meet 4.5:1 contrast ratio (WCAG 1.4.3).

**Confidence**: High

#### Bulk Selection (Sync Page)

- "Select All" checkbox must communicate partial selection state via `aria-checked="mixed"` when
  some items are selected.
- Selection count updates must use `role="status"` for live region announcements per Helios Table
  Multi-Select guidelines.

**Confidence**: High

Source: [Helios Table Multi-Select](https://helios.hashicorp.design/patterns/table-multi-select)

### Responsive Design

#### Desktop (>= 1024px)

- Toggle pills displayed inline in the filter bar, all visible.
- Entity list uses the existing card grid or table view.
- Source badges displayed inline on cards/rows.
- Sync page shows all database groups expanded with the full toggle grid (existing `grid-cols-5`
  pattern).

#### Tablet (768px - 1023px)

- Toggle pills remain inline but may wrap to a second line if many sources.
- Card grid reduces to 2-3 columns.
- Sync page toggle grid reduces to `grid-cols-3`.

#### Mobile (< 768px)

- Toggle pills collapse into a dropdown select filter (Pattern 3 above) to save horizontal space.
  The existing `SearchAction` mobile modal pattern sets the precedent for this collapse behavior.
- Entity cards display as a single-column list. Source badge remains visible but smaller.
- Sync page groups become collapsible accordions, defaulting to collapsed with entity counts. Toggle
  grid reduces to `grid-cols-2`.
- Tabs collapse to the existing mobile dropdown selector (already implemented in `Tabs.svelte`).

**Confidence**: High -- these breakpoints align with Praxrr's existing responsive patterns in
`SearchAction.svelte` and `Tabs.svelte`.

## Error Handling

### Error States

| Error                                      | User Message                                                                             | Recovery Action                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TRaSH source sync failed                   | "Failed to sync TRaSH Guide data for [source name]. Last successful sync: [date]."       | "Retry Sync" button. Show stale data with a "Stale" badge.                                                  |
| All filters yield no results               | "No [entity type] match your current filters."                                           | "Clear filters" link below the message. Show which filters are active.                                      |
| Source unavailable (deleted while viewing) | "The database '[name]' is no longer available."                                          | Remove the source filter pill. Redirect to "All" view if current tab was the deleted source.                |
| Conflicting entity names across sources    | "[Entity name] exists in multiple sources. Only one version can be synced per instance." | Show both sources with radio-style selection on the sync page. Highlight the conflict with a warning badge. |
| Sync preview generation failed             | "Could not generate sync preview. [error detail]"                                        | "Retry Preview" button. Existing `SyncPreviewPanel` error handling applies.                                 |
| Network error during filter data load      | "Could not load [source] data. Check your connection."                                   | "Retry" button. Show cached/stale data if available.                                                        |
| TRaSH source has no entities for Arr type  | "This TRaSH Guide source has no [entity type] for [Radarr/Sonarr]."                      | Informational message, not an error. No recovery needed -- the source is simply empty for this category.    |

**Confidence**: High -- error patterns follow NNG's "Help Users Recognize, Diagnose, and Recover
from Errors" heuristic and align with Praxrr's existing `alertStore.add()` pattern.

Sources:

- [Error Handling UX Design Patterns](https://medium.com/design-bootcamp/error-handling-ux-design-patterns-c2a5bbae5f8d)
- [NNG Error Recovery](https://www.userjourneys.com/blog/ux-guidelines-for-error-handling/)
- [Material Design Error Patterns](https://m1.material.io/patterns/errors.html)

### Validation Patterns

- **Source filter selection**: At least one source must always be active. If the user tries to
  deselect the last active source, the toggle is prevented and a tooltip explains "At least one
  source must be selected."
- **Sync profile selection**: When selecting profiles for sync, incompatible selections (e.g.,
  Radarr profile selected for Sonarr instance) are disabled with a tooltip: "This profile is not
  compatible with [Radarr/Sonarr]."
- **Duplicate entity names**: On the sync page, if the same entity name exists in multiple selected
  sources, show a warning banner above the affected section: "2 profiles share the name 'HD Bluray +
  WEB'. Praxrr will namespace them automatically during sync."

**Confidence**: Medium -- validation for cross-source conflicts depends on backend conflict
detection logic that may need refinement.

## Performance UX

### Loading States

- **Initial page load**: Use the existing page-level loading pattern. Entity lists and filter pills
  render together; no progressive loading needed since data comes from local SQLite.
- **Filter toggle**: Instant client-side filtering. No loading indicator needed because the
  operation is synchronous (JavaScript array filter on already-loaded data). The result count
  updates immediately.
- **Tab switch (database change)**: SvelteKit navigation with `data-sveltekit-preload-data="tap"`
  (already implemented). Show a brief skeleton or the existing "Loading..." state during data fetch.
- **TRaSH source sync (background)**: When a TRaSH source is syncing in the background, show a
  subtle "Syncing..." indicator badge on the source's filter pill or tab. Data remains browsable
  during sync. On sync completion, show an alert and refresh the data.
- **Sync preview generation**: Use the existing `SyncPreviewTrigger` loading state (spinner +
  "Generating preview...").

**Confidence**: High -- Praxrr's architecture loads all entities for a database in a single
server-side query. Client-side filtering adds no network latency.

### Large List Handling

With TRaSH Guide sources, users may have 200+ custom formats in a single source (TRaSH Radarr has
~180 custom formats). Combined across 2-3 sources, the "All" view could show 300-500+ entities.

#### Recommended Approach: Virtual Scrolling for Table View

- For the table view (`TableView.svelte`), implement virtual scrolling when the filtered result
  count exceeds 100 items. Only render the visible rows plus a buffer of ~20 rows above/below the
  viewport.
- Library recommendation: `svelte-virtual-list` or a custom implementation using
  IntersectionObserver, consistent with Praxrr's minimal-dependency philosophy.
- For the card view (`CardView.svelte`), use CSS `content-visibility: auto` on card containers for
  paint-on-demand optimization. This is a zero-JS approach that provides similar benefits for card
  grids.

**Confidence**: Medium -- 200-500 items may perform adequately without virtual scrolling in modern
browsers. Measure first, then implement if needed.

#### Alternative: Paginated Results

- Pagination with 50 items per page, with source filter pills persisting across pages.
- Less preferred because pagination breaks the "scan and select" workflow that is central to
  Praxrr's entity management.

**Confidence**: Medium

#### Filter Debounce

- Text search input already uses debounce via `SearchStore.debouncedQuery` (existing Praxrr
  pattern).
- Source toggle pills should apply instantly (no debounce) since the filter operation is
  synchronous.

**Confidence**: High

### Optimistic Updates

Optimistic UI patterns are **not recommended** for filter operations in Praxrr. Filter results
depend entirely on client-side data that is already loaded, so there is no server round-trip to
"optimistically" predict. Filters should apply synchronously and deterministically.

For sync operations (save, sync, preview), the existing pattern of showing a loading spinner and
then updating on success is appropriate. Sync operations are high-stakes (they modify external Arr
instances) and should not use optimistic updates.

**Confidence**: High

Source: [Optimistic UI Patterns Analysis](https://simonhearne.com/2021/optimistic-ui-patterns/) --
recommends optimistic updates only for "high-success-rate, reversible actions," which does not
describe sync operations.

## Competitive Analysis

### Recyclarr

- **Approach**: CLI-only tool with YAML configuration. No graphical UI. Users select TRaSH Guide
  profiles by `trash_id` in YAML files. Templates provide pre-built configurations that mirror TRaSH
  recommendations.
- **Multi-source**: Supports multiple Radarr/Sonarr instances in a single config file, but all
  configuration comes from a single source (TRaSH Guides). No concept of mixing custom user configs
  with TRaSH configs.
- **Strengths**: Zero-config templates that "just work". Strong alignment with TRaSH Guides. Users
  who want TRaSH defaults get them instantly.
- **Weaknesses**: No UI -- requires YAML editing. No ability to mix custom configurations with
  TRaSH. No visibility into what will change before sync (no preview). No conflict detection across
  sources.
- **Lesson for Praxrr**: The template/preset concept is valuable. Consider offering "Quick Apply"
  presets for common TRaSH profile combinations (e.g., "HD Bluray + WEB", "Remux + WEB 1080p") on
  the sync page.

**Confidence**: High

Sources:

- [Recyclarr Documentation](https://recyclarr.dev/)
- [Recyclarr Tutorial](https://recyclarr.dev/guide/tutorial/)
- [Recyclarr TRaSH Guides Page](https://trash-guides.info/Recyclarr/)

### Configarr

- **Approach**: Container-based tool (Docker/Kubernetes CronJob) with YAML configuration. No
  graphical UI. Runs as a scheduled sync job.
- **Multi-source**: Supports a flexible priority hierarchy: TRaSH Guides -> Local Files -> Direct
  Config. Intelligent merging with TRaSH taking priority, then local overrides, then inline config.
- **Strengths**: Multi-language custom format support beyond TRaSH. Clean priority model for source
  merging. Supports Sonarr v4 and Radarr v5 specifically.
- **Weaknesses**: No UI. No interactive source selection. No preview. The merge priority is implicit
  and not user-configurable.
- **Lesson for Praxrr**: The source priority hierarchy (canonical source > local overrides) maps
  well to Praxrr's existing PCD base ops > user ops model. Praxrr should visually indicate which
  entities have user overrides on top of TRaSH defaults.

**Confidence**: High

Sources:

- [Configarr Introduction](https://configarr.de/docs/intro/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [Configarr by raydak](https://www.raydak.de/projects/configarr/)

### Sonarr/Radarr (Native UI)

- **Approach**: Quality profiles are managed within Settings > Profiles. Custom formats are managed
  in Settings > Custom Formats. Scoring is done per-profile.
- **Multi-source**: No concept of external sources. All configuration is local to the instance.
- **Strengths**: Familiar to the target audience. Simple profile selection with toggle-based quality
  ordering. Custom format scoring is inline within profiles.
- **Weaknesses**: No external sync. No source tracking. Manual configuration of every custom format
  and score. The quality profile UI can become unwieldy with 50+ custom formats.
- **Lesson for Praxrr**: The quality profile scoring table (scores per custom format) is a familiar
  mental model for users. Praxrr's sync page should show a similar structure -- profile name with
  its custom format scores -- with source provenance added.

**Confidence**: High

Sources:

- [Sonarr Settings Wiki](https://wiki.servarr.com/sonarr/settings)
- [Radarr Settings Wiki](https://wiki.servarr.com/radarr/settings)
- [TRaSH Guides Quality Profile Setup](https://trash-guides.info/Sonarr/sonarr-setup-quality-profiles/)

### Grafana (Multi-Source Dashboard)

- **Approach**: Dashboard panels can query multiple data sources. A "Mixed" data source option lets
  users add queries from different backends in a single visualization. Template variables and ad-hoc
  filters provide dashboard-wide filtering.
- **Multi-source**: First-class multi-source support. Each panel query specifies its data source via
  a dropdown selector. Source is always visible at the query level.
- **Strengths**: Clear source provenance per query. Template variables act as global filters across
  all panels. Mixed mode allows overlaying data from different sources.
- **Weaknesses**: The multi-source model can be complex for simple use cases. Source selection is
  per-query, not per-dashboard, which can be confusing.
- **Lesson for Praxrr**: Grafana's template variable approach (dashboard-wide filter that affects
  all panels) maps to Praxrr's source filter pills that affect all entity lists on the page. The key
  insight is that the filter should be page-level, not per-section.

**Confidence**: High

Sources:

- [Grafana Data Sources](https://grafana.com/docs/grafana/latest/datasources/)
- [Grafana Mixed Data Source Panels](https://oneuptime.com/blog/post/2026-02-02-grafana-mixed-data-sources/view)
- [Grafana Multi-Source Best Practices](https://grafana.com/blog/how-to-work-with-multiple-data-sources-in-grafana-dashboards-best-practices-to-get-started/)

### Tailscale Admin Console

- **Approach**: Multi-device management with filtering by status, owner, tags, version, and sharing
  state. Filter bar at the top of the Machines page with dropdown-style filters.
- **Multi-source**: Filters by device attributes (managed by user/tag, OS, version) rather than data
  sources. Multi-select is supported within some filter categories but not all.
- **Strengths**: Clean filter bar above the device list. Free-form search alongside structured
  filters. Multiple filters can be combined.
- **Weaknesses**: Cannot multi-select within all filter categories (inconsistent). Grouping by user
  (available on mobile) is missing from the web admin console.
- **Lesson for Praxrr**: The filter bar placement (above the list, below navigation) and the
  combination of structured filters with free-form search is the same pattern recommended for
  Praxrr. Also note: always support multi-select within filter categories.

**Confidence**: High

Sources:

- [Tailscale Filter Devices](https://tailscale.com/kb/1176/filter-devices)
- [Tailscale Manage Devices](https://tailscale.com/kb/1372/manage-devices)

### Cloudflare Dashboard

- **Approach**: Multi-zone, multi-account management. Zone selector in the sidebar allows switching
  between zones while staying on the same feature page. Account selector for multi-account users.
- **Multi-source**: Zone-based model where each zone is an independent entity. Users navigate
  between zones via a sidebar selector.
- **Strengths**: Zone selector maintains context (same feature page) when switching. Useful for
  managing hundreds of zones.
- **Weaknesses**: Users cannot view/compare data across zones simultaneously. Community requests for
  tagging/grouping zones have been unfulfilled.
- **Lesson for Praxrr**: The "maintain context while switching source" pattern is what Praxrr's
  existing database tabs already do. Cloudflare's weakness (no cross-zone view) is exactly what
  Praxrr's "All Sources" tab should solve.

**Confidence**: Medium

Sources:

- [Cloudflare Dashboard](https://dash.cloudflare.com/)
- [Cloudflare Multi-Zone Management Discussion](https://community.cloudflare.com/t/new-dashboard-layout-make-the-menu-easier-for-multi-site-owners/368134)

### Portainer (Multi-Environment Container Management)

- **Approach**: Multi-environment dashboard managing Docker, Swarm, and Kubernetes from a single UI.
  Environment selector in the sidebar.
- **Multi-source**: Each environment is a separate Docker/K8s endpoint. Users switch between
  environments to manage containers.
- **Strengths**: Clean environment switching. Dashboard shows aggregated status across all
  environments.
- **Weaknesses**: Cannot view containers from multiple environments simultaneously. Must switch to
  each environment individually.
- **Lesson for Praxrr**: Portainer's aggregated dashboard (counts across all environments) maps to
  Praxrr's potential "All Sources" summary view. Show entity counts per source in the filter pills.

**Confidence**: Medium

### Best Practices to Adopt

| Practice                                | Adopted From                                           | Implementation                                             |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Toggle pills for source filtering       | PatternFly Toggle Group, Carbon Interactive Filter     | Horizontal pill bar in ActionsBar area                     |
| Source badges on entities               | Grafana panel source labels, Cloudflare zone badges    | Colored pill badges on card/row items                      |
| "All Sources" unified view              | Grafana Mixed Data Source                              | First tab option when >1 source exists                     |
| Grouped-by-source sections on sync page | Recyclarr multi-instance YAML, Sonarr profile grouping | Collapsible accordion groups per source type               |
| "Select All" per group                  | PatternFly Bulk Selection, Helios Table Multi-Select   | Link/checkbox at database group header                     |
| Result count with filter context        | Carbon, PatternFly, Helios                             | "Showing X of Y" above content area                        |
| Collapsible filter bar on mobile        | Tailscale filter bar, Praxrr SearchAction mobile modal | Dropdown selector replacing pills on mobile                |
| Empty state with clear-filters CTA      | NNG Empty States, GitLab Pajamas                       | Dedicated empty state with "Clear all filters" link        |
| Clear all filters action                | Carbon, PatternFly                                     | Tertiary button/link when any filter is active             |
| Source priority indication              | Configarr merge hierarchy                              | Visual indicator of base-ops source vs. user-ops overrides |

## Recommendations

### Must Have

1. **Source filter toggle pills on entity list pages** -- Horizontal toggle pills in the ActionsBar
   area on custom formats, quality profiles, and other entity list pages. Each pill represents a
   database (PCD or TRaSH) and shows entity count. Interactive filtering (instant update on toggle).
   At least one pill must always be active.

2. **"All Sources" tab on entity list pages** -- A new first tab on pages like
   `/custom-formats/[databaseId]` that shows entities from all databases. This tab activates the
   source filter pills. Individual database tabs continue to work as today (no filter pills needed
   when viewing a single source).

3. **Source badges on entity cards and table rows** -- Small colored badges showing the source
   database name on each entity in the "All Sources" view. Color-coded by source type (PCD vs.
   TRaSH). Accessible text labels (not color-only).

4. **Result count indicator** -- "Showing X of Y [entity type]" text above the content area when
   filters are active or when in "All Sources" view.

5. **Grouped-by-source sections on Arr sync page** -- On `/arr/[id]/sync`, group databases under
   "PCD Databases" and "TRaSH Guide Sources" headers within each sync section. Visual distinction
   via subtle background color or left-border accent.

6. **"Select All" per database group on sync page** -- A "Select All" / "Deselect All" toggle at
   each database header within sync sections.

7. **Empty state for filtered views** -- Dedicated empty state when filters yield no results,
   showing active filters and a "Clear all filters" link. Follows the existing `EmptyState.svelte`
   component pattern.

8. **Accessibility compliance** -- `aria-pressed` on filter pills, keyboard navigation
   (Space/Enter), focus indicators, touch targets >= 44x44px, `role="status"` on selection counts.

### Should Have

9. **Source type icons** -- Small icons (database icon for PCD, TRaSH icon for TRaSH Guides) on
   filter pills and tabs to provide quick visual distinction beyond text.

10. **Persistent filter state** -- Save the user's filter pill selections to `localStorage` per
    page, so returning to the page restores the previous filter state. Follows the existing
    `SearchFilterAction` persistence pattern.

11. **Collapsible source groups on sync page** -- Accordion behavior for source groups on the sync
    page when total entities across all groups exceed 20. Default expanded when < 20 total.

12. **Mobile filter collapse** -- On mobile viewports (< 768px), collapse toggle pills into a
    dropdown multi-select, following the existing `Tabs.svelte` mobile collapse pattern.

13. **Source provenance in sync preview** -- The existing `SyncPreviewPanel` should show the source
    database name for each entity in the diff view.

14. **Conflict detection badges** -- On the sync page, if the same entity name exists in multiple
    selected sources, show a warning badge with tooltip explaining that Praxrr will namespace them.

### Nice to Have

15. **Quick-apply presets for TRaSH profiles** -- Pre-built "Select all HD Bluray + WEB profiles" or
    "Select TRaSH recommended" buttons on the sync page. Inspired by Recyclarr's template approach.

16. **Cross-source entity comparison** -- A diff view comparing the same-named entity across two
    sources (e.g., PCD version vs. TRaSH version of "FLAC").

17. **Virtual scrolling for 200+ entity lists** -- Virtual scroll implementation for table view when
    filtered results exceed 100 items. Only needed if performance measurements show degradation.

18. **Source health indicators** -- On the filter pills, show sync status (last synced date, stale
    data warning) for TRaSH sources.

19. **Source color customization** -- Let users pick custom colors for each database's badge/pill,
    similar to the existing accent color picker.

20. **Keyboard shortcut for source cycling** -- Alt+1/2/3 to quickly switch between source filter
    states.

## Open Questions

1. **"All Sources" tab URL structure**: Should the "All Sources" view be at `/custom-formats/all` or
   `/custom-formats?source=all`? The former fits the existing `[databaseId]` route pattern but
   requires a reserved "all" slug. The latter is more flexible but changes the URL contract.

2. **Source filter pill position**: Should source filter pills go inside the existing `ActionsBar`
   (grouped with search and view toggle) or in a separate row between Tabs and ActionsBar? The
   separate row provides more space but adds vertical height.

3. **TRaSH entity editability**: Are TRaSH-imported entities read-only or can users create user-ops
   overrides? This affects whether the "New" button and edit flows should be available when viewing
   TRaSH source entities.

4. **Cross-source entity namespacing display**: When two sources have an entity with the same name,
   should the "All Sources" view show them as separate items with source badges, or should they be
   grouped/merged with a "2 sources" indicator?

5. **Source filter persistence scope**: Should filter state persist per-page (custom formats page
   remembers its filters, quality profiles page remembers its own) or globally (same filter state
   across all entity pages)?

6. **Sync page database ordering**: When databases are grouped by source type on the sync page,
   should PCD databases appear first (user's own data) or TRaSH sources first (recommended
   defaults)?

7. **Maximum supported sources**: What is the practical upper bound for database + TRaSH sources?
   Toggle pills work well for 2-6 items. If users commonly have 7+, a dropdown filter should be the
   default instead.

---

## Search Queries Executed

1. "multi-source data filtering UX patterns faceted search filter chips best practices 2025"
2. "Recyclarr TRaSH Guides configuration management UI multi-source 2025"
3. "Configarr TRaSH Guide integration Sonarr Radarr configuration sync"
4. "DevOps dashboard multi-source filtering UX patterns Grafana Datadog source selector"
5. "filter chips toggle pills UI pattern multi-source selection design system Material PatternFly
   2025"
6. "Sonarr Radarr quality profile selection UI custom format scoring interface"
7. "npm registry source filtering multi-registry package manager UI patterns"
8. "virtual scrolling large list performance UX patterns filter heavy interface 2025"
9. "Tailscale dashboard multi-device management filtering UX admin console design"
10. "Cloudflare dashboard multi-zone entity management filtering UI patterns"
11. "WCAG accessibility filter controls toggle buttons aria requirements keyboard navigation 2025"
12. "optimistic UI updates filter toggle instant feedback loading skeleton pattern 2025"
13. "Plex Jellyfin media server library source filtering multi-library management UI design"
14. "error handling UX patterns sync failure recovery multi-source conflict resolution UI 2025"
15. "batch selection multi-select checkbox list UX patterns select all across categories 2025"
16. "Grafana data source selector mixed query panel multi-source visualization filtering"
17. "SvelteKit responsive filter bar component pattern Tailwind CSS sidebar toggle mobile"
18. "empty state design pattern no results after filtering UX best practices 2025"
19. "Carbon design system filtering pattern batch filter interactive filter selection guidelines"
20. "configuration management tool multi-tenant source selector UI pattern Terraform Ansible Puppet
    dashboard"
21. "HashiCorp Helios design system filter patterns multi-source workspace selector"
22. "self-hosted application dashboard multi-source integration UI Portainer Rancher Proxmox
    management"
23. "debounce search input filter results loading state skeleton placeholder Svelte pattern"

## Uncertainties and Gaps

- **User validation**: All recommendations are based on industry patterns and competitive analysis,
  not direct user testing with Praxrr users. A/B testing or usability sessions with 3-5 users would
  validate the toggle pill approach over alternatives.
- **TRaSH entity volume**: The exact number of TRaSH Guide entities per source type has not been
  verified against live data. Entity counts affect whether virtual scrolling is needed.
- **Cross-Arr source compatibility**: Research did not deeply explore how TRaSH entities interact
  with Praxrr's Cross-Arr Semantic Validation Policy. Some TRaSH entities may need Arr-type-specific
  filtering on top of source filtering.
- **PCD user ops + TRaSH base ops interaction**: The research assumes TRaSH-imported entities behave
  like PCD base ops and can receive user ops overrides. This architecture decision affects
  editability UX and was not confirmed.
- **Mobile usage patterns**: No data on what percentage of Praxrr users access the app from mobile
  devices. Mobile-specific optimizations may have low ROI if usage is primarily desktop.

## Sources

- [PatternFly Filters Design Guidelines](https://www.patternfly.org/patterns/filters/design-guidelines/)
- [PatternFly Bulk Selection](https://www.patternfly.org/patterns/bulk-selection/)
- [PatternFly Toggle Group](https://www.patternfly.org/components/toggle-group/design-guidelines/)
- [Carbon Design System Filtering](https://carbondesignsystem.com/patterns/filtering/)
- [Helios Filter Patterns](https://helios.hashicorp.design/patterns/filter-patterns)
- [Helios Table Multi-Select](https://helios.hashicorp.design/patterns/table-multi-select)
- [Material Design 3 Chips](https://m3.material.io/components/chips)
- [NNG Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/)
- [NNG Empty State Interface Design](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Recyclarr Documentation](https://recyclarr.dev/)
- [Recyclarr Tutorial](https://recyclarr.dev/guide/tutorial/)
- [Configarr Introduction](https://configarr.de/docs/intro/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [Sonarr Settings Wiki](https://wiki.servarr.com/sonarr/settings)
- [Radarr Settings Wiki](https://wiki.servarr.com/radarr/settings)
- [TRaSH Guides Quality Profile Setup](https://trash-guides.info/Sonarr/sonarr-setup-quality-profiles/)
- [TRaSH Guides Custom Formats Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [Grafana Data Sources](https://grafana.com/docs/grafana/latest/datasources/)
- [Grafana Multi-Source Best Practices](https://grafana.com/blog/how-to-work-with-multiple-data-sources-in-grafana-dashboards-best-practices-to-get-started/)
- [Tailscale Filter Devices](https://tailscale.com/kb/1176/filter-devices)
- [Tailscale Manage Devices](https://tailscale.com/kb/1372/manage-devices)
- [Cloudflare Multi-Zone Discussion](https://community.cloudflare.com/t/new-dashboard-layout-make-the-menu-easier-for-multi-site-owners/368134)
- [WCAG 2.1.1 Keyboard Accessibility](https://wcag.dock.codes/documentation/wcag211/)
- [Accessible Toggle Buttons Guide](https://testparty.ai/blog/accessible-toggle-buttons-modern-web-apps-complete-guide)
- [WAI-ARIA 1.3](https://w3c.github.io/aria/)
- [Optimistic UI Patterns](https://simonhearne.com/2021/optimistic-ui-patterns/)
- [Error Handling UX Patterns](https://medium.com/design-bootcamp/error-handling-ux-design-patterns-c2a5bbae5f8d)
- [20 Filter UI Examples for SaaS](https://arounda.agency/blog/filter-ui-examples)
- [Smart Interface Design Patterns: Badges vs Chips vs Tags vs Pills](https://smart-interface-design-patterns.com/articles/badges-chips-tags-pills/)
- [Svelte 5 Debounced Input](https://minimalistdjango.com/snippets/2025-04-04-debounced-input-svelte/)
