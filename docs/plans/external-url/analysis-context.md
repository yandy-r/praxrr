# Context Analysis: external-url

## Executive Summary

Praxrr currently uses `arr_instances.url` for both Arr API traffic and every “Open in” link, which
breaks navigation when that URL is internal to the network. The feature introduces an optional
`external_url` column that lives beside the canonical `url`, populates via the existing instance
form actions, and applies the resolver `external_url ?? url` to every browser-facing link while
leaving backend clients (tests, sync jobs, library fetches) strictly bound to the canonical URL.

## Architecture Context

The Arr instance row in `packages/praxrr-app/src/lib/server/db/schema.sql` seeds every route and job;
`arrInstancesQueries` exposes `ArrInstance` rows, `CreateArrInstanceInput`, and
`UpdateArrInstanceInput`, and `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` feeds the instance to every
`library`, `settings`, and job-heavy child. The library page
(`packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`) and its helper `LibraryActionBar` consume this
layout-provided data to build Open-in links, and the server-side
`packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts` always talks to the canonical `instance.url`. Adding
`external_url` simply extends the row so those shared loaders immediately expose the resolved
browser target while all backend flows continue to rely on `instance.url`.

## Critical Files Reference

- `docs/plans/external-url/feature-spec.md`: business requirements, success criteria, and the
  `external_url` fallback rule for new and existing instances.
- `docs/plans/external-url/research-technical.md`: data-model implications, action wiring, helper
  guidance, and explicit admonitions to keep backend clients on `url`.
- `docs/plans/external-url/research-patterns.md`: recommended query-layer single-source-of-truth and
  the shared SvelteKit action funnel for validation.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: centralizes persistence for `arr_instances`, so it
  must expose and normalize `external_url` with the rest of the input types.
- `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: the form that must seed, display, and submit the
  optional field alongside the hidden `<form>` that drives `/arr/new` and `/arr/[id]/settings`
  actions.
- `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte` and
  `packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: runtime link builders that need
  the shared resolver to keep every toolbar and row link in sync.

## Patterns to Follow

- **Query-layer single source**: keep
  `ArrInstance`/`CreateArrInstanceInput`/`UpdateArrInstanceInput` in
  `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` as the sole contract for the new `external_url`
  metadata.
- **SvelteKit action funnel**: continue the `FormData` parsing → validation (`fail`) →
  `arrInstancesQueries.create/update` → `redirect(303, …)` flow in
  `packages/praxrr-app/src/routes/arr/new/+page.server.ts` and `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`, treating
  `external_url` as optional and normalizing blanks to `null`.
- **Layout-propagated context**: rely on `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` to refresh
  `instance` after saves so every child route gets the updated field without extra fetch logic.
- **Shared Open-in resolver**: compute
  `const openUrl = instance.external_url?.trim() || instance.url` once and use it in
  `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`, `LibraryActionBar.svelte`, `CardView.svelte`, and
  `TableView.svelte` so the “Open in” destinations never drift.

## Cross-Cutting Concerns

- Maintain the canonical API URL: `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`, all sync job processors
  under `packages/praxrr-app/src/lib/server/jobs`, and the connection test `packages/praxrr-app/src/routes/arr/test/+server.ts` must
  continue to use `instance.url` and ignore `external_url` even after the UI adds the new field.
- Keep validation & UX aligned: `docs/plans/external-url/research-ux.md` signals that `External URL`
  is optional, uses helper copy like “Used for Open in links. API calls still use URL,” and surfaces
  inline errors (e.g., “must be a valid http(s) URL”) without triggering tests.
- Normalize state: migration `packages/praxrr-app/src/lib/server/db/migrations/0XX_add_arr_instances_external_url.ts`
  plus `packages/praxrr-app/src/lib/server/db/migrations.ts` must register the column so existing rows default to
  `NULL`, and `InstanceForm.svelte`/actions must trim whitespace so clearing the field immediately
  falls back to `instance.url`.
- Document behavior: `docs/plans/external-url/research-docs.md` highlights that
  `docs/ARCHITECTURE.md` and `docs/api/v1/paths/arr.yaml` remain relevant for understanding how the
  library endpoint and Arr jobs consume `arr_instances` metadata.

## Parallelization Opportunities

- **Data contract & queries**: add the migration and extend
  `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` to expose `external_url`, allowing backend schemas to
  deploy independently of UI work (`docs/plans/external-url/research-technical.md`).
- **Settings surface**: update `InstanceForm.svelte` and the `/arr/new` plus `/arr/[id]/settings`
  actions to surface, validate, and persist the field concurrent with the new column
  (`docs/plans/external-url/research-patterns.md`).
- **Library links**: once the model exposes `external_url`, derive the resolved browser URL in
  `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`/`LibraryActionBar.svelte` and refresh cached links in
  `libraryCache` without waiting for list-view parity
  (`docs/plans/external-url/research-recommendations.md`).
- **List view parity**: follow up by refactoring `packages/praxrr-app/src/routes/arr/views/CardView.svelte` and
  `packages/praxrr-app/src/routes/arr/views/TableView.svelte` to consume the same helper, ensuring all Open-in buttons
  consolidate the resolver (`docs/plans/external-url/research-recommendations.md`).
- **Regression testing**: add focused unit/E2E tests tracking create/update actions and fallback
  behavior for library links once the resolver helper exists
  (`docs/plans/external-url/research-patterns.md`).

## Implementation Constraints

- **Backend dependency**: no backend client (Arr jobs, releases, library fetches, cleanup, log
  viewer) may consume `external_url`; they must continue calling
  `createArrClient(instance.url, instance.api_key)`
  (`docs/plans/external-url/research-technical.md`, `packages/praxrr-app/src/lib/server/jobs/handlers`).
- **UI fallback**: every “Open in” surface must resolve its target via the shared expression, so
  cached payloads (e.g., `packages/praxrr-app/src/lib/client/stores/libraryCache.ts` /
  `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`) refresh after saves and no stale links remain
  (`docs/plans/external-url/research-docs.md`).
- **Validation regime**: `InstanceForm.svelte`/actions must treat `external_url` as optional, trim
  whitespace, validate absolute `http(s)` syntax when present, and persist `NULL` when empty to
  satisfy `docs/plans/external-url/feature-spec.md` success criteria.
- **Migration footprint**: keep the new column nullable, document it in `schema.sql`, and register
  the migration in `packages/praxrr-app/src/lib/server/db/migrations.ts` so there is no backward-incompatible step for
  existing deployments (`docs/plans/external-url/research-patterns.md`).
- **User communication**: UX guidance (`docs/plans/external-url/research-ux.md`) requires clear
  helper copy, inline validation, and consistent resolver messaging so operators understand the dual
  semantics immediately.

## Key Recommendations

- Create a shared helper (e.g., `resolveArrBrowserUrl(instance)`) so every UI surface reuses the
  fallback logic and links refresh simultaneously when `external_url` changes
  (`docs/plans/external-url/research-recommendations.md`).
- Log both `url` and `external_url` presence when saving to ease debugging while keeping API keys
  out of logs (`docs/plans/external-url/research-patterns.md`).
- Add regression tests for create/update actions (missing/cleared/external URL set) plus UI coverage
  ensuring the library action bar and row links use the resolver, leaving list-view parity as a
  deliberate follow-up (`docs/plans/external-url/research-recommendations.md`).
- Preserve all backend flows on the canonical `url` and call out that requirement in documentation
  updates (e.g., `docs/API` or `docs/ARCHITECTURE.md`) so future work doesn’t drift into using
  `external_url` for API traffic (`docs/plans/external-url/research-technical.md`).
