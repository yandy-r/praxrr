# Documentation Analysis: Config Health Trends and Export

## Executive Summary

Issue [#226](https://github.com/yandy-r/praxrr/issues/226) expands an existing authenticated
Config Health detail/trend surface; it does not introduce a second analytics system. The most
important documentation contract is evidence fidelity: the chart, semantic table, trend JSON, JSON
attachment, and CSV attachment must describe the same bounded snapshot selection in
`generated_at ASC, id ASC` order. Unknown scores, missing profiles, malformed/unrecorded criteria,
and engine-version changes are explicit boundaries, not zeros or continuous lines.

The repository has strong general architecture, component, testing, and OpenAPI documentation, but
no user-facing Config Health guide. The current OpenAPI trend contract still documents only a
fixed/optional `days` sparkline with `{ generatedAt, overallScore, band }` points, and it has no
export path. Implementation therefore needs contract-first source changes, regenerated API
artifacts, source-comment corrections, a concise user/contributor guide for interpreting the new
surface, and a truthful `ROADMAP.md` closeout after the PR number and status are known.

## Must-Read Documents

| Document                                                             | Why it is required                                                                                                                    | Implementation consequence                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Issue #226](https://github.com/yandy-r/praxrr/issues/226)           | Authoritative scope, acceptance criteria, test plan, and definition of done                                                           | Preserve selectable filters, exact API/export parity, accessible non-color encoding, mobile layout, retention/version boundaries, and explicit test evidence |
| `docs/plans/config-health-trends-export/feature-spec.md`             | Consolidated evidence model, filter rules, point/criterion states, API shape, accessibility behavior, overflow policy, and edge cases | Treat the canonical trend result as the source for every representation; do not recompute or infer historical facts                                          |
| `docs/plans/config-health-trends-export/research-recommendations.md` | Records the selected implementation and rejected alternatives                                                                         | Keep a single-instance exact-profile scope, overall-only historical criteria, a route-local SVG, long-form CSV, and an atomic 10,000-point overflow response |
| `CLAUDE.md`                                                          | Repository rules for Svelte, contract-first APIs, cross-Arr semantics, generated artifacts, and validation                            | Use Svelte 5 without runes, preserve explicit Arr identity, update OpenAPI before runtime/types, and run the required graph/validation workflow              |
| `docs/api/v1/paths/config-health.yaml`                               | Current endpoint parameters, status semantics, and response references                                                                | Replace the sparkline-only trend description, define `days`/`from`/`to`/`profile`, add `422`, and add the JSON/CSV export operation                          |
| `docs/api/v1/schemas/config-health.yaml`                             | Current `ConfigHealthTrendPoint` and `ConfigHealthTrendsResponse` wire source                                                         | Model nullable scores, evidence states, per-point engine version, criteria, normalized filters, retention, counts, profiles, and boundaries                  |
| `docs/api/v1/openapi.yaml`                                           | Canonical API root and component registry                                                                                             | Register the export path and every new/renamed Config Health schema; the runtime `/api/v1/openapi.json` and published package derive from this tree          |
| `docs/api/README.md` and `packages/praxrr-api/README.md`             | Define contract/runtime ownership and the published bundle                                                                            | Change YAML sources, then regenerate; do not hand-edit generated TypeScript or bundled JSON                                                                  |
| `docs/site/src/content/docs/app/architecture.md`                     | Concise module map and portable-contract boundary                                                                                     | Keep UI/API/app-DB ownership in `packages/praxrr-app` and keep OpenAPI/runtime/generated types in lockstep                                                   |
| `docs/site/src/content/docs/app/jobs.md`                             | Describes snapshot creation and age/count retention                                                                                   | Explain retained history using current settings and earliest available evidence; do not claim which policy deleted a particular point                        |
| `docs/site/src/content/docs/app/testing.md` and `scripts/test.ts`    | Supported test entry points and alias membership                                                                                      | Put focused tests under existing Config Health paths or deliberately update the alias and its documentation                                                  |
| `ROADMAP.md`                                                         | Tracks #22/#217 foundation and explicitly lists #226 as open                                                                          | Add the delivered behavior and PR link/status only when evidenced; remove #226 from open-follow-up text without changing #224/#225                           |

### Issue and feature-spec validation contract

At minimum, the implementation closeout must report these commands from the issue/spec:

```bash
deno task test config-health
deno task check
deno task test:e2e
deno task generate:api-types
deno task bundle:api
deno task lint
git diff --check
graphify update .
```

`deno task test:e2e` requires a running server. If the full Playwright suite is environmentally
blocked, the PR must name the exact blocker and still provide focused deterministic Config Health
coverage; it must not claim the issue test plan passed. Manual evidence must cover empty, sparse,
unknown, profile-missing, multi-criterion, and multi-engine data at desktop and mobile widths, plus
JSON/CSV/table point identity and ordering parity.

## Architecture Docs

### API and generated-artifact references

- `docs/api/README.md` states the split clearly: YAML under `docs/api/v1/` is the contract and
  `packages/praxrr-app/src/routes/api/v1/**` is runtime behavior.
- `docs/api/v1/paths/config-health.yaml` currently calls the endpoint a score trend for a sparkline,
  accepts only `days >= 1`, and documents only `200`, `400`, and `404`. It must become the precise
  filter/export/status contract, including valid empty `200` results and atomic overflow `422`.
- `docs/api/v1/schemas/config-health.yaml` currently exposes a non-null integer `overallScore` and a
  response-level engine version. Those fields cannot express unknown-as-null, profile absence,
  criteria, per-point engine boundaries, retention, or the selected absolute range.
- `docs/api/v1/openapi.yaml` currently registers only summary, detail, trends, and settings paths.
  Add `/config-health/{instanceId}/trends/export` and register all supporting schemas here.
- `deno task generate:api-types` writes
  `packages/praxrr-app/src/lib/api/v1.d.ts`; `deno task bundle:api` writes
  `packages/praxrr-api/openapi.json` and copies generated types to
  `packages/praxrr-api/types.ts`. These three files are generated artifacts and must match the YAML
  diff exactly.
- `docs/api/endpoints.md` is a hand-maintained reader companion that currently omits all Config
  Health endpoints. If it remains part of the supported API documentation, add summary/detail/
  trends/export/settings together or explicitly mark it non-exhaustive; adding only the new export
  route would preserve existing drift.

### Frontend and accessibility references

- `docs/site/src/content/docs/app/components/forms.mdx` documents `DateInput` and existing form
  conventions useful for custom bounds. The final filter controls still need native labels,
  keyboard operation, applied-vs-draft state, and a visible updating status.
- `docs/site/src/content/docs/app/components/cards.md`, `tables.md`, and `feedback.md` document the
  reusable Card/Table/EmptyState vocabulary. The historical evidence table should be semantic and
  complete rather than treated as optional expanded content; distinct never-collected,
  filtered-empty, overflow, and fetch-error states need purpose-written copy.
- `docs/site/src/content/docs/app/components/patterns.md` documents Tailwind and alert/store
  conventions. Trend request state should remain route-local unless a real cross-route consumer is
  introduced.
- [W3C WAI Complex Images](https://www.w3.org/WAI/tutorials/images/complex/) and
  [WCAG 2.2](https://www.w3.org/TR/WCAG22/) are the normative interpretation references already
  selected by the feature spec: concise chart summary, full structured equivalent, keyboard/touch
  access, visible focus, non-color encodings, contrast, and reflow are requirements rather than
  polish.

### Export references

- `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts` has the clearest source
  comments for fixed CSV columns, RFC 4180 quoting, formula neutralization, and attachment headers.
- `packages/praxrr-app/src/routes/api/v1/timeline/export/+server.ts` demonstrates a list/export pair
  sharing one filter/service path and repeats the same CSV security rules.
- Those routes are precedent, not a contract to copy blindly: both use a logged-only 50,000-row
  cap/truncation policy, while #226 requires `limit + 1` detection and a `422` with no partial chart
  or attachment.
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html),
  [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html),
  [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html), and
  [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) define the JSON, CSV,
  attachment, and spreadsheet-safety behavior selected by the feature spec.

### Source comments that carry or currently contradict the design

- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` correctly documents
  append-only history and statement-atomic insertion, but `SnapshotProfileScore` says the full
  breakdown is recomputed live. That is true for a current report and unsafe as historical guidance;
  update the comment to say snapshots persist profile score/band only and historical profile
  criteria must not be recomputed.
- The same query module documents `getTrend(instanceId, days?)` and wraps `generated_at` in
  `datetime(...)`. Replace that comment with the canonical absolute-bound, selected-column,
  `cap + 1`, `generated_at ASC, id ASC` query contract and note why canonical ISO comparison keeps
  the index usable.
- `packages/praxrr-app/src/routes/api/v1/config-health/[instanceId]/trends/+server.ts` still names
  `?days=N`, a persisted overall-only sparkline, and an optional day bound. Update its route comment
  to enumerate the canonical filters and shared projector; the export handler should explicitly say
  it invokes the same parser/service and never refilters or reorders.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.svelte` comments describe fixed
  index-spaced sparkline geometry and silently ignored trend failures. Replace them with comments
  around real-time scaling, segmentation boundaries, accessible inspection, and independently
  visible trend retry behavior.
- `packages/praxrr-app/src/routes/config-health/[instanceId]/+page.server.ts` already documents that
  the HTTP routes are authoritative and that invalid path params render inline. Preserve that
  ownership while adding safe active instance options if the feature adds an instance selector.

## Reading List

### Required before implementation

1. Issue #226, `feature-spec.md`, and `research-recommendations.md` for acceptance, evidence states,
   selected trade-offs, and test obligations.
2. `CLAUDE.md`, `docs/site/src/content/docs/app/architecture.md`, and the three Config Health
   OpenAPI YAML files for repository and public-contract constraints.
3. `configHealthSnapshots.ts`, its DB tests, the current trends route, and
   `$lib/server/health/responses.ts` for persistence/query/wire ownership.
4. The Config Health detail page and component docs for filters, tables, cards, errors, and
   responsive composition.
5. Sync History and Timeline export handlers for attachment/CSV precedent, followed by the RFC/OWASP
   references for normative behavior.
6. `scripts/test.ts`, the Config Health route/query tests, Playwright config/spec precedents, and the
   testing guide for executable validation.
7. `ROADMAP.md` immediately before closeout so all #226 open-status references are updated against
   the actual PR state.

### Nice to read or use as precedent

- `docs/ARCHITECTURE.md` and `docs/architecture/overview.md` for broad repository placement; the
  Starlight app architecture page is the faster feature-level map.
- `docs/plans/sync-history/design.md` for detailed export/retention rationale and
  `docs/plans/health-degraded-notifications/*` for adjacent Config Health evidence semantics.
- `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts` for deterministic
  API interception, keyboard UX, long-label, and mobile viewport patterns.
- `research-ux.md`, `research-security.md`, `research-practices.md`, and `research-technical.md` in
  this feature directory when implementing their specific UI, security, test, or query slices.
- `README.md` for product vocabulary. It does not currently promise Config Health behavior, so a
  release-note edit is optional unless maintainers want the feature advertised there.

## Documentation Gaps

1. **OpenAPI trend contract is obsolete for #226:** it documents only optional `days`, overall
   integer score/band points, and one response-level engine version. Update paths, schemas, root
   refs, error statuses, examples, empty semantics, and export media/attachment behavior before
   runtime implementation.
2. **Export is absent from every API artifact:** add the YAML path/schema, then regenerate
   `v1.d.ts`, bundled `openapi.json`, and published `types.ts`. Verify generated diffs rather than
   editing outputs manually.
3. **No Config Health user/contributor guide exists:** add a compact Starlight page (for example
   `docs/site/src/content/docs/app/config-health.md`) covering snapshot cadence/retention, exact
   profile scope, range filters, unknown/missing/not-recorded states, engine boundaries, JSON vs CSV,
   and why historical criteria are overall-only. Link to jobs, notifications, API, and testing rather
   than duplicating their implementation detail.
4. **API endpoint index is incomplete:** `docs/api/endpoints.md` omits the existing Config Health
   surface. Either bring it current for all Config Health routes or state that the generated OpenAPI
   reference is exhaustive and the hand-written index is intentionally selective.
5. **ROADMAP obligation:** #226 is named as open at least in the Config Health priority row and the
   later checklist/summary. At PR creation update every #226 status reference consistently, add the
   PR link and actual state, and leave #224/#225 untouched. Do not say shipped/merged before merge.
6. **Historical-profile comment is misleading:** current source says full profile breakdown is
   recomputed live. Explicitly distinguish live detail computation from the stored score/band-only
   history so future maintainers do not fabricate profile criterion trends.
7. **Trend route/query comments encode the old implementation:** replace fixed-day sparkline,
   index-spaced line, `datetime()` range, and silently optional fetch descriptions with the new
   bounded canonical-query, segmentation, and visible secondary-error contracts.
8. **Testing guide needs a scope check after implementation:** `config-health` already covers route,
   DB, engine, snapshot, cleanup, and notification files. If new pure helpers or E2E specs land
   outside those paths, extend `scripts/test.ts` and update the guide; otherwise document that no
   alias change was necessary. Add focused Playwright invocation guidance if the E2E runner supports
   it.
9. **No chart component documentation is required yet:** keep geometry and interaction route-local
   for #226. Add `$ui/chart` component docs only if implementation deliberately creates a reusable
   chart API; do not pre-document an abstraction that does not exist.
10. **Retention wording must stay evidence-bounded across UI/API/docs:** current policy and earliest/
    newest retained timestamps are known; the reason a particular older point disappeared is not.
    Avoid statements such as "pruned by the 90-day policy" unless provenance is added later.
