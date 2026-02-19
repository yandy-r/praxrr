# Integration Research: navigation-update

## API Endpoints

### Existing Related Endpoints

- `packages/praxrr-app/src/routes/+layout.server.ts` (LayoutServerLoad): runs on every page request, now calling `resolveNavShell` (from `packages/praxrr-app/src/lib/server/navigation/resolver.ts`) together with `appInfoQueries.getVersion()` to return both `version` and a `NavShell` payload. The resolver reads the static `NAV_REGISTRY` in `packages/praxrr-app/src/lib/server/navigation/registry.ts`, evaluates each entry’s `featureFlag` via the new `feature_flags` table (with `NAV_V2`/`import.meta.env.DEV` fallbacks for the dev tooling group), checks any `permission` slug against `event.locals.user`, maps lucide components to JSON-safe `iconKey`s, and emits grouped `ResolvedNavItem`s so `PageNav` and `BottomNav` render from the same source of truth.
- `POST /api/v1/navigation/events` (`packages/praxrr-app/src/routes/api/v1/navigation/events/+server.ts`): ingestion endpoint for navigation telemetry emitted from `packages/praxrr-app/src/lib/client/navigation/telemetry.ts` (which batches `navigator.sendBeacon`/`fetch`). It accepts `NavTelemetryEvent`s (`eventName` in `{'nav_click','nav_scope_change','nav_group_toggle','nav_search_select','nav_impression'}`, optional `navItemId`, `arrScope`, `variant`, and a metadata map), enforces rate limiting, logs via the shared logger, and writes each record into the `navigation_events` table so the team can run local analytics such as top-click reports or backtracking detection without relying on external analytics.

### Route Organization

`packages/praxrr-app/src/routes/+layout.svelte` is the root layout; it imports `Navbar`, `PageNav`, `BottomNav`, and `AlertContainer`, skips rendering nav on `isAuthPage` paths, and forwards `data.version` plus the server-resolved `navShell` into both nav components (the `Version` block in `PageNav` already consumes `app_info.version`).

`PageNav` and `BottomNav` now share the same `navShell`: `PageNav` iterates through `navShell.groups`, renders `Group`/`GroupHeader`/`GroupItem`, embeds the new `NavScopeSelector` (which reads `navShell.arrScopeOptions` and writes the user’s selection into `navScopeStore`), and keeps the existing escape/route-change close behavior. `BottomNav` flattens the groups, honors each `mobilePriority` for responsive visibility, and resolves icons via `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`. Both components consult the client-side `navScopeStore` (persisted in `localStorage` alongside the other sidebar stores) so switching between `ArrType`s filters the resolved tree instantly, while the server resolver already trimmed the tree by each item’s `arrScope`/`requiredFeature` metadata in tandem with `supportsArrSyncSurface()`/`supportsArrWorkflow()` from `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`.

`resolveNavShell` lives in `packages/praxrr-app/src/lib/server/navigation`. It short-circuits when `locals.user` is null, then otherwise filters `NAV_REGISTRY` entries by `featureFlag` (`feature_flags`/`NAV_V2`/`import.meta.env.DEV`), optional `permission`, and arr scope, maps icons to string keys, and produces a JSON-safe `NavShell` that includes `NavVariant`, `arrScopeOptions`, `activeArrScope`, and the grouped items consumed by both nav surfaces.

Telemetry flows from `packages/praxrr-app/src/lib/client/navigation/telemetry.ts` into `POST /api/v1/navigation/events`; the handler records each event (with `variant`, `arrScope`, optional `navItemId`, and metadata such as device/router context), logs it, and inserts it into `navigation_events`, letting the team keep the nav observability data inside the existing SQLite app database rather than shipping a heavyweight SaaS.

## Database

### Relevant Tables

- `arr_instances`: stores every linked Arr app (`id`, `name`, `type`, `url`, `external_url`, `api_key`, `tags`, `enabled`, timestamps). The `type` column feeds the nav scope selector and `ArrType` gating, and the same row is referenced by dozens of tables (`arr_sync_media_management`, `arr_sync_delay_profiles_config`, `arr_database_namespaces`, `arr_rename_settings`, `arr_upgrade_runs`, etc.) so arr-specific navigation choices can map back to the real credential row via `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`.
- `app_info`: singleton table (`id=1`) that persists the running version string; `appInfoQueries.getVersion()` powers the `Version` badge in the nav components.
- `feature_flags`: a new SQLite table (`key TEXT PRIMARY KEY`, `enabled INTEGER NOT NULL DEFAULT 0`, `description TEXT`, `created_at`, `updated_at`) seeded with `nav_v2`, `nav_command_palette`, and `nav_scope_selector`. The resolver queries it via helpers in `packages/praxrr-app/src/lib/server/utils/flags/flags.ts` to decide whether to show nav v2, the command palette toggle, or the scope selector without exposing flag data to unauthenticated requests.
- `navigation_events`: a new telemetry table (`id TEXT PRIMARY KEY`, `event_name TEXT NOT NULL`, `nav_item_id TEXT`, `arr_scope TEXT NOT NULL`, `variant TEXT`, `metadata TEXT`, `created_at TEXT DEFAULT (datetime('now'))`) with `idx_nav_events_name_date` on `(event_name, created_at)`. It stores the `NavTelemetryEvent` payloads so the team can query clicks/impressions per scope or search for backtracking behavior.

### Schema Details

`arr_instances.type` includes `'radarr'`, `'sonarr'`, `'lidarr'`, `'readarr'`, `'prowlarr'`, and is the canonical source of what Arr apps are linked and what capabilities exist for each nav scope; the surrounding tables all declare foreign keys to `arr_instances(id)` (see the long list of joins in `packages/praxrr-app/src/lib/server/db/schema.sql` around the `arr_*` sections), so nav scope switching can always correlate to a concrete instance if needed and the resolver can inspect metadata such as `enabled` or `tags` if future filters require it.

The planned `feature_flags` migration (e.g., `packages/praxrr-app/src/lib/server/db/migrations/0XX_create_feature_flags.ts`) will add the table above, seed the initial rows, and be registered in `packages/praxrr-app/src/lib/server/db/migrations.ts`; `resolveNavShell` will call `getFlag(db, key)`/`getAllFlags(db)` so enabling new nav groups happens via a simple toggle rather than code changes. The dev-tool group will retain the `import.meta.env.DEV` guard but lives in the registry with a special `featureFlag` key so the resolver can still tree-shake it out of production builds.

The `navigation_events` migration will insert the table definition shown above along with the `idx_nav_events_name_date` index, and the ingestion endpoint simply needs to generate a UUID for `id` (and optionally trim metadata). Querying the table can answer questions such as “which `nav_item_id` logged the most `nav_click` events in the last 30 days?” or “did users click a nav item and immediately click the parent group?” without sending data to external analytics providers. Retention (30, 90, or indefinite) can be handled by a scheduled cleanup once requirements crystallize.

## External Services

Navigation-update is implemented entirely within the existing SvelteKit/SQLite stack, so there are no new SaaS dependencies: feature flags live in the local `feature_flags` table, and nav telemetry is captured in `navigation_events`. The research notes do mention optional services in case the team wants to expand the surface later:

- OpenFGA (and similar frameworks such as the Backstage permissions reference) could be used for richer role-based gating, but it would require spinning up an OpenFGA datastore and letting the layout loader run `check`/`list` queries before rendering nav entries.
- Umami or Plausible (both Docker-friendly and cookie-free) could provide additional site-wide analytics, but they would only be added if we also needed general page metrics; the nav-specific telemetry already lives in the app database.
- Bits UI Command (2.15+) is the planned UI library for the future command palette; it ships as a headless Svelte component with no extra credentials and can be toggled by the `nav_command_palette` flag when we ship that phase.

## Internal Services

- `packages/praxrr-app/src/hooks.server.ts`: authenticates requests, populates `event.locals.user`/`session`, and is the only middleware that can tell the nav resolver which permissions (if any) are available.
- `packages/praxrr-app/src/lib/server/navigation/types.ts`, `registry.ts`, and `resolver.ts`: define `NavItemDef`, `NavShell`, `NavVariant`, etc., expose the `NAV_REGISTRY`, and implement `resolveNavShell()` so both nav components consume the same grouped, JSON-serializable shell.
- `packages/praxrr-app/src/lib/server/utils/flags/flags.ts`: the helper that reads the `feature_flags` table and returns booleans so nav entries can stay hidden when flags are off.
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: provides `supportsArrSyncSurface()`, `supportsArrWorkflow()`, and `supportsFeature()` so the resolver and client scope filter know which Arr apps support each surface (metadata profiles, media management, etc.).
- `packages/praxrr-app/src/lib/server/db/queries/appInfo.ts`: pulls the version string shown in `PageNav`.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: centralizes CRUD for `arr_instances`, so any future nav logic that needs to enumerate specific linked instances can reuse the same helpers.
- `packages/praxrr-app/src/app.d.ts`: must extend `App.PageData` with `navShell?: NavShell` so the layout loader can safely type the new slot data.
- `packages/praxrr-app/src/lib/client/stores navScope.ts` and `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/navScopeSelector.svelte`: persist the chosen `ArrType` into `localStorage` (following the `navIcons.ts` pattern) and let the user switch between “All Apps”, “Radarr”, “Sonarr”, and “Lidarr”.
- `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`: resolves the registered `iconKey` strings back to `lucide-svelte` components on the client.
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte` and `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`: now accept the shared `navShell`, filter by `mobilePriority`/`arrScope`, and keep the slide-in/priority behavior intact.
- `packages/praxrr-app/src/lib/client/navigation/telemetry.ts` and `packages/praxrr-app/src/routes/api/v1/navigation/events/+server.ts`: coordinate to send `NavTelemetryEvent`s from the client and persist them in `navigation_events` for offline analysis.

## Configuration

- `NAV_V2` (environment variable) together with the `feature_flags` table determines whether `resolveNavShell` returns the `'nav_v2'` variant; the loader can fall back to `'legacy'` until the flag is flipped without renaming any routes, and `import.meta.env.DEV` still gates the dev-only entries so they disappear in production.
- The `feature_flags` table (seeded with `nav_v2`, `nav_command_palette`, `nav_scope_selector`) stores `enabled` booleans plus `created_at`/`updated_at`, and the resolver never exposes the raw rows to the client—only the boolean result of `getFlag`/`getAllFlags`.
- `packages/praxrr-app/src/app.d.ts` must declare `navShell?: NavShell` on `App.PageData`, and `svelte.config.js`/`tsconfig.json` should add a `$nav` alias pointing to the shared navigation helpers so the resolver and the client store import the same types.
- `navScopeStore` persists the selected `ArrType` in `localStorage` (mirroring `navIcons.ts`/`sidebar.ts`), so scope switches only re-filter the already-resolved `NavShell.groups` on the client and never bounce back to the server.
- `navigation_events` stores `metadata` blobs (`source`, `device`, `route_from`), `variant`, and `arr_scope`, so the only “configuration” it needs is a retention policy (30/90 days or cleanup cron) and the ability to generate a UUID for each `id`; no extra credentials are required beyond the existing SQLite schema.
