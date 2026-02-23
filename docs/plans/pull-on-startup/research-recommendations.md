# Recommendations: pull-on-startup

## Executive Summary

Implement `PULL_ON_START` as a non-blocking startup bootstrap that enqueues a dedicated background job after core startup initialization, then reconstructs Arr sync selections by matching Arr live state to PCD entities using exact-name-first and metadata fingerprints as fallback. This approach aligns with existing Praxrr startup and jobs architecture, minimizes boot risk, and directly targets the post-`deno task clean:dev` reset burden without introducing destructive behavior.

Recommended default behavior:

- feature off by default (`PULL_ON_START=false`)
- when enabled, run once per process start (idempotent reconciliation)
- skip known Arr defaults and only persist confident matches
- preserve existing trigger/cron values when updating `arr_sync_*` config
- continue on per-instance failures and report partial success

## Implementation Recommendations

### 1) Recommended strategy and phased rollout

### Phase 1: Safe startup bootstrap (MVP)

- Add env flag parsing in config (`$config`) with boolean normalization (`true/false/1/0/on/off`) and default `false`.
- Add startup orchestration in `packages/praxrr-app/src/hooks.server.ts` after `initializeJobs()` so the work is visible in jobs/history immediately.
- Enqueue a dedicated one-shot job type (recommended: `arr.pull.startup`) with dedupe key (e.g. `arr.pull.startup:boot`) to avoid duplicate queueing during quick restarts.
- Implement a startup-pull service that:
  - iterates enabled Arr instances
  - loads current Arr state via existing typed clients
  - reconstructs sync config selections in `arr_sync_*` tables by matching against current PCD caches
  - records per-instance/per-section outcomes (matched, skipped_default, skipped_no_match, ambiguous, failed)
- Non-blocking by design: startup pull failures are logged and job-marked failed/partial without breaking app readiness.

### Phase 2: Matching quality and policy hardening

- Introduce deterministic matching policy order:
  1. exact name match (case-sensitive preserved values)
  2. normalized name match (case-insensitive, no trim persistence changes)
  3. metadata fingerprint match (for singleton configs like naming/media settings/quality definitions)
- Add explicit default-skip policy tables by Arr type (no inferred cross-Arr shortcuts).
- Add ambiguity guardrails: if multiple candidates match same fingerprint/name, skip + report instead of auto-select.

### Phase 3: Operator visibility and ergonomics

- Add structured startup pull result summary to jobs output and startup logs (`source: 'Setup'` + job details).
- Add retry affordances (`retry failed instances`) and optional one-shot manual trigger.
- Add run history surface (optional table) if operators need long-term audit beyond job retention.

### 2) Technology and architecture choices mapped to conventions

- **Startup orchestration**: keep sequencing in `packages/praxrr-app/src/hooks.server.ts`; follow existing non-fatal setup blocks.
- **Background execution**: reuse job queue/dispatcher (`packages/praxrr-app/src/lib/server/jobs/*`) rather than inline long-running startup work.
- **Arr access layer**: use existing typed clients/factory in `packages/praxrr-app/src/lib/server/utils/arr/*` to preserve Arr-specific semantics.
- **Persistence**: use existing sync query layer (`packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`) for writes and normalization rules.
- **PCD lookup source of truth**: use existing cache + entity readers in `packages/praxrr-app/src/lib/server/pcd/entities/**/read.ts`.
- **Cross-Arr safety**: enforce explicit `arr_type` dispatch and per-app default lists/fingerprints per AGENTS guardrails.

Recommended matching model by section:

- **Quality profiles / delay profiles / metadata profiles**: name-first matching from Arr resources to PCD entity names.
- **Naming / media settings / quality definitions**: metadata/fingerprint matching because Arr exposes active singleton config while PCD stores named presets.
- **Defaults**: skip if resource/config matches known app default fingerprints or default-name lists.

## Improvement Ideas

Quick wins:

- Add `PULL_ON_START` parsing and no-op logging path first (clear disabled/enabled status).
- Implement job queue integration before matching complexity so operators see execution state immediately.
- Start with exact-name matching for profile-based sections; defer fuzzy fallback to phase 2.
- Emit structured counters from day one (`matched`, `skipped_default`, `skipped_no_match`, `ambiguous`, `failed`).

Future enhancements:

- Persist startup-pull history table with run metadata and searchable errors.
- Configurable per-instance startup pull scope (e.g., only media management).
- Optional strict mode (`fail section on ambiguity`) for CI-like environments.
- Drift scoring to suggest best candidate when no exact match is found.

## Risk Assessment

| Category    | Risk                                                                         | Likelihood | Impact | Mitigation                                                                                 |
| ----------- | ---------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------ |
| Technical   | Wrong config selected due to weak matching                                   | Medium     | High   | Deterministic priority order, ambiguity skip, exhaustive fixture tests per section         |
| Technical   | Cross-Arr semantic drift (Radarr logic reused for Sonarr/Lidarr incorrectly) | Medium     | High   | Separate per-`arr_type` matchers and default catalogs; explicit dispatch only              |
| Integration | Startup sequence contention with job init/PCD cache readiness                | Low        | Medium | Enqueue only after `initializeJobs()` and after `pcdManager.initialize()` completes        |
| Integration | Overwriting intentional manual sync choices                                  | Medium     | Medium | Preserve existing trigger/cron; only update selections with confident matches; add opt-out |
| Performance | Slow startup or API fan-out on many instances                                | Medium     | Medium | Run asynchronously in job queue; per-instance timeout; bounded concurrency                 |
| Performance | High DB write churn on every restart                                         | Low        | Medium | Idempotent compare-before-write; skip unchanged rows                                       |
| Security    | Credential leakage in logs/errors                                            | Low        | High   | Reuse encrypted credential flow; never log API keys/tokens; redact remote payload errors   |
| Security    | Unexpected destructive state change on bad matching                          | Low        | High   | No deletes; skip on uncertainty; additive/update-only behavior in v1                       |

## Alternative Approaches

### Alternative A: Inline startup execution (no job)

- **How it works**: run startup pull directly inside `hooks.server.ts` before server ready log.
- **Pros**: fewer moving parts, simpler initial implementation.
- **Cons**: increases boot-path risk, weaker observability, harder retries, poorer UX for long pulls.
- **Verdict**: not recommended; conflicts with non-blocking UX and existing jobs architecture.

### Alternative B: Trigger standard `arr.sync.*` jobs only (no matching reconstruction)

- **How it works**: mark sync statuses pending and execute sync without rebuilding selections.
- **Pros**: uses existing pipeline, minimal new code.
- **Cons**: does not solve reset burden after DB clean because selections may still be empty/missing.
- **Verdict**: insufficient for feature goal.

### Alternative C: Store startup snapshots and replay selections from snapshot

- **How it works**: persist Arr snapshot on first successful run, re-apply later.
- **Pros**: deterministic replay, less dependency on live Arr API shape changes.
- **Cons**: introduces new storage/retention model and stale snapshot risk.
- **Verdict**: viable future enhancement, too heavy for MVP.

## Task Breakdown Preview

1. Config + startup toggle wiring

- Add `PULL_ON_START` config parsing and typed accessor.
- Add startup decision block and queue enqueue in `hooks.server.ts`.
- Parallelizable with task 2.

2. Job framework integration

- Add new job type (`arr.pull.startup`) to queue types, display labels, registry, and handler index.
- Add dedupe strategy and structured result payload.
- Parallelizable with task 1.

3. Startup pull core service

- Implement per-instance orchestrator with bounded concurrency and timeouts.
- Fetch Arr state via typed clients.
- Build section matchers (profiles by name, singleton configs by metadata fingerprint).
- Depends on tasks 1-2.

4. Persistence and idempotency

- Apply matches through `arrSyncQueries.save*` preserving trigger/cron semantics.
- Add compare-before-write to avoid churn.
- Depends on task 3.

5. Defaults/ambiguity policy

- Add per-Arr default catalogs and ambiguity handling (`skip + report`).
- Depends on task 3; can be partially parallel with task 4.

6. Testing

- Unit tests for matchers/default-skip/ambiguity behavior.
- Integration tests for startup queueing and end-to-end partial success.
- Can run in parallel with tasks 4-5 once scaffolding exists.

7. UX/status polish

- Add clear logs and job output summaries.
- Optional UI badge/last-run status follow-up.
- Depends on task 2 and stable result schema.

Parallelization opportunities:

- (1) Config wiring and (2) job plumbing can run in parallel.
- Matcher implementation can split by section owner (profiles vs singleton configs).
- Tests can be split by layer (unit matcher tests vs startup integration tests).

## Key Decisions Needed

1. Env var name: `PULL_ON_START` vs `PULL_ON_STARTUP`

- Recommended default: **`PULL_ON_START`** (matches feature requirement) and support `PULL_ON_STARTUP` as temporary alias with deprecation warning.

2. Startup execution mode

- Options: inline vs queued job.
- Recommended default: **queued job** after `initializeJobs()`.

3. Conflict/ambiguity behavior

- Options: auto-pick best candidate vs skip + report.
- Recommended default: **skip + report** in v1.

4. Default-skip strictness

- Options: global heuristic vs explicit per-Arr catalogs.
- Recommended default: **explicit per-Arr default catalogs** to satisfy cross-Arr guardrails.

5. Scope for v1

- Options: all sections vs profiles-only first.
- Recommended default: **all sections**, but allow partial success and section-level skip.

6. Existing sync config overwrite policy

- Options: replace always vs merge/preserve trigger/cron.
- Recommended default: **update selections only, preserve trigger/cron and existing schedules**.

## Open Questions

- What is the canonical default detector for each section per Arr app (IDs, names, or full config fingerprints)?
- Should startup pull run for disabled Arr instances that are env-managed but temporarily unreachable?
- Do we want one global startup-pull job or one child job per instance for finer retry UX?
- Should v1 write a persistent startup-pull history table, or rely on job history only?
- Should startup pull run on every startup or only when `clean:dev`-like fresh-state signals are detected?
