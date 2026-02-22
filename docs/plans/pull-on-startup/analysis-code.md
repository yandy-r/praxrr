# Code Analysis: pull-on-startup

## Executive Summary

The "Critically Relevant Files" list appears in `docs/plans/pull-on-startup/shared.md:5` as a `## Relevant Files` section. The codebase already has the exact primitives needed for pull-on-startup: ordered startup orchestration, non-blocking setup behavior, Arr-type-gated sync capability checks, deterministic selection persistence via query modules, and job-backed execution.

Actionable direction: implement pull-on-startup as a startup-triggered orchestration step that (1) runs after DB/migrations/cache initialization, (2) uses typed Arr clients and per-app capability checks, (3) persists selections only through `arrSyncQueries`, and (4) queues sync jobs using stable dedupe keys instead of direct sync execution.

## Existing Code Structure

- Startup lifecycle is centralized and strictly ordered in `packages/praxrr-app/src/hooks.server.ts:20`-`packages/praxrr-app/src/hooks.server.ts:149`.
- Startup currently follows: config init -> encryption key validation -> DB init/migrations -> logging setup -> PCD init -> setup flows -> env instance reconcile -> job queue init (`packages/praxrr-app/src/hooks.server.ts:21`, `packages/praxrr-app/src/hooks.server.ts:26`, `packages/praxrr-app/src/hooks.server.ts:37`, `packages/praxrr-app/src/hooks.server.ts:49`, `packages/praxrr-app/src/hooks.server.ts:109`, `packages/praxrr-app/src/hooks.server.ts:131`).
- Job system uses explicit boot + dispatcher loop: recover interrupted running jobs, schedule, then start dispatcher (`packages/praxrr-app/src/lib/server/jobs/init.ts:6`-`packages/praxrr-app/src/lib/server/jobs/init.ts:19`, `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts:14`-`packages/praxrr-app/src/lib/server/jobs/dispatcher.ts:67`).
- Sync persistence and state live in DB query modules, not handlers/routes (`packages/praxrr-app/src/lib/server/db/queries/arrSync.ts:433`, `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts:203`, `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts:242`, `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts:287`).
- Arr read surfaces are split cleanly: credential-aware client creation in `arrInstanceClients.ts`, API methods in `base.ts`, mapping/capability contracts in `sync/mappings.ts` and `shared/arr/capabilities.ts`.

## Implementation Patterns

- **Startup insertion pattern:** critical config failures throw and stop startup (Arr credential key check in `hooks.server.ts:25`-`hooks.server.ts:34`), but operational setup tasks are usually non-fatal and logged as warnings (`hooks.server.ts:97`-`hooks.server.ts:104`, `hooks.server.ts:123`-`hooks.server.ts:128`).
- **Feature flag/env parsing pattern:** env values are normalized at config construction time with explicit defaults and bool coercion (`config.ts:53`-`config.ts:58`); startup-specific env values often use `trim()` and default fallback (`hooks.server.ts:53`-`hooks.server.ts:60`).
- **Queue dedupe/upsert pattern:** scheduled/system work should use dedupe keys and upsert semantics (`jobQueue.ts:79`-`jobQueue.ts:118`, `processor.ts:384`-`processor.ts:420`).
- **Handler contract pattern:** handlers return structured statuses (`success`/`failure`/`skipped`/`cancelled`) and optional `rescheduleAt` rather than throwing (`queueTypes.ts:49`-`queueTypes.ts:57`, `pcdSync.ts:8`-`pcdSync.ts:88`, `arrSync.ts:326`-`arrSync.ts:330`).
- **Arr-type explicitness pattern:** unsupported sections are skipped with explicit reasons and no sibling fallback (`arrSync.ts:249`-`arrSync.ts:265`, `sync/mappings.ts:47`-`sync/mappings.ts:64`).
- **Fail-fast validation pattern at query boundary:** invalid partial selections throw before persistence (`arrSync.ts:225`-`arrSync.ts:247`, `arrSync.ts:205`-`arrSync.ts:223`).
- **Exact-name persistence pattern:** config names are not trimmed before storage once validated (preserve exact value for deterministic lookup) (`arrSync.ts:180`-`arrSync.ts:191`, `arrSyncLidarrConfigPropagation.test.ts:213`-`arrSyncLidarrConfigPropagation.test.ts:236`).
- **Credential handling pattern:** Arr clients must be created via credential query + decrypt path (`arrInstanceClients.ts:54`-`arrInstanceClients.ts:98`), and credential failures may disable instances in sync handler (`arrSync.ts:209`-`arrSync.ts:237`).

## Integration Points

- **Primary startup hook:** add pull-on-startup orchestration in `packages/praxrr-app/src/hooks.server.ts` after job initialization if it enqueues jobs, or before it if it needs immediate in-memory prep only. Existing ordering suggests enqueue-after-`initializeJobs()` is safest for background execution (`hooks.server.ts:130`-`hooks.server.ts:132`).
- **Config surface:** add a typed config/env flag in `packages/praxrr-app/src/lib/server/utils/config/config.ts` (similar style to `validateInstances` at `config.ts:56`-`config.ts:58`).
- **Job registration:** if modeled as a dedicated job, update `queueTypes.ts`, import handler in `jobs/handlers/index.ts`, and register it in handler module via `jobQueueRegistry.register(...)` pattern (`queueTypes.ts:1`, `handlers/index.ts:1`-`handlers/index.ts:7`, `pcdSync.ts:91`).
- **Queue persistence:** use `upsertScheduled`-style dedupe key semantics through queue service to avoid duplicate startup runs across restarts (`jobQueue.ts:79`-`jobQueue.ts:118`).
- **Selection writes:** persist startup-discovered selections through `arrSyncQueries.save*Sync(...)` APIs, never ad-hoc SQL in startup logic (`arr/[id]/sync/+page.server.ts:203`, `arr/[id]/sync/+page.server.ts:242`, `arr/[id]/sync/+page.server.ts:287`, `arrSync.ts:460`, `arrSync.ts:506`, `arrSync.ts:602`, `arrSync.ts:552`).
- **Arr reads + matching:** use `getArrInstanceClient(...)` + entity read modules (`qualityProfiles/list.ts`, `delayProfiles/read.ts`, `mediaManagement/*/read.ts`, `metadataProfiles/read.ts`) to perform deterministic name-based matches per arr type.
- **On-pull relationship:** existing `pcdManager.sync()` already triggers Arr sync fanout on `on_pull` (`manager.ts:240`-`manager.ts:242`); startup pull logic should not duplicate this path unless it intentionally sets selections first, then triggers jobs.

## Code Conventions

- **Structure/naming:** descriptive function names, local helper functions near usage, explicit interfaces/types (`envInstances.ts:21`-`envInstances.ts:55`, `arrSync.ts:16`-`arrSync.ts:70`).
- **Imports:** alias-first imports (`$db`, `$arr`, `$sync`, `$shared`) with relative imports mainly inside module-local folders (`arrSync.ts:1`-`arrSync.ts:12`, `dispatcher.ts:1`-`dispatcher.ts:7`).
- **Error handling:** prefer typed error messages and predictable fallback status objects; log with `source` + metadata (`arrSync.ts:296`-`arrSync.ts:303`, `pcdSync.ts:79`-`pcdSync.ts:87`).
- **Module boundaries:** route actions orchestrate and validate inputs; persistence belongs in query modules; execution belongs in jobs/sync handlers.
- **Testing style:** Deno tests, table-driven/simple case assertions, monkeypatching query functions with restore in `finally`, explicit behavior assertions on status/output (`envInstances.test.ts:65`-`envInstances.test.ts:76`, `lidarrSync.test.ts:148`-`lidarrSync.test.ts:219`).

## Dependencies and Services

- `pcdManager` for database discovery/cache access/sync (`manager.ts:325`-`manager.ts:341`, `manager.ts:453`-`manager.ts:455`).
- `arrInstancesQueries` and `arrInstanceCredentialsQueries` for instance and credential records (`arrSync.ts:276`-`arrSync.ts:283`, `arrInstanceClients.ts:61`-`arrInstanceClients.ts:64`).
- `arrSyncQueries` as canonical sync config/status persistence API (`arrSync.ts:433` onward).
- Arr HTTP clients via `createArrClient`/`BaseArrClient` for remote reads (`arrInstanceClients.ts:91`, `base.ts:68`-`base.ts:90`, `base.ts:253`-`base.ts:357`).
- Job dispatcher + queue/history for async execution and audit (`dispatcher.ts:118`-`dispatcher.ts:157`, `jobQueue.ts`).

## Gotchas and Warnings

- `hooks.server.ts:55` currently trims `PRAXRR_DEFAULT_DB_URL`; shared docs specify empty string should be intentional opt-out. Avoid introducing trim-based semantics for new pull-on-startup flags unless explicitly desired.
- Do not assume metadata profiles apply outside Lidarr; enforce capability and section support checks (`capabilities.ts:135`-`capabilities.ts:140`, `arrSync.ts:198`-`arrSync.ts:201`).
- Preserve exact config/profile names once non-empty; trimming at persistence can break exact-match propagation semantics (`arrSync.ts:189`-`arrSync.ts:191`).
- Startup should remain resilient: prefer warn-and-continue for per-instance pull failures, with aggregate metrics logging (pattern from `reconcileEnvInstances` and startup reconcile logging: `envInstances.ts:287`-`envInstances.ts:457`, `hooks.server.ts:110`-`hooks.server.ts:122`).
- If using job dedupe keys, keep them stable and scoped (`processor.ts:389`, `processor.ts:399`, `processor.ts:409`, `processor.ts:419`).

## Task-Specific Guidance

- Create a focused startup orchestrator module (recommended new file under `packages/praxrr-app/src/lib/server/startup/`), so `hooks.server.ts` only calls one function.
- Add a config boolean like `pullOnStart` in `config.ts`, parsed from env with the same bool grammar used by `validateInstances`.
- For each enabled Arr instance, resolve arr type -> capability support -> remote read -> local match by name -> save via `arrSyncQueries.save*Sync`.
- After persistence, set pending status + enqueue section jobs with dedupe keys instead of calling section sync logic directly.
- Add tests mirroring existing style:
  - unit tests for env/config parsing and matching helpers,
  - query-layer behavior tests for selection validation,
  - startup orchestration tests that assert non-fatal per-instance failures and deterministic queue/persistence outcomes.
