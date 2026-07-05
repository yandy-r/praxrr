# External API Research: enhance-progressive-disclosure

## Executive Summary

The existing AdvancedSection component and server-synced userInterfacePreferences store provide a solid foundation. Enhancement should focus on three areas: (1) adding smooth slide/fade animations using Svelte's built-in `transition:slide` from `svelte/transition` (zero new dependencies), (2) improving ARIA compliance to fully match the W3C Disclosure Widget pattern, and (3) introducing a CSS-only `grid-template-rows: 0fr/1fr` animation technique as an alternative for cases where Svelte transitions are not feasible. No external component libraries (Bits UI, shadcn-svelte, Melt UI) are needed because the project already has a custom AdvancedSection component with server-persisted state -- adopting a library would mean rebuilding the persistence integration.

## Primary APIs

### 1. Svelte Built-in Transitions (`svelte/transition`)

- **Documentation**: <https://svelte.dev/docs/svelte/svelte-transition>
- **Authentication**: N/A (framework built-in)
- **Key Patterns**:
  - `transition:slide` -- Animates element height from 0 to auto along the y-axis (or x-axis). Ideal for expanding/collapsing content panels.
  - `transition:fade` -- Animates opacity from 0 to current value. Can be combined with slide for polish.
  - `in:slide` / `out:slide` -- Separate enter/exit animations for asymmetric timing (e.g., fast open, slower close).
- **Parameters**: `delay` (ms), `duration` (ms), `easing` (function from `svelte/easing`), `axis` ('x' | 'y').
- **Browser Support**: All modern browsers. The transitions compile to standard CSS/JS; no special browser APIs needed.
- **Confidence**: High -- Official Svelte API, stable across Svelte 5.x, works identically in rune and legacy modes.

**Important caveat**: `transition:slide` requires the content to be conditionally rendered with `{#if}` or `{#each}` blocks. The current AdvancedSection uses `hidden` attribute which does not trigger Svelte transitions. Switching to `{#if isAdvanced}` will enable transitions but means DOM elements are destroyed/recreated on toggle.

### 2. W3C ARIA Disclosure Widget Pattern

- **Documentation**: <https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/>
- **Additional resources**:
  - <https://www.makethingsaccessible.com/guides/accessible-basic-disclosure-widgets/>
  - <https://adrianroselli.com/2020/05/disclosure-widgets.html>
- **Key Requirements**:
  - Trigger element must have `role="button"` (or be a native `<button>`)
  - Trigger must have `aria-expanded="true|false"`
  - Trigger should have `aria-controls="[content-panel-id]"` (optional but recommended)
  - Content panel should use `role="region"` with `aria-labelledby` pointing to the heading
  - Keyboard: Enter and Space must toggle the disclosure
  - Content must immediately follow the trigger in DOM order
- **Current compliance**: The existing AdvancedSection already implements `aria-expanded`, `aria-controls`, `role="region"`, and `aria-labelledby`. Uses a native `<button>`. This is good compliance already.
- **Browser Support**: Universal -- ARIA attributes are supported by all screen readers and browsers.
- **Confidence**: High -- W3C specification, well-established pattern.

### 3. CSS `grid-template-rows: 0fr/1fr` Animation Technique

- **Documentation**:
  - <https://css-tricks.com/css-grid-can-do-auto-height-transitions/>
  - <https://www.stefanjudis.com/snippets/how-to-animate-height-with-css-grid/>
- **Key Pattern**:
  - Parent: `display: grid; grid-template-rows: 0fr; transition: grid-template-rows 300ms ease;`
  - Open state: `grid-template-rows: 1fr;`
  - Child: `overflow: hidden;` (required to clip content at 0fr)
- **Benefits**: Pure CSS, no JS framework dependency, works with `hidden` attribute approach.
- **Caveats**:
  - Zero-height content is still accessible to screen readers (needs `aria-hidden` management).
  - Layout-triggering animation (may cause jank with many sections).
  - Browser support: Chrome 107+, Firefox 66+, Safari 16.4+ for animating `grid-template-rows`.
- **Browser Support**: ~95% of browsers as of March 2026.
- **Confidence**: High -- Well-documented CSS technique, broad browser support.

### 4. Tailwind CSS v4 Transition Utilities

- **Documentation**:
  - `transition-behavior`: <https://tailwindcss.com/docs/transition-behavior>
  - `transition-property`: <https://tailwindcss.com/docs/transition-property>
  - Animation: <https://tailwindcss.com/docs/animation>
- **Key Utilities**:
  - `transition-all` / `transition-property` -- Standard transition utilities.
  - `transition-discrete` -- Enables transitions on discrete properties (`display`, `visibility`). Allows fade-out before `display: none` kicks in.
  - `starting:` variant -- Defines initial styles for entry animations using `@starting-style`. Enables CSS-only entrance animations without JS class toggling.
  - `duration-*`, `ease-*`, `delay-*` -- Timing control.
- **Example** (fade in from hidden):

  ```html
  <div
    class="opacity-100 transition-all transition-discrete duration-300 starting:opacity-0"
  >
    Content fades in on mount
  </div>
  ```

- **Browser Support**: `transition-discrete` requires CSS Transitions Level 2 (~89% support). `@starting-style` has ~80% support (Chrome 117+, Firefox 129+, Safari 17.5+).
- **Confidence**: Medium -- `transition-discrete` is well-supported, but `@starting-style` is still maturing in Safari.

### 5. HTML `<details>` / `<summary>` with `::details-content`

- **Documentation**:
  - <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details>
  - <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::details-content>
  - <https://developer.chrome.com/blog/styling-details>
- **Key Pattern**:

  ```css
  details::details-content {
    opacity: 0;
    block-size: 0;
    overflow: clip;
    transition:
      opacity 600ms,
      block-size 600ms,
      content-visibility 600ms allow-discrete;
  }
  details[open]::details-content {
    opacity: 1;
    block-size: auto;
    interpolate-size: allow-keywords;
  }
  ```

- **Benefits**: Native browser disclosure widget, no JS needed, inherently accessible, browser search works inside closed sections.
- **Exclusive accordion**: Using the `name` attribute on multiple `<details>` elements forces only one to be open at a time (Chrome 120+, Firefox 130+, Safari 17.2+).
- **Caveats**:
  - `::details-content` is newly baseline (September 2025); older browsers won't animate but content still works.
  - `interpolate-size: allow-keywords` is Chromium-only (~71% support). Progressive enhancement: unsupported browsers get instant open/close.
  - Styling `<summary>` markers requires vendor-specific pseudo-elements.
- **Browser Support**: `<details>`/`<summary>` is universal. `::details-content` baseline since September 2025. `interpolate-size` is Chromium-only.
- **Confidence**: Medium -- The base elements are universally supported, but smooth animations require recent browsers and degrade gracefully.

### 6. `hidden="until-found"` Attribute

- **Documentation**:
  - <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden>
  - <https://developer.chrome.com/docs/css-ui/hidden-until-found>
- **Key Pattern**: Setting `hidden="until-found"` on a collapsed content panel allows the browser's "Find in Page" (Ctrl+F) to discover and auto-expand the content.
- **Benefits**: Users can search for content inside collapsed sections without manually expanding each one.
- **Event**: `beforematch` event fires on the element before it becomes visible, allowing state synchronization.
- **Browser Support**: Chrome, Firefox, and Safari Technology Preview (expected in Safari stable in 2026). Can I Use: ~85%.
- **Confidence**: Medium -- Supported in Chromium and Firefox; Safari support is imminent but not yet stable.

## Libraries and SDKs

### Evaluated Libraries (Not Recommended for This Project)

The following libraries were evaluated and determined to be unnecessary given the project's existing architecture:

#### Bits UI

- **Docs**: <https://bits-ui.com/docs/components/collapsible>
- **What it offers**: Headless `Collapsible.Root` / `Collapsible.Trigger` / `Collapsible.Content` compound components with full ARIA support, Svelte 5 runes integration, CSS variables (`--bits-collapsible-content-height`), and `forceMount` for Svelte transition compatibility.
- **Why not recommended**: The project already has `AdvancedSection` with server-synced preference persistence via `userInterfacePreferencesStore`. Adopting Bits UI would require rebuilding the persistence wiring. The ARIA attributes Bits UI provides are already implemented in the existing component.
- **Confidence**: High -- Well-maintained, Svelte 5 native, but adds unnecessary dependency.

#### shadcn-svelte

- **Docs**: <https://www.shadcn-svelte.com/docs/components/collapsible>
- **What it offers**: Copy-paste Collapsible and Accordion components built on Bits UI. Install: `npx shadcn-svelte@latest add collapsible`.
- **Why not recommended**: Same reasoning as Bits UI (it is a wrapper around Bits UI). Also introduces a CLI-driven code generation workflow that doesn't align with the project's manual component structure.
- **Confidence**: High -- Excellent library, but introduces unnecessary complexity for this use case.

#### Melt UI

- **Docs**: <https://melt-ui.com/docs>
- **What it offers**: Headless builder pattern (`createCollapsible`) with `use:melt` directive attachment. Full WAI-ARIA compliance.
- **Why not recommended**: Uses a builder pattern (`use:melt`) that differs from the project's component-prop pattern. Would require significant refactoring of existing AdvancedSection consumers. Also, Melt UI's Svelte 5 support status is less clear than Bits UI.
- **Confidence**: Medium -- Good library but uncertain Svelte 5 rune support maturity.

#### tw-animate-css

- **Docs**: <https://github.com/Wombosvideo/tw-animate-css>
- **What it offers**: Tailwind CSS v4 compatible animation utilities including `accordion-down`, `accordion-up`, `collapsible-down`, `collapsible-up`. Install: `npm install -D tw-animate-css`. Import: `@import "tw-animate-css";` in app.css.
- **Why not recommended as primary**: These animations depend on CSS variables like `--radix-accordion-content-height` that are set by Radix/Bits UI components. Without those components, the variables aren't populated. However, the library could be used if CSS variables are set manually or via Svelte's `style:` directive.
- **Potential use**: If the project later adopts Bits UI or needs keyframe-based accordion animations, this is the correct Tailwind v4 plugin.
- **Confidence**: Medium -- Works well with Bits UI ecosystem, less useful standalone.

#### svelte-persisted-store

- **Docs**: <https://github.com/joshnuss/svelte-persisted-store>
- **Install**: `npm i svelte-persisted-store`
- **Why not recommended**: The project already has a superior server-synced persistence mechanism (`userInterfacePreferencesStore` that persists to SQLite via `/api/v1/ui-preferences`). A localStorage-only solution would be a downgrade. Svelte 5 compatibility is also uncertain (open discussion: <https://github.com/joshnuss/svelte-persisted-store/discussions/251>).
- **Confidence**: High -- Not needed; existing solution is better.

### Recommended: Zero New Dependencies

The recommended approach uses only:

1. `svelte/transition` (built-in) -- For slide/fade animations.
2. `svelte/easing` (built-in) -- For custom easing curves.
3. Tailwind CSS v4 utilities (already installed) -- For supplementary transitions.
4. Native HTML/ARIA attributes (browser built-in) -- For accessibility.

## Integration Patterns

### Recommended Approach: Enhanced AdvancedSection with Svelte Transitions

The primary integration pattern enhances the existing `AdvancedSection.svelte` component with smooth animations while preserving the server-synced preference persistence.

**Architecture decision**: Replace the `hidden` attribute approach with Svelte's `{#if}` conditional rendering to enable `transition:slide`. This means content DOM nodes are created/destroyed on toggle rather than hidden, which has both benefits (no hidden-but-focusable content, reduced DOM size) and tradeoffs (re-renders on toggle, potential loss of form state in collapsed sections).

```
Component Hierarchy:
  AdvancedSection (enhanced)
    |-- Header bar with toggle button (always rendered)
    |-- {#if isAdvanced} content panel with transition:slide
    |-- Wired to userInterfacePreferencesStore (unchanged)
```

**Verbosity reduction**: The current consumer pattern requires ~30 lines of boilerplate per section (store creation, subscription, synced variable, reactive statement, onDestroy cleanup). This should be reduced by creating a helper action or utility that encapsulates the subscription lifecycle.

### State Persistence (Already Solved)

The project has a mature persistence mechanism:

- **Client store**: `userInterfacePreferencesStore` in `$stores/userInterfacePreferences.ts`
- **Server API**: `PATCH /api/v1/ui-preferences` with debounced writes (300ms)
- **Features**: Retry logic (3 attempts with exponential backoff), auth-required detection, refcounting, hydration from server on mount, cross-tab sync not yet implemented (potential enhancement via `BroadcastChannel`).
- **Section key format**: `category:page:section` (e.g., `media-management:media-settings:naming`)
- **No changes needed**: The persistence layer is production-ready and does not need modification for the enhancement.

### Animation Patterns

#### Option A: Svelte `transition:slide` (Recommended)

Replace `hidden={!isAdvanced}` with `{#if isAdvanced}` and apply `transition:slide`:

```svelte
{#if isAdvanced}
  <div
    id={advancedPanelId}
    role="region"
    aria-labelledby={advancedHeadingId}
    class="px-4 pb-4 pt-3"
    transition:slide={{ duration: 200, easing: quintOut }}
  >
    <slot name="advanced" />
  </div>
{/if}
```

**Pros**:

- Zero dependencies, built into Svelte.
- Smooth height animation from 0 to content height.
- Content removed from DOM when collapsed (cleaner, no hidden-but-focusable elements).
- Works in all browsers.

**Cons**:

- DOM elements destroyed on collapse -- form inputs inside lose state unless managed externally.
- Triggers Svelte component lifecycle on each toggle (mount/destroy).
- `min-height` on child elements breaks `transition:slide` (known issue: <https://github.com/sveltejs/svelte/issues/8533>).

#### Option B: CSS `grid-template-rows` (Alternative for DOM-persistent content)

Keep content in DOM but animate visibility using CSS Grid:

```svelte
<div
  class="grid transition-[grid-template-rows] duration-200 ease-out"
  class:grid-rows-[0fr]={!isAdvanced}
  class:grid-rows-[1fr]={isAdvanced}
  aria-hidden={!isAdvanced}
>
  <div class="overflow-hidden">
    <div
      id={advancedPanelId}
      role="region"
      aria-labelledby={advancedHeadingId}
      class="px-4 pb-4 pt-3"
    >
      <slot name="advanced" />
    </div>
  </div>
</div>
```

**Pros**:

- Content stays in DOM (preserves form state).
- Pure CSS animation, no JS framework dependency.
- Smooth height transition without hardcoded values.

**Cons**:

- Collapsed content still in DOM -- must manage `aria-hidden` and `tabindex="-1"` on focusable children to prevent keyboard trapping.
- `grid-template-rows` animation triggers layout recalculation (performance concern with many sections).
- Requires `overflow: hidden` wrapper which can clip shadows/outlines.

#### Option C: Native `<details>` / `<summary>` (For simpler disclosures)

For non-form disclosure sections (info panels, FAQs, documentation), use native HTML with CSS animations:

```svelte
<details bind:open={isAdvanced}>
  <summary class="cursor-pointer text-sm font-semibold">
    {sectionTitle}
  </summary>
  <div class="pt-3">
    <slot name="advanced" />
  </div>
</details>

<style>
  details::details-content {
    opacity: 0;
    block-size: 0;
    overflow: clip;
    transition:
      opacity 200ms ease,
      block-size 200ms ease,
      content-visibility 200ms allow-discrete;
  }
  details[open]::details-content {
    opacity: 1;
    block-size: auto;
    interpolate-size: allow-keywords;
  }
</style>
```

**Pros**:

- Native browser accessibility (no ARIA needed).
- Works without JavaScript (progressive enhancement).
- Browser "Find in Page" works inside closed sections.
- `name` attribute enables exclusive accordion behavior.

**Cons**:

- Limited styling control over `<summary>` marker.
- `interpolate-size` for smooth height animation is Chromium-only (~71%).
- `::details-content` is newly baseline (September 2025).
- Integrating with the server-synced preference store requires `bind:open` plus manual sync logic.

### Recommended Hybrid Approach

Use **Option A** (`transition:slide`) as the primary pattern for the `AdvancedSection` component (form-related disclosures where server-synced state matters), and consider **Option C** (`<details>`) for future read-only disclosures (documentation panels, informational accordions) where persistence is not needed.

## Constraints and Gotchas

### 1. Svelte 5 Without Runes

- **Impact**: The CLAUDE.md specifies "Svelte 5, no runes" -- components use `export let`, `$:` reactive statements, `on:click` event handlers, and `svelte/store` subscriptions.
- **Workaround**: All recommended patterns work in legacy mode. `transition:slide` does not require runes. Store subscriptions use `$store` auto-subscription or manual `.subscribe()` + `onDestroy`.
- **Library compatibility**: Bits UI's latest versions use `$state` and `$bindable` internally but expose a component API that works with non-rune consumers. However, adopting it is still not recommended due to integration overhead.
- **Confidence**: High -- Verified that `svelte/transition` and all recommended patterns are rune-agnostic.

### 2. Consumer Boilerplate Verbosity

- **Impact**: Each AdvancedSection currently requires ~30 lines of subscription/sync boilerplate in the parent component (see `MediaSettingsForm.svelte` lines 41-101 and `GeneralForm.svelte` lines 51-124). This will worsen as more sections are added.
- **Workaround**: Create a `useAdvancedSectionMode(sectionKey: string)` utility function that returns `{ mode, cleanup }` and handles all subscription/sync logic internally. Consumers would call it in `<script>` and pass to AdvancedSection. Example:

  ```typescript
  // In a utility module
  export function useAdvancedSectionMode(
    sectionKey: string,
    defaultMode: UiPreferenceMode = 'basic'
  ) {
    const section = getUserInterfacePreferenceSectionStore(
      sectionKey,
      defaultMode
    );
    let currentMode: UiPreferenceMode = defaultMode;
    let syncedMode: UiPreferenceMode = defaultMode;
    const unsubscribe = section.mode.subscribe((m) => {
      syncedMode = m;
      if (currentMode !== m) currentMode = m;
    });
    return {
      get mode() {
        return currentMode;
      },
      set mode(m: UiPreferenceMode) {
        if (m !== syncedMode) {
          syncedMode = m;
          section.mode.set(m);
        }
        currentMode = m;
      },
      cleanup() {
        unsubscribe();
        section.cleanup();
      },
    };
  }
  ```

- **Confidence**: High -- Direct refactoring of existing pattern, no new APIs needed.

### 3. `transition:slide` and `min-height`

- **Impact**: If any child element inside the collapsible panel has `min-height` set (via CSS or Tailwind), `transition:slide` will stop at that minimum height instead of animating to zero.
- **Workaround**: Ensure no `min-h-*` Tailwind classes or CSS `min-height` declarations exist on elements inside the transition boundary.
- **Reference**: <https://github.com/sveltejs/svelte/issues/8533>
- **Confidence**: High -- Known Svelte issue, well-documented.

### 4. Form State Loss on `{#if}` Toggle

- **Impact**: When using `{#if isAdvanced}` with `transition:slide`, the content DOM is destroyed on collapse. Any unsaved form input values inside the panel will be lost.
- **Workaround**: The project already uses a centralized dirty-tracking store (`$lib/client/stores/dirty`) that holds form values externally. As long as form inputs bind to the dirty store (not local component state), values persist across toggle cycles.
- **Confidence**: High -- The existing dirty store pattern already handles this correctly.

### 5. Many Simultaneous Sections

- **Impact**: Pages with 5+ collapsible sections could see:
  - Multiple simultaneous `transition:slide` animations causing frame drops.
  - Multiple hydration requests on page load (one per section store).
- **Workaround**:
  - Stagger animations with `delay` parameter if multiple sections toggle at once.
  - Batch hydration requests: modify `hydrateSection` to support batch fetching (`GET /api/v1/ui-preferences?section_keys=a,b,c`).
  - Use `will-change: height` on animating containers (sparingly, to hint GPU acceleration).
- **Confidence**: Medium -- Performance impact depends on actual section count per page. Batch hydration is an optimization, not a requirement.

### 6. `prefers-reduced-motion` Accessibility

- **Impact**: Users who prefer reduced motion should see instant show/hide without animation.
- **Workaround**: Svelte's `transition:slide` does not automatically respect `prefers-reduced-motion`. Use a custom wrapper:

  ```svelte
  <script>
    import { slide } from 'svelte/transition';

    const reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    function accessibleSlide(node, params) {
      if (reducedMotion) return { duration: 0 };
      return slide(node, params);
    }
  </script>
  ```

- **Note**: The existing `app.css` already has `@media (prefers-reduced-motion: no-preference)` blocks for theme transitions, so the project is motion-aware.
- **Confidence**: High -- Standard accessibility pattern, straightforward implementation.

### 7. Server-Side Rendering (SSR) Considerations

- **Impact**: On SSR, all sections render in their default state (`basic` = collapsed). After hydration, sections that the user previously set to `advanced` will flash open. This is a layout shift.
- **Workaround**: The existing pattern in `GeneralForm.svelte` uses `$page.data.customFormatSectionModes` from the server load function to SSR the correct initial state. This pattern should be replicated for all new AdvancedSection consumers.
- **Confidence**: High -- Pattern already established in the codebase.

## Design System Best Practices

### Nielsen Norman Group Guidelines (<https://www.nngroup.com/articles/progressive-disclosure/>)

- **Two-level max**: Designs beyond two disclosure levels have low usability. The project uses a single level (basic -> advanced) which is correct.
- **Feature split**: Use task analysis and frequency-of-use data to determine what goes in basic vs. advanced. For Praxrr, the "basic" view should show the fields most users configure (name, core settings), and "advanced" should hold power-user options (conditions, scoring, import rules).
- **Clear triggers**: The toggle button must clearly communicate that more options exist. Current "Show Advanced" / "Hide Advanced" labels are clear.
- **Confidence**: High -- Established UX research from authoritative source.

### GitLab Pajamas Design System (<https://design.gitlab.com/patterns/progressive-disclosure/>)

- **Limit nesting**: Three or more nested disclosure layers indicate overly complex design.
- **Clear triggers**: Use established CTAs (links, buttons) that set expectations.
- **Implementation patterns**: Accordion components, dropdown menus, skeleton loaders, step-by-step workflows.
- **Confidence**: High -- Production design system used at scale.

### GitHub Primer Design System (<https://primer.style/ui-patterns/progressive-disclosure/>)

- **Pair icons with text**: Progressive disclosure triggers should combine icons (chevrons) with descriptive text.
- **Chevron convention**: Down chevron = collapsed, up chevron = expanded.
- **Maintain context**: Avoid interactions that drastically disorient the user's focus.
- **Text-only toggles discouraged**: Icon + text combinations provide better accessibility.
- **Confidence**: High -- Production design system used at scale.

### Apple Human Interface Guidelines

- **Disclosure controls**: Reveal and hide information related to specific controls.
- **Progressive enhancement**: Content should be accessible even without JS.
- **Documentation**: <https://developer.apple.com/design/human-interface-guidelines/disclosure-controls>
- **Confidence**: Medium -- Documentation requires JS rendering, content extracted from secondary sources.

## Code Examples

### Enhanced AdvancedSection with `transition:slide`

```svelte
<script lang="ts" context="module">
  let autoSectionCounter = 0;

  function nextAutoSectionId() {
    autoSectionCounter += 1;
    return `advanced-section-${autoSectionCounter}`;
  }
</script>

<script lang="ts">
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ChevronDown } from 'lucide-svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';

  export let sectionId: string = '';
  export let sectionTitle = 'Advanced settings';
  export let sectionHint = 'These options are hidden by default and are optional.';
  export let showAdvancedLabel = 'Show Advanced';
  export let hideAdvancedLabel = 'Hide Advanced';
  export let mode: 'basic' | 'advanced' = 'basic';

  const fallbackSectionId = nextAutoSectionId();

  // Check reduced motion preference
  const reducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const slideDuration = reducedMotion ? 0 : 200;

  $: resolvedSectionId = sectionId ? sectionId : fallbackSectionId;
  $: advancedPanelId = `${resolvedSectionId}-panel`;
  $: advancedHeadingId = `${resolvedSectionId}-heading`;
  $: isAdvanced = mode === 'advanced';
  $: toggleLabel = isAdvanced ? hideAdvancedLabel : showAdvancedLabel;

  function toggleMode() {
    mode = isAdvanced ? 'basic' : 'advanced';
  }
</script>

<div class="space-y-3">
  <div
    class="rounded-xl border border-neutral-300 bg-white px-4 py-4
      dark:border-neutral-700/60 dark:bg-neutral-900"
  >
    <slot />
  </div>

  <div
    class="overflow-hidden rounded-xl border border-neutral-300 bg-neutral-50
      dark:border-neutral-700/60 dark:bg-neutral-900/50"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b
        border-neutral-200 bg-white px-4 py-2.5
        dark:border-neutral-700/60 dark:bg-neutral-950/40"
    >
      <div class="min-w-0">
        <p
          id={advancedHeadingId}
          class="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {sectionTitle}
        </p>
        {#if sectionHint}
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {sectionHint}
          </p>
        {/if}
      </div>
      <ActionsBar className="w-auto">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border
            border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium
            text-neutral-700 transition-colors hover:bg-neutral-100
            dark:border-neutral-700/60 dark:bg-neutral-800
            dark:text-neutral-200 dark:hover:bg-neutral-700"
          aria-expanded={isAdvanced}
          aria-controls={advancedPanelId}
          aria-label={toggleLabel}
          onclick={toggleMode}
        >
          <ChevronDown
            class="h-3.5 w-3.5 transition-transform duration-200
              {isAdvanced ? 'rotate-180' : ''}"
          />
          {toggleLabel}
        </button>
      </ActionsBar>
    </div>

    {#if isAdvanced}
      <div
        id={advancedPanelId}
        role="region"
        aria-labelledby={advancedHeadingId}
        class="px-4 pb-4 pt-3"
        transition:slide={{ duration: slideDuration, easing: quintOut }}
      >
        <slot name="advanced">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            No advanced options available for this section.
          </p>
        </slot>
      </div>
    {/if}
  </div>
</div>
```

### CSS Grid Alternative (No DOM Destruction)

```svelte
<div
  class="grid transition-[grid-template-rows] duration-200 ease-out
    {isAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}"
>
  <div
    class="overflow-hidden"
    aria-hidden={!isAdvanced}
  >
    <div
      id={advancedPanelId}
      role="region"
      aria-labelledby={advancedHeadingId}
      class="px-4 pb-4 pt-3"
      tabindex={isAdvanced ? undefined : -1}
      inert={!isAdvanced ? true : undefined}
    >
      <slot name="advanced" />
    </div>
  </div>
</div>
```

### Reduced Boilerplate Consumer Pattern

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import AdvancedSection from '$ui/form/AdvancedSection.svelte';
  import {
    getUserInterfacePreferenceSectionStore,
    type UiPreferenceMode,
  } from '$stores/userInterfacePreferences.ts';

  // Helper to reduce per-section boilerplate
  function useSectionMode(key: string) {
    const section = getUserInterfacePreferenceSectionStore(key);
    let mode: UiPreferenceMode = 'basic';
    let synced: UiPreferenceMode = 'basic';
    const unsub = section.mode.subscribe((m) => {
      synced = m;
      if (mode !== m) mode = m;
    });
    return {
      get mode() { return mode; },
      set mode(m: UiPreferenceMode) {
        if (m !== synced) { synced = m; section.mode.set(m); }
        mode = m;
      },
      cleanup() { unsub(); section.cleanup(); },
    };
  }

  const naming = useSectionMode('media-management:media-settings:naming');
  const folders = useSectionMode('media-management:media-settings:folder-management');
  const importing = useSectionMode('media-management:media-settings:importing');

  onDestroy(() => {
    naming.cleanup();
    folders.cleanup();
    importing.cleanup();
  });
</script>

<AdvancedSection
  sectionId="media-management:media-settings:naming"
  sectionTitle="Naming"
  sectionHint="Rename token controls and naming strategy options."
  bind:mode={naming.mode}
>
  <div slot="advanced">
    <!-- content -->
  </div>
</AdvancedSection>
```

## Open Questions

1. **DOM destruction vs. persistence**: Should `AdvancedSection` use `{#if}` (destroys DOM, enables `transition:slide`) or CSS grid (keeps DOM, uses CSS animation)? The `{#if}` approach is simpler and the dirty store handles form state, but CSS grid avoids lifecycle overhead. **Recommendation**: Use `{#if}` + `transition:slide` as the default; offer a `keepMounted` prop for cases where DOM persistence is needed.

2. **Batch hydration API**: Should a batch endpoint (`GET /api/v1/ui-preferences?section_keys=a,b,c`) be added to reduce hydration waterfall on pages with many sections? **Recommendation**: Yes, add if any page has 4+ sections.

3. **Chevron icon**: The GitHub Primer design system recommends pairing icons with text for disclosure triggers. Should a chevron icon (rotating on toggle) be added to the AdvancedSection button? **Recommendation**: Yes, add a `ChevronDown` from `lucide-svelte` with a `rotate-180` transform when expanded.

4. **`on:click` vs `onclick`**: The CLAUDE.md says "Svelte 5, use `onclick` handlers" but the existing `AdvancedSection.svelte` and consumer components use `on:click`. Should the enhancement migrate to `onclick`? **Recommendation**: Yes, align with Svelte 5 event attribute syntax during this enhancement.

5. **Cross-tab sync**: Should disclosure state sync across browser tabs via `BroadcastChannel`? **Recommendation**: Not in this phase; the server-synced store handles multi-session persistence. Cross-tab sync is a nice-to-have for a future iteration.

6. **Where to apply progressive disclosure next**: Beyond the existing custom-formats and media-settings pages, which pages would benefit most from progressive disclosure? Candidates include: quality profiles (quality items, upgrades section), settings pages (notification config, instance config), and database management (advanced sync options). **Recommendation**: Identify candidates via usage patterns and user feedback.

## Search Queries Executed

1. `Svelte 5 progressive disclosure component pattern 2025 2026`
2. `Tailwind CSS v4 transition animation utilities show hide 2025`
3. `WAI-ARIA disclosure widget pattern accessible progressive disclosure`
4. `Svelte 5 component libraries accordion collapsible 2025 2026`
5. `Melt UI Svelte 5 headless components disclosure collapsible`
6. `HTML details summary element progressive disclosure CSS animation 2025`
7. `Material Design progressive disclosure best practices design system`
8. `localStorage persist UI state disclosure sections Svelte store pattern`
9. `CSS interpolate-size auto height animation browser support 2025 2026`
10. `Svelte 5 without runes legacy mode onclick handlers component patterns`
11. `shadcn-svelte collapsible component Svelte 5 installation usage`
12. `Bits UI Svelte 5 collapsible component API headless`
13. `svelte-persisted-store Svelte 5 compatibility npm install usage`
14. `Tailwind CSS v4 @starting-style variant entry animation CSS only`
15. `progressive disclosure performance many collapsible sections DOM virtual scroll lazy render`
16. `Svelte 5 slide transition svelte/transition animate height collapsible`
17. `CSS grid-template-rows 0fr 1fr animate height collapse expand pattern`
18. `Apple Human Interface Guidelines progressive disclosure expandable sections design pattern`
19. `Atlassian Design System progressive disclosure expandable section pattern`
20. `tw-animate-css Tailwind v4 animation plugin install collapsible accordion`
21. `Svelte transition slide if block conditional rendering expand collapse animation best practice`
22. `HTML hidden="until-found" attribute browser support accessible collapsible find in page`
23. `Svelte 5 writable store subscribe no runes pattern legacy component state management`

## Uncertainties and Gaps

- **Svelte 5 legacy mode + `transition:slide` interaction**: While `transition:slide` is documented to work in Svelte 5, no specific testing was found confirming behavior with `<svelte:options runes={false}>` or implicit legacy mode. The risk is low (transitions are framework-level, not rune-dependent), but should be verified with a prototype.
- **`inert` attribute browser support**: The `inert` attribute (used in the CSS grid approach to prevent keyboard access to collapsed content) has broad support (Chrome 102+, Firefox 112+, Safari 15.5+) but older browser users may still be able to tab into collapsed sections.
- **Performance with many sections**: No quantitative data was found on the rendering cost of multiple simultaneous `transition:slide` animations vs. CSS `grid-template-rows` transitions in Svelte. Empirical testing with 10+ sections on a single page is recommended.
- **Server-side section mode loading**: The batch hydration API (`GET /api/v1/ui-preferences?section_keys=...`) does not exist yet. The impact of per-section hydration waterfall needs measurement.

## Sources

- [Svelte Transition Docs](https://svelte.dev/docs/svelte/svelte-transition)
- [Svelte Transition Directive Docs](https://svelte.dev/docs/svelte/transition)
- [W3C ARIA Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [Accessible Basic Disclosure Widgets](https://www.makethingsaccessible.com/guides/accessible-basic-disclosure-widgets/)
- [Adrian Roselli: Disclosure Widgets](https://adrianroselli.com/2020/05/disclosure-widgets.html)
- [Tailwind CSS v4 transition-behavior](https://tailwindcss.com/docs/transition-behavior)
- [Tailwind CSS v4 Animation](https://tailwindcss.com/docs/animation)
- [Tailwind CSS v4 @starting-style Discussion](https://github.com/tailwindlabs/tailwindcss/discussions/12039)
- [Bits UI Accordion](https://bits-ui.com/docs/components/accordion)
- [Bits UI Collapsible](https://bits-ui.com/docs/components/collapsible)
- [shadcn-svelte Collapsible](https://www.shadcn-svelte.com/docs/components/collapsible)
- [Melt UI](https://melt-ui.com/docs)
- [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)
- [CSS Grid Height Animation (CSS-Tricks)](https://css-tricks.com/css-grid-can-do-auto-height-transitions/)
- [CSS Grid Height Animation (Stefan Judis)](https://www.stefanjudis.com/snippets/how-to-animate-height-with-css-grid/)
- [::details-content (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::details-content)
- [Chrome: Styling details](https://developer.chrome.com/blog/styling-details)
- [details Element (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)
- [CSS interpolate-size (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/interpolate-size)
- [Chrome: Animate to height auto](https://developer.chrome.com/docs/css-ui/animate-to-height-auto)
- [Josh Comeau: interpolate-size snippet](https://www.joshwcomeau.com/snippets/html/interpolate-size/)
- [hidden="until-found" (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden)
- [Chrome: hidden=until-found](https://developer.chrome.com/docs/css-ui/hidden-until-found)
- [NNGroup: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [GitLab Pajamas: Progressive Disclosure](https://design.gitlab.com/patterns/progressive-disclosure/)
- [GitHub Primer: Progressive Disclosure](https://primer.style/ui-patterns/progressive-disclosure/)
- [Apple HIG: Disclosure Controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
- [svelte-persisted-store](https://github.com/joshnuss/svelte-persisted-store)
- [Svelte slide transition issue #8533](https://github.com/sveltejs/svelte/issues/8533)
- [Svelte 5 Migration Guide](https://svelte.dev/docs/svelte/v5-migration-guide)
- [Svelte Stores Docs](https://svelte.dev/docs/svelte/stores)
- [Tailwind CSS v4 hidden issue #15884](https://github.com/tailwindlabs/tailwindcss/issues/15884)
- [Tailwind CSS v4 hidden + transition discussion #18394](https://github.com/tailwindlabs/tailwindcss/discussions/18394)
