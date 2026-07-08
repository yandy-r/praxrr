# Dependency Graph — Implementation Plan (issue #26)

> Ordered, dependency-aware plan produced by the `depgraph-plan` workflow (3 validators
> → planner → adversarial critic, verdict **ready-with-fixes**). All critique fixes and
> scope decisions below are baked in. Mirrors Resolved Config (#25 / PR #207).

## Scope decisions (final)

- **SVG `DependencyGraphCanvas` DEFERRED** to a documented fast-follow. Greenfield
  (no inline-data-viz precedent exists in the client — the ParityMatrix "SVG" claim was
  wrong), and issue #26 explicitly says "start simple: table/list view, **not** a full
  graphical visualization." The expandable `AdjacencyTable` (in/out degree,
  expand-to-neighbors, click-to-navigate, per-arr chips) fully satisfies phase-1. This
  also removes the ViewToggle blocker (`ViewToggle` is hardcoded to table/cards).
- **`sanitizeBigInts` extracted to a shared util** (`$http/sanitizeBigInts.ts`),
  consumed by both `resolved/shared.ts` (refactor) and `graph/shared.ts` — no third copy
  (CLAUDE.md DRY MUST).
- **QP/quality node compatibility via `computeProfileCompatibility(cache)`** (single
  pass returning `{name, compatibleArrTypes}`), not 3× `computeCompatibleProfileNames`.
- **Impact route uses a `[...name]` rest param** so entity names containing `/` work;
  impact is returned directly (no trailing `/impact` segment). Client `encodeURIComponent`.
- **Op-snapshot regression test lands BEFORE the DRY refactor** (guard-before-refactor);
  it asserts the handlers emit byte-identical `writeOperation` args pre/post refactor.
- **Full-graph endpoint carries a `truncated` flag + edge cap** (defensive; curated PCDs
  are small).
- **CF + regex editors** get the "Used by" panel + cascade copy. QP / quality /
  quality-definition editors are **intentionally excluded** (nothing depends on them in
  the reverse edge model; QP forward deps are visible on the graph page). Documented.

## Verified facts that shape the code (from validators)

- `ExpandableTable` (`$ui/table/ExpandableTable.svelte`): **no `rowHref`**; `getRowId`
  **required**; custom cells + nav links via `<svelte:fragment slot="cell" let:row let:column>`;
  neighbor lists via `slot="expanded" let:row`; ignores `Column.cell`.
- `Badge` (`$ui/badge/Badge.svelte`): `variant` incl. `radarr|sonarr|lidarr|neutral|info|accent`, `size sm|md`, `icon`, `mono`.
- `CompatibilityBadges` (`$ui/parity/CompatibilityBadges.svelte`): props `compatibleArrTypes: ArrAppType[]`, `label`.
- `Button` (`$ui/button/Button.svelte`): `text`, `variant`, `href` (renders `<a>`), `icon`, emits `on:click`.
- Delete confirm = generic `$ui/modal/Modal.svelte`: `header`, `bodyMessage` (or `slot="body"`), `confirmText`, `confirmDanger`, `on:confirm`/`on:cancel`.
- No-CTA empty state = inline dashed-border div (`ResolvedStatePanel` precedent); `EmptyState` forces a CTA (use only for the no-DB landing → `/databases`).
- `nodeStyles.ts` mirrors `$ui/resolved/fieldChangeDisplay.ts` (`.ts` Record + helpers, imported with explicit `.ts`).
- `sanitizeBigInts` currently route-local in `resolved/shared.ts:87`; `isBuilt()` is on `PCDCache` (from `pcdManager.getCache(id)`), not `pcdManager`; digit validation inline per `+server.ts`; unknown/unbuilt db → **400** (404 reserved for by-name node miss).
- `generate:api-types` writes **only** `packages/praxrr-app/src/lib/api/v1.d.ts`; the `packages/praxrr-api` mirror is a separate `bundle:api` step (out of scope).
- DRY targets verified: `customFormats/delete.ts:30` orders by `(quality_profile_name, arr_type)`; `customFormats/general/update.ts` applies **no orderBy** (relies on Map insertion order — the extracted reader must make orderBy **opt-in**); `regularExpressions/delete.ts:37` needs the 6-column superset. **No existing fast unit test** covers these handlers.

## Phases & tasks (dependency-ordered)

### Phase 1 — Contract-first API

- **P1-T1** create `docs/api/v1/paths/graph.yaml`, `docs/api/v1/schemas/graph.yaml`; wire refs into `docs/api/v1/openapi.yaml`. Schemas: `GraphNode`, `GraphEdge`, `DependencyGraphResponse`, `GraphImpactResponse`. Reuse `ErrorResponse`.
- **P1-T2** run `deno task generate:api-types` → commit `src/lib/api/v1.d.ts` in lockstep. `[deps: P1-T1]`

### Phase 2 — Server module `$pcd/graph/` + shared util + barrel

- **P2-T0** create `$lib/server/utils/http/sanitizeBigInts.ts`; refactor `resolved/shared.ts` to import it (guarded by `resolvedConfigApi.test.ts`).
- **P2-T1** `graph/types.ts` — `NodeKind`/`EdgeKind` unions, `GraphNode`/`GraphEdge`/`GraphImpactResult`/`AdjacencyRow`; `GraphValidationError`(400)/`GraphDatabaseNotFoundError`(400)/`GraphNodeNotFoundError`(404) + `is*` guards. `[deps: P1-T2]`
- **P2-T2** `graph/edges.ts` — `EdgeDef` catalog E1–E4 with `reverse()`/`forward()` Kysely queries + `NodeKind` guard. `[deps: P2-T1]`
- **P2-T3** `graph/compat.ts` — annotate QP + quality nodes via `computeProfileCompatibility(cache)`. `[deps: P2-T1]`
- **P2-T4** `graph/references.ts` — `getCustomFormatDependents(cache,name,{orderBy?})` and `getRegularExpressionDependents(cache,name)` (6-col superset) returning exact handler rows; plus `getCustomFormatReferences`/`getRegularExpressionReferences` → `{dependents,countsByArr}`. `[deps: P2-T2]`
- **P2-T5** `graph/resolver.ts` — `getImpact(cache,node,{depth,direction})` (bounded reverse BFS, depth≤3, visited cap, `truncated`), `getDependencies`, `buildDependencyGraph(cache,{arrType?,nodeKind?})` (nodes+degree+routeId+compat+edges, edge cap + `truncated`). `[deps: P2-T2,P2-T3]`
- **P2-T6** barrel: re-export public graph symbols from `$pcd/index.ts`. `[deps: P2-T4,P2-T5]`

### Phase 3 — API routes

- **P3-T1** `routes/api/v1/pcd/[databaseId]/graph/shared.ts` — databaseId resolve/validate, typed error→Response map, import shared `sanitizeBigInts`. `[deps: P2-T6]`
- **P3-T2** `graph/+server.ts` — `GET` full graph, `?arrType=`/`?nodeKind=`. `[deps: P3-T1]`
- **P3-T3** `graph/[nodeKind]/[...name]/+server.ts` — `GET` impact, `?direction=`/`?depth=`/`?arrType=`. `[deps: P3-T1]`

### Phase 4 — DRY refactor (behavior-preserving; AFTER P9-T2 guard is green on current code)

- **P4-T1** `customFormats/delete.ts` → `getCustomFormatDependents(cache,name,{orderBy:['quality_profile_name','arr_type']})`. `[deps: P2-T4, P9-T2]`
- **P4-T2** `customFormats/general/update.ts` → `getCustomFormatDependents(cache,name)` (no orderBy). `[deps: P2-T4, P9-T2]`
- **P4-T3** `regularExpressions/delete.ts` → `getRegularExpressionDependents(cache,name)`. `[deps: P2-T4, P9-T2]`

### Phase 5 — Nav

- **P5-T1** `iconMap.ts` — add `Network` import + `NAV_ICON_MAP` entry.
- **P5-T2** `registry.ts` — add overview entry order 3, `iconKey:'Network'`, emoji 🔗, `arrScope:scopeAll`, `href:'/dependency-graph'`. `[deps: P5-T1]`

### Phase 6 — Shared client UI `$ui/graph/`

- **P6-T1** `nodeStyles.ts` — per-kind `NODE_META` (label, Badge variant, editor-route builder; leaf kinds → null href). `[deps: P1-T2]`
- **P6-T2** `cascadeSummary.ts` — `formatCascadeSummary(impact)`. `[deps: P1-T2]`
- **P6-T3** `DependencyImpact.svelte` — reusable "Used by" panel (per-arr Badges, editor links, "View in graph" Button). `[deps: P6-T1]`

### Phase 7 — Client graph page

- **P7-T1** bare `routes/dependency-graph/+page.server.ts` (`pcdManager.getAll()`) + `+page.svelte` (redirect + no-DB `EmptyState`). `[deps: P5-T2]`
- **P7-T2** `routes/dependency-graph/[databaseId]/+page.server.ts` (validate id + `cache?.isBuilt()`, inline `{databases,selectedDatabaseId,error?}`) + `+page.svelte` (DB select, arrType/nodeKind filters, client-fetch with `++requestId` guard, `?focus=`). `[deps: P3-T2,P6-T1,P7-T1]`
- **P7-T3** `AdjacencyTable.svelte` (default view over `ExpandableTable`, cell-slot links, expanded neighbor lists). `[deps: P7-T2]`

### Phase 8 — Editor integration

- **P8-T1** CF general editor: eager `impact` in `custom-formats/[databaseId]/[id]/general/+page.server.ts`; render `DependencyImpact` + cascade delete copy in `GeneralForm.svelte`. `[deps: P2-T4,P6-T2,P6-T3]`
- **P8-T2** regex editor: eager `impact` in `regular-expressions/[databaseId]/[id]/+page.server.ts`; render in `RegularExpressionForm.svelte` (pass `impact` as explicit prop — it doesn't import the page store). `[deps: P2-T4,P6-T2,P6-T3]`

### Phase 9 — Tests

- **P9-T2** `src/tests/pcd/graph/references.test.ts` — **op-equivalence guard** (write BEFORE P4): capture the exact `writeOperation` args for a fixture CF delete / CF rename / regex delete, assert unchanged after refactor. Also assert reader row order/columns. `[deps: P2-T4]`
- **P9-T1** `edges.test.ts` (E1 'all' distinct; E2 arr_type from parent condition; **E3 grouped vs direct XOR incl. `groupName`**; **E4 same quality across per-arr tables → distinct per-arr edges**), `compat.test.ts` (compat via `computeProfileCompatibility`; all-disabled profiles still considered), `resolver.test.ts` (BFS caps, `truncated`, `routeId` populated). `[deps: P2-T2,P2-T3,P2-T5]`
- **P9-T3** `src/tests/routes/dependencyGraphApi.test.ts` — auth 401, digits-only db, unbuilt-db 400 (not 404), by-name node 404, arrType validation, `sanitizeBigInts` applied, **reserved-char name (space)**. `[deps: P3-T2,P3-T3]`
- **P9-T4** `tests/e2e/dependency-graph.spec.ts` — landing redirect+localStorage, DB switch, table render + expand-to-neighbors + node click-navigation, editor "Used by" + cascade delete copy. `[deps: P7-T3,P8-T1,P8-T2]`

## Validation gates (run incrementally + before "done")

```
deno task generate:api-types   # after OpenAPI edits; commit v1.d.ts in lockstep
deno task check                # deno check (server) + svelte-check (client) — after every phase
deno task lint                 # prettier --check + eslint
deno task test                 # all unit + route tests incl. src/tests/pcd/graph/*
deno task test:e2e             # Playwright (needs dev server; test:e2e:reset for state)
graphify update .              # refresh knowledge graph after implementation
```

## Execution notes

- Contract lockstep: OpenAPI authored before any handler that imports generated types;
  regen + commit `v1.d.ts` in the same change. Do **not** run `bundle:api` (separate mirror).
- DRY refactor: `references.ts` orderBy is opt-in; op-generation stays in handlers; the
  op-snapshot test is the gate; existing e2e specs (CF delete 1.10/1.16, CF rename
  2.44/1.27, regex delete 3.6/1.23) are the behavioral backstop.
- Cross-Arr: every arr-scoped edge resolves by explicit `arr_type`, `'all'` stays
  distinct and never establishes per-arr QP validity; no sibling fallback.
- Keep every file under the ~500-line soft cap.
