# Architecture Research: navigation-update

## System Overview

Praxrr runs on Deno with a SvelteKit front-end that wires its UI shell through `packages/praxrr-app/src/routes/+layout.svelte`, conditionally rendering `Navbar`, `PageNav`, and `BottomNav` plus `AlertContainer` and a `main` slot; the layout loader (`packages/praxrr-app/src/routes/+layout.server.ts`) pulls runtime metadata (currently the version string) from `appInfoQueries` in `packages/praxrr-app/src/lib/server/db/queries/appInfo.ts`. Business logic lives under `packages/praxrr-app/src/lib/server/` (DB migrations/queries, sync/jobs, PCD helpers, upgrades, rename utilities, and API syncs) and is exposed via SvelteKit endpoints in `packages/praxrr-app/src/routes/api/v1/**`, while shared state, stores, and utilities live under `packages/praxrr-app/src/lib/client/` and `packages/praxrr-app/src/lib/shared/`.

## Relevant Components

- `packages/praxrr-app/src/routes/+layout.svelte`: root shell that imports and renders the navigation trio and hides them on `/auth/*` pages, feeding `PageNav` the version data and keeping navigation out of the auth flows.
- `packages/praxrr-app/src/routes/+layout.server.ts`: layout loader that returns version metadata from `appInfoQueries`, the current hook for the navigation shell’s server data requirements.
- `packages/praxrr-app/src/lib/client/ui/navigation/navbar/*`: top bar (logo, accent picker, theme toggle) that sits above the navigation shell.
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/*`: sidebar/drawer implementation with collapsible groups (`Group`, `GroupItem`, headers, version badge) that currently hardcodes the navigation tree.
- `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`: mobile bottom bar with its own `NavItem[]`, responsive priority rules, and a `window.open` backstop for navigation.
- `packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte`: route-driven tab bar used on per-entity pages (`/arr/[id]`, `/media-management/*`, etc.) with dropdown/overflow modes.
- `packages/praxrr-app/src/lib/client/stores/navIcons.ts`: persistent store that tracks the navigation icon style (emoji vs. lucide) and is referenced by navigation components to decide what glyph to render.
- `packages/praxrr-app/src/lib/shared/navigation` (proposed by `docs/plans/navigation-update/research-technical.md`): planned shared `types.ts` interfaces plus a server-side `registry.ts` and `resolver.ts` that would centralize nav definitions, filtering, and serialization, feeding both sidebar and bottom nav.
- `docs/plans/navigation-update/research-technical.md` & `docs/plans/navigation-update/research-recommendations.md`: detailed spec/research artifacts outlining the desired nav registry/resolver architecture, telemetry endpoint, icon map, and the phased component upgrades that future implementation must honor.

## Data Flow

Browser requests hit SvelteKit routes in `packages/praxrr-app/src/routes/`—UI pages render through the root layout, while APIs live under `packages/praxrr-app/src/routes/api/v1/**` and delegate to `packages/praxrr-app/src/lib/server` helpers (DB queries, sync jobs, rename/upgrade utilities) for business logic. Navigation-specific data currently flows from the layout loader (`+layout.server.ts`) to `PageNav` as a version string, while the nav components themselves rely solely on hardcoded arrays and client stores such as `navIconStore` for styling. The planned architecture from `docs/plans/navigation-update/research-technical.md` introduces a shared `NavShell` data structure evaluated by a resolver (server) and consumed by `PageNav`, `BottomNav`, and `Navbar`, allowing server-side filtering (e.g., capability gating, app scope) before the client renders each variant. Any telemetry or event ingestion would travel through the proposed `POST /api/v1/navigation/events` endpoint so clicks/logs stay on the server.

## Integration Points

New navigation code should hook into the layout/loader stack: `packages/praxrr-app/src/routes/+layout.server.ts` must become the canonical place that invokes `resolveNavShell` (from `packages/praxrr-app/src/lib/server/navigation/resolver.ts`) and returns the `NavShell` payload alongside `version`. `packages/praxrr-app/src/lib/shared/navigation/types.ts` will define the shared interfaces, consumed by `packages/praxrr-app/src/lib/client/navigation/iconMap.ts` plus the `PageNav`, `BottomNav`, and existing `Navbar`/`Tabs` components once they accept `navShell` props. Component-level changes include replacing inline nav arrays with registry-driven loops (`PageNav` and `BottomNav`) and keeping tabs/navbar in sync with the resolved icons and ordering. The existing `packages/praxrr-app/src/routes/api/v1/navigation/events/+server.ts` placeholder and `docs/plans/navigation-update/research-technical.md` enumerate the precise file-by-file touchpoints for migration.

## Key Dependencies

- `Deno` + `SvelteKit` (via `@sveltejs/kit`, `svelte`, `sveltekit-adapter-deno`) to serve the full-stack app.
- `Kysely` + `@jsr/db__sqlite` over `better-sqlite3` for typed queries/migrations against the embedded SQLite database (`packages/praxrr-app/src/lib/server/db/*`).
- Tailwind-related tooling (`tailwindcss`, `@tailwindcss/forms`, `prettier-plugin-tailwindcss`) for the utility-first styling seen in navigation components.
- `lucide-svelte` (with optional emoji fallback via `navIcons.ts`) for iconography across nav groups.
- Supporting tooling (`eslint`, `prettier`, `typescript`, `vite`, `@playwright/test`) that keep the Svelte/Deno repo consistent and testable.
