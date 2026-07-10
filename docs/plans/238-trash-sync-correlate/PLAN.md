# Plan — #238 TRaSH Sync correlate manual runs (verified)

Ordered, dependency-aware. Verifier verdict: ready-with-fixes. Corrections folded in:

- **C1 (TT4→whole file)**: `tests/jobs/trashGuideSyncJob.test.ts` (1301 lines) pins the OLD
  output/error contract in ~23 handler assertions incl. raw-error passthrough (L664/709/752). ALL
  migrate to versioned-evidence shape; the raw-error asserts become safe-copy asserts.
- **C2 (no type shadow)**: `TrashGuideSyncTrigger` already exists (5-member union). Keep the payload's
  inline `trigger: 'manual' | 'scheduled'`; do NOT add a new same-named type.
- **C3 (no fn shadow)**: `parseTrashGuideSourceArrType` already exists (throws). Add ONE DRY
  `coerceTrashGuideSourceArrType(value: unknown): TrashGuideSupportedArrType | null` in
  `lib/shared/trashguide/types.ts` (reuses `isTrashGuideSupportedArrType`); use it everywhere.
- **C4 (parsePayload)**: extend `parsePayload` to thread `runToken`, `sourceName`, `sourceArrType`.
- **C5 (AC3 test)**: explicit assertion that a failed run surfaces safe `failure.message`+`recoveryAction`
  and (retryable) the Retry affordance.

## Tasks (execution order)

1. **T1 types** — `queueTypes.ts`: extend `TrashGuideSyncJobPayload` (+`sourceName?`, `sourceArrType?:
   TrashGuideSupportedArrType`, `runToken?`); add `TrashGuideSyncFailureCode`,
   `TrashGuideSyncFailureReason`, `TrashGuideSyncCounts`, `TrashGuideSyncRunEvidence` (status:
   JobRunStatus), `TrashGuideSyncStatusView`. Add `coerceTrashGuideSourceArrType` to shared types.
2. **T3 classifier** — new `lib/server/jobs/trashguide/syncFailure.ts`: `FAILURE_COPY`,
   `buildTrashGuideSyncFailure`, `isRetryableFailureCode`. Safe copy only.
3. **T4 queue helper** — `trashGuideSyncQueue.ts`: `enqueueTrashGuideSourceSync({sourceId,trigger,runAt?})`
   (runToken coalescing: running→dedupe+return token; queued→reuse token; else mint uuid; snapshot
   name/arrType), `enqueueManualTrashGuideSourceSync` delegates (manual), `getTrashGuideSyncStatus`
   (single source of truth) + `parseTrashGuideSyncRunEvidence`. Replace old metadata shapes with view.
4. **T5 scheduler** — `trashGuideSchedule.ts`: use shared builder (trigger scheduled, pass catch-up runAt),
   drop duplicated dedupe helper.
5. **T6 handler** — `handlers/trashGuideSync.ts`: total try/catch; `buildRunEvidence`+`finalize`; per-branch
   mapping; safe `error`; extend `parsePayload`; keep transient boolean internal (scheduled retry only).
6. **T7 display** — `display.ts`: `formatJobTypeLabel` `'TRaSH Sync'`; `buildJobDisplayName` trash case
   (live name → snapshot → `#id`).
7. **T8 route** — `sources/[id]/sync/+server.ts`: POST new 200/409 shape + `statusUrl`; new GET resolver.
8. **T2 contract** — `schemas/trash-guide.yaml` + `paths/trash-guide.yaml` + 2 openapi.yaml insertion
   points; `deno task bundle:api`; `prettier --write` openapi.json; hand-graft v1.d.ts new schemas only.
9. **T9 ui (arr)** — `arr/[id]/sync/+page.server.ts` action returns `view`; `TrashGuideSources.svelte`
   source-labeled status + link.
10. **T10 ui (trash)** — `databases/trash/[id]/+page.svelte`: inline run panel + runToken polling + Retry.
11. **Tests** — TT1 `trashGuideSyncFailure.test.ts`(new); TT2 `trashGuideSyncHandler.test.ts`;
    TT3 `trashGuideSyncQueue.test.ts`; TT4 `trashGuideSyncJob.test.ts`(ALL handler asserts, C1);
    TT5 `trashGuideSources.test.ts`; TT6 `trashGuideDisplayName.test.ts`(new); TT7
    `trashGuideSyncUxFlows.test.ts` (AC1/2/3/4/5 incl. C5).
12. **TDOC** — `ROADMAP.md`.

## Gates

`deno task check` after each server layer; `deno task test jobs` + targeted; full `deno task test` +
`deno task lint` before PR. `deno task check` excludes routes → run `deno test tests/routes` to type-check them.
