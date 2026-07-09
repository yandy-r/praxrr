# Design: Sync History / Audit Trail (Issue #17)

> Produced by the design workflow (8 parallel subsystem readers → synthesis →
> adversarial critique, verdict `ready-with-fixes`). Section 0 below records the
> authoritative resolutions applied after critique and **overrides any conflicting
> text in the synthesized body (§1–§10) that follows it.**

---

## 0. Critique Resolutions (AUTHORITATIVE — overrides conflicting text below)

The adversarial critique raised two blocking issues and several scope concerns.
All are resolved here; the resolutions win wherever the body disagrees.

### R1. Full before/after diffs are captured via a best-effort pre-sync preview — NOT a syncer return-extension

The critique proved (reading the real syncers) that the body's §2.2/§3 claim —
"full field-level `changes` are already held in-process in each `sync()` and
capturable with no extra Arr round-trips" — is **false**: `sync()` never assembles
the desired collections (only `generatePreview()` does), the QP custom-format
"current" fetch is post-write, and delay/media fetch no usable pre-write baseline
for radarr/sonarr. Extending the four syncers would be a risky write-path refactor.

**Resolution:** capture `changes` by calling the existing read-only preview engine
`generatePreview({ instance, sections: sectionsToRun })`
(`$sync/preview/orchestrator.ts:193`) **best-effort, before the sync loop**, and
flatten its per-section `EntityChange[]` (filtering `action === 'unchanged'`) into
`SyncEntityChange[]`. This yields real, preview-identical before/after
`FieldChange`s (`current` = live/old, `desired` = PCD/new) using tested machinery.

Consequences:

- **Zero changes to the sync write path.** DELETE these files from the body's
  inventory (§8): `sync/qualityProfiles/syncer.ts`, `sync/delayProfiles/syncer.ts`,
  `sync/mediaManagement/syncer.ts`, `sync/metadataProfiles/syncer.ts`,
  `sync/types.ts` (`SyncResult` unchanged), `sync/processor.ts`. This removes the
  6 riskiest edits and directly addresses the scope-realism concern.
- The preview call is wrapped in `try/catch`; on ANY failure `changes = []` and the
  entry still records with `section_results` + counts. A preview failure must never
  affect the sync result or the audit write.
- Gate the preview call on `syncHistorySettingsQueries.get().enabled === 1`, so
  disabling history also avoids the extra read traffic.
- **Known tradeoff (documented, accepted):** this adds one read-only preview
  (extra Arr GETs, its own short-lived client) per recorded sync run. Sync is not a
  hot path and Drift already runs scheduled full previews, so the cost profile is
  precedented. Deferred optimization: reuse a recent `previewStore` entry when one
  exists for the instance. Note in the settings help text.
- The diff represents the change set the run **intended/applied** (pre-sync desired
  vs live). Per-section success/failure in `section_results` tells the reader which
  intended sections actually landed; label the detail-view diff accordingly.

### R2. No `cancelled` status — record only genuine sync attempts

`arrSyncHandler` returns `cancelled` for a disabled/missing instance
(`arrSync.ts:300`), a value absent from the proposed CHECK. Since the recorder never
throws, a `cancelled` run would silently violate the CHECK.

**Resolution:** keep the 4-value enum `('success','partial','failed','skipped')` and
record an entry **only for a genuine sync attempt against a valid, enabled instance**.
Map the handler's terminal exits as:

| Handler exit (arrSync.ts)                         | Record?                                            | status    |
| ------------------------------------------------- | -------------------------------------------------- | --------- |
| `:295` invalid instance id                        | **no** (no instance context)                       | —         |
| `:300` disabled/missing instance                  | **no** (nothing attempted; semantically cancelled) | —         |
| `:307` no sections specified                      | yes                                                | `skipped` |
| `:312` unsupported instance type                  | yes (misconfig, instance known)                    | `failed`  |
| `:316-352` credential failure (auto-disables)     | yes                                                | `failed`  |
| section loop: `ranSections === 0`                 | yes                                                | `skipped` |
| section loop: `failures > 0 && itemsSynced === 0` | yes                                                | `failed`  |
| section loop: `failures > 0 && itemsSynced > 0`   | yes                                                | `partial` |
| section loop: `failures === 0 && ranSections > 0` | yes                                                | `success` |

### R3. `trigger_event` column stays but is always NULL this PR (no `processor.ts` change)

Keep the nullable `trigger_event` column for forward-compat, but do **not** thread the
on_pull/on_change event through `processor.ts`/`triggerSyncs()` in this PR. Persist
NULL. This removes another core-path edit; wiring the event is a clean follow-up.

### R4. `job_id` is NULL for synthetic manual runs

`executeSyncJob` builds a synthetic job with `id = 0` (`arrSync.ts:105`). Store
`job_id = NULL` (not `0`) when `job.id === 0`, so the UI/export never treat `0` as a
real queue id.

### R5. `items_synced` must be accumulated during the recording refactor

`arrSyncHandler` tracks only `failures`/`ranSections`/`results[]` today
(`arrSync.ts:370-372`); it does NOT sum `itemsSynced`. The refactor MUST retain each
loop iteration's `SyncResult` (`{ section, result }[]`, currently dropped at `:436`)
and sum `result.itemsSynced` to compute `items_synced` and the partial/failed split.

### R6. Verified grounding facts

- Formatting: the real file is **`.prettierrc`** (not `.prettierrc.json`):
  `tabWidth: 2`, `useTabs: false`, `printWidth: 120`, `singleQuote: true`,
  `trailingComma: 'es5'`, **`semi: true`**; markdown override `printWidth: 80`,
  `proseWrap: preserve`. Semicolons ARE required. Run `deno task format` before every
  commit (docs are prettier-gated in CI).
- Append-only retention pattern confirmed: `upgradeRuns.deleteOlderThan(days)` =
  `DELETE FROM upgrade_runs WHERE datetime(started_at) < datetime('now','-'||?||' days')`
  (`upgradeRuns.ts:189-192`). Mirror it for `sync_history`.
- Nav `operations` group exists (`navigation/registry.ts:29`).
- Registration points in the body verified correct by the critique: `migrations.ts`
  static import + `loadMigrations()` append; `queueTypes.ts` `JobType` +
  `JobPayloadByType`; `handlers/index.ts` side-effect import; `schedule.ts`
  `scheduleAllJobs()` + `init.ts` re-export; `driftSettings` self-healing `get()`;
  drift `persist.ts` never-throw + `notify().generic().discord().send()`.

### R7. Final in-scope file delta vs body §8

- **Removed** (per R1): the 4 syncers, `sync/types.ts`, `sync/processor.ts`.
- **Added**: `record.ts` imports `generatePreview` from `$sync/preview/orchestrator.ts`
  and owns the flatten-to-`SyncEntityChange[]` helper.
- Everything else in §8 stands.

---

## Full Design (Synthesized)

Single source of truth for planning and implementation. Structured to mirror the Drift Detection feature (#15) verbatim where the two features share conventions, and to diverge only where sync-history's **append-only, retention-pruned, searchable** nature demands it. All file paths are repo-relative to the worktree root.

> **Formatting convention (authoritative).** The task brief says "no-semi." That is **wrong** for this repo and contradicted by every subsystem report and user MEMORY. The authoritative config is `.prettierrc` (note: `.prettierrc`, not `.prettierrc.json`): `tabWidth: 2`, `useTabs: false`, `printWidth: 120`, `singleQuote: true`, `trailingComma: 'es5'`, **`semi: true`**. Write all new `.ts`/`.svelte` with 2-space indent, single quotes, es5 trailing commas, **semicolons**, 120-width. Run `deno task format` before every commit.

---

## 1. Overview & Scope

Sync History records one durable, append-only audit entry per Arr sync run (per instance), capturing timestamp, trigger, target instance, per-section outcomes, entity change detail (before/after), success/partial/failure status, error text, and timing. Entries are searchable/filterable, viewable in a detail page with full diffs, exportable as JSON/CSV, and auto-pruned by a configurable retention policy.

This is the operational sibling of Drift Detection (#15): drift answers "does live Arr state differ from PCD _right now_"; sync-history answers "what did each sync run actually change, and did it succeed." The two reuse the same `FieldChange`/`EntityChange` diff shapes (`packages/praxrr-app/src/lib/server/sync/preview/types.ts`) and the same diff-rendering UI (`$ui/drift/DriftFieldDiff.svelte`). Drift's design doc `docs/plans/drift-detection/design.md` §11 already pre-designates sync-history as the append-only extension seam.

**The one structural divergence from drift:** drift is _latest-state_ — one upserted row per instance (`drift_instance_status`, PK == FK, `ON DELETE CASCADE`, no retention). Sync-history is _append-only time-series_ and MUST instead mirror the run-history tables `upgrade_runs` / `rename_runs` / `startup_pull_runs` (`packages/praxrr-app/src/lib/server/db/queries/upgradeRuns.ts`, `renameRuns.ts`, `startupPull.ts`), which already carry `deleteOlderThan(days)` retention helpers. Copying drift's upsert/`ON DELETE CASCADE` verbatim would silently keep only the last operation and erase deleted-instance history — defeating the audit requirement.

### In scope for this PR

1. Migration `20260710_create_sync_history_tables.ts`: `sync_history` (append-only) + `sync_history_settings` (singleton).
2. Query modules `db/queries/syncHistory.ts` + `db/queries/syncHistorySettings.ts` with search/filter/paginate/count, `getById`, `insert`, `pruneOlderThan(days)`, `pruneBeyondMaxEntries(max)`.
3. Recording integration: a single never-throwing `recordSyncHistory()` helper invoked inside `arrSyncHandler` (`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`) covering every terminal exit (success / partial / failed / skipped / credential-failure).
4. Per-section results + entity-change **counts** captured with zero syncer-contract change; **full field-level before/after diffs** captured by threading `changes?: EntityChange[]` out of the four syncers (they already hold both live "current" and built "desired" in-process — no extra Arr round-trips).
5. Retention job `sync.history.cleanup` (JobType + handler + registration + schedule) with age + max-entries pruning.
6. Contract-first OpenAPI + `/api/v1/sync-history` list / detail / export / settings endpoints.
7. `/sync-history` list page + `/sync-history/[id]` detail page (SSR + URL-query filters, no-runes) + export button; nav entry in the `operations` group.
8. Failed/partial-sync notification (`sync.failed` / `sync.partial`) as a thin add-on fired from the same recording hook (small; see §7).
9. Tests + `sync-history` test alias.
10. Design doc `docs/plans/sync-history/design.md` (this document, expanded to drift's 12-section skeleton).

### Deferred follow-ups (out of scope)

- **#27 Sync Timeline / trends** — this PR's append-only table is the data source; timeline visualization is a later feature. #17 _enables_ #27.
- **Subsection-level MediaManagement granularity** — MM flattens `mediaSettings`/`naming`/`qualityDefinitions` into one `SyncResult` (`mediaManagement/syncer.ts:730-865`); faithful per-subsection history needs an MM return refactor. Store the joined error for now.
- **entityType as a first-class SQL filter** — the entity set is arr-specific and lives in the `changes` JSON blob; Phase 1 supports a coarse `section` filter (LIKE against `sections_attempted`) and defers per-entity-type SQL filtering.
- **Per-row diff-blob size cap / truncation policy** — flagged (drift design §12 open question); add a follow-up if blob bloat appears in practice.
- **Non-Discord notification channels** — only Discord is implemented (`NotificationManager.ts:121-146`).
- **Keyset pagination** — house style is OFFSET (see `notificationHistory.getHistory`); note the known mid-pagination skew, defer keyset.

---

## 2. Data Model

### 2.1 Grain decision: one row per instance-sync-run (single table, not parent/child)

The recording choke point `arrSyncHandler` (`arrSync.ts:292`) runs **one instance at a time** — the processor (`$sync/processor.ts`) fans out instances at `CONCURRENCY_LIMIT=3`, each dispatched through `arrSyncHandler` separately, and `executeSyncJob` also calls `arrSyncHandler` directly with a synthetic `job.id=0` (`arrSync.ts:89-119`). So the natural audit grain is **one `sync_history` row per instance sync run**, with the per-section breakdown carried in a JSON column. No `run → instances` parent/child table is needed (that shape from `startup_pull_runs` fits multi-instance-per-run operations; sync jobs are per-instance). This keeps writes single-statement-atomic and dodges the `db.transaction` re-entrancy hazard documented at `driftStatus.ts:126-132`.

### 2.2 Detail-vs-storage decision (grounded in what `syncer.sync()` exposes)

`SyncResult = { success, itemsSynced, error?, failedProfiles? }` (`packages/praxrr-app/src/lib/server/sync/types.ts:17-22`) is **counts-only**; per-entity before/after is currently built internally (e.g. `SyncedProfileSummary`, `qualityProfiles/syncer.ts:84-91`) but only logged, then discarded (`syncer.ts:311-322`). The field-level diff machinery (`diffSingletonEntity`/`diffEntityCollection`/`diffToFieldChanges`, `preview/sectionDiffs.ts`, `preview/diff.ts:288`) is only invoked by the read-only `generatePreview()`, never by the sync path.

Decision: store two tiers.

- **`section_results` (always populated, zero contract change):** per-section `{ section, status, itemsSynced, error, failedProfiles }`. Retain each loop iteration's `SyncResult` (currently dropped at `arrSync.ts:436`).
- **`changes` (full before/after, this PR):** `SyncEntityChange[]` (= `EntityChange` + `{ section, category }`, identical to `DriftEntityChange`, `sync/drift/types.ts:47-55`). Populated by extending each syncer's return to `SyncResult & { changes?: EntityChange[] }`, reusing the _same_ `diffSingletonEntity`/`diffEntityCollection` calls `generatePreview` uses. This yields preview-identical diffs with **no extra Arr GETs** (the syncers already fetch live "current" and build "desired" in-process: QP `syncer.ts:277,284`; Delay `delayProfiles/syncer.ts:282`; MM `mediaManagement/syncer.ts:909,1031,1254`; Metadata `metadataProfiles/syncer.ts:466`). Do **not** re-run `generatePreview` (doubles traffic; can drift from what was actually written) and do **not** reuse `previewStore` (ephemeral 10-min TTL, unlinked to runs) or `pcd_snapshots` (PCD op fingerprints, not Arr values).

**Direction is load-bearing:** `FieldChange.current` = live/old, `FieldChange.desired` = PCD/new — identical to drift (`sync/drift/types.ts:42-46`). This is called out as the #1 forbidden mistake; document it in the `SyncEntityChange` type comment and never invert it. `EntityChange.name` is already namespace-normalized (`sectionDiffs.ts` `normalizeNamespaceDisplayName`) — store it as-is so the UI shows clean names.

### 2.3 FK decision: nullable `arr_instance_id` `ON DELETE SET NULL` + denormalized snapshot

An audit trail MUST survive instance deletion. Drift's `ON DELETE CASCADE` is wrong here. Use a **nullable** `arr_instance_id INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL` plus denormalized `instance_name` and `arr_type` snapshotted into the row (the `startup_pull_instance_outcomes` pattern, `startupPull.ts:22-34`). Deleted-instance rows keep rendering (name + type intact, `arr_instance_id` becomes NULL); filtering by a still-existing instance keys on the stored `arr_instance_id`.

### 2.4 DDL — `sync_history` (append-only)

```sql
CREATE TABLE sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arr_instance_id INTEGER REFERENCES arr_instances(id) ON DELETE SET NULL,
  instance_name TEXT NOT NULL,
  arr_type TEXT NOT NULL CHECK (arr_type IN ('radarr', 'sonarr', 'lidarr')),
  job_id INTEGER,                      -- nullable metadata; executeSyncJob uses synthetic id 0
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule', 'system')),
  trigger_event TEXT CHECK (trigger_event IN ('on_pull', 'on_change') OR trigger_event IS NULL),
  sections_attempted TEXT NOT NULL DEFAULT '[]',  -- JSON: string[] of requested section keys
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  sections_run INTEGER NOT NULL DEFAULT 0,
  items_synced INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  entity_change_count INTEGER NOT NULL DEFAULT 0,
  section_results TEXT NOT NULL DEFAULT '[]',      -- JSON: SyncSectionResult[]
  changes TEXT NOT NULL DEFAULT '[]',              -- JSON: SyncEntityChange[]
  error TEXT,
  started_at TEXT NOT NULL,             -- ISO-8601 UTC (new Date().toISOString())
  finished_at TEXT,                     -- ISO-8601 UTC, nullable
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP  -- bookkeeping
);

CREATE INDEX idx_sync_history_started_at ON sync_history(started_at DESC);
CREATE INDEX idx_sync_history_instance ON sync_history(arr_instance_id);
CREATE INDEX idx_sync_history_status ON sync_history(status);
CREATE INDEX idx_sync_history_trigger ON sync_history(trigger);
CREATE INDEX idx_sync_history_arr_type ON sync_history(arr_type);
```

`down` drops the five indexes then the table (the `026_create_upgrade_runs.ts:88-93` teardown pattern).

**Timestamp convention** (documented at `20260709_create_drift_tables.ts:13-15`): `started_at`/`finished_at` are ISO-8601 TEXT written from JS; `created_at` is bookkeeping `CURRENT_TIMESTAMP`. **Footgun:** `CURRENT_TIMESTAMP`/`datetime('now')` emit `'YYYY-MM-DD HH:MM:SS'` (no `T`/`Z`), so all date-range filters and retention DELETEs MUST wrap the ISO column in `datetime(...)` — never raw string compare (see `jobQueue.getNextDueQueued`, `jobQueue.ts:187`; retention form at `upgradeRuns.ts:189-195`).

### 2.5 DDL — `sync_history_settings` (singleton)

```sql
CREATE TABLE sync_history_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days >= 1),
  retention_max_entries INTEGER NOT NULL DEFAULT 10000 CHECK (retention_max_entries >= 0),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sync_history_settings (id) VALUES (1);
```

Mirrors `backup_settings` (`005_create_backup_settings.ts`) and `drift_check_settings` (`20260709_create_drift_tables.ts:22-35`). Seed row inserted in the same `up`.

### 2.6 Migration registration

`packages/praxrr-app/src/lib/server/db/migrations/20260710_create_sync_history_tables.ts` exports `const migration: Migration = { version: 20260710, name: 'Create sync history tables', up, down };`. Register in **both** spots of `packages/praxrr-app/src/lib/server/db/migrations.ts`: (1) a static import near line 73, and (2) append to the `migrations` array in `loadMigrations()` after `migration20260709CreateDriftTables` (line ~373). Missing either = silently never runs. This is app-DB, so do **not** touch `seedBuiltInBaseOps.ts` (that guardrail is PCD-only).

### 2.7 Query-module shapes

`db/queries/syncHistory.ts` — snake_case `SyncHistoryRow` byte-aligned to columns; camelCase `SyncHistoryRecord` / `SyncHistoryDetail` with `changes`/`section_results`/`sections_attempted` parsed via defensive `try/catch` returning `[]` (the `driftStatus.parseChanges` pattern, `driftStatus.ts:68-75`); private `rowToRecord`/`toDetail` mapper; single exported `const syncHistoryQueries = { ... }`. Methods: `insert(input)` (plain `db.execute` INSERT + `SELECT last_insert_rowid()` for the id, `jobRunHistory.ts:57-58`), `getById(id)`, `search(filters)`, `count(filters)`, `pruneOlderThan(days)`, `pruneBeyondMaxEntries(max)`. Extract one shared `buildWhere(filters): { clause, params }` and feed **both** `search` and `count` so pagination totals never diverge from rows (no existing module shares this — a known drift trap).

`db/queries/syncHistorySettings.ts` — `SyncHistorySettings` (snake_case) + `UpdateSyncHistorySettingsInput` (camelCase optional `enabled?`, `retentionDays?`, `retentionMaxEntries?`) + `syncHistorySettingsQueries = { get, update, reset }`. Use drift's self-healing `get()` (`INSERT OR IGNORE ... VALUES (1)` then read, `driftSettings.ts:33-43`) so the handler never receives `undefined`.

---

## 3. Recording Integration

**Hook point:** inside `arrSyncHandler` (`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:292`) — the single choke point. Both the manual path (`executeSyncJob`, `arrSync.ts:89-119`, synthetic `job.id=0`) and queue/scheduled dispatch land here, so recording once here covers all triggers. Do **not** hook in `executeSyncJob` (it merely delegates).

**Refactor pattern:** the handler has ~8 terminal exits (invalid id `:295`, disabled/missing `:300`, no sections `:307`, unsupported type `:312`, credential-failure `:316-352` which auto-disables the instance _before_ the section loop, per-section skips `:380-426`, section success/fail/throw `:438-454`, reschedule branch `:466-481`). Wrap the body in an inner async fn that returns a structured result; capture `startedAt` at the top; on every exit build a `SyncHistoryInput` and call the recorder once, then return the original `JobHandlerResult`. This guarantees credential-failure and skip paths are captured (a naive "record per section" hook would miss them).

**Retain per-section results:** collect `{ section, result }[]` in the loop (currently `result` is dropped at `:436`). Combine with the skip reasons already pushed into `results: string[]` to build `section_results`.

**Status mapping (add `partial`):** today the handler collapses to `ranSections===0 ? 'skipped' : failures>0 ? 'failure' : 'success'` (`arrSync.ts:477-481`). For history, compute a 4-value status:

- `skipped` — `ranSections === 0`.
- `failed` — `failures > 0 && itemsSynced === 0` (incl. credential-failure with zero sections run).
- `partial` — `failures > 0 && itemsSynced > 0` (QP `failedProfiles`, mixed MM subsections).
- `success` — `failures === 0 && ranSections > 0`.

**Recorder module:** `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts` exports `recordSyncHistory(input): void` — **never throws** (wrap in `try/catch`, log at error level on write failure; a silently-dropped audit record is worse than a noisy one). This mirrors the best-effort contract of `snapshotService.createAutoSnapshot` (`pcd/snapshots/service.ts:305-316`) and drift's `persist.ts:11-12`. It computes `finished_at`/`duration_ms`, sets `entity_change_count = changes.length`, serializes JSON blobs, calls `syncHistoryQueries.insert`, then fires the failed-sync notification (§7). Gate the whole thing on `syncHistorySettingsQueries.get().enabled` so users can disable recording.

**Trigger fidelity:** `trigger` maps from `job.source` (`'manual' | 'schedule' | 'system'`). Event-triggered syncs currently arrive as `source: 'system'` with the on_pull/on_change event lost (`processor.ts:419-455`). Small in-scope enhancement: thread the event into `job.payload` in `triggerSyncs()` and persist it as `trigger_event`, so the audit trail distinguishes pull vs change. If payload plumbing proves larger than expected, ship `trigger_event` as always-NULL and defer to a follow-up.

**Concurrency:** the recorder writes a single-statement `INSERT` — never open `db.transaction` inside it (the sync may already hold one; bare `BEGIN` is non-reentrant on the shared connection, `driftStatus.ts:126-132`).

**Service-layer files** under `packages/praxrr-app/src/lib/server/sync/syncHistory/`:

- `types.ts` — `SyncTrigger`, `SyncOperationStatus`, `SyncSectionResult`, `SyncEntityChange` (= `EntityChange` + `{ section, category }`), `SyncHistoryInput`; reuse `EntityChange`/`FieldChange` from `$sync/preview/types.ts` verbatim; document the current=old / desired=new direction.
- `record.ts` — the never-throwing recorder (above).
- `responses.ts` — `toSyncHistorySummary(record)` / `toSyncHistoryDetail(record)` API mappers (drift's `responses.ts` pattern).

**Syncer contract change** (for full diffs): extend the four `sync()` overrides to return `SyncResult & { changes?: EntityChange[] }`, populating `changes` from the diff calls they already have the inputs for. If `changes` is absent (e.g. a section that can't cheaply diff), the detail view degrades to `section_results` only.

---

## 4. Retention & Pruning

**JobType:** add `'sync.history.cleanup'` to the `JobType` union (`packages/praxrr-app/src/lib/server/jobs/queueTypes.ts:15`) and map it to `ArrSyncCleanupOnlyPayload` (`Record<string, never>`) in `JobPayloadByType` (`queueTypes.ts:83`) — no payload, like `logs.cleanup`.

**Handler:** `packages/praxrr-app/src/lib/server/jobs/handlers/syncHistoryCleanup.ts`, cloned from `logsCleanup.ts`:

1. `const settings = syncHistorySettingsQueries.get();`
2. If `settings.enabled !== 1` → `return { status: 'cancelled', output: 'Sync history disabled' };`
3. `const byAge = syncHistoryQueries.pruneOlderThan(settings.retention_days);` then `const byCount = syncHistoryQueries.pruneBeyondMaxEntries(settings.retention_max_entries);` (age first, then cap remaining).
4. `const nextRun = calculateNextRunFromSchedule('daily');` (`scheduleUtils.ts:26-64`).
5. Return `{ status: byAge + byCount > 0 ? 'success' : 'skipped', output: 'Pruned N (age) + M (cap)', rescheduleAt: job.source === 'schedule' ? nextRun : undefined }`. **`rescheduleAt` is what makes it recur** (`dispatcher.ts:142-145`); gating on `source === 'schedule'` prevents a manual "Run now" from self-perpetuating.
6. End of file: `jobQueueRegistry.register('sync.history.cleanup', handler);`.

**Registration:** add `import './syncHistoryCleanup.ts';` to `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts` (side-effect import — omitting it means `jobQueueRegistry.get(...)` returns `undefined`).

**Schedule:** add `scheduleSyncHistoryCleanup()` to `packages/praxrr-app/src/lib/server/jobs/schedule.ts` modeled on `scheduleLogCleanup()` (`schedule.ts:156-173`): read the singleton; if disabled `jobQueueQueries.cancelByDedupeKey('sync.history.cleanup')` and return; else `jobQueueQueries.upsertScheduled({ jobType: 'sync.history.cleanup', runAt: calculateNextRunFromSchedule('daily'), payload: {}, source: 'schedule', dedupeKey: 'sync.history.cleanup' })` then `notify(runAt)`. Call it inside `scheduleAllJobs()` (near `schedule.ts:222`) and re-export it from `packages/praxrr-app/src/lib/server/jobs/init.ts` (block at lines 22-31) so the settings route can reschedule after a config change. `dedupeKey` must be globally unique/stable (UNIQUE partial index, migration 049).

**Pruning queries** (`db/queries/syncHistory.ts`), returning `db.execute` affected-row counts:

```sql
-- pruneOlderThan(days)
DELETE FROM sync_history WHERE datetime(started_at) < datetime('now', '-' || ? || ' days');
-- pruneBeyondMaxEntries(max)  -- NO precedent in codebase; keep-newest-M
DELETE FROM sync_history
WHERE id NOT IN (SELECT id FROM sync_history ORDER BY started_at DESC, id DESC LIMIT ?);
```

The max-entries delete is new ground — `idx_sync_history_started_at` backs the `ORDER BY`. If it proves slow on large tables, switch to a threshold-id variant (`DELETE WHERE id < (SELECT min(id) FROM (... LIMIT ?))`) and benchmark. No FK cascade concerns since it's a single table.

**Display label:** add a case `'sync.history.cleanup' => 'Sync History Cleanup'` to `packages/praxrr-app/src/lib/server/jobs/display.ts` (`formatJobTypeLabel`, `:10-47`).

**Settings query module:** `db/queries/syncHistorySettings.ts` (see §2.7). The settings PATCH route (§5) calls `scheduleSyncHistoryCleanup()` after persisting so enable/disable takes effect immediately.

---

## 5. API Contract

Contract-first, all under `/api/v1/*`, `{ error: string }` envelope (`ErrorResponse`, `docs/api/v1/schemas/arr.yaml:519-526`), explicit `arr_type` (`radarr|sonarr|lidarr`), 500 only on internal error.

### 5.1 OpenAPI authoring

New files:

- `docs/api/v1/schemas/sync-history.yaml` — component schemas: `SyncHistoryEntry` (list row summary), `SyncHistoryListResponse` (`{ items, page, pageSize, totalRecords, totalPages, hasNext }`, mirroring `arr.yaml:325-357`), `SyncHistoryDetail` (adds `sectionResults` + `changes`), `SyncSectionResult`, `SyncEntityChange`, `SyncHistorySettings`, `SyncHistorySettingsUpdate`. Reuse via `$ref`: `../schemas/sync.yaml#/FieldChange`, `#/SyncPreviewSection`, `#/SyncPreviewAction`, and `../schemas/arr.yaml#/ErrorResponse`. Nullable via `oneOf: [{ type: string }, { type: 'null' }]`.
- `docs/api/v1/paths/sync-history.yaml` — operation groups `list`, `detail`, `export`, `settings`.

Edit `docs/api/v1/openapi.yaml`: add a `Sync History` tag (near line 45); register paths `/sync-history`, `/sync-history/{id}`, `/sync-history/export`, `/sync-history/settings` as `$ref` entries (mirror `openapi.yaml:629-634`); register each schema under `components.schemas` (mirror `:648-654`).

### 5.2 Routes

`packages/praxrr-app/src/routes/api/v1/sync-history/`:

| Route file            | Method         | Purpose                        |
| --------------------- | -------------- | ------------------------------ |
| `+server.ts`          | `GET`          | List with filters + pagination |
| `[id]/+server.ts`     | `GET`          | Detail by id (full diff)       |
| `export/+server.ts`   | `GET`          | Streamed JSON/CSV download     |
| `settings/+server.ts` | `GET`, `PATCH` | Retention config               |

Import handlers-style from `@sveltejs/kit` (`json`, `type RequestHandler`); type bodies against generated `components['schemas'][...]` with `satisfies` (the `arr/library/+server.ts:20-22` discipline).

**`GET /api/v1/sync-history`** — query params (read via `url.searchParams.get`, typed parse helpers mirroring `arr/library/+server.ts:78-146`):

| Param         | Type                                     | Notes                                                             |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `instanceId`  | int > 0                                  | filters `arr_instance_id`                                         |
| `arrType`     | enum `radarr\|sonarr\|lidarr`            |                                                                   |
| `status`      | enum `success\|partial\|failed\|skipped` |                                                                   |
| `trigger`     | enum `manual\|schedule\|system`          |                                                                   |
| `section`     | string                                   | coarse LIKE on `sections_attempted`                               |
| `from` / `to` | ISO date-time                            | validated via `Date.parse`; `datetime(started_at) >= datetime(?)` |
| `q`           | string                                   | free-text on `instance_name`/`error`                              |
| `page`        | int ≥ 1, default 1                       |                                                                   |
| `pageSize`    | int, default 100, cap 250                | `^[0-9]+$`, caps to max rather than erroring                      |

DB-level `WHERE` + `LIMIT/OFFSET` (not the in-memory slice `arr/library` uses — history can be large). Parse errors → `400` with message. `200` → `SyncHistoryListResponse`.

**`GET /api/v1/sync-history/{id}`** — `parseId` (`Number.isInteger && > 0`, else `400`); `404` unknown id; `200` → `SyncHistoryDetail`.

**`GET /api/v1/sync-history/export`** — same filter params plus a `format` param (enum `json|csv`, default `json`). Runs the same filtered search (no pagination, high cap). Returns a raw `Response` with a `Content-Type` of `text/csv; charset=utf-8` or `application/json` and a `Content-Disposition: attachment` filename (the `api/backups/download` pattern), but keeps `400`/`404` as the `json({ error })` envelope (not SvelteKit `error()`) for v1 consistency. CSV is one row per `sync_history` entry — scalar columns plus `changes`/`section_results` as JSON-encoded cells — with hand-written RFC-4180 escaping (quote fields containing quotes, commas, or newlines; double embedded quotes).

**`GET /api/v1/sync-history/settings`** → `200` `SyncHistorySettings`. **`PATCH`** — `try/catch request.json()` → `400 'Invalid JSON body'`; per-field `typeof`/`Number.isInteger`/range validation (drift `settings/+server.ts:24-56`); persist via `syncHistorySettingsQueries.update`; call `scheduleSyncHistoryCleanup()`; return updated settings. Status codes: `200`, `400` (invalid), `500` (internal only).

### 5.3 Type-gen plan

After editing YAML: `deno task generate:api-types` (openapi-typescript → `packages/praxrr-app/src/lib/api/v1.d.ts`). Per MEMORY, a full regen emits ~3300 lines of tool-version noise and is **not** CI-gated — commit only the net-new sync-history additions, not a full local regen. Before any `praxrr-api` publish, `deno task bundle:api` refreshes `packages/praxrr-api/openapi.json` (prettier-gated — `prettier --write` after) + `types.ts`; that runs only in `publish-api.yml`, not per-PR.

---

## 6. UI

**Model: SSR + URL-query-param filtering** (the `routes/arr/[id]/logs` pattern), NOT client-side reactive filtering — the audit trail is large, retention-pruned, and must be deep-linkable/shareable.

### 6.1 List page — `routes/sync-history/`

`+page.server.ts` `load({ url })`: parse `page`, `pageSize`, `q`, `instanceId`, `arrType`, `status`, `trigger`, `section`, `from`, `to` from `url.searchParams`; call `syncHistoryQueries.search` + `count` server-side; also load the eligible-instance picker (`arrInstancesQueries.getEnabled().filter(isSyncPreviewArrType)`, id/name/type only — no credentials, per drift `+page.server.ts:20-31`); return `{ rows, total, filters, instances }`.

`+page.svelte` (no-runes: `export let data: PageData`, `$:`, `on:click`/`on:change`, `bind:`, `$store`):

- **Filter bar** from existing primitives: `ActionsBar` wrapping `SearchAction` (free-text `q`), `ActionButton` + `Dropdown` + `DropdownItem` for status / trigger / section, an instance selector (`SourceFilterAction` or `SearchDropdown`), `arrType` filter, and two `DateInput`s for `from`/`to` (no date-range component exists; parse to UTC bounds server-side).
- **`updateParams(params)`** helper copied from logs (`routes/arr/[id]/logs/+page.svelte:96-131`): build `new URL($page.url)`, set/delete searchParams (delete when undefined/`'ALL'`/empty), always reset `page: 1` on filter change, `goto(url.toString(), { invalidateAll: true })`. Import `goto` from `$app/navigation`, `page` from `$app/stores`.
- **KPI tiles**: `<CardGrid columns={4}>` (total / success / partial / failed) like drift's dashboard (`routes/drift/+page.svelte:169-186`).
- **Table** (`$ui/table/Table.svelte`, `Column<SyncHistoryRow>[]`): timestamp (`toLocaleString`), trigger `Badge`, instance `<Badge variant={row.arrType}>` (per-arr colors), status `Badge` via new `syncHistoryStatus.ts` helper, counts summary. `rowHref={(row) => \`/sync-history/${row.id}\`}`for deep-link navigation. Do **not** pass Table's`pageSize` (that's infinite-scroll) — use server pagination with the hand-rolled prev/next markup from the logs page.
- **Export button**: `Button` (icon `Download`) as an anchor with `href` → `/api/v1/sync-history/export` + current `$page.url.searchParams` + `format`. Do **not** reuse the settings-logs client `Blob` helper — it only serializes the current page.
- `EmptyState` for no history; `alertStore.add` for feedback.

### 6.2 Detail page — `routes/sync-history/[id]/`

`+page.server.ts`: validate the param with `/^\d+$/`, return `{ id, error }` inline on bad input — never throw a SvelteKit error page (drift `[instanceId]/+page.server.ts:11-20`). Fetch the detail (SSR or client fetch of `/api/v1/sync-history/{id}` with the `requestId` race-guard, `routes/drift/[instanceId]/+page.svelte:25-93`).

`+page.svelte`: metadata header (timestamp, trigger + `trigger_event`, instance `Badge`, arr-type `Badge`, status `Badge`, duration, error text); per-section outcome list from `section_results`; grouped entity diffs. **Reuse the diff renderer** — `SyncEntityChange` shares `FieldChange` shape and current=old/desired=new direction with drift, so either import `$ui/drift/DriftFieldDiff.svelte` directly or add a thin `$ui/sync-history/SyncHistoryDiff.svelte` wrapping the same `FIELD_META` + `formatFieldValue` from `$ui/resolved/fieldChangeDisplay.ts`. Prefer a dedicated `SyncHistoryDiff.svelte` (own type import, own direction comment) to avoid coupling to drift's type. Raw error/JSON via `JsonView` + `Modal` (`$ui/meta/`) if needed.

### 6.3 Shared helper + nav

- `packages/praxrr-app/src/lib/client/ui/sync-history/syncHistoryStatus.ts` — `SYNC_HISTORY_STATUS_LABEL: Record<SyncOperationStatus, string>` + `syncHistoryStatusVariant(status): 'success'|'warning'|'danger'|'neutral'` (success→success, partial→warning, failed→danger, skipped→neutral). Single source for list + detail (the `$ui/drift/driftStatus.ts` pattern). `Badge` variants are a closed union — map every status explicitly (`partial` needs `warning`).
- Nav: add to `packages/praxrr-app/src/lib/server/navigation/registry.ts` as the first `operations` group child (that group exists at order 3 with zero items today): `{ id: 'operations.sync_history', label: 'Sync History', href: '/sync-history', groupId: ensureGroupId('operations'), order: 1, arrScope: scopeAll, mobilePriority: 'medium', iconKey: 'History', emoji: '📜', hasChildren: false }`.

---

## 7. Notifications

**Smallest correct integration, in scope (small).** The Arr push-sync pipeline emits nothing today. Add **new** events `sync.failed` and `sync.partial` — do **not** reuse `pcd.sync_failed`, which semantically means git-PCD-pull failure (`pcd.sync` handler, `jobs/handlers/pcdSync.ts`) and would conflate two operations (a cross-operation ambiguity the CLAUDE.md policy says to fail-fast on).

Register the events in both places: `NotificationTypes` (`packages/praxrr-app/src/lib/server/notifications/types.ts:10-34`) and the UI catalog `notificationTypes[]` (`packages/praxrr-app/src/lib/shared/notifications/types.ts:16-136`) under a **new `Sync` category** so users toggle it independently.

Fire from the **same** `recordSyncHistory()` hook (§3), after the record write, when `status` is `failed`/`partial`. Use the fluent builder + `.send()` (drift `persist.ts:137-147`), NOT the rename/upgrade direct-notifier bypass — `.send()` applies the `enabled_types` filter and auto-records `notification_history` (`NotificationManager.ts:96-115`). Always set `.generic(title, message)` (the history row's title/message come only from `generic`). Strict fire-and-forget with `.catch(() => {})` — a webhook failure must never affect the audit write or the sync result. Embed: `author` = `${getInstanceIcon(arrType)} ${instanceName}`, color `Colors.FAILED` (failed) / `Colors.WARNING` (partial), fields listing failed sections + `error` + `failedProfiles`, a `Details` field linking to `/sync-history/{id}`. Keep it a **summary + link** (counts + first-N failures) — Discord has embed size limits (rename/upgrade hand-roll chunking); the full diff lives in the detail route.

Note: the "new service" flow defaults `enabled_types` to all types (`routes/settings/notifications/new/+page.server.ts:43`), so new services auto-subscribe to `sync.*`. Acceptable default; document it.

If time-boxed out, **defer** cleanly by shipping the events registered but unemitted — but emitting from the existing hook is ~one call site, so include it.

---

## 8. File Inventory

Shared registration points (single-owner, careful edits) marked **[SHARED]**.

### Database layer

| Path                                                                                      | New/Mod          | Purpose                                                       |
| ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/db/migrations/20260710_create_sync_history_tables.ts` | New              | `sync_history` + `sync_history_settings` DDL + indexes + seed |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                     | **Mod [SHARED]** | Static import + `loadMigrations()` array append               |
| `packages/praxrr-app/src/lib/server/db/queries/syncHistory.ts`                            | New              | Insert / search / count / getById / prune                     |
| `packages/praxrr-app/src/lib/server/db/queries/syncHistorySettings.ts`                    | New              | Singleton get/update/reset                                    |

### Sync / recording layer

| Path                                                                 | New/Mod | Purpose                                                                                       |
| -------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/sync/syncHistory/types.ts`       | New     | `SyncTrigger`/`SyncOperationStatus`/`SyncSectionResult`/`SyncEntityChange`/`SyncHistoryInput` |
| `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts`      | New     | Never-throwing recorder + notification fire                                                   |
| `packages/praxrr-app/src/lib/server/sync/syncHistory/responses.ts`   | New     | `toSyncHistorySummary`/`toSyncHistoryDetail`                                                  |
| `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`        | Mod     | Refactor exits → single `recordSyncHistory` call; retain per-section results; 4-value status  |
| `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`  | Mod     | Return `changes?: EntityChange[]`                                                             |
| `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`    | Mod     | Return `changes?`                                                                             |
| `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`  | Mod     | Return `changes?`                                                                             |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts` | Mod     | Return `changes?`                                                                             |
| `packages/praxrr-app/src/lib/server/sync/types.ts`                   | Mod     | Extend `SyncResult` with optional `changes?: EntityChange[]`                                  |
| `packages/praxrr-app/src/lib/server/sync/processor.ts`               | Mod     | Thread `trigger_event` into job payload (`triggerSyncs`)                                      |

### Jobs / retention layer

| Path                                                                     | New/Mod          | Purpose                                                      |
| ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/jobs/handlers/syncHistoryCleanup.ts` | New              | Age + max-entries prune handler; self-registers              |
| `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`              | **Mod [SHARED]** | Side-effect import of the handler                            |
| `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`                  | **Mod [SHARED]** | `JobType` union + `JobPayloadByType` entry                   |
| `packages/praxrr-app/src/lib/server/jobs/schedule.ts`                    | **Mod [SHARED]** | `scheduleSyncHistoryCleanup()` + call in `scheduleAllJobs()` |
| `packages/praxrr-app/src/lib/server/jobs/init.ts`                        | Mod              | Re-export `scheduleSyncHistoryCleanup`                       |
| `packages/praxrr-app/src/lib/server/jobs/display.ts`                     | Mod              | Label case                                                   |

### Notifications

| Path                                                        | New/Mod | Purpose                                |
| ----------------------------------------------------------- | ------- | -------------------------------------- |
| `packages/praxrr-app/src/lib/server/notifications/types.ts` | Mod     | `SYNC_FAILED`/`SYNC_PARTIAL` constants |
| `packages/praxrr-app/src/lib/shared/notifications/types.ts` | Mod     | Catalog entries + new `Sync` category  |

### API layer

| Path                                                                     | New/Mod                     | Purpose                                     |
| ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------- |
| `docs/api/v1/schemas/sync-history.yaml`                                  | New                         | Component schemas                           |
| `docs/api/v1/paths/sync-history.yaml`                                    | New                         | Path operations                             |
| `docs/api/v1/openapi.yaml`                                               | **Mod [SHARED]**            | Tag + path + schema `$ref` registration     |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                | **Mod [SHARED, generated]** | Net-new type additions only (no full regen) |
| `packages/praxrr-app/src/routes/api/v1/sync-history/+server.ts`          | New                         | List GET                                    |
| `packages/praxrr-app/src/routes/api/v1/sync-history/[id]/+server.ts`     | New                         | Detail GET                                  |
| `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`   | New                         | Export GET                                  |
| `packages/praxrr-app/src/routes/api/v1/sync-history/settings/+server.ts` | New                         | Settings GET/PATCH                          |

### UI layer

| Path                                                                        | New/Mod          | Purpose                           |
| --------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| `packages/praxrr-app/src/routes/sync-history/+page.server.ts`               | New              | SSR list load                     |
| `packages/praxrr-app/src/routes/sync-history/+page.svelte`                  | New              | Filter bar + KPI + table + export |
| `packages/praxrr-app/src/routes/sync-history/[id]/+page.server.ts`          | New              | Param validation                  |
| `packages/praxrr-app/src/routes/sync-history/[id]/+page.svelte`             | New              | Detail + full diff                |
| `packages/praxrr-app/src/lib/client/ui/sync-history/SyncHistoryDiff.svelte` | New              | Before/after diff renderer        |
| `packages/praxrr-app/src/lib/client/ui/sync-history/syncHistoryStatus.ts`   | New              | Status label/variant              |
| `packages/praxrr-app/src/lib/server/navigation/registry.ts`                 | **Mod [SHARED]** | Nav entry (operations group)      |

### Tests & docs

| Path                                                            | New/Mod          | Purpose                                     |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------- |
| `packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts`   | New              | Query module                                |
| `packages/praxrr-app/src/tests/db/syncHistoryRetention.test.ts` | New              | Prune (age + count)                         |
| `packages/praxrr-app/src/tests/sync/syncHistoryRecord.test.ts`  | New              | Recording integration                       |
| `packages/praxrr-app/src/tests/routes/syncHistory.test.ts`      | New              | API handlers                                |
| `packages/praxrr-app/src/tests/jobs/syncHistoryCleanup.test.ts` | New              | Cleanup job handler                         |
| `scripts/test.ts`                                               | **Mod [SHARED]** | `sync-history` alias                        |
| `docs/plans/sync-history/design.md`                             | New              | This document (commit as `docs(internal):`) |

---

## 9. Test Plan

Each DB-touching suite copies the local `migratedTest(name, fn)` closure verbatim (no shared harness — repo convention; `db/driftQueries.test.ts:16-39`): unique `/tmp/praxrr-tests/<prefix>-${crypto.randomUUID()}` base path, `db.close()` before `config.setBasePath()`, `db.initialize()` + `runMigrations()`, `finally` cleanup. Assertions from `@std/assert`. Route files start with the `/// <reference path="../../app.d.ts" />` ambient comment (`deno test <dir>` type-checks routes even though `deno check` excludes them). Seed instance names with `crypto.randomUUID()` to dodge case-insensitive uniqueness. Use `crypto.randomUUID` and explicit radarr/sonarr/lidarr instances; assert per-`arr_type` correctness (no cross-Arr parity). Reset module-global state (rate limiters, dispatcher) up-front and in `finally`; `sanitizeOps: false` where timers/fire-and-forget notify work runs.

| Test file                         | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/syncHistoryQueries.test.ts`   | `PRAGMA table_info` confirms columns/CHECKs; insert→getById round-trips `changes`/`section_results` JSON exactly; each filter independently (instanceId, arrType, status, trigger, section-LIKE, from/to date range) + combined; pagination LIMIT/OFFSET stable id ordering; `search`/`count` use the same `buildWhere` (totals match rows); unknown id → undefined; empty result; re-running migrations idempotent                                                                      |
| `db/syncHistoryRetention.test.ts` | Seed rows with controlled `started_at` + beyond max-entries; `pruneOlderThan(days)` deletes old, keeps recent, returns count; `pruneBeyondMaxEntries(max)` keeps newest M; no-op under threshold; default + custom settings; **row count SHRINKS**                                                                                                                                                                                                                                       |
| `sync/syncHistoryRecord.test.ts`  | Via injected deps (no network): exactly one row appended per run; **row count GROWS** across N runs (opposite of drift's stays-1); success/partial/failed/skipped/credential-failure each recorded with correct status, trigger, instance snapshot, error, section_results; recorder never throws when insert fails; `enabled=0` skips recording                                                                                                                                         |
| `routes/syncHistory.test.ts`      | Real migrated DB (not in-memory Map): list GET filters+pagination via `url: new URL('...?status=...&limit=...&offset=...')`; invalid/out-of-range params → 400; detail GET 404 unknown / 200 full diff; export GET json + csv assert `Content-Type` + `Content-Disposition` + body shape; settings GET/PATCH incl. 400 on bad JSON/range; handlers imported from `+server.ts`, events cast via `Parameters<typeof GET>[0]` (populate `url`, `params`, `request`, `locals`, `setHeaders`) |
| `jobs/syncHistoryCleanup.test.ts` | Side-effect import registers handler; `jobQueueRegistry.get('sync.history.cleanup')` exists; disabled → `cancelled`; prunes → `success` with `rescheduleAt` when `source==='schedule'`, `undefined` on manual; zero-prune → `skipped`                                                                                                                                                                                                                                                    |

**Alias** (`scripts/test.ts` `aliases`): `'sync-history': 'packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts,packages/praxrr-app/src/tests/db/syncHistoryRetention.test.ts,packages/praxrr-app/src/tests/sync/syncHistoryRecord.test.ts,packages/praxrr-app/src/tests/routes/syncHistory.test.ts,packages/praxrr-app/src/tests/jobs/syncHistoryCleanup.test.ts'`. Run: `deno task test sync-history`.

---

## 10. Sequencing Hints

**Foundational — must exist first (blocks everything):**

1. `types.ts` (`$sync/syncHistory/types.ts`) — the `SyncEntityChange`/`SyncHistoryInput` shapes every other layer references.
2. Migration `20260710_create_sync_history_tables.ts` + its **two** `migrations.ts` registrations — no query/test works until the tables exist.
3. Query modules `syncHistory.ts` + `syncHistorySettings.ts` (incl. the shared `buildWhere` helper) — the API, recorder, and cleanup handler all depend on these.

**Then, buildable in parallel (disjoint new files):**

- Recorder + syncer contract changes (`record.ts`, `responses.ts`, `arrSync.ts`, four syncers) — depends on types + queries.
- Cleanup handler `syncHistoryCleanup.ts` — depends on settings query + prune methods.
- OpenAPI YAML authoring (`schemas/sync-history.yaml`, `paths/sync-history.yaml`) — independent; do before routes so `v1.d.ts` types exist.
- API routes — depend on queries + generated types.
- UI (`syncHistoryStatus.ts`, `SyncHistoryDiff.svelte`, the four page files) — depend on the API contract shape; `syncHistoryStatus.ts` and the diff component are fully disjoint and can start immediately from the types.
- Tests — each disjoint; can be written against the query/handler/route interfaces as they land.

**Shared files — single-owner, careful/serialized edits (merge-conflict + silent-failure hotspots):**

- `migrations.ts` — both the import block and `loadMigrations()` array (missing either = silent no-run).
- `queueTypes.ts` — `JobType` union + `JobPayloadByType`.
- `handlers/index.ts` — side-effect import (missing = `registry.get` returns undefined, tests fail at `assertExists`).
- `schedule.ts` + `init.ts` — scheduler function + `scheduleAllJobs()` call + re-export.
- `openapi.yaml` — tag + path + schema `$ref` registration.
- `v1.d.ts` — generated; commit net-new additions only (not a full regen).
- `registry.ts` — nav entry.
- `scripts/test.ts` — alias.
- `notifications/types.ts` (server) + `shared/notifications/types.ts` — event registration in both.

Land the foundational three first in one focused change, then fan out the parallel work, editing each shared file exactly once with awareness that a missed registration fails silently rather than at type-check.
