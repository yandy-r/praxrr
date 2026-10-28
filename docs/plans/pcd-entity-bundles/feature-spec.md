# Feature Spec: PCD Entity Bundles — Multi-Entity Export / Import (YAN-568 / GH #390)

Research companion to `plan.md` (same directory). All paths relative to the worktree root
`/home/yandy/Projects/github.com/yandy-r/praxrr-yan-568`. Line numbers verified against
branch `feat/yan-568-entity-bundles`.

## 0. Problem, verified

- `GET /api/v1/pcd/export` accepts exactly one `name` and returns one portable entity
  (`routes/api/v1/pcd/export/+server.ts:51-92`). A quality profile (QP) export therefore
  omits the custom formats (CFs) its `customFormatScores` reference by **name only**
  (`shared/pcd/portable.ts:285-301` — `PortableCustomFormatScore.customFormatName`) and the
  regexes each CF's pattern conditions reference (`schema/ops/0.schema.sql:212-219`,
  `condition_patterns.regular_expression_name` FK). Importing a QP alone into another
  database either fails the FK during `updateScoring` or silently drops scores.
- The only import consumer is `CloneModal.svelte:39-57` (same-database clone:
  export → rename → import). No import UI exists for foreign bundles.
- List pages copy single-entity JSON to the clipboard
  (`routes/quality-profiles/[databaseId]/+page.svelte:50-68`; same pattern in 7 other list
  pages). No download, no dependencies.

## 1. Current code paths

### 1.1 Export

`GET /api/v1/pcd/export?databaseId&entityType&name`
(`routes/api/v1/pcd/export/+server.ts`):

- `_serializeDependencies` map (`:22-37`) → `serializeEntity` switch (`:94-130`) →
  `lib/server/pcd/entities/serialize.ts` per-type serializer.
- Response `{ entityType, data, migration: { source: 'pcd-export', format: 'json', version: 1 } }`
  (`:76-84`). 404 when the entity is missing (message contains `not found`, `:87-88`).
- QP serializer reads `quality_profile_custom_formats` by name
  (`serialize.ts:154-158`) — the dependency surface for closure walking.
- CF serializer embeds conditions via `getConditionsForEvaluation`
  (`serialize.ts:104`, `entities/customFormats/conditions/read.ts:11-20`); pattern
  conditions carry `{ name, pattern }` resolved through
  `condition_patterns ⋈ regular_expressions` (`read.ts:28-35`) — the regex dependency surface.

### 1.2 Import

`POST /api/v1/pcd/import` body `{ databaseId, layer, entityType, data, migration? }`
(`routes/api/v1/pcd/import/+server.ts:71-170`):

1. Validates migration metadata, layer (`parseOperationLayer`), entity type, `canWriteToBase`
   for `layer=base` (`:96-110`), payload shape + Lidarr allowlists
   (`validateLidarrPayload`, `:257-299`), then `validatePortableData`
   (`entities/validate.ts:19-39`).
2. `deserializeEntity` (`:180-255`) dispatches through `_deserializeDependencies`
   (`:41-55`, the test seam patched by `tests/base/lidarrApiParity.test.ts:816`).
3. Deserializers (`lib/server/pcd/entities/deserialize.ts`) call the entity `create`
   functions; **compound entities issue MULTIPLE writes, not one**:
   - `deserializeCustomFormat` (`:247-294`): `cfQueries.create` → `updateConditions` → one
     `createTest` per test. Refetches `getCache(databaseId)` between steps (`:265,268`).
   - `deserializeQualityProfile` (`:300-346`): `qpQueries.create` → `updateQualities` →
     `updateScoring`, refetching the cache twice (`:317,329`).
     Each step is a separate `writeOperation` call with its own full `compile()`.
4. Failure mode: a mid-sequence throw (e.g. QP step 3 after steps 1-2 succeeded) leaves the
   earlier ops **persisted** — there is no rollback in this route. That is the atomicity gap
   this feature closes for bundles.

### 1.3 Writer / op persistence

`lib/server/pcd/ops/writer.ts`:

- `writeOperation` (`:927-943`) wraps queries into ONE `pcd_ops` row per call
  (`writeOperationsFromSqlOperations:787-892`, `pcdOpsQueries.create` at `:845`), validates
  SQL against the live cache first (`cache.validateSql`, `:728-752`; savepoint-based probe
  in `database/cache.ts:542-575` — FK failures are reported as validation errors), then
  **full `compile()` after every write** (`:900`).
- User-layer ops get one `actionId` per AsyncLocalStorage scope
  (`actionContext.ts:7-19`, consumed at `writer.ts:702`); `hooks.server.ts:374` wraps every
  mutating HTTP request in `withUserOpAction`, so one bundle import = one undo unit.
- Update/delete user ops supersede prior ops (`supersedePriorUserOps`, `:598-685`) —
  relevant to collision policy `overwrite` (§5).
- Base layer writes require PAT + `local_ops_enabled=false` (`canWriteToBase`, `:956-959`).

### 1.4 Atomicity precedents (reuse these exact patterns)

- `restoreImportSnapshot(databaseId, snapshot, created)`
  (`db/queries/pcdOps.ts:265-342`): fully synchronous single-SAVEPOINT compensating
  rollback. Restores every pre-existing row the context **updated** column-for-column
  (incl. `updated_at`), un-points `superseded_by_op_id`, deletes `pcd_op_history` rows then
  `pcd_ops` rows the context **created**. Throws if a snapshot row vanished.
- `withOpCreationRecorder(record, fn)` (`db/opCreationRecorder.ts:28-66`): AsyncLocalStorage
  scope recording created op ids / history ids / updated op ids; nested scopes propagate to
  enclosing records. `pcdOpsQueries.create`/history `create` call `recordCreatedOpId` etc.,
  so the recorder captures writer-created rows without touching the writer.
- Consumers: `ops/importBaseOps.ts:471,417` (rollbackFailedImport `:398-421`),
  `conflicts/override.ts:253,197`, `overrides/revert.ts:264,209`.
- Why compensating rollback instead of one SQLite transaction: the writer path
  `validateSql` + `pcdOpsQueries.create` + `compile()` mixes synchronous app-DB statements
  with async cache builds; `db.transaction` (`db/db.ts:220-234`) awaits inside the
  transaction body, so an async `compile()` between BEGIN/COMMIT would hold the single
  shared connection open across awaits — the repo deliberately avoids this. Follow the
  snapshot+recorder+`restoreImportSnapshot` pattern instead.
- Cache restore: after rollback, `invalidate(databaseId)` (`importBaseOps.ts:469` and
  friends) so the next read rebuilds; `compile()` is re-run after the compensated state is
  restored (do this in the rollback path of bundle import, see plan).

### 1.5 Ephemeral caches (dry-run sandbox)

- `sandbox/withSandboxCache.ts:62-173`: builds an unregistered `PCDCache`
  (`buildReadOnly({ layers: schema|base|tweaks|user })`), applies candidate ops **directly
  to the raw handle** inside SAVEPOINTs, never touches `pcd_ops`/`getCache`. This is the
  dry-run precedent; note it applies compiled SQL itself rather than calling deserializers.
- `resolved/layers.ts:118-144` (`withEphemeralCache`) is the generic builder used by
  `withBaseOnlyCache`/current-state replays; `withScopedCache` (`database/registry.ts`)
  temporarily swaps `getCache` so deserializer-internal `getCache()` refetches see the
  sandbox — used by `incoming/preview.ts:170` and `importBaseOps.ts:472`. **Bundle dry-run
  must use `withScopedCache` around a writable ephemeral cache** because deserializers
  refetch `getCache` mid-sequence (§1.2.3).

### 1.6 Locks

`conflicts/override.ts:117-149` — `withDatabaseOverrideLock(databaseId, fn)`: FIFO promise
chain keyed by databaseId, re-entrant via AsyncLocalStorage-held set. Bundle import should
run its apply (and dry-run) inside this lock so it cannot interleave with overrides/reverts
or another import. It is not exported from `$pcd/index.ts` yet (imported dynamically in
`overrides/revert.ts:154`).

### 1.7 Graph / dependency edges

`lib/server/pcd/graph/`:

- Edge kinds (`graph/types.ts:24-28`): `quality_profile_custom_format` (E1),
  `custom_format_regular_expression` (E2), `quality_profile_quality` (E3),
  `quality_definition_quality` (E4). Node kinds (`:21`): `custom_format`,
  `regular_expression`, `quality_profile`, `quality`, `quality_definition`.
- `getOutgoingEdges(cache, node)` (`graph/edges.ts:269-283`) gives forward dependencies:
  - QP → CFs from `quality_profile_custom_formats` (`e1Forward`, `edges.ts:49-62`).
  - CF → regexes from `condition_patterns ⋈ custom_format_conditions` (`e2Forward`,
    `edges.ts:101-108`).
  - QP → qualities (E3) and quality-definition → quality (E4) reference **leaf** rows
    (qualities/languages/tags are schema seed data, not portable entities) — excluded from
    bundle closure.
- Caps: `IMPACT_VISITED_CAP=500`, `GRAPH_EDGE_CAP=5000` (`graph/types.ts:96-98`). The
  bundle closure walk reuses these caps.

### 1.8 Entity-type inventory (portable `ENTITY_TYPES`, `shared/pcd/portable.ts:222-235`)

14 types. Dependency-bearing: `quality_profile` (→ CF), `custom_format` (→ regex).
All others are leaves: delay profiles, regexes, radarr/sonarr/lidarr naming, radarr/sonarr/
lidarr media settings, radarr/sonarr quality definitions, lidarr metadata profile,
lidarr naming/media-settings/quality-definitions aliases. Tags and languages are seed
tables (`0.schema.sql:11-19`, `:150-161`) auto-created by the writers
(`regularExpressions/create.ts:69-82` inserts tags on demand) — not bundle entities.
Cross-Arr: CF scores carry explicit `arrType` (`'radarr'|'sonarr'|'all'` distinct,
`graph/types.ts:30-31`); entity types are already Arr-specific — no sibling fallback is
introduced by bundling.

## 2. How deserialize writes (answer)

One `writeOperation` (one `pcd_ops` row + one full `compile()`) per writer call; a
deserialized CF = 2 + tests writes, a QP = 3 writes (create, qualities, scoring), each
independently durable. There is no grouping transaction. Bundle import therefore needs the
recorder+snapshot compensating rollback (§1.4) to satisfy acceptance criterion 3.

## 3. Delete / rollback of created rows — safety

- Delete exactly what this request's async context created: `withOpCreationRecorder` ids.
- Restore exactly what it updated: snapshot rows captured before the first write, restored
  by id with `restoreImportSnapshot` (verbatim columns; it never touches `created_at`).
- Un-point `superseded_by_op_id` before deleting (self-FK NO ACTION) — already handled
  inside `restoreImportSnapshot` (`pcdOps.ts:306-319`).
- After restore: `invalidate(databaseId)` + one `compile()` to re-align the registered
  cache (compile may auto-override; the recorder is still active so any user-op mutations
  it makes are also recorded and rolled forward by a second restore — same belt-and-braces
  as `override.ts:197`).

## 4. Collision detection (names)

Case-insensitive on `(databaseId, entity table, name)` — matches existing create-path
checks, e.g. `qualityProfiles/general/update.ts:59-73` compares `lower(name)`;
`CloneModal.svelte:25` does the same client-side. Detection queries read the resolved cache
(`quality_profiles`, `custom_formats`, `regular_expressions`, … tables) via
`cache.kb`, using `lower(name) = ?` — NOT SQL `LIKE` (case-insensitive only for ASCII).

## 5. What `overwrite` means per entity (value-guard implications)

Per collision, the apply step for that entity becomes an **update-in-place** using the
existing update handlers (they emit value-guarded ops with
`desired_state.{from,to}` so concurrent upstream edits fail loudly instead of clobbering):

- `regular_expression`: `regularExpressions/update.ts:41+` (handles dependent CF
  propagation itself when renamed; we never rename during overwrite).
- `custom_format`: `general/update.ts` + `conditions/update.ts` (conditions diff is
  value-guarded via originalConditions).
- `quality_profile`: `general/update.ts` + `qualities/update.ts` +
  `scoring/update.ts` (the same trio deserialize uses, minus the initial create).
- Leaves with dedicated update fns: delay profiles, naming (per-arr), media settings
  (per-arr), quality definitions, lidarr metadata profiles
  (`entities/*/index.ts` all export `update*`).

Delete+create is rejected: delete handlers cascade (`qualityProfiles/delete.ts` drops
scores/qualities rows; CF delete refuses while dependent scores exist,
`customFormats/delete.ts:33-43`), producing worse history and avoidable guard failures.
`overwrite` therefore = "update existing entity to match the bundle payload" and rollback
still works because update ops land in `created.updatedOpIds` via the recorder
(`opCreationRecorder.recordUpdatedOpIds` is fed by `supersedePriorUserOps`/update paths).

## 6. Layer handling

`layer: 'user' | 'base'` exactly as today: base requires `canWriteToBase` (403 otherwise,
`import/+server.ts:108-110`). Bundle import applies ALL entities to the SAME layer —
mixing layers in one bundle is rejected (400). Rationale: per-entity layers break the
single-undo-unit (`actionId`) and the atomic rollback story; nothing in the issue asks for
mixed layers.

## 7. Rename (collision policy `rename`)

Generate `"<name> (2)"`, `"<name> (3)"`, … unique case-insensitively against
target-DB names **plus** other renamed entities in the same bundle (a bundle may contain
`CF "X"` and a QP scoring `CF "X"`; the QP's `customFormatScores` must be rewritten to the
renamed CF name — rename mapping is applied top-down during apply, after dependency-ordered
planning). Suffix style matches the existing `"(Copy)"` precedent
(`CloneModal.svelte:21`) but keeps counting to avoid collisions between the two.

## 8. Bundle format

```jsonc
{
  "version": 1, // BUNDLE_VERSION constant
  "entities": [
    // ordered: regex → CF → QP → leaves
    {
      "entityType": "regular_expression",
      "data": {/* PortableRegularExpression */},
    },
    { "entityType": "custom_format", "data": {/* PortableCustomFormat */} },
    { "entityType": "quality_profile", "data": {/* PortableQualityProfile */} },
  ],
}
```

No timestamps, no ids, no source database identity (portable format parity,
`export/+server.ts:14-20`). Caps: `BUNDLE_MAX_ENTITIES = 200`,
`BUNDLE_MAX_JSON_BYTES = 5 MiB` (server route enforces before parsing; OpenAPI documents
both). Both constants live in `$shared/pcd/bundle.ts` next to `portable.ts`.

## 9. Missing references

Pre-apply resolution pass computes, for each ref (QP→CF, CF→regex):
resolvable-in-bundle ∨ resolvable-in-target-DB (case-insensitive) — else it is listed in
the dry-run report and the real apply returns 400 listing them. The scoring update path
does NOT validate CF names itself (`scoring/update.ts:265-305` inserts guarded by
NOT EXISTS, and `cache.validateSql` FK probe is what would catch it at write time —
`writer.ts:728-752`), so refusing early is both friendlier and required by the spec.
