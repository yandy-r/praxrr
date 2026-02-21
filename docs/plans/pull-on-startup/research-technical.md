# Technical Specifications: pull-on-startup

## Executive Summary

`pull-on-startup` adds an optional startup import pass (`PULL_ON_START=true|false`) that reads supported settings from enabled Arr instances and reconciles them into Praxrr-managed state with strict Arr-type scoping. The startup path is **best-effort, non-blocking**, and runs after caches are initialized so matching can be performed against compiled PCD data.

Recommended behavior:

- Treat this as a **bootstrap alignment** feature, not a replacement for normal sync jobs.
- Pull only resources with deterministic matching (name + normalized semantic fingerprint).
- Skip known Arr defaults and ambiguous matches.
- Persist imported/updated state through existing PCD operation writes; persist execution/audit state in app DB.

## Architecture Design

### Startup Integration and Data Flow

```text
hooks.server.ts
  -> config.init()
  -> db.initialize()
  -> runMigrations()
  -> logSettings.load()
  -> pcdManager.initialize()   (PCD caches compiled)
  -> reconcileEnvInstances()
  -> pullOnStartupOrchestrator.runIfEnabled()   [NEW]
       -> read feature flags / run-state
       -> enumerate enabled arr_instances
       -> for each instance (bounded concurrency):
            -> getArrInstanceClient(arr_type, instance_id)
            -> fetch remote resources by arr_type
            -> filter Arr defaults
            -> matcher (name + metadata fingerprint) against PCD cache
            -> pull handlers (upsert via PCD entity writers)
            -> update app-db run stats + per-instance outcome
       -> emit structured startup summary log
  -> initializeJobs()
  -> server ready
```

### Component Boundaries

1. **Startup Trigger Layer**

- Responsibility: evaluate `PULL_ON_START`; ensure run ordering and non-blocking behavior.
- Integration point: `packages/praxrr-app/src/hooks.server.ts` after `pcdManager.initialize()` and env instance reconciliation, before `initializeJobs()`.

2. **Pull Orchestrator (`$lib/server/pull/startup`)**

- Responsibility: run lifecycle, concurrency control, retry budget, timeout envelope, final summary.
- Owns per-instance execution context: `instanceId`, `arrType`, `databaseId`, runId, deadline.

3. **Arr Fetch Adapters (`$lib/server/pull/adapters`)**

- Responsibility: normalize Radarr/Sonarr/Lidarr payloads into a shared pull DTO while preserving arr-specific semantics.
- Must dispatch by explicit `arr_type` only.

4. **Matcher + Safeguards (`$lib/server/pull/matching`)**

- Responsibility: determine exact, fuzzy, ambiguous, or default-only outcomes.
- Deterministic matching keys:
  - primary: exact name (case-insensitive compare, preserve original name)
  - secondary: semantic fingerprint per entity (selected normalized fields)
- Reject ambiguous many-to-one or cross-arr-type candidates.

5. **PCD Write Bridge (`$lib/server/pull/writers`)**

- Responsibility: call existing entity-level create/update writers (user layer) and avoid raw SQL duplication.
- Reuses `writeOperation` path so validation/compile/supersede behavior remains centralized.

6. **Run State + Audit (`$db/queries/startupPull.ts`)**

- Responsibility: idempotency guardrails, status visibility, retry bookkeeping, and startup diagnostics.

### Sync/PCD Subsystem Integration

- **PCD subsystem**: pull uses existing entity modules (`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`) and `writeOperation` so all operation metadata/history behavior remains consistent.
- **Sync subsystem**: startup pull does not directly run Arr push sync. Optional follow-up can mark relevant sections pending (`arrSyncQueries.set*StatusPending`) only when pull produced writes.
- **Job system**: startup pull runs before jobs to avoid racing with scheduled/manual sync jobs at boot.

## Data Models

### Schema Changes

A small app-DB state table is recommended for resilience and observability.

```sql
CREATE TABLE IF NOT EXISTS startup_pull_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL,                          -- yyyy-mm-ddThh:mm startup stamp / uuid
  trigger TEXT NOT NULL DEFAULT 'startup',
  status TEXT NOT NULL,                           -- running | success | partial | failed | skipped
  pull_on_start_enabled INTEGER NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  instances_total INTEGER NOT NULL DEFAULT 0,
  instances_succeeded INTEGER NOT NULL DEFAULT 0,
  instances_failed INTEGER NOT NULL DEFAULT 0,
  resources_imported INTEGER NOT NULL DEFAULT 0,
  resources_skipped_default INTEGER NOT NULL DEFAULT 0,
  resources_skipped_ambiguous INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS startup_pull_instance_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  arr_type TEXT NOT NULL,
  status TEXT NOT NULL,                           -- success | partial | failed | skipped
  matched_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_default_count INTEGER NOT NULL DEFAULT 0,
  skipped_ambiguous_count INTEGER NOT NULL DEFAULT 0,
  skipped_unsupported_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  FOREIGN KEY (run_id) REFERENCES startup_pull_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
);

CREATE INDEX idx_startup_pull_runs_started_at ON startup_pull_runs(started_at DESC);
CREATE INDEX idx_startup_pull_instance_runs_run_id ON startup_pull_instance_runs(run_id);
CREATE INDEX idx_startup_pull_instance_runs_instance_id ON startup_pull_instance_runs(instance_id);
```

### Rationale (vs no-schema-change)

- Without schema changes, failures are only in logs and are hard to inspect from UI/API.
- Pull-on-startup is autonomous and can fail before users open the app; persisted run records materially improve operability.
- Existing `setup_state` is singleton/boolean-oriented and not suitable for run-level diagnostics.

### Migration and Backfill

- Add one migration file for both tables; no destructive backfill required.
- Existing installations start with empty history; first startup creates first run row.
- Optional retention policy: keep last N (e.g., 30) runs via periodic cleanup or insert-time truncation.

## API Design

### Internal Contracts (Required)

```ts
export interface PullOnStartupOptions {
  enabled: boolean;
  maxInstanceConcurrency: number; // default: 2
  requestTimeoutMs: number; // default: 10000
  perInstanceTimeoutMs: number; // default: 45000
  maxRetries: number; // default: 2
  baseBackoffMs: number; // default: 500
}

export interface StartupPullRunResult {
  runId: number;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  instancesTotal: number;
  instancesSucceeded: number;
  instancesFailed: number;
  importedCount: number;
  skippedDefaultCount: number;
  skippedAmbiguousCount: number;
}

export interface ArrPullHandler {
  readonly arrType: 'radarr' | 'sonarr' | 'lidarr';
  fetch(client: BaseArrClient): Promise<ArrPullSnapshot>;
  filterDefaults(snapshot: ArrPullSnapshot): ArrPullSnapshot;
  match(cache: PCDCache, snapshot: ArrPullSnapshot): Promise<PullMatchSet>;
  apply(matchSet: PullMatchSet, ctx: PullWriteContext): Promise<PullApplyResult>;
}
```

### External API Routes (Optional but Recommended)

No new route is required for core functionality. For supportability, add read-only status:

- `GET /api/v1/system/startup-pull/latest` -> latest run summary + per-instance outcomes.

This route is operational only; it does not trigger pull execution.

## System Constraints

### Error Handling and Safeguards

- Startup must not fail if pull fails; errors are logged and persisted, then startup continues.
- Fail fast per instance on credential/decryption errors; do not auto-disable instances from this path.
- Per-entity failures do not abort whole instance when safe to continue (partial status).
- Hard-skip conditions:
  - unsupported `arr_type`
  - no compiled cache/database target
  - ambiguous match candidates
  - entities recognized as Arr defaults

### Retries, Backoff, Timeout

- HTTP-level retries leverage client options, plus orchestrator-level retries for transient failures (5xx/timeouts).
- Backoff: exponential with jitter (`500ms`, `1s`, `2s` capped).
- Timeouts:
  - request timeout default `10s`
  - per-instance execution cap `45s`
  - global orchestrator cap optional `3m`

### Observability

- Structured logs with source `StartupPull` and `StartupPull:<arrType>`.
- Required log fields: `runId`, `instanceId`, `arrType`, `entityType`, `action`, `outcome`, `reason`, `durationMs`.
- Persisted summary in `startup_pull_runs` and `startup_pull_instance_runs`.
- User-visible signal: surface latest run status in settings/system page (or via API above).

### Arr-Specific Semantic Guardrails (Required)

- Explicit dispatch by `arr_type` at entry and handler layers.
- No sibling fallbacks (e.g., never process Lidarr metadata profiles through Sonarr/Radarr code paths).
- Entity mapping must be arr-specific:
  - Radarr/Sonarr: delay profile defaults recognized by shape + known IDs.
  - Lidarr: metadata profile pull only for `arr_type='lidarr'`.
- Reject cross-arr inferred mappings; mark as skipped/unsupported.

### Testing Strategy

1. **Unit tests**

- Env parsing for `PULL_ON_START` and defaults.
- Matcher behavior: exact, metadata match, ambiguous, no match.
- Default filters for each arr type (especially delay/default profiles).
- Retry/backoff and timeout cancellation.

2. **Integration tests**

- Startup sequence integration around `hooks.server.ts` order.
- Pull writes create expected `pcd_ops` metadata and compile succeeds.
- Run-state rows created/updated correctly for success/partial/failure.
- Mixed instance set (radarr+sonarr+lidarr) with isolated arr-type dispatch.

3. **E2E/behavior tests**

- First startup with `PULL_ON_START=true` imports expected matches only.
- Restart idempotency: second run performs zero-op updates where unchanged.
- Arr default resources are not imported.
- Credential failure yields non-blocking startup + visible failed run status.

## Codebase Changes

### Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`
  - Invoke startup pull orchestrator in startup sequence.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`
  - Parse `PULL_ON_START` and related tuning env vars.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`
  - Register new migration for startup pull run tables.

### Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/orchestrator.ts`
  - Main run pipeline, concurrency, retry, timeout.
- `packages/praxrr-app/src/lib/server/pull/startup/types.ts`
  - Contracts for run context, match/apply result, DTOs.
- `packages/praxrr-app/src/lib/server/pull/startup/handlers/radarr.ts`
  - Radarr fetch/filter/match/apply implementation.
- `packages/praxrr-app/src/lib/server/pull/startup/handlers/sonarr.ts`
  - Sonarr fetch/filter/match/apply implementation.
- `packages/praxrr-app/src/lib/server/pull/startup/handlers/lidarr.ts`
  - Lidarr fetch/filter/match/apply implementation.
- `packages/praxrr-app/src/lib/server/pull/startup/matching.ts`
  - Shared matching utilities and ambiguity checks.
- `packages/praxrr-app/src/lib/server/pull/startup/defaultFilters.ts`
  - Arr-default detection and skip rules.
- `packages/praxrr-app/src/lib/server/db/queries/startupPull.ts`
  - CRUD for run/instance-run audit rows.
- `packages/praxrr-app/src/lib/server/db/migrations/20260223_create_startup_pull_runs.ts`
  - Adds `startup_pull_runs` + `startup_pull_instance_runs`.
- `packages/praxrr-app/src/routes/api/v1/system/startup-pull/latest/+server.ts` (optional)
  - Read-only status endpoint.

### Reuse Existing PCD Writers

Prefer entity-level modules instead of direct SQL:

- `qualityProfiles` create/update paths
- `delayProfiles` create/update paths
- `mediaManagement` naming/media-settings/quality-definitions create/update paths
- `metadataProfiles` create/update (Lidarr only)

## Technical Decisions

1. **Run point in startup sequence**: after PCD cache init and env instance reconciliation, before jobs.
2. **Persistence**: add run-history tables for supportability and diagnostics.
3. **Default mode**: `PULL_ON_START` defaults to `false`.
4. **Failure model**: non-blocking startup; status persisted as `partial/failed`.
5. **Match strategy**: exact-name first, metadata fingerprint second, otherwise skip.
6. **Default resource policy**: explicit deny-list/heuristics per arr type; never import defaults.
7. **Safety over completeness**: ambiguous or unsupported mappings are skipped, not guessed.

## Open Questions

1. **Target database resolution**: when multiple PCD databases are enabled, should startup pull target all caches, first writable cache, or require explicit `PULL_ON_START_DATABASE_ID`?
   - Recommended default: require explicit database ID when more than one enabled database exists; otherwise skip with warning.
2. **Resource scope**: should startup pull include custom formats in v1, or only sync-surface settings currently requested (quality profiles, delay, media management, metadata)?
   - Recommended default: include only requested settings surfaces for v1.
3. **Run frequency controls**: should repeated restarts in short windows be throttled?
   - Recommended default: minimum interval guard (`PULL_ON_START_MIN_INTERVAL_MINUTES`, default 0/off).
4. **UI surfacing**: where should latest startup pull status be shown (settings dashboard, system health, both)?
   - Recommended default: system health panel + optional API endpoint.
5. **Credential failure behavior**: should repeated startup pull credential failures disable instance automatically (as some job handlers do)?
   - Recommended default: do not auto-disable from startup pull; log + persist failure only.
