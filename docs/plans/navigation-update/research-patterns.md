# Pattern Research: navigation-update

## Architectural Patterns

**Server-resolved NavShell from a typed registry**: The plan describes a `resolveNavShell()` helper that reads a central `NAV_REGISTRY` (a `NavItemDef[]` with `featureFlag`, `arrScope`, `mobilePriority`, etc.), evaluates feature flags/permissions, maps lucide icon references to serializable keys, and returns a JSON-safe `NavShell` that both layout and nav components consume. Having the layout load perform this work once keeps SSR/hydration consistent and feeds the same data to sidebar and bottom navigation renderers.

- Example: `docs/plans/navigation-update/research-technical.md` details the proposed `+layout.server.ts` contract, the resolver responsibilities, and the shared `NavShell`/`NavItemDef` interfaces.

**Nav group composition with shared data sources**: `pageNav.svelte` renders groups via the `Group`/`GroupItem` components, passing props for icons, `href`, and `activePattern`, while `BottomNav.svelte` flattens the same data to honor mobile priorities and active detection. Both rely on the registry to keep sections and items aligned instead of mirroring two separate hard-coded arrays.

- Example: `src/lib/client/ui/navigation/pageNav/pageNav.svelte`, the related `Group`/`GroupItem` components, and `src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`.

**Store-driven mobile drawer state with transitions**: The sidebar opens/closes via the `mobileNavOpen` custom writable store, and `Group` uses `svelte/transition` to animate child list changes, so UI state, accessibility, and animation are encapsulated in reusable components backed by shared stores.

- Example: `src/lib/client/ui/navigation/pageNav/pageNav.svelte` toggles `mobileNavOpen` (from `src/lib/client/stores/mobileNav.ts`) and renders `Group`/`GroupItem` slots with the `slide` transition defined in `src/lib/client/ui/navigation/pageNav/group.svelte`.

## Code Conventions

Navigation components live under `src/lib/client/ui/navigation/` and follow the repo conventions: PascalCase filenames, `export let` props, explicit TypeScript interfaces, and aliases for shared assets or stores (`$assets`, `$stores`, `$app/stores`). `pageNav.svelte` imports icons from `lucide-svelte`, accesses `navIconStore`/`mobileNavOpen`, and keeps layout logic in small helper functions while the child `groupItem.svelte` prefers runes (`$props`, `$derived`) to compute active state from `$page.url` without scattering logic across the tree. `BottomNav.svelte` defines a typed `NavItem` array and reuses `$page` to derive `isActive`, so responsive classes stay consistent across breakpoints.

- Example: `src/lib/client/ui/navigation/pageNav/pageNav.svelte`, `src/lib/client/ui/navigation/pageNav/groupItem.svelte`, `src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`.

Server modules import via the path aliases declared in `deno.json` (`$db/queries`, `$auth`, `$logger`), define precise `Actions`/`ServerLoad` signatures, and prefer small helper interfaces for form data. They also return structured `fail()` payloads and log side effects before resolving the action, keeping controller logic declarative and consistent.

- Example: `src/routes/settings/security/+page.server.ts` imports `$db/queries/users.ts`, `$auth/password.ts`, and `$logger/logger.ts`, then validates inputs before returning `fail(400, { ... })` or logging the success path.

## Error Handling

Server loads use `throw error(status, message)` from `@sveltejs/kit` when required preconditions fail, while actions rely on `fail(status, payload)` to surface validation feedback. For instance, `src/routes/metadata-profiles/+page.server.ts` throws `error(500, 'Failed to load databases')` if the PCD manager returns `null`, and `src/routes/settings/security/+page.server.ts` returns `fail(400, {...})` for missing fields, `fail(401, ...)` for unauthorized sessions, and `fail(400, ...)` for mismatched passwords. Both modules log the failure or success via the shared `logger` with structured metadata (`source`, `meta`) so downstream observers (logs, tests) can follow the same flow before the response is sent.

## Testing Approach

Tests live under `src/tests/**` and use `Deno.test` with helpers that patch the modules under test, making them deterministic without hitting a real database. `src/tests/base/arrExternalUrlLayoutPropagation.test.ts` shows the pattern: `installPatch` replaces `arrInstancesQueries` methods and `logger` with spies, the layout load and settings action are invoked directly, and `assertEquals` verifies the mutated DTOs. This style keeps coverage close to `+layout.server.ts`/`+page.server.ts` logic while allowing focused assertions on navigation state or side effects.

## Patterns to Follow

- Treat the nav item registry as the single source of truth (`NavItemDef[]` with `arrScope`, `featureFlag`, `mobilePriority` metadata) and surface it through a typed resolver so both sidebar and bottom navigation derive their structure from the same code path (`docs/plans/navigation-update/feature-spec.md`, `docs/plans/navigation-update/research-technical.md`).
- Resolve the nav shell on the server (`resolveNavShell`) so permissions, feature flags, and Arr scope options are evaluated once, and pass the resulting `NavShell` through `+layout.server.ts` to `pageNav`/`BottomNav` to avoid hydration mismatches (`docs/plans/navigation-update/research-technical.md`).
- Serialize icons via string keys (`iconKey`) and use a client-side `NAV_ICON_MAP` to convert them back to `lucide-svelte` components, keeping the load response JSON-friendly (`docs/plans/navigation-update/research-technical.md`).
