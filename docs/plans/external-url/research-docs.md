# Documentation Research: external-url

## Architecture Docs

- `docs/ARCHITECTURE.md`: outlines how Praxrr wires PCD databases into Arr instances, maps the server/client/shared directories, and calls out `src/lib/server/sync/` and the `arr.sync`/`arr.rename`/`arr.upgrade` jobs that run per `arr_instances` row. Section 4 (“Data Stores” + the App DB overview) explains that the SQLite app DB holds linked Arr credentials, jobs, and PCD ops, so `arr_instances` is the root of every sync, library fetch, and settings edit.
- `src/lib/server/db/schema.sql`: the code-commented arr_instances definition documents `name`, `type`, `url`, `api_key`, `tags`, and timestamps plus the “Purpose: Store configuration for \*arr application instances (Radarr, Sonarr, etc.)” banner; every downstream table (jobs, sync caches, PCD relationships) references `arr_instances(id)`. Adding `external_url` will therefore propagate through these FK-rich tables, and the comment block is the canonical schema reference for the data-model change.
- `docs/plans/external-url/research-external.md`: captures why Arr APIs do not expose a ready-made “external URL” field, explains the dual-URL model (`external_url ?? url` fallback), and documents that `arrInstancesQueries.getById` already feeds every layout/page with the same row, so a single column addition immediately affects library, release, and card renders.

## API Docs

- `docs/api/v1/paths/arr.yaml`: defines the `/library` GET/DELETE endpoints that power the `/arr/{id}/library` view. The GET action requires `instanceId` plus pagination/sorting parameters and already caches responses for five minutes, so the same request pipeline needs to surface the new URL resolver before the cached payload hits the UI. The DELETE path invalidates that cache per `instanceId`, which is the hook that should trigger the new link base to propagate.
- `docs/api/v1/schemas/arr.yaml`: contains the `ArrType` enum, Radarr/Sonarr/Lidarr item shapes, and `LibraryResponse`/`LibraryRadarrResponse`/`LibrarySonarrResponse`/`LibraryLidarrResponse` schemas referenced by `/library`. Understanding how the library payload varies per Arr type is important when ensuring the `external_url` override is applied uniformly across item URLs (movie/series/artist) even though each response uses a different `type`.

## Development Guides

- `docs/plans/external-url/research-ux.md`: prescribes the user workflows (new instance setup, editing, clearing, invalid entry recovery) and accessibility/validation text. It says the optional `External URL` input should sit below `URL`, display helper copy (`Used for Open in links. API calls still use URL.`), and show live resolved-host text after edits. It also singles out the library action bar and row-level links as in-scope “Open in” affordances that must share the same resolver.
- `docs/plans/external-url/research-recommendations.md`: recommends the phased rollout (data contract → settings UI → library links → follow-up list/card parity), spells out the `external_url` migration/queries/actions, and argues for a shared helper such as `resolveArrBrowserUrl(instance)` so both `LibraryActionBar` and row links reuse the fallback logic. The decision checklist at the end ties the field back to the `arr_instances` contract, the UI, and the required regression tests.
- Key code entry points to inspect (all currently read `instance.url` for navigation): `src/routes/arr/[id]/library/+page.svelte`, `src/routes/arr/[id]/library/components/LibraryActionBar.svelte`, `src/routes/arr/views/CardView.svelte`, `src/routes/arr/views/TableView.svelte`, `src/routes/arr/components/InstanceForm.svelte`, `src/routes/arr/new/+page.server.ts`, and `src/routes/arr/[id]/settings/+page.server.ts`. These files will need the shared helper and the hidden form input described in the technical/recommendation docs.

## README Files

- `README.md`: describes the core capability of “Bridge — Add your Radarr, Sonarr, and Lidarr instances by URL and API key” and flags Praxrr v2 as a Git-backed configuration tool that syncs to Arr instances. It sets the stage for why Arr link behavior matters (users expect to open those instances from the UI) and points developers toward `docs/CONTRIBUTING.md`/`docs/DEVELOPMENT.md` for setup.

## Must-Read Documents

- **REQUIRED** `docs/plans/external-url/feature-spec.md`: combines the business requirements, data-model proposal (add `external_url` to `arr_instances`), API design (create/update actions plus validations), UX workflows, and the file-impact list. It makes clear that `url` stays canonical for server flows while `external_url` only powers browser “Open in” links, so every follow-up change must align with those guardrails.
- **REQUIRED** `docs/plans/external-url/research-technical.md`: details the architecture approach, the `arr_instances` schema/migration, query-type updates, SvelteKit action plumbing, and the expectation that `src/routes/arr/[id]/+layout.server.ts` will continue to feed the instance row to children. It explicitly enumerates the UI files to patch, how to treat empty strings as `null`, and the need to keep connection tests pointed at `url`.
- Recommended `docs/plans/external-url/research-ux.md` and `docs/plans/external-url/research-recommendations.md` for the UI and rollout heuristics already mentioned above.

## Documentation Gaps

- No single doc enumerates every UI surface (library toolbar, row links, release page, list cards/tables, any other “Open in” buttons) that currently call `instance.url`; the developer must grep `instance.url` or rely on the recommendation doc to catch every path.
- There is no documented test matrix covering the fallback ( `external_url` present vs missing) for both backend (create/update actions) and frontend (library link generation) flows; the feature spec mentions exit criteria but no runnable test recipes.
- The schema docs and migration checklist describe `external_url` as a simple column, but no doc clarifies whether trailing slashes should be normalized when concatenating app-specific subpaths (movie/series/artist). The UI guidance says “preserve existing path builders,” but explicit normalization rules are missing, so implementers must decide on URL joining semantics themselves.
