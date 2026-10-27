# Feature Spec: Preview incoming upstream PCD changes per entity, with predicted conflicts, before pulling

- Issue: Linear YAN-570 / GitHub #381
- Branch: `feat/yan-570-incoming-preview`
- Status: research complete, ready to implement
- Scope of this document: read-only research (7 findings) + concrete design. No code was changed.

All paths are repo-relative to the worktree root. Line numbers are from commit `51753c64`.

---

## Finding 1 — How pull works today, end-to-end

### 1.1 Trigger path (UI → job queue → manager)

1. Changes page Pull button: `packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte:518-552`
   (`handlePull()` POSTs the SvelteKit form action `?/pull`).
2. Form action `pull`: `packages/praxrr-app/src/routes/databases/[id]/changes/+page.server.ts:218-260`.
   It does **not** pull synchronously; it calls `enqueueManualPcdSync(id)` and returns
   `{ queued | alreadyRunning, job }`.
3. Queue: `packages/praxrr-app/src/lib/server/jobs/helpers/pcdSyncQueue.ts:44-79`
   (`enqueueManualPcdSync(databaseId)`), dedupe key `pcd.sync:{databaseId}`; returns
   `already_running` if a job with that key is `running`.
4. Handler: `packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts:8-47` (`dbSyncHandler`,
   registered for `pcd.sync` at line 113) calls `pcdManager.sync(databaseId)`.

### 1.2 `PCDManager.sync(id)` — the actual pull

`packages/praxrr-app/src/lib/server/pcd/core/manager.ts:171-300`. Remote-source path (lines 231-292):

1. `checkForUpdates(instance.local_path)` (git `fetch` + `rev-list HEAD..origin/<branch>`,
   see Finding 4). If no updates: stamp `updateSyncedAt`, return.
2. `snapshotService.createAutoSnapshot({ trigger: 'pull' })` — pre-pull snapshot, best-effort.
3. `pull(instance.local_path)` — `packages/praxrr-app/src/lib/server/utils/git/write.ts:453-455`:
   plain `execGit(['pull'], repoPath)`. This is the only step that moves `HEAD`/working tree.
4. `syncDependencies(instance.local_path, token)` —
   `packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts:267-336`: reads the (new) manifest,
   and for each dependency whose ref changed, `fetch` + `checkout`/`reset --hard origin/<ref>`
   inside `deps/<repo>` (or re-clone). Honours `PRAXRR_SCHEMA_LOCAL_PATH`.
5. `importBaseOps(id, instance.local_path)` — YAML entities → base ops (§1.3).
6. `seedBuiltInBaseOpsWithOrchestration(id, 'sync')` — currently a no-op stub:
   `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts:8-20` returns `{created: 0, skipped: 0}`.
7. `databaseInstancesQueries.updateSyncedAt(id)`.
8. `compileIfEnabled` → `compile(localPath, id)` (§1.4).
9. `triggerPullSync(id)` → Arr syncs with `on_pull` trigger.

Local-path sources take a different branch (lines 178-229): `refreshLocalRepositoryClone(...)`
re-copies the source into the clone, then steps 4-8 as above. There is no `origin/<branch>`
concept; `checkForUpdates` short-circuits to `hasUpdates: false` for them
(`manager.ts:302-320`).

### 1.3 Base-op ingestion: `importBaseOps(databaseId, pcdPath)`

`packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:432-565`
`export async function importBaseOps(databaseId: number, pcdPath: string): Promise<ImportBaseOpsResult>`.

1. `readMigrationEntitySources(pcdPath)` —
   `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:88-117`. Walks
   `${pcdPath}/entities/**` (`.yaml`/`.yml`/`.json`), sorted; maps directories to entity types
   (`reader.ts:44-61`: `custom-formats`, `quality-profiles`, `delay-profiles`,
   `regular-expressions`, plus per-Arr `*-naming`, `*-media-settings`, `*-quality-definitions`
   media dirs). Each file becomes a `MigrationEntityCandidate` (`reader.ts:65-75`) carrying
   `relativePath`, `entityType`, portable payload, `stableIdentity`, and a `deserialize` function.
   Any parse/validation issue aborts the whole import (`MigrationReaderError`, importBaseOps.ts:434-438).
2. Snapshot **every** `pcd_ops` row of the database for rollback (`pcdOpsQueries.listByDatabase`),
   and record all op/history rows created during the import (`withOpCreationRecorder`) so a
   failure restores the exact pre-import table (YAN-466, `rollbackFailedImport` at :411-430).
3. Build the refresh set: `buildPublishedRepoBaseOpIndex(databaseId)` (:130-180) indexes published
   repo base ops by stable identity, legacy `entity::name`, and `entities/<path>#` filename
   prefix; `matchingPublishedRepoBaseOpIds(index, candidate)` (:182-221) finds the ops each
   candidate replaces.
4. Build an ephemeral import cache: `buildImportCache(pcdPath, databaseId, repoOpIdsToRefresh)`
   (:31-47) = `new PCDCache(pcdPath, databaseId).buildReadOnly({ layers: {schema, base, tweaks},
excludeBaseOpIds: refreshSet })`. Refreshed entities look absent; user layer is never replayed
   here (YAN-461). The cache is exposed to deep call paths via `withScopedCache`
   (`packages/praxrr-app/src/lib/server/pcd/database/registry.ts:26-38`) — never `setCache`.
5. For each candidate (in `sortMigrationCandidatesByImportOrder` order): skip if
   `hasBaseEntityByStableIdentity(presenceCache, candidate.stableIdentity)` (:231-247);
   otherwise run `candidate.deserialize({ databaseId, cache, layer: 'base', data: candidate.portable })`
   inside `withRepoImportWriteContext({ filenamePrefix: 'entities/<relativePath>',
sequenceStart: 4_000_000_000 + i * 10_000, maxOperations: 10_000, lastSeenInRepoAt: seenAt })`.
   Deserializers (`packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:63-195`) call
   entity create/update handlers, which call `writeOperation(...)` in
   `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:825-878`. In repo-import context the
   writer upserts a published `origin='base', source='repo'` row keyed by the synthetic filename
   (`entities/<path>#00000.sql`, writer.ts `consumeRepoImportIdentity`), and — fast path —
   applies the SQL directly to the scoped import cache's raw DB instead of recompiling
   (writer.ts, `fastPathRepoImport` branch).
6. Orphan sweep: `pcdOpsQueries.markBaseOrphaned(databaseId, seenAt)` —
   `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:237-256`: `origin='base' AND source='repo'`
   rows not re-seen (`last_seen_in_repo_at IS NULL OR < seenAt`; no state predicate) become
   `state='orphaned'` (export-batch ops exempt, YAN-463). This is how upstream deletions land.
7. **One** final `compile(pcdPath, databaseId)` (importBaseOps.ts, end of the
   `withOpCreationRecorder` block) — user ops are only ever evaluated against the complete
   refreshed base (YAN-461).

### 1.4 Cache recompile and conflict recording: `compile()` + `PCDCache.build()`

- `compile(pcdPath, databaseInstanceId)`:
  `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts:143-176`. Builds a fresh
  `PCDCache` via `build()`, rebuilds once more if `stats.needsRebuild` (a force-dropped op
  polluted the in-memory DB), swaps it into the registry (`setCache`), closes the old cache,
  then — unless suppressed — `autoResolveOverrideConflicts` (:56-137): for
  `conflict_strategy='override'` only, it takes each published user op whose latest history is
  `conflicted` and calls `overrideConflict(...)` (max 10 rounds).
- `PCDCache.build()`: `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:52-296`.
  Loads ops via `loadAllOperations(pcdPath, databaseInstanceId)` —
  `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:119-167` — order: schema (files under
  `deps/*/ops`), base (DB: published, then drafts at `+3_000_000_000`), tweaks (files under
  `tweaks/`), user (DB: published only). Then executes each op's SQL in order against an
  in-memory SQLite DB. For every op whose `filepath` is `pcd_ops:<id>` it computes
  `rowcount = db.totalChanges` delta and evaluates the value-guard gate (Finding 5), then
  writes exactly one `pcdOpHistoryQueries.create({ opId, databaseId, batchId, status, rowcount,
conflictReason })` row (`pcdOpHistory.ts:105-124`). One `batchId` (uuid) per `build()`.
  Auto-align drops additionally mutate the app DB mid-build:
  `pcdOpsQueries.update(opId, { state: 'dropped' })`. On hard failure it calls
  `disableDatabaseInstance(...)` — a side effect the preview must never trigger (hence: never
  call `build()`/`compile()` from preview code).
- Op loading is DB-first for base/user: `loadAllOperations` reads base/user SQL from `pcd_ops`
  rows (`toOperation`, loadOps.ts:16-26), **not** from repo files. Repo files influence the
  cache only through `importBaseOps` (entities), `tweaks/*.sql`, and the schema dependency.
  This is the single most important fact for Finding 2.

### 1.5 Exact functions a preview must mirror so preview == actual pull

| Pull step                   | Function (path)                                                                              | Preview equivalent                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Fetch remote refs           | `fetch()` git/write.ts:439-442 (via `checkForUpdates`, git/read.ts)                          | Strict fetch, Finding 7                                 |
| Incoming commit list        | `getIncomingChanges()` git/read.ts:238-279                                                   | Reuse as-is                                             |
| Dependency (schema) refresh | `syncDependencies()` pcd/git/dependencies.ts:267-336                                         | Run against the temp tree only                          |
| Entity file → candidate     | `readMigrationEntitySources()` pcd/migration/reader.ts:88-117                                | Reuse against temp tree                                 |
| Refresh-set matching        | `buildPublishedRepoBaseOpIndex` + `matchingPublishedRepoBaseOpIds`, importBaseOps.ts:130-221 | Reuse (needs exporting)                                 |
| Candidate → base SQL        | `candidate.deserialize` + `writeOperation` in repo-import context, writer.ts                 | Capture mode, §8.2                                      |
| Base-state materialisation  | `buildImportCache` (buildReadOnly + `excludeBaseOpIds`), importBaseOps.ts:31-47              | Reuse pattern on temp tree, expanded exclude set (§8.3) |
| Orphan sweep                | `markBaseOrphaned`, pcdOps.ts:237-256                                                        | Simulate by exclusion, §8.3                             |
| User-op replay + conflicts  | `PCDCache.build()` cache.ts:52-296 with `evaluateValueGuardApply/Error`                      | Dry replay, Finding 5 / §8.4                            |
| Final resolved state        | `compile()` compiler.ts:143-176 (+ auto-override)                                            | Never call; approximated by dry replay (§8.4, risk R4)  |

Non-goals for parity: pre-pull snapshot (side effect only), `updateSyncedAt`, Arr `on_pull`
syncs, `seedBuiltInBaseOps` (no-op stub today).

---

## Finding 2 — `buildReadOnly` / `withSandboxCache`: inputs, git-tree feasibility, DB writes

`packages/praxrr-app/src/lib/server/pcd/database/cache.ts:321-375`:

```ts
async buildReadOnly(
  options: {
    layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'>;
    snapshotOpIds?: ReadonlySet<number>;
    excludeBaseOpIds?: ReadonlySet<number>;
    replayBaseOpIds?: ReadonlySet<number>;
  },
  hooks?: BuildReadOnlyHooks
): Promise<void>
```

- Constructor: `new PCDCache(pcdPath: string, databaseInstanceId: number)` (cache.ts:43-46).
- It bootstraps an in-memory SQLite DB (`bootstrap()`, :383-392), loads ops with
  `loadAllOperations(this.pcdPath, this.databaseInstanceId, {...})`, filters to `layers`,
  executes each op's SQL. Schema-layer failure throws (fail-fast); other layers warn-skip.
- **It takes a directory path, not an ops list.** The only ops-list-like inputs are id sets
  (`snapshotOpIds`, `excludeBaseOpIds`, `replayBaseOpIds`) that filter rows read from the
  **app DB** by `databaseInstanceId`.
- Writes to the app DB: **none.** By contract (cache.ts:298-320) and by test
  (`cacheBuildReadOnly.test.ts:223-247`): never evaluates value guards, never calls
  `pcdOpHistoryQueries.create`, never `pcdOpsQueries.update`, never `disableDatabaseInstance`.
  The caller owns the lifecycle and must `close()`; the cache must never be `setCache`-registered.

Layer sourcing (from `loadAllOperations`, loadOps.ts:119-167):

| Layer  | Source                                                                   | Driven by    |
| ------ | ------------------------------------------------------------------------ | ------------ |
| schema | files `${pcdPath}/deps/*/ops/*.sql` (first deps dir containing `schema`) | `pcdPath`    |
| base   | app-DB `pcd_ops` rows for `databaseInstanceId` (published + drafts)      | `databaseId` |
| tweaks | files `${pcdPath}/tweaks/*.sql`                                          | `pcdPath`    |
| user   | app-DB `pcd_ops` rows, `state='published'`                               | `databaseId` |

### 2.2 `withSandboxCache`

`packages/praxrr-app/src/lib/server/pcd/sandbox/withSandboxCache.ts:62-173`:

```ts
export async function withSandboxCache<T>(
  databaseId: number,
  editsByProfile: Map<string, ProfileEdit>,
  fn: (cache: PCDCache, report: SandboxReport) => Promise<T>
): Promise<T>;
```

Purpose-built for the impact simulator: builds
`new PCDCache(instance.local_path, databaseId).buildReadOnly({ layers: {schema, base, tweaks, user} })`
(i.e. the **current** resolved state), applies proposed scoring/ladder ops directly to the raw
SQLite handle inside per-profile savepoints, runs `fn`, always closes. Never registered, never
routed through `writeOperation`. Sibling helpers in
`packages/praxrr-app/src/lib/server/pcd/resolved/layers.ts`: `withBaseOnlyCache` (:54-56,
schema+base+tweaks), `withCurrentCache` (:80-82, all layers), `withSnapshotCache` (:65-71,
all layers but exactly `snapshotOpIds`), all funnelled through `withEphemeralCache` (:119-145).

### 2.3 Can these build from a git tree at `origin/<branch>` without touching the working tree?

**Not directly — this is the central implementation problem.**

- `pcdPath` controls only the file layers (schema, tweaks). Pointing a `PCDCache` at an
  extracted `origin/<branch>` tree gives the incoming `tweaks/*.sql` (and, after dependency
  sync, incoming schema ops) — but the **base layer still comes from the current `pcd_ops`
  rows** for `databaseId`. An extracted tree contains `entities/*.yaml`, not base-op SQL;
  base SQL exists only as the product of `importBaseOps` deserialization.
- Therefore "build a sandbox from the extracted tree with `buildReadOnly`" would silently diff
  the _current_ base against itself for all YAML-driven entities. The incoming base state must
  be **materialised** the way the pull materialises it: run the candidates' deserializers
  against an ephemeral cache and capture their SQL/effects without persisting ops (§8.2-8.3).
  The good news: `buildImportCache` (importBaseOps.ts:31-47) already demonstrates the exact
  cache shape needed, and the writer's repo-import fast path already applies generated SQL to
  a scoped cache instead of recompiling.
- Extraction itself is safe and needs no working-tree contact:
  - `git fetch` updates only remote-tracking refs (Finding 7).
  - `git archive origin/<branch> | tar -x -C <tempDir>` materialises the tree with zero
    working-tree/index/HEAD contact and no `.git` in the temp dir. No existing helper does
    this: `execGit` (`packages/praxrr-app/src/lib/server/utils/git/exec.ts:10-38`) trims stdout
    as text, so a binary tar stream needs a dedicated `Deno.Command` pipeline (§8.2).
    There is **no** existing `git worktree` usage in the codebase (grep: no matches).
  - `git archive` caveats: submodules are not expanded and `export-ignore` attributes are
    honoured. Mitigation in §8.2: cross-check `git ls-tree -r --name-only <ref> -- entities`
    against the extracted tree and fail closed on mismatch.
- A fresh extracted tree has no `deps/` directory (the schema dependency is a separate clone
  inside `local_path`, not part of the PCD repo). `syncDependencies(tempPath, token)` must be
  run against the temp tree so the sandbox uses the _incoming_ manifest's schema ref,
  exactly as pull does after `git pull` (manager.ts:255).
- Local-path sources (`isLocalRepositorySource`) have no `origin/<branch>`; preview returns
  `available: false` for them (mirroring `checkForUpdates`, manager.ts:302-320). Never call
  `refreshLocalRepositoryClone` from preview — it mutates the user's clone.

---

## Finding 3 — `diffEntityFamily`, rollback preview, and `SnapshotDiff.svelte`

### 3.1 Types

`packages/praxrr-app/src/lib/server/pcd/snapshots/rollback/types.ts:18-30`:

```ts
export interface RollbackSection {
  title: string;
  entityType: string; // namespaced `${entityType}:${arrType}` for per-Arr families
  arrType: ArrAppType | null;
  changes: EntityChange[];
}
export interface RollbackSummary {
  totalCreates: number;
  totalUpdates: number;
  totalDeletes: number;
  totalUnchanged: number;
}
```

`EntityChange` / `FieldChange` come from
`packages/praxrr-app/src/lib/server/sync/preview/types.ts:76-91`:

```ts
export interface FieldChange {
  field: string;
  type: 'added' | 'changed' | 'removed';
  current: unknown;
  desired: unknown;
}
export interface EntityChange {
  entityType: string;
  name: string;
  action: 'create' | 'update' | 'delete' | 'unchanged'; // SyncPreviewAction, types.ts:10
  remoteId: number | null;
  managed?: boolean;
  fields: readonly FieldChange[];
}
```

### 3.2 `diffEntityFamily`

`packages/praxrr-app/src/lib/server/pcd/snapshots/rollback/entities.ts:119-159`:

```ts
export async function diffEntityFamily(
  currentCache: PCDCache,
  snapshotCache: PCDCache,
  target: RollbackEntityTarget // { entityType: ResolvedEntityType; arrType: ArrAppType | undefined }, :30-33
): Promise<RollbackSection>;
```

Behaviour: unions entity names from `listResolvedEntityNames` on both caches (sorted),
reads each side with `readResolvedEntity` (`readEntityOrNull`, :99-113, NotFound → null),
diffs portable payloads with `diffToFieldChanges(current ?? {}, snapshot ?? {},
{ arrayKeyStrategies: PORTABLE_ARRAY_KEY_STRATEGIES })` from `$sync/preview/diff.ts`.
Action semantics, relative to moving from `currentCache` to `snapshotCache`:
snapshot-only ⇒ `create`, current-only ⇒ `delete`, both + field diff ⇒ `update`, else
`unchanged`. `FieldChange.current` = current side, `FieldChange.desired` = snapshot side.
`summarizeSections(sections)` (:162-185) folds actions into a `RollbackSummary`.

Family enumeration: `rollbackEntityTargets()` (:73-87) =
arr-agnostic `customFormat, qualityProfile, delayProfile, regularExpression` (:35-40)
plus per-Arr `naming, mediaSettings, qualityDefinitions, lidarrMetadataProfile` (:42-47)
× `radarr|sonarr|lidarr` (filtered by `PER_ARR_READERS` support). That is the full
resolved-config surface; a name present in both caches under different Arr namespaces never
collides (`entityNamespace`, :95-97).

### 3.3 Rollback preview orchestration (the pattern to copy)

`packages/praxrr-app/src/lib/server/pcd/snapshots/rollback/preview.ts:22-29`:

```ts
async function diffAllFamilies(
  currentCache: PCDCache,
  snapshotCache: PCDCache
): Promise<RollbackSection[]>;
```

- sequential per family (comment: one SQLite connection per cache — avoid interleaving);
- `previewRestore(snapshotId)` (:35-95) runs it inside `withSnapshotCache(...)`, preferring
  the registered cache for the current side and falling back to `withCurrentCache(...)`.
- Route: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/rollback/preview/+server.ts:41-77`
  (`GET`, hand-rolled `parsePositiveInteger` :8-23 + `validateDatabaseExists` :25-32,
  errors via `json({ error }, { status })`).
- OpenAPI: `packages/praxrr-api/openapi.json:2703-2771` (path) and schemas `RollbackSection`
  (:13945), `RollbackPreview` (:13971), reusing `EntityChange` (:9623) / `FieldChange` (:9556).

### 3.4 How `SnapshotDiff.svelte` consumes it

`packages/praxrr-app/src/lib/client/ui/snapshots/SnapshotDiff.svelte:1-55`:

```ts
export let sections: RollbackSection[];
export let summary: RollbackSummary;
```

- `toVisibleSections` (:37-52) drops sections with no actionable (non-`unchanged`) changes
  and reports the unchanged tally per section; `hasChanges` from `summary` (:55).
- Renders action badges from `ACTION_META` (:30-35), and per-field rows
  `field | change-type | Current | After restore` (:58-167), formatting values via
  `formatFieldValue` from `$ui/resolved/fieldChangeDisplay.ts`.
- **Hard-coded rollback wording**: the column header literally reads "After restore" and the
  empty state says "This snapshot matches the current PCD state — restoring it would make no
  changes." Reuse for incoming preview therefore requires new optional props with
  rollback-preserving defaults (§8.6).
- Only consumer today: `packages/praxrr-app/src/routes/databases/[id]/snapshots/[snapshotId]/+page.svelte:270`
  (`<SnapshotDiff sections={preview.sections} summary={preview.summary} />`), fed by a plain
  `fetch('/api/v1/pcd/.../rollback/preview')` in `loadAll()` (:51-99).

### 3.5 Direction warning for incoming preview

`diffEntityFamily(current, target)` labels target-only entities `create` and produces
`FieldChange.desired` = target value. For incoming preview the natural call is
`diffEntityFamily(currentCache, incomingCache)` ⇒ "create" = upstream will add,
"delete" = upstream will remove, columns Current → After pull. §8.4 pins which two caches
those are; getting the order backwards inverts every label, so the design tests assert on it.

---

## Finding 4 — The existing incoming-changes API/route and page data flow

### 4.1 Server: `getIncomingChanges`

`packages/praxrr-app/src/lib/server/utils/git/read.ts:238-279`:

```ts
export async function getIncomingChanges(
  repoPath: string
): Promise<IncomingChanges>;
```

Calls `fetch(repoPath)` (silent), resolves `origin/<currentBranch>`, counts
`HEAD..origin/<branch>`; if 0 returns `{ hasUpdates: false, commitsBehind: 0, commits: [] }`,
else lists commits (`%H|%h|%s|%an|%ae|%cI`) with per-commit file names via
`diff-tree --no-commit-id --name-only -r`. Result type `IncomingChanges`
(`packages/praxrr-app/src/lib/server/utils/git/types.ts:45-49`) with `Commit`
(types.ts:35-43: `hash, shortHash, message, author, authorEmail, date, files[]`) — commits
and file names only, confirming the issue evidence. Sibling `checkForUpdates`
(read.ts, `UpdateInfo` types.ts:15-21) adds ahead/behind counts and head SHAs.

### 4.2 Legacy (non-v1) changes endpoint — the one the page actually uses

`packages/praxrr-app/src/routes/api/databases/[id]/changes/+server.ts:35-117`
(`GET /api/databases/{id}/changes`). `Promise.all([getStatus, getIncomingChanges, getBranches])`
with a git-unavailable fallback to empty shapes; plus `getRepoInfo` and, for PAT/developer
databases, `listDraftEntityChanges`. Returns
`json({ status, incomingChanges, branches, repoInfo, draftChanges, ... })`.

There is **no** `/api/v1` incoming/updates endpoint today: `glob
routes/api/v1/**/+server.ts` shows the only PCD-scoped v1 routes are `pcd/[databaseId]/
{snapshots, resolved, overrides, graph, lidarr-metadata-profiles}`; the proposed
`GET /api/v1/pcd/{databaseId}/incoming/preview` is greenfield. Contract-first convention:
define it in `packages/praxrr-api/openapi.json` first, then run
`deno task generate:api-types` (regenerates `packages/praxrr-app/src/lib/api/v1.d.ts`;
do not hand-edit generated files).

### 4.3 Changes page data flow

`packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte`:

- `fetchChanges()` (:128-144) `fetch('/api/databases/${data.database.id}/changes')` on
  `afterNavigate`, populates `status`, `incomingChanges`, `draftChanges`, `branches`, `repoInfo`.
- Incoming section (:706-790): header + Pull button (label `Pull N commits`, :713-727) and an
  `ExpandableTable` of commits (`incomingColumns`: shortHash/message/author/date, :655-668).
  Commit file lists are fetched by the API but not surfaced per entity.
- Pull: `handlePull()` (:518-552) → `?/pull` form action; feedback via `alertStore.add(...)`
  (`info` queued/already-running, `error` failure), then re-runs `fetchChanges()`.
- Page conventions to match: Svelte 5 without runes (`export let data`, `$:` reactivity,
  `on:click`), `alertStore` for all user feedback, no modal for the preview (routes/flows over
  modals; the preview is inline content).

---

## Finding 5 — Conflict detection during replay, and dry-run feasibility

### 5.1 Value guards and the gate

User ops carry SQL whose `WHERE` clauses embed pre-image (old-value) guards, plus
`metadata` (JSON: `operation`, `entity`, `name`, `stable_key`, `changed_fields`, …) and
`desired_state` (JSON `{field: {from, to}}`) columns on `pcd_ops`. During `PCDCache.build()`
(cache.ts:52-296), each published user op is executed, then judged by:

`packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`:

- `evaluateValueGuardApply(input: ValueGuardApplyContext): ValueGuardApplyDecisionResult`
  (:167-249). Input: `{ db, conflictStrategy, isUserOp, rowcount, metadataJson,
desiredStateJson, priorConflictReason }`. Decisions (:21-27):
  `applied | skipped | rowcount_zero_conflict | full_list_conflict |
auto_align_rowcount_zero | auto_align_full_list`. Logic:
  - non-user op ⇒ `applied`/`skipped` by rowcount, never a conflict;
  - user op, `rowcount === 0`: try auto-align (`evaluateAutoAlign`,
    `packages/praxrr-app/src/lib/server/pcd/conflicts/autoAlign/index.ts:16-60`);
    if alignable ⇒ `dropped` + `conflictReason: 'aligned'` + `shouldAttemptAutoDrop: true`
    (+ `autoAlignRule`, e.g. `force_align_strategy`, `quality_profile_scoring_row`);
    else conflict: status `conflicted` (or `conflicted_pending` under `ask`,
    `resolveConflictStatus` :128-130) with reason from operation:
    create ⇒ `duplicate_key`, delete ⇒ `missing_target`, update ⇒ `guard_mismatch`
    (`getConflictReason` :132-142);
  - user op, `rowcount > 0` but `checkFullListConflict` / `checkScalarGuardConflict`
    (`$pcd/conflicts/fullListCheck.ts`, `$pcd/conflicts/scalarGuardCheck.ts`) fail:
    strategy `align` ⇒ forced align (`dropped`/`aligned`, `needsRebuild: true`);
    otherwise `full_list_conflict` (`conflicted*`, `guard_mismatch`).
- `evaluateValueGuardError(input: ValueGuardErrorContext): ValueGuardErrorDecisionResult`
  (:255-288): SQL exception path. User-op `UNIQUE constraint failed` ⇒
  `conflicted*`/`duplicate_key`; `FOREIGN KEY constraint failed` ⇒
  `conflicted*`/`missing_target`; anything else ⇒ `status: 'error'`,
  `errorCategory: 'non_conflict_error'` (recorded in history by `build()`, replay continues
  for user ops; for base ops `build()` rethrows).
- Strategy type: `ConflictStrategy = 'override' | 'align' | 'ask'`
  (`packages/praxrr-app/src/lib/server/pcd/conflicts/autoAlign/types.ts:3`), stored per
  database instance (`conflict_strategy`, default `'override'`). Meaning at replay time:
  `ask` ⇒ conflicts park as `conflicted_pending`; `override`/`align` ⇒ `conflicted`;
  `align` additionally force-aligns full-list mismatches; after `compile()`, `override`
  triggers automatic `overrideConflict` resolution (compiler.ts:56-137) which drops the old
  op and writes a replacement — recorded in history as further rows (`superseded`, new op's
  own batch), _after_ the `conflicted` rows the build wrote.
- `priorConflictReason` (loaded per-op from latest `conflicted`/`conflicted_pending` history,
  cache.ts build prologue) only affects `shouldLogConflict` log de-duping, never the status
  decision — verified in both gate functions. Dry-run predictions are therefore deterministic
  without it; pass it anyway for exact parity.

History read/write points:

- Write: `pcdOpHistoryQueries.create` (`packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts:105-124`);
  statuses `'applied' | 'skipped' | 'conflicted' | 'conflicted_pending' | 'error' | 'dropped' | 'superseded'`
  (history types :5-6).
- Read latest-per-op: `listLatestByDatabaseWithOps` / `listLatestConflictsByDatabase` (:137-201).
- Op rows: `pcdOpsQueries.listByDatabaseAndOrigin(databaseId, origin, { states })`
  (`packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:138-163`).

### 5.2 Is a dry-run replay possible against a sandbox cache without writing `pcd_op_history`?

**Yes, with one new piece of code.** The gate functions are pure: they read the passed-in
SQLite `Database` handle and return a decision object; all side effects (history insert,
op-state drop, logging) are performed by the caller in `PCDCache.build()`. So a dry replay is:

1. Take the sandbox cache's raw handle (`cache.getRawDb()`).
2. For each published user op (`listByDatabaseAndOrigin(dbId, 'user', { states: ['published'] })`,
   ordered as `loadAllOperations` orders them — `sequence ?? id`, tie-break filename/path,
   loadOps.ts:16-38), wrapped in a per-op `SAVEPOINT`:
   - record `before = raw.totalChanges`; `raw.exec(op.sql)`;
   - on success: `rowcount = raw.totalChanges - before`, call `evaluateValueGuardApply({...,
isUserOp: true, metadataJson: op.metadata, desiredStateJson: op.desired_state, ...})`;
   - on exception: call `evaluateValueGuardError({...})`;
   - translate the decision into a predicted record (status/reason/decision/rule);
   - if the decision says the op would be auto-dropped **and** it had already mutated the
     sandbox (`needsRebuild`, i.e. `auto_align_full_list`), `ROLLBACK TO` the savepoint so
     later ops see the same state the post-rebuild pull cache would give them. (Rowcount-0
     aligns changed nothing; rolling back is still harmless.)
3. Never call `pcdOpHistoryQueries.create`, `pcdOpsQueries.update`, or `setCache`.

⚠️ Do **not** reach this via `buildReadOnly({ layers: {…, user} })`: that path deliberately
skips guard evaluation entirely (cache.ts:298-320) and warn-skips failing ops, so it cannot
distinguish `conflicted` from `applied`. The dry replay must execute user ops itself, in
order, on the raw handle — sequential, because later guards read the state earlier ops left.

Published-op fingerprint for staleness checks: `computeStateHash(databaseId)`
(`packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts:102-113`) — published
`pcd_ops` rows only; used as the preview's from-state guard in §8.5.

---

## Finding 6 — Existing tests and harnesses to model new tests on

| Test                      | Path                                                                                                                                                                                           | What to reuse                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| buildReadOnly zero-writes | `packages/praxrr-app/src/tests/pcd/resolved/cacheBuildReadOnly.test.ts`                                                                                                                        | Temp PCD fixture (`createFixturePcdDir` :109-131: `deps/schema/ops` + `tweaks` files), `patchTarget` spies on `pcdOpsQueries.update` / `pcdOpHistoryQueries.create` asserting 0 calls (:223-247) — the direct model for AC3 |
| Ephemeral cache lifecycle | `packages/praxrr-app/src/tests/pcd/resolved/layers.test.ts`                                                                                                                                    | Patching `PCDCache.prototype.buildReadOnly`/`close`, registry non-registration assertions                                                                                                                                   |
| Sandbox isolation         | `packages/praxrr-app/src/tests/pcd/sandbox/withSandboxCache.test.ts`                                                                                                                           | "applies inside sandbox only / never mutates registered cache / closes on throw" assertion style                                                                                                                            |
| Import orchestration      | `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`; `packages/praxrr-app/src/tests/pcd/migration/managerImportOrchestration.test.ts`                                                | `__testOnly_setReadMigrationEntitySources` candidate stubbing, refresh/orphan expectations                                                                                                                                  |
| Real-git round trip       | `packages/praxrr-app/src/tests/pcd/ops/exportEntityYaml.test.ts`                                                                                                                               | `git()` helper (:37-55), bare remote + clone + push fixture, real `importBaseOps` into a fresh DB, cache assertions — **primary model for the preview==pull integration test**                                              |
| Local git fixtures        | `packages/praxrr-app/src/tests/pcd/localPathGitClone.test.ts`                                                                                                                                  | `createWorkingRepository` (:30-38): `git init --initial-branch=main`, test user config, seed commit; file:// and bare-remote patterns                                                                                       |
| Migrated app-DB harness   | `packages/praxrr-app/src/tests/pcd/snapshots/rollbackTestHelpers.ts`                                                                                                                           | `migratedTest` (:11-35: scratch base path + real migrations), `createTestDatabase` (:38-45), `insertOp` (:61-77), `publishedOpIds` (:80-86)                                                                                 |
| Route handler tests       | `packages/praxrr-app/src/tests/pcd/snapshots/rollbackRoutes.test.ts`                                                                                                                           | Invoking a route `GET` directly with `patchTarget(pcdManager, 'getById', …)` (:105-140) — model for the new endpoint's 200/400/404 tests                                                                                    |
| Value-guard gate          | `packages/praxrr-app/src/tests/pcd/migration/valueGuardGate.test.ts`                                                                                                                           | Decision-table expectations for `evaluateValueGuardApply/Error`                                                                                                                                                             |
| Legacy changes route      | `packages/praxrr-app/src/tests/base/localPathGitFallbackRoutes.test.ts`                                                                                                                        | Existing `incomingChanges` response-shape assertions (:59-74)                                                                                                                                                               |
| Browser e2e (optional)    | `packages/praxrr-app/src/tests/e2e/helpers/sync.ts` (`pullChanges` :11), `packages/praxrr-app/src/tests/e2e/helpers/conflicts.ts` (`expectConflict`/`alignConflict`/`overrideConflict` :70-99) | Only if a Playwright spec is added; e2e needs a running server + PAT test repo, so it is not part of the required proof                                                                                                     |

Test runner: `deno task test <alias|path>` (aliases in `scripts/test.ts`); new tests should
live under `packages/praxrr-app/src/tests/pcd/incoming/` so they run with the unit suite.

---

## Finding 7 — Concurrency and safety

- **No per-database pull lock exists.** Mutual exclusion today is only the job-queue dedupe
  key `pcd.sync:{databaseId}` (`pcdSyncQueue.ts:25-27, 44-79`): manual and scheduled syncs
  for the same database coalesce, but nothing stops a preview from racing a running sync,
  and `pcdManager.sync` itself takes no lock. The per-database FIFO lock that does exist,
  `withDatabaseOverrideLock` (`packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts:104-141`),
  guards conflict overrides only; preview must not take it (it would block user edits for the
  whole multi-cache build).
- **Race consequence**: mid-preview, a pull can rewrite base ops (`importBaseOps`), swap the
  registered cache, and append history. A preview straddling that boundary could diff
  pre-pull current state against post-pull base ops and invent conflicts. Mitigation (§8.5):
  capture `computeStateHash(databaseId)` before building anything and again after the diff;
  on mismatch return `409 { code: 'preview_stale' }` and let the UI re-run. Additionally, if
  `jobQueueQueries.getByDedupeKey('pcd.sync:' + id)?.status === 'running'`, fail fast with
  `409 { code: 'sync_in_progress' }` instead of doing the work.
- **Fetching without merging is safe and already the norm.** `fetch()` =
  `execGitSafe(['fetch', '--quiet'], repoPath)` (git/write.ts:439-442) — but note it
  _swallows failures_ (`execGitSafe` returns null), so `getIncomingChanges` can report stale
  data after a failed fetch. The preview needs a **strict** fetch (new helper, §8.2):
  `git fetch --quiet --no-tags origin +refs/heads/<branch>:refs/remotes/origin/<branch>`
  via throwing `execGit` (`git/exec.ts:10-38`). This updates exactly one remote-tracking ref:
  never `HEAD`, never the index, never the working tree, and `--no-tags` prevents even
  tag creation. Branch name comes from `getBranch()` and must be validated
  (`/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/`, no leading `-`, no `..`) before interpolation.
- **Temp-dir hygiene**: create with `Deno.makeTempDir({ prefix: 'praxrr-incoming-preview-' })`
  (precedent: `backups/restore.ts:188`, tests throughout), and always
  `Deno.remove(dir, { recursive: true }).catch(() => {})` in a `finally` — including on
  deserialize/dependency failures. Caches are closed in `finally` too (`withSandboxCache` /
  `withEphemeralCache` pattern). A crashed process can leak a temp dir; prefix makes leaks
  identifiable and harmless (nothing registers them; a startup sweep is optional, not required).
- **Never-call list for preview code** (each mutates app DB or registry):
  `PCDCache.build()`, `compile()`, `importBaseOps()`, `writeOperation()` outside capture
  context, `pcdOpsQueries.create/update`, `pcdOpHistoryQueries.create`, `setCache`,
  `snapshotService.createAutoSnapshot`, `databaseInstancesQueries.updateSyncedAt`,
  `refreshLocalRepositoryClone`, `pull()`, `checkout()`.
- Read-only DB access (`pcdOpsQueries.list*`, history latest-conflict reads) is safe under
  WAL while a sync writes; the state-hash guard above covers the resulting consistency.
- Diverged history: if local is ahead (`commitsAhead > 0`), `git pull` may merge or fail —
  preview assumes a fast-forward. Surface `commitsAhead` in the response and let the UI warn
  rather than pretending certainty (risk R3).

---

## 8. Design

### 8.1 Overview

```
GET /api/v1/pcd/{databaseId}/incoming/preview
  └─ previewIncoming(databaseId)                       (new: $pcd/incoming/preview.ts)
       1. resolve instance; reject local-path sources (available:false)
       2. sync-in-progress check (job queue dedupe key)
       3. stateHash₀ = computeStateHash(databaseId)
       4. strict fetch → origin/<branch>; incoming = getIncomingChanges(local_path)
          └─ no updates → empty preview (still returns conflictStrategy + hashes)
       5. tempDir = makeTempDir; extractTreeAtRef(origin/<branch>) → tempDir/tree
       6. syncDependencies(tempDir/tree)               (incoming schema, temp only)
       7. incomingCache = buildIncomingCache(tempDir/tree, exclude = refresh ∪ orphans)
          withScopedCache(incomingCache):
            for each candidate (import order): deserialize in CAPTURE mode
            → SQL applied to incomingCache raw DB; ops captured in memory only
       8. currentBase = withBaseOnlyCache(databaseId)  (ephemeral)
          sections = diffAllFamilies(currentBase, incomingCache)   ← upstream diff
       9. predictedConflicts = replayUserOpsDry(incomingCache, databaseId, strategy)
      10. stateHash₁ = computeStateHash(databaseId); mismatch → 409 preview_stale
      11. finally: close caches, remove tempDir
```

Diff choice (deliberate): `sections` diffs **current base-only** (schema+base+tweaks,
`withBaseOnlyCache`) against **incoming base-only** (extracted tree materialised the same
way). This is exactly "what the pull will change upstream", it is unaffected by user-op
replay, and AC1 becomes an exact equality (§9, T2). User overrides enter through
`predictedConflicts`, not by polluting the upstream diff. The final resolved state after a
real pull additionally applies surviving user ops on top; entities fully masked by a
surviving override still appear in `sections` (upstream did change them), with their
override's fate spelled out in `predictedConflicts`. This matches the issue's framing
("which profiles or CFs a pull will change, and which of their local overrides will conflict").

### 8.2 New/changed server modules

1. **`packages/praxrr-app/src/lib/server/pcd/incoming/preview.ts`** (new) —
   `export async function previewIncoming(databaseId: number): Promise<IncomingPreview>`.
   Owns orchestration above; logs timing via `logger` (source `'IncomingPreview'`).
2. **`packages/praxrr-app/src/lib/server/pcd/incoming/extract.ts`** (new) —
   - `export async function fetchRemoteBranchStrict(repoPath: string, branch: string): Promise<void>`
     (throwing `execGit` with the explicit refspec from Finding 7);
   - `export async function extractTreeAtRef(repoPath: string, ref: string, destDir: string): Promise<void>`
     — `Deno.Command('git', { args: ['archive', '--format=tar', ref] })` piped into
     `Deno.Command('tar', { args: ['-x', '-C', destDir] })`; throws on non-zero exit of either;
   - `export async function listTreeFiles(repoPath: string, ref: string, prefix: string): Promise<string[]>`
     — `git ls-tree -r --name-only <ref> -- <prefix>` for the export-ignore cross-check:
     extracted `entities/` file count must equal the tree listing, else throw
     `IncomingPreviewUnavailableError('archive_export_ignore')`.
3. **`packages/praxrr-app/src/lib/server/pcd/incoming/replay.ts`** (new) —
   `export async function replayUserOpsDry(cache: PCDCache, databaseId: number, conflictStrategy: ConflictStrategy): Promise<{ predictedConflicts: PredictedConflict[]; predictedErrors: PredictedError[] }>`
   implementing Finding 5.2 with per-op savepoints. Predicted record (§8.5) is derived from
   the gate decision: `conflicted`/`conflicted_pending` → kind `conflict`;
   `shouldAttemptAutoDrop` → kind `aligned`, `predictedStatus: 'dropped'`,
   `conflictReason: 'aligned'`; gate `error` decisions → `predictedErrors`.
4. **`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`** (change) — op **capture mode**:
   extend the existing `WriteContextFrame` (writer.ts, AsyncLocalStorage stack) with an
   optional `capture: CapturedBaseOp[]`, and export
   `withBaseOpCapture<T>(fn: () => Promise<T>): Promise<{ result: T; captured: CapturedBaseOp[] }>`.
   In `writeOperationsFromSqlOperations`, when capture is active for a repo-import base
   write: skip `pcdOpsQueries.create/update` and `cancelOutCreate`'s DB write, keep metadata/
   desired-state serialisation and content-hash computation in memory, still apply SQL to
   the scoped cache (the existing fast-path raw-`exec`), never compile. Everything outside
   capture mode is byte-identical behaviour; guard it with the existing characterization
   tests (`buildScoringOpsCharacterization.test.ts`, import tests).
   `CapturedBaseOp = { filename: string; sequence: number; sql: string; metadataJson: string | null; desiredStateJson: string | null }`.
5. **`packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`** (change) — export the
   two pure helpers the preview reuses: `buildPublishedRepoBaseOpIndex(databaseId)` and
   `matchingPublishedRepoBaseOpIds(index, candidate)` (today module-private, :130-221; the
   `__testOnly_` wrappers already acknowledge them as seams). No behaviour change.
6. **Route** (new): `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/incoming/preview/+server.ts`
   — `GET`, copying the rollback-preview route's id parsing/404 shape
   (rollback preview `+server.ts:8-32, 41-77`).

No change to `PCDCache`, `loadOps`, gate, or registry code is required.

### 8.3 Building the incoming base cache (orphan/refresh exclusion)

```ts
const candidates = (await readMigrationEntitySources(treePath)).candidates; // throw on issues, like import
const index = buildPublishedRepoBaseOpIndex(databaseId);
const refreshIds = new Set(
  candidates.flatMap((c) => matchingPublishedRepoBaseOpIds(index, c))
);
const orphanIds = new Set(
  pcdOpsQueries
    .listByDatabaseAndOrigin(databaseId, 'base') // no state filter: markBaseOrphaned sweeps any state
    .filter(
      (op) =>
        op.source === 'repo' && !refreshIds.has(op.id) && !isExportBatchOp(op)
    )
    .map((op) => op.id)
);
const incomingCache = new PCDCache(treePath, databaseId);
await incomingCache.buildReadOnly({
  layers: new Set(['schema', 'base', 'tweaks']),
  excludeBaseOpIds: new Set([...refreshIds, ...orphanIds]),
});
```

- `isExportBatchOp` mirrors the `markBaseOrphaned` exemption
  (`json_extract(metadata, '$.export_batch') IS NOT 1`, pcdOps.ts:237-256): parse metadata
  JSON, exempt only `export_batch === true`; malformed metadata stays sweepable, as in SQL.
- Then, under `withScopedCache(databaseId, incomingCache, …)` + per-candidate
  `withRepoImportWriteContext({ filenamePrefix: 'entities/<relativePath>',
sequenceStart: 4_000_000_000 + i * 10_000, maxOperations: 10_000, lastSeenInRepoAt: previewSeenAt })`
  - `withBaseOpCapture`, call `candidate.deserialize({ databaseId, cache: incomingCache,
layer: 'base', data: candidate.portable })` in `sortMigrationCandidatesByImportOrder`
    order, with import's skip logic (`hasBaseEntityByStableIdentity`: refresh candidates check
    the scoped cache, new candidates check `getRegisteredCache(databaseId) ?? incomingCache`).
    A deserialize failure throws → whole preview fails closed (500), exactly as a failed
    import fails the pull. No partial preview.
- After this loop, `incomingCache` holds schema(incoming) + base(incoming) + tweaks(incoming)
  — the same content the pull's final `compile()` would start from, minus user ops.
- Note the asymmetry vs. pull and why it's safe: pull rewrites ops in place and orphans the
  rest _in the DB_, then compiles. Preview excludes the same op ids from an ephemeral cache
  and re-derives the same SQL in memory. The state-hash guard (§8.5) ensures the DB op set
  the exclusion was computed from is the one still current at response time.

### 8.4 Entity diff + conflict replay order

```ts
const sections = await withBaseOnlyCache(databaseId, (currentBase) =>
  diffAllFamilies(currentBase, incomingCache)
); // sequential, rollback/preview.ts:23-29 pattern
const { predictedConflicts, predictedErrors } = await replayUserOpsDry(
  incomingCache,
  databaseId,
  instance.conflict_strategy
);
```

(current-first argument order per Finding 3.5.) `diffAllFamilies` is module-private in
rollback/preview.ts:23-29 — either export it or replicate the 6-line sequential loop in
`incoming/preview.ts`; prefer exporting it (single implementation, rollback tests cover it).

### 8.5 API contract

OpenAPI first (`packages/praxrr-api/openapi.json`), then `deno task generate:api-types`.

Path: `GET /pcd/{databaseId}/incoming/preview`, `operationId: previewIncomingPcdChanges`,
tag `PCD Databases`. Parameters: `databaseId` (path, integer, required).

New schemas (reusing `RollbackSection`, `RollbackSummary`, `EntityChange`, `FieldChange`,
`PcdErrorResponse` unchanged):

```jsonc
// IncomingCommit — mirrors git/types.ts Commit (:35-43)
{ "type": "object", "required": ["hash","shortHash","message","author","authorEmail","date","files"],
  "properties": { "hash": {"type":"string"}, "shortHash": {"type":"string"}, "message": {"type":"string"},
    "author": {"type":"string"}, "authorEmail": {"type":"string"}, "date": {"type":"string"},
    "files": {"type":"array","items":{"type":"string"}} } }

// PredictedConflict
{ "type": "object",
  "required": ["opId","kind","predictedStatus","conflictReason","strategy"],
  "properties": {
    "opId": {"type":"integer"},
    "entityType": {"type":"string","nullable":true},   // from op metadata.entity
    "entityName": {"type":"string","nullable":true},   // from op metadata.name
    "operation": {"type":"string","nullable":true,"enum":["create","update","delete",null]},
    "kind": {"type":"string","enum":["conflict","aligned"]},
    "predictedStatus": {"type":"string","enum":["conflicted","conflicted_pending","dropped"]},
    "conflictReason": {"type":"string"},               // guard_mismatch|duplicate_key|missing_target|aligned
    "decision": {"type":"string","nullable":true},     // ValueGuardApplyDecision, e.g. rowcount_zero_conflict
    "autoAlignRule": {"type":"string","nullable":true},
    "strategy": {"$ref":"#/components/schemas/ConflictStrategy"} } }  // 'override'|'align'|'ask' — new enum schema

// PredictedError
{ "type": "object", "required": ["opId","error"],
  "properties": { "opId": {"type":"integer"}, "error": {"type":"string"} } }

// IncomingPreview
{ "type": "object",
  "required": ["databaseId","available","hasUpdates","commitsBehind","commitsAhead","commits",
               "conflictStrategy","sections","summary","predictedConflicts","predictedErrors",
               "currentStateHash","currentHead","incomingHead"],
  "properties": {
    "databaseId": {"type":"integer"},
    "available": {"type":"boolean"},
    "unavailableReason": {"type":"string","nullable":true},  // 'local_source' when available=false
    "branch": {"type":"string","nullable":true},
    "hasUpdates": {"type":"boolean"},
    "commitsBehind": {"type":"integer"},
    "commitsAhead": {"type":"integer"},
    "commits": {"type":"array","items":{"$ref":"#/components/schemas/IncomingCommit"}},
    "conflictStrategy": {"$ref":"#/components/schemas/ConflictStrategy"},
    "sections": {"type":"array","items":{"$ref":"#/components/schemas/RollbackSection"}},
    "summary": {"$ref":"#/components/schemas/RollbackSummary"},
    "predictedConflicts": {"type":"array","items":{"$ref":"#/components/schemas/PredictedConflict"}},
    "predictedErrors": {"type":"array","items":{"$ref":"#/components/schemas/PredictedError"}},
    "currentStateHash": {"type":"string","nullable":true},  // computeStateHash at preview time
    "currentHead": {"type":"string","nullable":true},
    "incomingHead": {"type":"string","nullable":true} } }
```

Responses: `200` IncomingPreview · `400` invalid `databaseId` · `404` database not found ·
`409` `{ error, code: 'sync_in_progress' | 'preview_stale' }` (extend `PcdErrorResponse`
usage; `code` as an additional optional property on the error schema) ·
`502` `{ error, code: 'fetch_failed' | 'incoming_unavailable' }` for strict-fetch/archive/
dependency failures. Fail closed: never return a partial preview built from a stale ref or
a half-materialised tree.

Server TS types: `packages/praxrr-app/src/lib/server/pcd/incoming/types.ts` mirroring the
schemas (`IncomingPreview`, `PredictedConflict`, `PredictedError`), reusing
`RollbackSection`/`RollbackSummary` from `$pcd/snapshots/rollback/types.ts` so the wire
shape and `SnapshotDiff` props stay identical.

### 8.6 UI integration (changes page)

`packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte`:

1. `SnapshotDiff.svelte` gains optional props with rollback-identical defaults:
   `export let desiredLabel: string = 'After restore';`
   `export let emptyMessage: string = 'This snapshot matches the current PCD state — restoring it would make no changes.'`
   Snapshot detail page keeps current rendering untouched.
2. In the Incoming Changes section (:706-790), when `incomingChanges?.hasUpdates`, add a
   secondary "Preview changes" button beside Pull. On click (lazy — the preview fetches and
   builds caches, so it must not ride along with `fetchChanges()`):
   `GET /api/v1/pcd/${data.database.id}/incoming/preview`, storing
   `incomingPreview: components['schemas']['IncomingPreview'] | null`, `previewLoading`,
   with `alertStore.add('error', …)` on failure and a `warning` + auto-retry affordance on
   `409 preview_stale`.
3. Render, below the commits table:
   - summary line (reuse the summary chips via `SnapshotDiff`);
   - `<SnapshotDiff sections={incomingPreview.sections} summary={incomingPreview.summary} desiredLabel="After pull" emptyMessage="Pulling would make no entity changes." />`;
   - predicted-conflicts list (plain table/list, no modal): entity type + name, op `#id`,
     operation, reason, and a strategy badge whose label is derived from `strategy`:
     `override` → "Will conflict — auto-overridden on pull", `align` → kind `aligned` shows
     "Will auto-align (local change dropped)", `ask` → "Will conflict — needs your decision".
     `predictedErrors` rendered as warning rows.
   - if `commitsAhead > 0`: `alertStore`-style inline warning that the local branch has
     diverged and the pull itself may not fast-forward.
4. After a successful pull (`handlePull`), clear `incomingPreview` (it described the
   pre-pull state); `fetchChanges()` already refreshes the commit list.

### 8.7 What is deliberately not reused

- `withSandboxCache` (sandbox/withSandboxCache.ts:62-173): scoring-edit shaped
  (`Map<string, ProfileEdit>` in, `SandboxReport` out), builds from `local_path` + current DB
  ops — wrong inputs for an extracted tree. The new code follows its lifecycle discipline
  (unregistered, always closed) without using the function.
- `withSnapshotCache`: replays a _DB op id set_; incoming base ops don't exist as DB rows
  yet — that's the whole problem (§8.3).

---

## 9. Test plan (proving the acceptance criteria)

New directory `packages/praxrr-app/src/tests/pcd/incoming/`. Run: `deno task test` with the
new paths (plus regression: existing `pcd/ops/importBaseOps`, `pcd/resolved`, writer tests).

**T1 — Service integration, preview == pull (AC1), no writes (AC3).**
Model: `exportEntityYaml.test.ts` fixture (bare remote, clone, test git identity) +
`migratedTest`/`createTestDatabase` from rollbackTestHelpers.
Seed upstream commit A: CF `Test Format` (description `base desc`), QP `Profile A`, regex
`Regex A`. Link-equivalent state: `database_instances` row → local clone at A;
`importBaseOps(dbId, localPath)` + `compile`. Add a published user op (via the real entity
update handler or `insertOp` with guarded SQL + metadata/desired_state) changing CF
description `base desc → my desc`. Push upstream commit B: CF description `base desc →
upstream desc`, QP renamed/added, regex deleted.
Call `previewIncoming(dbId)`. Assert:

- `hasUpdates`, `commitsBehind = 1`, `incomingHead` = B;
- `sections`: CF `Test Format` = `update` (fields show `base desc → upstream desc`),
  new QP = `create`, `Regex A` = `delete` — and, by action/name/fields, **exactly equals**
  `diffAllFamilies(baseOnly(pre-pull), baseOnly(post-pull))` computed after step T2
  (capture the pre-pull base-only diff inputs before syncing);
- `predictedConflicts` contains the CF user op with `conflictReason: 'guard_mismatch'`,
  `strategy` = the instance's strategy;
- **AC3**: deep-equal snapshot of `pcdOpsQueries.listByDatabase(dbId)` before/after preview,
  `pcdOpHistoryQueries.listByDatabase(dbId).length` unchanged, `git rev-parse HEAD` and
  `git status --porcelain` of the clone unchanged (only `origin/main` advanced).

**T2 — Predicted conflicts == recorded conflicts (AC2), per strategy.**
Continue T1: run the real pull (`pcdManager.sync(dbId)` or `importBaseOps` + `compile`).
Capture `maxHistoryId` before the pull; afterwards collect history rows with `id > maxHistoryId`
for the user op. Assert the first blocking row matches the prediction:

- `override`: row `status='conflicted'`, `conflict_reason='guard_mismatch'` in the pull's
  build batch (subsequent auto-override `superseded` rows are expected and excluded from the
  comparison — document this filter in the test);
- `ask` (set `conflict_strategy='ask'`): `status='conflicted_pending'`, same reason;
- `align` scenario (user desired value already equals upstream, rowcount-0 auto-align case):
  prediction kind `aligned`/`dropped`/`aligned`, and after pull the op row is
  `state='dropped'` with a `dropped`/`aligned` history row.
  Also assert post-pull base-only diff == T1 preview sections (completes AC1), and post-pull
  resolved CF description reflects the strategy outcome.

**T3 — Writer capture mode.** Unit test: run a candidate `deserialize` under
`withScopedCache` + `withRepoImportWriteContext` + `withBaseOpCapture` against a fixture DB;
assert captured ops are returned with deterministic filenames/sequences, `pcd_ops` row count
unchanged, scoped cache contains the entity, registered cache untouched.

**T4 — Route.** Model on `rollbackRoutes.test.ts`: patch `pcdManager.getById` and the
preview service; assert 200 payload passthrough, 400 on `databaseId='x'`, 404 on unknown
database, 409 body shape for `sync_in_progress`.

**T5 — Edge cases.** (a) No incoming commits → `hasUpdates:false`, empty sections/conflicts,
and proof no temp extraction happened (fetch still called). (b) Local-path source →
`available:false, unavailableReason:'local_source'`. (c) Upstream deletes an entity the user
also deleted → predicted `aligned` (missing-target auto-align), not a conflict.
(d) `preview_stale`: mutate a user op between hash captures (stub `computeStateHash` or
insert an op mid-flight via a hooked candidate) → 409.

**T6 — Frontend.** No Svelte component-test harness exists for this page; cover by
`deno task check:client` type-checking + the route/service tests. Optional Playwright spec
reusing `tests/e2e/helpers/sync.ts`/`conflicts.ts` if the e2e environment is available.

Regression gate for the whole change: `deno task test pcd/ops pcd/resolved pcd/migration`
(existing import/writer/gate suites), `deno task check`, `deno task lint`.

---

## 10. Risks and recommended choices

- **R1 — Deserializer capture is the only invasive change** (writer hot path).
  Choice: implement capture as an opt-in AsyncLocalStorage frame beside the existing
  repo-import context; outside capture mode the writer must be behaviour-identical.
  Gate on existing characterization tests. Rejected alternative: running `importBaseOps`
  against a throwaway database id and deleting rows afterwards — transiently writes
  `pcd_ops`/`pcd_op_history`, can trigger history recorders and auto-override, and a crash
  leaks rows; it violates AC3 in spirit and letter during the run.
- **R2 — `git archive` export-ignore/submodules** could silently drop entity files.
  Choice: `ls-tree` cross-check, fail closed (Finding 7/§8.2). A working-tree checkout or
  `git worktree add` was rejected: worktree metadata lives in the user's `.git` and a crash
  leaves a registered stale worktree; archive touches nothing.
- **R3 — Preview assumes the pull fast-forwards.** `getIncomingChanges` already makes this
  assumption; a diverged local branch can make `git pull` merge or fail after a "clean"
  preview. Choice: return `commitsAhead`, warn in UI, do not attempt merge simulation.
- **R4 — Post-pull auto-override (strategy `override`)** writes replacement ops after the
  compile whose history AC2 compares against. Predictions match the pull's _build-batch_
  conflict rows, not necessarily the op's final latest-history row. Choice: define the AC2
  comparison exactly that way (T2) and label the UI badge "auto-overridden on pull" so the
  user isn't surprised that the conflict resolves itself.
- **R5 — Schema-dependency change in the incoming commit.** Sandbox uses incoming schema
  (via `syncDependencies` on the temp tree); if upstream renames entity tables, resolved
  readers may throw. Choice: let it fail closed (502/`incoming_unavailable`) rather than
  falling back to the current schema and printing a confident wrong diff.
- **R6 — Cost.** A preview runs: 1 fetch, 1 dependency sync (usually no-op), 2-3 cache
  builds, full candidate deserialization, O(n) entity reads ×2 caches. Comparable to one
  pull minus the writes. Choice: no cross-request caching (any cache key would need the
  state hash + both head SHAs; the hash guard already makes staleness explicit) — add a
  `timingMs` log like `withSandboxCache` does, and keep the UI lazy (button-triggered).
- **R7 — Security.** Refs/paths are built from the stored branch + `databaseId`; branch is
  validated before use in the fetch refspec, `databaseId` is parsed as a positive integer
  (route pattern), temp dirs are created under the OS temp dir with a fixed prefix, and no
  user-supplied string reaches a shell (all git via `Deno.Command` arg arrays, per
  `git/exec.ts`). The endpoint is read-only and inherits the app's existing auth middleware;
  it must not accept a URL/ref parameter.
- **R8 — Arr semantics.** No Arr instance is contacted and no Arr-specific mapping is
  inferred: entity families come from `rollbackEntityTargets()` (which is already
  Arr-explicit via `PER_ARR_READERS`), satisfying the cross-Arr validation checklist.

## 11. Implementation order

1. OpenAPI: add path + `IncomingPreview`/`PredictedConflict`/`PredictedError`/`IncomingCommit`/`ConflictStrategy` schemas; `deno task generate:api-types`.
2. `incoming/extract.ts` (strict fetch, archive extract, ls-tree check) + git unit tests.
3. Writer capture mode (+ `importBaseOps` helper exports) + T3.
4. `incoming/replay.ts` dry replay + gate-level tests.
5. `incoming/preview.ts` orchestration (export `diffAllFamilies` from rollback/preview.ts) + T1/T2/T5.
6. Route `api/v1/pcd/[databaseId]/incoming/preview/+server.ts` + T4.
7. `SnapshotDiff` props + changes-page UI (§8.6); `deno task check`, `deno task lint`.
8. Full test pass (§9 regression gate).
