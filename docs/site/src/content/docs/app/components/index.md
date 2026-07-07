---
title: Component Library
description: Catalog of the reusable Svelte 5 UI components, stores, and patterns in the Praxrr app client, grouped by category with props and usage.
---

This is the reference for the reusable UI components that make up the Praxrr
application client. Every component lives under
`packages/praxrr-app/src/lib/client/ui/` (imported via the `$ui/` alias), with
client stores under `$stores/` and the alert system under
`$lib/client/alerts/`. The catalog below covers **75 components, stores, and
helper modules** across 12 category pages.

## Conventions

- **Svelte 5, no runes.** Components use `export let` props and `onclick`
  handlers rather than `$state`/`$derived` runes.
- **Import via aliases.** Use `$ui/…` for components, `$stores/…` for stores,
  and `$lib/client/alerts/…` for the alert system.
- **User feedback** flows through the alert store: `alertStore.add(type,
message)`. See [Store Patterns](/app/components/patterns/).
- **Dirty tracking** blocks saves and warns on navigation via the dirty store.
  See [Store Patterns](/app/components/patterns/).
- **Live demos** on the Buttons, Forms, and Badges pages are self-contained
  Astro islands that reproduce the component look without the app runtime.

## Catalog

### [Buttons & Actions](/app/components/buttons/)

| Component            | Description                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`             | Multi-variant button (primary/secondary/danger/ghost) with optional icon, responsive sizing, tooltip, and anchor mode; renders a button or an anchor when href is set, wrapped in a Tooltip.    |
| `ActionButton`       | Bordered 40px icon button sized for action bars, with an optional hover-activated dropdown region and neutral/danger hover variants.                                                            |
| `ActionsBar`         | Layout wrapper that groups action items into a single connected control strip with collapsed inner borders and auto-rounded outer edges, centered/full-width on mobile.                         |
| `ViewToggle`         | Action-bar control that toggles a data page between cards and table view via an ActionButton with a hover dropdown of the two options; bind:value to observe changes.                           |
| `SearchAction`       | Action-bar search input backed by a SearchStore: inline bordered field on desktop, collapsing to a trigger button plus full-screen modal in responsive mobile mode, with an active-query badge. |
| `SourceFilterAction` | Action-bar PCD source filter rendering inline segmented pills for small counts or a labeled dropdown with active-count badge otherwise, supporting single- and multi-select modes.              |

### [Form Inputs](/app/components/forms/)

| Component           | Description                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormInput`         | Labeled text field wrapper supporting text/number/email/password/url/time/date, textarea, auto-resize wrap, password visibility toggle, and a suffix slot. |
| `NumberInput`       | Bare numeric input with custom stepper buttons, min/max/step clamping, partial-input tolerance, and compact/responsive sizing.                             |
| `DateInput`         | Composite YYYY-MM-DD date picker built from three SearchDropdown selects with per-month day clamping and a configurable year range.                        |
| `TimeInput`         | Composite HH:MM (24-hour) time picker built from two SearchDropdown selects with fixed-width fields.                                                       |
| `SearchDropdown`    | Single-select searchable combobox on FormInput with typed filtering, keyboard navigation, clear button, and a custom item slot.                            |
| `MarkdownInput`     | Markdown-aware textarea/input with a formatting toolbar, Ctrl+B/Ctrl+I shortcuts, and a live rendered preview toggle via marked.                           |
| `TagInput`          | Chip-style tag entry: Enter to add, click X or Backspace to remove, with case-insensitive duplicate detection and a throttled alert.                       |
| `IconCheckbox`      | Icon-rendering checkbox button (role=checkbox) with named/hex/CSS-var colors, filled or outline variants, and three shapes.                                |
| `Toggle`            | Card-style switch (role=switch) with optional label and an IconCheckbox indicator; keyboard-activatable and self-toggling.                                 |
| `RangeScale`        | Draggable multi-marker range track with color-coded dots, step snapping, min-separation enforcement, and unit/unlimited/transform formatting.              |
| `KeyValueList`      | Dynamic key-value editor with add/remove rows, text or semantic-version value modes, responsive layout, and an optional locked first entry.                |
| `MaskedApiKey`      | Read-only API key display with reveal/hide and copy controls, auto-hide timeout, aria-live status messaging, and reveal/copy events.                       |
| `CronInput`         | Human-friendly cron builder with a schedule-type selector and contextual controls that two-way sync a 5-field cron string, validated via croner.           |
| `AdvancedSection`   | Presentational disclosure wrapper: always-visible content plus a collapsible advanced slot toggled by a Show/Hide button, with bindable mode.              |
| `DisclosureSection` | Stateful AdvancedSection wrapper that persists basic/advanced mode per section key and integrates with the complexity-tier context.                        |

### [Tables & Lists](/app/components/tables/)

| Component                                   | Description                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Column, SortState & SortDirection (types)` | Shared TypeScript type module defining the column contract and sort state consumed by Table and ExpandableTable, including key-path/accessor/comparator sorting and cell rendering fields.                                          |
| `Table`                                     | Generic Svelte 5 sortable data table with per-column custom cell rendering, click-to-sort headers, row click/href navigation, progressive lazy loading, an actions slot, and an optional responsive mobile card layout.             |
| `ExpandableTable`                           | Sortable data table with expandable detail rows toggled by chevron or row click, per-row expand disabling, configurable chevron position, slot-based cell rendering, and a responsive mobile card layout; requires a stable row id. |
| `ReorderableList`                           | Drag-and-drop reorderable vertical list that renders items via a default slot and emits the reordered array live during dragging, with a sensitivity dead-zone to reduce flicker.                                                   |
| `TableActionButton`                         | Compact square icon-only button for table row actions with neutral/danger/accent hover styling, two sizes, disabled state, and optional click-propagation stopping; dispatches a click event.                                       |

### [Modals & Dialogs](/app/components/modals/)

| Component    | Description                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`      | Base confirm/cancel dialog with header, body slot (falling back to a message), and a two-button footer; handles backdrop, transitions, Escape-to-cancel, size/height presets, and loading/danger states. |
| `InfoModal`  | Read-only informational dialog with an X close button and a default-slot body; self-manages closing and is sized via maxWidth/maxHeight CSS strings.                                                     |
| `CloneModal` | Self-contained dialog for cloning a PCD entity; wraps Modal to prompt for a new name, optionally pick the base/user layer, then export and re-import via the PCD API.                                    |
| `DirtyModal` | Global unsaved-changes guard that renders a store-wired Modal and intercepts SvelteKit navigation via beforeNavigate to prompt before leaving a dirty page.                                              |

### [Dropdowns & Tabs](/app/components/navigation/)

| Component            | Description                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dropdown`           | Positioned floating menu container rendered below a trigger, with absolute or fixed positioning, responsive position switching, and compact spacing.                 |
| `DropdownItem`       | Selectable full-width menu row with optional leading icon, trailing selected check, and danger/disabled/compact states; fires on:click and an onSelect callback.     |
| `DropdownSelect`     | Labeled value picker composing Button + Dropdown + DropdownItem, emitting change with the chosen value and supporting compaction, full-width, and fixed positioning. |
| `CustomGroupManager` | Form section for managing user-defined tag groups (add form plus toggle/delete list) that delegates all mutation to onAdd/onDelete/onToggle callbacks.               |
| `Tabs`               | Responsive tab bar with active underline, optional icons, breadcrumb/back-button trailing region, and mobile collapse to a Dropdown select.                          |

### [Navigation Shell](/app/components/shell/)

| Component          | Description                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Navbar`           | Fixed top navigation bar: mobile hamburger plus centered latest-alert toast, desktop logo/wordmark, always-present AccentPicker and ThemeToggle. Takes no props.                            |
| `ThemeToggle`      | Icon button that toggles light/dark theme via themeStore.toggle() with an animated transition; renders Lucide icons or emoji per the nav icon preference. Takes no props.                   |
| `AccentPicker`     | Swatch button that opens a Dropdown of accent colors and sets the global accentStore, marking the current selection with a Check icon. Takes no props.                                      |
| `BottomNav`        | Mobile-only fixed bottom tab bar that flattens the nav shell's groups, filters by Arr scope, sorts by mobilePriority, and renders icon-plus-short-label links. Single prop: navShell.       |
| `PageNav`          | Primary sidebar shell: scope selector, collapsible groups, scope-disabled annotations, and version footer; mobile overlay drawer, desktop fixed w-80 sidebar. Props: version, navShell.     |
| `Group`            | Collapsible navigation group rendering an optional SectionHeader, a GroupHeader, and a slide-animated list of child items. Props: label, href, icon, initialOpen, hasItems, sectionLabel.   |
| `GroupHeader`      | Header row for a Group: main navigation link with optional icon plus a chevron toggle button when the group has items. Props: label, href, icon, isOpen, hasItems, onToggle, activePattern. |
| `GroupItem`        | Leaf navigation link with active-state highlighting that special-cases the logout route to clear UI preferences before navigating. Props: label, href, activePattern.                       |
| `SectionHeader`    | Presentational uppercase section-divider label with hairline rules above and below, used to separate groups of nav entries. Single required prop: label.                                    |
| `NavScopeSelector` | Labeled select for choosing the active Arr scope; options come from the nav shell's available scopes and selection updates the navScope store. Single prop: navShell.                       |
| `Version`          | Footer card showing the praxrr logo, wordmark, and a platform-channel-version metadata line. Single optional prop: version.                                                                 |

### [Badges & Labels](/app/components/badges/)

| Component           | Description                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Badge`             | Small inline status pill with color variants, two sizes, optional leading icon, and optional monospace font; includes Arr-brand variants (radarr/sonarr/lidarr) driven by CSS custom properties. |
| `SourceBadge`       | Composite badge pairing a source-type Badge (PCD or TRaSH, with auto icon/color) and an optional Arr-app brand Badge.                                                                            |
| `CustomFormatBadge` | Bordered pill showing a custom-format name with a color-coded, sign-prefixed, thousands-separated score.                                                                                         |
| `Score`             | Standalone numeric score display with optional + sign, color coding, two sizes, and an em-dash placeholder for null.                                                                             |
| `Label`             | Flexible label/tag pill with eight variants, three sizes, configurable rounding, optional mono font, and optional anchor link mode via href.                                                     |

### [Cards](/app/components/cards/)

| Component         | Description                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card`            | Structural container with optional header/body/footer slots separated by dividers; supports padding sizes, hoverable/interactive states, an onclick handler, and an href link mode that renders the card as an anchor. Participates in a CardGrid flush context. |
| `CardGrid`        | Responsive CSS Grid container for Card components that scales columns by breakpoint (1 up to a configurable max) and provides a card-flush context that descendant cards inherit for seamless flush styling.                                                     |
| `CollapsibleCard` | Bordered card with a clickable header (title, optional description, chevron) that slide-expands its body, optionally persisting open/closed state across sessions via a section-preference store keyed by sectionKey.                                            |
| `StickyCard`      | Sticky toolbar/heading bar with left and right slots that pins to the top or bottom of its scroll container using an IntersectionObserver sentinel, with default, transparent, and blur background variants.                                                     |

### [Feedback & States](/app/components/feedback/)

| Component                   | Description                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Alert`                     | Type-colored toast card (success/error/warning/info) rendered inside AlertContainer; dismisses on click or Enter/Space with fly-in/fade-out animation.                                                     |
| `AlertContainer`            | Fixed overlay that subscribes to alertStore and renders one Alert per active toast, resolving placement from alertSettingsStore and adapting for auth vs app-shell layouts. Mount once in the root layout. |
| `MobileNavAlert`            | Compact single-line alert variant sized for the mobile navigation bar with truncated text, lighter styling, and fade-only transitions; same dismiss behavior as Alert.                                     |
| `EmptyState`                | Centered full-height placeholder with a circular icon, title, description, and a single anchor-based call-to-action, used when a collection has no items yet.                                              |
| `Tooltip`                   | Hover tooltip wrapping trigger slot content; renders a fixed, viewport-clamped label above or below the trigger and flips on overflow.                                                                     |
| `ComplexityProgressionHint` | Contextual amber banner nudging the user to advance the area's complexity tier after enough advanced-option toggles, offering Switch / Not now actions; driven entirely by the complexity-tier context.    |

### [Display & Formatting](/app/components/display/)

| Component             | Description                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodeBlock (display)` | Minimal escaped preformatted code display ($ui/display/CodeBlock.svelte) with monospace styling, word-wrap, and optional maxLines clamping; no syntax highlighting.                     |
| `Markdown`            | Renders a Markdown string to HTML via marked and {@html} ($ui/display/Markdown.svelte); supports inline or block rendering and optional line clamping, renders nothing when empty.      |
| `CodeBlock (meta)`    | Syntax-highlighted code block ($ui/meta/CodeBlock.svelte) using highlight.js (json/sql + plaintext fallback), bordered panel with optional uppercase label and icon slot.               |
| `JsonView`            | Displays arbitrary data as highlighted JSON ($ui/meta/JsonView.svelte); when the object has a queries array, strips them from JSON and renders each as a separate SQL-highlighted card. |

### [Complexity Tiers](/app/components/complexity/)

| Component                        | Description                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComplexityTierProvider`         | Wraps a UI section and establishes the complexity-tier Svelte context for descendants, instantiating a per-section user tier store keyed by sectionKey and cleaning it up on destroy.             |
| `ComplexityTierSelector`         | Segmented Beginner/Intermediate/Advanced button control plus a Reset-to-beginner button; reads state from context and renders nothing when no ComplexityTierProvider is present.                  |
| `complexityTierContext (module)` | Context helpers and typed contract (ComplexityTierContext interface, set/get functions keyed by a private Symbol) for sharing complexity-tier state, plus a re-exported tierToDefaultMode helper. |

### [Store Patterns & Conventions](/app/components/patterns/)

| Component                                                      | Description                                                                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dirty (form dirty-state store)`                               | Singleton snapshot-based form dirty-tracking store with initEdit/initCreate/update/resetFromServer/clear plus a confirmNavigation guard driving an unsaved-changes modal.              |
| `alertStore`                                                   | Global toast/alert queue; add() enqueues a typed message that auto-dismisses after a resolved duration and returns its id, with remove/clear helpers.                                  |
| `alertSettingsStore`                                           | Persisted preferences for alert position and default auto-dismiss duration, hydrated from validated localStorage with exported ALERT_POSITIONS and DEFAULT_ALERT_SETTINGS.             |
| `themeStore`                                                   | Singleton light/dark theme store initialized from localStorage or prefers-color-scheme, applying the theme class to <html> via View Transitions and persisting on toggle.              |
| `accentStore`                                                  | Singleton accent-color store persisting a chosen accent and writing an 11-shade palette to --accent-50..--accent-950 CSS variables; ships accentColors and the AccentColor union.      |
| `createSearchStore / getPersistentSearchStore`                 | Factory for a per-instance debounced search + filter store with filterItems helper; getPersistentSearchStore returns a localStorage-keyed singleton.                                   |
| `userComplexityTiersStore / getUserComplexityTierSectionStore` | Server-synced per-section UI complexity tier store wrapping a debounced sync engine against /api/v1/complexity-tiers with ref-counted section stores and activity/suggestion tracking. |
