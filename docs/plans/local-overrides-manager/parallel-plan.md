# YAN-565 / GH #377 — Local Overrides Manager: Parallel Implementation Plan

Companion research and evidence: `feature-spec.md` (same directory). Section references like "§3.3" point there.
All paths are relative to the repo root (`praxrr-yan-565` worktree).

## Decisions needing user input

**None.** The reversible judgement calls J1–J5 are in `feature-spec.md` §0:

- **J1** — new `metadata.action_id` is the undo unit.
- **J2** — revert is a soft drop, with no new snapshot trigger.
- **J3** — revert is fail-closed with 409 plus a reason, with opt-in `cascadeGroup`.
- **J4** — both POST routes default to the `admin` token scope.
- **J5** — no edit-page revert button.

Nothing here is irreversible: no schema migration, no data deletion (ops are only set `dropped`/reactivated), no change to existing API behaviour.

## Design decisions (rationale)

| Decision                                                                                                                                                                          | Rationale                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undo unit = `action_id` (new, stamped by the writer per HTTP mutation via AsyncLocalStorage, else per writer call), falling back to `group_id`, then the single op                | AC3 "exactly the most recent user-op group". Most saves emit several ops without `group_id` (spec §1.3). Existing `group_id` consumers (`align.ts`, Changes page) are untouched. |
| Entity identity = `(entityType, arrType\|null, currentName)` derived by replaying ops in id order with `previousName`/`stable_key` aliasing; inverse of `resolveOpMetadataEntity` | One vocabulary source. Badge and revert always address the current resolved name (spec §2).                                                                                      |
| Modified-set for badges = one indexed read of published user ops + TS parse; **no cache build**                                                                                   | Cheap on list pages (spec §5.2).                                                                                                                                                 |
| Overrides GET = same base-vs-resolved diff as `resolveLayerState`/`computeUserOverrides`, building the base-only cache once per request                                           | One definition of "differs from upstream" (AC2).                                                                                                                                 |
| Revert = `dropOp` per op (shared audit `batchId`) + `compile`, under `withDatabaseOverrideLock`, with snapshot/restore on failure and post-compile verification                   | Data integrity: `align` strategy can auto-drop dependents (`cache.ts:116-131`). Copies the YAN-465 pattern (`override.ts:162-228`).                                              |
| Fail-closed 409 reasons instead of cascading                                                                                                                                      | Spec §3.3.                                                                                                                                                                       |
| Undo also reactivates ops the group's writer-superseded (only if their last history was `applied`)                                                                                | A user delete supersedes all earlier edits (`writer.ts:573-580`); undoing the delete alone would lose them (spec §3.4).                                                          |
| No auto-snapshot on revert                                                                                                                                                        | Snapshot `trigger` is CHECK-constrained (migration `20260712…:30`); a new trigger = table-rebuild migration + enum + OpenAPI + UI. Follow-up.                                    |
| POST routes default to the `admin` token scope                                                                                                                                    | Fail-closed default in `scopePolicy.ts:63-64`; destructive PCD mutation.                                                                                                         |

## Shared contracts (all tasks code against these)

### Wire contract (authored in Task 1; generated into `components['schemas']`)

- `GET  /api/v1/pcd/{databaseId}/overrides?entityType=&arrType=` → `PcdOverridesResponse`
- `POST /api/v1/pcd/{databaseId}/overrides/{entityType}/{name}/revert?arrType=` body `PcdOverrideRevertRequest` → `PcdOverrideRevertResult`
- `POST /api/v1/pcd/{databaseId}/overrides/undo` body `PcdOverrideUndoRequest` → `PcdOverrideUndoResult`
- Errors: existing `ErrorResponse {error}` for 400/401/404-generic/500. 404 and 409 use `PcdOverrideErrorResponse {error: string, reason: string, blockingOpIds?: int[], entities?: PcdOverrideEntityRef[]}`.
- Shapes are defined in feature-spec §7.4. Shared enums:
  - `entityType` = `delayProfile|regularExpression|customFormat|qualityProfile|naming|mediaSettings|qualityDefinitions|lidarrMetadataProfile`
  - `kind` = `modified|created|deleted`
  - 409 `reason` = `group_dependency|dependent_ops|selection_blocked|op_not_revertible|conflict_after_revert|collateral_ops|stale_action`
  - 404 `reason` = `entity_not_found|op_not_found|nothing_to_undo`

### Server library contract (`packages/praxrr-app/src/lib/server/pcd/overrides/`, created by Tasks 3/4)

```ts
// types.ts (Task 3)
export const USER_OP_ACTION_ID_KEY = 'action_id'; // metadata JSON key stamped by the writer (Task 2)
export interface EntityRef {
  entityType: ResolvedEntityType;
  arrType: ArrAppType | null;
  name: string;
}
export type OverrideKind = 'modified' | 'created' | 'deleted';
export interface OverrideOp {
  id: number;
  operation: string;
  title: string;
  summary: string | null;
  changedFields: string[];
  actionId: string | null;
  groupId: string | null;
  status: PcdOpHistoryStatus | null;
  createdAt: string;
}
export interface OverrideEntity extends EntityRef {
  kind: OverrideKind;
  present: boolean;
  existsInBase: boolean;
  overrides: FieldChange[];
  hasPendingConflict: boolean;
  ops: OverrideOp[];
}
export interface LastAction {
  actionId: string;
  key: string;
  opIds: number[];
  entities: EntityRef[];
  createdAt: string;
}
export interface OverridesSnapshot {
  entities: OverrideEntity[];
  lastAction: LastAction | null;
  unmappedOpCount: number;
}
export type LocallyModifiedLookup = (
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
) => boolean;

// identity.ts (Task 3)
export function resolveUserOpEntities(ops: readonly PcdOp[]): {
  entities: Map<string, EntityGroup>;
  unmapped: PcdOp[];
};
export function actionKeyOf(op: PcdOp): string; // action:<id> | group:<id> | op:<id>

// modified.ts (Task 3)
export function buildLocallyModifiedLookup(
  databaseId: number
): LocallyModifiedLookup;
export function listLocallyModifiedEntities(databaseId: number): EntityRef[];

// read.ts (Task 3)
export function listOverrides(
  databaseId: number,
  filter?: { entityType?: ResolvedEntityType; arrType?: ArrAppType }
): Promise<OverridesSnapshot>;

// revert.ts (Task 4)
export class OverrideRevertError extends Error {
  status: 404 | 409;
  reason: string;
  blockingOpIds?: number[];
  entities?: EntityRef[];
}
export function revertEntityOverrides(input: {
  databaseId: number;
  entityType: ResolvedEntityType;
  arrType?: ArrAppType;
  name: string;
  opIds?: number[];
  cascadeGroup?: boolean;
}): Promise<RevertResult>;
export function undoLastAction(input: {
  databaseId: number;
  expectedActionId?: string;
}): Promise<UndoResult>;
```

All of this is re-exported through `$pcd/index.ts` (the lib tasks add the exports).

### Cross-cutting rules for every subagent

- Work only in `/home/yandy/Projects/github.com/yandy-r/praxrr-yan-565` using ABSOLUTE paths; set bash `cwd` to the worktree. Run `git -C /home/yandy/Projects/github.com/yandy-r/praxrr status` afterwards for leaks into the main checkout, and only revert your own.
- Before any Read/Grep/Glob exploration, run `graphify query "<question>"` from `/home/yandy/Projects/github.com/yandy-r/praxrr` (the graph lives there).
- Svelte 5 WITHOUT runes (`export let`, `$:`, `on:click`); tabs, single quotes, 100 cols; Kysely/app DB conventions; alerts via `alertStore`.
- Do **not** run builds, lints, formatters or tests unless the task's acceptance explicitly says so. The main agent verifies once at the end.
- Arr-touching changes: no sibling fallback, no inferred `arrType` (CLAUDE.md Cross-Arr policy).

## Dependency graph

```
Wave 1 (parallel):  T1 OpenAPI+types   T2 writer action_id   T3 lib identity/read   T5 UI foundation
Wave 2 (parallel):  T4 revert/undo lib (needs T3)   T6a/T6b/T6c list pages (need T3,T5)   T8 overrides page (needs T1,T3,T5)
Wave 3:             T7 routes + route tests (needs T1,T3,T4)
Wave 4:             T9 docs (needs T7,T8 for final names)
```

Disjoint file ownership across tasks in the same wave is guaranteed by the lists below. Files owned by more than one task are sequenced by wave: `pcd/index.ts` (T3 then T4) and `scripts/test.ts` (T7 only).

---

## Task 1 — OpenAPI contract + generated types (wave 1)

**Owns (create):** `docs/api/v1/paths/pcd-overrides.yaml`, `docs/api/v1/schemas/pcd-overrides.yaml`
**Owns (modify):** `docs/api/v1/openapi.yaml`
**Owns (generated, commit them):** `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`
**Depends on:** nothing.

Steps:

1. `schemas/pcd-overrides.yaml`, following the conventions of `schemas/pcd-snapshots.yaml` and `schemas/resolved-config.yaml`:
   - Define `PcdOverrideEntityRef`, `PcdOverrideOp`, `PcdOverrideEntity`, `PcdOverrideLastAction`, `PcdOverridesResponse`, `PcdOverrideRevertRequest`, `PcdOverrideRevertResult`, `PcdOverrideUndoRequest`, `PcdOverrideUndoResult`, `PcdOverrideErrorResponse`.
   - Reuse `./sync.yaml#/FieldChange` for `overrides` items. Reuse the same 8-value `entityType` enum literally as in `schemas/resolved-config.yaml:106-117`.
   - `arrType`: nullable enum `radarr|sonarr|lidarr`.
   - Request bodies: `opIds` is `integer[]` with `maxItems: 1000` and `minItems: 1`; `cascadeGroup` is a boolean defaulting to `false`.
2. `paths/pcd-overrides.yaml`: three keys (`list`, `revert`, `undo`).
   - operationIds: `listPcdOverrides`, `revertPcdOverride`, `undoPcdOverride`. Tag: `Local Overrides`.
   - Parameter docs must state the runtime `arrType` rule: required for `naming|mediaSettings|qualityDefinitions` and for `lidarrMetadataProfile` (must be `lidarr`); rejected for the four arr-agnostic types.
   - Responses: 200/400/401/404/409/500. Describe each 409 `reason`.
   - Document the token scope note: GET needs `read`; POSTs need `admin`.
3. `openapi.yaml`:
   - Add the tag `Local Overrides` (after `Resolved Config`, around lines 30-32).
   - Add the three path items after the snapshots block (around lines 396-403): `/pcd/{databaseId}/overrides`, `/pcd/{databaseId}/overrides/undo`, `/pcd/{databaseId}/overrides/{entityType}/{name}/revert`.
   - Add the `components.schemas` `$ref`s (pattern at lines 1826-1840).
4. Generate: `deno task generate:api-types` then `deno task bundle:api` (both required; bundle copies the types and writes `openapi.json`). Commit all three generated files.

**Acceptance:** `components['schemas']['PcdOverridesResponse']`, `PcdOverrideRevertResult`, `PcdOverrideUndoResult` and `PcdOverrideErrorResponse` exist in `v1.d.ts`. `packages/praxrr-api/openapi.json` contains the three new paths. The YAML parses with the `scripts/bundle-api.ts` pipeline. No pre-existing path or schema changed.

---

## Task 2 — Writer stamps `action_id`; request-scoped action context (wave 1)

**Owns (create):** `packages/praxrr-app/src/lib/server/pcd/ops/actionContext.ts`, `packages/praxrr-app/src/tests/pcd/ops/writerActionId.test.ts`
**Owns (modify):** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`, `packages/praxrr-app/src/lib/server/pcd/core/types.ts`, `packages/praxrr-app/src/hooks.server.ts`
**Depends on:** nothing.

Steps:

1. `actionContext.ts`: an `AsyncLocalStorage<{ actionId: string }>` with `withUserOpAction<T>(fn: () => Promise<T>, actionId = uuid()): Promise<T>` (re-entrant: an existing outer id wins) and `currentUserOpActionId(): string | undefined`. Use `uuid` from `$shared/utils/uuid.ts`.
2. `core/types.ts`: add optional `actionId?: string` to `OperationMetadata` (after `groupId`, line ~53), with a doc comment "user-layer undo unit".
3. `writer.ts`:
   - In `buildMetadataJson` (`:104-136`) emit `payload.action_id = metadata.actionId` when set.
   - In `writeOperationsFromSqlOperations` (`:631`), when `layer === 'user'` compute `const actionId = currentUserOpActionId() ?? uuid()` ONCE before the operations loop.
   - Pass it into each op's metadata (`{ ...operation.metadata, actionId: operation.metadata.actionId ?? actionId }`) before serializing. Thread it through `serializeMigrationSqlOperation` (`:169-179`) and ensure the value-guard gate path (`:189`) sees the same metadata.
   - The metadata hash input changes only for NEW rows.
   - Base-layer writes must not gain `action_id`.
   - Do not alter `supersedePriorUserOps`/`cancelOutCreate` logic, and do not touch `group_id`.
4. `hooks.server.ts`: add a third `Handle` `userActionHandle` after `authHandle`:

   ```ts
   const userActionHandle: Handle = ({ event, resolve }) =>
     ['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
       ? resolve(event)
       : withUserOpAction(() => resolve(event));
   export const handle = sequence(csrfGuard, authHandle, userActionHandle);
   ```

   Import `withUserOpAction` from `$pcd/ops/actionContext.ts`. One mutating request = one user action.

5. Tests (`writerActionId.test.ts`, pure and self-contained so it does not depend on Task 3's helper):
   - Export `__testOnly_buildMetadataJson` from `writer.ts` (mirrors the existing `__testOnly_*` exports at `writer.ts:275-284`). Assert: `action_id` appears when the metadata carries `actionId`; it is absent when unset.
   - Assert `withUserOpAction` scoping: two calls to `currentUserOpActionId()` inside one scope return the same id; outside any scope it is `undefined`; a nested scope keeps the outer id.
   - Full write-path coverage (one `writeOperationsFromSql` call stamps one shared id on all its ops; two calls under one `withUserOpAction` share the id; base layer gets none) is exercised by Task 3's/4's real-DB tests and Task 7's route tests via `overridesTestHelpers.ts`.

**Acceptance:** user-layer ops carry `metadata.action_id`; one `withUserOpAction` scope yields one id across multiple writer calls; without a scope each writer call has its own id; base ops have none; `group_id` handling unchanged; build files still import cleanly.

---

## Task 3 — Overrides lib: identity, modified lookup, read/delta (wave 1)

**Owns (create):**

- `packages/praxrr-app/src/lib/server/pcd/overrides/{types.ts,identity.ts,modified.ts,read.ts,index.ts}`
- `packages/praxrr-app/src/tests/pcd/overrides/overridesTestHelpers.ts`
- `packages/praxrr-app/src/tests/pcd/overrides/overridesRead.test.ts`

**Owns (modify):** `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`, `packages/praxrr-app/src/lib/server/pcd/index.ts`
**Depends on:** nothing (the `action_id` key is a string literal contract).

Steps:

1. `layerDiff.ts`: export `resolveOpMetadataEntity` (currently private, `:156`). Add `export const RESOLVED_ENTITY_TYPES_FOR_OPS` or an `inverseOpMetadataEntity(entity: string): { entityType: ResolvedEntityType; arrType: ArrAppType | null } | null` built by iterating all entity types × `[undefined,'radarr','sonarr','lidarr']` through `resolveOpMetadataEntity`. Do not change existing behaviour. Keep `parseOpMetadata` private and add a separate richer parser in `identity.ts`.
2. `types.ts`: exactly the contract above.
3. `identity.ts`:
   - `resolveUserOpEntities(ops)` implementing spec §2.2: sort by `id`; parse metadata (`operation`, `entity`, `name`, `previousName`, `stable_key`, `changed_fields`, `group_id`, `action_id`, `depends_on`, `title`, `summary`).
   - Unknown or unparseable entities go to `unmapped`.
   - Alias map keyed `entityMeta|name`; the target name `T = stable_key.value ?? name`; create/rename/delete handling; final merge by `(entityType, arrType, currentName)`.
   - Returned `EntityGroup` = `{ ref: EntityRef, ops: PcdOp[], hasCreate: boolean, hasDelete: boolean, hasRename: boolean }`.
   - `actionKeyOf(op)`: `action:<id>` | `group:<id>` | `op:<id>`.
4. `modified.ts`:
   - `buildLocallyModifiedLookup(databaseId)` does one `pcdOpsQueries.listByDatabaseAndOrigin(databaseId,'user',{states:['published']})`, runs `resolveUserOpEntities`, and returns a closure over a `Set<"entityType|arrType|name">`. The lookup receives `arrType: undefined` for arr-agnostic types.
   - `listLocallyModifiedEntities` returns the refs.
   - A published user op counts regardless of net delta (AC1). Do not build any cache here.
5. `read.ts` `listOverrides`:
   - Load published user ops, resolve entities, apply the optional filter.
   - For the selected entities, build the base-only cache once via `withBaseOnlyCache`, and read the resolved cache via `getCache(databaseId)`.
   - Fail with a plain `Error('Database N cache is not built')` like `layerDiff.ts:369-371`.
   - For each entity: `readEntityOrNull` on both caches, `computeUserOverrides`, `kind` (created/deleted/modified), `present`, `existsInBase`, `hasPendingConflict` (use `buildPendingConflictIndex`), and `ops[]` (status = latest `pcd_op_history.status` via `pcdOpHistoryQueries.listLatestByDatabaseWithOps(databaseId)` map).
   - Compute `lastAction` from the latest published user op overall, INCLUDING unmapped ops (key via `actionKeyOf`; entities = distinct refs of mapped ops in that action; `createdAt` = max `created_at`).
   - `unmappedOpCount`.
   - Sort entities by `entityType`, `arrType`, `name` (case-insensitive).
6. `index.ts` re-exports; add the exports (functions and types) to `pcd/index.ts` in a new `// OVERRIDES` section.
7. Test helper `overridesTestHelpers.ts` (reused by Tasks 4 and 7):
   - Wrap `migratedTest` (`tests/pcd/snapshots/rollbackTestHelpers.ts`).
   - `setUpPcd(opts)` creates a temp dir, copies the real schema files from `packages/praxrr-schema/ops/{0.schema,1.languages,2.qualities}.sql` into `<dir>/deps/schema/ops` (pattern: `tests/pcd/resolved/lineage/lineageEngine.test.ts:19,64-70`; count `../` correctly from `tests/pcd/overrides/`), plus an empty `tweaks/`.
   - Creates the database row with `createTestDatabase(dir)`, seeds BASE ops with `pcdOpsQueries.create({origin:'base',state:'published',source:'repo',sequence,sql,metadata})` (e.g. insert `delay_profiles`, `regular_expressions`, a `custom_formats` row, a `quality_profiles` row).
   - Calls `compile(dir, id)`.
   - Silences `logger` (patch pattern from the lineage test) and exposes `writeUserEdit(fn)`, which runs the entity module (e.g. `regularExpressions` `update`, `delayProfiles` `update`) with `getCache(id)` and `layer:'user'` inside `withUserOpAction` when Task 2 is merged (guard with a dynamic import; otherwise rely on per-call ids).
   - `cleanup()` invalidates the cache.
8. Test `overridesRead.test.ts` (critical only):
   - Edit a regex (pattern change) and rename a delay profile. `listOverrides` returns both with correct `kind:'modified'`, non-empty deltas, and rename addressed by the NEW name.
   - A user-created CF gives `kind:'created'`.
   - A user-deleted base regex gives `kind:'deleted'`, `present:false`.
   - Modified lookup: `buildLocallyModifiedLookup` is true exactly for those entities. An untouched entity is false. Arr-scoped: a radarr naming op does not mark the sonarr naming of the same name.
   - Unknown-entity op is counted in `unmappedOpCount`, not listed.

**Acceptance:** `deno task test overrides` passes for these tests (main agent runs). `resolveOpMetadataEntity` behaviour is unchanged (the existing `layerDiff.test.ts` still passes). Rename/delete/create attribution matches spec §2.

---

## Task 4 — Revert + undo service (wave 2; needs Task 3)

**Owns (create):** `packages/praxrr-app/src/lib/server/pcd/overrides/revert.ts`, `packages/praxrr-app/src/tests/pcd/overrides/overridesRevert.test.ts`
**Owns (modify):** `packages/praxrr-app/src/lib/server/pcd/overrides/index.ts`, `packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts`, `packages/praxrr-app/src/lib/server/pcd/conflicts/overrideUtils.ts`, `packages/praxrr-app/src/lib/server/pcd/index.ts`
**Depends on:** Task 3 (identity + helpers). Uses `action_id` from Task 2 only through metadata (tests insert/produce it).

Steps:

1. `override.ts`: `export` `withDatabaseOverrideLock` (`:115`). No logic change. `overrideUtils.ts`: add an optional `batchId?: string` parameter to `dropOp` (`:58`); default stays `uuid()`.
2. `revert.ts` — shared core `performRevert(databaseId, plan)` under `withDatabaseOverrideLock`:
   - **Plan building (pure, unit-testable)** — `revertEntityOverrides`:
     1. Load published user ops, `resolveUserOpEntities`, find the entity (404 `entity_not_found`).
     2. `selected` = `opIds` (each must belong to the entity else 404 `op_not_found`; non-published → 409 `op_not_revertible`) or ALL entity ops.
     3. Closed-set rule for partial selections (spec §3.3).
     4. Group rule: compute the set of ops sharing an explicit `group_id` or `action_id`-less `group_id` with any selected op. If it contains other-entity or unselected ops: default → 409 `group_dependency` with `entities`; with `cascadeGroup` include them in the drop set (list `cascadedEntities`). `action_id` alone never blocks (a UI save may touch several entities; the user chose this entity).
     5. Dependents rule: if the drop set contains a create or a rename, scan REMAINING published user ops' `depends_on` plus `stable_key.value`; if one references the dropped name, → 409 `dependent_ops` with `blockingOpIds`.
   - **Atomic attempt** (mirror `override.ts:162-228`): snapshot `pcdOpsQueries.listByDatabase`; inside `withAutoOverrideSuppressed` + `withOpCreationRecorder`: `dropOp(databaseId, id, batchId)` for each id; `compile(instance.local_path, databaseId)`. Then verify: (a) the set of published user op ids equals `before − dropped`; (b) no op in `before − dropped` has a latest history status `conflicted`/`conflicted_pending` that it did not have before. Failure → `restoreImportSnapshot` + suppressed recompile (copy the ~40-line `restoreAfterFailure`; do NOT refactor `override.ts` beyond exporting the lock) and throw `OverrideRevertError(409, 'collateral_ops'|'conflict_after_revert')`.
   - A disabled instance or an unbuilt cache → throw `Error` mapped to 400 by the route.
   - After success, if the full entity was reverted (no remaining ops for it), compute `resolvedMatchesBase` with `resolveLayerState({layer:'user'})` (null if an entity absent from both layers; true when `overrides.length===0` and presence equals base presence).
   - Return `{ revertedOpIds, cascadedEntities, remainingOpIds, resolvedMatchesBase }`.
3. `undoLastAction({databaseId, expectedActionId?})`:
   - Under the lock: published user ops; `lastOp` = max id (404 `nothing_to_undo` if none); `key = actionKeyOf(lastOp)`.
   - If `expectedActionId` is given and does not equal the key's id → 409 `stale_action`.
   - Drop set = all published user ops with the same key.
   - Reactivation set = ops with `state='superseded'` AND `superseded_by_op_id ∈ dropSet` AND latest history status `applied` (query `pcdOpHistoryQueries.listByOp`).
   - Reactivation: `pcdOpsQueries.update(id,{state:'published', supersededByOpId:null})` plus a history row `applied` with `conflictReason:'override_undo'`, like `restore.ts:101-113`.
   - The same atomic attempt and verification as revert, with the reactivated ids added to the expected set.
   - Return `{ undoneActionId, revertedOpIds, reactivatedOpIds, entities }`.
4. Update `overrides/index.ts` and `pcd/index.ts` exports (types + `OverrideRevertError`, `revertEntityOverrides`, `undoLastAction`, `isOverrideRevertError`).
5. Tests `overridesRevert.test.ts` (real DB + real compile via the Task 3 helper):
   - **AC2**: two edits on a regex (pattern + description) → `revertEntityOverrides` all → `listOverrides` no longer lists it; `readResolvedEntity` equals the base-only reading; `resolvedMatchesBase === true`.
   - Selected `opIds` of disjoint fields: only those are dropped; the rest remain. Overlapping/rename selection → 409 `selection_blocked`.
   - A user-created entity reverts to non-existent; a user delete reverts back to the base entity.
   - CF delete with a generated QP scoring op (`groupId`): default → 409 `group_dependency`; `cascadeGroup:true` reverts both.
   - Re-reverting an already-dropped op → 409 `op_not_revertible`; unknown entity → 404; a foreign op id → 404 `op_not_found`.
   - **AC3**: edit entity A, then save entity B (multi-op QP general save inside ONE `withUserOpAction`), then `undoLastAction` → exactly B's ops dropped, A's still published; `expectedActionId` mismatch → 409 `stale_action`; with nothing to undo → 404.
   - Undo of a user delete reactivates the writer-superseded earlier edit.

**Acceptance:** all above pass (main agent runs `deno task test overrides`). `override.ts` diff is only the `export`. No other behaviour in conflict resolution changes (existing `overrideConflictRestore.test.ts` still passes). A forced verification failure leaves `pcd_ops` byte-identical to before (assert row states).

---

## Task 5 — UI foundation: shared flag type, badge, filter control (wave 1)

**Owns (create):**

- `packages/praxrr-app/src/lib/client/ui/badge/LocallyModifiedBadge.svelte`
- `packages/praxrr-app/src/lib/client/ui/badge/locallyModified.ts`
- `packages/praxrr-app/src/lib/client/ui/actions/LocalOnlyFilterAction.svelte`
- `packages/praxrr-app/src/lib/client/utils/locallyModified.ts`

**Owns (modify):** `packages/praxrr-app/src/lib/shared/pcd/display/{common,customFormats,qualityProfiles,regex,delayProfiles,naming,mediaSettings,qualityDefinitions,metadataProfiles}.ts`
**Depends on:** nothing.

Steps:

1. `display/common.ts`: `export interface LocallyModifiable { locallyModified?: boolean }`.
   - Intersect it into `CustomFormatTableRow`, `QualityProfileTableRow`, `RegularExpressionWithTags`, `NamingListItem`, `MediaSettingsListItem`, `QualityDefinitionListItem`, `LidarrMetadataProfileListItem`.
   - Add `export type DelayProfileListItem = DelayProfilesRow & LocallyModifiable` in `delayProfiles.ts`.
   - Types only; no runtime change.
2. `LocallyModifiedBadge.svelte`: wraps `Badge` (`variant="warning"`, `size="sm"`, icon `PencilLine` or `Pencil`, text "Locally modified") with a `title` "Differs from the upstream (base) layer; see the Local overrides tab".
3. `badge/locallyModified.ts`: `export const LOCALLY_MODIFIED_LABEL`; `export function locallyModifiedBadgeHtml(): string` returning the static escaped HTML pill for `Table` `{html}` cells (same classes as `Badge` warning + sm; no user input interpolated).
4. `LocalOnlyFilterAction.svelte`: wraps `ActionButton` (`icon` Pencil, `label` "Show only locally modified", `variant="neutral"`, `square`), props `active: boolean` and `count: number`; dispatches `toggle`; shows the count dot (pattern: `regular-expressions/.../SearchFilterAction.svelte:46-53`) and `aria-pressed`.
5. `client/utils/locallyModified.ts`: `filterLocallyModified<T extends LocallyModifiable>(rows: T[], onlyLocal: boolean): T[]`, `countLocallyModified(rows)`, and `loadLocalOnly(key)/saveLocalOnly(key,value)` using localStorage (guarded by `browser`).

**Acceptance:** the files exist and type-check against the generated types. Existing pages are unchanged (no one consumes the new types yet). The badge is visually consistent with existing `Badge` usage.

---

## Task 6a — CF + QP list views: badge + filter (wave 2; needs Tasks 3, 5)

**Owns (modify):**

- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/{+page.server.ts,+page.svelte,views/TableView.svelte,views/CardView.svelte}`
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/{+page.server.ts,+page.svelte,views/TableView.svelte,views/CardView.svelte}`

Steps:

- In each `+page.server.ts`, inside the per-database `map` (CF `:49-62`, QP `:49-62`), after `list(cache)` build `const lookup = buildLocallyModifiedLookup(database.id)` once per database and set `locallyModified: lookup('customFormat'|'qualityProfile', undefined, row.name)` on PCD rows. TRaSH rows stay unflagged.
- Add `LocalOnlyFilterAction` to the `ActionsBar` (CF `:218-239`, QP `:170-…`). State `onlyLocal` persisted per database (`customFormatsLocalOnly:<dbId>` / `qualityProfilesLocalOnly:<dbId>`). Apply `filterLocallyModified` after source filtering (CF `filtered` at `:156`; QP `filteredProfiles` at `:127`). Update the empty-state messages for "no locally modified items".
- Table view: add the badge next to the name cell via `locallyModifiedBadgeHtml()` when `row.locallyModified` (CF `TableView.svelte:109-…`, QP `:101-…`). Card view: `LocallyModifiedBadge`, shown only for rows editable in the current database (`isEditableRow` rule).

**Acceptance:** AC1 — a row shows the badge iff `buildLocallyModifiedLookup` is true for it. The filter shows only flagged rows. Unflagged pages are visually unchanged.

## Task 6b — Regex + delay-profile + (optional) Lidarr metadata-profile list views (wave 2; needs Tasks 3, 5)

**Owns (modify):**

- `packages/praxrr-app/src/routes/regular-expressions/[databaseId]/{+page.server.ts,+page.svelte,views/TableView.svelte,views/CardView.svelte}`
- `packages/praxrr-app/src/routes/delay-profiles/[databaseId]/{+page.server.ts,+page.svelte,views/TableView.svelte,views/CardView.svelte}`
- `packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/{+page.server.ts,+page.svelte}`

Steps: same pattern. Loaders set the flag from `buildLocallyModifiedLookup(currentDatabaseId)`:

- `'regularExpression'`, `'delayProfile'`, and `'lidarrMetadataProfile'` with `arrType 'lidarr'` — note the lookup's `arrType` is `'lidarr'` there, per the runtime rule in spec §8.
- Filters: regex page `$: filtered` at `:106`; delay `$filtered` (`:103-112`); metadata page `$filtered`. Delay `TableView` takes `profiles: DelayProfilesRow[]`; change to `DelayProfileListItem`.
- Metadata-profile list is optional per the issue (the issue lists five views); include it since it is cheap and uses the same data.

**Acceptance:** as 6a for each page.

## Task 6c — Media-management list views: naming / media settings / quality definitions (wave 2; needs Tasks 3, 5)

**Owns (modify):** `packages/praxrr-app/src/routes/media-management/[databaseId]/{naming,media-settings,quality-definitions}/{+page.server.ts,+page.svelte,views/TableView.svelte,views/CardView.svelte}`

Steps:

- Loaders flag rows with `lookup('naming'|'mediaSettings'|'qualityDefinitions', row.arr_type, row.name)`. **Pass `row.arr_type` explicitly. No sibling fallback.**
- Naming and quality-definitions loaders also merge other databases and TRaSH rows (`naming/+page.server.ts:~50-110`); compute the lookup per database inside the existing `databases.map`.
- Filter in each `+page.svelte` (naming `:164` `sourceFiltered`; quality definitions `:162`; media settings uses `$filtered` at `:137-152`).
- Badges in Table/Card views.

**Acceptance:** AC1 for per-arr entities. A radarr `Default` naming is flagged independently of a sonarr `Default`.

---

## Task 7 — API routes + route tests + scope test + test alias (wave 3; needs Tasks 1, 3, 4)

**Owns (create):**

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/overrides/shared.ts`
- `.../overrides/+server.ts`
- `.../overrides/undo/+server.ts`
- `.../overrides/[entityType]/[name]/revert/+server.ts`
- `packages/praxrr-app/src/tests/routes/pcdOverridesApi.test.ts`

**Owns (modify):** `scripts/test.ts` (add alias), `packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts` (scope-table rows)
**Depends on:** Task 1 (types), Task 3, Task 4.

Steps:

1. `shared.ts`:
   - `parseDatabaseId` (digits-only) and `resolveEntityTarget(params, url)` doing `isKnownResolvedEntityType` (import from `../resolved/shared.ts`), `arrType` via `isArrAppType`, and the same arrType rules as `readers.ts` (agnostic rejects; per-arr requires; `lidarrMetadataProfile` requires `lidarr`).
   - Body reader with an 8 KB cap and JSON validation (copy `snapshots/.../rollback/+server.ts:56-76`).
   - `mapOverridesErrorToResponse` handling `OverrideRevertError` (404/409 with `reason`, `blockingOpIds`, `entities`) and delegating to `mapResolvedErrorToResponse` for the rest.
   - Wire narrowers for `FieldChange` (reuse `toWireOverrides`).
2. Handlers (copy the resolved-route guard order: 401 auth gate `!locals.user && !locals.authBypass`, `databaseId`, cache built else 400 "Database not found", params, body, try/catch). `GET` calls `listOverrides`, wrapped in `sanitizeBigInts`. `POST revert` validates `opIds` (positive ints, ≤1000, deduped) and `cascadeGroup` (boolean). `POST undo` validates `expectedActionId` (string ≤ 64 chars).
3. `tests/routes/pcdOverridesApi.test.ts` (real DB + real compile via `tests/pcd/overrides/overridesTestHelpers.ts`; hand-built events as in `resolvedConfigApi.test.ts:53-72,76-90`): critical cases only:
   - GET: lists grouped entities with deltas, `lastAction`; `entityType`/`arrType` validation 400s; unauthenticated 401.
   - Revert all → 200, then GET shows the entity gone and `GET /resolved/{type}/{name}?layer=user` returns empty `overrides` (AC2).
   - Revert selected `opIds`: partial.
   - 404 unknown entity and unknown op; 409 `group_dependency`; 409 `op_not_revertible` on a second revert.
   - Undo reverts exactly the latest group (AC3); `expectedActionId` mismatch 409; empty → 404.
   - A modified-set smoke test for the list loaders' lookup is covered in Task 3.
4. `apiTokens.test.ts:256-269`: add rows `['POST','/api/v1/pcd/1/overrides/undo','admin']`, `['POST','/api/v1/pcd/1/overrides/customFormat/Foo/revert','admin']`, `['GET','/api/v1/pcd/1/overrides','read']`. No change to `scopePolicy.ts` (default fail-closed `admin`).
5. `scripts/test.ts`: add alias `overrides: 'packages/praxrr-app/src/tests/pcd/overrides,packages/praxrr-app/src/tests/pcd/ops/writerActionId.test.ts,packages/praxrr-app/src/tests/routes/pcdOverridesApi.test.ts'` (alphabetical placement near `notifications`).

**Acceptance:** responses `satisfies` the generated `components['schemas']` types (type-checks). The tests above pass. All new route files type-check with `deno task check:server`.

---

## Task 8 — Local overrides page + database tab (wave 2; needs Tasks 1, 3, 5; endpoints from Task 7 at runtime)

**Owns (create):**

- `packages/praxrr-app/src/routes/databases/[id]/overrides/+page.server.ts`
- `.../overrides/+page.svelte`

**Owns (modify):** `packages/praxrr-app/src/routes/databases/[id]/+layout.svelte`
**Depends on:** Task 1 (types), Task 3 (`listOverrides`), Task 5 (badges). It calls the Task 7 endpoints only at runtime, so it may be built in parallel against the contract.

Steps:

1. `+layout.svelte`: add a tab "Local overrides" (`href /databases/${id}/overrides`, icon `PencilLine`/`Layers`, `active: currentPath.includes('/overrides')`) between Conflicts and Tweaks (existing tab list `:9-60`).
2. `+page.server.ts`: `load` uses `parent()` for `database` (as `conflicts/+page.server.ts:40-64`) and calls `listOverrides(database.id)` directly. If the cache is not built, return `{ unavailable: true }` instead of throwing. Return `entities`, `lastAction`, `unmappedOpCount`, `databaseId`.
3. `+page.svelte` (no runes):
   - `ActionsBar` with `SearchAction` (persistent store key `databaseOverridesSearch:<id>`, as `conflicts/+page.svelte:33-35`) and an "Undo last change" `Button` (disabled without `lastAction`; label shows entity names). Undo opens a `Modal` (confirm; `confirmDanger`; `bodyMessage` lists the entities and says it can't be redone except by editing again), then `fetch POST .../overrides/undo` with `expectedActionId`, `alertStore.add`, `invalidateAll()`.
   - `ExpandableTable` of entities: columns Entity type (+ arr badge), Name (+ `kind` badge created/deleted/modified), Op count, Last change, a conflict badge if `hasPendingConflict`. The expanded row shows the field delta table (reuse `FIELD_META`/`formatFieldValue` from `$ui/resolved/fieldChangeDisplay.ts`, markup modelled on `ResolvedStatePanel.svelte:218-262`) and the op list with per-op checkboxes and status.
   - Row actions: "Revert selected" (enabled with a selection) and "Revert all" → confirm `Modal` → `fetch POST /api/v1/pcd/{id}/overrides/{entityType}/{encodeURIComponent(name)}/revert?arrType=` with `{opIds?}`.
   - On 409 `group_dependency`, show the listed entities and offer "Revert group together" (re-issues with `cascadeGroup:true` after a second confirm). Other 409 reasons show the server `error` via `alertStore`.
   - Empty state: "No local overrides — this database matches upstream."
   - Link each entity name to its edit page if cheaply derivable. Skip the link when not (KISS), but the lists/badges in Tasks 6a-c already link.
4. Show `unmappedOpCount > 0` as an info note ("N local operations aren't tied to a manageable entity; they are included in Undo").

**Acceptance:** the page renders the list, expand shows deltas, revert-all and selective revert and undo work end-to-end against Task 7 endpoints, with alerts. Routes-over-modals respected (modals only for confirmation).

---

## Task 9 — Docs (wave 4; needs final names from Tasks 7, 8)

**Owns (create):** `docs/features/local-overrides.md`
**Owns (modify):** `docs/features/README.md` (guide list + reading order), `docs/api/endpoints.md` (table rows after `:43` plus short sections)

Content:

- What counts as a local override.
- The "Locally modified" badge and filter on the five list views.
- The Local overrides tab: review, selective revert, revert all, Undo (what "last change" means, legacy-ops caveat).
- API reference (three endpoints, error reasons, token scopes).
- Limitations: net-zero edits keep the badge; `cancelOutCreate` pairs; no auto-snapshot; promote-to-base is a follow-up.

**Acceptance:** links resolve; endpoint table matches `docs/api/v1/openapi.yaml`.

---

## Main-agent verification (run once after all tasks land)

1. `deno task generate:api-types && deno task bundle:api`; confirm `git status` shows only the three generated files plus intended edits.
2. `deno task check` and `deno task lint` (the latter includes Prettier — run `deno task format` first).
3. `deno task test overrides`, then regressions: `deno task test resolvedConfig`, `deno task test packages/praxrr-app/src/tests/pcd/ops/writer.test.ts`, `deno task test packages/praxrr-app/src/tests/pcd/conflicts`, `deno task test packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts`, `deno task test packages/praxrr-app/src/tests/pcd/snapshots`. (Known unrelated local failures: `arrExternalUrlLayoutPropagation`, 2× `lidarrOnboarding`, because `ARR_CREDENTIAL_MASTER_KEY` is unset.)
4. Smoke the ALS path: run the dev app (`PRAXRR_DEFAULT_DB_URL=<repo>/packages/praxrr-db`), save a QP (several ops) → Local overrides tab shows one action → Undo drops all of its ops. If propagation through SvelteKit `resolve` fails, undo of a multi-op save would revert only the last op; fix by moving the wrapper into the form-action/endpoint entry points.
5. Manual: badge + filter on CF, QP, regex, delay, naming/media settings/quality definitions; revert → badge disappears and the resolved config page `layer=user` shows no overrides.
6. `graphify update .` (AST-only).
7. After the subagent batches: `git -C /home/yandy/Projects/github.com/yandy-r/praxrr status` for leaked edits.

## Traceability to acceptance criteria

| AC                                 | Covered by                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| 1. Badge + filter                  | T3 (`modified.ts`, tested), T5, T6a/b/c                                          |
| 2. Revert → resolved == base       | T4 (`resolvedMatchesBase`, tests), T7 (route test vs `GET /resolved?layer=user`) |
| 3. Undo = exactly the latest group | T2 (`action_id`), T4 (`undoLastAction`, tests), T7                               |
| 4. Contract first, route tests     | T1 (first), T7 (route tests); T1 → generated types → T3/T4 → T7 → T8             |
