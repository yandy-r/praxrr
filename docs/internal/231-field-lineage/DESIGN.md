# Design: Track exact PCD field lineage (Issue #231)

Status: Final design (ready for implementation)
Owner: PCD / resolved-config
Scope: One PR (large but cohesive). Server core + API contract + minimal UI + tests.

---

## 1. Problem, Goals, and Acceptance Criteria

### 1.1 Problem

The PCD resolved-config replay folds four ordered op layers — `schema` (files) →
`base` (DB `pcd_ops`) → `tweaks` (files) → `user` (DB `pcd_ops`) — into an
in-memory, fully-normalized SQLite cache (42 tables, no JSON columns). Ops are
replayed by `PCDCache.build()` / `buildReadOnly({layers})` as opaque SQL via
`db.exec(op.sql)`, last-write-wins. SQLite holds **only** the final folded values;
there is **zero per-field provenance**. Schema defaults are `CREATE TABLE ...
DEFAULT <literal>` clauses materialized implicitly by SQLite at INSERT time, and
nothing records that a value came from a default.

We must expose, per resolved nested Portable field, **which source and which exact
op last established it** — without fabricating provenance for values that were
never explicitly written, and without ever confusing an explicitly-written value
that happens to equal a default with an implicit default. The current
entity-level surface (`explainResolvedProvenance`) deliberately collapses
`schema+base+tweaks` into `base-side` and refuses default/exact-op attribution;

# 231 asks for the granular, honest version

### 1.2 Goals

- Record the exact nested Portable field path and the last establishing
  source/op during a side-effect-free replay of all four layers.
- Keep `schema-default`, `base-op`, `tweaks-op`, `user-op` distinct.
- Distinguish an explicit value equal to a default from an implicit default.
- Never assign provenance to dropped / conflicted / pending / unparseable
  outcomes — surface `ambiguous` / `unavailable` instead.
- Expose lineage plus an explicit unavailable/ambiguous state on the Resolved
  Config API and UI.
- Prove correctness with tests spanning nested objects/lists, user-created
  entities, all portable entity families, and each supported Arr mapping —
  including a negative test that rejects absence-based inference.

### 1.3 Acceptance Criteria (verbatim intent)

- **AC1** — Replay records the exact nested field path AND the last establishing
  source/op for resolved values.
- **AC2** — `schema-default`, `base-op`, `tweaks-op`, `user-op` are DISTINCT
  source values.
- **AC3** — Explicit values EQUAL to a schema/database default remain
  distinguishable from implicit defaults.
- **AC4** — Dropped, conflicted, and pending value-guard outcomes NEVER receive
  false lineage (must show ambiguous/unavailable).
- **AC5** — Resolved Config API and UI expose lineage AND an explicit
  unavailable/ambiguous state.
- **AC6** — Tests cover nested objects/lists, user-created entities, ALL portable
  entity families, and EACH supported Arr mapping.
- **AC7** — Tests reject any implementation that infers database-default solely
  from absence of a user override.

---

## 2. Chosen Architecture

### 2.1 One-paragraph thesis

Add an **optional, no-op-by-default `onOp` hook** to the _existing_
`PCDCache.buildReadOnly` so the fragile per-op replay loop stays in one place.
During an on-demand, side-effect-side-free replay of all four layers, a
`LineageObserver` (1) runs a **pure `analyzeOpWriteSets(sql)`** that extracts only
`{table, explicitColumns[], kind}` per statement plus a `parseStatus`, (2) captures
which rows each op touched using **`SELECT rowid FROM t WHERE <whereExpr>` before
exec** (for UPDATE/DELETE) and a **rowid snapshot diff** (for INSERT), (3) reads
each touched row's **business key** via `LINEAGE_TABLE_KEYS` and writes lineage for
exactly the analyzer's explicit columns into a
`Map<${table}�${rowKey}�${column}, CellLineage>` with last-write-wins.
A parsed **schema-default map** (from `0.schema.sql`) classifies never-explicitly-
written columns as `schema-default` _only when the final value equals the parsed
default literal_ — otherwise `ambiguous`. Declarative per-family **projection
descriptors** map each `(table, rowKey, column)` cell onto the exact bracketed
Portable field path that `diffToFieldChanges` already produces. Per-op
`pcd_op_history` terminal status excludes/`ambiguous`-stamps non-applied ops.
Lineage is embedded in `ResolvedEntityState` behind `?includeLineage=true`.

### 2.2 Why this spine (vs. the alternatives)

- **Smallest parser blast surface.** The analyzer needs only table + column
  _names_ + statement kind — never literal values, never row keys (snapshots +
  business-key reads supply those). Anything unrecognized degrades to
  `parseStatus:'ambiguous'`, which marks touched cells ambiguous — never false
  provenance. This is the single biggest fragility across all designs, minimized.
- **Best regression profile.** The replay loop is not duplicated (rejecting
  Approach 1's `buildReadOnlyWithLineage` re-implementation). Existing callers
  (`withBaseOnlyCache`, `withCurrentCache`, snapshot builders) pass no hook and
  stay byte-identical. Route tests that patch `PCDCache.prototype.buildReadOnly`
  keep working because the hook is optional.
- **Structural AC3/AC7.** `schema-default` is derived from _absence of any
  explicit write across all layers_ (structural), cross-checked against the parsed
  default literal — never from absence of a user override, and never from a value
  diff.
- **Direct projection.** Business-key indexing means projection is a direct
  `(table, rowKey, column)` lookup with no rowid→name bridge at projection time.

### 2.3 Grafts folded into the spine

- **From Approach 1:** capture UPDATE/DELETE-affected rows by re-executing the
  analyzer's depth-0 `WHERE` as `SELECT rowid FROM t WHERE <whereExpr>` _before_
  exec (fixes the no-op-rewrite miss → exact AC1 last-writer), and consult each
  op's terminal `pcd_op_history` status, **extended** to `skipped`/`error` to close
  the value-guard divergence gap.
- **From Approach 2:** keep a **separate** `LINEAGE_ARRAY_KEY_STRATEGIES`
  (superset of `PORTABLE_ARRAY_KEY_STRATEGIES` with value-identity keys for scalar
  arrays) so `computeUserOverrides` is unperturbed; adopt its explicit two-level
  `orderedItems[].members[]` descriptor; and extract a shared pure
  `explainFieldLineage()` / `foldPendingConflict()` helper.

### 2.4 Data-flow narrative

```
GET .../resolved/{entityType}/{name}?includeLineage=true   (layer=resolved)
        │
        ▼
resolveEntityLineage(databaseId, entityType, arrType, name)      [engine.ts]
        │
        ├─ parseSchemaDefaults(pcdPath)  ── cached per pcdPath   [schemaDefaults.ts]
        │       └─ Map<table, Map<column, {literal, hasDefault, notNull}>>
        │
        ├─ withInstrumentedCache(databaseId, fn):                 [layers.ts]
        │       cache = new PCDCache(...)
        │       cache.buildReadOnly({layers: ALL_LAYERS}, { onOp: observer })
        │            │  per op, in strict layer order:
        │            │    observer.before(op, db):
        │            │        writeSets = analyzeOpWriteSets(op.sql)   [opWriteSet.ts]
        │            │        for UPDATE/DELETE: preRowids =
        │            │            SELECT rowid FROM t WHERE <whereExpr>
        │            │        for INSERT/UPDATE: snapshot target-table rowids
        │            │    db.exec(op.sql)          ← unchanged core
        │            │    observer.after(op, db):
        │            │        diff rowids → inserted/updated/deleted rows
        │            │        rowKey = LINEAGE_TABLE_KEYS[t](afterRow)  [tableKeys.ts]
        │            │        for col in writeSet.columns:
        │            │            index.set(t,rowKey,col,
        │            │                {sourceLayer: op.layer, opId|opRef, explicit:true,
        │            │                 parseStatus})    ← last-write-wins
        │            │        DELETE: evict cells for (t,rowKey)
        │            └─ returns { cache, index }               [lineageIndex.ts]
        │
        ├─ payload = serialize entity from `cache` (serialize.ts, untouched)
        ├─ lineage = projectEntityLineage(payload, index, schemaDefaults, ...)
        │       └─ descriptors map every Portable leaf → (table,rowKey,column)
        │          → look up index; classify schema-default / ambiguous / unavailable
        │
        ├─ fold pcd_op_history status (skipped/error/dropped/conflicted/pending)
        ├─ fold hasPendingConflict(entity) → entity-level ambiguous
        └─ return { lineage: FieldLineage[], lineageStatus }
        ▼
toWireLineage(...)  → attach to ResolvedEntityState  [resolved/shared.ts]
```

---

## 3. Lineage Record Type Definitions

The **shared wire type** lives in `packages/praxrr-app/src/lib/shared/pcd/fieldLineage.ts`
(sibling to `resolvedProvenance.ts`), and is the source of truth mirrored by the
OpenAPI `FieldLineage` schema.

```ts
// $shared/pcd/fieldLineage.ts

/** The four distinct source layers (AC2). File layers (schema, tweaks) have no opId. */
export type LineageSourceLayer = 'schema' | 'base' | 'tweaks' | 'user';

/** Per-field classification exposed on the wire. AC2 + AC3 + AC4. */
export type LineageSourceKind =
  | 'schema-default' // never explicitly written by any op; value == parsed DEFAULT
  | 'base-op'
  | 'tweaks-op'
  | 'user-op'
  | 'ambiguous' // evidence conflicts or is unparseable; NO source claim (AC4)
  | 'unavailable'; // no cell and no default backs this path (AC4/AC5)

/** Top-level field status. Distinct from sourceKind so status is a first-class gate. */
export type LineageFieldStatus = 'resolved' | 'ambiguous' | 'unavailable';

/** Entity-level rollup returned alongside the array. */
export type LineageEntityStatus = 'available' | 'ambiguous' | 'unavailable';

/** Identity of a FILE-layer op (schema/tweaks) which has no pcd_ops row / opId. */
export interface LineageOpRef {
  filename: string;
  order: number;
}

/** One record per serializer-emitted Portable leaf path. */
export interface FieldLineage {
  /** Bracketed nested path, byte-identical to diffToFieldChanges (e.g. `conditions["HDR"].negate`). */
  fieldPath: string;
  /** Required gate. Non-'resolved' rows make NO source claim. */
  status: LineageFieldStatus;
  /** null unless status==='resolved'. */
  sourceLayer: LineageSourceLayer | null;
  /** Always present; 'ambiguous'/'unavailable' when status!=='resolved'. */
  sourceKind: LineageSourceKind;
  /** DB ops (base/user) only; null for file layers and schema-default. */
  opId: number | null;
  /** FILE ops (schema/tweaks) only; null for DB ops and schema-default. */
  opRef: LineageOpRef | null;
  /** true iff a column list explicitly named this column (AC3). */
  explicit: boolean;
  /** Display-only signal; NOT used for classification. Present when comparable. */
  valueEqualsDefault?: boolean;
}
```

Internal (server-only) capture types live in
`packages/praxrr-app/src/lib/server/pcd/resolved/lineage/*` and never cross the wire:

```ts
// lineage/lineageIndex.ts
export interface CellLineage {
  sourceLayer: LineageSourceLayer;
  opId: number | null;
  opRef: LineageOpRef | null;
  explicit: true; // a cell only exists because a column was explicitly written
  parseStatus: 'parsed' | 'ambiguous';
}

export type CellKey = string; // `${table}�${rowKey}�${column}`
export type RowKey = string; // LINEAGE_TABLE_KEYS[table] values joined by ''

export interface LineageIndex {
  set(table: string, rowKey: RowKey, column: string, cell: CellLineage): void;
  get(table: string, rowKey: RowKey, column: string): CellLineage | undefined;
  evictRow(table: string, rowKey: RowKey): void;
}

// lineage/opWriteSet.ts
export interface WriteSet {
  table: string;
  columns: string[]; // explicit column names ONLY (never values, never keys)
  kind: 'insert' | 'update' | 'delete';
  whereExpr: string | null; // raw depth-0 WHERE substring for update/delete; null for insert
}
export interface OpWriteSetResult {
  writeSets: WriteSet[];
  parseStatus: 'parsed' | 'ambiguous';
}

// lineage/schemaDefaults.ts
export interface SchemaDefaultEntry {
  hasDefault: boolean;
  defaultLiteral: string | null; // normalized SQL literal, e.g. "0", "'smart'", "4"
  notNull: boolean;
  schemaFile: string; // owning schema op filename (AC1 provenance for defaults)
}
export type SchemaDefaultMap = Map<
  string /*table*/,
  Map<string /*column*/, SchemaDefaultEntry>
>;
```

---

## 4. Capture Mechanism (precise)

### 4.1 The `onOp` hook on `buildReadOnly`

`PCDCache.buildReadOnly(opts, hooks?)` gains an optional second argument:

```ts
interface BuildReadOnlyHooks {
  onOp?: {
    before(op: Operation, db: Database): void;
    after(op: Operation, db: Database): void;
  };
}
```

- When `hooks?.onOp` is `undefined` (every existing caller), the method is
  byte-identical to today — no snapshots, no overhead.
- The hook wraps the existing per-op `db.exec(op.sql)` inside the replay loop.
  `before` runs immediately before `db.exec`, `after` immediately after. No other
  line of `buildReadOnly` changes. `build()` and the private `bootstrap()` /
  `registerHelperFunctions()` are untouched.

`build()` (the live registered cache) never passes a hook, so sync and value-guard
behavior are unaffected.

### 4.2 `analyzeOpWriteSets(sql)` — the pure write-set analyzer

Input: the raw inlined op SQL (self-contained, no bind params). Output:
`OpWriteSetResult`.

Handled statement shapes (from confirmed op SQL):

1. `INSERT INTO t (c1,c2,...) VALUES (...),(...) [ON CONFLICT(...) DO NOTHING];`
   → `{table:t, columns:[c1,c2,...], kind:'insert', whereExpr:null}`. The
   `ON CONFLICT(...)` clause is recognized and its column list is **ignored** (not
   an explicit write set). Multi-row `VALUES` share the one column list.
2. Kysely-compiled `update "t" set "c1" = v1, "c2" = fn(x) where "x" = y`
   → `{table:t, columns:[c1,c2], kind:'update', whereExpr:'"x" = y'}`. Only the
   SET column names are captured; values (which may contain commas, parens, `fn()`)
   never leak into `columns`.
3. `delete from "t" where ...`
   → `{table:t, columns:[], kind:'delete', whereExpr:'...'}`.
4. **Multi-statement ops** (semicolon-separated) are split first by a
   depth/quote/comment-aware `splitStatements` tokenizer, then each statement is
   analyzed independently; the observer applies them in order (last-write-wins
   handles DELETE-then-reINSERT).

Tokenizer requirements (`splitStatements` + head parse):

- Track single-quote string literals **including `''` escapes**; ignore `;`, `(`,
  `)`, and keywords inside them (CF regex literals contain commas, parens, quotes).
- Track double-quoted identifiers (Kysely idents).
- Track `--` line and `/* */` block comments.
- Split `;` only at depth 0 and outside quotes/comments.
- Extract the explicit column list from the parenthesized group after the table
  name (INSERT) or the `set` clause identifiers before the depth-0 `where`
  (UPDATE), splitting on depth-0 commas only.
- Extract `whereExpr` as the raw substring after the depth-0 `where` token.

**Safe ambiguous fallback (AC4/AC7 keystone):** any statement the analyzer does
not confidently recognize as one of the three shapes (e.g. `INSERT ... SELECT`,
trigger-driven writes, an unexpected construct) sets `parseStatus:'ambiguous'` for
the whole op. Every cell that op touches is then stamped `ambiguous`. The analyzer
**never guesses** and never emits `schema-default` from a parse gap.

### 4.3 Row capture: which rows did the op touch?

Because the analyzer intentionally does not parse values or keys, the observer
resolves affected rows against the live db:

- **INSERT:** `before` snapshots `SELECT rowid FROM <table>` into a `Set`; `after`
  re-snapshots; new rowids are the inserted rows. `ON CONFLICT DO NOTHING` that
  no-ops adds no rowid → correctly wins nothing.
- **UPDATE:** `before` runs `SELECT rowid FROM <table> WHERE <whereExpr>` to get
  matched rowids (SQLite parses the re-run SELECT, so no WHERE literal parsing).
  These rowids are the affected rows — even for an explicit **no-op re-write** that
  changes no value, giving exact AC1 last-writer semantics.
- **DELETE:** same targeted `SELECT rowid ... WHERE <whereExpr>` in `before`; in
  `after`, evict every cell for those `(table, rowKey)`.

rowid is used **only within a single op's before/after pair**, so cross-op rowid
reuse after a DELETE is harmless.

### 4.4 Business-key indexing (`LINEAGE_TABLE_KEYS`)

For each touched row, the observer reads the row's **stable business key** from the
after-row and joins it into a `RowKey`. `LINEAGE_TABLE_KEYS` (in `tableKeys.ts`)
maps each lineage-relevant table to its natural key columns, e.g.:

| Table                                               | Key columns                                                |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `custom_formats`                                    | `[name]`                                                   |
| `custom_format_conditions`                          | `[custom_format_name, name]`                               |
| `quality_profiles`                                  | `[name]`                                                   |
| `quality_profile_custom_formats`                    | `[quality_profile_name, custom_format_name, arr_type]`     |
| `quality_profile_qualities`                         | `[quality_profile_name, quality_name /* or group */]`      |
| `quality_group_members`                             | `[quality_profile_name, quality_group_name, quality_name]` |
| `radarr_naming` / `sonarr_naming` / `lidarr_naming` | `[name]` (or arr-scoped key)                               |
| `<arr>_quality_definitions`                         | `[name, quality_name]`                                     |
| `lidarr_metadata_profile_*_types`                   | `[metadata_profile_name, type_id /* or status_id */]`      |

The helper functions `cf()/qp()/dp()/mp()/tag()` resolve FKs during exec, so the
after-row already holds resolved id/name columns; the observer never resolves keys
itself. Reading the key from the after-row (not from parsed SQL) is what keeps the
analyzer value/key-free.

### 4.5 Last-writer-wins & the four source layers + op identity

- `index.set(...)` overwrites unconditionally, so the **last** op in strict layer
  order that explicitly wrote a `(table, rowKey, column)` cell wins — exact AC1
  "last establishing".
- `op.layer` (from `loadAllOperations`, assigned by the strict `schema → base →
tweaks → user` ordering) is ground truth for `sourceLayer` — **no inference**.
- **Op identity per layer (AC2):**
  - `base` / `user` are DB ops: `op.filepath === 'pcd_ops:<id>'` → `opId =
parseOpId(op.filepath)`; `opRef = null`.
  - `schema` / `tweaks` are FILE ops with **no `pcd_ops` row / opId** → `opId =
null`; `opRef = { filename: op.filename, order: op.order }`.
  - This dual `opId` / `opRef` identity is exactly what keeps all four sources
    distinguishable despite two layers having no opId.
- `sourceKind` derives 1:1 from `sourceLayer` for explicit cells:
  `base→'base-op'`, `tweaks→'tweaks-op'`, `user→'user-op'`. The `schema` layer is
  DDL + seed-only for Portable-backing tables; an explicit `schema`-layer write to
  a Portable-backing table is unexpected and logged fail-soft (still recorded as an
  explicit cell if it happens; seed tables like `languages`/`qualities` back no
  Portable field so they never surface).

---

## 5. Explicit-vs-Implicit (AC3) and Never-Infer-From-Absence (AC7)

### 5.1 The structural rule

A resolved column is `schema-default` **if and only if** no op in any layer ever
explicitly named it for that row (so the value was materialized by the
`CREATE TABLE ... DEFAULT` clause at INSERT time). Concretely, at projection time
for a `(table, rowKey, column)`:

1. `cell = index.get(table, rowKey, column)`.
2. **If `cell` exists** → an op explicitly wrote it:
   `{status:'resolved', sourceLayer:cell.sourceLayer, sourceKind:`${layer}-op`,
opId/opRef from cell, explicit:true}`. This holds **even when the written value
   equals the default** — e.g. a base INSERT naming `include_in_rename=0` (== DEFAULT 0) is `{base-op, explicit:true, valueEqualsDefault:true}`.
3. **If `cell` is absent** → never explicitly written. Consult `schemaDefaults`:
   - `hasDefault && finalValue == defaultLiteral` →
     `{status:'resolved', sourceLayer:'schema', sourceKind:'schema-default',
opId:null, opRef:{filename:schemaFile, order:…}, explicit:false,
valueEqualsDefault:true}`.
   - `hasDefault && finalValue != defaultLiteral` → **`ambiguous`** (a never-named
     column whose value differs from the parsed default implies an unmodeled write
     path — a trigger, an `INSERT..SELECT`, or a parse gap — so we refuse to claim
     `schema-default`). This is the AC7/AC4 guard against unforeseen SQL.
   - `!hasDefault` and value is a serializer coercion of NULL (e.g. `usenetDelay ??
0`) → `unavailable` (no default backs it, no explicit write) unless the
     descriptor marks it as a known implicit-null coercion, in which case
     `status:'resolved', sourceKind:'schema-default'` is **not** used; it stays
     `unavailable` — we never invent a source for a coercion.

### 5.2 Why AC7 holds structurally

`schema-default` depends only on **absence of ANY explicit write across all four
layers** plus a positive value==default check — it is _never_ derived from
"there is no user override." Removing or adding an unrelated user override op:

- does not create or delete cells for other rows/columns, so a base-op field keeps
  its `base-op` classification;
- does not promote any never-written column to a non-default source.

`valueEqualsDefault` is a display-only signal and is explicitly **not** an input to
classification, so a value-diff can never masquerade as provenance. The paired
negative test in §10 fails any absence-based or value-diff-based implementation.

---

## 6. Value-Guard / Dropped / Conflicted / Pending Handling (AC4)

`buildReadOnly` runs **no** value guards and replays all `state='published'` ops.
Only `dropped` mutates `pcd_ops.state`. This is the deepest hole; we close it by
consulting each op's **terminal `pcd_op_history` status** and folding entity-level
pending conflicts.

1. **Dropped** — `loadDbOps` loads `state:['published']` only; `build()` sets
   `state='dropped'`. Dropped ops are structurally absent from the replay and can
   never establish a cell. The surviving op/default is attributed. ✔ never false.
2. **Skipped / error (the graft that closes the divergence gap)** — these stay
   `published` and WOULD be replayed, so they could falsely establish a cell the
   live `build()` never applied. Before returning, the engine loads the latest
   `pcd_op_history` status per opId (`pcdOpHistoryQueries`, an object method that is
   patchable in tests). Any cell whose establishing `opId` has terminal status
   `skipped` or `error` is **excluded** — re-resolved to the previous surviving
   writer or default; if none, `unavailable`. This is the only design that closes
   the skipped/error divergence.
3. **Conflicted / conflicted_pending** — any cell whose establishing `opId` has
   terminal status `conflicted` or `conflicted_pending` is re-stamped
   `{status:'ambiguous', sourceKind:'ambiguous'}` (finer than entity-level).
4. **Superseded** — naturally handled by last-write-wins; no special casing.
5. **Entity-level pending (Business Rule 6)** — reuse
   `buildPendingConflictIndex(databaseId)` correlating `pcd_op_history`
   `conflicted`/`conflicted_pending` ops by metadata `{entity, name}`. When
   `hasPendingConflict(entity)` is true, **every** field of the entity is forced to
   `{status:'ambiguous', sourceKind:'ambiguous', sourceLayer:null}` and the entity
   `lineageStatus='ambiguous'`.
6. **Absent entity / unmapped field / no backing cell or default** →
   `{status:'unavailable', sourceKind:'unavailable'}`.

The status folding is done in the shared pure helpers `explainFieldLineage()` and
`foldPendingConflict()` in `$shared/pcd/fieldLineage.ts`, unit-testable without a
cache.

---

## 7. Projection to Nested Portable Field Paths (AC6)

### 7.1 Strategy

`projection.ts` holds a declarative descriptor set per entity family — data that
**mirrors `serialize.ts`** (so `serialize.ts` stays untouched). A single generic
projector walks the serialized Portable payload plus the descriptors and emits one
`FieldLineage` per leaf, keyed by the **same** dotted/bracketed convention
`diffToFieldChanges` produces. Each descriptor entry is:

- **Scalar leaf:** `{ portablePath, table, column, rowKeyFrom(payload) }`.
- **Keyed array leaf:** `{ arrayPath, table, itemKeyStrategy, columnMap,
rowKeyFrom(payload, item) }`, where `itemKeyStrategy` comes from
  `LINEAGE_ARRAY_KEY_STRATEGIES`.

### 7.2 `LINEAGE_ARRAY_KEY_STRATEGIES` (separate superset)

Kept **separate** from `PORTABLE_ARRAY_KEY_STRATEGIES` so `computeUserOverrides`
and the override-diff path are completely unperturbed. It is a superset that adds
**value-identity keys for scalar arrays** (e.g. `tags[]`, `sources[]`,
`resolutions[]`) so those bracket segments are stable. For keyed object arrays it
reuses the same `selectKey` fns and the same `JSON.stringify(key)` bracket
rendering as `diff.ts`, guaranteeing byte-identical paths (e.g.
`conditions["x265"].negate`, `orderedItems["Bluray-1080p"].members[0].name`,
`entries["WEBDL-1080p"].maxSize`, `customFormatScores["HDR:radarr"].score`,
`primaryTypes["Album"].allowed`, `tags[0]`).

### 7.3 All 12 payload shapes

- **Arr-agnostic (4):** `delayProfile`, `regularExpression`, `customFormat`,
  `qualityProfile`.
- **Per-arr (7):** `naming` ×3 (radarr/sonarr/lidarr → `radarr_naming` /
  `sonarr_naming` / `lidarr_naming`), `mediaSettings` ×3, `qualityDefinitions` ×3
  (`<arr>_quality_definitions`).
- **Lidarr-only (1):** `lidarrMetadataProfile`
  (`lidarr_metadata_profile_*_types`).

Every descriptor set covers each serializer-emitted leaf, including deep nesting:
`conditions[].negate/arrType`, `conditions[].languages[].except`,
`orderedItems[].enabled/upgradeUntil` and the second-level
`orderedItems[].members[].name`, `entries[].maxSize`, `customFormatScores[].score`,
`primaryTypes[]/secondaryTypes[]/releaseStatuses[].allowed`, `tags[]`.

### 7.4 The hardest shape: quality profile `orderedItems`

`orderedItems` is **join-derived** from `quality_profile_qualities`
(`position`/`enabled`/`upgrade_until`, keyed by `quality_name` OR
`quality_group_name`) plus `quality_groups` plus `quality_group_members`, with a
second `members[]` array level. The descriptor encodes **both** the primary-table
mapping (item-level fields → `quality_profile_qualities` cells) **and** the members
child-table mapping (`members[].name` → `quality_group_members` cells) explicitly,
with distinct `rowKeyFrom` closures. This is called out for dedicated tests.

### 7.5 Drift guard (the AC6 gate)

`projection.test.ts` serializes each entity for each family/arr mapping and asserts
that **every** serializer-emitted leaf path resolves to exactly one descriptor
entry whose emitted `fieldPath` **byte-matches** the path `diffToFieldChanges`
would produce. If `serialize.ts` adds a leaf without a descriptor, CI fails. Per
the "deep CF-condition" gap: because this drift test demands every emitted leaf
resolve, the descriptors must cover every serializer-emitted leaf in-PR — only
paths `serialize.ts` never emits may be `unavailable`.

---

## 8. API Contract

### 8.1 Decision: embed, do not add an endpoint

Lineage is intrinsically per-`(entity, layer, field)`; the UI already fetches
`ResolvedEntityState` per entity+layer. A separate endpoint would duplicate the
entity read, add a round-trip, and re-derive the exact bracketed path convention
that must stay in lockstep with `overrides`. So we **embed**.

### 8.2 New / changed schemas (`docs/api/v1/schemas/resolved-config.yaml`)

- **`FieldLineage`** (new):

  ```yaml
  FieldLineage:
    type: object
    required: [fieldPath, status, sourceKind, explicit]
    properties:
      fieldPath: { type: string }
      status: { type: string, enum: [resolved, ambiguous, unavailable] }
      sourceLayer:
        type: string
        enum: [schema, base, tweaks, user]
        nullable: true
      sourceKind:
        type: string
        enum:
          [schema-default, base-op, tweaks-op, user-op, ambiguous, unavailable]
      opId: { type: integer, nullable: true }
      opRef:
        type: object
        nullable: true
        required: [filename, order]
        properties:
          filename: { type: string }
          order: { type: integer }
      explicit: { type: boolean }
      valueEqualsDefault: { type: boolean }
  ```

- **`ResolvedEntityState`** gains two optional fields, present **only** when
  `includeLineage=true` (so default responses stay byte-identical and pay zero
  cost):

  ```yaml
  lineage:
    type: array
    items: { $ref: '#/components/schemas/FieldLineage' }
    nullable: true
  lineageStatus:
    type: string
    enum: [available, ambiguous, unavailable]
    nullable: true
  ```

### 8.3 Endpoint

`GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}` gains an opt-in
`?includeLineage=true` query param (default `false`). Honored only for
`layer=resolved`. When set, the handler calls `resolveEntityLineage(...)` and
attaches `lineage` + `lineageStatus` via a new `toWireLineage()` narrowing helper
in `resolved/shared.ts` (mirrors `toWireOverrides`). `layer=base`/`layer=user`
retain current behavior. The resolved **list** endpoint is unchanged for v1
(deferred; see §13).

### 8.4 Exact ordered lockstep files + regen tasks

Follow the confirmed contract-lockstep flow (see `praxrr-commands` skill for exact
invocations). In order:

1. Edit `docs/api/v1/schemas/resolved-config.yaml` (add `FieldLineage`, extend
   `ResolvedEntityState`).
2. Edit `docs/api/v1/openapi.yaml` (register the `FieldLineage` `$ref`).
3. Run `deno task generate:api-types` → regenerates
   `packages/praxrr-app/src/lib/api/v1.d.ts`. **If the regen emits tool-version
   noise (known repo lesson), revert the file and hand-graft only the
   `FieldLineage` + `ResolvedEntityState` additions** to keep the diff scoped.
4. Run `deno task bundle:api` → deterministically regenerates
   `packages/praxrr-api/openapi.json` (prettier-gated) **and**
   `packages/praxrr-api/types.ts`.
5. `deno fmt` / `prettier --write packages/praxrr-api/openapi.json` so the
   prettier-gated mirror passes CI.
6. Keep the `$shared/pcd/fieldLineage.ts` TS type in lockstep with the generated
   schema (hand-authored, mirrors `FieldChange`).

`praxrr-api` / `praxrr-db` / `praxrr-schema` workspace mirrors move together with
the `openapi.json` / `types.ts` change.

---

## 9. UI Changes

File: `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`
(Svelte 5, **no runes** — `onclick`, reactive `$:`, no `$state`/`$derived`).

- When `activeLayer === 'resolved'`, the fetch appends `&includeLineage=true`.
- Build a lookup: `$: lineageByField = new Map((data.lineage ?? []).map(l =>
[l.fieldPath, l]))`.
- The per-field value table (the `{#each fields}` block) gains a **"Source"**
  column rendering a `Badge` per field, driven by `FieldLineage.sourceKind`:
  - `schema-default` → neutral "Schema default"
  - `base-op` → neutral "Base op"
  - `tweaks-op` → info "Tweaks op"
  - `user-op` → accent "User op"
  - `ambiguous` → amber "Ambiguous" (no source claim)
  - `unavailable` → dashed/neutral "Unavailable" (no source claim)
- A subordinate **explicit-vs-default marker** (`explicit:false` → muted "default"
  pill; `explicit:true` → op badge). The `opId` (or `opRef.filename` + `order` for
  file layers) is shown in the `title`/tooltip.
- An entity-level lineage status line next to the existing provenance badge, driven
  by `lineageStatus`. The existing `hasPendingConflict` banner and entity-level
  `explainResolvedProvenance` badge remain.
- **Scope cut for v1:** scalar fields show the Source column inline; nested-field
  lineage (`conditions`/`orderedItems`/`entries`/type arrays) is delivered by the
  API and shown in the expanded/raw JSON region — a full nested lineage tree is
  deferred without weakening AC5.

Helpers `LINEAGE_META` + `formatLineage()` are added to the existing
`packages/praxrr-app/src/lib/client/ui/resolved/fieldChangeDisplay.ts` (alongside
`FIELD_META`, reusing `formatFieldValue`) — no new client file.

---

## 10. Test Plan (1:1 to AC6/AC7)

Reuse confirmed harnesses: the `cacheBuildReadOnly.test.ts` temp-dir pattern (real
`deps/schema/ops/0.schema.sql` + `tweaks/*.sql` files, stubbed
`pcdOpsQueries.listByDatabaseAndOrigin`, seeded `pcd_op_history` via its patchable
object method); `createCacheFixture(sql)` for fakes; route tests patch
`PCDCache.prototype.buildReadOnly` / the engine's `resolveEntityLineage`.

### 10.1 `lineage/opWriteSet.test.ts` — adversarial parser

- INSERT with explicit column list vs omitting a column.
- Multi-row `VALUES` sharing one column list.
- Kysely double-quoted idents: `update "t" set "c" = v where "x" = y`.
- `VALUES` tuple containing a CF regex literal with embedded commas/parens/escaped
  `''` quotes (proves depth+quote-aware tokenizing, not naive split).
- `ON CONFLICT(...) DO NOTHING` (clause ignored, columns parsed).
- Multi-statement semicolon-separated op (DELETE then re-INSERT).
- Depth-0 `WHERE` extraction incl. a parenthesized subexpression and compound
  `a AND b`.
- Unparseable statement → `parseStatus:'ambiguous'`.

### 10.2 `lineage/schemaDefaults.test.ts`

- `custom_formats.include_in_rename DEFAULT 0`,
  `quality_profiles.upgrade_score_increment DEFAULT 1 CHECK(>0)`,
  `radarr_naming.colon_replacement_format DEFAULT 'smart'`, lidarr
  `DEFAULT 4`; quoted/int/`CURRENT_TIMESTAMP` defaults; NOT NULL vs nullable;
  `hasDefault:false` columns; owning `schemaFile` recorded.

### 10.3 `lineage/projection.test.ts` — the AC6 drift guard

- Table-driven over ALL 12 shapes × each arr mapping (radarr/sonarr/lidarr for
  naming/mediaSettings/qualityDefinitions; lidarr-only metadataProfile;
  delayProfile/regularExpression/customFormat/qualityProfile arr-agnostic).
- For each, serialize an entity and assert EVERY serializer-emitted leaf (incl.
  `conditions[].languages[].except`, `orderedItems[].members[].name`, `entries[]`,
  `primaryTypes/secondaryTypes/releaseStatuses[]`, `customFormatScores[]`, `tags[]`)
  resolves to exactly one descriptor entry whose `fieldPath` byte-matches
  `diffToFieldChanges`. Unmapped leaf → CI failure.

### 10.4 `lineage/lineageEngine.test.ts` — end-to-end (temp-dir PCD)

- **AC1** exact path + establishing op recorded.
- **AC2** four distinct sources across schema-default / base / tweaks / user.
- **Nested lists**: `orderedItems`, `conditions`, `customFormatScores`, metadata
  type arrays.
- **User-created entity** (no base row): all cells `user-op` or `schema-default`
  appropriately.
- **Each Arr mapping**: radarr/sonarr/lidarr naming + mediaSettings +
  qualityDefinitions; lidarr metadata profile.
- **AC4**: dropped op absent from replay; op seeded `conflicted_pending` in
  `pcd_op_history` → its cells `ambiguous`; op seeded `skipped`/`error` → excluded
  (re-resolved to prior writer/default, never establishing); pending-conflict
  entity forced ambiguous; unparseable op forced ambiguous; value-with-no-writer →
  `unavailable`.

### 10.5 `resolvedConfigLineageApi.test.ts` — route

- Patch `PCDCache.prototype.buildReadOnly` / `resolveEntityLineage`.
- `includeLineage=true` attaches `lineage` + `lineageStatus`; omitted → field
  absent (byte-identical default). `layer`/`arrType` validation unchanged.

### 10.6 THE AC7 CRUX (in `lineageEngine.test.ts`)

Two custom formats, neither with any user override:

1. base INSERT explicitly names `include_in_rename=0` (== schema DEFAULT 0) →
   `{sourceKind:'base-op', explicit:true, valueEqualsDefault:true}`.
2. base INSERT **omits** `include_in_rename` (value 0 via DEFAULT) →
   `{sourceKind:'schema-default', explicit:false, opId:null,
opRef:{filename:<schema file>}}`.

Same resolved value, opposite lineage. **Then** assert that adding OR removing an
unrelated USER override op changes **neither** the base-op field's classification
**nor** promotes any never-written column to a non-default source — proving default
is derived from absence-of-ANY-explicit-write (structural), never absence-of-user-
override. Any snapshot/absence/value-diff implementation fails both halves.

### 10.7 Strengthen `tests/shared/pcd/resolvedProvenance.test.ts`

Strengthen the existing `'withholds claims when evidence is missing'` case to
assert the **entity-level** `explainResolvedProvenance` still refuses
default/exact-op attribution now that field-level lineage is the authoritative
granular surface (it stays `base-side`/`unavailable`, never invents a default).

---

## 11. File-by-File Change List

### Create (server core)

- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/opWriteSet.ts`
- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/schemaDefaults.ts`
- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/tableKeys.ts`
- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/lineageIndex.ts`
  (LineageObserver + snapshot/where-capture + LineageIndex)
- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/projection.ts`
  (descriptors for all 12 shapes + `LINEAGE_ARRAY_KEY_STRATEGIES` + generic projector)
- `packages/praxrr-app/src/lib/server/pcd/resolved/lineage/engine.ts`
  (`resolveEntityLineage`, memoization, status folding)
- `packages/praxrr-app/src/lib/shared/pcd/fieldLineage.ts`
  (wire type + pure `explainFieldLineage()` / `foldPendingConflict()`)

### Create (tests)

- `packages/praxrr-app/src/tests/pcd/resolved/lineage/opWriteSet.test.ts`
- `packages/praxrr-app/src/tests/pcd/resolved/lineage/schemaDefaults.test.ts`
- `packages/praxrr-app/src/tests/pcd/resolved/lineage/projection.test.ts`
- `packages/praxrr-app/src/tests/pcd/resolved/lineage/lineageEngine.test.ts`
- `packages/praxrr-app/src/tests/routes/resolvedConfigLineageApi.test.ts`

### Edit (server)

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
  (add optional no-op `onOp` hook to `buildReadOnly`; `build()` unchanged)
- `packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts`
  (add `withInstrumentedCache(databaseId, fn)`)
- `packages/praxrr-app/src/lib/server/pcd/index.ts` (export surface)
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts`
  (parse `includeLineage`, attach lineage)
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/shared.ts`
  (`toWireLineage`)

### Edit (UI)

- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`
- `packages/praxrr-app/src/lib/client/ui/resolved/fieldChangeDisplay.ts`
  (`LINEAGE_META` + `formatLineage()`)

### Edit (contract lockstep — in the §8.4 order)

- `docs/api/v1/schemas/resolved-config.yaml`
- `docs/api/v1/openapi.yaml`
- `packages/praxrr-app/src/lib/api/v1.d.ts` (generated; hand-graft if noisy)
- `packages/praxrr-api/openapi.json` (generated, prettier-gated)
- `packages/praxrr-api/types.ts` (generated)

### Edit (tests + docs)

- `packages/praxrr-app/src/tests/shared/pcd/resolvedProvenance.test.ts` (strengthen)
- `ROADMAP.md` (mark #231; use the unique-string append to avoid concurrent-PR
  conflicts)

---

## 12. Risks & Mitigations

| Risk                                                                                                      | Mitigation                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL parse fidelity on adversarial op SQL (CF regex literals, Kysely idents, ON CONFLICT, multi-statement) | Analyzer needs only table + column **names** + kind; degrades to `parseStatus:'ambiguous'` on anything unrecognized → touched cells `ambiguous`, never false provenance. Purpose-built depth/quote/comment-aware tokenizer + adversarial `opWriteSet.test.ts`. |
| Projection descriptor drift vs `serialize.ts` (12 shapes)                                                 | `projection.test.ts` byte-parity drift guard fails CI if any serializer leaf lacks a descriptor.                                                                                                                                                               |
| Value-guard divergence: `skipped`/`error`/`superseded` published ops replayed                             | Consult terminal `pcd_op_history` status; exclude `skipped`/`error`/`dropped`; `ambiguous` for `conflicted`/`conflicted_pending`; last-write-wins for `superseded`. Explicit `lineageEngine.test.ts` cases.                                                    |
| Never-named column whose value != parsed default (trigger / `INSERT..SELECT`)                             | Classified `ambiguous`, not fabricated `schema-default` — the AC7/AC4 cross-check.                                                                                                                                                                             |
| Deep CF-condition type-specific leaves                                                                    | Descriptors must cover every serializer-emitted leaf (drift test is the gate); only truly non-serialized paths may be `unavailable`. Not deferrable.                                                                                                           |
| `buildReadOnly` signature change breaks callers / route-test prototype patch                              | Hook is optional and strictly no-op when absent; `build()` and all existing callers pass nothing → byte-identical.                                                                                                                                             |
| rowid reuse after DELETE mis-attributes                                                                   | rowid used only within one op's before/after pair; DELETE evicts cells for matched `(table, rowKey)` before reuse.                                                                                                                                             |
| Perf on large PCDs (targeted snapshots per op)                                                            | On-demand + opt-in `includeLineage` only; targeted `WHERE`/rowid snapshots (not full-db); off the sync hot path; memoize the lineage index per `(databaseId, opFingerprint)` within a request batch; cap via existing `resolved/limits.ts` if needed.          |
| `v1.d.ts` regen noise (repo lesson)                                                                       | Revert + hand-graft only the `FieldLineage`/`ResolvedEntityState` additions.                                                                                                                                                                                   |
| Concurrent-PR conflicts on `ROADMAP.md` / `openapi.yaml` append points                                    | Take main's version, re-apply additions via unique-string; keep both openapi tags.                                                                                                                                                                             |

---

## 13. Scope Boundaries — In-PR vs Deferred

### Non-negotiable in-PR (AC-driven, cannot be cut)

- The pure `analyzeOpWriteSets` analyzer + `splitStatements` tokenizer.
- `schemaDefaults` parser over `0.schema.sql`.
- The `onOp` hook on `buildReadOnly` + `LineageObserver` + business-key
  `LineageIndex` + WHERE/rowid row capture.
- Projection descriptors for **ALL 12** payload shapes + the `serialize.ts` drift
  test (AC6).
- Value-guard status handling incl. `skipped`/`error` exclusion (closes the
  critical divergence gap; AC4).
- The API field (`FieldLineage` + `lineage`/`lineageStatus`) behind
  `?includeLineage=true` and the minimal UI Source column + status pills (AC5).
- The paired AC7 negative test + strengthened `resolvedProvenance` test.

### Safe to defer WITHOUT weakening any AC

- A rich nested-lineage UI **tree** — v1 ships the scalar Source column + status
  pills and delivers nested lineage over the API/raw region (AC5 satisfied).
- **List-endpoint lineage** — v1 is per-entity only; closing it later needs no
  contract change beyond honoring the flag on the list handler (noted for reviewer
  acceptance).
- Perf hardening beyond per-request memoization (single-incremental-cache, cross-
  instance lineage).

### If reviewers demand a split

The only clean seam is **PR-A** = server-only core + tests (no contract change) and
**PR-B** = API contract + route + UI. Prefer keeping them together so AC5 and AC6
land in one reviewable unit.
