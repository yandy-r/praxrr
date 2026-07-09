# Implementation Plan: Sync History / Audit Trail (Issue #17)

Authoritative dependency-batched plan produced by the planning workflow (2 planners + adversarial synthesis). Tasks within a batch touch disjoint files and run in parallel in one worktree. See `design.md` for the full design (§0 resolutions are authoritative).

## Batch 0

_Foundational layer per design §10 + brief mandate. NOTE: this batch is ALREADY IMPLEMENTED (uncommitted) in the worktree — the migration + BOTH migrations.ts registrations, both query modules, and types.ts exist and export the design shapes. These four tasks are therefore VERIFY-AND-FINALIZE (confirm against §2.2/§2.4/§2.5/§2.7, fix any drift, format, commit as the foundational change) rather than greenfield. Everything downstream imports these; they must land/commit first. All four touch disjoint files._

### `b0-types` — Sync-history service types (verify existing)

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/server/sync/syncHistory/types.ts`
- **Do:** File EXISTS in worktree. Verify against §3/§2.2/§2.6: exports SyncTrigger ('manual'|'schedule'|'system'), SyncTriggerEvent ('on_pull'|'on_change'), SyncOperationStatus ('success'|'partial'|'failed'|'skipped' — NO 'cancelled', R2), SyncSectionResult, SyncEntityChange (extends EntityChange + {section, category}), SyncHistoryInput (recorder input). EntityChange/FieldChange are re-exported verbatim from $sync/preview/types.ts (currently re-exported at L17). Confirm the load-bearing direction comment: FieldChange.current = live/old, FieldChange.desired = PCD/new — never invert (§2.2). No changes expected unless it diverges from design.
- **Acceptance:** deno task check:server passes; SyncOperationStatus has exactly 4 members, no 'cancelled'; direction comment present; EntityChange/FieldChange imported not redeclared.

### `b0-migration` — Migration + BOTH migrations.ts registrations (verify existing)

- **Owner:** orchestrator-shared
- **Files:** `packages/praxrr-app/src/lib/server/db/migrations/20260710_create_sync_history_tables.ts`, `packages/praxrr-app/src/lib/server/db/migrations.ts`
- **Do:** Both files EXIST. Verify the migration exports `const migration: Migration = { version: 20260710, name: 'Create sync history tables', up, down }` with the exact §2.4 sync_history DDL (nullable arr_instance_id REFERENCES arr_instances(id) ON DELETE SET NULL; denormalized instance_name/arr_type; job_id INTEGER nullable; trigger CHECK manual/schedule/system; trigger_event nullable CHECK on_pull/on_change OR NULL; arr_type CHECK radarr/sonarr/lidarr; status CHECK success/partial/failed/skipped — NO cancelled; sections_attempted/section_results/changes TEXT DEFAULT '[]'; ISO started_at/finished_at; five indexes) and §2.5 sync_history_settings singleton (id CHECK id=1, enabled 0/1, retention_days>=1 default 90, retention_max_entries>=0 default 10000) with seed INSERT VALUES (1). down drops five indexes then both tables. Confirm migrations.ts has BOTH the static import (currently L74 migration20260710CreateSyncHistoryTables) AND the loadMigrations() array append (currently L375). Do NOT touch seedBuiltInBaseOps.ts (PCD-only guardrail).
- **Acceptance:** deno task check:server passes; migration imported once + appears once in loadMigrations() array; re-running migrations idempotent (verified at runtime by b6-test-queries PRAGMA table_info).

### `b0-query-history` — syncHistory query module (verify existing)

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/server/db/queries/syncHistory.ts`
- **Do:** File EXISTS. Verify per §2.7/§4: snake_case SyncHistoryRow byte-aligned to columns; camelCase SyncHistorySummary + SyncHistoryDetail (extends Summary, adds sectionResults/changes) with JSON parsed via parseJsonArray defensive try/catch→[]; SyncHistoryFilters, Pagination {limit, offset}; private rowToSummary/rowToDetail. Exported `syncHistoryQueries` with: insert(input): number (bare db.execute INSERT + last_insert_rowid, NO db.transaction), getById(id): SyncHistoryDetail|undefined, search(filters, page): SyncHistorySummary[], count(filters): number, searchAll(filters, cap=50000): SyncHistoryDetail[] (export path), pruneOlderThan(days): number = datetime(started_at) < datetime('now','-'||?||' days'), pruneBeyondMaxEntries(max): number = keep-newest-M via id NOT IN (SELECT id ... ORDER BY started_at DESC, id DESC LIMIT ?). One shared buildWhere(filters) feeds BOTH search and count; all date predicates wrap column in datetime(). CRITICAL: downstream tasks must use these exact export names (Summary/Detail, searchAll for export) — NOT 'SyncHistoryRecord'. Store job_id NULL when synthetic id 0 (R4) — verify insert handles null.
- **Acceptance:** deno task check:server passes; search and count share buildWhere; prune methods return affected-row counts; date filters use datetime() wrapping; export uses searchAll.

### `b0-query-settings` — syncHistorySettings query module (verify existing)

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/server/db/queries/syncHistorySettings.ts`
- **Do:** File EXISTS. Verify per §2.7: SyncHistorySettings (snake_case: id, enabled, retention_days, retention_max_entries, created_at, updated_at), UpdateSyncHistorySettingsInput (camelCase optional enabled?/retentionDays?/retentionMaxEntries?), exported syncHistorySettingsQueries = { get, update, reset }. get() is self-healing (INSERT OR IGNORE ... VALUES (1) then read, driftSettings.ts:33-43 pattern) so callers never get undefined; update() persists provided fields + bumps updated_at; reset() restores defaults (enabled 1 / 90 days / 10000).
- **Acceptance:** deno task check:server passes; get() never returns undefined; update accepts partial camelCase input; reset restores documented defaults.

## Batch 1

_Pure new-file leaves that import ONLY batch-0 types/queries or pre-existing modules and require NO shared-file edit to typecheck. All four are mutually disjoint new files with no cross-deps, so they run fully in parallel. They gate the integration batch (openapi-register needs the yaml) and the routes/UI._

### `b1-responses` — API response mappers

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/server/sync/syncHistory/responses.ts`
- **Depends on:** b0-query-history, b0-types
- **Do:** §3: new file exporting toSyncHistorySummary(record: SyncHistorySummary) and toSyncHistoryDetail(record: SyncHistoryDetail) that map the query-module records to the API summary/detail shapes (detail adds sectionResults + changes) — the drift responses.ts pattern. Import SyncHistorySummary/SyncHistoryDetail from $db/queries/syncHistory.ts (exact names — NOT SyncHistoryRecord). Used by the batch-4 routes.
- **Acceptance:** deno task check:server passes; summary omits changes/sectionResults, detail includes them; imports resolve to existing query-module types.

### `b1-status-helper` — Status label/variant helper

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/client/ui/sync-history/syncHistoryStatus.ts`
- **Depends on:** b0-types
- **Do:** §6.3: new file exporting SYNC_HISTORY_STATUS_LABEL: Record<SyncOperationStatus, string> and syncHistoryStatusVariant(status): 'success'|'warning'|'danger'|'neutral' mapping success→success, partial→warning, failed→danger, skipped→neutral. Map all four exhaustively (Badge variants are a closed union; partial MUST be warning). Import SyncOperationStatus from $sync/syncHistory/types.ts.
- **Acceptance:** deno task check:client passes; exhaustive switch over the 4-member union (adding a status fails typecheck); partial→warning.

### `b1-diff` — SyncHistoryDiff renderer component

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/lib/client/ui/sync-history/SyncHistoryDiff.svelte`
- **Depends on:** b0-types
- **Do:** §6.2: dedicated before/after diff renderer (Svelte 5, no runes: export let, $:, on:*) wrapping the same FIELD_META + formatFieldValue from $ui/resolved/fieldChangeDisplay.ts that drift's DriftFieldDiff.svelte uses. Import SyncEntityChange from $sync/syncHistory/types.ts (own type, NOT drift's) with its own current=old/desired=new direction comment. Renders grouped FieldChange rows for a SyncEntityChange; current on the left, desired on the right.
- **Acceptance:** deno task check:client passes; renders FieldChange rows with correct old/new direction; no drift-type import.

### `b1-openapi-yaml` — OpenAPI schema + path documents

- **Owner:** parallel-agent
- **Files:** `docs/api/v1/schemas/sync-history.yaml`, `docs/api/v1/paths/sync-history.yaml`
- **Do:** §5.1: new schemas/sync-history.yaml with SyncHistoryEntry, SyncHistoryListResponse ({items, page, pageSize, totalRecords, totalPages, hasNext} mirroring arr.yaml:325-357), SyncHistoryDetail (adds sectionResults + changes), SyncSectionResult, SyncEntityChange, SyncHistorySettings, SyncHistorySettingsUpdate; reuse via $ref ../schemas/sync.yaml#/FieldChange, #/SyncPreviewSection, #/SyncPreviewAction, and ../schemas/arr.yaml#/ErrorResponse; nullable via oneOf [{type: string},{type: 'null'}]. New paths/sync-history.yaml with operation groups list/detail/export/settings (query params per §5.2 tables). Run deno task format (docs prettier-gated).
- **Acceptance:** YAML parses; $ref targets resolve; deno task lint (docs prettier) clean after format.

## Batch 2

_Dedicated orchestrator-shared INTEGRATION batch: every shared registration-file edit, plus the two new job/notification files that MUST co-land with their registrations for typecheck. Each task owns a disjoint set of shared files and has NO intra-batch dependency on another batch-2 task, so all five run in parallel. Gated behind batch 0 (queries/types) and batch 1 (openapi yaml for openapi-register)._

### `b2-notif` — Register sync.failed / sync.partial notification events

- **Owner:** orchestrator-shared
- **Files:** `packages/praxrr-app/src/lib/server/notifications/types.ts`, `packages/praxrr-app/src/lib/shared/notifications/types.ts`
- **Do:** §7. In server notifications/types.ts, add to the NotificationTypes object (after DRIFT_DETECTED, currently L33): SYNC_FAILED: 'sync.failed' and SYNC_PARTIAL: 'sync.partial'. Do NOT reuse pcd.sync_failed (that is git-PCD-pull failure — cross-operation ambiguity). In shared/notifications/types.ts append two entries to notificationTypes[] under a NEW 'Sync' category (ids exactly 'sync.failed'/'sync.partial', matching server constants) so users toggle them independently.
- **Acceptance:** deno task check (server+client) passes; both ids present in the server constant map AND the shared catalog under a 'Sync' category; distinct from pcd.sync_failed.

### `b2-jobcleanup` — Retention cleanup handler + all job-registration edits

- **Owner:** orchestrator-shared
- **Files:** `packages/praxrr-app/src/lib/server/jobs/handlers/syncHistoryCleanup.ts`, `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`, `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`, `packages/praxrr-app/src/lib/server/jobs/schedule.ts`, `packages/praxrr-app/src/lib/server/jobs/init.ts`, `packages/praxrr-app/src/lib/server/jobs/display.ts`
- **Depends on:** b0-query-history, b0-query-settings
- **Do:** §4. NEW syncHistoryCleanup.ts cloned from logsCleanup.ts: read syncHistorySettingsQueries.get(); if enabled!==1 return {status:'cancelled', output:'Sync history disabled'} (note: 'cancelled' is a valid JobRunStatus/JobHandlerResult value, queueTypes.ts:21 — distinct from the sync_history.status enum); else byAge=pruneOlderThan(retention_days) then byCount=pruneBeyondMaxEntries(retention_max_entries) (age first); nextRun=calculateNextRunFromSchedule('daily'); return {status: byAge+byCount>0?'success':'skipped', output:'Pruned N (age) + M (cap)', rescheduleAt: job.source==='schedule'?nextRun:undefined}; end-of-file jobQueueRegistry.register('sync.history.cleanup', handler). SHARED edits (each once): queueTypes.ts — add '| 'sync.history.cleanup'' to JobType union (after 'drift.check', L15) and 'sync.history.cleanup': ArrSyncCleanupOnlyPayload to JobPayloadByType (after L83); reuse existing ArrSyncCleanupOnlyPayload (L57), no new payload type. handlers/index.ts — add side-effect import './syncHistoryCleanup.ts'; (after L10). schedule.ts — add exported scheduleSyncHistoryCleanup() modeled on scheduleLogCleanup (L156-173): read syncHistorySettingsQueries.get(); if disabled jobQueueQueries.cancelByDedupeKey('sync.history.cleanup') and return; else jobQueueQueries.upsertScheduled({jobType:'sync.history.cleanup', runAt:calculateNextRunFromSchedule('daily'), payload:{}, source:'schedule', dedupeKey:'sync.history.cleanup'}) then notify(job.runAt); add its import of syncHistorySettingsQueries; call scheduleSyncHistoryCleanup() inside scheduleAllJobs() after scheduleDriftCheck() (L223). init.ts — add scheduleSyncHistoryCleanup to the re-export block (L22-31). display.ts — add case 'sync.history.cleanup': return 'Sync History Cleanup'; to formatJobTypeLabel switch (after 'drift.check', L39).
- **Acceptance:** deno task check:server passes; 'sync.history.cleanup' is a valid JobType with empty-payload JobPayloadByType entry; handler self-registers and is side-effect imported; scheduleSyncHistoryCleanup exported from init.ts and invoked in scheduleAllJobs; disabled path cancels by dedupe key; label resolves. Runtime gates proven by b6-test-cleanup (assertExists on registry) — omitting the index.ts import returns undefined with no type error.

### `b2-openapi-register` — Register sync-history in openapi.yaml + generate types

- **Owner:** orchestrator-shared
- **Files:** `docs/api/v1/openapi.yaml`, `packages/praxrr-app/src/lib/api/v1.d.ts`
- **Depends on:** b1-openapi-yaml
- **Do:** §5.1/§5.3. In openapi.yaml add a 'Sync History' tag under tags (after 'Drift Detection', L43-44); register paths /sync-history, /sync-history/{id}, /sync-history/export, /sync-history/settings as $ref entries (mirror the drift path block L629-634); register each new component schema as $ref under components.schemas (mirror the drift schema block L797-815). Run deno task format (openapi.yaml prettier-gated). Then run deno task generate:api-types and commit ONLY the net-new sync-history schema/path additions to v1.d.ts — NOT the ~3300-line tool-version regen (per MEMORY, full regen is noise and not CI-gated). Routes in batch 4 type bodies against components['schemas'][...] with satisfies.
- **Acceptance:** openapi.yaml parses; all four paths and every new schema $ref-registered; docs prettier clean; deno task check passes; components['schemas'] contains SyncHistoryEntry/Detail/ListResponse/Settings etc.; v1.d.ts diff is net-new only.

### `b2-nav` — Navigation entry (operations group)

- **Owner:** orchestrator-shared
- **Files:** `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- **Do:** §6.3: add to NAV_REGISTRY the first child of the existing 'operations' group (declared in NAV_GROUPS at order 3, currently zero items): { id: 'operations.sync_history', label: 'Sync History', href: '/sync-history', groupId: ensureGroupId('operations'), order: 1, arrScope: scopeAll, mobilePriority: 'medium', iconKey: 'History', emoji: '📜', hasChildren: false }. Confirm 'History' is a valid iconKey; if not, pick an existing valid key (e.g. 'Clock').
- **Acceptance:** deno task check:server passes; nav item resolves under the operations group with href /sync-history; iconKey is valid.

### `b2-testalias` — sync-history test alias

- **Owner:** orchestrator-shared
- **Files:** `scripts/test.ts`
- **Do:** §9: add to the aliases map (alphabetically near other kebab entries) 'sync-history' → comma-joined five paths: packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts,packages/praxrr-app/src/tests/db/syncHistoryRetention.test.ts,packages/praxrr-app/src/tests/sync/syncHistoryRecord.test.ts,packages/praxrr-app/src/tests/routes/syncHistory.test.ts,packages/praxrr-app/src/tests/jobs/syncHistoryCleanup.test.ts.
- **Acceptance:** deno task test sync-history resolves to the five test files (wiring assertion; files land in batch 6).

## Batch 3

_The recorder + arrSync refactor. Isolated in its own batch because record.ts imports the SYNC_FAILED/SYNC_PARTIAL constants added by b2-notif, and arrSync.ts is the riskiest single-owner edit (the sync write path) — keeping it alone minimizes churn and lets it be verified independently. record.ts and arrSync.ts are co-owned by one agent so the recorder call sites and the never-throw contract land atomically._

### `b3-recorder` — Never-throwing recorder + best-effort preview + arrSync recording refactor

- **Owner:** orchestrator-shared
- **Files:** `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts`, `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- **Depends on:** b0-types, b0-query-history, b0-query-settings, b2-notif
- **Do:** AUTHORITATIVE §0 R1/R2/R3/R4/R5. NEW record.ts exports recordSyncHistory(input: SyncHistoryInput): void that NEVER throws (try/catch, log at error on insert failure; NO db.transaction). Gate everything on syncHistorySettingsQueries.get().enabled===1. Owns the R7 flatten helper: best-effort generatePreview({ instance, sections: sectionsToRun }) from $sync/preview/orchestrator.ts wrapped in its OWN try/catch (on ANY failure changes=[] and the entry STILL records); flatten per-section EntityChange[] (filter action==='unchanged') into SyncEntityChange[] with {section, category}; gate the preview call on enabled===1 too. Compute finished_at/duration_ms, entity_change_count=changes.length, call syncHistoryQueries.insert. After the write, when status is failed/partial, fire the §7 notification via the fluent builder .generic(title,message).discord()...send() with strict .catch(()=>{}) fire-and-forget (NotificationTypes.SYNC_FAILED/SYNC_PARTIAL). Persist trigger_event NULL (R3). arrSync.ts refactor (arrSync.ts:292): wrap the body so every terminal exit builds a SyncHistoryInput and calls recordSyncHistory once, then returns the ORIGINAL JobHandlerResult unchanged. Capture startedAt at top. RETAIN each loop iteration's SyncResult ({section,result}[], currently dropped at :436) and SUM result.itemsSynced (R5 — not accumulated today). Compute 4-value status: skipped (ranSections===0), failed (failures>0 && itemsSynced===0, incl. credential-failure), partial (failures>0 && itemsSynced>0), success (failures===0 && ranSections>0). Record ONLY genuine attempts per R2 table: DO NOT record invalid-id (:295) or disabled/missing (:300); record no-sections (:307)→skipped, unsupported-type (:312)→failed, credential-failure (:316-352)→failed. job_id 0 (synthetic manual, :105)→store NULL (R4); trigger from job.source. DO NOT modify the four syncers, sync/types.ts, or sync/processor.ts (R1/R3).
- **Acceptance:** deno task check:server passes; recorder swallows insert+preview+notify failures; enabled=0 short-circuits; thrown generatePreview→changes=[] but row still writes; one row per genuine attempt; disabled/invalid not recorded; items_synced summed drives partial/failed split; job_id NULL for id 0; trigger_event NULL. deno task test filters upgrades (sync regression) stays green — write-path result contract unchanged. Proven by b6-test-record.

## Batch 4

_API routes depend on the generated v1.d.ts types (b2-openapi-register), the responses mapper (b1-responses), the query modules (batch 0), and — for the settings route — the init.ts re-export of scheduleSyncHistoryCleanup (b2-jobcleanup). The four route files are disjoint new files with no cross-dependencies._

### `b4-route-list` — GET /api/v1/sync-history list

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/api/v1/sync-history/+server.ts`
- **Depends on:** b2-openapi-register, b0-query-history, b1-responses
- **Do:** §5.2: GET with typed query-param parse helpers (mirror arr/library/+server.ts:78-146): instanceId(int>0), arrType(radarr|sonarr|lidarr closed enum — no sibling inference), status, trigger, section(LIKE on sections_attempted), from/to(Date.parse, datetime() bounds via buildWhere), q(free-text instance_name/error), page(>=1 default 1), pageSize(default 100 cap 250, caps not errors). DB-level WHERE + LIMIT/OFFSET via syncHistoryQueries.search(filters, {limit, offset}) + count(filters) — not in-memory slice. Parse errors→400 json({error}); 200→SyncHistoryListResponse via toSyncHistorySummary. Type against components['schemas'] with satisfies. Start file with the /// <reference path="...app.d.ts" /> ambient comment so deno test typechecks it.
- **Acceptance:** deno test on routes dir type-checks; b6-test-routes asserts filters+pagination and 400 on bad params; totals equal returned rows.

### `b4-route-detail` — GET /api/v1/sync-history/[id] detail

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/api/v1/sync-history/[id]/+server.ts`
- **Depends on:** b2-openapi-register, b0-query-history, b1-responses
- **Do:** §5.2: parseId (Number.isInteger && >0 else 400 json({error})); syncHistoryQueries.getById; 404 json({error}) on unknown id; 200→SyncHistoryDetail via toSyncHistoryDetail (full changes + sectionResults). Ambient /// <reference> comment.
- **Acceptance:** deno test routes type-checks; b6-test-routes asserts 404 unknown and 200 full-diff shape.

### `b4-route-export` — GET /api/v1/sync-history/export

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/api/v1/sync-history/export/+server.ts`
- **Depends on:** b2-openapi-register, b0-query-history
- **Do:** §5.2: same filter params as list + format(json|csv default json). Use syncHistoryQueries.searchAll(filters, cap) (no LIMIT/OFFSET). Return raw new Response(body, {headers:{'Content-Type': csv?'text/csv; charset=utf-8':'application/json','Content-Disposition':`attachment; filename="sync-history-<ISO>.<format>"`}}) — the backups/download pattern, but keep 400/404 as json({error}) envelope, not SvelteKit error(). CSV = one row per entry, scalar columns + changes/sectionResults as JSON-encoded cells with hand-written RFC-4180 escaping (quote fields containing quote/comma/newline; double embedded quotes). Ambient /// <reference> comment.
- **Acceptance:** deno test routes type-checks; b6-test-routes asserts Content-Type + Content-Disposition + body shape for json and csv incl. escaping of a comma/quote/newline value.

### `b4-route-settings` — GET/PATCH /api/v1/sync-history/settings

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/api/v1/sync-history/settings/+server.ts`
- **Depends on:** b2-openapi-register, b0-query-settings, b2-jobcleanup
- **Do:** §5.2: GET→200 SyncHistorySettings via syncHistorySettingsQueries.get(). PATCH: try/catch request.json()→400 'Invalid JSON body'; per-field typeof/Number.isInteger/range validation (drift settings pattern); persist via syncHistorySettingsQueries.update; then call scheduleSyncHistoryCleanup() (imported from $jobs/init.ts) so enable/disable takes effect immediately; return updated settings. Codes 200/400/500(internal only). Ambient /// <reference> comment.
- **Acceptance:** deno test routes type-checks; b6-test-routes asserts GET/PATCH incl. 400 on bad JSON/range and that rescheduling is invoked.

## Batch 5

_UI pages depend on the API routes (batch 4): the detail page fetches /api/v1/sync-history/{id} and the list page's export anchor targets the export route; both use batch-0 queries (server load), the batch-1 status helper and diff component, and the nav entry (batch 2). The two route directories are disjoint._

### `b5-ui-list` — Sync-history list page (SSR + filters)

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/sync-history/+page.server.ts`, `packages/praxrr-app/src/routes/sync-history/+page.svelte`
- **Depends on:** b0-query-history, b1-status-helper, b4-route-export
- **Do:** §6.1: +page.server.ts load({url}) parses page/pageSize/q/instanceId/arrType/status/trigger/section/from/to, calls syncHistoryQueries.search + count server-side, loads eligible instances (arrInstancesQueries.getEnabled().filter(isSyncPreviewArrType), id/name/type only), returns { rows, total, filters, instances }. +page.svelte (no runes: export let data, $:, on:click/on:change, $store): ActionsBar filter bar (SearchAction q, Dropdown status/trigger/section, instance selector, arrType, two DateInputs), updateParams() helper copied from routes/arr/[id]/logs/+page.svelte:96-131 (reset page:1, goto invalidateAll:true), CardGrid columns={4} KPI tiles (total/success/partial/failed), Table with Column<SyncHistorySummary>[] + rowHref to /sync-history/{id} + hand-rolled prev/next server pagination (do NOT pass Table pageSize), Export Button as anchor href /api/v1/sync-history/export + current searchParams + format, EmptyState, alertStore feedback. Status Badge via syncHistoryStatus helper.
- **Acceptance:** deno task check:client passes; page SSR-renders filtered rows; filters update URL and reset page; export anchor carries current filters. deno task build succeeds (SSR compile).

### `b5-ui-detail` — Sync-history detail page + diff

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/routes/sync-history/[id]/+page.server.ts`, `packages/praxrr-app/src/routes/sync-history/[id]/+page.svelte`
- **Depends on:** b4-route-detail, b1-diff, b1-status-helper
- **Do:** §6.2: +page.server.ts validates the param with /^\d+$/ and returns { id, error } inline on bad input (never throw an error page). +page.svelte fetches /api/v1/sync-history/{id} with the requestId race-guard (drift [instanceId]/+page.svelte:25-93); renders metadata header (timestamp, trigger + trigger_event, instance Badge, arr_type Badge, status Badge via helper, duration, error), per-section outcome list from sectionResults, and grouped entity diffs via SyncHistoryDiff.svelte. MUST build the degrade path where changes is empty (MediaManagement / preview-failure) showing sectionResults only. JsonView + Modal for raw error/JSON if needed.
- **Acceptance:** deno task check:client passes; detail renders full diff; empty-changes rows degrade to sectionResults without error; bad id shows inline error not a crash page. deno task build succeeds.

## Batch 6

_All five test files are disjoint new files exercising the completed implementation across batches 0-5. They run last (parallel) and gate the PR via the alias (added in b2-testalias). Grouped together so the whole suite lands and runs via deno task test sync-history._

### `b6-test-queries` — Query module tests

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts`
- **Depends on:** b0-query-history, b0-migration
- **Do:** §9: copy the local migratedTest(name, fn) closure verbatim (unique /tmp/praxrr-tests/<prefix>-<uuid> base, db.close() before config.setBasePath(), db.initialize()+runMigrations(), finally cleanup; driftQueries.test.ts:16-39). PRAGMA table_info confirms columns/CHECKs (proves migration ran); insert→getById round-trips changes/sectionResults JSON exactly; each filter independently (instanceId, arrType, status, trigger, section-LIKE, from/to range) + combined; pagination LIMIT/OFFSET stable id ordering; search/count share buildWhere (totals==rows); unknown id→undefined; empty result; re-running migrations idempotent. crypto.randomUUID instance names; explicit radarr/sonarr/lidarr with per-arr_type assertions (no cross-Arr parity). @std/assert.
- **Acceptance:** deno task test sync-history passes this suite; totals equal returned rows across pages.

### `b6-test-retention` — Retention prune tests

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/tests/db/syncHistoryRetention.test.ts`
- **Depends on:** b0-query-history, b0-migration
- **Do:** §9: migratedTest closure. Seed rows with controlled started_at + beyond max-entries; pruneOlderThan(days) deletes old / keeps recent / returns count; pruneBeyondMaxEntries(max) keeps newest M; no-op under threshold; default + custom settings; assert row count SHRINKS.
- **Acceptance:** deno task test sync-history passes; row count shrinks as asserted.

### `b6-test-record` — Recording integration tests

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/tests/sync/syncHistoryRecord.test.ts`
- **Depends on:** b3-recorder
- **Do:** §9 + R1/R2/R4/R5: via injected deps (no network), assert exactly one row appended per genuine attempt; row count GROWS across N runs (opposite of drift); success/partial/failed/skipped/credential-failure each recorded with correct status/trigger/instance snapshot/error/sectionResults; disabled-instance and invalid-id record NOTHING (R2); job_id NULL for synthetic id 0 (R4); items_synced summed drives partial/failed split (R5); thrown generatePreview→changes=[] but row still writes; recorder never throws when insert fails; enabled=0 skips recording. sanitizeOps:false for fire-and-forget notify; reset module-global state in finally.
- **Acceptance:** deno task test sync-history passes; grow/never-throw/enabled-gate/no-cancelled behaviors verified.

### `b6-test-cleanup` — Cleanup job handler tests

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/tests/jobs/syncHistoryCleanup.test.ts`
- **Depends on:** b2-jobcleanup
- **Do:** §9: side-effect import registers handler → jobQueueRegistry.get('sync.history.cleanup') exists (assertExists — the registration silent-failure gate); disabled→'cancelled'; prunes→'success' with rescheduleAt present when job.source==='schedule' and undefined on manual; zero-prune→'skipped'. migratedTest closure; reset dispatcher/registry module state in finally.
- **Acceptance:** deno task test sync-history passes; assertExists fails loudly if handlers/index.ts import is missing.

### `b6-test-routes` — API route handler tests

- **Owner:** parallel-agent
- **Files:** `packages/praxrr-app/src/tests/routes/syncHistory.test.ts`
- **Depends on:** b4-route-list, b4-route-detail, b4-route-export, b4-route-settings
- **Do:** §9: start file with /// <reference path="../../app.d.ts" />. Real migrated DB (not in-memory Map). Import handlers from +server.ts; cast events via Parameters<typeof GET>[0] (populate url, params, request, locals, setHeaders). List GET filters+pagination via url query; invalid/out-of-range→400; detail 404 unknown / 200 full diff; export json + csv assert Content-Type + Content-Disposition + body shape incl. RFC-4180 escaping; settings GET/PATCH incl. 400 on bad JSON/range.
- **Acceptance:** deno task test sync-history passes all route assertions; deno test typechecks route files via the ambient reference.

## Shared / registration file edits (single-owner)

- **`packages/praxrr-app/src/lib/server/db/migrations.ts`** — ALREADY PRESENT (uncommitted): static import of migration20260710CreateSyncHistoryTables at L74 AND append to the loadMigrations() array at L375 (after migration20260709CreateDriftTables). Verify BOTH remain — missing either = migration silently never runs (compiles clean, table absent at runtime). Owner: b0-migration.
- **`packages/praxrr-app/src/lib/server/notifications/types.ts`** — Add SYNC_FAILED: 'sync.failed' and SYNC_PARTIAL: 'sync.partial' to the NotificationTypes object, after DRIFT_DETECTED (L33). Do NOT reuse pcd.sync_failed. Owner: b2-notif.
- **`packages/praxrr-app/src/lib/shared/notifications/types.ts`** — Append two entries to notificationTypes[] (id 'sync.failed'/'sync.partial') under a NEW 'Sync' category. Ids must match the server constants. Owner: b2-notif.
- **`packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`** — Add '| 'sync.history.cleanup'' to the JobType union (after 'drift.check', L15) and "'sync.history.cleanup': ArrSyncCleanupOnlyPayload;" to JobPayloadByType (after L83, the drift.check entry). Reuse the existing ArrSyncCleanupOnlyPayload (L57); no new payload type. Owner: b2-jobcleanup.
- **`packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`** — Add side-effect import `import './syncHistoryCleanup.ts';` after L10 (logsCleanup import). Missing = jobQueueRegistry.get('sync.history.cleanup') returns undefined at runtime (no type error). Owner: b2-jobcleanup.
- **`packages/praxrr-app/src/lib/server/jobs/schedule.ts`** — Add exported scheduleSyncHistoryCleanup() modeled on scheduleLogCleanup (L156-173): read syncHistorySettingsQueries.get(); if disabled jobQueueQueries.cancelByDedupeKey('sync.history.cleanup') and return; else upsertScheduled({jobType:'sync.history.cleanup', runAt:calculateNextRunFromSchedule('daily'), payload:{}, source:'schedule', dedupeKey:'sync.history.cleanup'}) then notify(job.runAt). Add the syncHistorySettingsQueries import. Invoke scheduleSyncHistoryCleanup() inside scheduleAllJobs() after scheduleDriftCheck() (L223). Owner: b2-jobcleanup.
- **`packages/praxrr-app/src/lib/server/jobs/init.ts`** — Add scheduleSyncHistoryCleanup to the re-export block (L22-31) so the settings PATCH route can reschedule after a config change. Owner: b2-jobcleanup.
- **`packages/praxrr-app/src/lib/server/jobs/display.ts`** — Add case 'sync.history.cleanup': return 'Sync History Cleanup'; to the formatJobTypeLabel switch, after the 'drift.check' case (L38-39). Owner: b2-jobcleanup.
- **`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`** — Single-owner recording refactor (arrSync.ts:292): every mapped terminal exit builds a SyncHistoryInput and calls recordSyncHistory once, then returns the ORIGINAL JobHandlerResult. Capture startedAt at top; retain per-section {section,result}[] (dropped at :436) and SUM result.itemsSynced (R5); compute 4-value status; record only genuine attempts per R2 (NOT :295 invalid-id, NOT :300 disabled); job_id 0→NULL (R4); trigger_event NULL (R3). Do NOT touch the four syncers, sync/types.ts, or sync/processor.ts. Owner: b3-recorder.
- **`docs/api/v1/openapi.yaml`** — Add a 'Sync History' tag under tags (after 'Drift Detection', L43-44); register /sync-history, /sync-history/{id}, /sync-history/export, /sync-history/settings as $ref paths (mirror drift block L629-634); register every new component schema as $ref under components.schemas (mirror drift block L797-815). Run deno task format. Owner: b2-openapi-register.
- **`packages/praxrr-app/src/lib/api/v1.d.ts`** — Generated: run deno task generate:api-types and commit ONLY the net-new sync-history schema/path additions — not the ~3300-line tool-version regen (not CI-gated per MEMORY). Owner: b2-openapi-register.
- **`packages/praxrr-app/src/lib/server/navigation/registry.ts`** — Add to NAV_REGISTRY the operations.sync_history item: { id:'operations.sync_history', label:'Sync History', href:'/sync-history', groupId: ensureGroupId('operations'), order:1, arrScope: scopeAll, mobilePriority:'medium', iconKey:'History', emoji:'📜', hasChildren:false }. Verify 'History' is a valid iconKey; fall back to an existing key (e.g. 'Clock') if not. Owner: b2-nav.
- **`scripts/test.ts`** — Add 'sync-history' to the aliases map → comma-joined five test paths (db/syncHistoryQueries.test.ts, db/syncHistoryRetention.test.ts, sync/syncHistoryRecord.test.ts, routes/syncHistory.test.ts, jobs/syncHistoryCleanup.test.ts, all under packages/praxrr-app/src/tests/). Owner: b2-testalias.

## Risks & guardrails

- Batch 0 is ALREADY implemented (uncommitted) in the worktree: migration+both migrations.ts registrations, syncHistory.ts, syncHistorySettings.ts, types.ts all exist. Batch-0 tasks are verify-and-finalize, not greenfield — do not regenerate them wholesale; reconcile against design and commit.
- NAMING TRAP: the existing query module exports SyncHistorySummary / SyncHistoryDetail (NOT the candidate plans' 'SyncHistoryRecord'), search(filters, page: Pagination{limit,offset}), count(filters), searchAll(filters, cap) for export. responses.ts, routes, UI, and tests MUST import these exact names; referencing SyncHistoryRecord will not compile.
- Section 0 OVERRIDES §8/§10: the four syncers (qualityProfiles/delayProfiles/mediaManagement/metadataProfiles), sync/types.ts, and sync/processor.ts are NOT modified. Full diffs come from a best-effort generatePreview call inside record.ts (R1/R7). Any task touching those six files is wrong.
- migrations.ts double-registration: forgetting either the static import OR the loadMigrations() append makes the migration silently never run — no type error, no test failure until table access. Gated by b6-test-queries PRAGMA table_info.
- handlers/index.ts side-effect import is easy to omit; without it jobQueueRegistry.get('sync.history.cleanup') returns undefined and cleanup never runs (b6-test-cleanup assertExists catches it).
- No 'cancelled' in the sync_history.status CHECK (R2): invalid-id (:295) and disabled/missing (:300) exits must NOT be recorded; because the recorder never throws, recording a 'cancelled' would violate the CHECK and be silently dropped. NOTE 'cancelled' IS a valid JobRunStatus/JobHandlerResult value (queueTypes.ts:21) that the cleanup handler legitimately returns — distinct concern.
- items_synced is not accumulated in arrSyncHandler today (R5): the refactor MUST retain each loop iteration's SyncResult (dropped at :436) and sum result.itemsSynced, or the partial-vs-failed split is uncomputable and mixed runs mislabel as failed.
- job_id: executeSyncJob uses synthetic id 0 (:105); store NULL not 0 (R4) so UI/export never treat 0 as a real queue id.
- trigger_event stays NULL this PR (R3): do not thread on_pull/on_change through processor.ts/triggerSyncs().
- FieldChange direction is load-bearing: current = live/old, desired = PCD/new (§2.2 #1 forbidden mistake). Never invert in the flatten helper or SyncHistoryDiff — inversion renders every diff backwards with no test failure unless explicitly asserted.
- generatePreview in record.ts must be fully best-effort (own try/catch → changes=[]), gated on settings.enabled===1, and must never affect the sync result or the audit write.
- Timestamp footgun: CURRENT_TIMESTAMP/datetime('now') emit 'YYYY-MM-DD HH:MM:SS' (no T/Z); every date-range filter and the retention DELETE MUST wrap the ISO started_at column in datetime(...). buildWhere already does this — preserve it.
- search and count MUST share one buildWhere(filters) or pagination totals diverge from returned rows. Already shared in the existing module — do not fork it.
- recorder must never throw and must not open db.transaction (bare BEGIN is non-reentrant on the shared connection); notification .send() must be strict fire-and-forget .catch(()=>{}).
- Cleanup handler must set rescheduleAt only when job.source==='schedule'; returning it on a manual 'Run now' makes the job re-enqueue itself forever.
- pruneBeyondMaxEntries keep-newest-M SQL has no codebase precedent — test it explicitly; idx_sync_history_started_at backs the ORDER BY.
- v1.d.ts: committing a full regen (~3300 lines of tool-version noise, not CI-gated) instead of net-new additions pollutes the diff.
- MediaManagement flattens to one SyncResult and preview may yield empty changes for some sections: the detail UI degrade-to-sectionResults path must be built AND tested (b6/b5-ui-detail), not just mentioned.
- Cross-Arr: arr_type CHECK/filter/API limited to radarr/sonarr/lidarr; tests must assert per-arr_type correctness with explicit instances, no cross-Arr parity shortcuts (CLAUDE.md policy).
- Prettier reality (design R6/MEMORY): .prettierrc uses semicolons, 2-space, single-quote, es5 commas, 120 width (markdown/yaml override 80). Ignore the brief's 'no-semi'. Run deno task format before commit; docs + openapi.yaml are prettier-gated in CI.

## Test strategy

Five disjoint suites under packages/praxrr-app/src/tests/, each copying the local migratedTest(name, fn) closure verbatim (unique /tmp/praxrr-tests/<prefix>-<uuid> base; db.close() before config.setBasePath(); db.initialize()+runMigrations(); finally cleanup; driftQueries.test.ts:16-39) — no shared harness (repo convention). @std/assert. Instance names via crypto.randomUUID() to dodge case-insensitive uniqueness; explicit radarr/sonarr/lidarr with per-arr_type assertions (no cross-Arr parity). (1) db/syncHistoryQueries.test.ts — PRAGMA table_info columns/CHECKs (proves migration ran), insert→getById JSON round-trip, each filter independently + combined, pagination stable id ordering, search/count share buildWhere so totals==rows, unknown-id→undefined, migration idempotent. (2) db/syncHistoryRetention.test.ts — pruneOlderThan deletes old/keeps recent/returns count, pruneBeyondMaxEntries keeps newest M, no-op under threshold, default+custom settings, row count SHRINKS. (3) sync/syncHistoryRecord.test.ts (sanitizeOps:false for fire-and-forget notify) — one row per genuine attempt, count GROWS across N runs, all 4 statuses + credential-failure, :295/:300 record nothing, items_synced sum drives partial/failed split, job_id NULL for id 0, trigger_event NULL, thrown generatePreview→changes=[] but row writes, recorder never throws on insert failure, enabled=0 skips. (4) routes/syncHistory.test.ts — start with /// <reference path=\"../../app.d.ts\" />; real migrated DB; handlers imported from +server.ts, events cast via Parameters<typeof GET>[0] (populate url/params/request/locals/setHeaders); list filters+pagination, 400 on bad/out-of-range params, detail 404/200, export json+csv Content-Type/Content-Disposition/RFC-4180 escaping, settings GET/PATCH incl. 400 bad JSON/range. (5) jobs/syncHistoryCleanup.test.ts — jobQueueRegistry.get('sync.history.cleanup') assertExists, disabled→'cancelled', prune→'success' with rescheduleAt only when source==='schedule' (undefined on manual), zero-prune→'skipped'. Alias 'sync-history' (b2-testalias in scripts/test.ts); run `deno task test sync-history`. Pre-PR gates in order: `deno task check` (deno check:server + svelte-check:client), `deno task test sync-history`, `deno task test filters upgrades` (sync write-path regression — contract unchanged), `deno task lint`, `deno task build` (SSR compile of new routes), `deno task format` (docs/openapi.yaml prettier-gated). Optionally run full `deno task test` once to confirm no cross-suite module-global state leakage.
