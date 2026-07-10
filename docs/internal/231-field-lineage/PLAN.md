# Implementation Plan: Track exact PCD field lineage (Issue #231)

Companion to `DESIGN.md`. This plan reconciles the design with verified code
anchors, then sequences the work into dependency-ordered batches with per-file
exports/signatures and acceptance checks. All paths are relative to
`packages/praxrr-app/` unless noted with a `packages/...` or repo-root prefix.

---

## Design corrections

The following DESIGN.md assumptions were proved wrong or imprecise by code-anchor
verification. Implement to the corrected fact, not the design's phrasing.

1. **`resolveLayerState` lives in `layerDiff.ts`, not `layers.ts`.** DESIGN §2.4 /
   §6 imply the layer-state resolution sits with the ephemeral-cache code.
   Reality: `resolveLayerState`, `ResolveLayerStateInput`, `ResolvedLayerState`,
   `readEntityOrNull`, `computeUserOverrides`, `computeHasPendingConflict`,
   `buildPendingConflictIndex` all live in
   `src/lib/server/pcd/resolved/layerDiff.ts`. `layers.ts` holds only
   `withBaseOnlyCache` / `withCurrentCache` / `withSnapshotCache` /
   `withEphemeralCache` and `ResolvedConfigDatabaseNotFoundError`.
   **Consequence:** `engine.ts` imports `resolveLayerState`,
   `buildPendingConflictIndex`, `readEntityOrNull`, `computeUserOverrides` from
   the barrel `$pcd/index.ts` (which re-exports them from `layerDiff.ts`) — never
   from `layers.ts`. DESIGN §11's claim that `withInstrumentedCache` belongs in
   `layers.ts` **is correct** (co-located with the other `with*Cache` helpers).

2. **The CF condition-language table is `condition_languages`, not
   `custom_format_condition_languages`.** DESIGN §7.3 / table talk references a
   `custom_format_condition_*` naming. Reality: there is a family of **nine**
   `condition_*` tables — `condition_patterns`, `condition_languages`,
   `condition_indexer_flags`, `condition_sources`, `condition_resolutions`,
   `condition_quality_modifiers`, `condition_sizes`, `condition_release_types`,
   `condition_years` — each keyed on `(custom_format_name, condition_name)`.
   `LINEAGE_TABLE_KEYS` and any projection descriptor must use these exact names.

3. **`colon_replacement_format` diverges in type/default per Arr — resolve
   defaults per-table, never by column name.** `radarr_naming.colon_replacement_format`
   is `VARCHAR(20) NOT NULL DEFAULT 'smart'` (string); `sonarr_naming` and
   `lidarr_naming.colon_replacement_format` are `INTEGER NOT NULL DEFAULT 4`.
   `schemaDefaults.ts` must key `SchemaDefaultMap` by `(table, column)` and never
   collapse same-named columns across tables.

4. **`CURRENT_TIMESTAMP` is the only non-literal DEFAULT; DEFAULT can be
   immediately followed by CHECK.** The whole schema (single DDL file
   `packages/praxrr-schema/ops/0.schema.sql`, 564 lines) has exactly one
   non-literal default form: `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` on every
   `created_at`/`updated_at`. Everything else is a bare int (`0`, `1`, `4`, `5`)
   or single-quoted string (`'all'`, `'simple'`, `'doNotPrefer'`, `'smart'`,
   `'[]'`). Parser gotchas: (a) treat `CURRENT_TIMESTAMP` as
   `hasDefault:true, defaultLiteral:null` (a function keyword, not an inlinable
   value); (b) terminate the literal at a `CHECK` keyword — e.g.
   `upgrade_score_increment INTEGER NOT NULL DEFAULT 1 CHECK (... > 0)`,
   `propers_repacks VARCHAR(50) NOT NULL DEFAULT 'doNotPrefer'` with the CHECK
   IN-list on the **next physical line**, `radarr_naming.colon_replacement_format
... DEFAULT 'smart'` with CHECK on next line; (c) skip table-level constraint
   lines (`PRIMARY KEY (...)`, `FOREIGN KEY (...)`, `UNIQUE(...)`, standalone
   `CHECK (...)` — `quality_profile_qualities` and `delay_profiles` have these);
   (d) handle multi-line column definitions. `schemaFile` is always
   `'0.schema.sql'` (the only file with `CREATE TABLE`; `1.languages.sql` and
   `2.qualities.sql` are seed-only).

5. **`lidarr_metadata_profile_release_statuses` keys on `status_id`, not
   `type_id`.** `_primary_types` and `_secondary_types` use `type_id INTEGER NOT
NULL`; `_release_statuses` uses `status_id INTEGER NOT NULL`. `LINEAGE_TABLE_KEYS`
   and the metadata-profile descriptor must branch this per child table.

6. **Quality-profile `orderedItems` fields are COMPUTED, `language` is lossy, and
   `members[]`/`customFormatScores[]` are unordered.** DESIGN §7.4 flags
   orderedItems as hard but the projection descriptor must encode:
   - `orderedItems[].type` = COMPUTED (`quality_group_name IS NULL ? 'quality' :
'group'`) — not a column.
   - `orderedItems[].name` = COALESCE(`quality_profile_qualities.quality_name`,
     `quality_groups.name` via LEFT JOIN) — not a single column.
   - `orderedItems[].enabled` / `.upgradeUntil` = `INTEGER === 1` casts of
     `quality_profile_qualities.enabled` / `.upgrade_until`.
   - orderedItems **rowKey** = `(quality_profile_name, COALESCE(quality_name,
quality_group_name))`; `position` is a reorderable display value, NOT a
     stable key.
   - `orderedItems[].members[].name` → `quality_group_members.quality_name`,
     rowKey `(quality_profile_name, quality_group_name, quality_name)`; the
     members array has **no ORDER BY** (rowid order).
   - `language` → `quality_profile_languages.language_name` via
     `executeTakeFirst()` with no ORDER BY; the `type` column is dropped and
     2nd+ rows discarded — a lossy takeFirst-over-junction projection.
   - `customFormatScores[]` has **no ORDER BY**; rowKey is the PK tuple
     `(quality_profile_name, custom_format_name, arr_type)`.
   - `tags[]` value is `quality_profile_tags.tag_name`; the join to `tags` is an
     existence guard only — anchor lineage to the junction column, not the
     dimension table.

7. **The field-path grammar is mixed dot+bracket, not "dot-notated".** Anchors
   from `diff.ts` / `layerDiff.ts` (the byte-for-byte format lineage must
   reproduce):
   - Scalar/object keys: dot-joined, **no** leading dot at root (`minimumScore`,
     `foo.bar`).
   - Keyed array items: `path[JSON.stringify(key)]` → the key is **double-quoted
     and JSON-escaped** inside the brackets (`orderedItems["Bluray-1080p"]`,
     `conditions["WEB 1080p"]`, `conditions["A\"B"]`).
   - Plain/unkeyed scalar arrays: bare index `tags[0]`, root array `[0]`.
   - `customFormatScores` key is the **composite** `${customFormatName}:${arrType}`
     → `customFormatScores["HDR:radarr"]`.
   - `orderedItems[].members` is **index-based** (`orderedItems["WEB
1080p"].members[0]`) — no strategy matches the composed path (documented
     limitation); do **not** key members by name.
   - Empty/missing key falls back to `String(index)` but still JSON.stringify'd →
     quoted `entries["0"]`, never bare `entries[0]`.
   - Strategy lookup is exact-string match on the fully-composed path
     (`arrayKeyStrategies.get(path)`).
   - Emission order: object keys `[...keys].sort()`; keyed-array keys
     `[...keys].sort()`; plain arrays ascending numeric index. Ignored fields
     (`id`, `links`, `created`, `updated`, `createdAt`, `updatedAt`, `revision`,
     `lastExecution`, `lastExecutionTime`, `lastModified`, `dateAdded`,
     `dateUpdated`) are stripped by `normalizeValue` before diffing and never
     appear in any path.
     `LINEAGE_ARRAY_KEY_STRATEGIES` (§7.2) reuses `diff.ts`'s exact `selectKey` +
     `JSON.stringify(key)` bracket rendering, adding value-identity keys for scalar
     arrays.

8. **The named `[name]/+server.ts` handler currently parses only `layer` and
   `arrType` — no `include*` flag.** `includeLive` is parsed only in the sibling
   `compare/+server.ts` (`url.searchParams.get('includeLive') === 'true'`).
   `includeLineage` is genuinely new to this handler; mirror compare's
   `=== 'true'` idiom. `layer` default is `'resolved'`; validated against
   `base|user|resolved`. `arrType` validated via `isArrAppType` from
   `$shared/arr/capabilities.ts`.

9. **The barrel already exports everything the engine needs.** `$pcd/index.ts`
   re-exports `resolveLayerState`, `readEntityOrNull`, `computeUserOverrides`,
   `buildPendingConflictIndex` (from `layerDiff.ts`); `readResolvedEntity`,
   `ARR_AGNOSTIC_READERS`, `PER_ARR_READERS`, `ResolvedConfigValidationError`,
   `ResolvedEntityNotFoundError`, `listResolvedEntityNames`, the `isResolved*`
   guards (from `readers.ts`); `withBaseOnlyCache`,
   `ResolvedConfigDatabaseNotFoundError` (from `layers.ts`). No deep-path imports
   are needed. `engine.ts` adds `resolveEntityLineage` (and `withInstrumentedCache`
   from `layers.ts`) to this surface.

10. **Test recipes are fixed; monkeypatch rules are load-bearing.** Reuse
    `cacheBuildReadOnly.test.ts`'s temp-dir recipe (Recipe A: real
    `deps/schema/ops/0.schema.sql` + `tweaks/*.sql`, stub
    `pcdOpsQueries.listByDatabaseAndOrigin` via `patchTarget`) for full-cache
    tests, and `layerDiff.test.ts`'s `createCacheFixture(sql)` (Recipe B:
    in-memory Kysely, `{kb} as unknown as PCDCache` cast) for fakes. Object-method
    exports (`pcdOpsQueries.*`, `pcdOpHistoryQueries.*`, `logger.*`) are
    patchable; **bare ESM named exports are NOT** (Deno namespace bindings are
    read-only — `loadAllOperations`, and the `layerDiff.ts` functions themselves).
    Seed `pcd_op_history` status by patching
    `pcdOpHistoryQueries.listLatestByDatabaseWithOps` /
    `listLatestConflictsByDatabase` to return synthetic `PcdOpHistoryWithOp` rows
    (conflict correlation keys on `op.metadata.entity` + `op.metadata.name`, set
    via `JSON.stringify({entity, name})`), never by inserting into a real table.

No other DESIGN.md claim was contradicted. The §8.3/§11 route file paths, the
`toWireOverrides`/`toWirePayload` pattern to mirror for `toWireLineage`, the
`readResolvedEntity` dispatch signature (no sibling-app fallback), the
`ResolvedConfigValidationError` (400) vs `ResolvedEntityNotFoundError` (404) vs
`ResolvedConfigDatabaseNotFoundError` (400) mapping via
`mapResolvedErrorToResponse`, and the `withInstrumentedCache` target file were all
confirmed correct.

---

## Batches

Dependency arrows point to the batch that must land first. Every batch ends with
its verification gate (see "Verification gates" for exact commands).

### Batch 1 — Pure primitives + shared wire type (no deps)

All four units are pure/synchronous or type-only and unit-testable without a
cache. Build together with their tests.

**1a. `src/lib/shared/pcd/fieldLineage.ts`** (create)

- Wire types verbatim from DESIGN §3: `LineageSourceLayer`, `LineageSourceKind`,
  `LineageFieldStatus`, `LineageEntityStatus`, `LineageOpRef`, `FieldLineage`.
- Pure helpers (server + test importable, no cache):
  - `explainFieldLineage(input: { cell: CellLineage | null; schemaEntry:
SchemaDefaultEntry | undefined; finalValue: unknown; opStatus:
PcdOpHistoryStatus | undefined }): FieldLineage` — implements §5.1 + §6
    folding (cell present → `${layer}-op` explicit; cell absent + `hasDefault` +
    value==literal → `schema-default`; absent + `hasDefault` + value≠literal →
    `ambiguous`; `skipped`/`error` establishing op → caller re-resolves;
    `conflicted`/`conflicted_pending` → `ambiguous`; else `unavailable`).
  - `foldPendingConflict(fields: FieldLineage[], hasPendingConflict: boolean):
{ lineage: FieldLineage[]; lineageStatus: LineageEntityStatus }` — when
    pending, forces every field to `{status:'ambiguous', sourceKind:'ambiguous',
sourceLayer:null}` and `lineageStatus:'ambiguous'`.
- `CellLineage` / `SchemaDefaultEntry` imported as types from the server modules,
  OR (to avoid a server→shared type cycle) declare the minimal structural inputs
  inline. Keep this file wire-safe: no server imports at runtime.
- **Acceptance:** `deno task check:server` passes; helpers are exported and
  covered by 1a-test.

**1a-test. `src/tests/pcd/resolved/lineage/fieldLineage.test.ts`** (create)

- Table-driven over `explainFieldLineage` branches (cell present==default,
  cell present≠default, absent+default-match, absent+default-mismatch→ambiguous,
  absent+no-default→unavailable, conflicted→ambiguous) and `foldPendingConflict`
  (pending forces all ambiguous).

**1b. `src/lib/server/pcd/resolved/lineage/opWriteSet.ts`** (create)

- `export function analyzeOpWriteSets(sql: string): OpWriteSetResult` (types
  `WriteSet`, `OpWriteSetResult` from DESIGN §3).
- Internal `splitStatements(sql): string[]` — depth/quote/comment-aware tokenizer
  per §4.2 (single-quote incl. `''` escapes, double-quoted idents, `--` and
  `/* */` comments, split `;` only at depth 0). Handle the three shapes: INSERT
  (parenthesized column list after table; ignore `ON CONFLICT(...)` columns;
  multi-row VALUES share the list), Kysely `update "t" set ... where ...`
  (capture SET idents before depth-0 `where`, values never leak),
  `delete from "t" where ...`. Any unrecognized statement →
  `parseStatus:'ambiguous'` for the whole op.
- **Acceptance:** 1b-test green.

**1b-test. `src/tests/pcd/resolved/lineage/opWriteSet.test.ts`** (create)

- Adversarial cases from §10.1: INSERT with/without a column; multi-row VALUES;
  Kysely double-quoted idents; VALUES tuple with a CF regex literal containing
  commas/parens/escaped `''`; `ON CONFLICT(...) DO NOTHING`; multi-statement
  DELETE-then-INSERT; depth-0 WHERE with parenthesized subexpr + `a AND b`;
  unparseable → `parseStatus:'ambiguous'`.

**1c. `src/lib/server/pcd/resolved/lineage/schemaDefaults.ts`** (create)

- `export function parseSchemaDefaults(pcdPath: string): SchemaDefaultMap`
  (`SchemaDefaultMap = Map<table, Map<column, SchemaDefaultEntry>>`), memoized
  per `pcdPath`. Reads **only** `deps/schema/ops/0.schema.sql` (the sole DDL
  file; `schemaFile:'0.schema.sql'`).
- Parser honors correction #4: `CURRENT_TIMESTAMP` → `hasDefault:true,
defaultLiteral:null`; stop literal at `CHECK`; skip table-level constraint
  lines; multi-line column defs; per-`(table,column)` keying (correction #3).
- **Acceptance:** 1c-test green.

**1c-test. `src/tests/pcd/resolved/lineage/schemaDefaults.test.ts`** (create)

- §10.2 cases: `custom_formats.include_in_rename DEFAULT 0`;
  `quality_profiles.upgrade_score_increment DEFAULT 1 CHECK(>0)` (literal `1`, not
  the CHECK); `radarr_naming.colon_replacement_format DEFAULT 'smart'` vs
  `sonarr_naming`/`lidarr_naming` `DEFAULT 4` (per-table divergence);
  `propers_repacks DEFAULT 'doNotPrefer'` (CHECK IN-list on next line, not
  slurped); `CURRENT_TIMESTAMP` (`hasDefault:true, defaultLiteral:null`); NOT NULL
  vs nullable; `hasDefault:false` columns (e.g. `movie_format`); `schemaFile`
  recorded.

**1d. `src/lib/server/pcd/resolved/lineage/tableKeys.ts`** (create)

- `export const LINEAGE_TABLE_KEYS: Readonly<Record<string, readonly string[]>>`
  mapping each lineage-relevant table to its stable business-key columns, using
  the **verified** names (corrections #2, #5, #6):
  - `custom_formats:[name]`, `custom_format_conditions:[custom_format_name, name]`,
    `custom_format_tags:[custom_format_name, tag_name]`,
    `condition_patterns/condition_languages/condition_indexer_flags/
condition_sources/condition_resolutions/condition_quality_modifiers/
condition_sizes/condition_release_types/condition_years:
[custom_format_name, condition_name]` (plus the value column where the row
    identity needs it, e.g. `condition_languages:[custom_format_name,
condition_name, language_name]`),
  - `quality_profiles:[name]`, `quality_profile_tags:[quality_profile_name,
tag_name]`, `quality_profile_languages:[quality_profile_name, language_name]`,
    `quality_profile_custom_formats:[quality_profile_name, custom_format_name,
arr_type]`, `quality_profile_qualities:[quality_profile_name, quality_name,
quality_group_name]` (the COALESCE key is derived in the RowKey builder),
    `quality_groups:[quality_profile_name, name]`,
    `quality_group_members:[quality_profile_name, quality_group_name,
quality_name]`,
  - `delay_profiles:[name]`, `regular_expressions:[name]`,
    `regular_expression_tags:[regular_expression_name, tag_name]`,
  - `radarr_naming/sonarr_naming/lidarr_naming:[name]`,
    `radarr_media_settings/sonarr_media_settings/lidarr_media_settings:[name]`,
    `radarr_quality_definitions/sonarr_quality_definitions/
lidarr_quality_definitions:[name, quality_name]`,
  - `lidarr_metadata_profiles:[name]`,
    `lidarr_metadata_profile_primary_types/_secondary_types:
[metadata_profile_name, type_id]`,
    `lidarr_metadata_profile_release_statuses:[metadata_profile_name, status_id]`.
- `export function buildRowKey(table: string, row: Record<string, unknown>):
RowKey` — joins the key-column values (empty string join per DESIGN §3);
  handles the orderedItems COALESCE(`quality_name` ?? `quality_group_name`).
- **Acceptance:** covered indirectly by Batch 3/4 tests; `check:server` passes.
  A tiny `tableKeys.test.ts` asserting every `RESOLVED_ENTITY_TYPES`-backing
  table has an entry is optional but recommended.

**Batch 1 gate:** `deno task check:server` +
`deno task test src/tests/pcd/resolved/lineage/`.

---

### Batch 2 — Observer, index, instrumented cache (deps: Batch 1)

**2a. `src/lib/server/pcd/resolved/lineage/lineageIndex.ts`** (create)

- `LineageIndex` (interface + factory `createLineageIndex(): LineageIndex`) with
  `set/get/evictRow` keyed `${table} ${rowKey} ${column}` (DESIGN §3), and the
  `LineageObserver`:
  - `createLineageObserver(index: LineageIndex): BuildReadOnlyHooks['onOp']`
    implementing `before(op, db)` / `after(op, db)` per §4.3: INSERT → rowid
    snapshot diff; UPDATE → `SELECT rowid FROM <table> WHERE <whereExpr>` before
    exec; DELETE → same targeted select then `after` evicts cells for matched
    `(table, rowKey)`. rowid used only within one op's before/after pair.
  - Reads each touched row's business key via `buildRowKey` (Batch 1d), writes a
    `CellLineage` per analyzer column (`analyzeOpWriteSets`, Batch 1b) with
    last-write-wins. `op.layer` → `sourceLayer`; DB ops (`op.filepath ===
'pcd_ops:<id>'`) → `opId`, `opRef:null`; file ops → `opId:null, opRef:{filename:
op.filename, order: op.order}` (§4.5). `parseStatus:'ambiguous'` stamps every
    touched cell ambiguous.
- **Acceptance:** exercised end-to-end by Batch 4; `check:server` passes.

**2b. `src/lib/server/pcd/database/cache.ts`** (edit)

- Add optional second arg to `buildReadOnly`:
  `buildReadOnly(opts: BuildReadOnlyOptions, hooks?: BuildReadOnlyHooks)`.
  `BuildReadOnlyHooks = { onOp?: { before(op, db): void; after(op, db): void } }`.
  Wrap the existing per-op `db.exec(op.sql)` with `hooks?.onOp?.before(op, db)`
  before and `.after(op, db)` after. **No other line changes.** `build()`,
  `bootstrap()`, `registerHelperFunctions()` untouched. When `hooks` is
  `undefined` the method is byte-identical (existing callers + route tests that
  patch `PCDCache.prototype.buildReadOnly` keep working).
- **Acceptance:** `cacheBuildReadOnly.test.ts` still green (no hook passed →
  asserts zero writes to `pcdOpsQueries.update`/`pcdOpHistoryQueries.create`);
  `check:server` passes.

**2c. `src/lib/server/pcd/resolved/layers.ts`** (edit)

- Add `export async function withInstrumentedCache<T>(databaseId: number, fn:
(cache: PCDCache, index: LineageIndex) => Promise<T>): Promise<T>` — co-located
  with the other `with*Cache` helpers. Builds a fresh `PCDCache`, creates an
  index + observer, calls `cache.buildReadOnly({ layers: ALL_LAYERS },
{ onOp: observer })`, invokes `fn(cache, index)`, and `cache.close()` in a
  `finally`. `ALL_LAYERS = new Set(['schema','base','tweaks','user'])`.
- **Acceptance:** compiles; used by Batch 4.

**Batch 2 gate:** `deno task check:server` + rerun
`deno task test src/tests/pcd/` (cacheBuildReadOnly + layerDiff still green).

---

### Batch 3 — Projection descriptors + drift guard (deps: Batches 1–2)

**3a. `src/lib/server/pcd/resolved/lineage/projection.ts`** (create)

- `LINEAGE_ARRAY_KEY_STRATEGIES` — a **separate superset** of
  `PORTABLE_ARRAY_KEY_STRATEGIES` (correction #7): same `selectKey` fns +
  `JSON.stringify(key)` bracket rendering as `diff.ts`, plus value-identity keys
  for scalar arrays (`tags[]`, `sources[]`, `resolutions[]`, …). Composite
  `customFormatScores` key `${customFormatName}:${arrType}`. `orderedItems[].members`
  intentionally has **no** strategy (stays index-based).
- Declarative descriptor set for **all 12 payload shapes** (§7.3), each leaf as
  `{ portablePath, table, column, rowKeyFrom(payload[, item]) }` (scalar) or
  `{ arrayPath, table, itemKeyStrategy, columnMap, rowKeyFrom(payload, item) }`
  (keyed array). Encode the corrections: orderedItems `type`/`name` are COMPUTED
  (branch on `quality_group_name`), `members[]` is a distinct child-table mapping
  to `quality_group_members` with its own `rowKeyFrom`, `language` is a lossy
  takeFirst over `quality_profile_languages`, `condition_*` tables use the
  verified names, metadata `_release_statuses` uses `status_id`.
- `export function projectEntityLineage(payload, index, schemaDefaults,
opStatusById, ...): FieldLineage[]` — a single generic projector walking payload
  - descriptors, emitting one `FieldLineage` per leaf via `explainFieldLineage`
    (Batch 1a), keyed by the byte-identical bracketed path convention.
- **Acceptance:** 3a-test (drift guard) green.

**3a-test. `src/tests/pcd/resolved/lineage/projection.test.ts`** (create — the
AC6 gate)

- Table-driven over ALL 12 shapes × each arr mapping. For each: serialize an
  entity (via the real `serialize.ts`) and assert **every** serializer-emitted
  leaf path (incl. `conditions[].languages[].except`,
  `orderedItems[].members[].name`, `entries[]`,
  `primaryTypes/secondaryTypes/releaseStatuses[].allowed`,
  `customFormatScores["HDR:radarr"].score`, `tags[0]`) resolves to exactly one
  descriptor whose emitted `fieldPath` **byte-matches** what `diffToFieldChanges`
  produces. Any unmapped leaf → test failure (CI drift gate for future
  `serialize.ts` additions). Use Recipe B (`createCacheFixture`) for entity data.

**Batch 3 gate:** `deno task check:server` +
`deno task test src/tests/pcd/resolved/lineage/projection.test.ts`.

---

### Batch 4 — Engine + status folding + core engine test (deps: Batches 1–3)

**4a. `src/lib/server/pcd/resolved/lineage/engine.ts`** (create)

- `export async function resolveEntityLineage(input: { databaseId: number;
entityType: ResolvedEntityType; arrType: ArrAppType | undefined; name: string }):
Promise<{ lineage: FieldLineage[]; lineageStatus: LineageEntityStatus }>`.
- Flow (DESIGN §2.4): `parseSchemaDefaults(pcdPath)` (memoized) →
  `withInstrumentedCache(databaseId, async (cache, index) => { payload =
serialize entity from cache; opStatusById =
pcdOpHistoryQueries.listLatestByDatabaseWithOps(databaseId) folded to a
Map<opId, status>; lineage = projectEntityLineage(payload, index,
schemaDefaults, opStatusById); ... })`.
- Status folding (§6): cells whose establishing `opId` is `skipped`/`error` are
  **excluded** and re-resolved to the prior surviving writer or default (else
  `unavailable`); `conflicted`/`conflicted_pending` → `ambiguous`. Then
  `foldPendingConflict(lineage, computeHasPendingConflict(databaseId, entityType,
arrType, name))` (reuse `buildPendingConflictIndex` from the barrel).
- Absent entity → `{lineage:[], lineageStatus:'unavailable'}`. Memoize the index
  per `(databaseId, opFingerprint)` within a request batch (§12 perf note).
- Imports come from `$pcd/index.ts` (correction #9) + the Batch 1–3 lineage
  modules; `pcdOpHistoryQueries` from `$db/...` (object method, patchable).
- **Acceptance:** 4a-test green.

**4b. `src/lib/server/pcd/index.ts`** (edit)

- Re-export `resolveEntityLineage` (+ any lineage types the route/UI need:
  `FieldLineage`, `LineageEntityStatus` are re-exported from
  `$shared/pcd/fieldLineage.ts` — keep the wire type's canonical home in shared).
- **Acceptance:** `check:server` passes; route (Batch 6) imports resolve.

**4a-test. `src/tests/pcd/resolved/lineage/lineageEngine.test.ts`** (create —
end-to-end via Recipe A temp-dir PCD)

- **AC1** exact path + establishing op recorded.
- **AC2** four distinct sources across schema-default / base / tweaks / user.
- Nested lists: `orderedItems` (incl. `members[]`), `conditions`,
  `customFormatScores`, metadata type arrays.
- User-created entity (no base row): cells `user-op` or `schema-default`.
- Each Arr mapping: radarr/sonarr/lidarr naming + mediaSettings +
  qualityDefinitions; lidarr metadata profile.
- **AC4**: dropped op absent from replay; op seeded `conflicted_pending` (patch
  `pcdOpHistoryQueries.listLatestConflictsByDatabase`) → cells `ambiguous`; op
  seeded `skipped`/`error` (patch `listLatestByDatabaseWithOps`) → excluded /
  re-resolved; pending-conflict entity forced ambiguous; unparseable op forced
  ambiguous; value-with-no-writer → `unavailable`.
- The AC7 paired negative test is **added in Batch 8** (kept separate per plan
  ordering; it depends on this same file existing).

**Batch 4 gate:** `deno task check:server` +
`deno task test src/tests/pcd/resolved/lineage/`.

---

### Batch 5 — Contract lockstep (deps: Batch 4 for the shared type shape)

Follow DESIGN §8.4 exactly, in order (see "Verification gates" for tasks):

1. Edit `docs/api/v1/schemas/resolved-config.yaml`: add `FieldLineage` (§8.2
   YAML), extend `ResolvedEntityState` with optional `lineage` (array of
   `FieldLineage`, nullable) + `lineageStatus` (enum `available|ambiguous|
unavailable`, nullable).
2. Edit `docs/api/v1/openapi.yaml`: register the `FieldLineage` `$ref` (append at
   the unique-string insertion point to avoid concurrent-PR conflicts).
3. `deno task generate:api-types` → regenerates
   `packages/praxrr-app/src/lib/api/v1.d.ts`. **Known lesson:** if the regen emits
   tool-version noise (~3300 lines), `git checkout` the file and **hand-graft only**
   the `FieldLineage` + `ResolvedEntityState` additions.
4. `deno task bundle:api` → deterministically regenerates
   `packages/praxrr-api/openapi.json` (prettier-gated) **and**
   `packages/praxrr-api/types.ts`.
5. `deno fmt` / `prettier --write packages/praxrr-api/openapi.json` (the mirror is
   prettier-gated in CI).
6. Confirm `$shared/pcd/fieldLineage.ts` (Batch 1a) stays in lockstep with the
   generated `components['schemas']['FieldLineage']` shape.

- **Acceptance:** `packages/praxrr-app/src/lib/api/v1.d.ts` exposes
  `FieldLineage` + the two new `ResolvedEntityState` fields;
  `packages/praxrr-api/openapi.json` passes `prettier --check`;
  `deno task check` passes.

---

### Batch 6 — Route (deps: Batches 4, 5)

**6a. `.../resolved/shared.ts`** (edit — one level above `[entityType]`)

- Add `export function toWireLineage(lineage: FieldLineage[]):
ResolvedEntityState['lineage']` mirroring `toWireOverrides`/`toWirePayload`
  (single `as unknown as` wire-boundary cast, same file, same pattern).
- **Acceptance:** reachable from the `[name]` handler via its existing
  `'../../shared.ts'` import (correction #8).

**6b. `.../resolved/[entityType]/[name]/+server.ts`** (edit)

- Parse the new flag: `const includeLineage = url.searchParams.get('includeLineage')
=== 'true'` (mirror compare's `includeLive` idiom; correction #8). No other query
  parsing changes.
- In the `layer==='resolved'` branch of the response build (base/resolved branch
  where `entity` is populated), when `includeLineage`, call
  `resolveEntityLineage({ databaseId, entityType, arrType, name })` and attach
  `lineage: toWireLineage(result.lineage)` + `lineageStatus: result.lineageStatus`
  to the `ResolvedEntityState` object (still `satisfies ResolvedEntityState`, still
  `json(sanitizeBigInts(response))`). `layer==='base'|'user'` unchanged. Errors
  continue through `mapResolvedErrorToResponse` (no new error classes needed;
  engine-thrown `ResolvedConfigValidationError`/`ResolvedEntityNotFoundError` map
  to 400/404 as today).
- **Acceptance:** 6c-test green.

**6c. `src/tests/routes/resolvedConfigLineageApi.test.ts`** (create)

- §10.5: patch `PCDCache.prototype.buildReadOnly` / the engine's
  `resolveEntityLineage`; assert `includeLineage=true` attaches `lineage` +
  `lineageStatus`; omitted → fields absent (byte-identical default);
  `layer`/`arrType` validation unchanged; `layer=base` ignores the flag.

**Batch 6 gate:** `deno task check` (routes type-check under `deno test <dir>`) +
`deno task test src/tests/routes/resolvedConfigLineageApi.test.ts`.

---

### Batch 7 — UI (deps: Batches 5, 6)

**7a. `src/lib/client/ui/resolved/fieldChangeDisplay.ts`** (edit)

- Add `LINEAGE_META` (per-`sourceKind` label/tone map from DESIGN §9) +
  `formatLineage(l: FieldLineage): { label; tone; explicit; opRefText }` reusing
  `formatFieldValue`. No new client file.

**7b. `src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`** (edit,
Svelte 5 **no runes**)

- When `activeLayer === 'resolved'`, append `&includeLineage=true` to the fetch.
- `$: lineageByField = new Map((data.lineage ?? []).map((l) => [l.fieldPath, l]))`.
- Add a **Source** column to the scalar field table rendering a `Badge` by
  `sourceKind` (schema-default/base-op/tweaks-op/user-op/ambiguous/unavailable) +
  the explicit-vs-default marker; `opId` or `opRef.filename`+`order` in the
  tooltip. Entity-level `lineageStatus` line beside the existing provenance badge.
  Existing `hasPendingConflict` banner + `explainResolvedProvenance` badge stay.
  Nested-field lineage stays in the expanded/raw JSON region (v1 scope cut, §9).
- **Acceptance:** `deno task check:client` passes (run `npx svelte-kit sync` first
  if `$types` are stale after any merge).

**Batch 7 gate:** `deno task check:client`.

---

### Batch 8 — AC7 negative test + resolvedProvenance strengthening (deps: Batch 4)

**8a. `src/tests/pcd/resolved/lineage/lineageEngine.test.ts`** (edit — add the
AC7 crux case, §10.6)

- Two CFs, neither with a user override: (1) base INSERT names
  `include_in_rename=0` (== DEFAULT 0) → `{sourceKind:'base-op', explicit:true,
valueEqualsDefault:true}`; (2) base INSERT **omits** `include_in_rename` →
  `{sourceKind:'schema-default', explicit:false, opId:null,
opRef:{filename:'0.schema.sql'}}`. Same resolved value, opposite lineage.
- Then assert adding OR removing an **unrelated** user override op changes neither
  the base-op field's classification nor promotes any never-written column to a
  non-default source (proves absence-of-ANY-explicit-write, not
  absence-of-user-override; a snapshot/value-diff impl fails both halves).

**8b. `src/tests/shared/pcd/resolvedProvenance.test.ts`** (edit — §10.7)

- Strengthen `'withholds claims when evidence is missing'` to assert entity-level
  `explainResolvedProvenance` still refuses default/exact-op attribution
  (`base-side`/`unavailable`, never invents a default) now that field-level
  lineage is the granular surface.

**Batch 8 gate:** `deno task test src/tests/pcd/resolved/lineage/lineageEngine.test.ts`

- `deno task test src/tests/shared/pcd/resolvedProvenance.test.ts`.

---

### Batch 9 — ROADMAP (deps: none functionally; land last)

**9. `ROADMAP.md`** (edit)

- Mark #231 done via the **unique-string append** convention (take main's version,
  re-apply the addition) to avoid concurrent-PR conflicts.
- **Acceptance:** `deno task lint` (prettier/markdownlint via CI lint-docs) — the
  `*.md` printWidth:80 override rewraps code fences, so `prettier --write` the doc
  before commit; MD028 requires a `<!-- markdownlint-disable-next-line MD028 -->`
  between adjacent GitHub alerts if any are introduced.

---

## Verification gates

Run from repo root. `deno` is on PATH only in interactive shells — prepend
`~/.deno/bin` in non-interactive/CI-like shells (CI pins 2.5.6).

| When                                            | Command                                                                                                        | CI-gated?                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| After every server module/edit (Batches 1–6, 8) | `deno task check:server` (`deno check`)                                                                        | **No** — `deno check` on `.ts` is not a CI gate; run locally.                                        |
| After route + UI edits (Batches 6–7)            | `deno task check` (server + `check:client` svelte-check)                                                       | `app-check`/build **is** CI-gated; run `npx svelte-kit sync` first if `$types` are stale post-merge. |
| After each lineage test batch                   | `deno task test src/tests/pcd/resolved/lineage/` (path-scoped; no alias exists for this dir)                   | **No** — `deno test` is not a CI gate; run locally. `deno test <dir>` also type-checks routes.       |
| After route batch                               | `deno task test src/tests/routes/resolvedConfigLineageApi.test.ts`                                             | No (local).                                                                                          |
| Contract step 3 (Batch 5)                       | `deno task generate:api-types` → if noisy, `git checkout packages/praxrr-app/src/lib/api/v1.d.ts` + hand-graft | v1.d.ts is **not** CI-gated for regen noise.                                                         |
| Contract step 4 (Batch 5)                       | `deno task bundle:api` (regenerates `packages/praxrr-api/openapi.json` + `types.ts` deterministically)         | `openapi.json` **is** prettier-gated in CI.                                                          |
| Contract step 5 (Batch 5)                       | `deno fmt` / `prettier --write packages/praxrr-api/openapi.json`                                               | prettier-gated mirror must pass.                                                                     |
| Docs (Batch 9)                                  | `deno task lint` / `prettier --write ROADMAP.md`                                                               | `lint-docs` (markdownlint) **is** CI-gated.                                                          |

Note: `deno task lint` (prettier `.ts` + ESLint) and `deno task test` are **not**
merge gates on `main` (no branch protection); the `claude-review` check is a flaky
non-blocking bot. The authoritative CI gates are docs/shell lint, `app-check`/build,
and the prettier-gated `packages/praxrr-api/openapi.json` mirror.

---

## AC → test traceability

| AC      | Requirement                                                                     | Proving test file / case                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** | Exact nested field path + last establishing source/op recorded                  | `lineageEngine.test.ts` — "records exact path + establishing op"; path byte-parity gated by `projection.test.ts`                                                                                   |
| **AC2** | `schema-default` / `base-op` / `tweaks-op` / `user-op` distinct                 | `lineageEngine.test.ts` — "four distinct sources across schema/base/tweaks/user"; `opWriteSet.test.ts` (column capture)                                                                            |
| **AC3** | Explicit value == default distinguishable from implicit default                 | `lineageEngine.test.ts` AC7 crux (Batch 8a) explicit==default vs omitted; `schemaDefaults.test.ts` (literal parsing)                                                                               |
| **AC4** | Dropped/conflicted/pending never get false lineage                              | `lineageEngine.test.ts` — dropped/`skipped`/`error`/`conflicted_pending`/pending-entity/unparseable/no-writer cases; `opWriteSet.test.ts` ambiguous fallback; `fieldLineage.test.ts` fold branches |
| **AC5** | API + UI expose lineage + explicit unavailable/ambiguous state                  | `resolvedConfigLineageApi.test.ts` (route attaches `lineage`+`lineageStatus`); UI via `check:client` (Batch 7)                                                                                     |
| **AC6** | Tests cover nested objects/lists, user entities, ALL families, EACH Arr mapping | `projection.test.ts` drift guard (12 shapes × radarr/sonarr/lidarr); `lineageEngine.test.ts` nested-list + per-Arr + user-created cases                                                            |
| **AC7** | Reject inferring db-default from absence of a user override                     | `lineageEngine.test.ts` AC7 paired negative test (Batch 8a); `resolvedProvenance.test.ts` strengthened (Batch 8b)                                                                                  |
