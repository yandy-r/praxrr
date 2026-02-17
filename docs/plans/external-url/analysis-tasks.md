# Task Structure Analysis: external-url

## Executive Summary

The feature decouples the browser-facing “Open in” destination from the backend `url` so Docker/internal deployments can render usable links while server traffic continues to hit the canonical endpoint. The implementation touches four domains—schema/migrations, query/form/server action plumbing, layout/instance exposure, and every UI surface that currently renders `instance.url`. This analysis documents an execution plan that keeps those concerns separate and surfaces dependencies before codifying the required tasks.

## Recommended Phase Structure

1. **Phase 1 – Data contract & query expansion**: add the nullable `external_url` column, register the migration, document it in `schema.sql`, and extend `arrInstancesQueries` so every create/update/get path knows about the new field. Migration/schema work can be parallelized with query/type updates once the column name is locked.
2. **Phase 2 – Instance settings & actions**: add the optional `External URL` input, hidden form plumbing, dirty tracking, and logging plus the server-side parsing/validation in `src/routes/arr/new/+page.server.ts` and `src/routes/arr/[id]/settings/+page.server.ts`. This phase depends on Phase 1 for query signatures but splits cleanly into UI and action/parsing workstreams that can run concurrently as soon as the data contract is ready.
3. **Phase 3 – UI link adoption**: create a single resolver (`openUrl = instance.external_url?.trim() || instance.url`) and wire it through `LibraryActionBar`, the library row anchors, the landing-page cards, and the table view. The resolver can live next to the layout data or in a small helper so the components only consume it.
4. **Phase 4 – Verification & docs**: add regression tests for add/edit/clear flows plus fallback behavior, update release notes/docs, and double-check `arr/test`/client flows still read `instance.url`. This phase can overlap with Phase 3 once the resolver exists.

## Task Granularity Recommendations

- **Migration work**: split into the new migration file, schema documentation, and registry update so reviewers can focus on schema changes without UI noise.
- **Query layer**: separate extending the exported types (`ArrInstance`, inputs) from SQL rewrites and normalization logic (`external_url?.trim() || null`). Each piece should also update the helper functions that build `INSERT` and `UPDATE` statements.
- **Form/action plumbing**: treat the visible `External URL` input, dirty-store seed, and hidden `<input name="external_url">` as one subtask, and the server-side parsing/validation of that field as another, so the UI and backend validation stay aligned.
- **UI adoption**: introduce the shared resolver once, then apply it to each component—`LibraryActionBar`, library row `baseUrl`, `CardView`, and `TableView`—in parallel, keeping each change thin and testable.

## Dependency Analysis

- **Phase sequencing**: Phase 2 (forms/actions) can’t land until Phase 1 exposes `external_url` in the query layer; Phase 3 depends on Phase 2 because the layout must reliably supply the new field.
- **Within-phase dependencies**: the hidden form submitors must include `external_url` before server actions validate it. The shared resolver must be defined before updating any component that consumes it.
- **Parallelization guidance**: migration/schema work and query/type updates can proceed independently in Phase 1. Within Phase 2, UI (InstanceForm) and server actions (`/arr/new`, `/arr/[id]/settings`) can be worked on simultaneously with clear contracts on trimmed/nullable behavior. In Phase 3, the library page/toolbar and the landing-page views (card/table) can be updated in parallel once the helper exists.

## File-to-Task Mapping

| File                                                                         | Task(s)                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/db/migrations.ts`                                            | Register the new `external_url` migration so it runs alongside existing schema changes.                                                                                                                                             |
| `src/lib/server/db/migrations/0XX_add_arr_instances_external_url.ts` _(new)_ | `ALTER TABLE arr_instances ADD COLUMN external_url TEXT NULL`, preserve `updated_at` semantics if needed, and ensure any default behavior keeps prior rows unchanged.                                                               |
| `src/lib/server/db/schema.sql`                                               | Document `external_url` next to `url` in the `arr_instances` definition so the canonical schema reference matches production.                                                                                                       |
| `src/lib/server/db/queries/arrInstances.ts`                                  | Expose `external_url` on `ArrInstance`, `CreateArrInstanceInput`, `UpdateArrInstanceInput`; wire it through `INSERT`/`UPDATE`, normalize blank strings to `null`, and ensure helper callers (create/update actions) pass the value. |
| `src/routes/arr/components/InstanceForm.svelte`                              | Add the `External URL (optional)` field, helper copy, dirty-state seeding for edits, and a hidden `<input name="external_url">` so the enhanced form sends the value.                                                               |
| `src/routes/arr/new/+page.server.ts`                                         | Trim/validate the optional field, pass it to `arrInstancesQueries.create`, and normalize empty strings to `null` in logs/values.                                                                                                    |
| `src/routes/arr/[id]/settings/+page.server.ts`                               | Parse `external_url`, include it in the update payload, and keep logging of `url` vs `external_url` for debugging.                                                                                                                  |
| `src/routes/arr/[id]/+layout.server.ts`                                      | No code change, but confirm it continues returning the `instance` row so all descendant routes see `external_url` once the query layer includes it.                                                                                 |
| `src/routes/arr/[id]/library/+page.svelte`                                   | Compute `baseUrl`/`handleOpen` from the shared resolver, metadata for `LibraryActionBar`, and re-use the resolved URL for the `/movie`, `/series`, and `/artist` anchors.                                                           |
| `src/routes/arr/[id]/library/components/LibraryActionBar.svelte`             | Invoke the resolved URL in `onOpen` so the toolbar button matches row-level links.                                                                                                                                                  |
| `src/routes/arr/views/CardView.svelte`                                       | Use the resolver for the `ExternalLink` button and consider showing a helper badge if desired (but avoid exposing both URLs).                                                                                                       |
| `src/routes/arr/views/TableView.svelte`                                      | Update the `TableActionButton` to call `window.open` with the resolved URL instead of `instance.url`, and keep the `Badge` display limited to the canonical `url` if that matches existing UX.                                      |
| `src/tests/...` _(targeted)_                                                 | Add regression coverage for create/update actions (with/without `external_url`) and for UI fallback behavior if feasible (unit/visual tests for library and list surfaces).                                                         |

## Optimization Opportunities

- Factor the `external_url || url` expression into a tiny utility (e.g., `resolveArrBrowserUrl(instance)` or a derived store) so every component reuses the same fallback and trimming logic, keeping future surfaces easy to patch.
- Normalize `external_url` to `null` in one place (query layer) so downstream code can assume truthiness implies a valid string.
- Guard the library row links and toolbar button with a single computed `baseUrl` to avoid repeating exports/trim logic and to make future sanitization (path preservation) easier.

## Implementation Strategy Recommendations

- Read all referenced planning docs (`feature-spec.md`, `research-technical.md`, `research-ux.md`, `research-architecture.md`, `research-docs.md`) before coding to respect the mandated knowledge transfer.
- Keep Arr API flows (jobs, `createArrClient`, `/arr/test`, `/api/v1/arr/library`/`releases`) strictly on `instance.url` to avoid regressions; only UI link surfaces should use `external_url`.
- After adding the migration, run the suite (`deno task test`, `deno task check`) or targeted tests covering the query changes and form actions to prove correctness before marking the feature complete.
- Document the rollout (release notes, changelog, `docs/plans/external-url/shared.md` updates) so operators know about the new field and the fallback semantics.
