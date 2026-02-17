## Executive Summary

- Praxrr currently reuses the `arr_instances.url` column both for the API clients that talk to Radarr/Sonarr/Lidarr and for every "Open in" link that points users at `/arr/{id}/library` resources. In docker/internal-network deployments this URL is often an internal hostname (e.g. `http://lidarr:8686`) that can’t be reached from the browser, so the UI links break.
- Introduce an optional `external_url` that mirrors the existing `url` semantics but is only used by the UI surfaces that open browser tabs. All internal API clients continue to use `url`, while the UI prefers `external_url` when available and falls back to `url` otherwise, ensuring existing deployments keep working.

## Architecture Approach

- The new field lives on `arr_instances`, so the same row that supplies the API credentials also carries the browser-friendly URL. `src/routes/arr/[id]/+layout.server.ts` runs once per instance and feeds `instance` metadata (including the new field) into every child route, so the library/release/upgrade pages automatically receive the extra property as soon as the row is refreshed.
- UI surfaces that currently call `window.open(instance.url)` or append `instance.url` to build `href` strings must respect the optional override. Specifically:
  - The landing-page helpers (`src/routes/arr/views/CardView.svelte` and `src/routes/arr/views/TableView.svelte`) expose the external button next to each instance.
  - The library tab (`src/routes/arr/[id]/library/+page.svelte`, together with `src/routes/arr/[id]/library/components/LibraryActionBar.svelte`) builds both the "Open in" button and the `movie/series/artist` links using `instance.url` today.
  - Any future surface that reads `instance.url` for presentation should follow the same fallback: prefer `instance.external_url` and default back to `instance.url` so we never regress legacy behavior.
- Desktop flows that directly talk to Arr APIs (`createArrClient`, `ArrUpgrade`, `arr_sync` jobs, etc.) continue to use `instance.url` as the canonical endpoint. Those layers are unaffected because they never display or link to the URL in the browser context.

### Data Model Implications

- Extend the `arr_instances` table with a nullable `external_url TEXT` column. A migration such as `src/lib/server/db/migrations/0XX_add_arr_instances_external_url.ts` must `ALTER TABLE` so existing databases gain the column without rewrites; `src/lib/server/db/schema.sql` must document the new column under the arr_instances section.
- Update `src/lib/server/db/queries/arrInstances.ts`:
  - Extend the exported `ArrInstance` interface with `external_url: string | null` so every query that selects `*` exposes it.
  - Add `externalUrl?: string` to `CreateArrInstanceInput` and `UpdateArrInstanceInput`, store it via `INSERT`/`UPDATE`, and treat empty strings as `null` when writing (`externalUrl?.trim()` or similar). Keep `tags` serialization untouched.
- Because `arrInstancesQueries.getAll`/`getById` deliver the row to the UI and server jobs, the nullable column propagates everywhere without additional changes. No table needs to be rewritten or re-indexed—the new column is simply an optional attribute on each row.

## API Design Considerations

- The browser exposes the field to users through the `InstanceForm` component in `src/routes/arr/components/InstanceForm.svelte`. Add a secondary `External URL` form input (optional, with a short description like "Browser-accessible hostname for open-in links") and keep the hidden `save-form` in sync (add a `<input type="hidden" name="external_url" ...>` so SvelteKit actions get the value).
  - When editing, `initEdit` should seed the dirty-tracking store with `instance.external_url` so the field is flagged dirty when changed.
  - The `enhance` hook should continue to `requestSubmit` the hidden `save-form`; no new `enhance` logic is needed beyond adding the extra hidden input.
- Update the server actions that write instances:
  - `src/routes/arr/new/+page.server.ts` should parse `external_url` (trimmed, optional) from `FormData` and pass it to `arrInstancesQueries.create`. Keep the existing `name/type/url/api_key/tags` validation and reporting flow.
  - `src/routes/arr/[id]/settings/+page.server.ts` must accept the optional field, include it in the `update` call so the database value changes, and continue logging the meta data in `logger.info`/`error` payloads.
- Because `src/routes/arr/[id]/+layout.server.ts` pulls the `instance` row via `arrInstancesQueries.getById`, the new column is immediately available to downstream pages. SvelteKit re-runs layout loads after the `?/update` action completes, so the library tab sees the new `external_url` without a manual refresh.
- UI consumers should compute the open-target URL as `const openUrl = instance.external_url?.trim() || instance.url;` and reuse this value for:
  - the `window.open` handler in `CardView`/`TableView`.
  - the `LibraryActionBar` `onOpen` callback and the `handleOpen` helper in `+page.svelte`.
  - the `baseUrl` used to render the direct `href`s (`/movie`, `/series`, `/artist`) so row-level links still work.
  - any other modal/action button that currently uses `instance.url` for navigation.
- The HTTP test connection endpoint (`/arr/test`) still uses `url` to verify reachability; it should not consult `external_url` because `external_url` may not be routable from the server side.

## System Constraints

- All server-side Arr communication must keep pointing at `arr_instances.url`; switching these flows to `external_url` would break connections in docker/internal networks.
- Because `external_url` lives on the same row as the credentials, any cache that keeps `arrInstancesQueries` results must re-read the row to pick up changes. `<InstanceForm>` updates the row via the `?/update` action, and SvelteKit automatically re-runs `load`, which is the existing mechanism for invalidating `arr/[id]` layouts, so the "Open in" buttons refresh immediately.
- The UI must continue to behave for deployments that never set `external_url` by falling back to the internal `url`. The fallback logic should live in a small helper so every `window.open`/`href` path reuses the same expression.
- No views should expose the field in a way that conflicts with the internal connection string (e.g., don’t display both URLs side by side by default). The field exists strictly to override open-in behavior.
- Existing `arr_instances` rows should default to `external_url = NULL`, so no migration is necessary beyond adding the column. There is no extra required migration data or roll-forward/backward logic beyond the single `ALTER TABLE` statement.

## File-Level Impact Preview

1. `src/lib/server/db/migrations/0XX_add_arr_instances_external_url.ts` (new migration that adds the nullable `external_url` column and updates `updated_at` semantics if necessary) plus `src/lib/server/db/schema.sql` to document the column.
2. `src/lib/server/db/queries/arrInstances.ts` – extend `ArrInstance`, `CreateArrInstanceInput`, and `UpdateArrInstanceInput` with `external_url`, wire the `INSERT`/`UPDATE` statements, and ensure the helper (`arrInstancesQueries.update`) treats empty strings as `null`.
3. `src/routes/arr/new/+page.server.ts` and `src/routes/arr/[id]/settings/+page.server.ts` – surfaces must parse `external_url` from the form, trim it, feed it into `arrInstancesQueries.create/update`, and keep per-route logging/feedback unchanged.
4. `src/routes/arr/components/InstanceForm.svelte` – add a user-facing `External URL` input (visible when editing/creating) plus a hidden `<input name="external_url" ...>` so the `enhance` hook submits it; update `initEdit`/dirty tracking to include the new field.
5. `src/routes/arr/views/CardView.svelte`, `src/routes/arr/views/TableView.svelte` – compute the open-target URL via the helper above before invoking `window.open` so the landing-page cards/tables honor the override.
6. `src/routes/arr/[id]/library/+page.svelte` and `src/routes/arr/[id]/library/components/LibraryActionBar.svelte` – derive `instanceUrl` from `external_url || url`, use it for the toolbar `onOpen` handler, and keep the `baseUrl` used for `/movie`, `/series`, `/artist` links in sync.
7. `src/routes/arr/[id]/+layout.server.ts` – no functional change, but document that the layout still feeds `instance` through `arrInstancesQueries.getById`, ensuring every child route sees the new column after an update completes.
