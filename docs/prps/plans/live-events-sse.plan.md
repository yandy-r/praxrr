# Plan: Live job & sync progress via SSE (`GET /api/v1/events`) — YAN-593 / GH #335

## Contents

- Summary
- User Story
- Problem → Solution
- Metadata
- Batches
- UX Design
- Mandatory Reading
- External Documentation
- Patterns to Mirror
- Files to Change
- NOT Building
- Step-by-Step Tasks
- Testing Strategy
- Validation Commands
- Acceptance Criteria
- Completion Checklist
- Risks
- Notes

## Summary

This plan adds an auth-gated Server-Sent Events stream at `GET /api/v1/events`. It is fed by an
in-process event bus (a `globalThis` singleton) with a 256-event replay ring.

- **Server:** the dispatcher, enqueue paths, sync-history recorder, canary flow, and drift
  persistence publish allow-listed lifecycle events after they write to the DB.
- **Client:** `eventsStore` holds one `EventSource` per tab, with its own backoff and replay.
- **Pages:** the Jobs, Arr Sync, Sync History, Canary, and Drift pages refresh through debounced
  `invalidate()` calls.
- **Root layout:** shows completion toasts with a "View details" link and a quiet connection
  indicator.

Source spec: `docs/plans/live-events-sse/feature-spec.md`. Authoritative decisions:
`docs/plans/live-events-sse/decisions.md`.

## User Story

As a Praxrr operator, I want job and sync progress to update live and to get a toast when my sync
finishes, so that I know a sync I triggered actually ran and how it ended, without reloading pages.

## Problem → Solution

**Today:**

- "Sync now" shows a green "… sync queued" toast and nothing more.
- Settings → Jobs never lists manual jobs (`listScheduled` filters on `source = 'schedule'`).
- The Arr Sync page has no server-side running state.
- No page refreshes itself.

**After this plan:**

- Every page reflects queued → running → result within ~250 ms of the DB change.
- Manual jobs toast their outcome, with a link to `/sync-history/{id}`.
- Short disconnects replay missed events, so their toasts still fire.
- Long gaps or restarts send `resync`, so pages reload their data.
- With the stream blocked, everything still works as it does today (AC3).

## Metadata

- **Complexity**: XL
- **Source PRD**: `docs/plans/live-events-sse/feature-spec.md`
- **PRD Phase**: N/A (single PR, no feature flag, per decision 13)
- **Estimated Files**: 72 (24 created, 45 hand-edited, 3 generated)

---

## Batches

Tasks are grouped by dependency for parallel execution. Tasks in the same batch run concurrently,
and batches run in order. No two tasks in a batch touch the same file.

| Batch | Tasks                        | Depends On | Parallel Width |
| ----- | ---------------------------- | ---------- | -------------- |
| B1    | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | —          | 6              |
| B2    | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | B1         | 6              |
| B3    | 3.1, 3.2, 3.3, 3.4, 3.5      | B2         | 5              |
| B4    | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | B3         | 6              |
| B5    | 5.1                          | B4         | 1              |

- **Total tasks**: 24
- **Total batches**: 5
- **Max parallel width**: 6

**Dependency graph:**

```text
1.1 types ─┬─▶ 2.1 bus+publish ─┬─▶ 3.1 dispatcher ─┬─▶ 4.6 dispatcher test
           │                    ├─▶ 3.2 enqueue ─────┘
           │                    ├─▶ 3.3 domain (record/canary/drift)
           ├─▶ 2.2 sse+caps ────┴─▶ 3.4 stream+route ─▶ 4.5 docs
           ├─▶ 2.3 client pure ─────▶ 3.5 store+toasts+indicator ─┬─▶ 4.1 layout
           ├─▶ 2.4 loads (jobs/history/canary) ───────────────────┼─▶ 4.2 jobs UI, 4.4 history/canary/drift UI
           ├─▶ 2.5 arr-sync load ──────────────────────────────────┴─▶ 4.3 arr-sync live UI
           └─▶ 2.6 contract test (also needs 1.2)
1.2 OpenAPI ─▶ 2.6     1.3 queries ─▶ 2.4, 3.4     1.4 alerts ─▶ 3.5     1.5 scope ─▶ 3.4     1.6 queued toasts ─▶ 2.5 (ordering only), 4.3 (same component files)
all ─▶ 5.1 validation
```

---

## UX Design

### Before

```text
/arr/3/sync  [Sync Now] ──▶ toast(success) "Delay profiles sync queued"  …nothing else, ever
/settings/jobs              scheduled jobs only; manual jobs invisible; static until reload
/sync-history, /canary/{id} static until reload
```

### After

```text
/arr/3/sync  [Sync Now] ──▶ toast(info) "Delay profiles sync queued"
             footer chip:  [Queued] ─▶ [Syncing…] ─▶ (cleared, "Last synced" updated)
any page     toast(success) "Arr Sync (Delay Profiles) - Radarr 4K finished"   [View details] [×]
                                         └─▶ /sync-history/{syncHistoryId}  (else /settings/jobs)
/settings/jobs  ┌ Active jobs ───────────────────────────────┐
                │ Arr Sync (Delay Profiles) - Radarr 4K  ⟳ Running  manual │
                └────────────────────────────────────────────┘  + scheduled table + history (live)
sidebar version card:  (nothing when healthy)  │ ● Reconnecting…  (>10 s down)  │ ● Live updates paused (signed out)
```

### Interaction Changes

| Touchpoint              | Before                                            | After                                                                            | Notes                                                                                       |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sync section "Sync Now" | `success` toast "… queued"                        | `info` toast; footer chip Queued → Syncing…; button disabled while active        | Chip comes from server `sync_status` (`pending`/`in_progress`)                              |
| Job completion          | none                                              | Toast by policy, with a "View details" link                                      | Manual jobs: every outcome. Background sync-family jobs: failures only, coalesced over 60 s |
| Settings → Jobs         | Scheduled jobs only, static                       | New "Active jobs" table; all tables refresh live                                 | `listActive()` includes manual jobs                                                         |
| Sync History list       | Static                                            | New rows appear on `sync.recorded`                                               | `invalidate('praxrr:sync-history')`                                                         |
| Canary list/detail      | Static, except after the page's own proceed/abort | Status, batches, and `stateToken` refresh on `canary.updated`                    | Value guards stay valid                                                                     |
| Drift list/detail       | Fetched on mount only                             | Re-fetched on `drift.updated` (detail: matching instance only)                   | Existing client loaders, debounced                                                          |
| Toast markup            | Whole toast is `role="button"`                    | With an action: `<a>` plus a separate dismiss `<button>`. Without one: unchanged | Persistent live regions announce every toast                                                |
| Connection lost         | n/a                                               | Hidden for 10 s, then an indicator in the version card                           | Never a toast or a modal                                                                    |

---

## Mandatory Reading

| Priority       | File                                                                        | Lines            | Why                                                                                                                       |
| -------------- | --------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P0 (critical)  | `docs/plans/live-events-sse/decisions.md`                                   | all              | Authoritative resolutions (wins over the research)                                                                        |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`                     | 54-153           | running/finished publish points, handler-not-found, reschedule                                                            |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`                     | 10-37, 197-211   | `JOB_TYPES`, `JobStatus`, `JobRunStatus`, `JobSource`, `JobQueueRecord`                                                   |
| P0 (critical)  | `packages/praxrr-app/src/hooks.server.ts`                                   | 251-319          | Auth gate (401 JSON for `/api`), `enforceTokenScope`                                                                      |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`              | 18-62            | Route → scope policy                                                                                                      |
| P1 (important) | `packages/praxrr-app/src/lib/server/jobs/queueService.ts`                   | 1-19             | Enqueue fan-in                                                                                                            |
| P1 (important) | `packages/praxrr-app/src/lib/server/jobs/helpers/pcdSyncQueue.ts`           | 43-77            | Direct `upsertScheduled` that bypasses `queueService`                                                                     |
| P1 (important) | `packages/praxrr-app/src/lib/server/jobs/helpers/trashGuideSyncQueue.ts`    | 110-176          | Manual TRaSH enqueue wrapper                                                                                              |
| P1 (important) | `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts`             | 186-212          | Never-throw recorder, the `sync.recorded` point                                                                           |
| P1 (important) | `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`             | 247-399          | Canary transitions                                                                                                        |
| P1 (important) | `packages/praxrr-app/src/lib/server/jobs/handlers/canaryRollout.ts`         | 74-135           | Batch progress and finish                                                                                                 |
| P1 (important) | `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`                  | 95-130           | Drift upsert                                                                                                              |
| P1 (important) | `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`                 | 135-228          | Query style, datetime normalization                                                                                       |
| P1 (important) | `packages/praxrr-app/src/lib/server/db/queries/apiTokens.ts`                | 35, 101-108      | `ACTIVE_PREDICATE`                                                                                                        |
| P1 (important) | `packages/praxrr-app/src/lib/server/db/queries/sessions.ts`                 | 86-94            | `getValidById`                                                                                                            |
| P1 (important) | `packages/praxrr-app/src/lib/server/utils/auth/principal.ts`                | 10-19            | `AuthPrincipal` union                                                                                                     |
| P1 (important) | `packages/praxrr-app/src/lib/server/mcp/context.ts`                         | 19-30            | Structural locals type (server files are deno-checked without `app.d.ts`)                                                 |
| P1 (important) | `packages/praxrr-app/src/lib/client/alerts/store.ts`                        | 1-46             | `alertStore.add` signature                                                                                                |
| P1 (important) | `packages/praxrr-app/src/lib/client/alerts/Alert.svelte`                    | 1-61             | Current toast markup (legacy `on:`)                                                                                       |
| P1 (important) | `packages/praxrr-app/src/routes/+layout.svelte`                             | 1-35             | Mount point, `isAuthPage`                                                                                                 |
| P1 (important) | `packages/praxrr-app/src/routes/settings/jobs/+page.server.ts`              | 1-58             | Jobs load                                                                                                                 |
| P1 (important) | `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`              | 247-404, 760-933 | Sync load and actions                                                                                                     |
| P1 (important) | `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte` | 1-107            | Sync Now button / `syncDisabled`                                                                                          |
| P2 (reference) | `packages/praxrr-app/src/tests/routes/syncHistory.test.ts`                  | 1-61             | `migratedTest` plus route-handler casting                                                                                 |
| P2 (reference) | `packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts`         | 236-270          | Scope table test                                                                                                          |
| P2 (reference) | `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`              | 1-60             | Contract-test style (`satisfies`)                                                                                         |
| P2 (reference) | `docs/api/v1/paths/system.yaml`                                             | 67-110           | Non-JSON response, `X-Api-Key` param, 401/403 refs                                                                        |
| P2 (reference) | `docs/api/v1/schemas/canary.yaml`                                           | 9-35, 257-270    | Enums, `oneOf` + discriminator                                                                                            |
| P2 (reference) | `scripts/test.ts`                                                           | 11-60            | Test aliases                                                                                                              |
| P2 (reference) | `.prettierrc`                                                               | all              | **Actual** format: 2 spaces, semicolons, `trailingComma: es5`, width 120 (the `CLAUDE.md` text is stale; follow the file) |

## External Documentation

| Topic                   | Source                                                                      | Key Takeaway                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SSE framing             | https://html.spec.whatwg.org/multipage/server-sent-events.html              | A blank line dispatches; `id:` sets `Last-Event-ID`; frames without `id:` keep the previous one; `retry:` sets the reconnect delay |
| EventSource             | https://developer.mozilla.org/en-US/docs/Web/API/EventSource                | Same-origin requests always send cookies; a non-200 response closes it permanently (`readyState` 2) and the status is unreadable   |
| Deno streaming          | https://docs.deno.com/runtime/fundamentals/http_server/                     | You must implement `cancel()`, or chunks queue forever                                                                             |
| Deno abort              | https://docs.deno.com/runtime/reference/deno_serve_legacy_abort/            | `request.signal` aborts when the request finishes or disconnects; both paths must call `close()`                                   |
| SvelteKit server routes | https://svelte.dev/docs/kit/routing#server                                  | `+server.ts` may return any `Response`; when `HEAD` is not exported, Kit runs `GET`                                                |
| nginx buffering         | http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout | Default timeout is 60 s, so a 20 s heartbeat is needed; `X-Accel-Buffering: no` disables buffering                                 |

---

## Patterns to Mirror

Follow these exactly. The repository formatter is `.prettierrc`: 2-space indent, semicolons,
single quotes, `trailingComma: es5`, `printWidth: 120`. Run `deno task format` at the end.

### NAMING_CONVENTION

```ts
// SOURCE: packages/praxrr-app/src/lib/server/jobs/queueRegistry.ts:3-4,22
class JobQueueRegistry {
  private handlers = new Map<JobType, JobHandler>();
  …
export const jobQueueRegistry = new JobQueueRegistry();
```

A class plus an exported singleton, camelCase. The bus and connection registry wrap that singleton
in `globalThis[Symbol.for('praxrr.events.bus')] ??= new EventBus()` (decision 8: survive HMR).

### ERROR_HANDLING

```ts
// SOURCE: packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts:192-200
export function recordSyncHistory(input: SyncHistoryInput): number | null {
  try {
    if (!isSyncHistoryEnabled()) { return null; }
    const id = syncHistoryQueries.insert(input);
    fireNotification(id, input);
```

Fire-and-forget code never throws into its caller. `publish*()` and `eventBus.publish` wrap their
bodies in `try/catch` and log through `$logger`. Redaction happens by construction, as in
`dispatcher.ts:110-116`: raw errors go to the logger only, never into an event.

### LOGGING_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/server/jobs/dispatcher.ts:95-99
await logger.debug(`Job started: ${job.jobType}`, {
  source: 'JobDispatcher',
  meta: { jobId: job.id, jobType: job.jobType, displayName,
```

New sources are `'LiveEvents'` (bus and publish) and `'LiveEventStream'` (stream). Open, close, and
cap-reject events log at debug or warn. Never log per event, and never log payloads.

### REPOSITORY_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts:135-141
  listQueued(limit: number = 50): JobQueueRecord[] {
    const rows = db.query<JobQueueRow>(
      `SELECT * FROM job_queue WHERE status = 'queued' ORDER BY run_at ASC LIMIT ?`,
      limit
    );
    return rows.map(rowToRecord);
```

Use the `datetime(replace(replace(run_at,'T',' '),'Z',''))` normalization from `jobQueue.ts:187`
whenever you compare against `datetime('now')`.

### SERVICE_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/routes/api/v1/metrics/+server.ts:12-22
export const GET: RequestHandler = async () => {
  …
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
```

Keep the route thin and put the logic in `$lib/server/...`. Auth is enforced centrally by
`authHandle`, so the route must not be added to `PUBLIC_PATHS`.

### CLIENT_STORE_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/client/alerts/store.ts:14-19,45
function createAlertStore() {
  const { subscribe, update } = writable<Alert[]>([]);
  return {
    subscribe,
    add: (type: AlertType, message: string, duration?: number) => {
```

This is a `createXStore()` factory over `writable`. Browser-only code is guarded with
`import { browser } from '$app/environment'` (`lib/client/alerts/settings.ts:2`). Svelte 5 is used
with **no runes**: `export let`, `$:`, and `$store`.

### TEST_STRUCTURE

```ts
// SOURCE: packages/praxrr-app/src/tests/routes/syncHistory.test.ts:37-43,53-56
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn: async () => {
      … db.close(); config.setBasePath(tempBasePath);
      try { await db.initialize(); await runMigrations(); await fn(); }
      finally { jobDispatcher.stop(); db.close(); config.setBasePath(originalBasePath); …
```

Pure tests are plain `Deno.test(...)` with `@std/assert`. Route handlers are invoked directly
(`{ request, locals } as unknown as Parameters<typeof GET>[0]`). Scope-policy cases are added as rows
to the table at `tests/server/utils/auth/apiTokens.test.ts:237-266`.

### SHARED_TYPE_IMPORTS

```ts
// SOURCE: packages/praxrr-app/src/lib/shared/narration/narrate.ts:18-19
import type {
  DriftCategory,
  DriftCounts,
  DriftEntityChange,
  DriftReason,
} from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
```

`$shared` may make **type-only** imports from server modules. It must not make value imports from
server or client code.

---

## Files to Change

Paths are relative to the repository root.

| File                                                                             | Action | Justification                                                     |
| -------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/events/types.ts`                             | CREATE | Event union, constants, dependency keys (single source of truth)  |
| `docs/api/v1/paths/events.yaml`                                                  | CREATE | `GET`/`HEAD /events` contract                                     |
| `docs/api/v1/schemas/events.yaml`                                                | CREATE | `LiveEvent` `oneOf` and variants                                  |
| `docs/api/v1/openapi.yaml`                                                       | UPDATE | Events tag, `/events` path, components entries                    |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                        | UPDATE | Regenerated (`deno task generate:api-types`)                      |
| `packages/praxrr-api/openapi.json`                                               | UPDATE | Regenerated (`deno task bundle:api`)                              |
| `packages/praxrr-api/types.ts`                                                   | UPDATE | Regenerated (`deno task bundle:api`)                              |
| `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`                      | UPDATE | `listActive(limit)`                                               |
| `packages/praxrr-app/src/lib/server/db/queries/apiTokens.ts`                     | UPDATE | `isActiveById(id)`                                                |
| `packages/praxrr-app/src/lib/client/alerts/store.ts`                             | UPDATE | Optional `action` arg                                             |
| `packages/praxrr-app/src/lib/client/alerts/Alert.svelte`                         | UPDATE | Link + dismiss button; `onclick` migration; `aria-hidden`         |
| `packages/praxrr-app/src/lib/client/alerts/AlertContainer.svelte`                | UPDATE | Pass `action`                                                     |
| `packages/praxrr-app/src/lib/client/alerts/MobileNavAlert.svelte`                | UPDATE | `action` → `<a>` pill; `onclick` migration                        |
| `packages/praxrr-app/src/lib/client/ui/navigation/navbar/navbar.svelte`          | UPDATE | Pass `action`                                                     |
| `packages/praxrr-app/src/lib/client/alerts/AlertLiveRegion.svelte`               | CREATE | Persistent polite/assertive regions                               |
| `packages/praxrr-app/src/lib/server/utils/auth/scopePolicy.ts`                   | UPDATE | Explicit events → `read` entry                                    |
| `packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts`              | UPDATE | Scope rows for `/api/v1/events`                                   |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/DelayProfiles.svelte`   | UPDATE | Queued toast `info` (1.6); `liveStatus` prop (4.3)                |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte` | UPDATE | Queued toast `info` (1.6); `liveStatus` prop (4.3)                |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/MediaManagement.svelte` | UPDATE | Queued toast `info` (1.6); `liveStatus` prop (4.3)                |
| `packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte`             | UPDATE | Queued toast `info`                                               |
| `packages/praxrr-app/src/routes/databases/trash/[id]/+page.svelte`               | UPDATE | Queued toast `info`                                               |
| `packages/praxrr-app/src/routes/arr/[id]/rename/+page.svelte`                    | UPDATE | Queued toast `info`                                               |
| `packages/praxrr-app/src/routes/arr/[id]/upgrades/+page.svelte`                  | UPDATE | Queued toast `info`                                               |
| `packages/praxrr-app/src/routes/settings/backups/+page.svelte`                   | UPDATE | Queued toasts `info` (×2)                                         |
| `packages/praxrr-app/src/lib/server/events/bus.ts`                               | CREATE | `EventBus` + ring buffer + `globalThis` singleton                 |
| `packages/praxrr-app/src/lib/server/events/publish.ts`                           | CREATE | Never-throw allow-list builders                                   |
| `packages/praxrr-app/src/lib/server/events/sse.ts`                               | CREATE | Frame encoder, event-id parser                                    |
| `packages/praxrr-app/src/lib/server/events/connections.ts`                       | CREATE | Cap registry (`globalThis`)                                       |
| `packages/praxrr-app/src/lib/client/events/reconnect.ts`                         | CREATE | Pure backoff, parse, failure classifier                           |
| `packages/praxrr-app/src/lib/client/events/toastPolicy.ts`                       | CREATE | Pure toast decision + coalescing                                  |
| `packages/praxrr-app/src/tests/events/clientHelpers.test.ts`                     | CREATE | Backoff/parse/toast-policy tests                                  |
| `packages/praxrr-app/src/routes/settings/jobs/+page.server.ts`                   | UPDATE | `depends`, `activeJobs`                                           |
| `packages/praxrr-app/src/routes/sync-history/+page.server.ts`                    | UPDATE | `depends('praxrr:sync-history')`                                  |
| `packages/praxrr-app/src/routes/canary/+page.server.ts`                          | UPDATE | `depends('praxrr:canary')`                                        |
| `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts`                     | UPDATE | `depends('praxrr:canary')`                                        |
| `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`                   | UPDATE | `depends('praxrr:sync')`, `sectionStatus`, actions return `jobId` |
| `packages/praxrr-app/src/tests/events/contract.test.ts`                          | CREATE | Shared union ⟷ OpenAPI types                                      |
| `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`                          | UPDATE | `job.running`, `job.finished` (3 paths)                           |
| `packages/praxrr-app/src/lib/server/jobs/queueService.ts`                        | UPDATE | `job.queued`                                                      |
| `packages/praxrr-app/src/lib/server/jobs/helpers/pcdSyncQueue.ts`                | UPDATE | `job.queued`                                                      |
| `packages/praxrr-app/src/lib/server/jobs/helpers/trashGuideSyncQueue.ts`         | UPDATE | `job.queued` (manual path)                                        |
| `packages/praxrr-app/src/lib/server/sync/syncHistory/record.ts`                  | UPDATE | `sync.recorded`                                                   |
| `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`                  | UPDATE | `canary.updated` ×4                                               |
| `packages/praxrr-app/src/lib/server/jobs/handlers/canaryRollout.ts`              | UPDATE | `canary.updated` ×2                                               |
| `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`                       | UPDATE | `drift.updated`                                                   |
| `packages/praxrr-app/src/tests/events/bus.test.ts`                               | CREATE | Bus isolation, ring, replay/resync, publish allow-list            |
| `packages/praxrr-app/src/lib/server/events/stream.ts`                            | CREATE | `createEventStream`                                               |
| `packages/praxrr-app/src/lib/server/events/streamAuth.ts`                        | CREATE | Principal key + revalidator from locals                           |
| `packages/praxrr-app/src/routes/api/v1/events/+server.ts`                        | CREATE | `GET` / `HEAD`                                                    |
| `packages/praxrr-app/src/tests/events/stream.test.ts`                            | CREATE | Headers, heartbeat, cleanup, caps, expiry, lifetime               |
| `scripts/test.ts`                                                                | UPDATE | `events` alias                                                    |
| `packages/praxrr-app/src/lib/client/stores/events.ts`                            | CREATE | `eventsStore`                                                     |
| `packages/praxrr-app/src/lib/client/events/liveInvalidate.ts`                    | CREATE | Debounced `invalidate`/`subscribeLive`                            |
| `packages/praxrr-app/src/lib/client/events/jobToasts.ts`                         | CREATE | Events → `alertStore`                                             |
| `packages/praxrr-app/src/lib/client/events/LiveStatusIndicator.svelte`           | CREATE | Connection indicator                                              |
| `packages/praxrr-app/src/routes/+layout.svelte`                                  | UPDATE | Start store + toasts; live region                                 |
| `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/version.svelte`        | UPDATE | Render indicator                                                  |
| `packages/praxrr-app/src/routes/settings/jobs/+page.svelte`                      | UPDATE | Active table + live subscription                                  |
| `packages/praxrr-app/src/routes/settings/jobs/components/ActiveJobs.svelte`      | CREATE | Active jobs table                                                 |
| `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`                      | UPDATE | Live subscription; pass `liveStatus`                              |
| `packages/praxrr-app/src/routes/arr/[id]/sync/liveSync.ts`                       | CREATE | Sync page subscription helper                                     |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`      | UPDATE | `liveStatus` chip, disable Sync Now                               |
| `packages/praxrr-app/src/routes/sync-history/+page.svelte`                       | UPDATE | Live subscription                                                 |
| `packages/praxrr-app/src/routes/canary/+page.svelte`                             | UPDATE | Live subscription                                                 |
| `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`                        | UPDATE | Live subscription                                                 |
| `packages/praxrr-app/src/routes/drift/+page.svelte`                              | UPDATE | Re-run `loadSummary` on `drift.updated`                           |
| `packages/praxrr-app/src/routes/drift/[instanceId]/+page.svelte`                 | UPDATE | Re-run `loadDetail` on a matching `drift.updated`                 |
| `packages/praxrr-app/src/tests/jobs/dispatcherEvents.test.ts`                    | CREATE | Event order, no raw error text                                    |
| `docs/api/endpoints.md`                                                          | UPDATE | Index row + `/events` section                                     |
| `docs/site/src/content/docs/guides/syncing-profiles.md`                          | UPDATE | "Live progress" subsection                                        |
| `docs/site/src/content/docs/guides/troubleshooting.md`                           | UPDATE | "Live updates paused / proxies" section                           |

## NOT Building

- WebSockets, or any SSE library (`sveltekit-sse`, `@microsoft/fetch-event-source`, `@std/http`
  `ServerSentEventStream`). No new dependency of any kind.
- Replacing the clock-tick `setInterval`s (`SyncPreviewPanel.svelte:147`, `RenameSettings.svelte:40`,
  `CoreSettings.svelte:38`). They are not data polling.
- A single connection shared across tabs (BroadcastChannel or SharedWorker), per-section progress
  percentages, a multi-process or Redis bus, stream metrics, or dashboard badges (YAN-589).
- Patching table rows in place from event payloads. Pages re-run `load()` instead (decision 2).
- Cancellation events from `jobQueueQueries.setStatus` or `cancelByDedupeKey`, and from
  `recoverRunning()` at boot.
- Push-closing streams from logout or session-revoke actions. The heartbeat closes them within 20 s.
- Fixing the pre-existing raw `error` text in the sync-history API. That needs its own issue.
- A feature flag or env vars for the caps (decision 13). Use constants only.
- Publishing from `lib/server/jobs/schedule.ts` recurring upserts. That would flood the stream at
  boot.
- Toasts for `sync.recorded` with `jobId === null` (reviewed apply and canary inline). The
  initiating tab already shows the HTTP result.

---

## Step-by-Step Tasks

All source paths below are relative to `packages/praxrr-app/src/` unless they start with `docs/`,
`scripts/` or `packages/`. Every task follows the `.prettierrc` style. Do not run the formatter or
the test suite inside a task; task 5.1 does that.

### Batch 1 — Contracts and independent building blocks

### Task 1.1: Shared live-event types and constants — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `lib/shared/events/types.ts`.
- **IMPLEMENT**:
  - Type-only imports:
    - `JobType`, `JobStatus`, `JobRunStatus`, `JobSource` from `$jobs/queueTypes.ts`
    - `JobFailureCode` from `$shared/jobs/evidence.ts`
    - `SyncOperationStatus`, `SyncTrigger` from `$sync/syncHistory/types.ts`
    - `CanaryRolloutStatus`, `CanaryOutcomeStatus` from `$sync/canary/types.ts`
    - `DriftStatus` from `$sync/drift/types.ts`
    - `SyncPreviewArrType` from `$sync/preview/types.ts`
  - Export `type LiveArrType = SyncPreviewArrType`.
  - Export `LIVE_EVENT_TYPES = ['hello','resync','job.queued','job.running','job.finished','sync.recorded','canary.updated','drift.updated','session.expired'] as const`
    and `type LiveEventType`.
  - Export `interface LiveJobEventBase { jobId: number; jobType: JobType; source: JobSource; displayName: string; instanceId: number | null; arrType: LiveArrType | null; databaseId: number | null }`.
  - Export one interface per variant, named exactly as the OpenAPI schemas:
    `LiveHelloEvent`, `LiveResyncEvent`, `LiveJobQueuedEvent`, `LiveJobRunningEvent`,
    `LiveJobFinishedEvent`, `LiveSyncRecordedEvent`, `LiveCanaryUpdatedEvent`,
    `LiveDriftUpdatedEvent`, `LiveSessionExpiredEvent`. Field sets:
    - `hello {bootId, headId, serverTime, heartbeatMs}`. `headId` is the server's latest event id
      when the stream opens, or `''` when no event has been published yet.
    - `resync {reason: 'boot'|'gap'}`
    - `job.queued {runAt}`
    - `job.running {startedAt}`
    - `job.finished {status: JobStatus; runStatus: JobRunStatus; rescheduled: boolean; nextRunAt: string|null; runId: number; failureCode: JobFailureCode|null; durationMs: number; finishedAt: string}`
    - `sync.recorded {syncHistoryId, jobId: number|null, instanceId, arrType: LiveArrType, status: SyncOperationStatus, trigger: SyncTrigger, finishedAt}`
    - `canary.updated {rolloutId, arrType, status: CanaryRolloutStatus, canaryStatus: CanaryOutcomeStatus|null, completedCount, remainingCount}`
    - `drift.updated {instanceId, arrType, status: DriftStatus, driftedCount, missingCount, unmanagedCount, checkedAt}`
    - `session.expired {}`
  - Export the union `LiveEvent`, the alias
    `LiveEventOf<T extends LiveEventType> = Extract<LiveEvent, { type: T }>`, and the buffered subset
    `type LiveDomainEvent = Exclude<LiveEvent, LiveHelloEvent | LiveResyncEvent | LiveSessionExpiredEvent>`.
  - Export the constants:

    ```ts
    LIVE_HEARTBEAT_MS = 20_000;
    LIVE_MAX_STREAM_MS = 60 * 60_000;
    LIVE_RETRY_MS = 5_000;
    LIVE_REPLAY_BUFFER = 256;
    LIVE_MAX_STREAMS_PER_PRINCIPAL = 8;
    LIVE_MAX_STREAMS_GLOBAL = 100;
    LIVE_STREAM_QUEUE_HWM = 64;
    LIVE_RETRY_AFTER_SECONDS = 30;
    LIVE_EVENTS_PATH = '/api/v1/events';
    ```

  - Export `LIVE_DEPENDENCY_KEYS = { jobs: 'praxrr:jobs', sync: 'praxrr:sync', syncHistory: 'praxrr:sync-history', canary: 'praxrr:canary', drift: 'praxrr:drift' } as const`.
  - Export `SYNC_FAMILY_JOB_TYPES: readonly JobType[] = ['arr.sync','arr.sync.qualityProfiles','arr.sync.delayProfiles','arr.sync.mediaManagement','arr.sync.metadataProfiles','pcd.sync','trashguide.sync','sync.canary.rollout']`.
- **MIRROR**: SHARED_TYPE_IMPORTS; NAMING_CONVENTION (`as const` tuple + derived type like `JOB_TYPES`
  at `lib/server/jobs/queueTypes.ts:10-31`).
- **IMPORTS**: type-only, as listed. No value imports from `$lib/server` or `$app`.
- **GOTCHA**:
  - Status values reuse `JobStatus`/`JobRunStatus`. Never add `succeeded` (decision 3).
  - The file must stay importable from Deno tests and from the browser. Use `import type` only.
- **VALIDATE**: `deno check packages/praxrr-app/src/lib/shared/events/types.ts` passes. Task 2.6
  checks it against OpenAPI.

### Task 1.2: OpenAPI contract for `/events` and regenerated types — Depends on [none]

- **BATCH**: B1
- **ACTION**:
  - Create `docs/api/v1/paths/events.yaml` and `docs/api/v1/schemas/events.yaml`.
  - Update `docs/api/v1/openapi.yaml`.
  - Regenerate `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/openapi.json` and
    `packages/praxrr-api/types.ts`.
- **IMPLEMENT**:
  - `paths/events.yaml`, key `stream:`:
    - `get`:
      - `operationId: streamEvents`, `tags: [Events]`, `summary: Live event stream (SSE)`.
      - The description covers:
        - the framing: `retry: 5000`, then `data: <LiveEvent JSON>` frames; domain events carry
          `id: <bootId>-<seq>`; `: ping` comments every 20 s;
        - replay through the `Last-Event-ID` header or the `lastEventId` query parameter;
        - `resync` when replay is impossible;
        - `session.expired` followed by a server close;
        - the 60 min maximum lifetime;
        - that the `X-Api-Key` header is preferred over `?apikey=`.
      - Parameters (copy the style of `paths/system.yaml:81-89`):
        - `X-Api-Key` (header, optional)
        - `Last-Event-ID` (header, optional, string)
        - `lastEventId` (query, optional, string)
      - Responses:
        - `200`: `content: text/event-stream: schema: {type: string}`. The description references
          `#/components/schemas/LiveEvent`.
        - `401` → `../schemas/arr.yaml#/ErrorResponse`
        - `403` → `../schemas/common.yaml#/ScopeForbiddenResponse`
        - `429` and `503` → `ErrorResponse`, with `headers: Retry-After: {schema: {type: integer}}`
    - `head`:
      - `operationId: probeEvents`, same tags.
      - Responses: `204` (stream would be accepted), `401`, `403`, `429` and `503`, all without
        bodies.
  - `schemas/events.yaml`:
    - `LiveEvent`: `oneOf` the nine variant `$ref`s, with
      `discriminator: { propertyName: type, mapping: {hello: '#/LiveHelloEvent', …} }`. Copy the
      style of `schemas/canary.yaml:257-270`.
    - Each variant is `type: object` with `required` listing **all** properties, and
      `additionalProperties: false`.
    - `type` is `type: string` + `const: <name>`. Copy `const` usage from `schemas/canary.yaml:214`.
    - Nullable fields use `oneOf: [{type: integer}, {type: 'null'}]`, as in
      `schemas/sync-history.yaml:117-120`.
    - Add `LiveJobType` (an enum of every `JOB_TYPES` value, same order), `LiveJobStatus`
      (`queued|running|success|failed|cancelled`), `LiveJobRunStatus`
      (`success|failure|skipped|cancelled`), `LiveJobSource` (`schedule|manual|system`),
      `LiveJobFailureCode` (the 13 codes in `lib/shared/jobs/evidence.ts:25-38`) and
      `LiveArrType` (`radarr|sonarr|lidarr`).
    - Reuse the existing schemas with `$ref: './sync-history.yaml#/SyncOperationStatus'`,
      `'./sync-history.yaml#/SyncTrigger'`, `'./canary.yaml#/CanaryRolloutStatus'`,
      `'./canary.yaml#/CanaryOutcomeStatus'` and `'./drift.yaml#/DriftStatus'`.
  - `openapi.yaml`:
    - Add `- name: Events` (description: "Live job, sync, canary and drift progress over
      Server-Sent Events") after the `Canary` tag (line 49).
    - Add `/events: $ref: './paths/events.yaml#/stream'` after `/metrics` (line 73).
    - Under `components.schemas`, add a `# Live events` group with one
      `Name: $ref: './schemas/events.yaml#/Name'` entry for **every** top-level key in
      `schemas/events.yaml`.
  - Then run `deno task bundle:api` and `deno task generate:api-types`.
- **MIRROR**: `docs/api/v1/paths/system.yaml:67-110` (non-JSON 200, `X-Api-Key` param, 401/403 refs);
  `docs/api/v1/schemas/canary.yaml:257-270` (discriminator).
- **IMPORTS**: n/a.
- **GOTCHA**:
  - `scripts/bundle-api.ts:88-115` imports every top-level key of each schema file that is
    referenced from `components.schemas`. Register every new schema, or `$ref`s will dangle in
    `packages/praxrr-api/openapi.json`.
  - Do not hand-edit the three generated files.
  - The exact task names are `bundle:api` and `generate:api-types` (`deno.json:72,98`).
- **VALIDATE**:
  - `deno task bundle:api && deno task generate:api-types` exits 0.
  - `grep -n "LiveJobFinishedEvent" packages/praxrr-app/src/lib/api/v1.d.ts packages/praxrr-api/types.ts`
    finds both files.

### Task 1.3: Query additions `listActive` and `isActiveById` — Depends on [none]

- **BATCH**: B1
- **ACTION**: Update `lib/server/db/queries/jobQueue.ts` and `lib/server/db/queries/apiTokens.ts`.
- **IMPLEMENT**:
  - `jobQueueQueries.listActive(limit: number = 50): JobQueueRecord[]`, inserted after `listQueued`
    (line 141):

    ```sql
    SELECT * FROM job_queue
    WHERE status = 'running'
       OR (status = 'queued' AND (source != 'schedule'
           OR datetime(replace(replace(run_at, 'T', ' '), 'Z', '')) <= datetime('now')))
    ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, run_at ASC
    LIMIT ?
    ```

    Map the rows with `rowToRecord`.

  - `apiTokensQueries.isActiveById(id: number): boolean`:
    `db.queryFirst<{ id: number }>(\`SELECT id FROM api_tokens WHERE id = ? AND ${ACTIVE_PREDICATE}\`, id) !== undefined`.
Place it after `findActiveByHash` (line 108).
- **MIRROR**: REPOSITORY_PATTERN.
- **IMPORTS**: none new.
- **GOTCHA**:
  - Future-dated recurring schedule rows must stay out of "Active". They are already shown in the
    scheduled table.
  - Reuse `ACTIVE_PREDICATE` (`apiTokens.ts:35`). Do not duplicate the predicate.
- **VALIDATE**: `deno task check:server`. These queries are exercised by tasks 2.4 and 3.4 and by
  stream test T-S6.

### Task 1.4: Alert action link, accessible markup and persistent live region — Depends on [none]

- **BATCH**: B1
- **ACTION**:
  - Update `lib/client/alerts/store.ts`, `Alert.svelte`, `AlertContainer.svelte`,
    `MobileNavAlert.svelte` and `lib/client/ui/navigation/navbar/navbar.svelte`.
  - Create `lib/client/alerts/AlertLiveRegion.svelte`.
- **IMPLEMENT**:
  - `store.ts`:
    - Export `interface AlertAction { label: string; href: string }`.
    - Add `action?: AlertAction` to `Alert`.
    - The new signature is `add(type, message, duration?, action?)`, positional and backward
      compatible. Store `action` on the alert object.
  - `Alert.svelte`:
    - Add `export let action: AlertAction | undefined = undefined`.
    - Migrate every `on:click` / `on:keydown` to `onclick` / `onkeydown`. Svelte 5 cannot mix the
      two syntaxes in one component.
    - Without `action`, keep today's markup and classes (`role="button"`, click to dismiss).
    - With `action`, render a plain `<div>` containing the icon and `<p>{message}</p>`, plus:
      - `<a href={action.href} onclick={dismiss} class="text-sm font-semibold underline underline-offset-2">{action.label}</a>`
      - `<button type="button" aria-label="Dismiss notification" onclick={dismiss}>` showing the
        `X` icon from `lucide-svelte`
    - Add `aria-hidden="true"` to the outer element in **both** branches. Announcements come from
      `AlertLiveRegion`, so screen readers must not hear each toast twice.
  - `AlertContainer.svelte:29`: pass `action={alert.action}`.
  - `MobileNavAlert.svelte`:
    - Add the same `action` prop and migrate to `onclick` / `onkeydown`.
    - With `action`, the whole pill is `<a href={action.href} onclick={dismiss}>` with the same
      classes, and the message text is followed by ` · {action.label}`.
    - Add `aria-hidden="true"` as in `Alert.svelte`.
  - `navbar.svelte:34`: pass `action={latestAlert.action}`.
  - `AlertLiveRegion.svelte`:
    - Subscribe to `alertStore`. Track the ids already seen in a non-reactive `Set`.
    - For each new alert, write `message` (plus `. ${action.label} available.` when an action is
      present) into one of two strings:
      - `politeText` for `success`, `info` and `warning`
      - `assertiveText` for `error`
    - Clear the text, then set it on the next tick, so repeated messages are re-announced.
    - Render
      `<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{politeText}</div>`
      and `<div class="sr-only" role="alert" aria-atomic="true">{assertiveText}</div>`.
- **MIRROR**: CLIENT_STORE_PATTERN; the `sr-only` live region at
  `routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte:211`; `onclick` usage at
  `lib/client/ui/card/CollapsibleCard.svelte:54`.
- **IMPORTS**: `X` from `lucide-svelte`; `type AlertAction` from `./store`.
- **GOTCHA**:
  - Never render the message or label with `{@html}`. ESLint enforces `svelte/no-at-html-tags`.
  - The live region must live **outside** `AlertContainer`, which is `hidden md:block`. Task 4.1
    mounts it in the root layout.
  - All ten existing three-argument `add()` callers must compile unchanged.
- **VALIDATE**: `deno task check:client` shows no new errors. Manually, `alertStore.add('success','x',0,{label:'View',href:'/settings/jobs'})`
  shows a link and an `×`; Tab focuses the link, then the button.

### Task 1.5: Explicit scope-policy entry for the events route — Depends on [none]

- **BATCH**: B1
- **ACTION**: Update `lib/server/utils/auth/scopePolicy.ts` and
  `tests/server/utils/auth/apiTokens.test.ts`.
- **IMPLEMENT**:
  - Add `const EVENTS_ROUTE = /^\/api\/v1\/events\/?$/;` after `MCP_ROUTE` (line 20), with a doc
    comment: "Long-lived SSE stream (YAN-593): read-only hints; any token holding `read` may
    subscribe."
  - In `requiredScopeFor`, after the MCP check, add
    `if (EVENTS_ROUTE.test(pathname) && SAFE_METHODS.includes(verb)) return 'read';`. Compute
    `verb` before this line by moving `const verb` up.
  - Add the test rows `['GET','/api/v1/events','read']`, `['HEAD','/api/v1/events','read']`,
    `['POST','/api/v1/events','admin']` and `['GET','/api/v1/eventsx','read']`. The last one shows
    the default safe-method rule still applies to a non-matching sibling.
- **MIRROR**: TEST_STRUCTURE (table rows at `apiTokens.test.ts:237-266`).
- **IMPORTS**: none.
- **GOTCHA**: Do not change the fail-closed default. POST stays `admin`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts`.

### Task 1.6: "Queued" toasts become `info` — Depends on [none]

- **BATCH**: B1
- **ACTION**: Update the eight "queued" toasts:
  - `routes/arr/[id]/sync/components/DelayProfiles.svelte:112`
  - `routes/arr/[id]/sync/components/QualityProfiles.svelte:470`
  - `routes/arr/[id]/sync/components/MediaManagement.svelte:424`
  - `routes/databases/[id]/changes/+page.svelte:538`
  - `routes/databases/trash/[id]/+page.svelte:59`
  - `routes/arr/[id]/rename/+page.svelte:54`
  - `routes/arr/[id]/upgrades/+page.svelte:61`
  - `routes/settings/backups/+page.svelte:160,177`
- **IMPLEMENT**:
  - Change each `alertStore.add('success', …queued…)` to `alertStore.add('info', …)` and keep the
    text identical. "Queued" is not success (decision 5).
  - Leave non-queue success toasts ("… sync config saved", "Sync requested") unchanged.
  - The metadata-profiles toast in `routes/arr/[id]/sync/+page.svelte:363` is changed in task 4.3,
    which owns that file.
- **MIRROR**: CLIENT_STORE_PATTERN (`alertStore.add(type, message)`).
- **IMPORTS**: none.
- **GOTCHA**: `tests/base/trashGuideSyncUxFlows.test.ts:640-650` string-matches
  `databases/trash/[id]/+page.svelte`. Change only the `'success'` literal on line 59.
- **VALIDATE**: `grep -rn "add('success', .*queued" packages/praxrr-app/src/routes` returns only
  `arr/[id]/sync/+page.svelte:363`, which task 4.3 handles.

### Batch 2 — Server core, client pure helpers, page loads

### Task 2.1: Event bus with replay ring, plus allow-list publish builders — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: Create `lib/server/events/bus.ts`, `lib/server/events/publish.ts` and
  `tests/events/bus.test.ts`.
- **IMPLEMENT**:
  - `bus.ts`:
    - `export interface LiveEventEnvelope { id: string; seq: number; event: LiveDomainEvent }`.
    - `export type ReplayResult = { kind: 'replay'; events: LiveEventEnvelope[] } | { kind: 'resync'; reason: 'boot' | 'gap' }`.
    - `export class EventBus`:
      - Constructor: `(capacity = LIVE_REPLAY_BUFFER, bootId = randomBootId())`, where
        `randomBootId` returns 8 lowercase base36 characters from
        `crypto.getRandomValues(new Uint8Array(8))`.
      - Fields: `readonly bootId`, `private seq = 0`, `private buffer: LiveEventEnvelope[] = []`,
        `private listeners = new Set<(e: LiveEventEnvelope) => void>()`.
      - `publish(event)`:
        1. Inside `try`, increment `seq` and build `{ id: \`${bootId}-${seq}\`, seq, event }`.
        2. Push it, then `shift()` while `buffer.length > capacity`.
        3. For each listener, call it inside its own `try/catch`. On error,
           `void logger.warn('Live event listener failed', { source: 'LiveEvents', meta: { type: event.type } })`.
        4. The outer `catch` logs at error. `publish` never throws and never awaits.
      - `subscribe(fn): () => void`: add the listener and return an idempotent unsubscribe.
      - `subscriberCount(): number`.
      - `headId(): string`: the id of the latest envelope, or `''`.
      - `replaySince(lastEventId: string | null): ReplayResult`:
        - `null` or empty → `{ kind: 'replay', events: [] }`. This is a fresh connection with no
          gap.
        - Parse it with `parseEventId` from task 2.2's `sse.ts`. **Do not** import that file here,
          or 2.1 would depend on 2.2. Inline a 4-line parser: `lastIndexOf('-')`, then prefix and
          integer suffix.
        - Unparseable, or the prefix is not `bootId` → `resync 'boot'`.
        - `seq > this.seq` → `resync 'boot'`.
        - `seq === this.seq` → empty replay.
        - Oldest buffered `seq > seq + 1` → `resync 'gap'`.
        - Otherwise → the envelopes with `seq > n`, in order.
    - Export the singleton through a `globalThis` registry:

      ```ts
      const KEY = Symbol.for('praxrr.events.bus');
      type G = typeof globalThis & { [KEY]?: EventBus };
      export const eventBus: EventBus = ((globalThis as G)[KEY] ??=
        new EventBus());
      ```

  - `publish.ts`. Every export is `void` and wraps its body in `try/catch` that logs through
    `$logger` (source `'LiveEvents'`). Each builder constructs the event object **field by
    field**, never by spreading a record.
    - `jobBase(job: JobQueueRecord): LiveJobEventBase`:
      - `instanceId = readNumericId(job.payload.instanceId)`, mirroring `readId` in
        `lib/server/jobs/display.ts:60-66`.
      - `arrType = instanceId !== null ? narrowArr(arrInstancesQueries.getById(instanceId)?.type) : null`,
        where `narrowArr(t) = t && isSyncPreviewArrType(t) ? t : null`.
      - `databaseId = readNumericId(job.payload.databaseId)`.
      - `displayName = buildJobDisplayName(job.jobType, job.payload)`.
    - `publishJobQueued(job, { onlyIfDue }: { onlyIfDue: boolean })`:
      - Return early when `onlyIfDue && job.source === 'schedule' && Date.parse(job.runAt) > Date.now()`.
        This stops recurring schedule upserts from flooding the stream.
      - Return early when `job.status !== 'queued'`.
    - `publishJobRunning(job)`: `startedAt: job.startedAt ?? new Date().toISOString()`.
    - `publishJobFinished(job, outcome)` with
      `outcome: { status: JobStatus; runStatus: JobRunStatus; rescheduled: boolean; nextRunAt: string | null; runId: number; failureCode: JobFailureCode | null; durationMs: number; finishedAt: string }`.
    - `publishSyncRecorded(syncHistoryId: number, input: SyncHistoryInput)` copies only `jobId`,
      `arrInstanceId → instanceId`, `arrType`, `status`, `trigger`, and
      `finishedAt ?? new Date().toISOString()`.
    - `publishCanaryUpdated(rolloutId: number)`:
      1. `const r = canaryRolloutQueries.getById(rolloutId)`. Return if it is missing.
      2. Project only `rolloutId`, `arrType`, `status` and `canaryStatus`.
      3. `completedCount = r.rolloutResults.length`.
      4. `remainingCount = Math.max(0, r.remainingTargets.length - r.rolloutResults.length)`.
      - **Never** read or emit `stateToken`, `canaryError` or `canaryOutput`.
    - `publishDriftUpdated(input: UpsertDriftStatusInput)`: narrow `arrType` (return if it is not
      a sync arr type), then copy only `instanceId` (from `arrInstanceId`), `status`, the three
      counts and `checkedAt`. **Never** emit `reason` text or `changes`.
  - `tests/events/bus.test.ts` (pure, with a fresh `new EventBus(4, 'boottest')` per test):
    - T-B1: two listeners; the first throws; the second still receives the event; `publish` does
      not throw.
    - T-B2: unsubscribing twice is safe; `subscriberCount()` returns 0.
    - T-B3: ids are `boottest-1..n`, and the ring keeps only the last 4.
    - T-B4: `replaySince` cases:
      - `null` → empty
      - `'boottest-2'` after 3 events → `[3]`
      - `'other-1'` → resync `'boot'`
      - `'boottest-1'` after 6 events with capacity 4 → resync `'gap'`
      - `'boottest-99'` → resync `'boot'`
      - `'garbage'` → resync `'boot'`
    - T-B5: the `eventBus` singleton equals `globalThis[Symbol.for('praxrr.events.bus')]`.
    - T-B6 (allow-list): build a `job.finished` and a `canary.updated` event through a fake record
      whose fields include `error`, `stateToken` and `payload` values. Assert that
      `JSON.stringify(event)` contains none of the keys `error`, `payload`, `stateToken`,
      `nextToken`, `canaryError`, `url` or `apiKey`. To capture the event, subscribe to `eventBus`
      and use a `migratedTest`-style DB for `publishCanaryUpdated`, or assert on `jobBase` output
      by exporting it as `_jobBase` for tests.
- **MIRROR**: NAMING_CONVENTION, ERROR_HANDLING, LOGGING_PATTERN, TEST_STRUCTURE.
- **IMPORTS**:
  - `bus.ts`: `$logger/logger.ts`, and types plus `LIVE_REPLAY_BUFFER` from `$shared/events/types.ts`.
  - `publish.ts`:
    - `eventBus` from `./bus.ts`
    - `arrInstancesQueries` (`$db/queries/arrInstances.ts`)
    - `canaryRolloutQueries` (`$db/queries/canaryRollouts.ts`)
    - `buildJobDisplayName` (`$jobs/display.ts`)
    - `isSyncPreviewArrType` (`$sync/preview/types.ts`)
    - `type UpsertDriftStatusInput` (`$db/queries/driftStatus.ts`)
    - `type SyncHistoryInput` (`$sync/syncHistory/types.ts`)
    - job types from `$jobs/queueTypes.ts`
- **GOTCHA**:
  - Never infer `arrType` from `jobType` (cross-Arr policy). Use `null` when unknown.
  - `publish.ts` must not import `dispatcher.ts`, `queueService.ts`, `record.ts`,
    `coordinator.ts` or `persist.ts`. Those modules import it, and a back-import would create a
    cycle.
  - `jobs/display.ts` imports the DB query modules only, so importing it is safe.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/events/bus.test.ts`.

### Task 2.2: SSE encoder and connection-cap registry — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: Create `lib/server/events/sse.ts` and `lib/server/events/connections.ts`.
- **IMPLEMENT**:
  - `sse.ts`, pure, with a module-level `const encoder = new TextEncoder()`:
    - `encodeRetry(ms) → encoder.encode(\`retry: ${ms}\n\n\`)`
    - `encodeComment(text = 'ping') → \`: ${text}\n\n\``
    - `encodeEvent(event: LiveEvent, id?: string)` returns
      `${id ? \`id: ${id}\n\` : ''}data: ${JSON.stringify(event)}\n\n`. It throws `TypeError`if`id`contains`\n`, `\r`or`\0`. `JSON.stringify` escapes newlines in values, which
      prevents frame injection.
    - `parseEventId(raw: string | null): { bootId: string; seq: number } | null`: the trimmed
      value must match `^([a-z0-9]{1,16})-(\d{1,15})$`; otherwise return `null`.
    - `resolveLastEventId(request: Request, url: URL): string | null` returns the `Last-Event-ID`
      header, else `url.searchParams.get('lastEventId')`, else `null`. Values longer than 64
      characters are ignored.
  - `connections.ts`:
    - `export type AcquireResult = { ok: true; release: () => void } | { ok: false; status: 429 | 503 }`.
    - `class EventConnectionRegistry`:
      - Constructor: `(perPrincipal = LIVE_MAX_STREAMS_PER_PRINCIPAL, global = LIVE_MAX_STREAMS_GLOBAL)`.
      - Fields: `private byKey = new Map<string, number>()`, `private total = 0`.
      - `acquire(key)`:
        1. If `total >= global`, return `{ ok: false, status: 503 }`.
        2. If `(byKey.get(key) ?? 0) >= perPrincipal`, return `{ ok: false, status: 429 }`.
        3. Otherwise increment both and return an idempotent `release` that decrements them and
           deletes the key at 0.
      - `check(key)`: the same tests without incrementing. It returns
        `{ ok: true } | { ok: false; status }` and is used by HEAD.
      - `count(key?)`.
    - Export the singleton `eventConnections`, stored on
      `globalThis[Symbol.for('praxrr.events.connections')]`, using the same pattern as `bus.ts`.
- **MIRROR**: NAMING_CONVENTION (class + exported singleton, `globalThis` per decision 8).
- **IMPORTS**: constants and `type LiveEvent` from `$shared/events/types.ts`.
- **GOTCHA**:
  - Decision 7: over the per-principal cap the server **rejects with 429**. It does not evict.
  - `release` must be idempotent, because `close()` may run from several exit paths.
- **VALIDATE**: covered by `tests/events/stream.test.ts` (task 3.4) and `bus.test.ts`. Also run
  `deno check packages/praxrr-app/src/lib/server/events/sse.ts packages/praxrr-app/src/lib/server/events/connections.ts`.

### Task 2.3: Client pure helpers (backoff, parse, failure classifier, toast policy) — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: Create `lib/client/events/reconnect.ts`, `lib/client/events/toastPolicy.ts` and
  `tests/events/clientHelpers.test.ts`.
- **IMPLEMENT**:
  - `reconnect.ts`. It must not import `$app/*` or `svelte`.
    - `nextBackoffMs(attempt: number, random: () => number = Math.random): number`:
      - `base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt))`
      - `jitter = base * 0.2 * (random() * 2 - 1)`
      - return `Math.max(1_000, Math.round(base + jitter))`. This is decision 7: 1 s → 30 s with
        ±20 % jitter.
    - `retryAfterMs(header: string | null): number | null`: parse integer seconds and cap the
      result at 300 000 ms. Anything else returns `null`.
    - `classifyProbeStatus(status: number): 'ok' | 'stop' | 'backoff'`:
      - 401 and 403 → `'stop'` (decision 6)
      - 429, 503 and every other non-2xx → `'backoff'`
      - 2xx → `'ok'`
    - `parseLiveEvent(raw: string): LiveEvent | null`:
      - Run `JSON.parse` in a try block. Require a plain object with a string `type` contained in
        `LIVE_EVENT_TYPES`; otherwise return `null`. Unknown types are ignored, which keeps the
        client forward compatible.
      - For `job.*`, also require numeric `jobId` and string `jobType`/`source`/`displayName`.
      - For `sync.recorded`, require a numeric `syncHistoryId`.
      - Return the value cast as `LiveEvent`.
  - `toastPolicy.ts`, pure:
    - `export type ToastDecision = { kind: 'none' } | { kind: 'toast'; type: 'success' | 'warning' | 'error' | 'info'; message: string; sticky: boolean; href: string }`.
    - `export function decideJobToast(e: LiveJobFinishedEvent, ctx: { syncHistoryId: number | null; syncStatus: SyncOperationStatus | null; base: string }): ToastDecision`:
      - `e.rescheduled` → `none`.
      - Set `href = ctx.syncHistoryId !== null ? \`${ctx.base}/sync-history/${ctx.syncHistoryId}\` : \`${ctx.base}/settings/jobs\``.
      - If `e.source === 'manual'`:
        - `runStatus 'success'` with `ctx.syncStatus === 'partial'` →
          `warning`, "`${displayName}` partially succeeded", not sticky
        - `'success'` → `success`, "`${displayName}` finished"
        - `'failure'` → `error`, "`${displayName}` failed", sticky
        - `'skipped'` → `info`, "`${displayName}` skipped"
        - `'cancelled'` → `info`, "`${displayName}` cancelled"
      - Otherwise, only `runStatus === 'failure'` with `SYNC_FAMILY_JOB_TYPES.includes(e.jobType)`
        → a sticky `error`. Everything else → `none`.
    - `export class ToastCoalescer`:
      - Constructor: `(windowMs = 60_000, now = () => Date.now())`.
      - `allow(e)`: for non-manual failures, key on `${jobType}:${instanceId ?? 'none'}`. Return
        `false` if the key was seen within `windowMs`. Otherwise record it and return `true`.
        Manual events always return `true`.
      - Cap the map at 200 keys and drop the oldest.
    - `export class SeenSet`:
      - `constructor(max = 500)`.
      - `addOnce(key: string): boolean` is false when the key was already present.
      - FIFO eviction. Used for dedupe by `${jobId}:${runId}`.
  - `tests/events/clientHelpers.test.ts`:
    - T-C1: backoff with `random = () => 0.5` gives 1000, 2000, 4000, … capped at 30 000. With
      `random = () => 0` the value is ≥ 1000; with `() => 1` it is ≤ 36 000.
    - T-C2: `parseLiveEvent` returns `null` for invalid JSON, arrays, a missing `type`, an unknown
      type (`'job.exploded'`) and a `job.finished` without `jobId`. It returns the event for a
      valid `hello`.
    - T-C3: `classifyProbeStatus` for 204, 401, 403, 429 and 503.
    - T-C4: `decideJobToast` covers every manual `runStatus`, the partial case (warning), a
      rescheduled event (none), a schedule-source success (none), a schedule-source sync-family
      failure (sticky error), a schedule `backup.create` failure (none), and the `href` fallback.
    - T-C5: `ToastCoalescer` blocks a second identical background failure inside the window and
      allows it after `now` advances 61 s.
    - T-C6: `SeenSet.addOnce` dedupes.
- **MIRROR**: TEST_STRUCTURE (plain `Deno.test` + `@std/assert`).
- **IMPORTS**: types and constants from `$shared/events/types.ts`; `type SyncOperationStatus` from
  `$sync/syncHistory/types.ts`.
- **GOTCHA**:
  - Deno tests cannot resolve `$app/*`. This is why `base` is passed in through `ctx`.
  - Toast copy uses only the server-built `displayName` and fixed words. Never interpolate
    `failureCode` text from the server.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/events/clientHelpers.test.ts`.

### Task 2.4: Page server loads for jobs, sync-history and canary — Depends on [1.1, 1.3]

- **BATCH**: B2
- **ACTION**: Update `routes/settings/jobs/+page.server.ts`, `routes/sync-history/+page.server.ts`,
  `routes/canary/+page.server.ts` and `routes/canary/[id]/+page.server.ts`.
- **IMPLEMENT**:
  - Jobs:
    - Change the load to `export const load = ({ depends }: { depends: (...deps: string[]) => void }) => {`,
      or use `ServerLoad` from `@sveltejs/kit` with `({ depends })`.
    - Call `depends(LIVE_DEPENDENCY_KEYS.jobs)`.
    - Add
      `const activeJobs = jobQueueQueries.listActive(50).map((job) => ({ id: job.id, jobType: job.jobType, displayName: buildJobDisplayName(job.jobType, job.payload, lookups), status: job.status, source: job.source, runAt: job.runAt, startedAt: job.startedAt, attempts: job.attempts }))`.
    - Return `{ jobs, jobRuns, activeJobs }`.
  - Sync history: the load becomes `({ url, depends })` and calls
    `depends(LIVE_DEPENDENCY_KEYS.syncHistory)` first.
  - Canary list: `({ depends })` → `depends(LIVE_DEPENDENCY_KEYS.canary)`.
  - Canary detail: `({ params, depends })` → `depends(LIVE_DEPENDENCY_KEYS.canary)`.
- **MIRROR**: SERVICE_PATTERN (keep the loads thin). Use `ServerLoad` as already used at
  `routes/canary/+page.server.ts:32`.
- **IMPORTS**: `LIVE_DEPENDENCY_KEYS` from `$shared/events/types.ts`.
- **GOTCHA**:
  - Use one `praxrr:canary` key for both canary pages. Invalidating it re-runs only the loads that
    depend on it.
  - Do not return `payload`. Only the projected fields go to the client.
  - The detail load must keep returning `rollout.stateToken`, because the page's proceed/abort
    needs it. It is never sent over SSE.
- **VALIDATE**: `deno task check:client`. Run `deno task test sync-history` and
  `deno task test canary` (no regressions).

### Task 2.5: Arr sync load section status and actions return `jobId` — Depends on [1.1, 1.6]

- **BATCH**: B2
- **ACTION**: Update `routes/arr/[id]/sync/+page.server.ts`.
- **IMPLEMENT**:
  - `load` (line 247) becomes `async ({ params, url, depends })`. Call
    `depends(LIVE_DEPENDENCY_KEYS.sync)` first.
  - Add `sectionStatus` to the return value at line 395:

    ```ts
    const configStatus = arrSyncQueries.getSyncConfigStatus(id);
    sectionStatus: {
      qualityProfiles: configStatus.qualityProfiles.syncStatus,
      delayProfiles: configStatus.delayProfiles.syncStatus,
      mediaManagement: configStatus.mediaManagement.syncStatus,
      metadataProfiles: configStatus.metadataProfiles.syncStatus,
    }
    ```

    The value type is `string`: one of `idle`, `pending`, `in_progress` or `failed`.

  - The four section actions return `{ success: true, message: '… sync queued', jobId: queued.id }`
    (lines 794, 835, 876 and 922).
- **MIRROR**: REPOSITORY_PATTERN (`getSyncConfigStatus` at `lib/server/db/queries/arrSync.ts:1561-1600`).
- **IMPORTS**: `LIVE_DEPENDENCY_KEYS` from `$shared/events/types.ts`. `arrSyncQueries` is already
  imported.
- **GOTCHA**:
  - The metadata-profiles query joins `ai.type = 'lidarr'`. Non-Lidarr instances get `idle`,
    which is correct per Arr.
  - Do not modify the TRaSH action (lines 715-756). It already returns a `runToken` and `view`.
- **VALIDATE**: `deno task check:client`. Load the page in dev; `data.sectionStatus` appears in the
  devtools page data.

### Task 2.6: Contract test — shared union ⟷ OpenAPI — Depends on [1.1, 1.2]

- **BATCH**: B2
- **ACTION**: Create `tests/events/contract.test.ts`.
- **IMPLEMENT**:
  1. Import `type { components } from '$api/v1.d.ts'`, `JOB_TYPES` from `$jobs/queueTypes.ts`, and
     `LIVE_EVENT_TYPES` plus the variant types from `$shared/events/types.ts`.
  2. Add a compile-time mutual-assignability helper:
     `type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;` with
     `const _hello: Same<LiveHelloEvent, components['schemas']['LiveHelloEvent']> = true;`. Repeat
     for all nine variants and for `LiveEvent`.
  3. Runtime tests:
     - Parse `docs/api/v1/schemas/events.yaml` with `@std/yaml`.
     - Assert `LiveJobType.enum` deep-equals `[...JOB_TYPES]`.
     - Assert the `LiveEvent.discriminator.mapping` keys deep-equal `[...LIVE_EVENT_TYPES]`.
     - Assert `docs/api/v1/openapi.yaml` contains a `/events` path.
- **MIRROR**: `tests/base/bundleApiContract.test.ts:1-60` (imports `$api/v1.d.ts`, `@std/yaml`,
  type-level assertions).
- **IMPORTS**: `@std/assert`, `@std/yaml`.
- **GOTCHA**:
  - `openapi-typescript` renders `oneOf [integer, null]` as `number | null`, and `const` as a
    literal. If a `Same` check fails, fix the YAML (task 1.2's file) rather than loosening the
    shared type.
  - Read the YAML with `new URL('../../../../../docs/api/v1/schemas/events.yaml', import.meta.url)`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/events/contract.test.ts`.

### Batch 3 — Publishers, stream endpoint, client store

### Task 3.1: Dispatcher publishes `job.running` / `job.finished` — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Update `lib/server/jobs/dispatcher.ts`.
- **IMPLEMENT**:
  - `runDueJobs` (line 60-62): after `const job = jobQueueQueries.claimNextDue(); if (!job) break;`,
    call `publishJobRunning(job);` before `await this.executeJob(job);`. `claimNextDue` has already
    persisted `running` (`lib/server/db/queries/jobQueue.ts:194-207`).
  - Handler-not-found branch (lines 79-89):
    1. Capture `const finishedAt = new Date().toISOString();` and `const runId = jobRunHistoryQueries.create(…, finishedAt, …)`.
       The function already returns the id (`lib/server/db/queries/jobRunHistory.ts:42-71`).
    2. After it, call
       `publishJobFinished(job, { status: 'failed', runStatus: 'failure', rescheduled: false, nextRunAt: null, runId, failureCode: 'handlerNotFound', durationMs: 0, finishedAt })`.
  - Main path:
    1. `const runId = jobRunHistoryQueries.create(...)` (line 123).
    2. Reschedule branch (line 138-141): after `jobQueueQueries.reschedule(...)`, call
       `publishJobFinished(job, { status: 'queued', runStatus: result.status, rescheduled: true, nextRunAt: result.rescheduleAt, runId, failureCode: evidence.failure?.code ?? null, durationMs, finishedAt })`.
    3. Terminal path: after `jobQueueQueries.markFinished(job.id, status)` (line 152), call
       `publishJobFinished(job, { status, runStatus: result.status, rescheduled: false, nextRunAt: null, runId, failureCode: evidence.failure?.code ?? null, durationMs, finishedAt })`.
- **MIRROR**: ERROR_HANDLING (redaction by construction, `dispatcher.ts:110-116`). Publish **after**
  the DB write, per the practices research's "call publish right after each DB state change".
- **IMPORTS**: `import { publishJobFinished, publishJobRunning } from '$lib/server/events/publish.ts';`.
- **GOTCHA**:
  - Only `evidence.failure?.code` may leave the dispatcher. Never pass `result.error`, `error`,
    `result.output`, `result.decision` or the payload.
  - Synchronous fan-out makes the order `sync.recorded` (emitted inside the handler) →
    `job.finished`. The toast correlation in task 3.5 relies on this.
  - Keep `executeJob` free of `await publish…`. The publish functions are synchronous and return
    `void`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/jobs/dispatcherEvents.test.ts`
  (task 4.6) and `deno task test jobs` (no regressions).

### Task 3.2: Enqueue paths publish `job.queued` — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Update `lib/server/jobs/queueService.ts`, `lib/server/jobs/helpers/pcdSyncQueue.ts`
  and `lib/server/jobs/helpers/trashGuideSyncQueue.ts`.
- **IMPLEMENT**:
  - `queueService.ts`:
    - `enqueueJob`: after `jobDispatcher.notifyJobEnqueued(record.runAt);`, call
      `publishJobQueued(record, { onlyIfDue: false });`.
    - `upsertScheduledJob`: after the notify call, call
      `publishJobQueued(record, { onlyIfDue: true });`. This covers the on-change syncs at
      `lib/server/sync/processor.ts:419-452` (`source: 'system'`, run now) and skips future
      `schedule` rows.
  - `pcdSyncQueue.ts:71`: after `jobDispatcher.notifyJobEnqueued(job.runAt);`, call
    `publishJobQueued(job, { onlyIfDue: false });`. Here `job` is the `JobQueueRecord` returned by
    `upsertScheduled`.
  - `trashGuideSyncQueue.ts:172-174`: inside the `if (result.status === 'queued' && result.view.current)`
    block of `enqueueManualTrashGuideSourceSync`:
    1. `const record = result.view.queueId !== null ? jobQueueQueries.getById(result.view.queueId) : undefined;`
    2. `if (record) publishJobQueued(record, { onlyIfDue: false });`
- **MIRROR**: ERROR_HANDLING (fire and forget after persistence).
- **IMPORTS**: `import { publishJobQueued } from '$lib/server/events/publish.ts';`.
  `jobQueueQueries` is already imported in both helpers.
- **GOTCHA**:
  - **Do not** publish from `lib/server/jobs/schedule.ts`. `scheduleAllJobs()` at boot would
    flood the stream.
  - Scheduler-driven TRaSH enqueues (`enqueueTrashGuideSourceSync` with `trigger: 'schedule'`)
    stay silent.
  - Tests stub `jobDispatcher.notifyJobEnqueued` (`tests/jobs/trashGuideSyncJob.test.ts:216`) and
    `jobQueueQueries.getByDedupeKey`. A stubbed `getById` returning `undefined` must not throw,
    which the `if (record)` guard handles.
- **VALIDATE**: `deno task test jobs` and
  `deno task test packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`.

### Task 3.3: Domain publishers — sync history, canary, drift — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Update `lib/server/sync/syncHistory/record.ts`,
  `lib/server/sync/canary/coordinator.ts`, `lib/server/jobs/handlers/canaryRollout.ts` and
  `lib/server/sync/drift/persist.ts`.
- **IMPLEMENT**:
  - `record.ts:197-198`: after `fireNotification(id, input);`, call
    `publishSyncRecorded(id, input);`. This is inside the existing `try`; the publisher never
    throws anyway.
  - `coordinator.ts`. Call `publishCanaryUpdated(...)` at these points:
    - After `canaryRolloutQueries.insert(...)` (line 278): `publishCanaryUpdated(rolloutId)`
      (`canary_running`).
    - After the `if (!recorded) throw …` guard (line 305): `publishCanaryUpdated(rolloutId)`
      (`awaiting_confirmation` or `aborted`).
    - In `proceedRollout`, after `enqueueJob(...)` (line 374): `publishCanaryUpdated(id)`
      (`rolling_out`).
    - In `abortRollout`, after the stale-token guard (line 396): `publishCanaryUpdated(id)`
      (`aborted`).
  - `canaryRollout.ts`:
    - After `canaryRolloutQueries.recordBatchProgress(...)` (line 92): `publishCanaryUpdated(rolloutId)`.
    - After `canaryRolloutQueries.finishRollout(...)` (line 112): `publishCanaryUpdated(rolloutId)`.
  - `persist.ts`:
    1. Bind the upsert input to `const upsertInput: UpsertDriftStatusInput = {…}`, using the same
       object literal as lines 111-125.
    2. Call `driftStatusQueries.upsert(upsertInput);` then `publishDriftUpdated(upsertInput);`.
- **MIRROR**: ERROR_HANDLING (`record.ts` never-throw contract);
  `lib/server/sync/canary/notify.ts` (best-effort side effect after the state change).
- **IMPORTS**: `import { publishSyncRecorded | publishCanaryUpdated | publishDriftUpdated } from '$lib/server/events/publish.ts';`.
  In `persist.ts`, also add `type UpsertDriftStatusInput` to the existing `$db/queries/driftStatus.ts`
  import.
- **GOTCHA**:
  - `publishCanaryUpdated` reads the row again and emits only summary fields. **Never** pass the
    `rollout` object, because it carries `stateToken`, `canaryError` and `canaryOutput`.
  - `record.ts` runs on the request thread for reviewed apply, so this path must stay synchronous.
  - Sync-history recording disabled ⇒ no `sync.recorded`. That is expected (BR-6).
  - Do not touch `lib/server/jobs/handlers/arrSync.ts`. It is already 1206 lines, and
    `record.ts` is the single choke point.
- **VALIDATE**: `deno task test sync-history`, `deno task test canary`,
  `deno task test packages/praxrr-app/src/tests/jobs/driftCheck.test.ts` and
  `deno task test packages/praxrr-app/src/tests/routes/drift.test.ts`.

### Task 3.4: SSE stream module, auth helper, route, tests and test alias — Depends on [1.3, 1.5, 2.1, 2.2]

- **BATCH**: B3
- **ACTION**:
  - Create `lib/server/events/stream.ts`, `lib/server/events/streamAuth.ts`,
    `routes/api/v1/events/+server.ts` and `tests/events/stream.test.ts`.
  - Update `scripts/test.ts`.
- **IMPLEMENT**:
  - `streamAuth.ts`. Use structural types so the module is `deno check`-able without `app.d.ts`,
    following `lib/server/mcp/context.ts:19-30`:

    ```ts
    export interface EventStreamLocals {
      session: { id: string } | null;
      principal: AuthPrincipal | null;
    }
    export function principalKey(
      locals: EventStreamLocals,
      clientIp: string
    ): string | null;
    export function buildRevalidator(locals: EventStreamLocals): () => boolean;
    ```

    - `principalKey` returns:
      - `'token:<tokenId>'` when `principal.kind === 'token'`
      - `'session:<session.id>'` when the kind is `'session'` and a session exists
      - `'bypass:<clientIp>'` when the kind is `'bypass'`
      - `null` otherwise, which means fail closed
    - `buildRevalidator` returns:
      - for a token: `() => apiTokensQueries.isActiveById(tokenId)`
      - for a session: `() => sessionsQueries.getValidById(sessionId) !== undefined`
      - for bypass: `() => true`

  - `stream.ts`:
    - Options:

      ```ts
      export interface EventStreamOptions {
        bus?: EventBus;
        signal: AbortSignal;
        lastEventId: string | null;
        revalidate: () => boolean;
        release: () => void;
        heartbeatMs?: number;
        maxLifetimeMs?: number;
        highWaterMark?: number;
        now?: () => number;
      }
      export function createEventStream(
        opts: EventStreamOptions
      ): ReadableStream<Uint8Array>;
      ```

    - Return
      `new ReadableStream<Uint8Array>({ start(controller) {…}, cancel() { close('cancel'); } }, new CountQueuingStrategy({ highWaterMark }))`.
    - In `start`:
      1. Enqueue `encodeRetry(LIVE_RETRY_MS)`.
      2. Enqueue `encodeEvent({ type: 'hello', bootId: bus.bootId, headId: bus.headId(), serverTime: new Date().toISOString(), heartbeatMs })`
         with no id.
      3. Compute `replay = bus.replaySince(lastEventId)`:
         - `resync` → enqueue `encodeEvent({ type: 'resync', reason })` with no id.
         - otherwise → enqueue each envelope as `encodeEvent(env.event, env.id)`.
      4. Subscribe with `unsubscribe = bus.subscribe((env) => send(encodeEvent(env.event, env.id)))`.
      5. Start the heartbeat:
         `heartbeat = setInterval(() => { if (!revalidate()) { send(encodeEvent({ type: 'session.expired' })); close('expired'); return; } send(encodeComment('ping')); }, heartbeatMs)`.
      6. Start the lifetime timer: `lifetime = setTimeout(() => close('lifetime'), maxLifetimeMs)`.
      7. Wire the abort signal: `signal.addEventListener('abort', onAbort, { once: true })`, where
         `onAbort = () => close('abort')`. If `signal.aborted` is already true, call `close('abort')`
         immediately.
    - `send(chunk)`:
      1. If `closed`, return.
      2. If `controller.desiredSize !== null && controller.desiredSize <= 0`, call
         `close('slow-consumer')` and return.
      3. Otherwise run `controller.enqueue(chunk)` inside `try/catch`. On a catch, call
         `close('enqueue-error')`.
    - `close(reason)` is idempotent: `if (closed) return; closed = true;`. Then it:
      1. calls `unsubscribe?.()`;
      2. calls `clearInterval(heartbeat)` and `clearTimeout(lifetime)`;
      3. calls `signal.removeEventListener('abort', onAbort)`;
      4. calls `release()`;
      5. runs `controller.close()` inside a `try`;
      6. logs `logger.debug('Live event stream closed', { source: 'LiveEventStream', meta: { reason } })`.
    - Export `closeReasonsForTest` only if the tests need it. Prefer asserting through
      `bus.subscriberCount()`.
  - `routes/api/v1/events/+server.ts`:

    ```ts
    const SSE_HEADERS = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    } as const;
    function reject(status: 401 | 429 | 503): Response  // JSON body, plus 'Retry-After': String(LIVE_RETRY_AFTER_SECONDS) for 429/503
    export const GET: RequestHandler = (event) => { … };
    export const HEAD: RequestHandler = (event) => { … };
    ```

    - `reject` uses the bodies `{ error: 'Unauthorized' }`, `{ error: 'Too many event streams' }`
      and `{ error: 'Event stream capacity reached' }`.
    - `GET`:
      1. `const key = principalKey(event.locals, getClientIp(event));`. If `!key`, return
         `reject(401)` (defense in depth).
      2. `const slot = eventConnections.acquire(key);`. If `!slot.ok`, return
         `reject(slot.status)`, and log at warn with the meta `{ status }` only.
      3. Build the stream with
         `createEventStream({ signal: event.request.signal, lastEventId: resolveLastEventId(event.request, event.url), revalidate: buildRevalidator(event.locals), release: slot.release })`.
      4. Return `new Response(stream, { headers: SSE_HEADERS })`.
    - `HEAD`: the same key check, then `eventConnections.check(key)` → return 401, 429/503, or
      `new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })`.
    - Export **only** `GET` and `HEAD`.

  - `scripts/test.ts`: add `events: 'packages/praxrr-app/src/tests/events,packages/praxrr-app/src/tests/jobs/dispatcherEvents.test.ts',`
    in the alias map, in alphabetical order with the other individual-file aliases.
  - `tests/events/stream.test.ts`. Use a fresh `new EventBus(8, 'teststrm')` and an
    `AbortController`, and read through `stream.getReader()` plus a `TextDecoder`:
    - T-S1: the first chunks are `retry: 5000\n\n` and a `hello` frame. A `bus.publish(...)`
      afterwards yields an `id: teststrm-1\ndata: {...}\n\n` frame.
    - T-S2: with `heartbeatMs: 10`, a `: ping\n\n` frame arrives.
    - T-S3: `controller.abort()` → `bus.subscriberCount() === 0`, the release spy was called
      exactly once, and the stream finishes (`read()` returns `done`).
    - T-S4: `reader.cancel()` → `subscriberCount() === 0` and release was called once.
    - T-S5: `revalidate` returns `false` on the first tick → the next frame is
      `{"type":"session.expired"}`, then `done`, with subscribers at 0.
    - T-S6: `maxLifetimeMs: 20` → `done` within 100 ms, with subscribers at 0.
    - T-S7: replay. Publish 3 events, then open the stream with `lastEventId: 'teststrm-1'`. The
      ids 2 and 3 are replayed in order before live events. With `'zzz-1'`, a `resync` frame is
      sent.
    - T-S8: slow consumer. Use `highWaterMark: 2`, do not read, publish 10 events →
      `subscriberCount() === 0`.
    - T-S9: caps. `new EventConnectionRegistry(2, 3)`: the third `acquire('a')` → 429; `'b'`, `'c'`
      → ok, then `'d'` → 503; releasing twice is safe; `count()` returns to 0.
    - T-S10: route headers. Call `GET` directly with
      `{ request: new Request('http://x/api/v1/events', { signal }), url: new URL('http://x/api/v1/events'), locals: { session: null, principal: { kind: 'bypass', scopes: [] } }, getClientAddress: () => '127.0.0.1' } as unknown as Parameters<typeof GET>[0]`.
      - Assert `status === 200` and the four `SSE_HEADERS`.
      - Assert that `principal: null` → 401.
      - Abort at the end, and assert `eventBus.subscriberCount()` returns to the value it had
        before the test.
    - T-S11: `encodeEvent` throws on an id containing `\n`. A data value containing `\n` stays on
      one `data:` line.
    - Use `{ sanitizeOps: false, sanitizeResources: false }` on the route test only.
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING, TEST_STRUCTURE. The structural locals type follows
  `lib/server/mcp/context.ts:19-30`.
- **IMPORTS**:
  - `stream.ts`: `eventBus`/`EventBus` (`./bus.ts`), the encoders (`./sse.ts`), the constants
    (`$shared/events/types.ts`) and `logger`.
  - `streamAuth.ts`: `sessionsQueries` (`$db/queries/sessions.ts`), `apiTokensQueries`
    (`$db/queries/apiTokens.ts`) and `type AuthPrincipal` (`$auth/principal.ts`).
  - Route: `type RequestHandler` from `@sveltejs/kit`, `getClientIp` from
    `$auth/network.ts`, plus the events modules.
- **GOTCHA**:
  - Export `HEAD` explicitly. Without it SvelteKit runs `GET` for `HEAD` and opens a stream.
  - Under Deno's legacy abort semantics, `request.signal` may abort when the response finishes.
    That is fine, because `close()` is idempotent.
  - Never extend the session from the heartbeat (security research A6). Never put the route in
    `PUBLIC_PATHS`.
  - The handler has no side effects beyond the slot it takes. It never enqueues jobs.
  - Do not add CORS headers.
- **VALIDATE**: `deno task test events` (after task 4.6 exists) or
  `deno task test packages/praxrr-app/src/tests/events/stream.test.ts`.
  Then `curl -N -b 'session=…' http://localhost:6969/api/v1/events` in dev shows `retry:`, `hello`,
  and a ping within 20 s.

### Task 3.5: Client `eventsStore`, debounced invalidation, job toasts, status indicator — Depends on [1.4, 2.3]

- **BATCH**: B3
- **ACTION**: Create `lib/client/stores/events.ts`, `lib/client/events/liveInvalidate.ts`,
  `lib/client/events/jobToasts.ts` and `lib/client/events/LiveStatusIndicator.svelte`.
- **IMPLEMENT**:
  - `stores/events.ts` (`createEventsStore()`, browser-guarded):
    - State:
      - `status = writable<'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped'>('idle')`
      - `downSince = writable<number | null>(null)`
      - `stopReason = writable<'auth' | 'expired' | null>(null)`
      - `handlers = new Map<string, Set<(e: LiveEvent) => void>>()`
      - `lastEventId: string | null = null`, `attempt = 0`, `source: EventSource | null`,
        `timer`, `started = false`
    - `start()`:
      - Return if `!browser` or `started`. Set `started = true`.
      - Add `visibilitychange` (on visible, if status is not `open` or `stopped`, reconnect now)
        and `pagehide` (`disconnect()`) listeners.
      - Call `connect()`.
    - `connect()`:
      1. Set `status` to `connecting` (`reconnecting` when `attempt > 0`).
      2. `url = \`${base}${LIVE_EVENTS_PATH}\` + (lastEventId ? \`?lastEventId=${encodeURIComponent(lastEventId)}\` : '')`.
      3. `source = new EventSource(url)`, with the handlers below.
    - `source.onmessage = (m) => { … }`:
      1. `const e = parseLiveEvent(m.data); if (!e) return;`
      2. If `m.lastEventId`, then `lastEventId = m.lastEventId`.
      3. `hello`:
         - set `status` to `open`, `attempt = 0`, `downSince = null`;
         - if `lastEventId === null`, set `lastEventId = e.headId || null`, so a first-time
           connection can still replay after a drop.
      4. `resync`: emit to `'resync'` handlers.
      5. `session.expired`: `stop('expired')`.
      6. Otherwise, emit to `e.type` handlers and to `'*'`.
      - Each handler call runs in its own `try/catch`.
    - `source.onerror = () => { source.close(); void handleFailure(); }`.
      `EventSource` cannot expose the HTTP status, and its own retry stops after a non-200 response.
    - `handleFailure()`:
      1. If `downSince` is null, set it to `Date.now()`.
      2. `let r: Response | null = null; try { r = await fetch(url-without-query, { method: 'HEAD', credentials: 'same-origin' }); } catch { r = null; }`.
      3. `const verdict = r ? classifyProbeStatus(r.status) : 'backoff';`
         - `'stop'` → `stop('auth')`.
         - Otherwise, delay by `retryAfterMs(r?.headers.get('Retry-After') ?? null) ?? nextBackoffMs(attempt++)`
           with `setTimeout(connect, delay)`. Use the same delay for an `'ok'` probe (transient
           drop).
    - `stop(reason?)`:
      - set `status` to `stopped` and `stopReason` to `reason ?? null`;
      - close the source, clear the timer, remove the listeners;
      - set `started = false` (the layout may call `start()` again after re-login).
    - `disconnect()` (pagehide) closes the source without changing `stopReason`. The
      `visibilitychange` handler restarts it.
    - API: `{ status: {subscribe}, downSince: {subscribe}, stopReason: {subscribe}, start, stop, on(type: LiveEventType | '*', fn), onResync(fn) }`.
      `on` and `onResync` return idempotent unsubscribe functions.
    - Export the singleton `eventsStore = createEventsStore()`.
  - `liveInvalidate.ts`:
    - `export function subscribeLive(spec: { key: string; types: LiveEventType[]; filter?: (e: LiveEvent) => boolean; debounceMs?: number }): () => void`
      registers `eventsStore.on(type, …)` for each type, plus `eventsStore.onResync(…)`.
    - It calls a 250 ms trailing-debounced `invalidate(spec.key)` from `$app/navigation`, skipping
      calls while `document.hidden`. In that case it sets a pending flag that is flushed on
      `visibilitychange`.
    - It returns one cleanup function that unsubscribes everything and clears the timer.
  - `jobToasts.ts`:
    - `export function startJobToasts(): () => void`:
      - Keep `historyByJob = new Map<number, { id: number; status: SyncOperationStatus }>()`
        (cap 200, FIFO), filled from `sync.recorded` where `jobId !== null`.
      - Keep `seen = new SeenSet()` and `coalescer = new ToastCoalescer()`.
      - On `job.finished`:
        1. If `!seen.addOnce(\`${e.jobId}:${e.runId}\`)`, return.
        2. Look up the correlated `history` entry.
        3. `const d = decideJobToast(e, { syncHistoryId: history?.id ?? null, syncStatus: history?.status ?? null, base })`.
        4. If `d.kind === 'toast' && coalescer.allow(e)`, call
           `alertStore.add(d.type, d.message, d.sticky ? 0 : undefined, { label: 'View details', href: d.href })`.
      - Return the cleanup function.
  - `LiveStatusIndicator.svelte` (no runes):
    - Subscribe to `eventsStore.status`, `downSince` and `stopReason`. Keep a local
      `now = Date.now()`, updated by a 1 s `setInterval` that runs **only while** `downSince !== null`.
      Clear it in `onDestroy`.
    - `$: visible = $status === 'stopped' ? $stopReason !== null : $downSince !== null && now - $downSince > 10_000`.
    - When visible, render
      `<button type="button" onclick={retry} class="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] …">`
      containing a dot (`bg-amber-500` while reconnecting, `bg-neutral-400` when stopped) and the
      text "Reconnecting…" or "Live updates paused".
    - `retry`: `eventsStore.stop(); eventsStore.start();`.
    - Add `title="Live updates are temporarily unavailable; pages still work."`.
- **MIRROR**: CLIENT_STORE_PATTERN; browser guard (`lib/client/alerts/settings.ts:2`);
  `onclick` (`lib/client/ui/card/CollapsibleCard.svelte:54`).
- **IMPORTS**:
  - `browser` from `$app/environment`; `base` from `$app/paths`; `invalidate` from
    `$app/navigation`; `writable` from `svelte/store`.
  - The helpers from `$lib/client/events/reconnect.ts` and `toastPolicy.ts`.
  - `alertStore` from `$alerts/store`; types from `$shared/events/types.ts`.
- **GOTCHA**:
  - Never put the API token in the URL. The browser uses the cookie.
  - Svelte 5 with **no runes**: use `writable` and `$:`, never `$state`/`$derived`.
  - A replayed `job.finished` after reconnect must toast exactly once. That is what the
    `seen` key `${jobId}:${runId}` is for.
  - `HEAD` takes no slot, so probing cannot cause a 429.
  - Do not toast "reconnected".
- **VALIDATE**: `deno task check:client`. The pure logic is covered by T-C1…T-C6. Behavior is
  checked manually in task 5.1.

### Batch 4 — Page integration, docs, dispatcher test

### Task 4.1: Root layout wiring and connection indicator — Depends on [1.4, 3.5]

- **BATCH**: B4
- **ACTION**: Update `routes/+layout.svelte` and `lib/client/ui/navigation/pageNav/version.svelte`.
- **IMPLEMENT**:
  - `+layout.svelte`:
    - Import `onMount` from `svelte`, `eventsStore` from `$stores/events`, `startJobToasts` from
      `$lib/client/events/jobToasts`, and `AlertLiveRegion` from `$alerts/AlertLiveRegion.svelte`.
    - Add `$: liveEnabled = !isAuthPage && Boolean(data.navShell);`. `navShell` exists only for an
      authenticated user or a bypass session (`lib/server/navigation/layoutData.ts:44-52`).
    - Add a reactive start/stop controller:

      ```svelte
      let stopToasts: (() => void) | null = null;
      $: if (browser) {
        if (liveEnabled && !stopToasts) { eventsStore.start(); stopToasts = startJobToasts(); }
        else if (!liveEnabled && stopToasts) { stopToasts(); stopToasts = null; eventsStore.stop(); }
      }
      onMount(() => () => { stopToasts?.(); stopToasts = null; eventsStore.stop(); });
      ```

    - Render `<AlertLiveRegion />` right after `<AlertContainer />` (line 27), outside every
      breakpoint-hidden wrapper.
  - `version.svelte`: import `LiveStatusIndicator` from `$lib/client/events/LiveStatusIndicator.svelte`
    and render `<LiveStatusIndicator />` after the closing `</div>` of the version card. The
    indicator renders nothing while healthy.
- **MIRROR**: CLIENT_STORE_PATTERN. The layout markup stays as-is (`routes/+layout.svelte:22-34`).
- **IMPORTS**: `browser` from `$app/environment`, plus the imports above.
- **GOTCHA**:
  - `PageNav` mounts `Version` twice, once for mobile and once for desktop
    (`pageNav.svelte:207-215`). Both copies share the store, so this is fine. Only one is visible
    per breakpoint.
  - Do not start the stream on `/auth/*` or `/setup` (`isAuthPage`, line 14).
- **VALIDATE**:
  - `deno task check:client`.
  - In dev, after logging in, the Network tab shows exactly one `events` request
    (`EventStream` type). After logout and a login-page visit, the stream is closed.

### Task 4.2: Settings → Jobs: Active jobs table and live refresh — Depends on [2.4, 3.5]

- **BATCH**: B4
- **ACTION**: Create `routes/settings/jobs/components/ActiveJobs.svelte`. Update
  `routes/settings/jobs/+page.svelte`.
- **IMPLEMENT**:
  - `ActiveJobs.svelte`:
    - Props: `export let jobs: { id: number; jobType: string; displayName: string; status: string; source: string; runAt: string; startedAt: string | null; attempts: number }[]`.
    - Render a heading "Active jobs", then `Table` (`$ui/table/Table.svelte`) with these columns:
      - Job: `displayName`
      - Status: `Badge`. `running` → `variant="accent"` with the `Loader2` icon (static under
        `motion-reduce`) and the text "Running". `queued` → `variant="neutral"`, text "Queued".
      - Source: "Manual" / "Scheduled" / "System"
      - Started/Run at: relative time via `parseUTC` from `$shared/utils/dates`
    - When `jobs.length === 0`, the empty message is "No jobs are queued or running".
  - `+page.svelte`:
    - Import `onMount`, `subscribeLive` and `LIVE_DEPENDENCY_KEYS`. Render `<ActiveJobs jobs={data.activeJobs} />`
      above the scheduled table (before line 88).
    - In `onMount`, return
      `subscribeLive({ key: LIVE_DEPENDENCY_KEYS.jobs, types: ['job.queued', 'job.running', 'job.finished'] })`.
    - In the existing status cell (lines 102-110), add `{:else if row.status === 'success'}<Badge variant="success" icon={CheckCircle}>Success</Badge>`
      and `{:else if row.status === 'failed'}<Badge variant="danger" icon={XCircle}>Failed</Badge>`
      before the raw fallback.
- **MIRROR**: the existing Jobs page `Badge` usage (`routes/settings/jobs/+page.svelte:102-120`).
  The `Table` cell slot follows `lib/client/ui/table/Table.svelte:198-230`.
- **IMPORTS**: `Table`, `Badge`, `Loader2` (`lucide-svelte`), `parseUTC`, `type Column`.
- **GOTCHA**:
  - No runes. `data.activeJobs` refreshes automatically when the load re-runs.
  - Keep the file under 500 lines. The page is 193 lines today.
- **VALIDATE**:
  - `deno task check:client`.
  - Manually: click "Sync now" on any section. The Jobs page shows it as Queued, then Running, then
    it disappears, and Job History gains a row, all without a reload.

### Task 4.3: Arr Sync page: live section status — Depends on [1.6, 2.5, 3.5]

- **BATCH**: B4
- **ACTION**:
  - Create `routes/arr/[id]/sync/liveSync.ts`.
  - Update `routes/arr/[id]/sync/+page.svelte` and
    `routes/arr/[id]/sync/components/SyncFooter.svelte`.
  - Update `components/DelayProfiles.svelte`, `components/QualityProfiles.svelte` and
    `components/MediaManagement.svelte`.
- **IMPLEMENT**:
  - `liveSync.ts`:
    - `export function subscribeInstanceSync(instanceId: number): () => void` returns
      `subscribeLive` with:
      - `key: LIVE_DEPENDENCY_KEYS.sync`
      - `types: ['job.queued', 'job.running', 'job.finished', 'sync.recorded']`
      - `filter: (e) => ('instanceId' in e && e.instanceId === instanceId)`
    - `export type SectionLiveStatus = 'idle' | 'pending' | 'in_progress' | 'failed'`.
    - `export function toSectionLiveStatus(raw: string | undefined): SectionLiveStatus` maps
      unknown values to `'idle'`.
  - `SyncFooter.svelte`: add `export let liveStatus: SectionLiveStatus = 'idle';`.
    - Render a chip before the buttons:
      - `pending` → `<Badge variant="neutral">Queued</Badge>`
      - `in_progress` → `<Badge variant="accent" icon={Loader2}>Syncing…</Badge>`
      - `failed` → `<Badge variant="danger">Last sync failed</Badge>`
    - Change line 39 to
      `$: syncDisabled = syncing || isDirty || !canSync || liveStatus === 'in_progress';`.
    - Keep the existing `title` behavior. Add `'Sync in progress'` when `in_progress`.
  - `DelayProfiles.svelte`, `QualityProfiles.svelte`, `MediaManagement.svelte`: add
    `export let liveStatus: SectionLiveStatus = 'idle';` and pass `{liveStatus}` to their
    `<SyncFooter>` (lines 168, 591 and 498).
  - `+page.svelte`:
    - Import `subscribeInstanceSync` and `toSectionLiveStatus`.
    - In the existing `onMount` (line 132), keep `initEdit` and add
      `const stopLive = subscribeInstanceSync(data.instance.id)`. Return
      `() => { clear(); stopLive(); }`.
    - Pass `liveStatus={toSectionLiveStatus(data.sectionStatus?.mediaManagement)}` and the
      matching value for each section to `<MediaManagement>`, `<QualityProfiles>` and
      `<DelayProfiles>` (lines 395, 412 and 429), and
      `liveStatus={toSectionLiveStatus(data.sectionStatus?.metadataProfiles)}` to the metadata
      `<SyncFooter>` (line 484).
    - Change line 363 from `'success'` to `'info'` (the metadata "queued" toast).
- **MIRROR**: CLIENT_STORE_PATTERN; `Badge` usage. The existing `invalidateAll()` after a trigger
  (`+page.svelte:364`) proves that re-running the load is safe for local edit state: the `let`s
  are initialized once (lines 78-104).
- **IMPORTS**: `Badge` (`$ui/badge/Badge.svelte`) and `Loader2` in `SyncFooter`;
  `subscribeLive` and `LIVE_DEPENDENCY_KEYS` in `liveSync.ts`.
- **GOTCHA**:
  - `pending` can also come from on-pull or on-change markers (`arrSync.ts:1130-1163`) with no job.
    Do **not** disable Sync Now on `pending`, only on `in_progress`. `claimSync` would skip a
    duplicate anyway.
  - Metadata profiles are Lidarr-only. For other instances the load already returns `idle`.
  - `+page.svelte` is 616 lines, so all new logic goes in `liveSync.ts`. The page only gains a few
    lines.
  - Filter by explicit `instanceId`, never by `arrType`.
- **VALIDATE**:
  - `deno task check:client`.
  - Manually on `/arr/{id}/sync`: Sync Now on Delay Profiles shows an `info` toast, then the chip
    goes Queued → Syncing… → cleared, "Last synced" updates, and a completion toast with View
    details appears.

### Task 4.4: Sync History, Canary and Drift pages subscribe — Depends on [2.4, 3.5]

- **BATCH**: B4
- **ACTION**: Update `routes/sync-history/+page.svelte`, `routes/canary/+page.svelte`,
  `routes/canary/[id]/+page.svelte`, `routes/drift/+page.svelte` and
  `routes/drift/[instanceId]/+page.svelte`.
- **IMPLEMENT**:
  - Sync history: import `onMount` and `subscribeLive`. In `onMount`, return
    `subscribeLive({ key: LIVE_DEPENDENCY_KEYS.syncHistory, types: ['sync.recorded'] })`.
  - Canary list: `onMount(() => subscribeLive({ key: LIVE_DEPENDENCY_KEYS.canary, types: ['canary.updated'] }))`.
  - Canary detail: the same, with `filter: (e) => e.type === 'canary.updated' && e.rolloutId === data.rollout.id`.
    Read `data` inside the filter so it uses the current value.
  - Drift list:
    - In the existing `onMount` (line 115), keep `void loadSummary();`.
    - Add `const off = eventsStore.on('drift.updated', schedule); const offResync = eventsStore.onResync(schedule);`.
      `schedule` is a local 500 ms trailing debounce that calls `void loadSummary()`.
    - Return `() => { off(); offResync(); clearTimeout(timer); }`.
  - Drift detail: the same pattern around `loadDetail()` (line 100), filtering
    `e.instanceId === data.instanceId`. Skip the reload while `refreshing` is true.
- **MIRROR**: CLIENT_STORE_PATTERN.
  - The canary pages already use `invalidateAll()` after their own actions
    (`routes/canary/[id]/+page.svelte:145,158`). The keyed invalidate is a narrower version of the
    same refresh.
  - The drift pages reuse their existing request-id-guarded loaders
    (`routes/drift/+page.svelte:53-79`).
- **IMPORTS**: `onMount` (`svelte`), `subscribeLive` (`$lib/client/events/liveInvalidate`),
  `eventsStore` (`$stores/events`), `LIVE_DEPENDENCY_KEYS`.
- **GOTCHA**:
  - `tests/base/canaryPreviewEvidenceUx.test.ts` string-matches `routes/canary/[id]/+page.svelte`.
    Add code only; do not change or remove any existing text.
  - The canary detail refresh also renews `rollout.stateToken`, so proceed/abort stays valid. Do
    not cache the token elsewhere.
  - The drift pages fetch data on the client, so `depends('praxrr:drift')` is **not** used. Their
    server loads only return the picker or ids.
- **VALIDATE**:
  - `deno task check:client` and `deno task test packages/praxrr-app/src/tests/base/canaryPreviewEvidenceUx.test.ts`.
  - Manually: a finished sync adds a row to `/sync-history` without a reload, and a drift check
    updates `/drift` counts.

### Task 4.5: Documentation — Depends on [1.2, 3.4]

- **BATCH**: B4
- **ACTION**: Update `docs/api/endpoints.md`,
  `docs/site/src/content/docs/guides/syncing-profiles.md` and
  `docs/site/src/content/docs/guides/troubleshooting.md`.
- **IMPLEMENT**:
  - `endpoints.md`:
    - In the index table (lines 16-48), add `| GET    | \`/events\` | Live event stream (SSE) |`and`| HEAD | \`/events\` | Event stream availability probe |`.
    - Add a `## Live events` section with `### \`GET /events\`` covering:
      - authentication: the session cookie, or `X-Api-Key` with the `read` scope (`?apikey=`
        works but leaks into logs);
      - the framing example and the event-type table;
      - replay (`Last-Event-ID` / `lastEventId`) and `resync`;
      - heartbeat 20 s, lifetime 60 min, `session.expired`;
      - the caps 8/100 with 429/503 and `Retry-After`;
      - a curl example: `curl -N -H 'X-Api-Key: prx_…' http://localhost:6868/api/v1/events`.
  - `syncing-profiles.md`: under `## Run a sync` (line 88), add a `### Live progress` subsection.
    It explains:
    - the section chip (Queued / Syncing… / Last sync failed);
    - completion toasts with **View details**;
    - which jobs toast: your manual jobs always; background sync failures, at most one per minute
      per instance;
    - the "Reconnecting… / Live updates paused" indicator, and that pages keep working without it.
  - `troubleshooting.md`: before `## Getting more help` (line 169), add
    `## Live updates paused or not arriving`, covering:
    - signed out → log in again;
    - reverse proxies must not buffer `text/event-stream`. Include an nginx snippet:

      ```nginx
      location /api/v1/events {
        proxy_pass http://praxrr:6868;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 1h;
      }
      ```

    - Caddy needs no config;
    - more than 6 tabs on HTTP/1.1 can stall page loads (browser limit), so close extra tabs or use
      HTTP/2.
- **MIRROR**: the existing headings and tables in those files (`docs/api/endpoints.md:14-50`,
  `troubleshooting.md:66-88`).
- **IMPORTS**: n/a.
- **GOTCHA**:
  - Markdown uses `proseWrap: preserve` at width 80 (`.prettierrc` overrides). Keep lines ≤ 80 in
    `docs/site`.
  - Do not create new doc files, and do not add the page to the `astro.config.mjs` sidebar. These
    are edits to existing pages.
- **VALIDATE**: `npx prettier --check docs/api/endpoints.md docs/site/src/content/docs/guides/*.md`.

### Task 4.6: Dispatcher event-order test — Depends on [3.1, 3.2]

- **BATCH**: B4
- **ACTION**: Create `tests/jobs/dispatcherEvents.test.ts`.
- **IMPLEMENT**:
  - Use a `migratedTest` helper copied from `tests/routes/syncHistory.test.ts:37-61`, with base
    path prefix `dispatcher-events-`. It must call `jobDispatcher.stop()` in `finally`.
  - Helper `collect(predicate, timeoutMs = 2000)`:
    - subscribes to `eventBus`, pushes every envelope's `event` into an array, and resolves once
      `predicate(events)` is true;
    - rejects on timeout;
    - always unsubscribes.
  - Stub a handler by saving `const original = jobQueueRegistry.get('logs.cleanup')`, calling
    `jobQueueRegistry.register('logs.cleanup', stub)`, and restoring `original` in `finally`.
  - T-D1 (order):
    1. The stub returns `{ status: 'success', output: 'ok' }`.
    2. `enqueueJob({ jobType: 'logs.cleanup', runAt: new Date().toISOString(), source: 'manual' })`.
    3. Await `job.finished`.
    4. Assert the filtered type sequence for that `jobId` is
       `['job.queued', 'job.running', 'job.finished']`, plus `status: 'success'`,
       `runStatus: 'success'`, `rescheduled: false`, `runId > 0`, `source: 'manual'`, a
       non-empty `displayName`, and `arrType: null`.
  - T-D2 (no raw error text):
    1. The stub throws `new Error('HTTP 500: Internal | {"apiKey":"SECRET-123","url":"http://arr.local:7878"}')`.
    2. Await `job.finished`.
    3. Assert `status: 'failed'`, `runStatus: 'failure'`, and `failureCode` is a string.
    4. Assert `JSON.stringify(allEvents)` does not include `SECRET-123`, `arr.local`, `HTTP 500`
       or `"error"`.
  - T-D3 (handler not found):
    1. Create the row with `jobQueueQueries.create({ jobType: 'legacy.removed' as unknown as JobType, runAt: now, source: 'manual' })`
       and call `jobDispatcher.notifyJobEnqueued(now)`.
    2. Await `job.finished`.
    3. Assert `failureCode: 'handlerNotFound'`, `status: 'failed'` and `durationMs: 0`. No
       `job.queued` event is expected, because `create` bypasses `queueService`.
  - T-D4 (reschedule):
    1. The stub returns `{ status: 'success', rescheduleAt: new Date(Date.now() + 3_600_000).toISOString() }`.
    2. Await `job.finished`.
    3. Assert `rescheduled: true`, `status: 'queued'` and that `nextRunAt` equals the
       `rescheduleAt`.
  - T-D5 (future schedule upsert is silent):
    1. Call `upsertScheduledJob({ jobType: 'logs.cleanup', runAt: <+1h>, source: 'schedule', dedupeKey: 'logs.cleanup' })`.
    2. Assert that no `job.queued` arrives within 100 ms.
- **MIRROR**: TEST_STRUCTURE. The registry override style follows `tests/jobs/jobEvidence.test.ts:1-18`
  (which imports `$jobs/handlers/index.ts`).
- **IMPORTS**:
  - `enqueueJob`, `upsertScheduledJob` (`$jobs/queueService.ts`); `jobDispatcher`
    (`$jobs/dispatcher.ts`); `jobQueueRegistry` (`$jobs/queueRegistry.ts`); `jobQueueQueries`
    (`$db/queries/jobQueue.ts`).
  - `eventBus` (`$lib/server/events/bus.ts`); `config`, `db`, `runMigrations`; `type JobType`;
    `type LiveEvent`.
- **GOTCHA**:
  - The dispatcher runs jobs from a `setTimeout(0)`, so await the events. Never assume they are
    synchronous.
  - Always restore the original handler, because other test files share the registry singleton.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/jobs/dispatcherEvents.test.ts` and
  `deno task test events`.

### Batch 5 — Integration verification

### Task 5.1: Full validation and graph refresh — Depends on [4.1, 4.2, 4.3, 4.4, 4.5, 4.6]

- **BATCH**: B5
- **ACTION**: Run every validation command, fix any findings in the owning task's files, refresh
  the knowledge graph, and do the manual checks.
- **IMPLEMENT**:
  1. `deno task format` (or `deno task format:modified`).
  2. `deno task bundle:api && deno task generate:api-types`. Confirm `git diff --stat` shows no
     unexpected drift in the generated files.
  3. `deno task test events`.
  4. `deno task test jobs`, `deno task test sync-history`, `deno task test canary`,
     `deno task test security-posture`.
  5. `deno task test` (full suite).
  6. `deno task lint`.
  7. `deno task check`.
  8. `deno task build`.
  9. `graphify update .`.
  10. The manual checklist in Validation Commands → Manual Validation.
- **MIRROR**: Validation Commands section.
- **IMPORTS**: n/a.
- **GOTCHA**: `deno task check:server` globs only `lib/server/**`, so new client files are checked
  by `check:client` (svelte-check). Run both, through `deno task check`.
- **VALIDATE**: every command exits 0, and every manual check passes.

---

## Testing Strategy

Only the critical tests are planned. Each one guards a correctness or security invariant, and there
are no UI snapshot tests. `deno task test events` runs `tests/events/*` plus
`tests/jobs/dispatcherEvents.test.ts`.

### Unit Tests

| Test                        | Input                                                                     | Expected Output                                                       | Edge Case? |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| T-B1 bus isolation          | 2 listeners, the first throws                                             | 2nd receives; `publish` does not throw                                | Yes        |
| T-B2 unsubscribe            | unsubscribe ×2                                                            | `subscriberCount() === 0`                                             | Yes        |
| T-B3 ring                   | capacity 4, 6 publishes                                                   | ids `…-3..6` kept                                                     | Yes        |
| T-B4 replay/resync          | `null`, same boot in buffer, other boot, evicted gap, future seq, garbage | empty / replay / resync boot / resync gap / resync boot / resync boot | Yes        |
| T-B5 HMR singleton          | `eventBus` vs `globalThis[Symbol.for('praxrr.events.bus')]`               | identical                                                             | No         |
| T-B6 allow-list             | records containing `error`, `stateToken`, `payload`                       | serialized event has none of the forbidden keys                       | Yes        |
| T-S1 framing                | open stream, publish 1                                                    | `retry:` → `hello` → `id: <boot>-1\ndata:`                            | No         |
| T-S2 heartbeat              | `heartbeatMs: 10`                                                         | `: ping` frame                                                        | No         |
| T-S3/T-S4 cleanup           | abort signal; reader cancel                                               | 0 subscribers, release called once, stream done                       | Yes        |
| T-S5 session expiry         | `revalidate → false`                                                      | `session.expired` then done, 0 subscribers                            | Yes        |
| T-S6 lifetime               | `maxLifetimeMs: 20`                                                       | done ≤ 100 ms                                                         | Yes        |
| T-S7 replay through stream  | `lastEventId` in buffer / other boot                                      | ids 2,3 replayed / `resync`                                           | Yes        |
| T-S8 slow consumer          | `highWaterMark: 2`, no reads, 10 publishes                                | stream dropped, 0 subscribers                                         | Yes        |
| T-S9 caps                   | registry(2,3)                                                             | 429 per principal, 503 global, idempotent release                     | Yes        |
| T-S10 route                 | bypass principal; null principal                                          | 200 + 4 SSE headers; 401                                              | Yes        |
| T-S11 injection             | id with `\n`; data with `\n`                                              | throws; single `data:` line                                           | Yes        |
| T-D1 order                  | manual `logs.cleanup` success                                             | queued → running → finished(success)                                  | No         |
| T-D2 redaction              | handler throws secret-bearing error                                       | `failed`, `failureCode` set, no secret substrings                     | Yes        |
| T-D3 handler-not-found      | unknown job type row                                                      | `failureCode: handlerNotFound`                                        | Yes        |
| T-D4 reschedule             | `rescheduleAt` +1 h                                                       | `rescheduled: true`, `status: queued`, `nextRunAt`                    | Yes        |
| T-D5 schedule silence       | future `schedule` upsert                                                  | no `job.queued`                                                       | Yes        |
| T-C1 backoff                | attempts 0..10, random 0/0.5/1                                            | 1 s → 30 s cap, ±20 %, ≥ 1 s                                          | Yes        |
| T-C2 parse                  | bad JSON, array, unknown type, missing `jobId`, valid `hello`             | null ×5 / event                                                       | Yes        |
| T-C3 classify               | 204/401/403/429/503                                                       | ok/stop/stop/backoff/backoff                                          | No         |
| T-C4 toast policy           | each `runStatus` × source, partial, rescheduled, non-sync failure         | per decision 5                                                        | Yes        |
| T-C5/T-C6 coalesce + dedupe | repeat failures in 60 s; repeated `jobId:runId`                           | blocked / once                                                        | Yes        |
| Contract                    | shared union vs `components['schemas']`; `LiveJobType` vs `JOB_TYPES`     | mutually assignable; equal                                            | No         |
| Scope policy                | GET/HEAD/POST `/api/v1/events`                                            | read / read / admin                                                   | Yes        |

### Edge Cases Checklist

- [x] Empty input: `lastEventId` null or empty → hello only, no replay (T-B4)
- [x] Maximum size input: ring overflow (T-B3); `lastEventId` > 64 chars ignored (`resolveLastEventId`)
- [x] Invalid types: malformed or unknown events are dropped client-side (T-C2); garbage
      `Last-Event-ID` → resync (T-B4)
- [x] Concurrent access: per-principal and global caps (T-S9); synchronous fan-out keeps FIFO order
      per stream (T-D1)
- [x] Network failure: abort/cancel/slow consumer cleanup (T-S3/T-S4/T-S8); client backoff (T-C1)
- [x] Permission denied: null principal → 401 (T-S10); token scope (scope policy); session expiry
      (T-S5)

---

## Validation Commands

### Static Analysis

```bash
deno task check            # check:server (deno check lib/server/**) + check:client (svelte-check)
deno task lint             # prettier --check . && eslint .
```

EXPECT: Zero type errors, zero lint or format errors.

### Unit Tests

```bash
deno task test events                                                          # new alias (task 3.4)
deno task test packages/praxrr-app/src/tests/events/bus.test.ts                # one file by path
deno task test packages/praxrr-app/src/tests/server/utils/auth/apiTokens.test.ts
deno task test jobs && deno task test sync-history && deno task test canary
```

EXPECT: All tests pass. `scripts/test.ts` accepts an alias or a direct path, and runs `deno test`
with `APP_BASE_PATH=dist/test`.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions.

### Database Validation (if applicable)

```bash
# No migrations in this feature. Confirm the contract artifacts are regenerated, not hand-edited:
deno task bundle:api && deno task generate:api-types && git diff --stat -- packages/praxrr-api packages/praxrr-app/src/lib/api/v1.d.ts
```

EXPECT: Only the `Live*` schema and `/events` additions appear in the diff.

### Browser Validation (if applicable)

```bash
deno task build            # vite build + deno compile
deno task dev              # parser + vite dev on :6969
curl -N -b 'session=<cookie>' http://localhost:6969/api/v1/events   # retry:, hello, ": ping" within 20 s
curl -sI http://localhost:6969/api/v1/events                         # 401 when unauthenticated
```

EXPECT: The build succeeds, and the stream works in dev.

### Manual Validation

- [ ] `/arr/{id}/sync` → Sync Now (Delay Profiles):
  - an `info` "queued" toast appears;
  - the chip goes Queued → Syncing… → cleared, and "Last synced" updates;
  - a success toast with **View details** opens `/sync-history/{id}`.
- [ ] Force a failure (wrong API key on the instance), then Sync Now. A sticky error toast appears
      and stays until dismissed.
- [ ] `/settings/jobs` shows the manual job in **Active jobs**: Queued, then Running, then it is
      gone. Job History gains a row with no reload.
- [ ] Two tabs open → the toast appears in both. Reload one tab during a sync → its toast still
      appears once (replay).
- [ ] Stop the server for 15 s → "Reconnecting…" appears in the sidebar version card. Restart →
      the indicator hides and the pages refresh (`resync`).
- [ ] Log out in tab A → tab B's stream closes within 20 s and shows "Live updates paused". Tab B
      does not loop requests in the Network tab.
- [ ] Block `/api/v1/events` in devtools → every page still loads and actions still work (AC3).
- [ ] Screen reader / Accessibility pane: toast text is announced through the live region, and
      Tab reaches **View details** and then **Dismiss**.
- [ ] A Lidarr instance's metadata profiles chip works. Radarr/Sonarr instances show no metadata
      section (Arr-specific behavior unchanged).

---

## Acceptance Criteria

- [ ] AC1: Jobs (Active jobs table) and `/arr/{id}/sync` section status show queued → running →
      result without a reload.
- [ ] AC2: a manual sync shows a terminal toast whose **View details** link opens
      `/sync-history/{id}` (fallback `/settings/jobs`).
- [ ] AC3: with the stream unavailable, all pages load and work. After reconnect, missed events
      replay (same boot, within 256) or pages resync.
- [ ] No event payload contains raw error text, `last_error`, `canaryError`, `stateToken`/`nextToken`,
      URLs, keys or job payloads (T-B6, T-D2).
- [ ] An unauthenticated request → 401. A token without `read` → 403. Over the cap → 429/503 with
      `Retry-After`. Session revocation closes the stream within one heartbeat (20 s).
- [ ] The subscriber count returns to 0 on every exit path (T-S3…T-S8).
- [ ] The OpenAPI `/events` contract and the `LiveEvent` schemas match the shared TS union
      (contract test).
- [ ] All tasks completed; `deno task test`, `deno task lint`, `deno task check` and
      `deno task build` pass.
- [ ] Matches the UX design (toast policy per decision 5; indicator only after > 10 s down).

## Completion Checklist

- [ ] Code follows the discovered patterns: class + singleton, `createXStore`, never-throw side
      effects, thin routes
- [ ] Error handling matches the codebase style (redaction by construction; logger only for raw
      errors)
- [ ] Logging follows the codebase conventions (`source: 'LiveEvents' | 'LiveEventStream'`; debug
      for open/close; never per event)
- [ ] Tests follow the test patterns (`migratedTest`, direct handler invocation, `@std/assert`)
- [ ] No hardcoded values: limits come from `lib/shared/events/types.ts` constants
- [ ] Documentation updated (`docs/api/endpoints.md` and the two `docs/site` guides)
- [ ] No unnecessary scope additions (see NOT Building)
- [ ] Self-contained: no questions needed during implementation
- [ ] `graphify update .` run after code changes
- [ ] Svelte 5 with no runes; `onclick` used in the migrated alert components
- [ ] Cross-Arr checklist: `arrType` comes from instance, rollout or drift rows only; pages filter by
      `instanceId`; metadata profiles stay Lidarr-only

## Risks

| Risk                                                                                       | Likelihood | Impact | Mitigation                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------- |
| **CRITICAL (if violated)**: the route is added to `PUBLIC_PATHS` or skips `authHandle`     | Low        | High   | Never edit `PUBLIC_PATHS`; the route fails closed on a null principal (T-S10)                |
| **CRITICAL (if violated)**: raw error text or `stateToken` in events                       | Low        | High   | Field-by-field builders in `publish.ts`; T-B6 and T-D2 assert absence                        |
| **WARNING**: stream outlives logout or revocation                                          | Med        | Med    | 20 s heartbeat revalidation → `session.expired`; 60 min lifetime (T-S5, T-S6)                |
| **WARNING**: subscriber or timer leak in the single long-running process                   | Med        | High   | One idempotent `close()` on every exit path; tests assert 0 subscribers                      |
| **WARNING**: unbounded connections / slow consumers                                        | Low        | Med    | Caps 8/100 → 429/503; `desiredSize` guard with HWM 64 (T-S8, T-S9)                           |
| `publish` throwing inside the dispatcher breaks jobs                                       | Low        | High   | Listener isolation plus an outer try/catch; publish is synchronous and returns `void` (T-B1) |
| Boot flood from schedule upserts                                                           | Med        | Med    | `onlyIfDue` guard; no publish in `schedule.ts` (T-D5)                                        |
| Six-connection HTTP/1.1 limit with many tabs                                               | Med        | Med    | Close on `pagehide`; documented in troubleshooting; BroadcastChannel is a follow-up          |
| Proxy buffering hides events                                                               | Med        | Low    | `X-Accel-Buffering: no`, `no-transform`, heartbeat; nginx snippet in the docs                |
| Svelte 5 event syntax mix breaks the alert components                                      | Med        | Low    | Migrate each alert component fully to `onclick`/`onkeydown` (task 1.4)                       |
| Source-string tests break on page edits                                                    | Med        | Low    | Additive edits only in `canary/[id]/+page.svelte` and `databases/trash/[id]/+page.svelte`    |
| **ADVISORY**: `?apikey=` leaks tokens into logs; `AUTH=off/local` bypass grants the stream | —          | Low    | Documented in OpenAPI and endpoints.md; matches app-wide behavior                            |

## Notes

- **Decision precedence:** `docs/plans/live-events-sse/decisions.md` overrides the research.
  Specifically:
  - a replay ring is built (the technical and practices research said no replay);
  - over the per-principal cap the server rejects with 429 (the technical research proposed
    evict-oldest);
  - the heartbeat is 20 s (the research said 25 s);
  - the bus is stored on `globalThis` (the technical research said not to);
  - every open tab toasts manual jobs (the UX research proposed only the originating tab).
- **Toast correlation:** `recordSyncHistory` runs inside the handler, before `markFinished`. Fan-out
  is synchronous and per-stream FIFO, so `sync.recorded{jobId}` always reaches the client before
  `job.finished{jobId}`, including in replay. The dispatcher needs no `syncHistoryId`.
- **First-connection replay:** `hello.headId` seeds the client's `lastEventId`, so a drop before
  the first domain event still replays instead of resyncing.
- **HEAD probe:** `EventSource` cannot read the HTTP status. A `HEAD` that takes no slot classifies
  401/403 (stop) versus 429/503 (back off with `Retry-After`) without opening a stream.
- **Formatting:** `.prettierrc` is the source of truth (2 spaces, semicolons, es5 trailing commas,
  width 120). `CLAUDE.md` and the Cursor rules describe tabs/100 and are stale.
- **Follow-ups (not in this PR):** BroadcastChannel single connection, cancellation events,
  logout push-close, stream metrics, the raw `error` sanitization in the sync-history API, and
  dashboard badges (YAN-589).
- **Confidence:** 8/10 for single-pass implementation. Every publish point, query, file and line
  reference was verified against the worktree (`origin/main` @ 8417c992). The residual risk is
  in the Svelte UI tasks (4.1–4.4), where markup details may need small adjustments.
