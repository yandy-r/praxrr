# Context Analysis: pull-on-startup

## Executive Summary

`pull-on-startup` is an opt-in, non-blocking bootstrap that reconstructs Arr sync selections from live Arr state after startup, primarily to recover quickly from local resets (`clean:dev`/fresh DB) without manual remapping. The implementation should reuse existing boundaries (startup hook, Arr clients, sync query layer, PCD writer pipeline, jobs/run history) and enforce strict per-`arr_type` semantics. Deterministic matching only (exact-name first, metadata fingerprint second), default exclusion, and skip-on-ambiguity are core safety rules. Best current direction is a queued startup job with structured outcomes and idempotent writes.

## Architecture Context

- Startup lifecycle anchor: `packages/praxrr-app/src/hooks.server.ts` after config/DB/migrations/log settings/PCD init and env-instance reconciliation.
- Existing flow to leverage: Arr instance reconciliation (`envInstances`) -> optional startup pull bootstrap -> normal jobs/sync lifecycle.
- Preferred execution model: enqueue dedicated startup pull job (`arr.pull.startup`) once per process start with dedupe key; preserve non-blocking readiness and reuse jobs observability.
- Pull engine responsibilities: enumerate enabled instances, fetch supported resources by explicit `arr_type`, filter defaults, deterministic match against compiled PCD cache, persist selection updates through query layer and/or entity writers.
- Outcome model: run + per-instance counters (`imported`, `skipped_default`, `skipped_no_match`, `conflicted`, `failed`) with overall `success|partial|failed|skipped|disabled` semantics.

## Critical Files Reference

- `packages/praxrr-app/src/hooks.server.ts`: startup insertion point and ordering guarantees.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: `PULL_ON_START` and tuning env parsing.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: startup reconciliation precedent and warn-and-continue posture.
- `packages/praxrr-app/src/lib/server/jobs/init.ts`, `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`, `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`, `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts`: job registration/execution path.
- `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`: dedupe upsert and run history coupling.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: canonical persistence path for sync selections/status.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`, `packages/praxrr-app/src/lib/server/utils/arr/base.ts`, `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: typed client creation + Arr read surfaces.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`, `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: authoritative Arr capability/dispatch guardrails.
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` and `packages/praxrr-app/src/lib/server/pcd/entities/**`: validated write/compile pipeline and local entity lookup/update points.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`: existing manual selection-save behavior to mirror.

## Patterns to Follow

- Single startup orchestrator in `hooks.server.ts`; explicit order, mixed criticality (hard-fail only for true invariants).
- Long-running bootstrap work as typed job, not inline blocking startup execution.
- Queue dedupe via stable key; one run per boot intent.
- Strict `arr_type` dispatch at every layer; no sibling fallback.
- Persist through existing query/writer APIs only (avoid direct ad-hoc SQL state paths).
- Structured logging with source/meta and secret-safe diagnostics.
- Idempotent compare-before-write semantics to avoid churn on repeated restarts.

## Cross-Cutting Concerns

- **Safety**: additive/update-only in v1; no deletes; skip uncertain/default/ambiguous candidates.
- **Observability**: durable run outcomes in job history (or dedicated startup tables if adopted), actionable per-instance errors.
- **Performance**: bounded concurrency, request/per-instance timeouts, retry with backoff+jitter.
- **Security**: never log API keys/sensitive payload fragments; keep encrypted credential resolution path intact.
- **Product UX**: explicit disabled state, partial-success semantics, concise status badges/history details.
- **Contract fidelity**: keep OpenAPI/runtime validators/handlers aligned if status endpoint is added.

## Parallelization Opportunities

- Track A: config/env wiring (`PULL_ON_START`, optional tuning vars) + startup decision logging.
- Track B: job plumbing (queue type, handler registry, dedupe strategy, run output schema).
- Track C: matcher/default-filter modules split by section family (profile-style vs singleton-config-style).
- Track D: Arr adapter normalization per app (`radarr`, `sonarr`, `lidarr`) implemented independently behind shared handler contract.
- Track E: tests in parallel once contracts settle (unit: matching/defaults/timeouts; integration: startup ordering, partial failures, idempotency).

## Implementation Constraints

- Feature gate default is off; disabled path must be explicit and no-op for writes.
- Non-blocking startup is mandatory even on full/partial pull failure.
- Arr API version split is fixed (`/api/v3` Radarr/Sonarr, `/api/v1` Lidarr).
- Default detection lacks universal `isDefault`; must use explicit per-app/entity policy and conservative skips.
- Cross-Arr semantics differ (quality vocab, naming payload shape, delay-default behavior, Lidarr metadata profiles); no inferred parity.
- Multiple enabled databases require explicit targeting policy (recommended: require explicit DB choice when ambiguous).
- Startup placement conflict exists in planning docs (before vs after jobs init); must choose one canonical order before implementation.
- Release profile pull appears in external contracts but current runtime support is incomplete; keep out of MVP unless explicitly expanded.

## Key Recommendations

- Canonicalize on `PULL_ON_START` (optionally accept `PULL_ON_STARTUP` as temporary alias with deprecation log).
- Adopt queued job execution after `initializeJobs()` for immediate observability and retry primitives; keep startup request path non-blocking.
- Start MVP scope with currently managed sync surfaces only (quality profiles, delay profiles, media management, Lidarr metadata profiles); defer release profiles.
- Enforce deterministic matching order: exact name -> normalized name (non-persistent) -> metadata fingerprint; ambiguity => skip/report.
- Preserve existing trigger/cron/scheduling fields when reconstructing selections; update only selection payloads.
- Emit structured counters and per-instance diagnostics from day one; use these as acceptance signals for idempotency and safety.
- If operational visibility needs outgrow job history, add dedicated `startup_pull_runs` tables as phase-2 enhancement.
