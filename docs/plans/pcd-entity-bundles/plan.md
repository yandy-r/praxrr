# YAN-568 / GH #390 — PCD Entity Bundles: Implementation Plan

Research evidence: `feature-spec.md` (same directory). §-references point there.
Worktree: `/home/yandy/Projects/github.com/yandy-r/praxrr-yan-568` (branch
`feat/yan-568-entity-bundles`). Formatting: Prettier defaults per root `.prettierrc`
(2 spaces, single quotes, es5 trailing commas, 120 width) — note the copilot-instructions
"tabs/100" text is stale; `.prettierrc` is authoritative.

## Decisions needing user input

**None.** All judgment calls are logged in the Decisions table below with rationale.

## Design decisions (rationale)

| #   | Decision                                                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Bundle shape `{ version: 1, entities: [{entityType, data}] }`; caps `BUNDLE_MAX_ENTITIES=200`, `BUNDLE_MAX_JSON_BYTES=5 MiB` in `$shared/pcd/bundle.ts`                                                                                                                                       | Matches issue proposal; constants shared by server, client and OpenAPI docs; caps bound traversal + payload like `GRAPH_EDGE_CAP`/`IMPACT_VISITED_CAP` bound the graph (§1.7).                                                                         |
| D2  | Export keeps single-`name` param; adds repeated `name` params (all must share one `entityType`) + `includeDependencies=true` + `format=bundle`. Response is the legacy single shape **iff** exactly one `name`, no `includeDependencies`, and no `format=bundle`; otherwise `{ bundle }`.     | Zero-risk backward compatibility: CloneModal and all 8 list pages keep working unchanged; new callers opt in explicitly. Repeated `name` beats `names[]` because `URLSearchParams.getAll` gives it for free and it reads naturally (`?name=A&name=B`). |
| D3  | Closure walk uses `graph/edges.ts` `getOutgoingEdges` restricted to E1/E2 node kinds, visited-cap `500`                                                                                                                                                                                       | Single source of dependency truth already consumed by delete/update handlers (§1.7); no second edge catalog to drift.                                                                                                                                  |
| D4  | Import route accepts legacy single-entity body **or** bundle body (discriminated by `bundle` key presence); never both                                                                                                                                                                        | Legacy callers (CloneModal, lidarr tests, YAML ingestion) untouched; bundle path is purely additive.                                                                                                                                                   |
| D5  | Dry run = full apply against an ephemeral writable cache via `withScopedCache` (never `pcd_ops`); real apply = preflight in an identical sandbox, then live writes under `withDatabaseOverrideLock`, with snapshot + `withOpCreationRecorder` + `restoreImportSnapshot` compensating rollback | Deserializers refetch `getCache` mid-sequence (§1.2, §1.5), so only a scoped cache makes the dry run faithful; compensating rollback is the established repo pattern because the async `compile()` forbids one SQLite transaction (§1.4).              |
| D6  | Collision policies: `skip` \| `rename` \| `overwrite`, default `skip`, per-entity override map keyed `"<entityType>:<name>"` (case-insensitive)                                                                                                                                               | Issue asks for per-entity policy; map key format is unambiguous and debuggable. `overwrite` = update-in-place via existing update handlers (value-guarded), NOT delete+create (§5).                                                                    |
| D7  | Rename suffix `" (2)"`, `" (3)"`, … unique case-insensitive vs target DB + other renamed bundle entities; renames propagate into referencing payloads (QP scores → renamed CF)                                                                                                                | Matches `"(Copy)"` precedent (§7) while staying collision-free; propagation keeps acceptance criterion 1 satisfiable when both the CF and its QP collide.                                                                                              |
| D8  | Bundle import is single-layer, single `actionId`; missing references (not in bundle, not in target DB) → listed in dry run, 400 on real apply                                                                                                                                                 | Mixed layers break the single undo unit and rollback story; early refusal beats FK failures at write time (§9).                                                                                                                                        |
| D9  | UI: `/databases/[id]/import` page (paste + file upload, dry-run table, per-entity policy selects, apply); list pages gain "Download bundle" replacing clipboard copy; "Copy to database…" opens a modal (target DB, layer, default policy) that chains export → dry-run → apply               | Routes-over-modals rule: the import workspace is a page; the cross-DB copy is a rare one-off action, modal-approved.                                                                                                                                   |
| D10 | Export/import server logic lives in `lib/server/pcd/bundles/{export.ts,import.ts,closure.ts}`; routes stay thin dispatchers                                                                                                                                                                   | Routes currently hold the logic only because they predate a second consumer; bundles add dry-run + rollback the route must not own.                                                                                                                    |

## Shared contracts (all tasks code against these)

### Wire contract (authored Task 1; generated into `components['schemas']`)

OpenAPI names (see Task 1 for fields):

- `PcdBundle` — `{ version: integer(1), entities: array<PcdBundleEntry, maxItems 200> }`
- `PcdBundleEntry` — `{ entityType: EntityType, data: portable oneOf (reuse ExportResponse.data set) }`
- `PcdBundleExportResponse` — `{ bundle: PcdBundle }`
- `PcdBundleImportRequest` — `{ databaseId, layer, bundle, dryRun?: boolean, collisions?: { default: enum[skip,rename,overwrite], perEntity?: object additionalProperties enum } }`
- `PcdBundleImportReport` — `{ dryRun: boolean, created: [PcdBundleEntityOutcome], skipped: [...], renamed: [...], overwritten: [...], missingReferences: [PcdBundleMissingRef], errors: [{entityType, name, error}] }`
- `PcdBundleEntityOutcome` — `{ entityType, name, finalName?, action: enum[create,rename,overwrite,skip] }`
- `PcdBundleMissingRef` — `{ fromType, fromName, toType, toName }`

Route deltas:

- `GET /pcd/export` (operationId stays `exportEntity`): `name` becomes repeatable
  (`explode: true` array, minItems 1); add `includeDependencies` (boolean, default false);
  add `format` (enum `[json, bundle]`, default `json`); add `PcdBundleExportResponse` to
  the 200 oneOf alongside legacy `ExportResponse`.
- `POST /pcd/import` (operationId stays `importEntity`): body becomes
  `oneOf: [ImportRequest, PcdBundleImportRequest]`; 200 response adds
  `PcdBundleImportReport` alongside `{success}`.

### Server library contract (`packages/praxrr-app/src/lib/server/pcd/bundles/`)

```ts
// closure.ts
export async function collectBundleClosure(
  cache: PCDCache,
  roots: ReadonlyArray<{ entityType: EntityType; name: string }>
): Promise<{ entries: PcdBundleEntry[]; missing: PcdBundleMissingRef[] }>;
// Walks getOutgoingEdges E1/E2 from root entities of node kinds, BFS, visited cap 500.
// Roots that are not QP/CF still export standalone. Deduped case-insensitively by
// `${entityType}:${name}`. Order: regular_expression → custom_format → quality_profile → leaves.

// export.ts
export async function exportBundle(
  databaseId: number,
  entityType: EntityType,
  names: readonly string[],
  includeDependencies: boolean
): Promise<PcdBundle>;
// Throws Error('... not found') for missing roots (route maps to 404).

// import.ts
export interface BundleImportOptions {
  databaseId: number;
  layer: OperationLayer;
  bundle: PcdBundle;
  dryRun: boolean;
  collisions: {
    default: BundleCollisionPolicy;
    perEntity: Record<string, BundleCollisionPolicy>;
  };
}
export interface BundleImportReport {
  /* mirrors PcdBundleImportReport */
}
export async function importBundle(
  options: BundleImportOptions
): Promise<BundleImportReport>;
// Dry run: withDatabaseOverrideLock → ephemeral writable cache + withScopedCache →
//   applyBundleToCache (shared with real apply) → report; no pcd_ops rows, no compile().
// Real apply: lock → preflight (same sandbox, must be error-free & refs resolved, else 400)
//   → snapshot listByDatabase + withOpCreationRecorder + withNewUserOpAction →
//   applyBundleToLive(deserializers) in dependency order → on ANY throw:
//   restoreImportSnapshot + invalidate + compile inside the recorder scope, rethrow as
//   BundleImportFailedError (carries partial report).
// Missing refs found during planning → BundleImportReport.missingReferences; real apply
//   throws before writing.
```

`applyBundleToCache`/`applyBundleToLive` are private to `import.ts`; both call the same
per-entity plan (`planBundle(cache, bundle, collisions)`) that resolves renames (D7) and
collision actions, then execute via injectable write callbacks (dry run executes compiled
op SQL against the sandbox savepoint per entity — mirroring `withSandboxCache` — while
live executes the existing deserializer/update functions). The route-level
`_deserializeDependencies` seam keeps working because live execution goes through
`deserializeByEntityType` from `$pcd/entities/deserialize.ts` plus the update handlers;
the route re-exports the seam unchanged.

## Dependency graph

```
Wave 1 (parallel): T1 OpenAPI+types      T2 shared bundle module     T3 closure walker
Wave 2 (parallel, after T1+T2+T3):  T4 server bundles/{export,import} + lock export
Wave 3 (parallel, after T4):        T5 routes   T6 import UI page   T7 list/detail UI actions
Wave 4 (after T5):                  T8 tests + test alias + docs touch-ups
```

File ownership is disjoint within every wave (files appearing in multiple tasks are
sequenced by wave; the only shared mutable file is `packages/praxrr-app/src/lib/server/pcd/index.ts`,
owned by T4 alone, and `scripts/test.ts`, owned by T8 alone).

### Cross-cutting rules for every subagent

- Work only in the worktree using absolute paths; `cwd` = worktree. Never touch the main
  checkout or other worktrees.
- Before any exploration, `graphify query "<question>"` from `/home/yandy/Projects/github.com/yandy-r/praxrr`.
- Svelte 5 without runes (`export let`, `$:`, `on:`); Prettier per root `.prettierrc`;
  alerts via `alertStore.add`; Kysely conventions.
- Do NOT run builds/lints/formatters/tests unless the task acceptance says so; main agent
  verifies once at the end. Tests that ARE run use
  `APP_BASE_PATH=$PWD/dist/test deno test --no-check -A <file>` with `deno check <file>`
  separately (full `deno task test` aborts on pre-existing type errors).
- Cross-Arr policy: no sibling fallback; CF score `arrType` stays explicit.
- After code changes: `graphify update .` (AST-only, from the main checkout path).

---

## Task 1 — OpenAPI contract + generated types (wave 1)

**Owns (create):** none.
**Owns (modify):** `docs/api/v1/paths/pcd.yaml`, `docs/api/v1/schemas/pcd.yaml`, `docs/api/v1/openapi.yaml` (only if new tag needed).
**Owns (generated, commit):** `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`.

Steps:

1. `schemas/pcd.yaml`: add `PcdBundle`, `PcdBundleEntry`, `PcdBundleExportResponse`,
   `PcdBundleImportRequest`, `PcdBundleImportReport`, `PcdBundleEntityOutcome`,
   `PcdBundleMissingRef` exactly per the wire contract above. `PcdBundleEntry.data`
   reuses the same `oneOf` list as `ExportResponse.data` (schemas/pcd.yaml:78-91) —
   do not duplicate the portable schemas.
2. `paths/pcd.yaml` `export`: convert `name` to an array parameter
   (`style: form, explode: true, minItems: 1`), add `includeDependencies` and `format`
   (`json|bundle`) query params; widen the 200 content schema to
   `oneOf: [ExportResponse, PcdBundleExportResponse]`; document D2's exact legacy rule in
   the description.
3. `paths/pcd.yaml` `import`: request body `oneOf: [ImportRequest, PcdBundleImportRequest]`;
   200 `oneOf: [ImportResponse, PcdBundleImportReport]`; document the `bundle`-key
   discriminator (D4), dry-run semantics (no writes), collision policies, missing-ref 400,
   and the caps (200 entities / 5 MiB).
4. Generate: `deno task generate:api-types` then `deno task bundle:api`; commit all three
   generated outputs (existing pipeline, scripts/bundle-api.ts).

**Acceptance:** `components['schemas']['PcdBundle']` … `PcdBundleMissingRef` exist in
`v1.d.ts`; `packages/praxrr-api/openapi.json` contains both operation shapes; no
pre-existing schema/path changed.

## Task 2 — Shared bundle module `$shared/pcd/bundle.ts` (wave 1)

**Owns (create):** `packages/praxrr-app/src/lib/shared/pcd/bundle.ts`,
`packages/praxrr-app/src/tests/shared/pcd/bundle.test.ts`.
**Depends on:** nothing (types only).

Contents:

```ts
export const BUNDLE_VERSION = 1;
export const BUNDLE_MAX_ENTITIES = 200;
export const BUNDLE_MAX_JSON_BYTES = 5 * 1024 * 1024;
export type BundleCollisionPolicy = 'skip' | 'rename' | 'overwrite';
export interface PcdBundleEntry {
  entityType: EntityType;
  data: PortableEntityData;
}
export interface PcdBundle {
  version: number;
  entities: PcdBundleEntry[];
}
export interface BundleCollisionOptions {
  default: BundleCollisionPolicy;
  perEntity?: Record<string, BundleCollisionPolicy>;
}
export function validateBundle(
  input: unknown
): { bundle: PcdBundle } | { error: string };
// - top-level object, version === BUNDLE_VERSION, entities array 1..BUNDLE_MAX_ENTITIES
// - every entry: entityType in ENTITY_TYPES, data plain object; per-type shape validation
//   delegated to validatePortableData (import from $pcd/entities/validate.ts is NOT
//   possible in $shared — so validateBundle does structural checks only and the route
//   re-validates with validatePortableData server-side; keep both call sites listed)
export function collisionKey(entityType: EntityType, name: string): string; // `${entityType}:${name}` (name lowercased)
export function resolveCollisionPolicy(
  collisions: BundleCollisionOptions,
  entityType: EntityType,
  name: string
): BundleCollisionPolicy;
export function nextRenameName(
  base: string,
  taken: (n: string) => boolean
): string; // "(2)", "(3)"… case-insensitive probe
```

Tests: version mismatch, entity cap, malformed entries, `collisionKey` casing,
`resolveCollisionPolicy` per-entity-beats-default, `nextRenameName` sequences and
case-insensitivity.

**Acceptance:** module compiles under `deno check`; unit tests pass standalone.

## Task 3 — Closure walker `bundles/closure.ts` (wave 1)

**Owns (create):** `packages/praxrr-app/src/lib/server/pcd/bundles/closure.ts`,
`packages/praxrr-app/src/lib/server/pcd/bundles/index.ts` (barrel),
`packages/praxrr-app/src/tests/pcd/bundles/closure.test.ts`.
**Depends on:** nothing (T2 types imported but only the `PcdBundleEntry` shape).

`collectBundleClosure(cache, roots)` per D3: BFS over `getOutgoingEdges`
(`$pcd/graph/edges.ts`) keeping only edges whose `from.kind`/`to.kind` ∈
{custom_format, regular_expression, quality_profile} (E3/E4 quality leaves excluded);
visited cap `IMPACT_VISITED_CAP`; serialize each node with the existing
`_serializeDependencies`-equivalent serializers imported from
`$pcd/entities/serialize.ts` directly (module-level map, NOT the route seam); order
regex → CF → QP; roots of other types serialize standalone. Roots missing from the cache
throw `Error('<entityType> "<name>" not found')`.

Tests (in-memory `PCDDatabase` fixture with quality/custom-format/regex tables — reuse the
`exportRoute.test.ts:15-42` pattern): QP root pulls CFs + regexes; CF root pulls its
regexes; leaf root returns just itself; cycle safety (two QPs sharing a CF); visited cap
truncation reported via `missing`/`truncated` flag; not-found root throws.

**Acceptance:** tests pass; no changes outside the two owned files.

## Task 4 — Server bundles: export + import with atomic rollback (wave 2)

**Owns (create):** `packages/praxrr-app/src/lib/server/pcd/bundles/export.ts`,
`packages/praxrr-app/src/lib/server/pcd/bundles/import.ts`,
`packages/praxrr-app/src/lib/server/pcd/bundles/writerRedirect.ts`,
`packages/praxrr-app/src/tests/pcd/bundles/importBundle.test.ts`.
**Owns (modify):** `packages/praxrr-app/src/lib/server/pcd/index.ts` (export
`exportBundle`, `importBundle`, `collectBundleClosure`, types; re-export
`withDatabaseOverrideLock` from `./conflicts/override.ts`),
`packages/praxrr-app/src/lib/server/pcd/bundles/index.ts` (extend T3's barrel with the new
exports — different wave, no conflict),
`packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts` (ONLY add the word
`export` to the existing function declaration at line 130 — no behavior change).

`export.ts`: `exportBundle` per contract; when `includeDependencies=false` and multiple
names, entries are the named entities only (closure skipped), still ordered
dependency-first. Enforce `names.length ≤ BUNDLE_MAX_ENTITIES` after closure dedupe.

`import.ts` per D5–D8. Key implementation notes:

- Sandbox: `const cache = new PCDCache(instance.local_path, databaseId); await
cache.buildReadOnly({ layers: ALL_LAYERS })` (copy `withEphemeralCache`,
  resolved/layers.ts:118-144), then `withScopedCache(databaseId, cache, …)` so
  deserializer-internal `getCache()` refetches (deserialize.ts:265,317,329) see it.
  Per-entity SAVEPOINT like `withSandboxCache.ts:98-140`.
  **Dry-run seam (binding decision):** deserializers persist through `writeOperation`
  (the `$pcd/index.ts` re-export of `ops/writer.ts`). The sandbox redirects those writes via
  a new AsyncLocalStorage seam in `bundles/writerRedirect.ts` (this task):
  `withWriterRedirect(apply: (options: WriteOptions) => Promise<WriteResult>, body)` — when
  active, every `writeOperation` call inside `body` instead applies the compiled queries to
  the sandbox raw DB inside the current entity's SAVEPOINT, skipping `pcd_ops` and
  `compile()`. The hook lives in `$pcd/index.ts`'s `writeOperation` re-export (a two-line
  wrapper that checks the ALS store first; that file is owned by this task anyway for the
  new bundle exports), so `ops/writer.ts` itself stays untouched and every other consumer is
  unaffected. This preserves exact op semantics (value-guard SQL, metadata, op granularity)
  with zero writer changes.
- Live apply ordering: `planBundle` output order — `regular_expression` → `custom_format`
  → `quality_profile` → all other types (dependency order, D1); per entity:
  - no collision → `deserializeByEntityType`
  - `skip` → record skip
  - `rename` → clone payload, rewrite `name` (and referencing score entries via the
    rename map) → `deserializeByEntityType`
  - `overwrite` → update handlers per feature-spec §5 (`regularExpressions.update`,
    CF `general.update`+`conditions.updateConditions`, QP
    `general.updateGeneral`+`qualities.updateQualities`+`scoring.updateScoring`, leaves'
    per-family `update*`), all under the recorder scope.
- Rollback: snapshot `pcdOpsQueries.listByDatabase(databaseId)`; wrap the whole live
  section in `withOpCreationRecorder(created, …)` + `withNewUserOpAction`; catch →
  `restoreImportSnapshot` → `invalidate(databaseId)` → `compile(local_path, id)` (inside
  the same recorder scope so compile-side auto-override writes are captured by a second
  restore if that compile also throws) → throw `BundleImportFailedError`.
- Missing refs: computed by `planBundle` from bundle ∪ cache names; real apply with any
  unresolved ref returns before the first write (route → 400).
- Lock: entire dry-run and apply bodies inside `withDatabaseOverrideLock(databaseId, …)`.

Tests (`importBundle.test.ts`, real temp PCD like `lidarrMediaSettingsEntityOperations.test.ts:95-215`
bootstrap): QP+CF+regex roundtrip into empty DB resolves CF scores (acceptance 1);
dry run leaves `pcd_ops` count and cache unchanged (acceptance 2); injected mid-bundle
failure (make the writer-redirect throw on the 2nd entity) leaves zero new ops/history
and identical pre-existing rows (acceptance 3);
missing-ref 400 path; base-layer 403 path.

**Acceptance:** all tests pass under the standard test invocation; `deno check` clean for
the new/modified files.

## Task 5 — Routes: export multi-name + import bundle (wave 3)

**Owns (modify):** `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`,
`packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`.
**Depends on:** T1 (types), T4 (functions).

Export GET: read `url.searchParams.getAll('name')` (array), `includeDependencies`,
`format`; branch per D2 — legacy branch byte-identical to today (single name, no extras);
bundle branch returns `{ bundle }` via `exportBundle`; keep `_serializeDependencies`
exported untouched for tests. 404 when any root missing; 400 when >1 name with mixed
entityTypes is impossible (single `entityType` param still required — multiple names must
share it; document).

Import POST: parse body; if `bundle` key present → bundle path: enforce
`BUNDLE_MAX_JSON_BYTES` on the raw body first, `validateBundle`, layer/base checks
(identical messages/status to legacy), build `BundleImportOptions`, call `importBundle`,
return `{ dryRun, …report }` (200) or `BundleImportFailedError` → 500 with report attached
as `report` + rollback-performed flag, missing refs → 400 with `missingReferences`.
Otherwise → legacy path completely unchanged (same destructuring, same responses, same
`_deserializeDependencies` seam usage).

**Acceptance:** existing `exportRoute.test.ts` and lidarr import tests pass unmodified;
new thin-path behavior covered by T8 route tests.

## Task 6 — Import UI page `/databases/[id]/import` (wave 3)

**Owns (create):** `packages/praxrr-app/src/routes/databases/[id]/import/+page.server.ts`,
`packages/praxrr-app/src/routes/databases/[id]/import/+page.svelte`,
`packages/praxrr-app/src/lib/client/ui/bundles/BundleImportPanel.svelte`.
**Owns (modify):** `packages/praxrr-app/src/routes/databases/[id]/+layout.svelte` (add
`Import` tab with `PackagePlus` icon after `Local overrides`).
**Depends on:** T1 types, T5 routes.

Page (client-side fetch, Svelte 5 no runes):

- Textarea paste + `<input type="file" accept=".json">` (settings/backups/+page.svelte:139-149
  precedent) feeding the same parser; shows bundle summary (version, entity counts by type).
- Layer select (`user` default; `base` only when `data.database.has_personal_access_token`),
  default collision policy select, per-entity override selects rendered after a dry run.
- "Dry run" button → `POST /api/v1/pcd/import` with `dryRun: true` → preview table
  (`PcdBundleEntityOutcome` rows: type, name → finalName, action badge) + missing refs +
  errors; writes nothing (asserted by T8).
- "Apply" button (disabled while missing refs or errors exist) → same body with
  `dryRun: false`; success/failure via `alertStore`; `invalidateAll()` after apply.
- Server load: reuse the existing `[id]/+layout.server.ts` database data; page load
  returns nothing extra.

**Acceptance:** page renders under the new tab; dry-run table + policy selects + apply
flow wired; no runes; alerts used; file ≤ ~300 lines with logic in the panel component.

## Task 7 — List/detail actions: Download bundle + Copy to database (wave 3)

**Owns (create):** `packages/praxrr-app/src/lib/client/ui/bundles/DownloadBundleButton.svelte`,
`packages/praxrr-app/src/lib/client/ui/bundles/CopyToDatabaseModal.svelte`.
**Owns (modify):** the 8 entity list pages `+page.svelte` handleExport bodies only —
`custom-formats/[databaseId]`, `quality-profiles/[databaseId]`, `regular-expressions/[databaseId]`,
`delay-profiles/[databaseId]`, `metadata-profiles/[databaseId]`,
`media-management/[databaseId]/naming`, `media-management/[databaseId]/media-settings`,
`media-management/[databaseId]/quality-definitions`.

Changes:

- `handleExport` in each page replaces the clipboard write with
  `DownloadBundleButton` behavior: fetch
  `/api/v1/pcd/export?...&includeDependencies=true&format=bundle`, then trigger a file
  download of the pretty-printed bundle (`URL.createObjectURL` + anchor click) named
  `<entityType>-<name>.json` (multi-select later; keep single-name per row for now).
  Clipboard copy stays as a secondary action inside the same dropdown where one exists,
  else a second small button — minimum: bundle download is primary.
- `CopyToDatabaseModal`: opened from list rows via a new `copy` event (add dispatch to
  the TableView/CardView view files where `export` is already dispatched — the 15 view
  files across custom-formats, quality-profiles, regular-expressions, delay-profiles,
  media-management {naming, media-settings, quality-definitions} — one-line additions
  each; all within this task so no cross-task file overlap). Modal fields: target
  database (fetch list from an existing instances endpoint — check `/api/v1/setup/state`
  which already exposes `databaseInstancesQueries` data; prefer adding nothing new),
  layer, default policy; flow = bundle export (source DB, with dependencies) → import
  dry run (target DB) → show compact outcome → Apply. Confirm-once pattern mirrors
  CloneModal.

**Acceptance:** every list page downloads bundles; copy-to-database modal round-trips
dry-run → apply; no other page behavior changes; Svelte 5 no runes.

## Task 8 — Tests, alias, docs (wave 4)

**Owns (create):** `packages/praxrr-app/src/tests/pcd/bundles/exportBundle.test.ts`,
`packages/praxrr-app/src/tests/pcd/bundles/bundleRoutes.test.ts`.
**Owns (modify):** `scripts/test.ts` (add alias
`bundles: 'packages/praxrr-app/src/tests/pcd/bundles'`),
`packages/praxrr-app/src/tests/pcd/exportRoute.test.ts` (append, do not rewrite, cases
below).

Critical test list (issue acceptance criteria mapped):

1. **Closure walk** (already T3) — QP → CFs → regexes.
2. **Dry run writes nothing** — `bundleRoutes.test.ts`: dry-run call; assert
   `pcdOpsQueries.listByDatabase` unchanged and target cache rows unchanged (A2).
3. **Partial failure leaves zero ops** — inject failure by patching the bundle module's
   writer-redirect (or the route's `_deserializeDependencies` seam, pattern
   `lidarrApiParity.test.ts:288-320,816`) to throw on the 2nd entity; assert zero new
   `pcd_ops`/`pcd_op_history` rows, pre-existing rows byte-identical (A3).
4. **QP+CF+regex roundtrip into empty DB** — every CF in scoring resolves; assert via
   cache reads post-import (A1).
5. **Collision policies** — skip / rename (incl. QP-score rename propagation) / overwrite
   (value-guarded update ops present, no delete ops).
6. **Legacy shape compatibility** — `exportRoute.test.ts` additions: single-name export
   still returns `{entityType,data,migration}`; import of legacy single-entity body still
   `{success:true}`; `format=bundle` flips shape; repeated `name` without
   `includeDependencies` returns bundle of the named entities only.
7. **Caps** — 201-entity bundle → 400; oversize JSON body → 400.

Also update `docs/api/v1` examples only if Task 1 left any gap; run
`deno task generate:api-types` sanity (no diff expected).

**Acceptance:** `APP_BASE_PATH=$PWD/dist/test deno test --no-check -A
packages/praxrr-app/src/tests/pcd/bundles packages/praxrr-app/src/tests/pcd/exportRoute.test.ts`
green; `deno check` clean on new files; alias listed by `deno task test` help.

## Final verification (main agent, once)

1. `deno task lint` + `deno task check` (expect only pre-existing failures noted in
   copilot-instructions/memory).
2. Full targeted test set: `bundles` alias + `pcd/exportRoute.test.ts` +
   `arr/lidarrMediaSettingsEntityOperations.test.ts` + `base/lidarrApiParity.test.ts`.
3. `graphify update .` from the main checkout.
