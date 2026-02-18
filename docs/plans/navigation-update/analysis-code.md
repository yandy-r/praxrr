### Executive Summary

Navigation currently composes `Navbar`, `PageNav`, and `BottomNav` from `src/routes/+layout.svelte`, but each surface defines its own hard-coded items, making grouping, scope gating, and feature flags hard to manage. The navigation-update work extracts a shared `NavShell` (`shared/navigation/types.ts`) resolved in `src/routes/+layout.server.ts` and fed to both sidebar and bottom bar while preserving stores (`mobileNav`, `navIcons`) and Arr capability helpers for future scope filtering. This centralized registry approach keeps route hrefs unchanged and layers responsive/mobile behavior and icon-resolution on top of one typed source.

### Related Components

- `src/routes/+layout.svelte`: mounts `Navbar`, `PageNav`, and `BottomNav`; will pass the resolved `navShell` prop.
- `src/routes/+layout.server.ts`: layout load becomes the single place to compute and return `navShell` alongside `version`.
- `src/lib/client/ui/navigation/pageNav/*.svelte` (`pageNav`, `group`, `groupHeader`, `groupItem`, `version`): retain the current expandable pattern but iteratively render from `navShell.groups`.
- `src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`: flattens `navShell.groups` and honors `mobilePriority` for responsive visibility.
- `src/lib/client/stores/mobileNav.ts` & `navIcons.ts`: continue driving drawer state and icon style once nav data is centralized.
- `src/lib/shared/arr/capabilities.ts` & `src/lib/shared/pcd/types.ts`: Arr capability metadata remains the gating source for future scope-aware filtering.

### Implementation Patterns

**Layout-Scoped Shared Nav Data**: compute the nav registry on the server (`resolveNavShell` in `src/routes/+layout.server.ts`) and reuse the serialized `NavShell` in both `PageNav` and `BottomNav`.

- Example: `src/routes/+layout.svelte`, `src/routes/+layout.server.ts`.
- Apply to: layout orchestration, data federation.

**Capability-Gated Arr Semantics**: declare each nav item's `arrScope` or required capability and filter visibility through `capabilities.ts` helpers before sending the shell to the client.

- Example: `src/lib/shared/arr/capabilities.ts` and the planned `NavItemDef` metadata (`docs/plans/navigation-update/` specs).
- Apply to: arr scope selector, nav visibility gating.

**Store-Driven Responsive State**: continue relying on `mobileNav.ts` for drawer open/close and `navIcons.ts` for icon style, ensuring those states work with the new registry without change.

- Example: `src/lib/client/stores/mobileNav.ts`, `src/lib/client/stores/navIcons.ts`, `pageNav.svelte`, `BottomNav.svelte`.
- Apply to: drawer behavior, responsive/mobile navigation.

### Integration Points

#### Files to Create

- `/src/lib/shared/navigation/types.ts`: typed definitions (`NavShell`, `NavItemDef`, `ResolvedNavGroup`, etc.) shared between server resolver and client components.
- `/src/lib/server/navigation/registry.ts`: static `NAV_REGISTRY` (groups + items) with Arr scope, icon keys, and mobile priority metadata.
- `/src/lib/server/navigation/resolver.ts`: `resolveNavShell()` that filters by feature flags/permissions, serializes icons to keys, and returns a JSON-safe shell.
- `/src/lib/client/navigation/iconMap.ts`: maps `iconKey` strings to `lucide-svelte` components for client rendering.
- `/src/lib/client/stores/navScope.ts`: writable store persisting the active App/Arr scope (future scope selector).
- `/src/lib/client/ui/navigation/pageNav/sectionHeader.svelte`: renders section labels between groups.
- `/src/lib/client/ui/navigation/pageNav/navScopeSelector.svelte`: (Phase 2) scope selector UI bound to `navScope` store.

#### Files to Modify

- `/src/routes/+layout.server.ts`: import `resolveNavShell`, evaluate it with `locals.user/session`, and return `{ version, navShell }`.
- `/src/routes/+layout.svelte`: pass `data.navShell` into `PageNav` and `BottomNav` while keeping the auth-page guard.
- `/src/lib/client/ui/navigation/pageNav/pageNav.svelte`: accept `navShell`, loop `navShell.groups`, resolve icons via `iconMap`, insert `sectionHeader`, and optionally hook into `navScope` filtering without altering drawer logic.
- `/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`: receive `navShell`, flatten groups into items, respect `mobilePriority`, and keep icon/emoji preference handling.
- `/src/lib/client/ui/navigation/pageNav/groupItem.svelte` & `groupHeader.svelte`: continue using `activePattern` logic and accessibility props; data comes from resolved shell rather than inline constants.
- `/src/app.d.ts`: extend `App.PageData` to include `navShell?: NavShell` for type safety if not already present.

### Conventions

- Naming: keep `Nav`-prefixed types in `shared/navigation` (e.g., `NavShell`, `ResolvedNavGroup`, `NavItemDef`) and reuse `ArrType` from `shared/pcd/types.ts`.
- Error handling: resolver should fail fast when required routes are missing or permissions fail; client components should guard missing groups/items gracefully.
- Testing: verify `+layout.server.ts` still returns valid hrefs and that `PageNav`/`BottomNav` render expected responsive classes and active states using the shared shell.

### Gotchas and Warnings

- Deep links must stay unchanged (`/quality-profiles`, `/custom-formats`, etc.) so redirects relying on localStorage continue to work.
- Icon keys in the registry must match entries in `iconMap.ts`; missing keys silently drop icons.
- All filtering (feature flags, permissions) must happen in `resolveNavShell` to avoid SSR/client hydration mismatches; scope filtering happens client-side via stores only after the shell is hydrated.
- `BottomNav` still requires `mobilePriority` values (`always`, `medium`, `low`) or items remain visible at every breakpoint.
- `pageNav.svelte` currently uses Svelte 4 props while `groupItem.svelte` uses Svelte 5 runes; do not mix patterns unnecessarily when wiring new props like `navShell`.

### Task Guidance by Area

- **database**: No schema changes for Phase 1; continue reading `arr_instances` for future arr scope needs and keep `app_info.version` as the only DB data returned now.
- **api**: Extend `+layout.server.ts` to return the `navShell`; avoid adding new HTTP endpoints for nav data in Phase 1.
- **ui**: Feed both `PageNav` and `BottomNav` from the shared shell, add `sectionHeader` group labels, keep mobile drawer behavior (escape key, route-change close), and plan scope selector + indicator for Phase 2 using the `navScope` store.
