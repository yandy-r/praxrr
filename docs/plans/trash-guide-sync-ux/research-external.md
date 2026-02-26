# External API Research: trash-guide-sync-ux

## Executive Summary

The multi-source filtering UX for Praxrr should be built using the existing custom component library
(Badge, Tabs, SearchAction, Toggle) extended with new filter-specific primitives -- filter chips,
source toggles, and a faceted sidebar pattern. No external UI component libraries are recommended;
Praxrr already has sufficient Svelte 4-style primitives, and adding Bits UI or shadcn-svelte would
introduce a Svelte 5 runes dependency that conflicts with the project's "Svelte 5, no runes"
convention. Filter state should be managed via URL search parameters using SvelteKit's `goto()` with
`replaceState` for transient updates and `pushState` for user-initiated filter changes, keeping
filters shareable and surviving page reloads.

**Confidence**: High -- Based on analysis of the existing codebase patterns (Svelte 4 syntax, custom
`$ui/` components, Tailwind CSS v4), competitor analysis (Radarr, Sonarr, Recyclarr, Configarr,
Profilarr), and established UX research from Nielsen Norman Group and Algolia.

---

## UI Component Libraries

### Evaluated Libraries

#### Bits UI (v1.x)

- **URL**: https://bits-ui.com/
- **GitHub**: https://github.com/huntabyte/bits-ui
- **Relevant components**: Combobox (multi-select), ToggleGroup, Select, Listbox
- **Svelte 5 runes**: Required (uses `$state`, `$derived`, `bind:value`)
- **Verdict**: NOT RECOMMENDED -- Bits UI is built on Svelte 5 runes and Melt UI builders. Praxrr's
  CLAUDE.md explicitly states "Svelte 5, no runes" and the existing codebase uses `export let`,
  `$:`, and `on:click` throughout. Adopting Bits UI would require a fundamental paradigm shift.

**Confidence**: High -- Confirmed by reading Bits UI ToggleGroup and Combobox documentation, which
show `$state()` and function binding patterns incompatible with Praxrr's conventions.

#### shadcn-svelte

- **URL**: https://shadcn-svelte.com/
- **Relevant components**: Command palette, Badge, Toggle Group, Checkbox
- **Tailwind v4**: Supported via `@next` CLI with `data-slot` attribute styling and OKLCH colors
- **Verdict**: NOT RECOMMENDED -- Built on Bits UI, inherits the same Svelte 5 runes requirement.
  The Command component is appealing for search/filter but requires the full Bits UI dependency
  chain.

**Confidence**: High -- shadcn-svelte Tailwind v4 migration docs confirm the Svelte 5 + Bits UI
foundation. Source: https://www.shadcn-svelte.com/docs/migration/tailwind-v4

#### Flowbite Svelte

- **URL**: https://flowbite-svelte.com/
- **Relevant components**: Faceted Search Modals, Badge, Checkbox, Range Slider
- **Pattern**: Modal-based faceted filtering with checkbox grids and apply/reset buttons
- **Verdict**: PARTIAL REFERENCE -- Flowbite's faceted search modal pattern (checkbox grid with
  count badges, apply/reset buttons) is a useful design reference, but the library itself adds
  unnecessary weight. The pattern can be implemented with Praxrr's existing Modal, Badge, and form
  components.

**Confidence**: Medium -- Flowbite Svelte docs show a clean faceted search modal pattern. However,
its Svelte 5 compatibility status is unclear, and Praxrr already has equivalent primitives.

#### SVAR Svelte

- **URL**: https://svar.dev/svelte/
- **Relevant components**: Filter (Query Builder), DataGrid
- **Verdict**: NOT RECOMMENDED -- Enterprise-focused, heavyweight, and designed for complex data
  grids with AND/OR filter logic. Overkill for source-based filtering.

**Confidence**: Medium -- Based on documentation review; SVAR targets a different use case
(enterprise data grids).

### Recommended Approach: Extend Existing Components

Praxrr already has a well-designed component library at `$ui/`:

| Existing Component            | Location                          | Reuse Potential                                                  |
| ----------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `Badge`                       | `$ui/badge/Badge.svelte`          | Source indicators (Praxrr-DB, TRaSH, Custom) with `variant` prop |
| `SearchAction`                | `$ui/actions/SearchAction.svelte` | Text search with mobile modal pattern                            |
| `Tabs`                        | `$ui/navigation/tabs/Tabs.svelte` | Tab-based section filtering                                      |
| `Toggle`                      | `$ui/toggle/Toggle.svelte`        | Boolean filter toggles                                           |
| `ActionsBar`                  | `$ui/actions/ActionsBar.svelte`   | Toolbar container for filter controls                            |
| `Dropdown` / `DropdownSelect` | `$ui/dropdown/`                   | Select-style filter dropdowns                                    |
| `ViewToggle`                  | `$ui/actions/ViewToggle.svelte`   | Grid/list view switching                                         |

**New components to build** (Tailwind CSS v4, Svelte 4 syntax):

1. `FilterChip` -- Removable pill showing active filter state
2. `FilterChipGroup` -- Container for multiple FilterChips with "Clear all"
3. `SourceToggle` -- Segment control for source filtering (All / Praxrr-DB / TRaSH / Custom)
4. `FilterBar` -- Composed layout combining SearchAction + SourceToggle + FilterChips

**Confidence**: High -- Analysis of 50+ existing Svelte components confirms the project's
conventions and available primitives.

---

## SvelteKit Filter State Patterns

### URL Search Parameters (Recommended Primary Approach)

URL search params are the correct primary mechanism for filter state in Praxrr. They provide:

- Shareable/bookmarkable filter states
- Browser back/forward support for free
- Server-side rendering compatibility (load functions can read params)
- Progressive enhancement (forms work without JavaScript)

#### Core Pattern: `goto()` with Search Params

```typescript
// In a Svelte component
import { goto } from '$app/navigation';
import { page } from '$app/stores';

// Read current filter state
$: source = $page.url.searchParams.get('source') || 'all';
$: search = $page.url.searchParams.get('q') || '';
$: arrType = $page.url.searchParams.get('arr') || 'all';

// Update filter state
function setFilter(key: string, value: string) {
  const url = new URL($page.url);
  if (value && value !== 'all') {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  goto(url.toString(), { replaceState: true, noScroll: true, keepFocus: true });
}
```

**Source**: SvelteKit state management docs (https://kit.svelte.dev/docs/state-management) and
Okupter's guide (https://www.okupter.com/blog/state-in-url-the-sveltekit-approach)

**Confidence**: High -- This is the officially documented SvelteKit pattern. The
`replaceState: true` option prevents history pollution for transient filter changes, while
`keepFocus: true` maintains input focus during search-as-you-type.

#### Server-Side Load Integration

```typescript
// +page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') || 'all';
  const search = url.searchParams.get('q') || '';
  const arrType = url.searchParams.get('arr') || 'all';

  // Filter entities server-side
  const entities = await getFilteredEntities({ source, search, arrType });

  return { entities, filters: { source, search, arrType } };
};
```

#### History API Alternative (for Sub-Component State)

For high-frequency updates that should not trigger load function re-execution (e.g., typing in
search), use the History API directly:

```typescript
function updateSearchParam(key: string, value: string) {
  const url = new URL(window.location.toString());
  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  history.replaceState(history.state, '', url);
}
```

**Critical note**: Always pass `history.state` (not `{}`) to preserve SvelteKit's internal routing
state. Source:
https://dev.to/mohamadharith/mutating-query-params-in-sveltekit-without-page-reloads-or-navigations-2i2b

**Confidence**: High -- Community-validated pattern with SvelteKit router preservation.

### Evaluated URL Param Libraries

#### sveltekit-search-params (v4.x)

- **URL**: https://github.com/paoloricciuti/sveltekit-search-params
- **Features**: Type-safe encoding/decoding (`ssp.boolean()`, `ssp.number()`, `ssp.array()`),
  default values, LZ compression
- **Svelte 5**: Version 4 rewrote to use runes syntax
- **Verdict**: NOT RECOMMENDED -- v4 requires Svelte 5 runes, which conflicts with Praxrr
  conventions. The v3 store-based API is deprecated. The patterns it provides are simple enough to
  implement natively.

**Confidence**: High -- GitHub issue #80 confirms the v4 runes rewrite.

#### Runed useSearchParams

- **URL**: https://runed.dev/docs/utilities/use-search-params
- **Features**: Schema-driven validation (Zod/Valibot), debouncing, compression, history control
- **Verdict**: NOT RECOMMENDED -- Runed is a Svelte 5 runes utility library. The schema-driven
  approach with Zod is appealing but can be replicated with a simple hand-rolled parser.

**Confidence**: High -- Runed documentation explicitly uses `$derived()` and Svelte 5 APIs.

#### kit-query-params

- **URL**: https://github.com/beynar/kit-query-params
- **Verdict**: NOT RECOMMENDED -- Svelte 5 dependency.

### Recommended State Management Architecture

**Hybrid approach**: URL search params for all filter state, with a thin client-side store for
derived/computed filter results.

```
URL Search Params (source of truth)
    |
    v
$page.url.searchParams (reactive read)
    |
    v
Derived filter state ($: computed)
    |
    v
Filtered entity list (client-side or server-side)
```

**When to use `goto()` (triggers load function)**:

- Source filter changes (all/praxrr-db/trash/custom)
- Arr type filter changes (all/radarr/sonarr/lidarr)
- Pagination changes
- Sort order changes

**When to use `history.replaceState()` (client-side only)**:

- Search-as-you-type text input (debounced)
- Transient hover/focus states

**When to use component-local state (no URL)**:

- Dropdown open/closed state
- Mobile modal visibility
- Temporary selection before "Apply"

**Confidence**: High -- Aligns with SvelteKit's documented recommendations and Geoff Rich's
progressive enhancement pattern (https://geoffrich.net/posts/marvel-filter-state/).

---

## Filter Component Patterns

### Filter Chips (Removable Pill Pattern)

Filter chips are compact, removable indicators of active filter state. They follow the Google
Material Design pattern where each active filter appears as a pill with an "X" dismiss button.

**Implementation guidance**:

```svelte
<!-- FilterChip.svelte -->
<script lang="ts">
    import { X } from 'lucide-svelte';
    import type { ComponentType } from 'svelte';

    export let label: string;
    export let icon: ComponentType | null = null;
    export let variant: 'accent' | 'neutral' | 'info' = 'accent';
    export let removable: boolean = true;
    export let onremove: (() => void) | undefined = undefined;

    const variantClasses: Record<typeof variant, string> = {
        accent: 'bg-accent-100 text-accent-800 dark:bg-accent-900/50 dark:text-accent-200',
        neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
        info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
    };
</script>

<span
    class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium
        {variantClasses[variant]}"
    role="status"
>
    {#if icon}
        <svelte:component this={icon} size={12} />
    {/if}
    {label}
    {#if removable && onremove}
        <button
            type="button"
            on:click={onremove}
            class="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full
                hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="Remove {label} filter"
        >
            <X size={10} />
        </button>
    {/if}
</span>
```

**Design best practices** (from Algolia and NNGroup research):

- Chips should appear immediately above or adjacent to the filtered results
- Each chip displays the category and value (e.g., "Source: TRaSH" not just "TRaSH")
- A "Clear all filters" action appears when 2+ filters are active
- Chip removal should animate out smoothly (use Svelte `transition:fade`)
- Count badge showing matching results per filter value

**Confidence**: High -- Pattern is well-established across Google Material Design, Algolia
InstantSearch, and Tailwind UI. Sources:
https://www.algolia.com/blog/ux/faceted-search-and-navigation,
https://www.nngroup.com/articles/filter-categories-values/

### Source Toggle / Segment Control

A segment control (also called "pill tabs" or "toggle group") is the primary pattern for source
filtering. It provides mutually exclusive selection with clear visual state.

**Implementation guidance**:

```svelte
<!-- SourceToggle.svelte -->
<script lang="ts">
    export let value: string = 'all';
    export let options: Array<{ value: string; label: string; count?: number }> = [];

    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher<{ change: string }>();

    function select(optionValue: string) {
        value = optionValue;
        dispatch('change', optionValue);
    }
</script>

<div
    class="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5
        dark:border-neutral-700 dark:bg-neutral-800"
    role="radiogroup"
    aria-label="Filter by source"
>
    {#each options as option (option.value)}
        <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            on:click={() => select(option.value)}
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                {value === option.value
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'}"
        >
            {option.label}
            {#if option.count !== undefined}
                <span class="ml-1 text-[10px] opacity-60">({option.count})</span>
            {/if}
        </button>
    {/each}
</div>
```

**Design rationale**:

- Segment controls are preferred over dropdowns when there are 2-5 options (all source types fit
  this range)
- Counts next to labels help users predict how filtering will affect results
- The "All" option should always be first and selected by default
- Active state uses elevation (shadow) and contrast differentiation

**Confidence**: High -- Segment controls are the standard pattern for low-cardinality categorical
filters. Bits UI ToggleGroup follows this same pattern with `role="radiogroup"`. Source:
https://www.bits-ui.com/docs/components/toggle-group

### Multi-Select Dropdown (for Arr Type Filtering)

When the number of filter options exceeds 5 or when screen space is limited (mobile), a multi-select
dropdown is preferred:

```svelte
<!-- Uses existing DropdownSelect pattern from Praxrr -->
<DropdownSelect
    label="Arr Type"
    options={[
        { value: 'all', label: 'All Apps' },
        { value: 'radarr', label: 'Radarr' },
        { value: 'sonarr', label: 'Sonarr' },
        { value: 'lidarr', label: 'Lidarr' }
    ]}
    bind:selected={arrType}
    on:change={handleArrFilterChange}
/>
```

**Confidence**: Medium -- Praxrr already has `DropdownSelect` which can be adapted. The multi-select
variant may need extension.

### Source Badges / Tags

Source badges indicate the origin of each entity in list/card views. Praxrr's existing `Badge`
component with Arr-specific variants (`radarr`, `sonarr`, `lidarr`) provides the pattern.

**New source variants needed**:

| Source                  | Badge Variant          | Color Scheme               |
| ----------------------- | ---------------------- | -------------------------- |
| Default PCD (Praxrr-DB) | `accent`               | Accent color (existing)    |
| TRaSH Guides            | Custom `trash` variant | Orange/amber (TRaSH brand) |
| Custom Database         | `info`                 | Blue (existing)            |
| User Override           | `warning`              | Amber (existing)           |
| Radarr                  | `radarr`               | Existing Arr color         |
| Sonarr                  | `sonarr`               | Existing Arr color         |
| Lidarr                  | `lidarr`               | Existing Arr color         |

**Implementation**: Extend the `Badge.svelte` `variant` union type and `variantClasses` map with
`trash` and `custom-db` variants.

**Confidence**: High -- Direct extension of existing code at
`/packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte`.

### Composed Filter Bar Pattern

The complete filter bar combines all primitives:

```
+----------------------------------------------------------------------+
| [Search...              ] | [All | Praxrr-DB | TRaSH | Custom] | Arr v |
+----------------------------------------------------------------------+
| Active: [Source: TRaSH x] [Arr: Radarr x]              Clear all    |
+----------------------------------------------------------------------+
```

- Row 1: SearchAction (existing) + SourceToggle (new) + Arr dropdown
- Row 2: FilterChipGroup (new) showing active non-default filters
- Row 2 is hidden when no filters are active
- Mobile: Row 1 collapses to SearchAction + filter icon button that opens a modal

**Confidence**: High -- Follows Algolia's faceted search navigation pattern and is consistent with
Praxrr's existing ActionsBar layout.

---

## Competitor Analysis

### Radarr / Sonarr Quality Profile UI

**Quality Profile Editor**:

- Accessed via Settings > Profiles in the Radarr/Sonarr web UI
- Profile editing is a single-page form with sections: Name, Upgrade Until, Language, Custom Format
  Scores
- Custom formats are listed in a flat table below profile settings, each with a numeric score input
- Quality items are ordered vertically; position in the list determines priority ("Quality Trumps
  All")
- No filtering or search within the profile editor itself
- Profile selection when adding media uses a simple dropdown with profile names

**Custom Format Management**:

- Flat list of all custom formats with name-based search
- Each format has conditions (specifications) that are edited in a separate form
- No source attribution (all formats appear identical regardless of origin)
- No bulk operations or multi-select

**Strengths**:

- Simple, familiar form-based editing
- Clear visual hierarchy with scores
- "Quality Trumps All" rule is well-communicated

**Weaknesses**:

- No source tracking (manual vs TRaSH-imported formats are indistinguishable)
- No multi-source management
- No batch operations for score assignment
- Linear list does not scale well with 100+ custom formats
- No search/filter within profile custom format scoring
- No preview of what a profile change would affect

**Confidence**: High -- Based on TRaSH Guides documentation
(https://trash-guides.info/Radarr/radarr-setup-quality-profiles/) and Servarr Wiki
(https://wiki.servarr.com/radarr/settings).

### Recyclarr

**Approach**: CLI-based YAML configuration management.

- Configuration is organized by service (Radarr/Sonarr sections in YAML)
- Templates system allows reusing pre-built configurations from `recyclarr/config-templates`
- Quality profiles reference custom formats by TRaSH Guide ID
- Include system (`include:`) enables modular YAML composition
- Secrets management via separate `secrets.yml`

**Multi-Source Handling**:

- Single source of truth: the YAML configuration file(s)
- Templates are Recyclarr-maintained and versioned
- Custom overrides merge on top of templates
- No UI -- all configuration is file-based

**Lessons for Praxrr**:

- Template/preset system is valuable (users should not configure from scratch)
- Source attribution matters (users need to know what came from TRaSH vs custom config)
- Include/compose pattern for modular configuration is powerful
- CLI users want deterministic, auditable configuration -- Praxrr's UI should provide equivalent
  confidence

**Confidence**: High -- Based on Recyclarr documentation
(https://recyclarr.dev/reference/configuration/) and config templates
(https://github.com/recyclarr/config-templates).

### Configarr

**Approach**: Container-based sync tool with YAML configuration and experimental UI support.

**Multi-Source Architecture**: Configarr implements a three-layer template merge hierarchy:

1. TRaSH/Recyclarr templates (upstream community defaults)
2. Local templates (user-maintained, stored in `localConfigTemplatesPath`)
3. `config.yml` (final overrides)

Templates merge in sequence: upstream -> local -> config file, with later layers overriding earlier
ones.

**Key Features**:

- Automatic TRaSH Guide repository fetching with custom fork support via `trashGuideUrl`
- URL-based template loading (v1.18.0+) for YAML and JSON from HTTP endpoints
- `delete_unmanaged_custom_formats` with configurable ignore lists
- Profile cloning and renaming across instances
- Custom format groups from TRaSH load only "required" formats by default

**Lessons for Praxrr**:

- Three-layer merge is a proven pattern for multi-source configuration
- "Required vs optional" classification within groups helps users make informed decisions
- Auto-fetching with fork support enables community contributions
- Delete-unmanaged with ignore list provides safety for mixed manual/automated setups

**Confidence**: High -- Based on Configarr documentation
(https://configarr.de/docs/configuration/config-file/).

### Profilarr (Dictionarry-Hub)

**Approach**: Web-based configuration management platform (closest competitor to Praxrr).

**Technology Stack**: TypeScript (62.4%), Svelte (31.5%), Deno 2.x runtime -- nearly identical to
Praxrr.

**Multi-Source Handling**:

- Links to configuration databases (Dictionarry or "Profilarr Compliant Databases" / PCD)
- Git-backed configuration with version control
- Unified configuration language compiling to Arr-specific formats
- OSQL (append-only SQL operations) for auditable configuration
- Reusable regex components shared across custom formats

**Web Interface**:

- Browsable profiles for quality profiles, custom formats, and release profiles
- Instance bridging via URL + API key credentials
- Sync deployment with automatic format compilation
- Pattern validation and behavior testing before deployment

**Key Differentiator**: Profilarr abstracts Radarr/Sonarr-specific syntax into a unified interface,
similar to Praxrr's PCD system. Both projects use PCD as a configuration format.

**Lessons for Praxrr**:

- The "Link -> Bridge -> Sync" flow is a proven onboarding pattern
- Unified configuration language reduces cross-Arr confusion
- Git-backed version control provides confidence for configuration changes
- Pre-sync validation is expected by users

**Confidence**: High -- Based on GitHub repository analysis
(https://github.com/Dictionarry-Hub/profilarr).

---

## Faceted Search / Filter Best Practices

### Key UX Principles (from NNGroup, Algolia, and Industry Research)

1. **Appropriate filters**: Match filter categories to user mental models. For Praxrr: Source (where
   it came from), Arr Type (what app it targets), Category/Group (functional classification), and
   Status (synced/pending/modified).

2. **Predictable labels**: Use concrete, specific labels. "Source: TRaSH Guides" not "Type:
   External". "App: Radarr" not "Platform: R".

3. **Prioritized ordering**: Place the most general filter first (Source), followed by increasingly
   specific filters (Arr Type > Category > Status). This follows the "inverted pyramid" pattern
   where general-to-specific ordering matches user decision flow.

4. **Count badges**: Show the number of matching results next to each filter option. This helps
   users predict the impact of applying a filter before committing. Example: "TRaSH Guides (47)" vs
   "Custom (3)".

5. **OR within, AND across**: Within a single facet (e.g., Arr Type), multiple selections use OR
   logic (show Radarr OR Sonarr). Across facets (e.g., Source AND Arr Type), use AND logic (show
   TRaSH AND Radarr only).

6. **Clear all**: Provide a "Clear all filters" action when any filters are active. Position it
   adjacent to the active filter chips.

7. **Result count announcement**: After filter changes, display an updated result count (e.g.,
   "Showing 23 of 156 custom formats"). This provides feedback that the filter was applied.

8. **Performance**: Filter application should feel instant (<200ms for client-side, <500ms for
   server-round-trip). Use optimistic updates with loading states for server-dependent filtering.

9. **Mobile adaptation**: On mobile, collapse filters into a full-screen modal or bottom sheet. The
   filter icon should show a badge when filters are active.

**Sources**:

- NNGroup: https://www.nngroup.com/articles/filter-categories-values/
- Algolia: https://www.algolia.com/blog/ux/faceted-search-and-navigation
- Algolia Overview: https://www.algolia.com/blog/ux/faceted-search-an-overview
- BrokenRubik: https://www.brokenrubik.com/blog/faceted-search-best-practices

**Confidence**: High -- Multiple authoritative UX research sources converge on these patterns.

### Recommended Filter Taxonomy for Praxrr

| Filter   | Type                                          | Options                        | Default         |
| -------- | --------------------------------------------- | ------------------------------ | --------------- |
| Source   | Segment control                               | All, Praxrr-DB, TRaSH, Custom  | All             |
| Arr Type | Segment control (desktop) / Dropdown (mobile) | All, Radarr, Sonarr, Lidarr    | All             |
| Category | Multi-select checkbox dropdown                | Dynamic from entity groups     | None (show all) |
| Search   | Text input with debounce                      | Free text                      | Empty           |
| Status   | Toggle pills                                  | All, Modified, Synced, Pending | All             |

---

## Accessibility Patterns

### ARIA for Filter Groups

**Segment controls** (SourceToggle, ArrTypeToggle):

- Container: `role="radiogroup"` with `aria-label="Filter by [category]"`
- Each option: `role="radio"` with `aria-checked="true|false"`
- This follows the WAI-ARIA radio group pattern, which is the correct semantic for mutually
  exclusive toggle groups

**Checkbox filter groups** (Category multi-select):

- Container: `role="group"` with `aria-labelledby` pointing to the group heading
- Each option: native `<input type="checkbox">` (preferred over ARIA checkbox role)
- If using custom checkboxes: `role="checkbox"` with `aria-checked="true|false|mixed"`

**Filter chips** (active filter indicators):

- Each chip: `role="status"` (implicit `aria-live="polite"`)
- Remove button: `aria-label="Remove [filter name] filter"`
- Chip group container: use a `<ul>` with `aria-label="Active filters"`

**Source**: W3C WAI-ARIA Authoring Practices -- Checkbox Pattern
(https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/) and Listbox Pattern
(https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).

**Confidence**: High -- Based on W3C normative specifications.

### Keyboard Navigation

**Segment controls**:

- Arrow Left/Right: Move focus between options
- Space/Enter: Select the focused option
- Tab: Move focus into/out of the group (roving tabindex pattern)
- Home/End: Move to first/last option

**Filter chips**:

- Tab: Navigate between chips
- Delete/Backspace: Remove the focused chip
- Escape: Move focus back to the filter input

**Search input**:

- Escape: Clear current text OR close mobile modal
- Enter: Submit search (if applicable)
- Down Arrow: Move focus to first filter result (if combined with dropdown)

**Implementation note**: Use `tabindex="0"` on the active/selected element and `tabindex="-1"` on
inactive elements within a group (roving tabindex). This matches the pattern used in Praxrr's
existing Tabs component.

**Source**: WebAIM keyboard accessibility guide (https://webaim.org/techniques/keyboard/).

**Confidence**: High -- Standard keyboard navigation patterns from WAI-ARIA APG.

### Screen Reader Announcements for Filter State Changes

**Live region for result counts**:

```svelte
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
    {#if activeFilterCount > 0}
        Showing {filteredCount} of {totalCount} items with {activeFilterCount} active
        {activeFilterCount === 1 ? 'filter' : 'filters'}
    {:else}
        Showing all {totalCount} items
    {/if}
</div>
```

**Key principles**:

- Use `aria-live="polite"` (not "assertive") for filter result changes -- the update is important
  but not urgent
- Use `role="status"` which is equivalent to `aria-live="polite"` + `aria-atomic="true"`
- Place the live region in the DOM on initial render; only update its text content when filters
  change
- Debounce announcements (300-500ms) to avoid rapid-fire updates during search-as-you-type
- Announce the result count, not individual changes

**Source**: MDN ARIA live regions guide
(https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions) and Sara
Soueidan's accessible notifications series
(https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2/).

**Confidence**: High -- Based on W3C WCAG 2.2 techniques (ARIA22: Using role=status,
https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22).

### Focus Management

When filters change the visible results:

- Do NOT move focus automatically (disrupts keyboard users)
- If the previously focused element disappears, move focus to the filter input or the result
  container
- When clearing all filters, return focus to the "Clear all" button's sibling (the first filter
  control)
- When removing a specific filter chip, move focus to the next chip or the previous chip if it was
  the last one

**Confidence**: High -- Standard focus management patterns from WAI-ARIA APG.

---

## Integration Patterns

### Recommended Architecture

```
                    URL Search Params (source of truth)
                            |
                    +-------+-------+
                    |               |
            +page.server.ts    +page.svelte
            (server filter)    (client filter)
                    |               |
            Load function      Reactive $: derived
            returns filtered   computes from
            entities           $page.url.searchParams
                    |               |
                    +-------+-------+
                            |
                    Filtered entity list
                            |
                    Rendered in Card/Table
                    with Source Badges
```

**Server-side filtering** (recommended for initial load and source/arr-type filters):

- The `+page.server.ts` load function reads URL params and queries the PCD cache with filter
  criteria
- This ensures fast initial render with correct filtered data
- Reduces client-side JavaScript computation

**Client-side filtering** (for search-as-you-type and transient filters):

- Use `$:` reactive statements to filter a pre-loaded entity list
- Debounce search input (250-300ms) before updating URL params
- Use `history.replaceState()` for search text to avoid triggering server reload on every keystroke

**Hybrid approach** (recommended):

- Source filter and Arr type filter: Use `goto()` to trigger server-side load
- Search text: Client-side filter with `history.replaceState()` for URL persistence
- Category/group filter: Client-side filter (the data is already loaded)

### Progressive Enhancement Pattern

Following Geoff Rich's pattern (https://geoffrich.net/posts/marvel-filter-state/):

```svelte
<form method="get" on:submit|preventDefault={handleFilterSubmit}>
    <input type="hidden" name="source" value={source} />
    <input type="hidden" name="arr" value={arrType} />
    <input type="text" name="q" value={search} on:input={handleSearchInput} />
    <button type="submit" class="sr-only">Apply filters</button>
</form>
```

- Without JavaScript: Form submits as GET request, page reloads with filter params
- With JavaScript: `on:submit|preventDefault` intercepts, uses `goto()` for client-side navigation
- This ensures the filter system works even if JavaScript fails to load

**Confidence**: High -- Progressive enhancement is a core SvelteKit principle. Source:
https://svelte.dev/tutorial/kit/progressive-enhancement

### Data Synchronization

Filter state syncs between components through the URL:

1. **FilterBar** component writes to URL via `goto()` or `history.replaceState()`
2. **+page.server.ts** reads URL params in load function
3. **+page.svelte** reads `$page.url.searchParams` for UI state restoration
4. **FilterChipGroup** derives active filters from `$page.url.searchParams`
5. Browser back/forward navigates filter states automatically

No additional sync mechanism (stores, context, events) is needed between filter components because
the URL is the single source of truth.

---

## Constraints and Gotchas

1. **Svelte 5 runes prohibition**: Praxrr uses "Svelte 5, no runes" per CLAUDE.md. All filter
   components must use `export let`, `$:` reactive statements, `createEventDispatcher`, and
   `on:click` syntax. This eliminates Bits UI, shadcn-svelte, Runed, and sveltekit-search-params v4
   as dependencies.

2. **`goto()` triggers load functions**: When filter params change via `goto()`, SvelteKit
   re-executes the page's load function. This is desirable for source/arr-type filters but can cause
   unwanted server round-trips for search text. Mitigation: use `history.replaceState()` for
   high-frequency text input, `goto()` for discrete filter changes.

3. **`history.replaceState()` does not update `$page`**: When using the History API directly,
   `$page.url.searchParams` may not reactively update. SvelteKit issue #10661 documents this.
   Mitigation: either use `goto()` or maintain a parallel local variable for the search text.

4. **URL length limits**: Encoding complex multi-select filter state in URLs can exceed browser
   limits (~2,000 characters for safe cross-browser compatibility). For Praxrr's use case (source +
   arr type + search + category), this is unlikely to be an issue, but monitor if category filter
   grows to support 50+ options.

5. **Initial server render**: `page.state` from shallow routing is empty on initial server render.
   Filter state in URL search params does not have this limitation -- params are available on both
   server and client.

6. **Cross-Arr semantic validation**: Per CLAUDE.md policy, filter categories must be validated per
   `arr_type`. A category filter option that exists for Radarr custom formats may not exist for
   Sonarr. Dynamic filter options must adapt based on the selected Arr type.

7. **Mobile breakpoint consistency**: Praxrr's existing components use `(max-width: 767px)` for
   mobile detection via `window.matchMedia`. New filter components must use the same breakpoint for
   consistent behavior.

**Confidence**: High -- Constraints derived from CLAUDE.md project conventions and SvelteKit
documented behavior.

---

## Open Questions

1. **Filter persistence scope**: Should filter state persist per-page (e.g., Custom Formats page has
   its own filters) or globally (same source filter across all pages)? URL params naturally scope to
   the current page, which is likely correct.

2. **Server-side vs client-side filtering boundary**: For the initial implementation, should all
   filtering happen client-side (simpler, requires loading all entities) or should source/arr-type
   filtering be server-side (more scalable, requires load function integration)? Recommendation:
   start client-side, migrate to server-side if entity counts exceed ~500.

3. **TRaSH Guide group taxonomy**: TRaSH Guides organize custom formats into groups (e.g.,
   "Unwanted", "HDR Formats", "Audio Advanced"). Should these groups become first-class filter
   categories, or should they remain a display-level grouping? The existing `trash-guide-sync`
   research references entity groups -- this needs alignment.

4. **Filter presets**: Should Praxrr offer pre-built filter presets (e.g., "Show TRaSH HDR formats
   for Radarr")? This would be a power feature but adds complexity. Consider for a later iteration.

5. **Empty state design**: When filters produce zero results, what guidance should the empty state
   provide? The existing `EmptyState.svelte` component can be extended with filter-aware messaging
   (e.g., "No custom formats match your filters. Try removing the Source: TRaSH filter.").

---

## Search Queries Executed

1. "Svelte 5 component libraries filter faceted search 2025 2026"
2. "SvelteKit URL search params filter state management best practices"
3. "Tailwind CSS v4 filter chips pill selector toggle group component patterns"
4. "Radarr quality profile custom format UI selection interface"
5. "Bits UI Svelte 5 headless components select combobox listbox"
6. "shadcn-svelte Svelte 5 Tailwind v4 command palette filter components"
7. "ARIA accessible filter checkbox group keyboard navigation screen reader best practices"
8. "Recyclarr Configarr UI multi-source configuration management interface"
9. "WAI-ARIA listbox checkbox group filter pattern role=group aria-label live region"
10. "Svelte 5 Melt UI Bits UI toggle group segment control component"
11. "aria-live polite filter results count announcement screen reader dynamic content update"
12. "Profilarr Dictionarry-Hub UI custom format quality profile management web interface"
13. "faceted search filter UX patterns best practices 2024 2025 web application design"
14. "sveltekit-search-params library Svelte 5 runes support reactive URL params"
15. "Svelte 5 badge component tag indicator source label pattern Tailwind CSS"
16. "Radarr Sonarr web UI quality profile editor custom format scoring interface screenshots"
17. "progressive enhancement filter form SvelteKit goto replaceState shallow routing"
18. "SvelteKit goto replaceState search params filter state without full page reload"
19. "Svelte 5 derived state computed filtering reactive data transformation pattern"

---

## Sources

### UI Component Libraries

- [Bits UI Documentation](https://bits-ui.com/)
- [Bits UI Combobox](https://bits-ui.com/docs/components/combobox)
- [Bits UI Toggle Group](https://www.bits-ui.com/docs/components/toggle-group)
- [shadcn-svelte](https://shadcn-svelte.com/)
- [shadcn-svelte Command](https://www.shadcn-svelte.com/docs/components/command)
- [shadcn-svelte Tailwind v4 Migration](https://www.shadcn-svelte.com/docs/migration/tailwind-v4)
- [Flowbite Svelte Faceted Search](https://flowbite-svelte.com/blocks/application/faceted-search-modals)
- [SVAR Svelte Components](https://svar.dev/svelte/)
- [Material Tailwind Chip](https://www.material-tailwind.com/docs/html/chip)
- [Tailwind CSS Chip Examples (DEV)](https://dev.to/creativetim_official/10-tailwind-css-chip-components-free-open-source-4b9n)

### SvelteKit State Management

- [SvelteKit State Management Docs](https://kit.svelte.dev/docs/state-management)
- [State in URL: the SvelteKit approach (Okupter)](https://www.okupter.com/blog/state-in-url-the-sveltekit-approach)
- [sveltekit-search-params](https://github.com/paoloricciuti/sveltekit-search-params)
- [Runed useSearchParams](https://runed.dev/docs/utilities/use-search-params)
- [kit-query-params](https://github.com/beynar/kit-query-params)
- [Progressive Enhancement Filter (Geoff Rich)](https://geoffrich.net/posts/marvel-filter-state/)
- [Mutating Query Params without Reloads (DEV)](https://dev.to/mohamadharith/mutating-query-params-in-sveltekit-without-page-reloads-or-navigations-2i2b)
- [SvelteKit Shallow Routing](https://svelte.dev/docs/kit/shallow-routing)
- [SvelteKit $app/navigation](https://svelte.dev/docs/kit/$app-navigation)
- [Svelte 5 $derived Docs](https://svelte.dev/docs/svelte/$derived)
- [SvelteKit Reactive URL Params Issue #13746](https://github.com/sveltejs/kit/issues/13746)

### Faceted Search UX

- [NNGroup: Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/)
- [Algolia: Faceted Search Overview](https://www.algolia.com/blog/ux/faceted-search-an-overview)
- [Algolia: Faceted Search Navigation](https://www.algolia.com/blog/ux/faceted-search-and-navigation)
- [Fact Finder: 9 Faceted Search Best Practices](https://www.fact-finder.com/blog/faceted-search/)
- [BrokenRubik: Faceted Search Best Practices 2026](https://www.brokenrubik.com/blog/faceted-search-best-practices)
- [LogRocket: Faceted Filtering](https://blog.logrocket.com/ux-design/faceted-filtering-better-ecommerce-experiences/)

### Competitor Analysis

- [TRaSH Guides: Radarr Quality Profiles](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/)
- [Servarr Wiki: Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)
- [Recyclarr Quality Profiles](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Profilarr (Dictionarry-Hub)](https://github.com/Dictionarry-Hub/profilarr)
- [TRaSH Guides: Custom Format Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)

### Accessibility

- [W3C WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- [W3C WAI-ARIA Checkbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/)
- [W3C Listbox with Grouped Options](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-grouped/)
- [MDN: ARIA Live Regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- [MDN: ARIA Checkbox Role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/checkbox_role)
- [W3C WCAG ARIA22: role=status](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22)
- [Sara Soueidan: Accessible Notifications Part 2](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2/)
- [WebAIM: Keyboard Accessibility](https://webaim.org/techniques/keyboard/)
- [Ariakit: Checkbox Group](https://ariakit.org/examples/checkbox-group)

### SvelteKit Progressive Enhancement

- [SvelteKit Progressive Enhancement Tutorial](https://svelte.dev/tutorial/kit/progressive-enhancement)
- [JoyOfCode: SvelteKit Progressive Enhancement](https://joyofcode.xyz/sveltekit-progressive-enhancement)
