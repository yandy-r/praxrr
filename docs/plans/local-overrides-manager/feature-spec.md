# YAN-565 / GH #377 — Local Overrides Manager: Research & Feature Spec

All paths are relative to the repo root (worktree `praxrr-yan-565`). `file:line` citations were read in this worktree.
Claims I did not observe in code are tagged `[INFERENCE]`.

## 0. Decisions needing user input

**None blocking.** Every choice below is additive and reversible. The judgement calls most worth a reviewer's glance:

| #   | Judgement call                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                     | Alternative rejected                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Stamp a **new** `metadata.action_id` on every user-layer op (one id per HTTP mutation request, else per writer call). This is the undo unit.                                                       | Today most saves write several ops with no shared id (§1.3). Reusing `group_id` would change `alignConflict` and Changes-page semantics.                                                                                                                                                                                | Reuse `group_id` (breaks `align.ts:43-51`); time-window heuristics (non-deterministic).                                                                                                         |
| J2  | Revert/undo is **soft**: ops go to `state='dropped'` (rows kept) and nothing resurrects them. No automatic snapshot is taken.                                                                      | The snapshot `trigger` column is `CHECK`-constrained (`db/migrations/20260712_extend_pcd_snapshot_trigger_rollback.ts:30`), so a new `override_revert` trigger needs a table-rebuild migration plus enum, OpenAPI and UI badge changes. Pre-pull and pre-sync auto-snapshots already exist (§3.6). Follow-up candidate. | Re-using `trigger='rollback'` mislabels rows (the snapshots UI shows it as a rollback, `routes/databases/[id]/snapshots/+page.svelte:57`). Manual snapshots are never pruned and would clutter. |
| J3  | Revert is **fail-closed**: 409 with a machine-readable `reason` rather than cascading. The only opt-in cascade is `cascadeGroup: true`, which mirrors the precedent in `conflicts/align.ts:43-51`. | Data integrity (§3.3).                                                                                                                                                                                                                                                                                                  | Silent cascade.                                                                                                                                                                                 |
| J4  | Token scope for both POSTs stays at the **fail-closed default `admin`** (`utils/auth/scopePolicy.ts:63-64`). Session and bypass principals are unaffected.                                         | Destructive PCD mutation. Snapshot rollback is deliberately `sync:apply` (`scopePolicy.ts:38`), but this feature has no Arr-apply semantics.                                                                                                                                                                            | Add the routes to `SYNC_APPLY_ROUTES`. Easy to change later.                                                                                                                                    |
| J5  | Edit-page "Revert to upstream" is **out of scope** (there are ~30 edit pages across six route families). The Local overrides tab plus list badges cover it.                                        | Cost vs value.                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                               |

## 1. How user ops are written (Q1)

### 1.1 Code paths that create `origin='user'` ops

- There is exactly one insert point for user ops: `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:743-752` (`pcdOpsQueries.create({ origin: layer === 'base' ? 'base' : 'user', state: … 'published' for user …, source, sql, metadata, desiredState, contentHash })`).
- The writer's doc states it: "For user layer: inserts a published user op (origin=user, state=published)" (`writer.ts:623-630`).
- Public entry points are `writeOperation` (`writer.ts:825-841`, always `source:'local'`, `runValueGuardGate:false`) and `writeOperationsFromSql` (`writer.ts:843-849`).
- Callers of the writer:
  - `pcd/entities/**` (40 files; the full list was enumerated by grep).
  - `lib/server/goals/persistGoalApply.ts:36` (`writeOperationsFromSql`; multi-op in ONE call). Applied from `routes/api/v1/goals/apply/+server.ts:102` with `layer:'user'`.
  - The sandbox in `pcd/sandbox/withSandboxCache.ts` deliberately does **not** go through the writer (`withSandboxCache.ts:11`).
- The layer comes from the caller: `parseOperationLayer` defaults to `'user'` (`pcd/utils/operationLayer.ts:10-17`). New-entity routes parse it from the form (`routes/custom-formats/[databaseId]/new/+page.server.ts:56-60`), and the import route takes `layer` from the body (`routes/api/v1/pcd/import/+server.ts:79`).
- After every write the writer calls `compile(instance.local_path, instance.id)` (`writer.ts:798`). A multi-op save therefore recompiles once per op.
- Before insert, `cancelOutCreate` (`writer.ts:286-418`) can swallow a user `delete` by dropping the earlier local `create` when nothing depends on it (`writer.ts:399-413`, state→`dropped` at 403). In that case **no delete op row exists** and the create op is already `dropped`.
- After insert, `supersedePriorUserOps` (`writer.ts:534-621`, invoked at `774-780`) supersedes earlier published user ops of the same entity:
  - For `update`: only ops proven redundant (`selectRedundantPriorOps`, `writer.ts:494-532`; rationale `482-493`), i.e. ops that share the new op's pre-image and so never took effect.
  - For `delete`: every non-create op of that entity (`redundant === null` path at `573-580`).

### 1.2 Metadata written (`buildMetadataJson`, `writer.ts:104-136`)

Keys: `operation`, `entity`, `name`, plus optional `previousName`, `summary`, `title`, `changed_fields`, `stable_key{key,value}`, `group_id`, `generated`, `depends_on[]`.

Source type: `OperationMetadata` (`pcd/core/types.ts:41-65`).

Conventions observed in the entity modules:

| Op kind                            | `name`                                 | `stable_key.value`                                                                                                                | Source                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create                             | new name                               | CF create: absent on the create op itself (`customFormats/create.ts:90-95`); present on its follow-up update ops (`:125,159,189`) |                                                                                                                                                                                                                                  |
| update                             | name **after** the save (`input.name`) | name **before** the save (`current.name`)                                                                                         | `qualityProfiles/general/update.ts:217-218,247-248`; `delayProfiles/update.ts:219-224`                                                                                                                                           |
| rename (op carries `previousName`) | new                                    | old                                                                                                                               | `qualityProfiles/general/update.ts:294-299`, `customFormats/general/update.ts:344-351`, `regularExpressions/update.ts:332-334`, `mediaManagement/naming/update.ts:145-146,401-402,614-615`, `metadataProfiles/update.ts:354-355` |
| delete                             | deleted name                           | deleted name                                                                                                                      | `delayProfiles/delete.ts:71`, `customFormats/delete.ts:150`                                                                                                                                                                      |
| generated cross-entity             | other entity's name                    |                                                                                                                                   | `customFormats/delete.ts:91-112` (QP scoring ops), `regularExpressions/delete.ts:126-127`, `regularExpressions/update.ts:349-364` (CF condition ops)                                                                             |

Entity vocabulary written today: `custom_format`, `quality_profile`, `regular_expression`, `delay_profile`, `{radarr,sonarr,lidarr}_{naming,media_settings,quality_definitions}`, `metadata_profile`, plus entity-test types `test_entity`/`test_release`. A grep over `pcd/entities` confirms this set.

### 1.3 Does one user save produce multiple ops? — YES, often with no shared id

| Save                                                                               | Ops per save                                           | `group_id`?                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| QP general (`qualityProfiles/general/update.ts`)                                   | up to 4 (`writeOperation` at lines 203, 232, 262, 286) | **none** (the file contains zero `groupId`)           |
| CF create (`customFormats/create.ts`)                                              | up to 4 (`:83,113,147,177`)                            | only if `opCount>0` (`:52`)                           |
| CF general update                                                                  | up to 5                                                | only when `shouldGroup` (`general/update.ts:244-245`) |
| CF delete                                                                          | 1 + N generated QP scoring ops                         | always (`delete.ts:28`)                               |
| Regex update                                                                       | 1, or 1+N when renamed                                 | only on rename (`regularExpressions/update.ts:45`)    |
| Regex delete                                                                       | 1+N                                                    | always (`delete.ts:34`)                               |
| CF conditions update                                                               | loop (`conditions/update.ts` ~`:443`)                  | per condition pair only                               |
| Naming, media settings, quality definitions, delay, metadata profile, entity tests | 1–3 per save                                           | **none**                                              |
| Goals apply                                                                        | multi-op in one `writeOperationsFromSql`               | none (`goals/buildGoalApplyOps.ts:48-60`)             |

`group_id` is therefore unusable as the undo unit: it is absent for most saves.

Consumers of `group_id` that must keep their meaning:

- `conflicts/align.ts:18-26,43-51` — drops every published user op sharing the id.
- `ops/draftChanges.ts:736,771,834-838,880` and `routes/databases/[id]/changes/*` — display grouping.
- `ops/exporter.ts:203-206,362-366`.

### 1.4 Definition: "user-op group" (undo unit) and the minimal fix

Define the **action key** of a published user op, in precedence order:

1. `metadata.action_id` (NEW) → `action:<id>`
2. else `metadata.group_id` → `group:<id>`
3. else the op alone → `op:<id>`

**Undo** = find the published `origin='user'` op with the highest `id` (state `published`, any entity, including unmapped ones), compute its action key, and revert every published user op sharing that key.

**Minimal fix.** Add `action_id` in the writer:

- New AsyncLocalStorage module `pcd/ops/actionContext.ts` exporting `withUserOpAction(fn, actionId = uuid())` and `currentUserOpActionId()`.
- `writeOperationsFromSqlOperations` computes `actionId = layer === 'user' ? (currentUserOpActionId() ?? uuid()) : undefined` **once per call** (fallback unit = one writer call). It passes the id into `buildMetadataJson`, which writes `payload.action_id`.
  - `serializeMigrationSqlOperation` (`writer.ts:169-179`) is the only caller of `buildMetadataJson`; it is also used by the value-guard gate, so thread the parameter through both uses.
- `hooks.server.ts` gets a third `Handle` in `sequence(csrfGuard, authHandle)` (currently `hooks.server.ts:367`). For non-safe methods it wraps `resolve(event)` in `withUserOpAction`. One mutating request = one user action. `[INFERENCE]` ALS propagates through SvelteKit's `resolve` into actions and endpoints. The repo already relies on ALS for the writer (`writer.ts:39`), but not from `handle`. If propagation failed, behaviour degrades to the per-call fallback (undo reverts only the last op of a multi-op save), never to corruption. A smoke test is in the plan.
- Metadata is JSON text and the writer only copies known keys, so no migration is needed. The content hash covers `sql + metadata` (`db/queries/pcdOps.ts:47-54`), but it is computed only for newly inserted rows, so the existing fingerprints (`snapshots/fingerprint.ts:62-69`) are untouched.
- **Existing rows**: no backfill. Boundaries of historical saves are unknowable. Legacy rows fall back to `group_id`, then to single-op groups. State this in the docs and UI help text.
- Known limitation: a `cancelOutCreate` pair leaves no delete op (§1.1), so it cannot be undone.

## 2. Entity identity (Q2)

### 2.1 Mapping op → (entityType, arrType, name)

- `resolveOpMetadataEntity(entityType, arrType)` (`pcd/resolved/layerDiff.ts:156-188`) maps resolved types to the op vocabulary (e.g. `naming`+`radarr` → `radarr_naming`; `lidarrMetadataProfile`+`lidarr` → `metadata_profile`; unmapped → `null`). It is **module-private**.
- `parseOpMetadata` (`:196-207`) is private and only reads `entity`/`name`.
- Plan: export `resolveOpMetadataEntity` and build the **inverse** map by iterating all `ResolvedEntityType × {undefined,radarr,sonarr,lidarr}` through it. That keeps one source of truth and avoids a second vocabulary table.
- The equivalent app-level vocabulary also exists in `pcd/stableIdentity.ts:3-24`.
- Types: `ResolvedEntityType` = 4 arr-agnostic + 4 per-arr (`pcd/resolved/types.ts:31-37`).
- Ops whose `entity` is not in the inverse map (`test_entity`, `test_release`, `batch`, unparseable/NULL metadata) are **unmapped**. They are excluded from entity lists and badges, but they still count toward "latest action" for undo. The GET response reports `unmappedOpCount`.

### 2.2 Renames (`previousName`)

Algorithm: walk published user ops in ascending `id`, maintaining `alias: Map<entity|name, EntityKey>`.

- Target name of an op: `T = stable_key.value ?? name`. This is the pre-op name for updates and also covers earlier ops of a rename save, which carry the _new_ `name` but the _old_ `stable_key.value` (§1.2).
- Create: always a new key, alias `(entity,name)`.
- Op with `previousName` and `name ≠ previousName`: look up/create the key for `T`, delete the old alias, add alias `(entity,name)`, set `currentName = name`.
- Delete: mark the key deleted and drop the alias.
- Otherwise: attach to the key found via `T` (fall back to `name`, then `previousName`); create one if absent.
- Finally merge keys that end with the same `(entityType, arrType, currentName)` (delete→recreate of the same name).

Result: badge and revert always address the **current** resolved name. A base entity deleted by the user is addressed by its base name and reports `present:false`.

Limitation: update ops with neither `stable_key` nor an alias for their `name` can split into a transient key. The final merge-by-name usually heals it. Documented, with a unit test.

### 2.3 Created / deleted

Derived at read time (never stored):

- `existsInBase` — from the base-only cache (`withBaseOnlyCache`, `pcd/resolved/layers.ts:54-56`).
- `present` — from the resolved cache.
- `kind` = `created` (`!base && resolved`), `deleted` (`base && !resolved`), else `modified`.
- Revert of a created entity = drop its create op and every later op of the entity (the "closed set" rule, §3.3), which deletes it. Revert of a user delete = drop the delete op, which restores base.
- `computeUserOverrides(base, resolved)` (`layerDiff.ts:138-143`) already yields all-`added` for create (documented `:129-137`) and removals for delete (`routes/.../resolved/[entityType]/+server.ts:130-134`).

## 3. Revert mechanics (Q3)

### 3.1 Marking ops dropped + audit

- `dropOp(databaseId, opId)` (`pcd/conflicts/overrideUtils.ts:58-68`): `pcdOpsQueries.update(opId,{state:'dropped'})`, then `pcdOpHistoryQueries.create({status:'dropped', batchId: uuid()})`.
  - It generates a **fresh batch id per op**. `align.ts:53-67` uses one batch id for a group.
  - Plan: add an optional `batchId` parameter to `dropOp` (backwards-compatible) so one revert = one audit batch.
- `pcdOpsQueries.update` records touched ids in the async-scoped recorder (`db/queries/pcdOps.ts:165-230`, `recordUpdatedOpIds` at 228; recorder `db/opCreationRecorder.ts`).

### 3.2 Canonical recompile

- `compile(pcdPath, databaseInstanceId)` (`pcd/database/compiler.ts:141-174`; re-exported from `$pcd/index.ts:17`):
  1. Builds a fresh `PCDCache`.
  2. Swaps it into the registry.
  3. Closes the old cache.
  4. Runs `autoResolveOverrideConflicts` unless suppressed (`:169-171`).
- Callers: the writer (`writer.ts:798`), `alignConflict` (`align.ts:69-72`, only if `instance.enabled`), `overrideConflict` (`override.ts:241-244,274-275`), and rollback (`snapshots/rollback/restore.ts:210`).
- `build()` loads exactly `state='published'` user ops (`database/cache.ts:56-60`, `ops/loadOps.ts:162`). Dropped/superseded/orphaned ops are not replayed. This is why "mark dropped + recompile" reverts the layer.
- **Danger found in `build()`**: with `conflict_strategy='align'` it **auto-drops** user ops whose guards no longer match (`cache.ts:116-131`, `needsRebuild` at `192-194`, and `compiler.ts:152-158`). On a build failure it **disables the whole database instance** (`cache.ts:285-291`).
  - So dropping op A can silently drop dependent op B (guard chain), which is data loss.
  - Mitigation (mandatory): after the recompile, assert that the published-user-op set equals the expected set and that no op became newly `conflicted`/`conflicted_pending`. Otherwise roll the attempt back (§3.5).

### 3.3 Safe behaviour for interactions → 409 (fail-closed), with reason codes

| Situation                                                                                                                                                                                                                                                                                                         | Behaviour                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Op not `published` (dropped/superseded/orphaned)                                                                                                                                                                                                                                                                  | Requested explicitly via `opIds` → 409 `op_not_revertible`. Not shown in the list.                                                                                                                                                                                                                                                                                                                |
| `opIds` contains an op that is not part of that entity                                                                                                                                                                                                                                                            | 404 `op_not_found`.                                                                                                                                                                                                                                                                                                                                                                               |
| `conflicted`/`conflicted_pending` ops                                                                                                                                                                                                                                                                             | **Revertible**: dropping them is exactly what align does (`align.ts:36-38` requires only published user ops). They are still `published`. Shown with their status.                                                                                                                                                                                                                                |
| **Co-grouped ops** (same explicit `group_id`, other entity or unselected, e.g. CF delete + generated QP scoring ops, `customFormats/delete.ts:91-112`)                                                                                                                                                            | Default 409 `group_dependency` (lists entities). With `cascadeGroup:true` the whole group is dropped (precedent `align.ts:43-51`), and the response lists `cascadedEntities`.                                                                                                                                                                                                                     |
| **Dependents** (`metadata.depends_on` of a _remaining_ published user op references a name this entity created or renamed in the drop set; e.g. QP scoring op depends on a user-created CF, `qualityProfiles/scoring/update.ts:156,189,267-373`; CF conditions depend on a regex, `conditions/update.ts:301-305`) | 409 `dependent_ops` with `blockingOpIds`. Checked only when the drop set contains a create or a name change, since pure field edits cannot orphan a dependent.                                                                                                                                                                                                                                    |
| **Partial selection** (`opIds ⊂ entity ops`)                                                                                                                                                                                                                                                                      | Allowed only when "closed": for every selected `s` and remaining `r` of the same entity with `r.id > s.id`: `changed_fields` disjoint; `s` is not create/delete/rename (rename = `changed_fields` contains `name` or `previousName` set); both have `changed_fields`. Else 409 `selection_blocked` (+ `blockingOpIds`). Reason: later ops' SQL guards were built against the earlier op's result. |
| Post-recompile verification fails (new conflict or collateral drop, §3.2)                                                                                                                                                                                                                                         | Whole attempt rolled back, 409 `conflict_after_revert` / `collateral_ops` (§3.5).                                                                                                                                                                                                                                                                                                                 |

### 3.4 Undo semantics

- Undo = action key of the latest published user op → revert every published user op in that key.
- If the latest group superseded earlier ops, **reactivate** the writer-superseded ones (`state='superseded'`, `superseded_by_op_id ∈ group`) so a delete undo does not lose earlier edits (a delete supersedes all prior non-create ops, `writer.ts:573-580`). Precedent: rollback also flips `superseded→published` (`restore.ts:101-113`).
- Reactivation only if the op's latest pre-`superseded` history status was `applied`. Excluded are `skipped`/`conflicted*`/`dropped`/`error`. The conflict-override flow supersedes an op that has just been `dropped` (`override.ts:269-289`) and must not be resurrected. Redundant-by-design ops never took effect (`writer.ts:482-493`) and would re-conflict.
- Undo accepts optional `expectedActionId` (value guard, 409 `stale_action`) so the UI never undoes a different group than it displayed (same idea as rollback's `expectedCurrentStateHash`, `routes/.../rollback/+server.ts:72-76`).
- Cross-entity groups: undo covers all entities in the action.

### 3.5 Atomicity and the lock

- **Write mutex**: the writer takes no per-database lock. `pcdOps.ts:262` records "per-PCD mutex follow-up: YAN-747".
- The only per-database serialization is `withDatabaseOverrideLock` (`conflicts/override.ts:115-134`, re-entrant via ALS), currently **module-private** and held only by `overrideConflict` (`:137`). Plan: export it and have revert/undo take it, so reverts serialize against overrides and each other. Concurrent _entity saves_ stay un-serialized (pre-existing YAN-747); the recorder-scoped rollback restores only rows written in its own async context (`pcdOps.ts:255-264`), so a concurrent save is not undone.
- Atomic attempt, copying the YAN-465 pattern (`override.ts:162-228`):
  1. Snapshot `pcdOpsQueries.listByDatabase(databaseId)`.
  2. Run `withAutoOverrideSuppressed(databaseId, …)` plus `withOpCreationRecorder(created, …)`.
  3. Drop (and reactivate) ops, then `compile`.
  4. Verify.
  5. On any failure, `pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created)` and a suppressed recompile, then return 409.
- **Rejected alternative (duplication cost)**: extract `restoreAfterFailure` from `override.ts` into a shared helper. I would rather not touch the delicate override path in this PR; the plan copies the ~40 lines into the new module and notes the dedupe as a follow-up.
- Instance disabled / cache missing → route returns 400 `Database not found` (same convention as resolved routes, `routes/.../resolved/[entityType]/+server.ts:50-54`).

### 3.6 Snapshots

- Existing pre-risk hooks: `snapshotService.createAutoSnapshot` is called before pull (`pcd/core/manager.ts:180,244`) and before sync (`jobs/handlers/arrSync.ts:965`). `restore()` takes a durable pre-rollback capture (`snapshots/rollback/restore.ts:182-198`).
- Triggers: `SnapshotTrigger = 'pull'|'sync'|'manual'|'rollback'` (`snapshots/types.ts:23`), DB `CHECK` at `migrations/20260712…:30`; auto dedup window 60 s (`snapshots/service.ts:31,70-110`).
- **Decision J2**: no snapshot hook for revert/undo in this PR (see §0). Because ops remain in `pcd_ops` with `state='dropped'`, a later snapshot rollback (manifest-based, `restore.ts:97-113`) can reactivate them if a snapshot exists from before the revert.

## 4. Proving AC2 (Q4)

- `resolveLayerState({layer:'user'})` (`layerDiff.ts:347-388`) reads the resolved cache and a base-only cache and returns `overrides = computeUserOverrides(base, resolved)`. An empty array after revert (with `present` equal to base presence) means resolved == base. Not-found-in-both throws `ResolvedEntityNotFoundError` (`:377-379`), which is the expected result after reverting a user-created entity.
- The revert service computes `resolvedMatchesBase` (for full reverts with no remaining ops) with that same call and returns it. The route tests assert it **and** independently compare `readResolvedEntity` vs the base-only cache.
- The delta machinery is the same used by the resolved list/named routes (`routes/.../resolved/[entityType]/+server.ts:123-157`), so the overrides GET and AC2 share one definition of "differs from upstream".

## 5. Badge + filter (Q5)

### 5.1 How the lists load

| View                                | Loader                                                                                                                                                        | Row type                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Custom formats                      | `routes/custom-formats/[databaseId]/+page.server.ts:49-62,93-99` (per-database rows via `customFormatQueries.list(cache)` + `withPcdSource`, plus TRaSH rows) | `CustomFormatTableRow` (`lib/shared/pcd/display/customFormats.ts:14-20`)     |
| Quality profiles                    | `routes/quality-profiles/[databaseId]/+page.server.ts:49-62,93` (same pattern)                                                                                | `QualityProfileTableRow` (`display/qualityProfiles.ts:37-49`)                |
| Regular expressions                 | `routes/regular-expressions/[databaseId]/+page.server.ts:35-45`                                                                                               | `RegularExpressionWithTags` (`display/regex.ts:5-7`)                         |
| Delay profiles                      | `routes/delay-profiles/[databaseId]/+page.server.ts:35-45`                                                                                                    | generated `DelayProfilesRow` (`display/delayProfiles.ts:5`)                  |
| Naming                              | `routes/media-management/[databaseId]/naming/+page.server.ts:~50-110` (per-arr rows)                                                                          | `NamingListItem{arr_type}` (`display/naming.ts:6-11`)                        |
| Media settings                      | `…/media-settings/+page.server.ts:1-30`                                                                                                                       | `MediaSettingsListItem{arr_type}` (`display/mediaSettings.ts:5-11`)          |
| Quality definitions                 | `…/quality-definitions/+page.server.ts:~50-110`                                                                                                               | `QualityDefinitionListItem{arr_type}` (`display/qualityDefinitions.ts:6-11`) |
| Lidarr metadata profiles (optional) | `routes/metadata-profiles/[databaseId]/+page.server.ts:38-62`                                                                                                 | `LidarrMetadataProfileListItem` (`display/metadataProfiles.ts:14`)           |

Only the TRaSH-aware pages (CF, QP, naming, quality definitions) mix rows from all PCDs. Their per-database `map` is where the flag can be attached, because it already iterates `databases` (`customFormats` loader `:49-62`).

### 5.2 Cheapest modified set

Use the **existing** query `pcdOpsQueries.listByDatabaseAndOrigin(databaseId,'user',{states:['published']})` (`db/queries/pcdOps.ts:138-155`). It is a single indexed read via `idx_pcd_ops_apply_order (database_id, origin, state, sequence, id)` (`migrations/041_create_pcd_ops.ts:59-60`). Then parse metadata in TS with the §2.2 resolver. No SQL JSON functions are needed because rename chaining needs ordered ops. Cost is O(user ops), typically tiny. It must **not** build the base-only cache (that is the per-request expensive part in the resolved list route).

Semantics (AC1): badge ⇔ at least one _published_ user op maps to the entity's current name. It is not conditioned on a non-empty field delta (a net-zero edit still shows the badge; the overrides page shows an empty delta and still allows revert).

### 5.3 UI patterns to reuse

- Filters live in `ActionsBar` (`routes/custom-formats/[databaseId]/+page.svelte:218-239`). `ActionButton` takes `icon`, `label`, `variant` (`lib/client/ui/actions/ActionButton.svelte:8-17`), and the default slot renders a badge-on-button (see `routes/regular-expressions/[databaseId]/components/SearchFilterAction.svelte:46-53`).
- Persistence idiom: localStorage keys per page (`customFormatsSourceFilter:${dbId}`, `+page.svelte:43-44,120-127`).
- Filtering is computed in page scripts (`+page.svelte:156` CF; `:127` QP; `:106` regex; `$filtered` for the rest).
- `Badge` has `warning` variant and optional `icon` (`lib/client/ui/badge/Badge.svelte:4-19,31-46`). Table cells are `{html}` strings (so a tiny exported HTML constant is needed, as for arr-target badges in `custom-formats/.../TableView.svelte:~100`); card views use the component.

## 6. UI for review / revert / undo (Q6)

- New route `routes/databases/[id]/overrides/` (+ tab in `routes/databases/[id]/+layout.svelte:9-60`, next to Snapshots at `:35-40`, active when `currentPath.includes('/overrides')`). "Routes over modals" — only confirmations use `Modal`.
- Page server loads via the server lib directly (same style as `routes/databases/[id]/conflicts/+page.server.ts:40-64`). Mutations use `fetch` to the new `/api/v1` endpoints, `alertStore`, and `invalidateAll`, as in `routes/databases/[id]/snapshots/+page.svelte:148-175`. The confirm uses `$ui/modal/Modal.svelte` (props `header/bodyMessage/confirmDanger/loading`, `Modal.svelte:11-20`; usage `snapshots/+page.svelte:287-308`).
- Layout: `ActionsBar` (search + "Undo last change" button, disabled when `lastAction` is null, showing the entities it will touch) + `ExpandableTable` rows (`lib/client/ui/table/ExpandableTable.svelte`). Expanded rows show the field delta table reusing `FIELD_META`/`formatFieldValue` (`lib/client/ui/resolved/fieldChangeDisplay.ts:13-32`; markup as in `routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte:218-262`) and the op list with checkboxes (selective revert) and "Revert all".
- Svelte 5 WITHOUT runes; match surrounding files (`export let`, `$:`, `on:click`).
- Edit-page "Revert to upstream": not cheap (J5).

## 7. API (Q7)

### 7.1 Existing resolved routes (patterns to copy)

- Files: `routes/api/v1/pcd/[databaseId]/resolved/{shared.ts,[entityType]/+server.ts,[entityType]/[name]/+server.ts,…/compare,…/diff}`.
- Auth gate: `if (!locals.user && !locals.authBypass) return 401` (`[entityType]/+server.ts:36-38`). `AUTH` is also enforced globally in `hooks.server.ts:277-330`, and API tokens are scope-checked by `enforceTokenScope` (`hooks.server.ts:~330`, `scopePolicy.ts:50-90`).
- Digits-only `databaseId` (`:41-45`), `pcdManager.getCache(id)?.isBuilt()` else 400 "Database not found" (`:50-54`), `isKnownResolvedEntityType` (`shared.ts:42-49`), `arrType` via `isArrAppType` (`shared/arr/capabilities.ts:275`), JSON via `sanitizeBigInts` (`shared.ts:73-76` area; impl `lib/server/utils/http/sanitizeBigInts.ts:13`), error mapper `mapResolvedErrorToResponse` (`shared.ts:126-150`), envelope `{error: string}` (`ErrorResponse` = `docs/api/v1/schemas/arr.yaml:519-526`).
- Snapshot rollback POST adds a body-size cap (8 KB) and `expectedCurrentStateHash` value guard (`routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/+server.ts:11-12,56-76`) — copy for `opIds`.
- Wire narrowing helpers exist: `toWireOverrides` (`shared.ts:74`).

### 7.2 OpenAPI structure

- The spec is **multi-file YAML**, not `packages/praxrr-api/openapi.json` (which is generated).
  - Root: `docs/api/v1/openapi.yaml` (tags at 15-65; PCD paths at 396-404 and 661-668; component refs at 1826-1840).
  - Paths: `docs/api/v1/paths/*.yaml` (e.g. `resolved-config.yaml`, `pcd-snapshots.yaml`).
  - Schemas: `docs/api/v1/schemas/*.yaml`.
- `openapi.yaml` references operations as `$ref: './paths/<file>.yaml#/<key>'` and schemas as `$ref: './schemas/<file>.yaml#/<Name>'`.
- Generation:
  - `deno task generate:api-types` = `npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts` (`deno.json:72`).
  - `deno task bundle:api` (`deno.json:98` → `scripts/bundle-api.ts`) writes `packages/praxrr-api/openapi.json` and copies the types to `packages/praxrr-api/types.ts`. `publish-api.yml:25-50` only allows those two files to change.
  - Feature commits include all four outputs (`git show --stat 6e992344`).
- Contract rules: `copilot-instructions.md` "Portable Contract Fidelity" and "Contract-first API".

### 7.3 Test patterns

- Route tests call the exported handler with a hand-built event: `tests/routes/resolvedConfigApi.test.ts` (`buildLocals` `:53-72`, fixture `createCacheFixture` `:199-214`, `patchTarget` `:261`).
- Real-DB harness: `tests/pcd/snapshots/rollbackTestHelpers.ts` (`migratedTest` `:11-35` = scratch app DB + migrations; `createTestDatabase(localPath)` `:38-44`; `insertOp` with explicit ids `:61-80`).
- Real schema + temp PCD dir: `tests/pcd/resolved/lineage/lineageEngine.test.ts:19,64-70` (copies `packages/praxrr-schema/ops/{0.schema,1.languages,2.qualities}.sql` into `<pcd>/deps/schema/ops`).
- Real compile against a migrated DB: `tests/pcd/conflicts/overrideConflictRestore.test.ts:12-35,48-72`.
- Token-scope table test: `tests/server/utils/auth/apiTokens.test.ts:256-269`.
- Registration: `scripts/test.ts` `aliases` (`:11-53`; `resolvedConfig` alias `:39-40`; the default `deno task test` runs `packages/praxrr-app/src/tests`, `:57-60`).
- Known unrelated local failures (ARR_CREDENTIAL_MASTER_KEY): `arrExternalUrlLayoutPropagation`, 2× `lidarrOnboarding` (agent memory), identical on `main`.

### 7.4 Endpoint design

Base: `/api/v1/pcd/{databaseId}`. Enum `entityType` = the 8 resolved types, identical to `docs/api/v1/paths/resolved-config.yaml`.

1. `GET /overrides` — query: optional `entityType`, optional `arrType`.
   - Response `PcdOverridesResponse { databaseId, entities[], lastAction | null, unmappedOpCount }`.
   - `entities[]`:
     - `entityType`, `arrType|null`, `name`
     - `kind: modified|created|deleted`
     - `present`, `existsInBase`
     - `overrides: FieldChange[]` (reuse `schemas/sync.yaml#/FieldChange`)
     - `hasPendingConflict`
     - `ops[]`: `{id, operation, title, summary, changedFields[], actionId|null, groupId|null, status|null, createdAt}`
   - `lastAction`: `{actionId, key, opIds[], entities[{entityType,arrType,name}], createdAt}`.
   - Errors: 400/401/500.
   - Cost: one base-only cache build, like `GET /resolved/{type}?layer=user`.
2. `POST /overrides/{entityType}/{name}/revert` — query `arrType`; body `{opIds?: int[], cascadeGroup?: boolean}` (≤ 1000 ids; ≤ 8 KB).
   - 200 `PcdOverrideRevertResult {databaseId, entityType, arrType|null, name, revertedOpIds[], cascadedEntities[], remainingOpIds[], resolvedMatchesBase: boolean|null}`.
   - 404 `{error, reason: 'entity_not_found'|'op_not_found'}`.
   - 409 `PcdOverrideConflictResponse {error, reason, blockingOpIds?, entities?}` with `reason ∈ group_dependency | dependent_ops | selection_blocked | op_not_revertible | conflict_after_revert | collateral_ops`.
3. `POST /overrides/undo` — body `{expectedActionId?: string}`.
   - 200 `PcdOverrideUndoResult {databaseId, undoneActionId, revertedOpIds[], reactivatedOpIds[], entities[]}`.
   - 404 `nothing_to_undo`.
   - 409 `stale_action` | `conflict_after_revert` | `collateral_ops`.

The `name` path segment is the entity's **current** name; names are not trimmed and empty is rejected. Path-segment limitation: names containing `/` cannot be addressed, the same as the existing `[name]` route.

Token scope: both POSTs fall to the fail-closed `admin` default (J4); GET needs `read`.

## 8. Cross-Arr (Q8)

- `entityType` enum identical to the resolved routes (`resolved-config.yaml`; runtime tables `pcd/resolved/readers.ts:133-175`).
- `arrType` semantics follow **runtime**, not prose:
  - Arr-agnostic types (`delayProfile`, `regularExpression`, `customFormat`, `qualityProfile`) reject `arrType` (`readers.ts:207-212,237-243`).
  - `naming`, `mediaSettings`, `qualityDefinitions` require it, with explicit per-arr dispatch and no sibling fallback (`readers.ts:215-228,245-250`).
  - `lidarrMetadataProfile` **requires** `arrType='lidarr'` and rejects the others (`readers.ts:324-333`).
- Observed spec drift (out of scope, not fixed here): `docs/api/v1/paths/resolved-config.yaml:12-14,55-56` says `arrType` is "rejected for … lidarrMetadataProfile", contradicting `readers.ts:245-248,324-333`. The new endpoints document the runtime behaviour. Worth a separate one-line spec fix.
- The op → resolved mapping derives arrType from `metadata.entity` through `resolveOpMetadataEntity`'s inverse. Ambiguous or unknown entities are **unmapped**, never guessed (fail-fast per the policy). Revert never infers a sibling's `arrType`.
- QP/CF `arr_type` scoring rows are not part of entity identity here; they live inside the QP/CF payload diff.

## 9. Risks / limitations

1. **Collateral drops under `align` strategy** — mitigated by post-compile verification and rollback (§3.2/§3.5).
2. **No writer mutex** (YAN-747) — revert is serialized only against overrides and other reverts.
3. **Legacy ops have no `action_id`** — undo falls back to `group_id`/single op (documented).
4. **`cancelOutCreate`** pairs are not undoable.
5. **GET /overrides cost** — one base-only cache build per request, bounded like the existing resolved list route. List pages use only the cheap index.
6. **ALS through SvelteKit `resolve`** `[INFERENCE]` — verified by a smoke step, degrade-safe.
7. Net-zero edits keep the badge until reverted (by design, AC1 literal).
8. Out of scope (follow-up): promote user ops to base drafts; snapshot trigger `override_revert`; edit-page revert button; dedupe of `restoreAfterFailure`.
