The graphify graph.json is not actually populated in this worktree (graphify reports it missing), but the five verification reports already carry exhaustive `file:line` mirror facts, and I confirmed the ROADMAP checklist anchor (`ROADMAP.md:259`) and the real `deno.json` task names. Here is the plan.

# plan.md — Drift Detection Dashboard (#15) Implementation DAG

> Authoritative source: `docs/plans/drift-detection/design.md`. This plan is the ordered, deterministic execution DAG. Every task lists its mirror template as `file:line` drawn from the five verification reports. **SHARED** = edits a file others also touch (must be serialized within its stage); **NEW** = creates a file (parallelizable with sibling NEW tasks).
>
> Repo root here = `/home/yandy/.claude-worktrees/praxrr-drift-detection`. All app paths are under `packages/praxrr-app/src/lib/…` unless noted.

---

## Design corrections applied

Every `designCorrection` from the 5 verification lanes, and how this plan accounts for it. **No lane found the design fully accurate** — all five reported at least one correction.

**Lane 1 — Preview engine / rate-limit / concurrency**

- **DC-1 `processBatches` arg order (BLOCKING).** Design §5 L271/L49 call `processBatches(chunk, CONCURRENCY_LIMIT=3, checkAndPersist)`. Real signature is `processBatches(items, processor, concurrency)` (`processor.ts:247`). → **S2-T1** calls `processBatches(chunk, checkAndPersistInstance, 3)`. Also: `processBatches` uses `Promise.all` per batch (`processor.ts:250-256`) with no per-item isolation, so **S1-T3** must guarantee `checkAndPersistInstance` never throws (load-bearing precondition, tested in **S1-T9**).
- **DC-2 no top-level `preview.customFormats`.** CF/QP EntityChange arrays live *inside* `preview.qualityProfiles` (`.customFormats`, `.qualityProfiles` — `types.ts:44-45`); delay `.profile` (`:50`); media `.naming`/`.qualityDefinitions`/`.mediaSettings` (`:55-57`); metadata `.profile` (`:62`). → **S1-T1** `aggregateDrift` reads one level deeper with null-guards (`preview.qualityProfiles?.customFormats`, …). Guarded in **S1-T4**.
- **DC-3 `allSectionsErrored` source.** Top-level section fields are `null` for errored, skipped, AND not-configured alike (`orchestrator.ts:167-188,295-299`); the returned `sectionOutcomes` strips `result`. → **S1-T1** derives `allSectionsErrored` from `preview.sectionOutcomes[]` (`error !== null` vs `skipped`) intersected with `availableSections`, never from a null section field. Tested in **S1-T4**.

**Lane 2 — Arr fetch / version gating / instance listing**

- **DC-4 `getSystemStatus` is not a bare export.** It is an instance method on `BaseArrClient` (`base.ts:72`), not an importable binding. → **S1-T1** authors the `DriftCheckDeps.getSystemStatus` wrapper itself: build client → call → close.
- **DC-5 timeout/retries are client-build options, not call options.** `getSystemStatus()` takes zero args; set `{timeout:5000, retries:0}` at `getArrInstanceClient(...)` build time (`base.ts:27-30`, `http/client.ts:18-19,42,45,49`). → **S1-T1** heartbeat builds a dedicated 5s/0-retry client per beat, then `client.close()`.
- **DC-6 `resolveAvailableSections` double-fetch/mis-arg.** `detectAndRecordArrVersion(instanceId, arrType, client)` takes a **client** and re-calls `getSystemStatus` internally (`instanceCompatibility.ts:28-52`); `resolveSyncSectionAvailability` is pure and needs only the version string. → **S1-T1** takes `version` from the single heartbeat, persists it via `arrInstancesQueries.setDetectedVersion` (or reuses the *same* open heartbeat client for `detectAndRecordArrVersion` before close — no second round-trip), then builds the section Set purely.
- **DC-7 availability is not boolean.** `resolveSyncSectionAvailability` returns `ArrFeatureAvailability{status: 'available'|'degraded'|'unavailable'}` (`compatibility.ts:52-59`). → **S1-T1** includes a section iff `status !== 'unavailable'` (degraded counts as present). Tested in **S1-T5**.
- **DC-8 `isSyncPreviewArrType` is route-private.** Defined un-exported in `routes/api/v1/sync/preview/+server.ts:41`. → **S0-T9** promotes it to `$sync/preview/types.ts` as an exported predicate and updates the route to import it; drift service + drift routes import the shared version.
- **DC-9 `getEnabled()` orders by name, not id.** `arrInstances.ts:342-344` → cursor-by-id chunking is inconsistent. → **S2-T1** re-sorts the `getEnabled()` result by `id` in memory before applying `id > cursor` + slice.
- **DC-10 (minor) heartbeat success carries `appName`.** `{ok:true, appName, version}` (`base.ts:72`). → **S0-T4** `HeartbeatResult` may include optional `appName`; **S1-T3** reuses it for the notification embed instead of re-fetching. Non-blocking.

**Lane 3 — App DB / job queue / nav**

- **DC-11 `JobHandler` is not generic.** `JobHandler = (job) => Promise<JobHandlerResult>` (`queueTypes.ts:137`); `JobHandler<'drift.check'>` is a type error and `job.payload` is untyped. → **S2-T1** types the handler as bare `JobHandler` and coerces cursor fields (`Number(job.payload.cursor)`, `String(job.payload.sweepStartedAt)`) mirroring `pcdSync.ts:9`. Adding `DriftCheckJobPayload` to `JobPayloadByType` (**S0-T7**) only types the `upsertScheduled` input.
- **DC-12 nav `iconKey` is a string via `NAV_ICON_MAP`; `Activity` is not registered.** `GitCompare` is. Fields are `groupId`/`arrScope`, plus required `id`/`mobilePriority`/`emoji`. → **S4-T5** uses `iconKey:'GitCompare'` (no iconMap edit), `order:4`.
- **DC-13 `db.transaction` is async; `db.exec` takes no params.** `db.ts:213` (async), `:117` (no-param exec). → **S0-T6** upsert is `await db.transaction(() => db.execute(upsertSql, ...params))` with `INSERT … ON CONFLICT(arr_instance_id) DO UPDATE`.

**Lane 4 — OpenAPI contract-first / UI components**

- **DC-14 `LiveDiffPanel` cannot be reused wholesale.** It is a self-contained fetcher hitting the *resolved-config* diff endpoint, single-entity (`LiveDiffPanel.svelte:22-26,84`). → **S4-T1** extracts the presentational field-table + create/delete banners (`:232-282`) + `fieldChangeDisplay.ts` into a shared dumb component fed a precomputed `DriftEntityChange[]`; **S4-T3** consumes it. No mounting of `LiveDiffPanel` as-is.
- **DC-15 settings panels use form-actions, not client-fetch-PUT + dirty store.** Every existing settings panel uses `<form method="POST" action="?/x" use:enhance>`. → **S4-T4** implements a `?/updateDriftSettings` form action in `+page.server.ts` (validate → `driftSettingsQueries.update` → `scheduleDriftCheck()` server-side) for convention consistency; the `PUT /api/v1/drift/settings` route (**S3-T7**) is kept for API/contract completeness. Dirty store is **not** wired into this two-field panel (avoids a novel pattern).
- **DC-16 nav entry required fields.** Must include `id:'overview.drift'`, `emoji`, `mobilePriority`, `arrScope:scopeAll`, `groupId:ensureGroupId('overview')`, `order:4`, `hasChildren:false`. → captured in **S4-T5**.
- **DC-17 `EmptyState` requires a CTA.** All of `icon/title/description/buttonText/buttonHref` mandatory; always renders a link. → **S4-T2** supplies `buttonText:'Add Arr instance'`, `buttonHref:'/arr'`.

**Lane 5 — PCD cache readiness / notifications**

- **DC-18 `getCache()` does NOT throw — a missing cache is a silent skip.** `registry.getCache` is a `Map.get` returning `undefined` (`registry.ts:23`); syncers `warn + continue` (`qualityProfiles/syncer.ts:501-517`, siblings), yielding a **false `in-sync` with no section error**. The design's "getCache throws" framing is wrong; the readiness gate is *more* necessary. → **S1-T1** `isPcdCacheReady` is a proactive pre-check (not a try/catch), and the §4.2/§9 wording is treated as "silent skip → false in-sync → proactive gate required."
- **DC-19 `isPcdCacheReady` must enumerate all referenced DBs with the `?.` guard.** `getCache(id)?.isBuilt() === true` (undefined guard); there is no single instance→databaseIds helper — enumerate every `databaseId` from the instance's per-section sync selections (`arrSyncQueries.getQualityProfilesSync(instanceId).selections[].databaseId` + delay/media/metadata `syncConfig.databaseId` + TRaSH hydrations; `qualityProfiles/syncer.ts:457-468`, `handler.ts:52-61`) and require **all** built; dominant failure is `undefined`, not `isBuilt()===false`. → **S1-T1** implements the full enumeration.
- **DC-20 `NotificationTypes` const (server) is inert.** The load-bearing wiring is (a) the `notificationTypes[]` entry in `shared/notifications/types.ts:16` and (b) the `notify('drift.detected').send()` call. → **S2-T6** is the load-bearing edit; **S2-T7** (server const) is optional convention.
- **DC-21 do not copy `rename`'s direct-notifier emit.** `rename/processor.ts:84-85` bypasses `NotificationManager` (no `enabled_types` filter, no manager history). The `.send()` path (`builder.ts:87 → NotificationManager.notify`) is correct and required for opt-in filtering. → **S1-T3** uses inline `notify('drift.detected')…send()`; `definitions/drift.ts` (**S2-T8**) is optional convenience only.

---

## Stage 0 — Foundation (SERIALIZED; shared-file edits + core types)

> Everything downstream depends on these. Run in listed order; the SHARED edits (S0-T2, S0-T7, S0-T8, S0-T9) touch files nothing else in this stage touches, so the NEW files (S0-T1, S0-T4, S0-T5, S0-T6) may be authored in parallel, but the whole stage completes before Stage 1.

### S0-T1 — Create drift tables migration `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/db/migrations/20260709_create_drift_tables.ts`
- **template to mirror:** `migrations/20260228_create_pcd_snapshots.ts:10-38` (multi-statement `up` string: CREATE TABLE + seed in one `;`-separated block); interface at `migrations.ts:74-80`; version pattern `20260708_add_arr_instance_detected_version.ts:15`.
- **dependsOn:** —
- **what:** Export `migration` with `version: 20260709`, pure-DDL `up` = both `CREATE TABLE`s (`drift_check_settings` singleton `CHECK(id=1)` + seed `INSERT`, `drift_instance_status` PK==FK `ON DELETE CASCADE`, `arr_type` CHECK, status/reason CHECKs, `changes TEXT NOT NULL DEFAULT '[]'`) exactly per design §3 SQL; `down` = both `DROP TABLE`s. No `afterUp`.
- **acceptance:** File type-checks; SQL matches design §3 verbatim (CHECK constraints present).

### S0-T2 — Register migration `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/db/migrations.ts`
- **template to mirror:** `migrations.ts:72` (last import), `:371` (last array entry `migration20260708…`), `loadMigrations()` `:302-376`.
- **dependsOn:** S0-T1
- **what:** Two edits — static `import { migration as migration20260709CreateDriftTables } from './migrations/20260709_create_drift_tables.ts';` near `:72`, and append `migration20260709CreateDriftTables,` to the `loadMigrations()` array at `:371`.
- **acceptance:** `deno task check:server` passes; migration runs on a fresh DB (both tables + seed row exist; `SELECT * FROM drift_check_settings WHERE id=1` returns 1 row).

### S0-T3 — Update reference `schema.sql` `[SHARED, best-effort]`
- **files:** `packages/praxrr-app/src/lib/server/db/schema.sql`
- **template to mirror:** `schema.sql:1-4` (header says reference-only; already stale — not a CI gate).
- **dependsOn:** S0-T1
- **what:** Append both `CREATE TABLE` statements for documentation parity. Non-load-bearing (runtime schema comes from migrations only).
- **acceptance:** File contains both tables; no build impact.

### S0-T4 — Core drift types `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/sync/drift/types.ts`
- **template to mirror:** `$sync/preview/types.ts:14,27-40` (SyncPreviewSection, FieldChange, EntityChange, SyncPreviewAction); design §4.1.
- **dependsOn:** —
- **what:** Export `DriftStatus` (5-value), `DriftReason` (8-value), `DriftEntityChange` (design §3), `InstanceDriftResult` (design §4.1), `HeartbeatResult = {ok:true; version:string; appName?:string} | {ok:false; status?:number}` (DC-10). Import `SyncPreviewSection`/`FieldChange` from `$sync/preview/types.ts`.
- **acceptance:** Type-checks; no circular import.

### S0-T5 — `driftSettingsQueries` module `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/db/queries/driftSettings.ts`
- **template to mirror:** `queries/backupSettings.ts:6-23` (co-located Row + Update input types), `:33-35` (`get()` → `db.queryFirst`), `:40-76` (`update()` dynamic SET + `updated_at`); `db.ts:144` (queryFirst), `:155` (execute).
- **dependsOn:** —
- **what:** Co-located `DriftCheckSettings` row + `UpdateDriftSettingsInput`; `get()` (seed guarantees never-undefined), `update(input)`, plus `markRun(lastRunAt: string)` (hand-written per DC — `UPDATE … SET last_run_at = ?`, param, mirroring `arrRenameSettings.ts:193-198` but accepting a param), `markFailure(errorCount, backoffUntil)`, and reset helpers.
- **acceptance:** `get()` returns seeded row; `update`/`markRun` mutate; unit-covered in **S1-T-QUERIES**.

### S0-T6 — `driftStatusQueries` module `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts`
- **template to mirror:** `queries/pcdSnapshots.ts:35-66` (JSON-column parse + `toDetail` camelCase mapping), `:113-116` (getById); `db.ts:213` (async `transaction`), `:155` (execute w/ params); `backupSettings.ts` for the get shape.
- **dependsOn:** —
- **what:** Co-located snake_case Row + `toDetail(row)` parsing the `changes` JSON blob into `DriftEntityChange[]`. `getById(instanceId)`, `getAllForSummary()` (single full-table pass, no `WHERE status`). **Upsert (DC-13):** `await db.transaction(() => db.execute(<INSERT … ON CONFLICT(arr_instance_id) DO UPDATE …>, ...params))` — one parameterized `execute`, never `exec`. `markNotified(instanceId, signature)`. On a *failed* check the upsert updates only `status`/`reason`/`checked_at` and leaves `changes`/`content_checked_at` (design §3).
- **acceptance:** Upsert replaces the single row (no growth); failed-check path preserves prior `changes`; JSON round-trips. Covered in **S1-T9** + **S1-T-QUERIES**.

### S0-T7 — `JobType` union + payload `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`
- **template to mirror:** `queueTypes.ts:130-137` (JobHandler/JobHandlerResult), existing `JobPayloadByType` entries; DC-11.
- **dependsOn:** —
- **what:** Add `'drift.check'` to the `JobType` union; add `DriftCheckJobPayload = { sweepStartedAt?: string; cursor?: number }`; add `JobPayloadByType['drift.check'] = DriftCheckJobPayload`. **Do not** introduce a generic `JobHandler<T>`.
- **acceptance:** `deno task check:server` passes; `upsertScheduled({jobType:'drift.check', payload:{}})` type-checks.

### S0-T8 — Export `processBatches` `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/sync/processor.ts`
- **template to mirror:** `processor.ts:247-257` (declaration), `:37` (`CONCURRENCY_LIMIT=3`).
- **dependsOn:** —
- **what:** Add `export` to `processBatches`. Confirm signature stays `<T,R>(items: T[], processor: (item:T)=>Promise<R>, concurrency: number)`. (Alternative: lift to `$utils/concurrency.ts` — pick export-in-place for minimal churn.) DC-1: callers pass `(items, processor, concurrency)`.
- **acceptance:** `processBatches` importable from `$sync/processor.ts`; existing internal callers (`:100`, `:317`) unchanged.

### S0-T9 — Promote `isSyncPreviewArrType` `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/sync/preview/types.ts` (add exported predicate), `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` (import it)
- **template to mirror:** `preview/+server.ts:41-43` (current private def), `preview/types.ts:21` (`SyncPreviewArrType`).
- **dependsOn:** —
- **what (DC-8):** Move `isSyncPreviewArrType` into `$sync/preview/types.ts` as `export function isSyncPreviewArrType(value: string): value is SyncPreviewArrType`; update the route to import it (delete the local copy). Drift service + drift routes import the shared predicate.
- **acceptance:** Route still gates identically; drift modules import without duplication; `deno task check` passes.

---

## Stage 1 — Core service (depends on Stage 0)

> All NEW files → parallelizable except where noted. The three **load-bearing correctness tests** (S1-T6/T7/T8) are their own tasks.

### S1-T1 — `check.ts`: aggregateDrift + driftSignature + checkInstanceDrift `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/sync/drift/check.ts`
- **template to mirror:** deps pattern `$sync/preview/liveDiff.ts:67`; `orchestrator.ts:193` (`generatePreview`), `:40-45` (input), `:47-62` (result), `:87-96` (resolveSections auto-limit), `:255-273/:295-299` (sectionOutcomes); `base.ts:72` + `arrInstanceClients.ts:56-130` (heartbeat client build/close); `instanceCompatibility.ts:28-52` (detectAndRecordArrVersion) + `mappings.ts:82-88` (resolveSyncSectionAvailability); `registry.ts:23` + `cache.ts:421-423` (isPcdCacheReady); `arrSyncQueries.getQualityProfilesSync` + `qualityProfiles/syncer.ts:457-468` (dbId enumeration).
- **dependsOn:** S0-T4, S0-T8, S0-T9
- **what:**
  - `aggregateDrift(preview, availableSections)` — **pure**; reads nested section objects with null-guards **(DC-2)**: `preview.qualityProfiles?.customFormats`/`?.qualityProfiles`, `?.delayProfiles?.profile`, `?.mediaManagement?.{naming,qualityDefinitions,mediaSettings}`, `?.metadataProfiles?.profile`; collects `action !== 'unchanged'`; maps action→count→category (§4.2 table); computes `allSectionsErrored` from `preview.sectionOutcomes` ∩ `availableSections` **(DC-3)**.
  - `driftSignature(changes)` — **pure**; hash over sorted alerting (`update`+`create`) tokens `${section}|${entityType}|${name}|${remoteId ?? 'new'}|${action}`; `null` on empty (§6).
  - `DriftCheckDeps` + `defaultDriftCheckDeps`: `getSystemStatus` wrapper builds a `getArrInstanceClient(type,id,url,{timeout:5000,retries:0})` client, calls the method, `close()`s **(DC-4/DC-5)**; `resolveAvailableSections(instance, version)` takes version from the single heartbeat, persists via `setDetectedVersion` (or reuses the open heartbeat client for `detectAndRecordArrVersion` — no 2nd round-trip), builds `Set` where `status !== 'unavailable'` **(DC-6/DC-7)**; `isPcdCacheReady(id)` enumerates every referenced `databaseId` and requires `getCache(dbId)?.isBuilt() === true` for all **(DC-18/DC-19)**; `registerPreviewAttempt = registerPreviewCreateAttempt` (`limits.ts:17`).
  - `checkInstanceDrift(instance, deps?)` — **never throws**; runs the §4.2 precedence (in-flight is in persist, not here): heartbeat → gates → `Promise.race([generatePreview({instance}), budgetTimeout])` → `aggregateDrift`. Returns an `InstanceDriftResult` with a status even on failure.
- **acceptance/tests:** covered by S1-T4, S1-T5; must satisfy DC-2/DC-3/DC-6/DC-7/DC-18/DC-19.

### S1-T2 — `limits.ts`: drift refresh window `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/sync/drift/limits.ts`
- **template to mirror:** `$sync/preview/limits.ts:1-33` (module-level `Map<number,{timestamps:number[]}>`, private `pruneWindow`, exported `register*`, exported `reset*ForTests`).
- **dependsOn:** —
- **what:** `DRIFT_REFRESH_MAX=3`, `WINDOW_MS=60000`; `registerDriftRefreshAttempt(instanceId, nowMs): boolean`; `resetDriftRefreshRateLimitForTests(): void`. Per-instance sliding window (design §9b).
- **acceptance:** 4th call within 60s returns false; reset clears state.

### S1-T3 — `persist.ts`: checkAndPersistInstance + shouldNotify `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`
- **template to mirror:** `notify` chain `builder.ts:126,:61,:76,:87` (`.send()` = manager path — **DC-21**); `NotificationManager.ts:27-34` (enabled_types filter); `driftStatusQueries` upsert/markNotified (S0-T6).
- **dependsOn:** S1-T1, S0-T6; soft-dep S2-T6 (opt-in checkbox surface)
- **what:** Module-level `inFlight = new Set<number>()` guard in `try/finally` (§4.2 step 1). Read `prior` **before** upsert → `checkInstanceDrift` → `await db.transaction` upsert (via S0-T6) → after commit, `shouldNotify(prior, next)` → inline `void notify('drift.detected').generic(title,message).discord(d=>d.embed(embed)).send().then(()=>markNotified(id, next.driftSignature)).catch(()=>{})` (§6; never awaited). **Must never throw** (DC-1 precondition for `processBatches`). Export **pure** `shouldNotify(prior, next)` (§6 predicate).
- **acceptance/tests:** S1-T9 (persist+notify shell) proves single-row replace, failed-check preservation, fire-once dedup, `notified_signature` advance, and no-throw.

### S1-T4 — Pure unit tests: aggregateDrift / driftSignature / shouldNotify `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/aggregate.test.ts` (+ signature/notify or split)
- **template to mirror:** design §10 "Pure unit"; existing sync test fixtures.
- **dependsOn:** S1-T1, S1-T3
- **what:** Canned `GeneratePreviewResult` fixtures across all sections mixing update/create/delete/unchanged. Assert: action→count→category; `unmanaged` never flips drift; `unchanged` never enters `changes`; **DC-2** nested-field reads (a fixture with CF drift only under `preview.qualityProfiles.customFormats` must be detected); **DC-3** `allSectionsErrored` from `sectionOutcomes`; sections outside `availableSections` excluded. `driftSignature` stability/sensitivity/`remoteId` disambiguation/`delete`+`unchanged` exclusion. `shouldNotify` full transition matrix.
- **acceptance:** all assertions pass under `deno task test`.

### S1-T5 — checkInstanceDrift injected-deps tests `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/checkInstance.test.ts`
- **template to mirror:** design §10 "checkInstanceDrift with injected deps".
- **dependsOn:** S1-T1
- **what:** Stub deps: `401→unauthorized` (no disable, no notify); `{ok:false}→unreachable`; `isPcdCacheReady=false→error/cache_not_ready`; `registerPreviewAttempt=false→error/rate_limited`; `resolveAvailableSections=∅→in-sync/not_configured`; drift fixture→`drifted`; clean→`in-sync`; unmanaged-only→`in-sync`; throwing stub→`error`; slow stub + fake clock→`error/timeout`; **DC-7** a `degraded`-status section is still included. `now` makes `checkedAt` deterministic.
- **acceptance:** every branch asserted.

### S1-T6 — LOAD-BEARING: namespace correlation regression `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/namespaceCorrelation.test.ts`
- **template to mirror:** design §10 correctness #1; `diffEntityCollection`/`findNamespaceMatch`; syncer suffixing (`qualityProfiles/syncer.ts:400`, `sectionDiffs.ts:211-225`).
- **dependsOn:** S1-T1
- **what:** Drive a real section diff (a syncer's `generatePreview` with a stubbed client returning a live payload whose CF/QP names carry the per-DB namespace suffix). Assert the managed entity resolves to `update`/`unchanged`, **never** `create`+`delete`, and that drift never runs `transformer.ts` (no double-suffix). Highest-severity guard.
- **acceptance:** zero spurious create/delete for a suffix-matched managed entity.

### S1-T7 — LOAD-BEARING: cross-DB same-name `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/crossDbSameName.test.ts`
- **template to mirror:** design §3 "collision-proof by construction", §10 correctness #2.
- **dependsOn:** S1-T1, S0-T6
- **what:** Two databases syncing a same-named entity to one instance. Assert both survive in `changes[]` (blob is **not** name-keyed; upsert PK is `arr_instance_id`) and produce **distinct** `driftSignature` tokens via `remoteId`.
- **acceptance:** no row overwrite; two distinct signature tokens.

### S1-T8 — LOAD-BEARING: array-key false positives `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/arrayKeyDrift.test.ts`
- **template to mirror:** design §10 correctness #3; inherited `sectionDiffs.ts` key strategy (not `PORTABLE_*`).
- **dependsOn:** S1-T1
- **what:** Feed a live payload with a **reordered** keyed array (CF `specifications`, QP `items`) through the real section diff; assert **no** false `update` drift. Include a nested-array case (`OrderedItem.members`) documenting the known index-churn boundary.
- **acceptance:** reordered-but-equal arrays produce `unchanged`, not `update`.

### S1-T9 — persist + notify shell test `[NEW]`
- **files:** `packages/praxrr-app/tests/sync/drift/persist.test.ts`
- **template to mirror:** in-memory app DB w/ real migration like `tests/pcd/snapshots/service.test.ts`; `resetPreviewCreateRateLimitForTests()` in `beforeEach`.
- **dependsOn:** S1-T3, S0-T2, S0-T6
- **what:** Assert transactional upsert **replaces** the single row (no growth); a failed check leaves `changes`/`content_checked_at` untouched; `shouldNotify` fires exactly once on new drift, does not re-fire on identical repeat, does not fire on unmanaged-only; `notified_signature` advances only after a successful emit; `checkAndPersistInstance` **never throws** (DC-1 precondition).
- **acceptance:** all pass under `deno task test`.

### S1-T-QUERIES — driftSettings/driftStatus query tests `[NEW]`
- **files:** `packages/praxrr-app/tests/db/driftQueries.test.ts`
- **template to mirror:** design §10 "Query modules"; temp-DB pattern.
- **dependsOn:** S0-T5, S0-T6, S0-T2
- **what:** get/upsert/markRun/markFailure/markNotified against a temp DB with the real migration applied.
- **acceptance:** CRUD + backoff fields round-trip.

---

## Stage 2 — Wiring (depends on Stage 1; SHARED edits — SERIALIZE)

### S2-T1 — driftCheck job handler (chunked sweep) `[NEW]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/handlers/driftCheck.ts`
- **template to mirror:** `handlers/pcdSync.ts:51-100` (handler shape), `:9` (payload coercion); `queueRegistry.ts:6-8` (register); `jobQueue.ts:79-118` (upsertScheduled), `scheduleUtils.ts:4-15` (calculateNextRunFromMinutes); `processor.ts:247` (`processBatches` — **DC-1**); `arrInstances.ts:342-344` (getEnabled — **DC-9**).
- **dependsOn:** S1-T3, S0-T7, S0-T8, S0-T5
- **what:** Bare `JobHandler` (**DC-11**), coerce `payload.sweepStartedAt`/`cursor` from `unknown`. Read `driftSettingsQueries.get()`; if `!enabled` return no reschedule; guard recurrence on `job.source==='schedule'`. New sweep → `sweepStartedAt=nowISO, cursor=0`. Select eligible = `getEnabled()` → filter `isSyncPreviewArrType` → **re-sort by id in memory (DC-9)** → `id > cursor` → `limit DRIFT_SWEEP_CHUNK_SIZE(=5)`. `processBatches(chunk, checkAndPersistInstance, 3)` (**DC-1 arg order**). If more remain: `upsertScheduled({jobType:'drift.check', runAt:nowISO, payload:{sweepStartedAt, cursor:lastProcessedId}, source:'schedule', dedupeKey:'drift.check'})` + `notify(runAt)`; return `{status:'success'}`. Else terminal: `markRun(sweepStartedAt)`, return `{status:'success', rescheduleAt: calculateNextRunFromMinutes(sweepStartedAt, interval_minutes)}`. Backoff on handler-level fault (§4.4). End with `jobQueueRegistry.register('drift.check', driftCheckHandler)`.
- **acceptance/tests:** S2-T-HANDLER.

### S2-T-HANDLER — job handler / chunking test `[NEW]`
- **files:** `packages/praxrr-app/tests/jobs/driftCheck.test.ts`
- **template to mirror:** design §10 "Job handler / chunking" + "Backoff".
- **dependsOn:** S2-T1
- **what:** Fixture with `> DRIFT_SWEEP_CHUNK_SIZE` instances: each invocation processes one bounded chunk, self-enqueues a continuation with advanced `cursor`, only the terminal chunk returns `rescheduleAt=nextInterval` + `markRun`; dispatcher yielded between chunks. Backoff: failure → `rescheduleAt` grows + `error_count++`; success resets both.
- **acceptance:** chunk boundaries + backoff asserted.

### S2-T2 — handler side-effect import `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`
- **template to mirror:** `handlers/index.ts:1-9`.
- **dependsOn:** S2-T1
- **what:** Add `import './driftCheck.ts';` (else dispatcher logs "Handler not found").
- **acceptance:** handler registered at startup.

### S2-T3 — `scheduleDriftCheck()` + wire into `scheduleAllJobs()` `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/schedule.ts`
- **template to mirror:** `schedule.ts:61-101` (last_run + calculateNextRunFromMinutes), `:124-172` (cancelByDedupeKey), `:181-197` (scheduleAllJobs); `jobQueue.ts:244-249` (cancelByDedupeKey).
- **dependsOn:** S0-T5
- **what:** Add `scheduleDriftCheck()`: read settings; if enabled `upsertScheduled({jobType:'drift.check', runAt: calculateNextRunFromMinutes(lastRunAt, intervalMinutes), payload:{}, source:'schedule', dedupeKey:'drift.check'})` + `notify(runAt)`; if disabled `cancelByDedupeKey('drift.check')`. Call it inside `scheduleAllJobs()`.
- **acceptance:** startup seeds/cancels the drift job per settings.

### S2-T4 — export `scheduleDriftCheck` from init `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/init.ts`
- **template to mirror:** `init.ts:22-30` (re-export block).
- **dependsOn:** S2-T3
- **what:** Add `scheduleDriftCheck` to the re-export block so `PUT /drift/settings` / the settings form-action can reseed/cancel on change.
- **acceptance:** importable from `$jobs/init.ts`.

### S2-T5 — job label `[SHARED, optional]`
- **files:** `packages/praxrr-app/src/lib/server/jobs/display.ts`
- **template to mirror:** existing `case` entries in `display.ts`.
- **dependsOn:** S0-T7
- **what:** `case 'drift.check': return 'Drift Check';`
- **acceptance:** label renders in job UI.

### S2-T6 — notification opt-in registration (LOAD-BEARING) `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/shared/notifications/types.ts`
- **template to mirror:** `shared/notifications/types.ts:16` (array), `:6-11` (item shape), `:133` (auto-group by category).
- **dependsOn:** —
- **what (DC-20):** Append `{ id:'drift.detected', label:'Drift Detected', category:'Drift', description:'…' }`. This is the load-bearing wiring surfacing the opt-in checkbox and matching `NotificationManager`'s `enabled_types` filter (`NotificationManager.ts:27-34`). New `Drift` category auto-groups.
- **acceptance:** checkbox appears under a `Drift` group; `notify('drift.detected').send()` delivers to opted-in services.

### S2-T7 — server NotificationTypes const `[SHARED, optional/inert]`
- **files:** `packages/praxrr-app/src/lib/server/notifications/types.ts`
- **template to mirror:** existing `NotificationTypes` const.
- **dependsOn:** —
- **what (DC-20):** Add `DRIFT_DETECTED: 'drift.detected'` for convention. Functionally inert (no external consumers) — do **not** treat as load-bearing.
- **acceptance:** compiles; no behavior change.

### S2-T8 — `definitions/drift.ts` `[NEW, optional]`
- **files:** `packages/praxrr-app/src/lib/server/notifications/definitions/drift.ts`, `packages/praxrr-app/src/lib/server/notifications/definitions/index.ts`
- **template to mirror:** `definitions/rename.ts:273-276,345-367`; register in `definitions/index.ts:19-23`.
- **dependsOn:** —
- **what (DC-21):** Optional convenience builder. **Do not** copy rename's direct-notifier emit (bypasses the manager); the functional path is S1-T3's inline `.send()`.
- **acceptance:** if built, returns a builder without `.send()`; the S1-T3 emit remains the functional path.

---

## Stage 3 — API (contract-first; depends on Stage 1 types)

### S3-T1 — `schemas/drift.yaml` `[NEW]`
- **files:** `docs/api/v1/schemas/drift.yaml`
- **template to mirror:** `schemas/sync.yaml:13,78,118,127` (intra-file `#/Name` refs, cross-file `../schemas/…`); `FieldChange` `sync.yaml:66`, `SyncPreviewAction` `:51`.
- **dependsOn:** S0-T4
- **what:** Define `DriftStatus` (5-value), `DriftSummaryStatus` (adds `never-checked`), `DriftCounts`, `DriftSettings`, `DriftInstanceSummary`, `DriftSummaryResponse`, `DriftEntityChange` (`action → $ref '../schemas/sync.yaml#/SyncPreviewAction'`, `fields → [$ref '../schemas/sync.yaml#/FieldChange']`), `DriftDetailResponse`, `DriftSettingsUpdateRequest`.
- **acceptance:** shapes match design §7 JSON examples byte-for-byte (field names, nullable rules).

### S3-T2 — `paths/drift.yaml` `[NEW]`
- **files:** `docs/api/v1/paths/drift.yaml`
- **template to mirror:** `paths/sync.yaml:1,60,133` (top-level keys per operation), refs to schemas `:21,28,34`; errors `$ref '../schemas/arr.yaml#/ErrorResponse'`.
- **dependsOn:** S3-T1
- **what:** Top-level keys `summary` (GET), `instance` (GET+POST for `/drift/{instanceId}`), `settings` (PUT). Status codes per §7 (200 degrade-not-500; 404/400/409/429+`Retry-After`).
- **acceptance:** all operations reference drift/sync/arr schemas correctly.

### S3-T3 — wire into root `openapi.yaml` `[SHARED]`
- **files:** `docs/api/v1/openapi.yaml`
- **template to mirror:** `openapi.yaml:14-42` (tags), `:44-638` (paths, e.g. `:344-349`), `:640-1420` + `:766-773` (components.schemas).
- **dependsOn:** S3-T1, S3-T2
- **what:** Add `- name: Drift Detection` tag; add `/drift/summary`, `/drift/{instanceId}`, `/drift/settings` `$ref`s to `paths:`; register each drift schema under `components.schemas` (≥1 drift schema per file so the bundler loads it).
- **acceptance:** bundle step (S3-T4) resolves all refs without error.

### S3-T4 — bundle + generate + format `[SHARED, generated artifacts]`
- **files (generated):** `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`, `packages/praxrr-app/src/lib/api/v1.d.ts`
- **template to mirror:** `scripts/bundle-api.ts:14,144-145,150-168`; deno tasks `bundle:api`, `generate:api-types`, `format`.
- **dependsOn:** S3-T3
- **what:** Run `deno task bundle:api && deno task generate:api-types && deno task format`. Never hand-edit `openapi.json` (prettier-gated) or `v1.d.ts`; commit only meaningful `v1.d.ts` additions.
- **acceptance:** `deno task format:check` clean; drift types appear in `v1.d.ts`.

### S3-T5 — `GET /drift/summary` route `[NEW]`
- **files:** `packages/praxrr-app/src/routes/api/v1/drift/summary/+server.ts`
- **template to mirror:** existing `routes/api/v1/**` GET handlers; `driftStatusQueries.getAllForSummary` (S0-T6, single pass, no `WHERE status`), `driftSettingsQueries.get`, `arrInstancesQueries.getEnabled` filtered by `isSyncPreviewArrType`.
- **dependsOn:** S3-T4, S0-T5, S0-T6, S0-T9
- **what:** LEFT-JOIN eligible enabled instances against status rows; totals in one pass; synthesize `never-checked` for row-less instances; compute `nextRunAt` from settings. 200 always (500 only on internal DB error).
- **acceptance:** covered in S3-T8.

### S3-T6 — `GET/POST /drift/[instanceId]` route `[NEW]`
- **files:** `packages/praxrr-app/src/routes/api/v1/drift/[instanceId]/+server.ts`
- **template to mirror:** `routes/api/v1/sync/preview/+server.ts` (validation, `isSyncPreviewArrType`, 400/404/429); `driftStatusQueries.getById` + `toDetail`; `checkAndPersistInstance` (S1-T3); `registerDriftRefreshAttempt` (S1-T2).
- **dependsOn:** S3-T4, S1-T3, S1-T2, S0-T6
- **what:** GET reads `changes` blob, groups by `category` into `drift`/`missing`/`unmanaged` (so client can't render unmanaged as drift); 404 unknown instance; degrade-not-500. POST runs `checkAndPersistInstance` on the request thread: 200 / 404 / 400 unsupported-or-disabled / 409 in-flight / 429 + `Retry-After` (via S1-T2 window). `fields[].current`=LIVE, `.desired`=PCD (never swapped).
- **acceptance:** covered in S3-T8.

### S3-T7 — `PUT /drift/settings` route `[NEW]`
- **files:** `packages/praxrr-app/src/routes/api/v1/drift/settings/+server.ts`
- **template to mirror:** existing PUT/validation routes; `driftSettingsQueries.update`; `scheduleDriftCheck` from `$jobs/init.ts` (S2-T4).
- **dependsOn:** S3-T4, S0-T5, S2-T4
- **what:** Body `{enabled, intervalMinutes}`; validate `intervalMinutes >= 5`; persist; re-run `scheduleDriftCheck()` (reseed or `cancelByDedupeKey('drift.check')`). 200 updated / 400 invalid.
- **acceptance:** covered in S3-T8.

### S3-T8 — route tests `[NEW]`
- **files:** `packages/praxrr-app/tests/routes/drift/*.test.ts`
- **template to mirror:** design §10 "Route tests"; existing v1 route tests (type-checked via `deno test <dir>`).
- **dependsOn:** S3-T5, S3-T6, S3-T7
- **what:** summary (degraded, one unreachable instance, **never 500**, no `WHERE status` regression); detail (404 unknown, degrade-not-500 for `unauthorized`/`cache_not_ready`, `create`/`delete` render identity-only); POST (200/404/400/409/**429 + `Retry-After`**); PUT (validation + reschedules/cancels the job).
- **acceptance:** all pass; degrade-not-500 asserted for every degraded status.

---

## Stage 4 — UI (depends on Stage 3 contract)

### S4-T1 — extract shared field-diff component `[NEW]`
- **files:** `packages/praxrr-app/src/lib/client/ui/drift/DriftFieldDiff.svelte` (+ index if needed)
- **template to mirror (DC-14):** `LiveDiffPanel.svelte:232-282` (field table + create/delete banner markup); `$ui/resolved/fieldChangeDisplay.ts:13,20` (`FIELD_META`, `formatFieldValue`).
- **dependsOn:** S3-T4
- **what:** Presentational (dumb) component consuming a precomputed `DriftEntityChange[]` (or one entry) — Field/Change/Current(live)/Desired(PCD) table for `update`; identity-only line for `create`/`delete` (`fields=[]`). **No** internal fetch, **no** instance `<select>`. Reuse `FIELD_META`/`formatFieldValue` as-is (never swap direction).
- **acceptance:** renders update field tables and identity-only create/delete rows from static props.

### S4-T2 — `/drift` dashboard `[NEW]`
- **files:** `packages/praxrr-app/src/routes/drift/+page.server.ts`, `packages/praxrr-app/src/routes/drift/+page.svelte`
- **template to mirror:** `routes/resolved-config/[databaseId]/+page.server.ts:22-87` + `+page.svelte:8,70,321-325` (load exposes id/name/type, client-fetch, `$:`, `on:click`); `Card.svelte:4-9`, `CardGrid.svelte:4-7`, `Badge.svelte:4-9`, `EmptyState.svelte:5-10`; `alerts/store.ts:19,45`; `LiveDiffPanel.svelte:63,75-82,93-136` (requestId race-guard).
- **dependsOn:** S3-T4, S3-T5
- **what:** Load exposes `{instances}` (id/name/type only). `CardGrid columns={4}` KPI row (total/in-sync/drifted/unreachable) from `Card` tiles; per-instance `Card`s with status `Badge` (success=in-sync, warning=drifted, danger=unreachable/unauthorized/error, neutral=never-checked — **no `error` variant exists**), counts, `checkedAt`, link to `/drift/[instanceId]`. Client-fetch `/api/v1/drift/summary` with race-guard; failures → `alertStore.add('error', …)`. **DC-17:** `EmptyState` with `buttonText:'Add Arr instance'`, `buttonHref:'/arr'`.
- **acceptance:** dashboard renders totals + cards; empty state links to `/arr`.

### S4-T3 — `/drift/[instanceId]` detail `[NEW]`
- **files:** `packages/praxrr-app/src/routes/drift/[instanceId]/+page.server.ts`, `.../+page.svelte`
- **template to mirror:** `resolved-config/[databaseId]/+page.server.ts:22-87` (param validation, never-throws, inline `error`); S4-T1 component; `LiveDiffPanel.svelte:93-136` (429/error retry handling).
- **dependsOn:** S4-T1, S3-T6
- **what:** Validate param + picker list. Client-fetch `/api/v1/drift/[instanceId]`; render `drift` (update) via S4-T1 tables, `missing` (create) as identity-only rows, `unmanaged` (delete) in a de-emphasized collapsed section. "Refresh now" button POSTs `/api/v1/drift/[instanceId]` (handle 409/429 with alert). Wrap S4-T1 in a per-section list container (**not** a fork of LiveDiffPanel).
- **acceptance:** detail groups by category; refresh handles 409/429.

### S4-T4 — Drift settings panel `[NEW]`
- **files:** `packages/praxrr-app/src/routes/settings/<drift>/+page.server.ts` + `+page.svelte` (place under the existing settings surface)
- **template to mirror (DC-15):** `routes/settings/backups/+page.svelte:201-216` + its `+page.server.ts` form-action + `use:enhance`; `driftSettingsQueries.update`; `scheduleDriftCheck` (S2-T4).
- **dependsOn:** S3-T7, S2-T4
- **what:** Enable toggle + interval-minutes input (floor 5). **Follow the form-action convention** (`?/updateDriftSettings` in `+page.server.ts` → validate → `driftSettingsQueries.update` → `scheduleDriftCheck()` server-side); alert feedback via the `use:enhance` result. Do **not** wire the dirty store (avoids the novel two-field pattern). The `PUT /api/v1/drift/settings` route (S3-T7) remains for API/contract completeness.
- **acceptance:** toggling/saving persists and reschedules/cancels the job; no dirty-store dependency.

### S4-T5 — nav registry entry `[SHARED]`
- **files:** `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- **template to mirror (DC-12/DC-16):** `registry.ts:106-116` (dependency_graph entry, `order:3`), `:56` (`scopeAll`), `:60-116`; `shared/navigation/types.ts:21-37`.
- **dependsOn:** —
- **what:** One entry: `{ id:'overview.drift', label:'Drift', href:'/drift', groupId: ensureGroupId('overview'), order: 4, arrScope: scopeAll, mobilePriority:'always', iconKey:'GitCompare', emoji:'…', hasChildren:false }`. `GitCompare` is in `NAV_ICON_MAP` (no iconMap edit); `Activity` is not.
- **acceptance:** `/drift` appears in the overview group after Dependency Graph; icon resolves.

---

## Stage 5 — Integration / verify (orchestrator-driven)

### S5-T1 — full verification sweep
- **dependsOn:** all Stage 0-4 tasks
- **commands (real `deno.json` task names):**
  - `deno task check` (→ `check:server` + `check:client`)
  - `deno task lint` (prettier --check + eslint)
  - `deno task bundle:api && deno task generate:api-types && deno task format` (confirm no drift in generated artifacts beyond intended additions)
  - `deno task test` (all unit tests incl. S1-T4/5/6/7/8/9, S1-T-QUERIES, S2-T-HANDLER, S3-T8)
  - `deno task test drift` (if a `drift` alias is added to `scripts/test.ts`) — otherwise `deno task test` covers it
  - `deno task test:e2e` smoke: dashboard loads, one instance detail renders, settings toggle persists (requires running server)
- **acceptance:** check + lint + test all green; e2e smoke passes; generated API artifacts formatted.

### S5-T2 — ROADMAP update `[SHARED]`
- **files:** `ROADMAP.md`
- **template to mirror:** existing shipped-feature rows (`ROADMAP.md:56-57`), checklist item `:259` (`- [ ] #15 - Drift Detection Dashboard`), narrative `:36-37,298-299`.
- **dependsOn:** S5-T1
- **what:** Flip `:259` to `- [x]`, add a shipped-feature row, and update the "next lifecycle feature" narrative (drift → done; next becomes #16/#17 per the roadmap ordering).
- **acceptance:** ROADMAP reflects #15 as shipped.

---

## Parallelization summary

- **Stage 0:** S0-T1/T4/T5/T6 (NEW) parallel; S0-T2/T3/T7/T8/T9 are independent SHARED edits (different files) — safe to parallelize, but land before Stage 1.
- **Stage 1:** S1-T1 and S1-T2 first; then S1-T3; tests S1-T4/T5/T6/T7/T8/T9/T-QUERIES all parallel once their deps exist. **S1-T6/T7/T8 are the load-bearing correctness gates — do not skip.**
- **Stage 2:** SHARED edits (S2-T2/T3/T4/T5/T6/T7) serialize by file but are mutually independent; S2-T1 + S2-T-HANDLER + S2-T8 (NEW) parallel.
- **Stage 3:** S3-T1→T2→T3→T4 strictly serial (contract build); S3-T5/T6/T7 (NEW routes) parallel after T4; S3-T8 after routes.
- **Stage 4:** S4-T1 first; S4-T2/T4/T5 parallel; S4-T3 after S4-T1.
- **Stage 5:** orchestrator runs after everything.

## Key correctness invariants the implementer must not violate

1. `processBatches(chunk, checkAndPersistInstance, 3)` — **processor second, concurrency third** (DC-1), and `checkAndPersistInstance` must **never throw** (Promise.all batch has no isolation).
2. `aggregateDrift` reads **nested** section objects with `?.` guards (DC-2); `allSectionsErrored` comes from `sectionOutcomes` (DC-3).
3. Heartbeat = dedicated `{timeout:5000, retries:0}` client built via `getArrInstanceClient`, `close()`d (DC-4/DC-5); version taken from the single beat, no double-fetch (DC-6).
4. Section availability: include when `status !== 'unavailable'` (DC-7).
5. `isPcdCacheReady` = proactive pre-check, `getCache(dbId)?.isBuilt() === true` for **every** referenced databaseId (DC-18/DC-19).
6. Upsert = `await db.transaction(() => db.execute(<ON CONFLICT>, ...params))` (DC-13); one row per instance, no growth, failed-check preserves `changes`.
7. Notification opt-in = `shared/notifications/types.ts` entry + `notify('drift.detected').send()` (DC-20/DC-21); `definitions/drift.ts` and the server const are optional.
8. `fields[].current`=LIVE, `.desired`=PCD — never swapped (design §3).