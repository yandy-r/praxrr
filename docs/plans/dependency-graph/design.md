# Dependency Graph — Design (issue #26)

> Transparency Layer feature. Visualize resolved dependencies between PCD config
> entities: which custom formats are scored by which quality profiles, which
> regular expressions are used by which custom formats, which qualities a profile
> enables, and how deleting/renaming an entity cascades downstream. Pairs with
> Resolved Config (#25, PR #207) and mirrors its architecture exactly.

## Provenance

Produced by the `depgraph-design` design workflow (5 codebase readers → 3 candidate
designs → judged synthesis). Chosen approach: **KISS adjacency resolver + inline
editor impact panels (mandatory core)** plus a **hand-rolled, zero-dependency inline
SVG canvas behind a ViewToggle (progressive enhancement)**. Cytoscape/D3 rejected as
a runtime dependency (fails the issue's "start simple" guidance; ~110KB + SSR hazard
for pure polish over a table that already satisfies every requirement).

## Locked scope decisions (phase 1 / first PR)

| Question                   | Decision                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node kinds                 | `custom_format`, `regular_expression`, `quality_profile`, `quality`, `quality_definition`. Tags/languages deferred.                                                                                                                                                           |
| Impact endpoint directions | Both `dependents` (reverse, primary) and `dependencies` (forward).                                                                                                                                                                                                            |
| SVG canvas                 | **DEFERRED to fast-follow** (see `parallel-plan.md`). Greenfield with no client precedent; issue says "start simple: table/list view, not a full graphical visualization". The expandable `AdjacencyTable` satisfies phase-1. Removes the ViewToggle blocker.                 |
| Editor integration         | **CF and regex editors** get a "Used by" section + cascade-aware delete copy. QP / quality / quality-definition editors intentionally excluded (nothing depends on them in the reverse model; QP forward deps visible on the graph page).                                     |
| DRY refactor               | **Narrowed**: extract only the reverse-dependency **query definitions** into `graph/references.ts` (orderBy opt-in); op-generation logic stays in the delete/update handlers (behavior-preserving). Guarded by an op-snapshot regression test landed **before** the refactor. |
| `sanitizeBigInts`          | Extracted to a shared `$http/sanitizeBigInts.ts` util (no third route-local copy); `resolved/shared.ts` refactored to import it.                                                                                                                                              |
| QP/quality compat          | Use `computeProfileCompatibility(cache)` (single pass) — not 3× `computeCompatibleProfileNames`.                                                                                                                                                                              |
| Impact route               | `[...name]` rest param (handles `/` in names); impact returned directly.                                                                                                                                                                                                      |

> **Final authoritative scope + task order: `parallel-plan.md`.** This design's endpoint
> shapes below predate two corrections applied there: the impact route is
> `graph/[nodeKind]/[...name]` (no trailing `/impact`), and the SVG canvas is deferred.
> | Nav | Overview group, order 3 (after Databases 0, Parity Map 1, Resolved Config 2). `iconKey: 'Network'` (add to `iconMap.ts`; fallback `'Link'` needs no edit), emoji 🔗. |

## Data model

All reads are **read-only** against the registered, built PCD cache
(`pcdManager.getCache(databaseId).kb`, a Kysely instance). No materialized graph —
edges are computed on demand from small indexed reads, always fresh. Nodes are
**name-keyed** (never route ids); a separate integer `routeId` is selected alongside
the name for linkable kinds.

```ts
type NodeKind =
  | 'custom_format'
  | 'regular_expression'
  | 'quality_profile'
  | 'quality'
  | 'quality_definition';
type GraphArrType = 'radarr' | 'sonarr' | 'lidarr' | 'all'; // = ArrType; NOT ArrAppType

interface GraphNode {
  kind: NodeKind;
  name: string;
  routeId: number | null; // custom_formats.id / quality_profiles.id / regular_expressions.id; null = leaf (quality, quality_definition) → non-clickable
  inDegree: number; // # of edges pointing at this node (referenced-by count)
  outDegree: number; // # of edges leaving this node (depends-on count)
  compatibleArrTypes?: ArrAppType[]; // quality_profile + quality nodes only
}

interface GraphEdge {
  from: { kind: NodeKind; name: string }; // referrer
  to: { kind: NodeKind; name: string }; // dependency
  edgeKind: EdgeKind;
  arrType: GraphArrType; // 'all' kept DISTINCT, never expanded to per-arr
  score?: number; // E1 only
  groupName?: string; // E3 grouped path only
}
```

### Edge catalog (`graph/edges.ts` — single source of truth)

Each edge family is an `EdgeDef` with `reverse(cache, name)` and `forward(cache, name)`
Kysely queries. Direction is **referrer (from) → dependency (to)**.

- **E1 `quality_profile → custom_format`** (arr-scoped). From
  `quality_profile_custom_formats(quality_profile_name, custom_format_name, arr_type, score)`.
  `reverse(cf)` = `WHERE custom_format_name = ?` — this is the **exact query currently
  inlined in `customFormats/delete.ts`** (verified) and `customFormats/general/update.ts`;
  `forward(qp)` = `WHERE quality_profile_name = ?`. `'all'` preserved verbatim.
- **E2 `custom_format → regular_expression`** (arr-scoped via parent condition). From
  `condition_patterns cp INNER JOIN custom_format_conditions cfc ON
(cfc.custom_format_name, cfc.name) = (cp.custom_format_name, cp.condition_name)`.
  `reverse(regex)` = `WHERE cp.regular_expression_name = ?` — the **exact join inlined
  in `regularExpressions/delete.ts`** (verified). `condition_patterns` has no `arr_type`;
  `arrType` is sourced from the **parent `cfc` row** (default `'all'`).
- **E3 `quality_profile → quality`** (not edge-arr-scoped). Two XOR paths per the
  schema CHECK: direct `quality_profile_qualities.quality_name`, and grouped via
  `quality_group_members` (records `groupName` on grouped edges). Mirrors
  `qualityProfiles/qualities/read.ts` join shapes.
- **E4 `quality_definition → quality`** (arr-scoped by table). From
  `radarr|sonarr|lidarr_quality_definitions.quality_name`; `arrType` inferred from which
  table the row lives in.

`quality_api_mappings` is **not** an entity edge — it is grouped by `quality_name` to
stamp each quality node's `compatibleArrTypes`, and quality-profile node
`compatibleArrTypes` come from reusing `computeCompatibleProfileNames`
(`qualityProfiles/compatibility.ts`) — **never** `arr_type='all'` score inference
(Arr-Cutover guardrail); profiles with all qualities disabled still count via that
helper.

**Impact** = bounded reverse BFS over the catalog (default depth 2, hard cap 3,
dedupe by `(kind,name)`, visited cap ~500). Responses group edges by `arrType`, flag
`truncated`, and never collapse across arrs.

Excluded phase-1 leaves: the scalar condition sub-tables (sources/resolutions/sizes/…)
hold literals not FKs; tags/languages and standalone entities (delay profiles, naming,
media settings, lidarr metadata profiles) have no in-scope cross-entity edge.

## Server module — `packages/praxrr-app/src/lib/server/pcd/graph/`

Mirrors `pcd/resolved/`. Each file has a `SOURCE` const, typed errors + `is*Error`
guards (status mapping via `instanceof`, never string-sniffed), and is under the ~500
line soft cap.

1. **`types.ts`** — `NodeKind`/`EdgeKind` unions, `GraphNode`, `GraphEdge`,
   `GraphImpactResult`, `AdjacencyRow`; `GraphValidationError` (400),
   `GraphDatabaseNotFoundError` (400), `GraphNodeNotFoundError` (404) + guards.
2. **`edges.ts`** — the `EdgeDef` catalog (E1–E4) with `reverse()`/`forward()` Kysely
   queries; the single source for edge SQL and the `NodeKind` guard.
3. **`references.ts`** — per-entity single-node reverse readers:
   `getCustomFormatDependents(cache, name)` and `getRegularExpressionDependents(cache, name)`
   return the **exact rows** (incl. value-guard columns: `score` for CF; `type/arr_type/
negate/required` for regex, ordered) that `delete.ts`/`update.ts` consume, **plus**
   higher-level `getCustomFormatReferences`/`getRegularExpressionReferences(cache, name)`
   → `{ dependents: GraphEdge[], countsByArr }` for the impact endpoint + editor panels.
   This is the DRY extraction: one query definition, three consumers (handlers, endpoint,
   editor load), op-generation unchanged.
4. **`resolver.ts`** — `getImpact(cache, node, { depth, direction })` (reverse BFS),
   `getDependencies(cache, node)` (forward depth-1), and
   `buildDependencyGraph(cache, { arrType?, nodeKind? })` assembling
   nodes(+degree,+routeId,+compat) + edges in one pass for the graph page.
5. **`compat.ts`** — thin wrapper over `computeCompatibleProfileNames` to annotate QP +
   quality nodes; no re-derivation of arr logic.

Barrel: re-export public graph symbols from `$pcd/index.ts` under a `DEPENDENCY GRAPH`
banner (routes import from the barrel). All responses derived from cache reads pass
through `sanitizeBigInts` (int64:true).

## API endpoints (contract-first)

OpenAPI path + schema authored first, then `deno task generate:api-types`, then handlers.

- `GET /api/v1/pcd/[databaseId]/graph` → `DependencyGraphResponse
{ nodes: GraphNode[]; edges: GraphEdge[]; arrTypesPresent: string[] }`, filtered by
  `?arrType=` & `?nodeKind=`. Powers both the adjacency table and the SVG canvas.
  When a concrete arr is selected, keeps edges where `arr_type IN (arrType, 'all')` and
  QP nodes whose `compatibleArrTypes` include it.
- `GET /api/v1/pcd/[databaseId]/graph/[nodeKind]/[name]/impact` → `GraphImpactResponse
{ node; referencedBy: GraphEdge[]; byArrType: Record<arrType, GraphEdge[]>; counts;
hasDownstream; truncated }` via `?arrType=`, `?direction=dependents|dependencies`,
  `?depth=` (clamped [1,3]). The focused endpoint for editor "Used by" panels and
  node-focus click-through.

Errors: unknown/unbuilt `databaseId` → **400** (nothing to fall back to); by-name node
miss → **404**; bad `nodeKind`/`arrType` → 400; unauthenticated → 401. A shared
non-route `routes/api/v1/pcd/[databaseId]/graph/shared.ts` resolves+validates
`databaseId` and maps typed errors to responses (mirrors resolved-config `shared.ts`).

## Client UI

Svelte 4 syntax (repo convention: `export let`, `$:`, `on:` directives — **no runes**;
read-only so **no DirtyModal**). `alertStore.add` for errors.

- **Nav**: one `NAV_REGISTRY` entry (see scope table). Add `Network` to `iconMap.ts`.
- **Bare `/dependency-graph`**: `+page.server.ts` returns `pcdManager.getAll()`;
  `+page.svelte` `onMount` client-redirects to `/dependency-graph/{localStorage
'dependencyGraphDatabase' | first}`; full-viewport `EmptyState` when no DBs.
- **`/dependency-graph/[databaseId]`**: `+page.server.ts` validates digits-only id +
  `cache?.isBuilt()`, returns `{ databases, selectedDatabaseId, error? }` inline (never
  throws), **no heavy fetch**. `+page.svelte` shell: DB `<select on:change>`→`goto`,
  arrType segmented control, nodeKind filter, `$ui/actions/ViewToggle.svelte`
  (Table ↔ Graph). Client-fetches `/api/v1/pcd/{id}/graph?arrType=` inside
  `onMount`/handlers (guarded by `browser`), with a `++requestId` stale-response guard
  and `ErrorResponse` → `alertStore`. Reads `?focus=kind:name` to pre-select.
  - **`AdjacencyTable.svelte`** (default) over `$ui/table/ExpandableTable.svelte`:
    columns Name; Kind `Badge`; "Depends on" (out-degree); "Referenced by" (in-degree);
    per-arr chips (`Badge` radarr/sonarr/lidarr) or `CompatibilityBadges` for QP rows;
    `rowHref`/`onRowClick` deep-links to the editor via `nodeStyles`; expand reveals the
    1-hop neighbor list as links (the click-to-navigate requirement, no JS graph needed).
  - **`DependencyGraphCanvas.svelte`** (optional) hand-rolled inline `<svg>`, zero deps:
    deterministic columnar layout (columns by kind: regex | custom_format |
    quality_profile | quality/quality_definition), vertical stacking, edges as
    `<line>`/`<path>`, `<g>` nodes clickable (`goto` editor href), hover highlights
    incident edges, node-count cap with a "best viewed in table" fallback (precedent:
    ParityMatrix hand-rolls its own strip).
- **Shared `$lib/client/ui/graph/nodeStyles.ts`** (mirrors `fieldChangeDisplay.ts`):
  `NODE_META` per-kind (label, `Badge` variant, editor-route builder; leaf kinds → null
  href) — single source reused by table, canvas, and editor sections.

## Editor integration (CF + regex)

Both hooks are fed by the same `references.ts` reader so the client-side delete modal
has cascade data synchronously (impact eager-loaded in `load()`, no new lazy round-trip).

1. **"Used by" sections** — reusable `$ui/graph/DependencyImpact.svelte` ("Used by N
   quality profiles" with per-arr `Badge`s + editor links + a "View in graph" `Button` →
   `/dependency-graph/{db}?focus=custom_format:{name}`):
   - `custom-formats/[databaseId]/[id]/general/+page.server.ts` resolves id→name (already
     does), returns `impact = getCustomFormatReferences(cache, name)`; rendered in
     `GeneralForm.svelte`.
   - `regular-expressions/[databaseId]/[id]/+page.server.ts` returns
     `impact = getRegularExpressionReferences(cache, name)`; rendered in
     `RegularExpressionForm.svelte`.
2. **Cascade warnings** — replace the static delete-confirm `bodyMessage` in
   `GeneralForm.svelte`/`RegularExpressionForm.svelte` with
   `$ui/graph/cascadeSummary.ts` `formatCascadeSummary(impact)` (e.g. "Scored by 3
   quality profiles (radarr: 2, sonarr: 1). Deleting removes those scores."). CF rename
   is a modify-cascade ("Renaming regenerates scoring ops in N profiles") from the same
   impact.
3. **DRY refactor** — move the reverse-dependency **query** in `customFormats/delete.ts`,
   `customFormats/general/update.ts`, and `regularExpressions/delete.ts` into
   `graph/references.ts`; handlers call it and keep their own grouping/op-writing.
   Value-guard/op-writing behavior preserved; protected by op-equivalence tests.

## Cross-Arr handling (policy compliance)

`arr_type` plays three distinct roles, each modeled separately, never conflated:
`quality_profile_custom_formats.arr_type` (E1), `custom_format_conditions.arr_type`
(E2, joined explicitly since `condition_patterns` has none),
`quality_api_mappings.arr_type` (quality existence per arr → QP compatibility). `'all'`
is a legal edge `arr_type` (rendered as an "all arrs" chip, kept distinct) but is **not**
an `ArrAppType` and must **not** establish per-arr QP validity — QP `compatibleArrTypes`
come **only** via `computeCompatibleProfileNames`. Every arr-scoped edge resolves by
explicit `arr_type`, no implicit sibling fallback. `lidarr_metadata_profiles` stay
lidarr-only.

## Testing strategy (mirror resolved-config)

- **Unit** (`deno task test`, `src/tests/pcd/graph/`): in-memory `PCDCache` fixtures from
  hand-written CREATE TABLE/INSERT SQL (reuse the `readers.test.ts` recipe), injectable
  deps for unpatchable ESM bindings.
  - `edges.test.ts` — each reverse/forward query returns per-arr edges, keeps `'all'`
    distinct, sources E2 `arr_type` from the parent condition.
  - `references.test.ts` — the DRY refactor is behavior-preserving: rows returned to
    `delete.ts`/`update.ts` match the pre-refactor query (byte-identical ops guard).
  - `compat.test.ts` — QP `compatibleArrTypes` route through
    `computeCompatibleProfileNames`; all-disabled profiles still considered.
  - `resolver.test.ts` — BFS depth/visited caps, `truncated` flag, `routeId` populated for
    linkable kinds.
- **Route** (`src/tests/routes/dependencyGraphApi.test.ts`): import GET handlers directly,
  patch an `_impactDependencies` seam. Auth 401, digits-only databaseId rejection,
  unbuilt-db 400 (not 404), by-name node 404, arrType validation, `sanitizeBigInts`
  applied.
- **E2e** (`deno task test:e2e`): landing redirect + localStorage, DB switch via `goto`,
  table render + expand-to-neighbors, ViewToggle → SVG + node-click navigation, editor
  "Used by" section + cascade delete-modal copy.
- **Gates**: `deno task check` (deno check + svelte-check), `deno task lint`,
  `deno task test`. Run `graphify update .` after implementation.

## Risks & mitigations

- **Op-generation regression** from the DRY refactor → narrowed to query-only extraction
  - op-equivalence regression tests + existing delete/update suites must stay green.
- **Extra read per editor render** (eager impact in `load()`) → cheap indexed read
  against the in-memory cache; required so the client delete modal has cascade data.
- **On-demand recompute per request** → single batched pass per kind + arrType/nodeKind
  filters; curated PCDs are small.
- **Deep transitive chains truncate** (depth cap) → in-scope chains (regex→CF→QP) are
  shallow; responses flag `truncated`.
- **Dense SVG looks poor** → optional behind ViewToggle with node-count cap + table
  fallback; table is default + a11y path.
- **Missing `routeId`** breaks click-to-navigate → covered by `resolver.test.ts`.
- **Missing `sanitizeBigInts`** throws at `JSON.stringify` → covered by route tests.
- Graph reads only the registered resolved cache (not base/user op layers) — "impact of a
  pending user op" is out of scope by design (that is Resolved Config #25's job).

## Out of scope (fast-follow / phase 2)

Tag + language nodes; QP-side editor integration (forward deps in the QP editor);
richer graph layout; cross-database dependency compare.
