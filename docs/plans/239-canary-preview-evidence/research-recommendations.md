# Recommendations: Canary Remaining-Target Preview Evidence

## Executive Summary

Issue #239 should be implemented as a narrow safety correction to the existing
canary verification gate. Replace the current exception-to-empty-array behavior
with a durable discriminated contract: `available` contains complete per-target
previews; `unavailable` contains typed, safe failure evidence and may retain
clearly non-authoritative partial results. A successful preview with zero
mutations is explicitly available and is the only state that may be described as
“no changes.”

Persist the evidence snapshot on `canary_rollouts` before transitioning to
`awaiting_confirmation`. The start and detail APIs must expose that snapshot
because the UI redirects after start. `proceedRollout()` must validate it
server-side, require exact equality with the rollout’s same-Arr target set, and
refuse promotion when evidence is absent, corrupt, partial, or unavailable. Keep
the state-token guard. Abort remains permitted and must explain that it does not
roll back the canary.

This approach satisfies the issue without changing canary selection, batching,
or cross-Arr semantics and requires no new dependency.

## Implementation Recommendations

### Phase 1: Contract and persistence foundation

Add closed TypeScript types in `sync/canary/types.ts` for versioned
remaining-preview evidence. Use an `availability` discriminator to align with
the issue language:

- `available`: `generatedAt` and complete target previews.
- `unavailable`: `generatedAt`, a safe aggregate `SyncPreviewFailureReason`, and
  optional successful partial previews or target-indexed safe failures.

Add nullable `remaining_preview_evidence TEXT` through the next migration. Null
represents legacy rows or incomplete generation and never authorizes Proceed.
Extend `canaryRollouts.ts` with fail-closed serialization and decoding. Invalid
JSON, version, discriminator, failure code, duplicate IDs, or target cardinality
becomes unavailable, never empty success.

Update OpenAPI schemas and paths, then regenerate portable and application API
types. Reuse the Sync Preview failure schema where possible.

### Phase 2: Coordinator and promotion policy

Refactor `buildRemainingPreview()` to return evidence rather than
`GeneratePreviewResult[]`. Do not silently filter persisted targets. Resolve
each exact target ID against enabled instances and the rollout `arrType`;
missing, disabled, duplicated, or wrong-Arr targets make the aggregate
unavailable. Generate previews independently or otherwise preserve target
identity so one failure does not erase successful diagnostic evidence.

Use `classifyPreviewFailure(error, arrType)` for transport and unexpected
exceptions. Inspect returned section outcomes as well: any section failure makes
the aggregate unavailable with `buildPreviewFailure('sectionErrors', arrType)`.
Never classify from raw messages or persist Arr response bodies, URLs,
credentials, or stacks.

Record canary outcome and remaining evidence before exposing
`awaiting_confirmation`, ideally in one guarded query/transaction. Change
`proceedRollout()` to require `availability === 'available'` and exact
evidence-target equality before its existing token/status guarded update. Return
a stable 409 business conflict for unavailable evidence; preserve 422 for stale
tokens and 409 for wrong lifecycle state. Enqueue only after the guarded
transition succeeds. Keep Abort unchanged except for contract/UI copy.

### Phase 3: API, UI, and verification

Return evidence from both start and detail endpoints. In `/canary/[id]`,
separate confirmed canary execution evidence from planned remaining-target
evidence. Show three unambiguous presentations: complete changes, complete/no
changes, and unavailable with safe recovery guidance. Disable or omit Proceed
for unavailable/null evidence; keep Abort visible. Remove wording that treats
the canary’s Sync History diff as proof of remaining-instance preview
completeness.

Add migration/query, coordinator, route, and detail-page tests, then run the
issue’s targeted tests and `deno task check`.

## Deferred Improvement Ideas

- An explicit “Regenerate preview” action that recomputes the full persisted
  cohort, atomically replaces evidence, and rotates `stateToken`.
- A dedicated `targetChanged` failure code and recovery copy instead of
  conservative `internalError` handling.
- Canary-specific role authorization for deployments where global authenticated
  access is too broad.

These are useful follow-ups but should not delay the core ambiguity fix.

## Risk Assessment

| Risk                                           | Impact                                       | Mitigation                                                                          |
| ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Corrupt or legacy evidence defaults to success | Fleet writes without proof                   | Nullable migration plus strict fail-closed decoder and Proceed validation           |
| Partial section results appear as zero changes | False safe/no-op claim                       | Aggregate section outcomes; any failure yields unavailable                          |
| Target drift silently shrinks the cohort       | Unreviewed or incomplete promotion           | Require exact persisted target IDs and explicit `arrType`; never substitute or drop |
| Raw Arr errors leak secrets                    | Credential/internal detail exposure          | Persist only closed classifier output; sanitize metadata-only logs                  |
| Evidence persistence and status diverge        | Awaiting gate without authoritative evidence | Guarded atomic record/update before `awaiting_confirmation`                         |
| UI-only disabling is bypassed                  | API client can promote                       | Enforce evidence policy inside `proceedRollout()` before enqueue                    |
| Full previews grow the database                | Storage pressure                             | Bounded existing preview payloads now; evaluate retention separately                |

## Alternatives

| Alternative                          | Pros                                                    | Cons                                                                   | Effort      | Recommendation            |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- | ------------------------- |
| Response-only discriminated evidence | Smallest patch                                          | Lost after redirect/refresh; detail and Proceed lack authority         | Low         | Reject                    |
| Regenerate on detail GET             | No stored payload                                       | Network-dependent read, drifting evidence, repeated Arr load           | Medium      | Reject                    |
| Regenerate only during Proceed       | Freshest decision                                       | Operator may proceed on different evidence; async race/load complexity | Medium-high | Defer as defense in depth |
| Persist one authoritative snapshot   | Reloadable, auditable, same evidence shown and enforced | Schema/storage change; requires strict decoder                         | Medium      | Adopt                     |

Persisted evidence directly fixes API ambiguity and the redirect boundary.
Server-side validation makes it authoritative without expanding this issue into
retry orchestration.

## Task Breakdown and Dependencies

1. Define evidence types and safe constructors using existing
   `SyncPreviewFailureReason`.
2. Add/register migration and strict query serialization/parsing; depends on
   task 1.
3. Refactor coordinator generation and atomic persistence; depends on tasks 1–2.
4. Add fail-closed Proceed error and route mapping; depends on task 3.
5. Update OpenAPI source and generate portable/runtime types; depends on the
   settled contract.
6. Update detail loader/UI and start response handling; depends on tasks 3
   and 5.
7. Add migration/query tests, then coordinator
   unavailable/partial/zero-change/exact-target tests, route tests, and UI
   assertions; depends on all implementation tasks.
8. Run focused canary tests and type checks; update the graph after code changes
   per repository policy.

Dependencies #19 and #21 already provide the canary state machine and
transparency initiative. Issue #218’s typed preview failure classifier should be
reused, not duplicated.

## Key Decisions

- Persist versioned evidence; do not rely on the initial POST payload.
- Available means every exact persisted same-Arr target succeeded, even if all
  mutation counts are zero.
- Partial evidence is diagnostic only and never promotable.
- Missing/corrupt/legacy evidence fails closed.
- Proceed checks evidence server-side and preserves status/token guards; Abort
  remains available.
- Reuse closed safe failure reasons; no raw error transport or new library.
- Keep retry, freshness regeneration, selection, batching, and authorization
  redesign out of scope.

## Open Questions

1. Should unavailable evidence store one aggregate reason plus partial previews,
   or target-indexed failures? Target-indexed failures are more actionable and
   are preferred if the existing result shape makes them inexpensive.
2. Should legacy `awaiting_confirmation` rows display “unavailable—abort and
   restart,” or be migrated directly to aborted? Prefer display-and-abort to
   avoid rewriting historical lifecycle facts.
3. Should target drift use `internalError` for this issue or add `targetChanged`
   now? Use the existing closed vocabulary unless product copy cannot provide a
   credible recovery action.
