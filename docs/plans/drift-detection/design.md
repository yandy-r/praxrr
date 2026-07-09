# Design Doc — Praxrr Drift Detection Dashboard (Issue #15)

Status: **Authoritative V1 design.** Supersedes the three input stances and closes the adversarial review. This doc resolves **all 8 open questions** in `docs/plans/drift-detection/research.md` §4 with a single decision + rationale each (addresses critique: no design doc existed and all 8 §4 questions were unresolved — they are resolved in the table below and carried through every section).
Scope anchor: `docs/plans/drift-detection/research.md` (the reuse map).

---

## 1. Overview & Goals

Drift Detection is a **scheduled/on-demand caller of the existing preview diff engine (`generatePreview`) that persists the resulting `EntityChange[]` as a latest-state, one-row-per-instance drift record**, surfaced through a `/drift` dashboard. It answers issue #15's acceptance — _"compare desired to Arr state, show drift by instance / profile / entity"_ — by iterating every enabled, supported Arr instance, running the already-namespace-correlated desired-vs-live diff the sync engine produces, and rolling each instance up to a single `DriftStatus` with per-entity, per-field detail. There is **no new diff, HTTP, scheduler, or notification machinery to build**; the work is persistence, wiring, and presentation.

V1 is:

- **Arr-read-only** — it never writes remote Arr state. It inherits exactly **one idempotent app-DB write** from the engine (`arrNamespaceQueries.getOrCreate`); this is namespace-registration bookkeeping, not an Arr mutation. The headline "read-only" claim is scoped precisely to _the Arr_ (see §9, "Read-only scope") (addresses critique: the preview is not purely read-only because `getOrCreate` writes app-DB rows).
- **Latest-state only** (no history — bounded storage, see §3).
- **Info-only** (it reports; it does not remediate).

**Key axis resolutions** (one line each — these close research.md §4/§5):

| Open axis                             | Decision                                                                                                                                                               | Rationale                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Granularity (Q1)                      | Per-instance status + per-entity/per-field detail                                                                                                                      | Engine emits per-field; dashboard needs the roll-up.                                                                                                                                                                                                                                   |
| Storage model (Q2)                    | **2 tables**: singleton settings + one **latest-state upsert row per instance**, entity detail as a JSON `changes[]` blob on that row; **`unchanged` never persisted** | V1 reads are always whole-instance; a child table buys nothing until #22/#27. Upsert + no-`unchanged` = bounded storage, no append-only growth (addresses critique: append-only `drift_results` with `unchanged` rows grows unbounded with no retention).                              |
| Routing scope (Q5/2e)                 | **Instance-scoped everywhere** (`/drift/[instanceId]`, one `generatePreview({instance})` call)                                                                         | `generatePreview` has no `databaseId` input and groups all DBs internally; instance-scoping is the only shape one call can satisfy — this doc contains **zero** `[databaseId]` routing (addresses critique: engine is instance-scoped but brief waffled toward `/drift/[databaseId]`). |
| `create`/`delete` classification (Q…) | `update`→drift (alert), `create`→missing (alert), `delete`→**unmanaged (non-alerting)**                                                                                | `delete` = every live Arr entity not in the configured desired set (foreign-DB, manual, Recyclarr/Configarr CFs). Alerting on it makes every real instance permanently "drifted" (addresses critique: `delete`→drift is permanent false drift).                                        |
| Heartbeat vs full check (Q3)          | **Combined** job, heartbeat-first                                                                                                                                      | Status column models `unreachable`/`unauthorized`; a future split needs no schema change.                                                                                                                                                                                              |
| Acknowledge model (Q4)                | Out of V1; `drift_signature` is the exact primitive an ack later attaches to                                                                                           | Dedup key doubles as the future ack anchor.                                                                                                                                                                                                                                            |
| "Expected" local drift                | `desired` = **resolved (base+user) ops** the cache already layers; intentional overrides are user-ops → `unchanged`, never drift                                       | Expected drift is structurally not a diff — no allowlist needed.                                                                                                                                                                                                                       |
| Scheduling model (Q6)                 | **Single global interval** (`dedupeKey 'drift.check'`), **chunked** across job runs; on-demand = single-instance                                                       | Per-instance schedules multiply job rows for no V1 gain; chunking bounds dispatcher occupancy (see §5).                                                                                                                                                                                |
| Namespace correlation (Q7)            | **Do NOT run `transformer.ts`**; `generatePreview` correlates end-to-end via syncer suffixing + `findNamespaceMatch`                                                   | Running the transformer ourselves double-suffixes → every entity looks like `create`+`delete`.                                                                                                                                                                                         |
| Auth-failure policy (Q8)              | `unauthorized` status, **no auto-disable**                                                                                                                             | Silently disabling an instance is worse than a stale row; creds may be transiently wrong.                                                                                                                                                                                              |
| Retention (Q2)                        | Latest-state upsert, no `unchanged` rows, `ON DELETE CASCADE` reap → **no prune routine needed**                                                                       | Row count is bounded by `#instances`; storage cannot grow with time (addresses critique: no retention/prune specified).                                                                                                                                                                |

**DriftStatus enum (stored)** = `in-sync | drifted | unreachable | unauthorized | error` (5 values — **extends** research.md:112's 3-value enum; `unauthorized` is its own status to honor no-auto-disable, and `error` ≠ `unreachable`). The summary read model adds a synthesized `never-checked` for instances with no row yet.

---

## 2. Architecture — Data Flow

```
 hooks.server.ts → initializeJobs() → scheduleAllJobs()
        └── scheduleDriftCheck(): upsertScheduled({jobType:'drift.check', dedupeKey:'drift.check'})
                                   │  (or cancelByDedupeKey when disabled)
                                   ▼  due → jobQueue (single setTimeout, ALL jobs serialized)
        ┌──────────────────────────────────────────────────────────────┐
        │ $jobs/handlers/driftCheck.ts  (JobHandler<'drift.check'>)      │
        │  read drift_check_settings (enabled? backoff_until? due?)      │
        │  arrInstancesQueries.getEnabled() → filter isSyncPreviewArrType│
        │  select NEXT CHUNK (id > cursor, limit DRIFT_SWEEP_CHUNK_SIZE) │
        │  processBatches(chunk, CONCURRENCY_LIMIT=3, checkAndPersist)   │
        │  more remain? self-enqueue continuation (runAt=now, cursor)    │
        │  else markRun/markFailure → return { status, rescheduleAt }    │
        └───────────────────────────┬──────────────────────────────────┘
   on-demand POST /drift/[id]        │ per instance
   (request thread, NOT the queue) ──┤
                                     ▼
        ┌──────────────────────────────────────────────────────────────┐
        │ $sync/drift/persist.ts  checkAndPersistInstance(instance,deps) │
        │   ├ inFlight Set guard ........................ 409 if busy     │
        │   ├ heartbeat getSystemStatus {timeout:5s, retries:0} ─► unauthorized│
        │   │                                              └────────────► unreachable/error
        │   ├ gate: registerPreviewCreateAttempt (shared 6/60s) ─► rate_limited│
        │   ├ gate: isPcdCacheReady(...) ................ ─► error/cache_not_ready│
        │   ├ resolveAvailableSections(instance)  ◄── detectAndRecordArrVersion │
        │   │        + resolveSyncSectionAvailability → version-gated set │
        │   ├ generatePreview({instance})  [Promise.race(budget 20s)]    │
        │   │     resolveSections → CONFIGURED ∩ VERSION-AVAILABLE only  │
        │   │     syncers suffix namespace + diffEntityCollection        │
        │   │        → EntityChange[] (create/update/delete/unchanged)   │
        │   ├ aggregateDrift() → counts{drifted,missing,unmanaged}, changes[]│
        │   ├ driftSignature(update+create, remoteId-qualified) → dedup  │
        │   ├ upsert drift_instance_status (single txn, replace)         │
        │   └ shouldNotify(prior,next) ─► notify('drift.detected')  (fire-and-forget)│
        └───────────────────────────┬──────────────────────────────────┘
                                    ▼ writes
        ┌──────────────────────────────────────────────────────────────┐
        │ App DB (SQLite, WAL, FK ON)                                    │
        │   drift_check_settings   (singleton id=1)                      │
        │   drift_instance_status  (1 row/instance; changes JSON blob)   │
        └───────────────────────────┬──────────────────────────────────┘
                                    ▼ read
        ┌──────────────────────────────────────────────────────────────┐
        │ API /api/v1/drift/*                                            │
        │   GET  /summary        totals + settings + per-instance rows   │
        │   GET  /[instanceId]   detail (JSON blob → drift/missing/unmgd) │
        │   POST /[instanceId]   refresh (reuses checkAndPersistInstance) │
        │   PUT  /settings       enable/interval → re-run scheduleDriftCheck│
        └───────────────────────────┬──────────────────────────────────┘
                                    ▼ client fetch (LiveDiffPanel requestId race-guard)
        ┌──────────────────────────────────────────────────────────────┐
        │ UI  /drift            CardGrid KPI tiles + instance Badge cards │
        │     /drift/[instanceId]  LiveDiffPanel field-diff table         │
        │     settings panel    enable toggle + interval input           │
        └──────────────────────────────────────────────────────────────┘
```

Every drift check is **one `generatePreview` call per instance** (it builds and closes its own client cache per call — orchestrator.ts:216-222,281 — so there is nothing to share across sections and no benefit to fanning out; one call loops all configured sections internally and decrypts creds once) (addresses critique: `generatePreview` owns its per-call cache, so "share one cache per cycle" / "call per section" are impossible — resolved by calling once per instance).

---

## 3. Data Model

**Single migration** — `packages/praxrr-app/src/lib/server/db/migrations/20260709_create_drift_tables.ts` (both tables + seed in one `up[]` block; register by static import **and** array-append in `migrations.ts` `loadMigrations()` — missing either = it never runs). Timestamps that drive scheduling/dedup are `TEXT` ISO-8601 UTC (`toISOString()`) to match `jobQueue` due-detection; bookkeeping columns use `DATETIME DEFAULT CURRENT_TIMESTAMP`. Also update `db/schema.sql` (reference doc only). Add `queries/driftSettings.ts` and `queries/driftStatus.ts` with co-located `types.ts` (Row byte-aligned).

```sql
-- (1) Singleton settings. Modeled on backupSettings.ts + CHECK(id=1).
CREATE TABLE drift_check_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5),  -- 6h default; floor stops Arr hammering
  last_run_at      TEXT,                       -- ISO-8601 UTC; NULL until first sweep completes
  error_count      INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),         -- global job-level backoff exponent
  backoff_until    TEXT,                       -- ISO-8601 UTC; handler-owned next-eligible gate
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO drift_check_settings (id) VALUES (1);   -- seed so get() never returns undefined

-- (2) Per-instance latest-state roll-up. PK == FK => exactly one upserted row per instance;
--     ON DELETE CASCADE reaps it with the instance. Entity detail lives in `changes` (JSON).
--     No 'unchanged' entity is ever persisted; the table cannot grow with time (bounded by #instances).
CREATE TABLE drift_instance_status (
  arr_instance_id    INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
  arr_type           TEXT NOT NULL CHECK (arr_type IN ('radarr','sonarr','lidarr')),  -- CHECK present
  status             TEXT NOT NULL CHECK (status IN
                       ('in-sync','drifted','unreachable','unauthorized','error')),
  reason             TEXT CHECK (reason IN
                       ('unreachable','timeout','unauthorized','invalid_response',
                        'not_configured','cache_not_ready','rate_limited','error') OR reason IS NULL),
  drifted_count      INTEGER NOT NULL DEFAULT 0,   -- 'update' actions (field drift)   ── ALERTING
  missing_count      INTEGER NOT NULL DEFAULT 0,   -- 'create' actions (managed, absent on Arr) ── ALERTING
  unmanaged_count    INTEGER NOT NULL DEFAULT 0,   -- 'delete' actions (extra on Arr) ── NON-ALERTING
  drift_signature    TEXT,                          -- hash over update+create rows only, remoteId-qualified
  notified_signature TEXT,                          -- last signature drift.detected fired for
  detected_version   TEXT,                          -- from heartbeat, best-effort
  changes            TEXT NOT NULL DEFAULT '[]',    -- JSON DriftEntityChange[] (non-unchanged only)
  checked_at         TEXT NOT NULL,                 -- ISO-8601 UTC of this cycle (always advances)
  content_checked_at TEXT,                          -- ISO-8601 UTC of last SUCCESSFUL section diff
  duration_ms        INTEGER,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- No secondary index. Rebuttal to critique ("summary filters by status, only PK indexed"):
-- the summary does NOT emit WHERE status=…; it is a single full pass over a tiny (#instances)
-- table computing ALL five totals at once. PK(arr_instance_id) already serves the detail lookup.
-- A status index would be dead weight on a table with one row per Arr instance.

-- down: DROP TABLE drift_instance_status;  DROP TABLE drift_check_settings;
```

**arr_type has a CHECK** constraint restricting to `radarr|sonarr|lidarr` (addresses critique: `arr_type TEXT` had no CHECK).

**Why 2 tables, not 3.** Instance status is **stored, not derived** — an `unreachable`/`unauthorized` instance has zero entity rows, so status cannot be derived from a detail scan. Entity _detail_ is a JSON blob because V1 reads are **always whole-instance** and there is **zero cross-entity SQL query in scope** (that is #22/#27, OUT). The three category counts are the **only** denormalization — cheap ints so the summary roll-up never parses JSON. On a **failed** check (unreachable/unauthorized/error) the handler updates `status`/`reason`/`checked_at` only and **leaves `changes` + `content_checked_at` untouched**, so the UI shows "last good check at X; currently unreachable" rather than blanking known drift.

**No entity-name keying — collision-proof by construction.** The critique's collision scenario ("two databases syncing same-named entities collide under an upsert keyed on `(instance_id, entity_type, entity_name)`") **does not apply to this design**: nothing is keyed on `entity_name`. The upsert key is `arr_instance_id` (PK); same-named entities from different DBs are simply two distinct elements of the `changes[]` JSON array, each carrying its own `remoteId` — no data loss. The one place display-name ambiguity could still bite is dedup, which we harden by qualifying the signature with `remoteId` (see §6) (addresses critique: namespace-stripped display names collide under name keying — resolved structurally by not keying on name, and by remoteId-qualifying the signature).

`DriftEntityChange` (persisted verbatim in `changes`, one per non-`unchanged` entity):

```ts
interface DriftEntityChange {
  section: SyncPreviewSection; // 'qualityProfiles'|'delayProfiles'|'mediaManagement'|'metadataProfiles'
  entityType: string; // EntityChange.entityType (customFormat|qualityProfile|naming|…)
  name: string; // EntityChange.name (namespace-STRIPPED display name)
  action: 'create' | 'update' | 'delete'; // SyncPreviewAction minus 'unchanged'
  category: 'drift' | 'missing' | 'unmanaged'; // derived from action; makes the non-alerting split explicit
  remoteId: number | null; // EntityChange.remoteId (live Arr id or null for create)
  fields: FieldChange[]; // EntityChange.fields VERBATIM — current=LIVE (old), desired=PCD (new)
}
```

**`fields` is stored verbatim and never swapped** — `EntityChange.fields` already carries `current=LIVE`, `desired=PCD` (compareForAction passes them in that order). The detail view reuses `FIELD_META` + `formatFieldValue()` as-is; inverting the direction is the load-bearing mistake we explicitly forbid (addresses critique: FieldChange direction is load-bearing and easily inverted).

**Empty-field rows render as identity-only.** `create` rows (`remoteId=null`, `fields=[]`) and `delete` rows (`fields=[]`) carry no field table; the UI shows `${entityType} "${name}" — ${action}` with no Field/Current/Desired grid. Only `update` rows (non-empty `fields`) render the field-diff table (addresses critique: `delete` rows have `fields=[]`, `create` rows have `current=null` — rendering is now specified).

---

## 4. Drift Check Service

Home: `packages/praxrr-app/src/lib/server/sync/drift/` (a preview-engine consumer, sibling to `$sync/preview/`). `generatePreview`, `registerPreviewCreateAttempt`, `getSystemStatus`, and the version resolvers are bare named ESM exports (read-only bindings, not monkey-patchable) → follow the injectable-`deps` pattern from `liveDiff.ts:67`.

### 4.1 Modules & signatures

```ts
// $sync/drift/types.ts
export type DriftStatus =
  'in-sync' | 'drifted' | 'unreachable' | 'unauthorized' | 'error';
export type DriftReason =
  | 'unreachable'
  | 'timeout'
  | 'unauthorized'
  | 'invalid_response'
  | 'not_configured'
  | 'cache_not_ready'
  | 'rate_limited'
  | 'error';
export interface InstanceDriftResult {
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  status: DriftStatus;
  reason: DriftReason | null;
  detectedVersion: string | null;
  counts: { drifted: number; missing: number; unmanaged: number };
  changes: DriftEntityChange[]; // update+create+delete
  driftSignature: string | null; // over update+create only, remoteId-qualified
  checkedAt: string;
  contentCheckedAt: string | null;
  durationMs: number;
}
type HeartbeatResult =
  { ok: true; version: string } | { ok: false; status?: number };

// $sync/drift/check.ts
export interface DriftCheckDeps {
  readonly generatePreview: typeof generatePreview; // orchestrator.ts:193
  readonly getSystemStatus: (instance: ArrInstance) => Promise<HeartbeatResult>; // wraps getArrInstanceClient + base.ts:72, {timeout:5000, retries:0}
  readonly isPcdCacheReady: (instanceId: number) => boolean; // getCache().isBuilt() over the instance's synced DBs
  readonly resolveAvailableSections: (
    // detectAndRecordArrVersion + resolveSyncSectionAvailability
    instance: ArrInstance,
    version: string
  ) => Promise<Set<SyncPreviewSection>>; //   → version-supported section set
  readonly registerPreviewAttempt: typeof registerPreviewCreateAttempt; // limits.ts:17 — SHARED preview window
  readonly now: () => number;
  readonly budgetMs: number; // default 20000
}
export const defaultDriftCheckDeps: DriftCheckDeps;

// Pure aggregation core — no I/O, never throws:
export function aggregateDrift(
  preview: GeneratePreviewResult,
  availableSections: Set<SyncPreviewSection>
): {
  changes: DriftEntityChange[];
  counts: { drifted: number; missing: number; unmanaged: number };
  allSectionsErrored: boolean;
};
export function driftSignature(changes: DriftEntityChange[]): string | null;

// IO shell — never throws; returns a status even on failure:
export async function checkInstanceDrift(
  instance: ArrInstance,
  deps?: Partial<DriftCheckDeps>
): Promise<InstanceDriftResult>;

// $sync/drift/persist.ts — the single path both the sweep and the POST use:
export async function checkAndPersistInstance(
  instance: ArrInstance,
  deps?: Partial<DriftCheckDeps>
): Promise<InstanceDriftResult>;
```

`aggregateDrift` and `driftSignature` are pure; `checkInstanceDrift` layers heartbeat/version-gate/gates/timeout/network; `checkAndPersistInstance` layers prior-read → check → transactional upsert → dedup notify. Both the scheduled sweep and `POST /drift/[id]` call **`checkAndPersistInstance` verbatim** so they can never diverge.

### 4.2 Per-instance algorithm (strict precedence, top-down)

0. **Eligibility** — `arrInstancesQueries.getEnabled()` filtered to `isSyncPreviewArrType` (`radarr|sonarr|lidarr`). `all`/`chaptarr`/unknown are **skipped cleanly** — no row written, absent from summary totals.
1. **In-flight guard** — module-level `inFlight = new Set<number>()`; enter in `try/finally`. Sweep skips an already-in-flight instance; POST returns 409. Prevents a double live fetch + write race.
2. **Heartbeat** (`getSystemStatus`, `{timeout:5000, retries:0}` to defeat the built-in 3-retry; never throws):
   - `ok:false, status∈{401,403}` → `unauthorized`, reason `unauthorized`. **No auto-disable.** Stop; leave `changes`/`content_checked_at`.
   - `ok:false, status undefined` (DNS/network/timeout) → `unreachable`, reason `timeout`|`unreachable`. Stop; preserve last-known content.
   - `ok:false, other status` → `error`, reason `invalid_response`. Stop.
   - `ok:true` → record `detectedVersion`; continue.
3. **Gates** (heartbeat OK only):
   - `registerPreviewAttempt(id, now) === false` → `error`, reason `rate_limited` (sweep yields the slot; POST returns 429). Shared window = drift + sync-preview can't collectively hammer an Arr.
   - `isPcdCacheReady(id) === false` → `error`, reason `cache_not_ready`. **This is the anti-false-`in-sync` guard**: `getCache()` throws without a built PCD cache (syncer.ts:501); an unbuilt cache would make the syncers read empty `desired` → zero create/update → a _false_ `in-sync`. We check `isBuilt()` first and degrade, never trusting a clean result on a cold cache and never 500-ing (addresses critique: `getCache` throws without a built cache).
   - **Version/section availability** — `available = await resolveAvailableSections(instance, version)` (`detectAndRecordArrVersion` + `resolveSyncSectionAvailability`). This is computed **before** the preview so version-unsupported sections are excluded from the compared universe, not surfaced as section errors (addresses critique: `generatePreview` does not version-gate — only `handler.hasConfig` — so a version-unsupported section throws an `HttpError` that would map to a false `error`/`invalid_response`). If `available` is empty → `in-sync`, reason `not_configured`, counts 0.
4. **Full check** — `outcome = await Promise.race([generatePreview({ instance }), budgetTimeout(budgetMs)])`. Passing **no `sections`** makes `resolveSections` auto-limit to sections the instance actually syncs (`orchestrator.ts:87-96`, `handler.hasConfig`); we then intersect the result with `available` so version-gated sections are dropped, not diffed. `generatePreview` throws only on unsupported arr_type (pre-gated) or client-build failure; per-section `HttpError`s are captured in `sectionOutcomes[].error`, **not** thrown.
   - threw → `error`, reason `error`; budget exceeded → `error`, reason `timeout`.
   - `resolveSections ∩ available` empty → `in-sync`, reason `not_configured`, all counts 0 (honest: nothing to compare).
   - success → `aggregateDrift(preview, available)`.
5. **Aggregate** over `preview.qualityProfiles/.customFormats`, `.delayProfiles`, `.mediaManagement/.naming/.qualityDefinitions/.mediaSettings`, `.metadataProfiles`, restricted to `available` sections, collecting every `EntityChange` with `action !== 'unchanged'`:

| `EntityChange.action` | meaning                                                     | count                               | category    | status effect           |
| --------------------- | ----------------------------------------------------------- | ----------------------------------- | ----------- | ----------------------- |
| `update`              | field diverged (manual Arr edit / competing tool)           | `drifted_count`                     | `drift`     | → `drifted`             |
| `create`              | managed entity absent on Arr (deleted in UI / never pushed) | `missing_count`                     | `missing`   | → `drifted`             |
| `delete`              | extra live entity not in resolved desired                   | `unmanaged_count`                   | `unmanaged` | **none** (non-alerting) |
| `unchanged`           | in-sync                                                     | — (count only, **never persisted**) | —           | —                       |

**Roll-up:** `status = (drifted_count > 0 || missing_count > 0) ? 'drifted' : 'in-sync'`; `unmanaged_count` **never** flips to drifted. **Skip-never-fail semantics are implemented by us, not inherited from `generatePreview`** — a section that still errors _despite_ being version-available (genuine transient `HttpError`) is dropped and we aggregate over the OK sections; only `allSectionsErrored` (every available section errored) while heartbeat OK → `error`/`invalid_response`. On any successful diff, `content_checked_at = now` (rebuttal-with-fix: the draft's "mirror arrSync skip-never-fail" phrasing was imprecise — `generatePreview` captures per-section errors but does not version-gate; we add version-gating + OK-section aggregation to get true skip-never-fail).

**Why `create` alerts but `delete` doesn't.** `diffEntityCollection` matches sync-selected `desired` against the instance's **full** live set (syncer.ts:400 passes ALL live CFs; sectionDiffs.ts:211-225 emits `delete` for every unconsumed one); an unmatched live entity (`delete`) is dominated by legitimate user/other-tool config (Recyclarr/Configarr/personal CFs) — alerting on it would make nearly every real instance permanently "drifted" and bury real drift. A managed entity a user deleted in the Arr UI still surfaces as `create` (missing), which we **do** alert — so treating `delete` as non-alerting hides nothing actionable. It is still stored + counted + shown in a quiet "unmanaged" bucket.

### 4.3 Summary aggregation rule

`GET /drift/summary` LEFT JOINs the eligible enabled instances against `drift_instance_status`; totals = a single pass counting `status` across all rows (no `WHERE status=…`). An instance with **no row yet** is synthesized as `never-checked` (summary-only; not a stored value). An instance is "drifted" iff `status === 'drifted'`.

### 4.4 Backoff

Handler-driven (framework has none). On sweep failure: persist `error_count + 1` and `backoff_until = now + min(base * 2^error_count, cap)`, return `{ status:'failure', rescheduleAt: backoff_until }`. On success (terminal chunk): reset `error_count = 0`, clear `backoff_until`, `markRun(lastRunAt)`, return `{ status:'success', rescheduleAt: calculateNextRunFromMinutes(lastRunAt, interval_minutes) }`. A single instance's failed check is a normal `error` **row**, never a job failure — only an unexpected handler-level fault trips backoff.

---

## 5. Job Wiring — 5 Touchpoints (chunked sweep)

1. **`queueTypes.ts`** — add `'drift.check'` to the `JobType` union; `DriftCheckJobPayload` carries **optional continuation cursor** `{ sweepStartedAt?: string; cursor?: number }` (empty `{}` starts a fresh sweep); add a `JobPayloadByType['drift.check']` entry.
2. **`$jobs/handlers/driftCheck.ts`** (modeled on `pcdSync.ts`) — read `driftSettingsQueries.get()`; if `!enabled` return no reschedule; guard recurrence on `job.source === 'schedule'`; then run **one bounded chunk**:
   - New sweep (`!payload.sweepStartedAt`): `sweepStartedAt = nowISO`, `cursor = 0`.
   - Select eligible instances (`getEnabled()` → filter supported) ordered by `id`, `id > cursor`, `limit DRIFT_SWEEP_CHUNK_SIZE` (default 5).
   - `processBatches(chunk, CONCURRENCY_LIMIT=3, checkAndPersistInstance)` (do **not** `Promise.all`).
   - **If more instances remain** (chunk was full): `upsertScheduled({ jobType:'drift.check', runAt: nowISO, payload:{ sweepStartedAt, cursor: lastProcessedId }, source:'schedule', dedupeKey:'drift.check' })` then `notify(runAt)`; return `{ status:'success' }`. The dispatcher processes any other queued job before the continuation, so a full sweep can **never** monopolize the single-flag serialized runner — max continuous occupancy is `DRIFT_SWEEP_CHUNK_SIZE` instances × (`5s` heartbeat + `20s` budget) ÷ 3 concurrency (addresses critique: a full sweep runs inside the single-flag serialized dispatcher and blocks all other jobs including sync).
   - **Else (terminal chunk):** `markRun(sweepStartedAt)`; return `{ status:'success', rescheduleAt: calculateNextRunFromMinutes(sweepStartedAt, interval_minutes) }`. Continuation and interval share `dedupeKey 'drift.check'`, so at most one drift job is ever queued.
   - End the file with `jobQueueRegistry.register('drift.check', driftCheckHandler)`. (`processBatches` is currently module-private in `processor.ts:247` — **export it**, or lift the bounded runner to `$utils/concurrency.ts`, and reuse it.)
3. **`$jobs/handlers/index.ts`** — add `import './driftCheck.ts';` (else the dispatcher logs "Handler not found").
4. **`$jobs/schedule.ts`** — add `scheduleDriftCheck()`: reads settings; if enabled, `upsertScheduled({ jobType:'drift.check', runAt: calculateNextRunFromMinutes(lastRunAt, intervalMinutes) (ISO-8601 UTC), payload:{}, source:'schedule', dedupeKey:'drift.check' })` then `notify(runAt)`; if disabled, `cancelByDedupeKey('drift.check')`. Call it inside `scheduleAllJobs()`.
5. **Init** — `scheduleAllJobs()` already runs via `hooks.server.ts → initializeJobs()`; export `scheduleDriftCheck` from `$jobs/init.ts` so `PUT /drift/settings` can re-seed/cancel on change. (Optional 6th: `case 'drift.check': return 'Drift Check';` in `display.ts`.)

---

## 6. Notifications

**Event registration** (brief §c):

- Add `{ id:'drift.detected', label:'Drift Detected', category:'Drift', description:'…' }` to `notificationTypes[]` in `shared/notifications/types.ts:16` (surfaces the opt-in checkbox; new `Drift` category auto-groups).
- Add `DRIFT_DETECTED: 'drift.detected'` to `NotificationTypes` in `server/notifications/types.ts`.
- Create `definitions/drift.ts` (mirror `definitions/rename.ts`); register in `definitions/index.ts`. No migration (`notification_type` is free-form TEXT).

**Dedup key** — `drift_signature`, computed in the pure layer, a stable hash over the **sorted** list of **alerting** changes only (action ∈ {`update`,`create`}), each rendered **`${section}|${entityType}|${name}|${remoteId ?? 'new'}|${action}`**; empty set → `null`. The `remoteId` qualifier means two same-named managed entities from different DBs on one instance produce distinct tokens instead of collapsing (addresses critique: namespace-stripped display names collide — the signature is now remoteId-qualified). `delete`/`unchanged` are excluded so unmanaged churn never perturbs it. Field **names** (not values) participate → re-alert fires when the _set_ of drifted entities/fields changes, not on every value wiggle (a field-value hash is a one-line seam if precise re-alerting is later wanted). _(Edge case: two same-named `create` rows both have `remoteId=null`→`new` and still collapse in dedup — accepted, since both are "missing" and the detail blob still stores both; a namespace-qualified source-DB id is the seam if this ever matters.)_

**Fire predicate** (`shouldNotify(prior, next)`, pure): fire iff
`next.status === 'drifted' && (prior == null || prior.status !== 'drifted' || prior.notified_signature !== next.drift_signature)`.
Fires on: first-ever drift, `in-sync → drifted`, and `drifted → drifted` where the drift set changed. Does **not** fire on: identical repeated drift (deduped every cycle — this is the specified answer to "fires every cycle while drift persists"), `drifted → in-sync` (recovery — out of V1), or any `unreachable`/`unauthorized`/`error` transition (addresses critique: notification dedup was unspecified so `drift.detected` would spam every cycle). Because the predicate keys on `prior.status !== 'drifted'`, a recovery-then-redrift correctly re-alerts without an explicit "clear on return-to-in-sync" step.

**Fire point** — in `checkAndPersistInstance`: read `prior` **before** the upsert; **after** the transaction commits, if `shouldNotify`, emit fire-and-forget and advance `notified_signature` only on a successful emit attempt:

```ts
void notify('drift.detected')
  .generic(title, message)
  .discord((d) => d.embed(embed))
  .send()
  .then(() => driftStatusQueries.markNotified(id, next.driftSignature))
  .catch(() => {});
```

Never awaited into job status; a notification failure can never affect drift results. Payload carries `arr_type` + `instanceName` (cross-Arr policy): title `Drift detected on ${instanceName} (${arrType})`; message `${drifted_count} changed, ${missing_count} missing on Arr`; embed fields = instanceName, arrType, status, the three counts, `checkedAt`, ≤10 `${entityType} "${name}" — ${action}` lines, and a `/drift/${instanceId}` deep link.

---

## 7. API Contract

**Contract-first order** (brief §d): (1) author `docs/api/v1/schemas/drift.yaml`; (2) author `docs/api/v1/paths/drift.yaml`; (3) edit `docs/api/v1/openapi.yaml` (add `- name: Drift Detection` tag, path `$ref`s, schema `$ref`s — reference ≥1 drift schema per file so the bundler loads it); (4) `deno task bundle:api` → `deno task generate:api-types` → `deno task format` (`packages/praxrr-api/openapi.json` is prettier-gated; never hand-edit it or `v1.d.ts`, commit only meaningful `v1.d.ts` additions); (5) implement routes. Reuse `FieldChange` and `SyncPreviewAction` from `schemas/sync.yaml` verbatim so the detail view drops straight into `LiveDiffPanel`. Errors `$ref '../schemas/arr.yaml#/ErrorResponse'`. **No per-route auth** — hooks protect `/api/*`; do **not** add drift to `PUBLIC_PATHS`. Never return 500 for `not_configured`/`unreachable`/`unauthorized`/`cache_not_ready`/`rate_limited` — those are normal degraded outcomes carried in the 200 body.

**Route files:** `routes/api/v1/drift/summary/+server.ts` (GET), `routes/api/v1/drift/[instanceId]/+server.ts` (GET + POST), `routes/api/v1/drift/settings/+server.ts` (PUT). **All routing is instance-scoped — there is no `[databaseId]` route** (addresses critique: engine has no `databaseId` input; one call cannot serve database-scoped routing).

### GET /api/v1/drift/summary → 200 (degraded aggregate; 500 only on internal DB error)

```json
{
  "generatedAt": "2026-07-08T12:00:00.000Z",
  "settings": {
    "enabled": true,
    "intervalMinutes": 360,
    "lastRunAt": "2026-07-08T06:00:00.000Z",
    "nextRunAt": "2026-07-08T12:00:00.000Z",
    "backoffUntil": null,
    "errorCount": 0
  },
  "totals": {
    "instances": 4,
    "inSync": 1,
    "drifted": 1,
    "unreachable": 1,
    "unauthorized": 0,
    "error": 0,
    "neverChecked": 1
  },
  "instances": [
    {
      "instanceId": 12,
      "instanceName": "Radarr 4K",
      "arrType": "radarr",
      "status": "drifted",
      "reason": null,
      "detectedVersion": "5.14.0",
      "counts": { "drifted": 2, "missing": 1, "unmanaged": 4 },
      "checkedAt": "2026-07-08T06:00:03.412Z",
      "contentCheckedAt": "2026-07-08T06:00:03.412Z"
    },
    {
      "instanceId": 8,
      "instanceName": "Sonarr",
      "arrType": "sonarr",
      "status": "unreachable",
      "reason": "timeout",
      "detectedVersion": null,
      "counts": { "drifted": 0, "missing": 0, "unmanaged": 0 },
      "checkedAt": "2026-07-08T06:00:08.940Z",
      "contentCheckedAt": "2026-07-08T05:00:04.001Z"
    },
    {
      "instanceId": 9,
      "instanceName": "Radarr HD",
      "arrType": "radarr",
      "status": "never-checked",
      "reason": null,
      "detectedVersion": null,
      "counts": { "drifted": 0, "missing": 0, "unmanaged": 0 },
      "checkedAt": null,
      "contentCheckedAt": null
    }
  ]
}
```

### GET /api/v1/drift/[instanceId] → 200 (detail; 404 if no instance; degrade, never 500)

```json
{
  "instanceId": 12,
  "instanceName": "Radarr 4K",
  "arrType": "radarr",
  "status": "drifted",
  "reason": null,
  "detectedVersion": "5.14.0",
  "checkedAt": "2026-07-08T06:00:03.412Z",
  "contentCheckedAt": "2026-07-08T06:00:03.412Z",
  "counts": { "drifted": 2, "missing": 1, "unmanaged": 4 },
  "drift": [
    {
      "section": "qualityProfiles",
      "entityType": "customFormat",
      "name": "HDR10",
      "action": "update",
      "category": "drift",
      "remoteId": 42,
      "fields": [
        { "field": "score", "type": "changed", "current": 100, "desired": 50 }
      ]
    }
  ],
  "missing": [
    {
      "section": "qualityProfiles",
      "entityType": "qualityProfile",
      "name": "HD Bluray + WEB",
      "action": "create",
      "category": "missing",
      "remoteId": null,
      "fields": []
    }
  ],
  "unmanaged": [
    {
      "section": "qualityProfiles",
      "entityType": "customFormat",
      "name": "SomeOtherToolCF",
      "action": "delete",
      "category": "unmanaged",
      "remoteId": 99,
      "fields": []
    }
  ]
}
```

The route reads the `changes` blob and groups by `category` into `drift`/`missing`/`unmanaged` so a client cannot render unmanaged as drift. `create`/`delete` entries carry `fields:[]` and render as identity-only lines; `create` additionally has `remoteId:null`. A degraded instance returns e.g. `{ "status":"unauthorized", "reason":"unauthorized", "drift":[], "missing":[], "unmanaged":[], "counts":{…0} }` at 200. `fields[].current` = LIVE, `.desired` = PCD (verbatim, never swapped).

### POST /api/v1/drift/[instanceId] → 200 (refresh, same DriftDetailResponse) · 404 unknown · 400 unsupported/disabled type · 409 in-flight · 429 rate-limited (+`Retry-After`)

Runs `checkAndPersistInstance` on the request thread (**not** the job queue), identical classification + dedup as the sweep.

### PUT /api/v1/drift/settings → 200 (updated settings) · 400 invalid

Body `{ "enabled": true, "intervalMinutes": 360 }`; validates `intervalMinutes >= 5`; persists; re-runs `scheduleDriftCheck()` to reseed or `cancelByDedupeKey('drift.check')`.

`drift.yaml` schemas: `DriftStatus` (5-value stored enum), `DriftSummaryStatus` (adds `never-checked`), `DriftCounts`, `DriftSettings`, `DriftInstanceSummary`, `DriftSummaryResponse`, `DriftEntityChange` (`action` → `$ref` SyncPreviewAction, `fields` → `[$ref FieldChange]`), `DriftDetailResponse`, `DriftSettingsUpdateRequest`.

---

## 8. UI

**Svelte 5, NO runes** — `export let data: PageData`, `$:` derivations, `on:click`/`on:change`, `$store`, `<svelte:head>`. Client-fetch `/api/v1/drift/*` with the `LiveDiffPanel` requestId race-guard; surface failures via `alertStore.add('error', …)`.

- **`/drift`** (`routes/drift/+page.server.ts` load exposes `{ instances }` id/name/type only + `+page.svelte`) — the dashboard: a `CardGrid columns={4}` KPI row (total / in-sync / drifted / unreachable) built from `Card` tiles, then a list of per-instance `Card`s each with a status `Badge` (success=`in-sync`, warning=`drifted`, danger=`unreachable`/`unauthorized`/`error`, neutral=`never-checked`), counts, and `checkedAt`; each card links to `/drift/[instanceId]`. `EmptyState` when no eligible instances. No redirect — the roll-up **is** the landing.
- **`/drift/[instanceId]`** (`+page.server.ts` validates the param + picker list, `+page.svelte`) — detail: reuse **`LiveDiffPanel.svelte` wholesale** for the `drift` (`update`) entity field-diff tables (banners, Field/Change/Current(live)/Desired(PCD) columns, 429+error retry) with `FIELD_META` + `formatFieldValue()`. The `missing` (`create`) group renders as identity-only rows (`${entityType} "${name}" — missing`, no field grid, since `fields=[]`); the `unmanaged` (`delete`) group renders in a visually de-emphasized, collapsed section (info-only, also identity-only). A per-instance "Refresh now" button POSTs `/api/v1/drift/[instanceId]` (handles 409/429 with an alert). `LiveDiffPanel` is single-entity by design — wrap it in a thin list container per section rather than forking.
- **Settings** — a Drift panel (enable toggle + interval-minutes input, floor 5) under the existing settings surface, PUTting `/api/v1/drift/settings`; dirty-tracking + `alertStore` feedback.
- **Nav** — one `NAV_REGISTRY` entry: `/drift`, overview group, `scopeAll`, lucide `Activity` (or `GitCompare`), `hasChildren:false`, ordered after `dependency_graph`.

---

## 9. Cross-Arr & Safety

- **Per-`arr_type` dispatch, no sibling fallback.** `arr_type` is stored on the status row (with a CHECK constraint), every embed, and every API payload. Eligibility gate = `isSyncPreviewArrType` (`radarr|sonarr|lidarr`); `all`/`chaptarr`/unknown skipped cleanly. Lidarr differences (`/api/v1`, metadata-profiles surface, CF-language specs skipped) are inherited from `generatePreview`'s own per-type routing — the drift service adds no cross-Arr shortcuts.
- **Version/section availability (per arr_type).** Before every preview we resolve `detectAndRecordArrVersion` + `resolveSyncSectionAvailability` and compare only version-supported sections. A version-unsupported section is excluded from the universe (not an `error`, not drift), so no instance is ever falsely `error`/`invalid_response` because an Arr version lacks a section (addresses critique: `generatePreview` only checks `handler.hasConfig`, not version availability, so a version-gated section throws and misclassifies).
- **Namespace correlation (Q7).** The service **never runs `transformer.ts`**. `generatePreview` correlates end-to-end: the QP/CF syncers append the same per-DB zero-width suffix to `desired`, then `diffEntityCollection` matches it against live suffixed names via `findNamespaceMatch` (exact-then-stripped). Managed entities resolve to `update`/`unchanged`, not `create`+`delete`. Persisted `name` is the stripped display name; identity is disambiguated by `remoteId` in the dedup signature (see §6), and the blob model is **not** keyed on name so same-named cross-DB entities never overwrite each other.
- **Read-only scope (precise).** The check is **read-only against every Arr** — it never issues an Arr write. It inherits exactly **one idempotent app-DB write**: `generatePreview` calls `arrNamespaceQueries.getOrCreate` (syncer.ts:484) to register namespaces. This is required for correlation, benign, and idempotent (repeated runs converge). A **read-only namespace resolver** that pre-warms/reads without inserting is the named seam (§11) if strict app-DB read-only is later required; V1 accepts the bounded write rather than forking a pure engine variant (addresses critique: the preview writes via `getOrCreate` so it is not purely read-only — the claim is now scoped and the residual write documented).
- **Blocking single-process scheduler mitigation.** The sweep is **chunked** (`DRIFT_SWEEP_CHUNK_SIZE`, §5): each job invocation processes a bounded slice and self-enqueues a continuation, so the single serialized runner is yielded between chunks and sync/other jobs are never starved. Within a chunk it is further bounded: heartbeat-first (`{timeout:5000, retries:0}`), full-check under a `Promise.race` ~20 s wall-clock budget (→ `error`/`timeout`), `CONCURRENCY_LIMIT=3` via `processBatches`, and each `checkAndPersistInstance` is its own `try/catch` that never throws. Not HA/multi-process safe; that is an explicit out-of-scope (addresses critique: a full sweep inside the single-flag serialized dispatcher blocks all other jobs).
- **429 / on-demand.** Two layers: (a) the user-facing `POST /drift/[id]` gates on a dedicated `$sync/drift/limits.ts` sliding window (`DRIFT_REFRESH_MAX=3 / 60 s` per instance, `registerDriftRefreshAttempt`, `resetDriftRefreshRateLimitForTests`) → 429 + `Retry-After`; (b) **both** sweep and on-demand gate every `generatePreview` through the **shared** `registerPreviewCreateAttempt` (6/60 s) so drift + sync-preview cannot collectively exceed an Arr's tolerance. On the shared window sweep skips (`rate_limited`), on-demand returns 429. `BaseHttpClient` has no 429 handling — respecting Arr `Retry-After` is net-new and out of V1 (bounded timeout + shared window + concurrency is the V1 envelope).
- **Credential handling.** Clients are built **only** via `getArrInstanceClient` (SSRF-checked, creds decrypted from `arr_instance_credentials`); `instance.api_key` is never read (always `''`). Loads expose only `id/name/type`. Nothing raw is persisted — `reason` is the sanitized closed union, `name` is namespace-stripped, `fields` are `FieldChange[]` (already exclude volatile id/links/timestamps).
- **PCD-cache degradation.** `isPcdCacheReady` (`getCache().isBuilt()`) is checked **before** trusting a result; a cold cache → `error`/`cache_not_ready`, never a false `in-sync` and never a 500. The UI can render `cache_not_ready` as "warming up".

---

## 10. Testing Strategy

**Pure unit (no DB, no network):**

- `aggregateDrift` — feed canned `GeneratePreviewResult` fixtures mixing `update`/`create`/`delete`/`unchanged` across all sections; assert action→count→category mapping, that `unmanaged` never contributes to drift, that `unchanged` is never emitted into `changes`, `allSectionsErrored` detection, and that sections **outside `availableSections`** are excluded.
- `driftSignature` — stability (reorder entities/fields → identical signature), sensitivity (add a drifted field → different signature), `remoteId` disambiguation (two same-named `update` entities with different `remoteId` → distinct tokens), and `delete`/`unchanged` exclusion.
- `shouldNotify` — every transition: first drift, `in-sync→drifted`, `drifted→drifted` (same vs changed signature), `drifted→in-sync`, recovery-then-redrift re-alerts, `unreachable`/`unauthorized`/`error` (must not fire).

**`checkInstanceDrift` with injected deps (no network/DB):**

- `getSystemStatus → {ok:false,status:401}` ⇒ `unauthorized`, no disable, no notify; `{ok:false}` ⇒ `unreachable`; `isPcdCacheReady=false` ⇒ `error`/`cache_not_ready`; `registerPreviewAttempt=false` ⇒ `error`/`rate_limited`; `resolveAvailableSections=∅` ⇒ `in-sync`/`not_configured`; `generatePreview` stub with drift fixtures ⇒ `drifted`; clean ⇒ `in-sync`; unmanaged-only ⇒ `in-sync`; throwing stub ⇒ `error`; slow stub + fake clock ⇒ `error`/`timeout` (budget branch); **version-unavailable section stub** ⇒ that section skipped, no false `error`. `now` makes `checkedAt` deterministic.

**Persist + notify shell** (in-memory app DB, real migration applied like `tests/pcd/snapshots/service.test.ts`): assert the transactional upsert **replaces** the single row (no growth), that a failed check leaves `changes`/`content_checked_at` untouched, `shouldNotify` fires exactly once on new drift, does **not** re-fire on identical repeat, does **not** fire on unmanaged-only change, and `notified_signature` advances only after a successful emit. Reset the shared window with `resetPreviewCreateRateLimitForTests()` in `beforeEach`.

**Job handler / chunking** — a fixture with more instances than `DRIFT_SWEEP_CHUNK_SIZE` asserts each invocation processes one bounded chunk, self-enqueues a continuation with the advanced `cursor`, and only the terminal chunk returns `rescheduleAt = nextInterval` + `markRun`; assert the dispatcher is yielded between chunks.

**Query modules** — `driftSettingsQueries` / `driftStatusQueries` against a temp DB (get/upsert/markRun/markFailure/markNotified).

**Route tests** — summary (degraded, one unreachable instance, never 500, no `WHERE status` regression); detail (404 unknown, degrade-not-500 for unauthorized/cache_not_ready, `create`/`delete` render as identity-only); POST refresh (200 / 404 / 400 unsupported / 409 in-flight / 429 + `Retry-After`); PUT settings (validation + that it reschedules/cancels the job).

**Backoff** — handler returns `rescheduleAt` with exponential growth and incremented `error_count` on failure; resets both on success.

**Correctness tests the risks demand (brief §5):**

1. **Namespace correlation** — drive a real section diff (`diffEntityCollection` / a syncer's `generatePreview` with a stubbed client returning a live payload whose CF/QP names carry the per-DB namespace suffix) and assert the managed entity resolves to `update`/`unchanged`, **never** `create`+`delete`. Highest-severity regression guard.
2. **Cross-DB same-name** — two databases syncing a same-named entity to one instance: assert both survive in `changes[]` (blob not name-keyed) and produce distinct signature tokens via `remoteId`.
3. **Array-key false positives** — feed a live payload with a **reordered** keyed array (e.g. CF `specifications`, QP `items`) through the real section diff and assert **no** false `update` drift (verifies the inherited `sectionDiffs.ts` key strategy — never the `PORTABLE_*` set — is applied). Include a nested-array case (e.g. `OrderedItem.members`) to document the known index-churn boundary.

---

## 11. Extension Seams (named, not built)

| Future (issue)                        | Attach point                                                                                                                                                                                                        | Rework required                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Ack / snooze / mute** (Q4)          | `ADD COLUMN acknowledged_signature TEXT, snoozed_until TEXT`; `shouldNotify` gains `&& next.drift_signature !== acknowledged_signature`; UI mute button                                                             | None to V1 tables — `drift_signature` is already the exact ack primitive.  |
| **History / trends** (#27)            | New append-only `drift_status_history(arr_instance_id, checked_at, drift_signature, status, counts…)` snapshotted alongside the upsert                                                                              | None — status/detail contract untouched.                                   |
| **Config health scoring** (#22)       | Read the already-separated `drifted_count`/`missing_count`/`unmanaged_count` and weight them; when cross-entity SQL is needed, add a normalized `drift_entity_changes(...)` child table **alongside** the JSON blob | None to V1 tables — counts already category-split.                         |
| **Per-instance schedules** (Q6)       | New `drift_instance_schedule(...)` + `dedupeKey 'drift.check:<id>'`; global settings stays the default                                                                                                              | None — schedule fan-out only.                                              |
| **Split fast-heartbeat cadence** (Q3) | `ADD COLUMN heartbeat_interval_minutes`; a heartbeat-only sweep updates `status`/`checked_at`, full sweep updates content                                                                                           | None — `content_checked_at` + reachability statuses already exist.         |
| **Read-only namespace resolver**      | Replace `getOrCreate` in the drift path with a read-only namespace lookup (or pre-warm namespaces)                                                                                                                  | Engine-level; contract untouched — removes the one inherited app-DB write. |
| **Chunk/concurrency tuning**          | `DRIFT_SWEEP_CHUNK_SIZE` / `CONCURRENCY_LIMIT` as settings columns                                                                                                                                                  | None — already parameterized.                                              |
| **Alert-on-extra / strict mode**      | `ADD COLUMN alert_on_extra INTEGER`; promote `unmanaged` → alerting                                                                                                                                                 | None — `unmanaged_count` + delete rows already persisted.                  |
| **Value-level re-alerting**           | Include a `FieldChange` value hash in `driftSignature`                                                                                                                                                              | One-line change.                                                           |

---

## 12. Out of Scope (V1)

- Cross-instance / cross-entity drift comparison and any drift SQL analytics (that is #22/#27 — V1 is strictly instance-scoped, reads whole-instance).
- Drift **history / trends** — latest-state only; a drift that self-heals between sweeps leaves no audit until #27.
- **Acknowledge / snooze / mute**; **config health scoring**; **per-instance / per-entity watch schedules**.
- **Auto-remediation** — drift never writes to any Arr; it is Arr-read-only and info-only. (The single inherited app-DB `getOrCreate` namespace write is documented in §9, not an Arr mutation.)
- Alerting on **reachability transitions** (`unreachable`/`unauthorized`/`error`) or on **recovery** (`drifted → in-sync`); connectivity alerting stays with `arrSync`.
- **`chaptarr` / `all`** drift — `radarr|sonarr|lidarr` only.
- **Arr `429` / `Retry-After` respect** — V1 bounds load via timeout + shared preview window + concurrency 3 + chunking only.
- **Multi-process / HA scheduler safety** — the single-`setTimeout` queue and the module-level in-flight `Set` are process-local by design.
- Per-entity JSON payload **size caps** (mirroring `PREVIEW_MAX_SNAPSHOTS`) — flagged as a follow-up if real-world payloads prove large. (Row count is already bounded by `#instances` via latest-state upsert + no `unchanged` persistence, so table growth is not a concern; only per-row blob size is the open follow-up.)
