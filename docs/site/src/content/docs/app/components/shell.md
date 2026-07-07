---
title: Navigation Shell
description: App navigation shell — top navbar, mobile bottom nav, and the page-navigation sidebar with groups and scope selector.
---

The navigation shell is the app chrome that frames every page — a fixed top navbar, a mobile-only bottom tab bar, and the page-navigation sidebar with collapsible groups and an Arr scope selector. These are reusable Svelte components under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`). They follow the repo's Svelte convention of plain props and `onclick`/`on:click` handlers rather than runes.

## Navbar

Fixed top navigation bar (app chrome). On mobile it shows a hamburger that opens the mobile nav plus a centered latest-alert toast; on desktop it shows the praxrr logo and wordmark. The right side always renders the `AccentPicker` and `ThemeToggle`.

Import:

```svelte
import Navbar from '$ui/navigation/navbar/navbar.svelte';
```

This component takes no props.

Usage:

```svelte
<script>
  import Navbar from '$ui/navigation/navbar/navbar.svelte';
</script>

<Navbar />
```

Notes:

- The hamburger button calls `mobileNavOpen.open()` (from `$stores/mobileNav`) to open the mobile page nav. There are no callback props.
- Depends on `$stores/mobileNav`, `$alerts/store` (`$alertStore`), `$assets/logo.svg`, and the child components `AccentPicker` and `ThemeToggle`.
- Reactively derives `latestAlert` from the last item in `$alertStore`. Uses Svelte 4 style (`$:` and `on:click`).

Variants:

- Responsive — hamburger plus a centered `MobileNavAlert` on mobile (`<md`); logo plus wordmark on desktop (`md+`).
- Fixed, `z-50` (`md z-80`), full width on mobile and `w-80` on desktop.

## ThemeToggle

Icon button that toggles light/dark theme with an animated cross-fade/rotate transition between two states. It renders Lucide icons (`MoonStar`/`Sun`) or emoji (✨/💡) depending on the nav icon preference.

Import:

```svelte
import ThemeToggle from '$ui/navigation/navbar/themeToggle.svelte';
```

This component takes no props.

Usage:

```svelte
<script>
  import ThemeToggle from '$ui/navigation/navbar/themeToggle.svelte';
</script>

<ThemeToggle />
```

Notes:

- `on:click` calls `themeStore.toggle()` (from `$stores/theme`). There are no callback props.
- Reads `$themeStore` (`isDark = $themeStore === 'dark'`) and `$navIconStore` (`useEmoji = $navIconStore === 'emoji'`). Has `aria-label="Toggle theme"`.

Variants:

- Two icon modes driven by `$navIconStore` — `'emoji'` (✨ dark / 💡 light) versus the default Lucide (`MoonStar` dark / `Sun` light).
- Animated scale/rotate/opacity transition on toggle.

## AccentPicker

Accent color picker — a swatch button that opens a `Dropdown` of available accent colors. Selecting one sets the global accent store; the current selection is marked with a `Check` icon.

Import:

```svelte
import AccentPicker from '$ui/navigation/navbar/accentPicker.svelte';
```

This component takes no props.

Usage:

```svelte
<script>
  import AccentPicker from '$ui/navigation/navbar/accentPicker.svelte';
</script>

<AccentPicker />
```

Notes:

- The trigger button (`on:click|stopPropagation`) toggles `open`. Each color button calls `accentStore.set(accent)` via `select()`. A `svelte:window` `on:click` closes the dropdown when clicking outside `.accent-picker`. There are no callback props.
- Imports `accentStore`, `accentColors`, and the `AccentColor` type from `$stores/accent`; uses `$ui/dropdown/Dropdown.svelte` and `Check` from `lucide-svelte`.
- `currentColor = accentColors.find(c => c.value === $accentStore) ?? accentColors[0]`. Internal state: `open` (boolean) and `triggerEl` (`HTMLElement`, bound and passed to `Dropdown`).

Variants:

- Open and closed states.
- Renders `Dropdown` with `position="middle"`, `minWidth="auto"`, `fixed={true}`, anchored to the trigger element.

## BottomNav

Mobile-only fixed bottom tab bar. It flattens the nav shell's grouped items into a single row, filters by the active Arr scope, sorts by `mobilePriority`, and renders icon-plus-short-label links with active-route highlighting.

Import:

```svelte
import BottomNav from '$ui/navigation/bottomNav/BottomNav.svelte';
```

Props:

| Prop       | Type                    | Default     | Required | Description                                                                                                                                                   |
| ---------- | ----------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navShell` | `NavShell \| undefined` | `undefined` | No       | The resolved navigation shell (from `$shared/navigation/types`). Its `groups[].items` are flattened into bottom-nav entries. When undefined, no items render. |

Usage:

```svelte
<script>
  import BottomNav from '$ui/navigation/bottomNav/BottomNav.svelte';
  export let navShell;
</script>

<BottomNav {navShell} />
```

Notes:

- Items are plain `<a href>` anchors — there are no events or callback props.
- Reads `$navScope` and `$navIconStore` plus `$page.url.pathname`.
- Scope filtering via `isScopedItemVisible` — scope `'all'` or no `requiredFeature` means visible; otherwise `supportsFeature(scope, requiredFeature)`.
- `shortLabelByHref` maps known routes to abbreviated labels (for example `/quality-profiles` → `'Profiles'`).
- Items are sorted by `priorityOrder` (`{ always: 0, medium: 1, low: 2 }`) then original source order. `isActive` is an exact match for `'/'`, otherwise `startsWith(href)`.

Variants:

- `md:hidden` (mobile only).
- Per-item visibility is driven by `mobilePriority` — `'always'` is always shown, `'medium'` is hidden until the `sm` breakpoint, `'low'` is hidden. The active link uses the accent color; icons switch between Lucide (`resolveNavIcon` by `iconKey`) and emoji based on `$navIconStore`.

## PageNav

The primary sidebar navigation shell. It renders the scope selector, collapsible nav groups with items, scope-disabled annotations, and the version footer. It slides in as an overlay on mobile and is a fixed left sidebar on desktop.

Import:

```svelte
import PageNav from '$ui/navigation/pageNav/pageNav.svelte';
```

Props:

| Prop       | Type                    | Default     | Required | Description                                                                                                                                            |
| ---------- | ----------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`  | `string`                | `''`        | No       | App version string forwarded to the `Version` footer component.                                                                                        |
| `navShell` | `NavShell \| undefined` | `undefined` | No       | The resolved navigation shell. Provides `groups` (each with `id`, `label`, `items`) and `arrScopeOptions` consumed by the embedded `NavScopeSelector`. |

Usage:

```svelte
<script>
  import PageNav from '$ui/navigation/pageNav/pageNav.svelte';
  export let navShell;
  export let version;
</script>

<PageNav {navShell} {version} />
```

Notes:

- Composes `Group`, `GroupItem`, `SectionHeader`, `NavScopeSelector`, and `Version`.
- A `svelte:window` `on:keydown` closes the mobile nav on Escape. The mobile backdrop button and close (X) button call `mobileNavOpen.close()`. The mobile nav also closes reactively on route change. There are no callback props.
- Scope filtering (`resolveScopeEntries`) — visible items pass through; unsupported leaf items are hidden; unsupported items with children render as disabled annotation cards.
- `collapsedGroupIds = { settings, dev }` and `collapsedItemIds = { 'policies.media_management' }` start collapsed unless the current route matches.
- Group labels prefix an emoji when `$navIconStore === 'emoji'`. `sectionLabel` is passed only to the first item of each group. Reads `$navScope`, `$navIconStore`, `$mobileNavOpen`, and `$page`.

Variants:

- Mobile — a full-height overlay drawer (`w-90vw`) that translates in/out based on `$mobileNavOpen`, with its own logo-plus-close header; version scrolls with content.
- Desktop (`md+`) — a fixed `w-80` sidebar below the navbar with version pinned to the bottom.
- Groups render either `'visible'` (interactive `Group`) or `'disabled'` (a dashed annotation card explaining scope unavailability).

## Group

A collapsible navigation group — it renders an optional `SectionHeader`, a `GroupHeader` (link plus chevron toggle), and a slide-animated list of child items connected by a vertical guide line.

Import:

```svelte
import Group from '$ui/navigation/pageNav/group.svelte';
```

Props:

| Prop           | Type                         | Default     | Required | Description                                                                                                     |
| -------------- | ---------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `label`        | `string`                     | `—`         | Yes      | Group header label text.                                                                                        |
| `href`         | `string`                     | `—`         | Yes      | Destination href for the group header link.                                                                     |
| `icon`         | `ComponentType \| undefined` | `undefined` | No       | Optional Svelte icon component rendered in the header via `svelte:component`.                                   |
| `initialOpen`  | `boolean`                    | `true`      | No       | Initial and route-driven open state. When true the group is forced open and the chevron toggle is disabled.     |
| `hasItems`     | `boolean`                    | `false`     | No       | Whether the group has child items. Controls chevron rendering and whether the slotted children/guide line show. |
| `sectionLabel` | `string \| undefined`        | `undefined` | No       | Optional section divider label rendered above the group via `SectionHeader`.                                    |

Usage:

```svelte
<Group
  label="Policies"
  href="/quality-profiles"
  icon={someIcon}
  sectionLabel="Configuration"
  initialOpen={true}
  hasItems={true}
>
  <GroupItem label="Quality Profiles" href="/quality-profiles" />
</Group>
```

Notes:

- Default slot — the group's child items (typically `GroupItem` components), rendered only when `isOpen && hasItems`.
- Internal `toggleOpen` (bound to `GroupHeader` `onToggle`) flips `isOpen`, but is a no-op while `isRouteOpen` (`initialOpen`) is true. No callback props are exposed.
- Reactive — `isRouteOpen` mirrors `initialOpen` and forces `isOpen` open when true (closes when false). Composes `GroupHeader` and `SectionHeader`; uses `svelte/transition` `slide`.

Variants:

- Open and closed (slide transition, 200ms). When `initialOpen`/`isRouteOpen` is true the group is locked open.
- Optional leading `SectionHeader`.

## GroupHeader

The header row for a `Group` — a main navigation link (with optional icon) plus a separate chevron toggle button (only when the group has items). It handles active-state styling.

Import:

```svelte
import GroupHeader from '$ui/navigation/pageNav/groupHeader.svelte';
```

Props:

| Prop            | Type                         | Default     | Required | Description                                                                                                                                       |
| --------------- | ---------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`         | `string`                     | `—`         | Yes      | Header link text.                                                                                                                                 |
| `href`          | `string`                     | `—`         | Yes      | Destination href for the main link.                                                                                                               |
| `icon`          | `ComponentType \| undefined` | `undefined` | No       | Optional Svelte icon component rendered before the label via `svelte:component`.                                                                  |
| `isOpen`        | `boolean`                    | `—`         | Yes      | Whether the group is expanded; rotates the chevron and sets its `aria-label` (Collapse/Expand group).                                             |
| `hasItems`      | `boolean`                    | `—`         | Yes      | Whether to render the chevron toggle button and adjust the link's border radius (`rounded-l` vs fully rounded).                                   |
| `onToggle`      | `() => void`                 | `—`         | Yes      | Callback invoked by the chevron button's `onclick` to toggle the group open/closed.                                                               |
| `activePattern` | `string \| undefined`        | `undefined` | No       | Optional active-state matcher: when set, active = `pathname.includes(activePattern)`; otherwise exact match or `pathname.startsWith(href + '/')`. |

Usage:

```svelte
<GroupHeader
  label="Settings"
  href="/settings"
  icon={settingsIcon}
  isOpen={open}
  hasItems={true}
  onToggle={() => (open = !open)}
/>
```

Notes:

- The chevron button uses `onclick={onToggle}` (Svelte 5 style `onclick` attribute). The main link is a plain `<a href>`. `onToggle` is the callback prop.
- `isOpen`, `hasItems`, and `onToggle` are required (no defaults). Reads `$page.url.pathname`. The chevron is an inline SVG (not a Lucide icon).
- Typically rendered by `Group` rather than used directly.

Variants:

- Active versus inactive styling.
- With-items (link `rounded-l` plus chevron `rounded-r`) versus no-items (fully rounded link, no chevron). The chevron rotates 90deg when `isOpen`.

## GroupItem

A leaf navigation link (child of a `Group`) with active-state highlighting. It special-cases the logout route to clear UI preferences before navigating.

Import:

```svelte
import GroupItem from '$ui/navigation/pageNav/groupItem.svelte';
```

Props:

| Prop            | Type                            | Default     | Required | Description                                                                                                                                                                                          |
| --------------- | ------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`         | `string`                        | `—`         | Yes      | Link text.                                                                                                                                                                                           |
| `href`          | `string`                        | `—`         | Yes      | Destination href.                                                                                                                                                                                    |
| `activePattern` | `string \| RegExp \| undefined` | `undefined` | No       | Optional custom active-state matcher. String → `pathname.includes(activePattern)`; RegExp → `activePattern.test(pathname)`. When omitted, active = exact match or `pathname.startsWith(href + '/')`. |

Usage:

```svelte
<GroupItem label="Custom Formats" href="/custom-formats" activePattern="/custom-formats" />
```

Notes:

- `on:click` `handleClick` — for `href === '/auth/logout'` it calls `preventDefault`, then `userInterfacePreferencesStore.clearOnAuthChange()`, then `goto(href)`. There are no callback props.
- Reads `$page.url.pathname` for active detection. Imports `goto` from `$app/navigation` and `userInterfacePreferencesStore` from `$stores/userInterfacePreferences`.

Variants:

- Active versus inactive (background plus text color highlight).

## SectionHeader

A small uppercase section-divider label with hairline rules above and below it, used to separate groups of navigation entries.

Import:

```svelte
import SectionHeader from '$ui/navigation/pageNav/sectionHeader.svelte';
```

Props:

| Prop    | Type     | Default | Required | Description                                                 |
| ------- | -------- | ------- | -------- | ----------------------------------------------------------- |
| `label` | `string` | `—`     | Yes      | Section label text (rendered uppercase, tracked, semibold). |

Usage:

```svelte
<SectionHeader label="Configuration" />
```

Notes:

- Presentational only; single required prop.
- Used by `Group` (`sectionLabel`) and by `pageNav`'s disabled-item annotation branch.

## NavScopeSelector

A labeled `<select>` that lets the user choose the active Arr scope ("Apps Scope"). Options are the ARR condition targets filtered to those the nav shell declares available; selection updates the `navScope` store.

Import:

```svelte
import NavScopeSelector from '$ui/navigation/pageNav/navScopeSelector.svelte';
```

Props:

| Prop       | Type                    | Default     | Required | Description                                                                                         |
| ---------- | ----------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------- |
| `navShell` | `NavShell \| undefined` | `undefined` | No       | The nav shell; its `arrScopeOptions` determine which scope options are offered (`availableScopes`). |

Usage:

```svelte
<NavScopeSelector {navShell} />
```

Notes:

- `on:change` (`onScopeChange`) reads the select value and calls `navScope.setScope(value as ArrType)`. It reactively calls `navScope.syncAvailableScopes(availableScopes)`. There are no callback props.
- Binds the select value to `$navScope`. Imports `ARR_CONDITION_TARGET_OPTIONS` from `$shared/arr/capabilities`, the `ArrType` type from `$shared/pcd/types`, and `navScope` from `$stores/navScope`.
- Reactively syncs available scopes into the store on every `navShell` change.

Variants:

- Options are `ARR_CONDITION_TARGET_OPTIONS` filtered by `availableScopes`; empty when `navShell`/`arrScopeOptions` are absent.

## Version

Footer card showing the praxrr logo, wordmark, and build metadata line (platform · channel · optional version).

Import:

```svelte
import Version from '$ui/navigation/pageNav/version.svelte';
```

Props:

| Prop      | Type     | Default | Required | Description                                                                                                         |
| --------- | -------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `version` | `string` | `''`    | No       | App version string; only appended to the metadata line when `shouldShowVersion()` is true and version is non-empty. |

Usage:

```svelte
<Version version="2.0.0" />
```

Notes:

- Computes `platform = getPlatformLabel()`, `channel = getChannelLabel()`, and `showVersion = shouldShowVersion()` (all from `$shared/utils/version`) once at init. Uses `$assets/logo.svg`.
- Rendered by `pageNav` in both the mobile (scrolling) and desktop (pinned bottom) footer slots.

Variants:

- The metadata line always shows platform and channel; the version segment is conditionally appended.
