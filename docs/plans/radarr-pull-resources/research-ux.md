# UX Research: radarr-pull-resources (Second Pass)

## Executive Summary

The best fit is a simple route-based flow under the Arr instance page: Fetch -> Review -> Import. To match second-pass behavior, all pulled items should be selected by default, while category/item deselection remains optional before commit. Keep conflict behavior transparent and rely on current backend dedup/conflict logic for v1.

## Core User Workflows

### Happy Path

1. Open `Import` tab on a Radarr instance.
2. Select database and categories, then fetch preview.
3. Review grouped results (all selected by default).
4. Optionally deselect by category/item.
5. Confirm import summary and commit.
6. View final results with toast + inline summary.

### Recovery/Error Path

1. Fetch fails: show inline actionable error with retry.
2. Execute partially fails: keep successful items committed and show retry-failed action.
3. Preview stale: block execute and request refreshed preview.

## UI and Interaction Patterns

- Dedicated `Import` tab under existing Arr instance layout.
- Single-page phased states: `idle`, `loading`, `preview`, `executing`, `results`.
- Default selection behavior:
  - all previewed items start selected
  - quick controls: `Select all`, `Clear`, per-category toggles
- Confirmation modal includes:
  - total selected count
  - per-category counts
  - clear note: "If unchanged, all pulled items will be imported."

## Accessibility Considerations

- Full keyboard navigation for selections and category toggles.
- Non-color status indicators for resource states.
- `aria-live` updates during preview/execution transitions.
- Proper focus trap and restoration in confirmation modal.

## Feedback and State Design

- Loading: clear text for phase (`Fetching from Radarr`, `Importing X of Y`).
- Empty: explicit "no resources found" messaging.
- Success: summary card + toast with per-category counts.
- Partial success: first-class outcome with retry option.
- Error: actionable inline banners for connection/auth/validation failures.

## UX Risks

- Users may miss default import-all semantics.
  - mitigation: explicit summary text and checkbox state clarity.
- Large lists can overwhelm.
  - mitigation: collapsed categories + bulk actions + search/filter (if needed).
- Terminology confusion (`Pull` vs `Import`).
  - mitigation: user-facing label `Import`, internal naming can remain pull.
- Cross-instance UX drift between Sonarr and Radarr.
  - mitigation: shared component behavior and copy parity.

## Second-pass Corrections

1. Removed over-detailed sections so structure matches Sonarr second-pass UX doc.
2. Updated defaults from selective-first behavior to all-selected-by-default behavior.
3. Kept Radarr-specific UX differences to copy/labels only, not flow divergence.
4. Deferred advanced conflict tooling until backend behavior requires it.
