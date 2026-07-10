# Analysis Context: Canary Remaining-Target Preview Evidence

## Executive Summary

Issue #239 closes a fail-open transparency gap in Canary rollout promotion.
Today, `buildRemainingPreview()` catches preview errors and returns `[]`, so a
complete zero-change preview is indistinguishable from unavailable evidence. The
initial array is also transient: `/canary/+page.svelte` redirects to
`/canary/{id}`, where the detail page reads the rollout and linked canary Sync
History record but cannot reload the remaining-target preview.

Implement one versioned, persisted `available`/`unavailable` evidence snapshot
on `canary_rollouts`. Available means complete previews for exactly every
persisted same-Arr remaining target, with no target or section failure; zero
mutations remain valid available evidence. Unavailable carries only a closed
safe `SyncPreviewFailureReason` plus optional diagnostic partial previews. Start
and detail APIs expose the same snapshot. Proceed re-reads it server-side and
enqueues only after available/exact evidence and the existing status/token guard
both pass. Abort remains allowed and does not roll back the canary.

Do not change canary selection, batching, Sync History, rollout job execution,
settings, or cross-Arr policy. Add no dependency.

## Architecture Context

Canary is a two-phase state machine owned by
`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`:

```text
startRollout
  -> resolve exact arrType cohort
  -> insert canary_running row with remainingTargets
  -> execute and classify canary
  -> abort terminally, or build/persist remainingPreview evidence
  -> awaiting_confirmation

proceedRollout
  -> require awaiting_confirmation
  -> require available evidence matching remainingTargets
  -> status + stateToken guarded update
  -> enqueue sync.canary.rollout

abortRollout
  -> status + stateToken guarded abort
```

Confirmed canary execution remains a separate evidence domain linked through
`canary_sync_history_id`. The new snapshot is planned, read-only evidence for
remaining targets. Never use the canary’s recorded changes as proof that
remaining instances were successfully previewed.

Persist `remaining_preview_evidence TEXT NULL` through a new dated migration,
expected `20260722_add_canary_preview_evidence.ts`. Null supports
legacy/in-progress rows but is never promotable. Persist evidence in the same
guarded `canary_running` outcome transition that sets `awaiting_confirmation`;
avoid a crash window with gate status but no evidence.

## Critical Files Reference

| File                                                                                       | Planned responsibility                                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/sync/canary/types.ts`                                  | Define versioned discriminated evidence and extend raw row, detail, and gated-start types           |
| `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`                            | Replace catch-to-empty with evidence construction; enforce exact-target availability before Proceed |
| `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`                                 | Add a typed preview-unavailable coordinator error/predicate if needed for route mapping             |
| `packages/praxrr-app/src/lib/server/sync/canary/selection.ts`                              | Preserve existing initial same-Arr cohort resolution; no policy change                              |
| `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                          | Existing `GeneratePreviewResult` and per-section failure source; normally unchanged                 |
| `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`                         | Reuse `classifyPreviewFailure()` and `buildPreviewFailure('sectionErrors')`; do not duplicate copy  |
| `packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts` | Add nullable JSON-text column                                                                       |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                      | Register migration after 20260721                                                                   |
| `packages/praxrr-app/src/lib/server/db/schema.sql`                                         | Keep reference application schema in parity                                                         |
| `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`                          | Strict decode, row/detail projection, atomic evidence/outcome persistence, authorizing validation   |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`                         | Return persisted evidence in gated start arm; list summaries remain light                           |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/+server.ts`                    | Expose reloadable detail evidence                                                                   |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`            | Map unavailable evidence to safe 409; preserve 422 stale-token behavior                             |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/abort/+server.ts`              | Preserve abort semantics; likely no logic change                                                    |
| `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`                                  | Separate actual canary diagnostics from planned evidence; render three states and gate actions      |
| `docs/api/v1/schemas/canary.yaml`, `docs/api/v1/paths/canary.yaml`                         | Source portable discriminator and endpoint semantics                                                |
| `packages/praxrr-api/openapi.json`, `packages/praxrr-app/src/lib/api/v1.d.ts`              | Regenerated artifacts, never primary edit sources                                                   |
| `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`, `canaryQueries.test.ts`        | Migration, round-trip, malformed/null, and guard behavior                                           |
| `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`                             | Unreachable, unauthorized, partial, zero-change, exact-target, proceed/abort policy                 |
| `packages/praxrr-app/src/tests/routes/canary.test.ts`                                      | API shapes/statuses, no enqueue, and detail UI source behavior                                      |

## Patterns to Follow

- Keep selection in `selection.ts`, policy/orchestration in `coordinator.ts`,
  persistence in `canaryRollouts.ts`, and HTTP translation in SvelteKit routes.
- Model evidence as a closed TypeScript union with `version: 1` and
  `availability: 'available' | 'unavailable'`; mirror it with OpenAPI `oneOf`
  and required constant discriminator values.
- Reuse `SyncPreviewFailureReason` from
  `packages/praxrr-app/src/lib/server/sync/preview/types.ts`. Classify thrown
  errors only by type/status in `failureReason.ts`; never inspect or transport
  raw messages.
- Inspect every `GeneratePreviewResult.sectionOutcomes` entry. Any
  `failure !== null` makes aggregate evidence unavailable with `sectionErrors`.
- Follow existing status/token value-guarded SQL updates. Enqueue only after the
  guarded transition succeeds.
- Use a dedicated strict evidence decoder. Do not reuse `parseJsonArray()`
  because its malformed-to-`[]` fallback is unsuitable for authorizing evidence.
- Follow contract-first generation: edit source YAML, validate/generate types
  and bundled OpenAPI, then update runtime consumers.
- Use Svelte 5 without runes: exported page data, `$:` derived state, native
  `disabled`, visible recovery text, and existing alert/modal components.

## Cross-Cutting Concerns

**Security:** Database/API/UI evidence may contain only closed
`{ code, message, recoveryAction }` copy. Keep URLs, API keys, response bodies,
raw errors, and stacks out of persisted JSON and responses. Log raw errors only
through sanitized metadata.

**Exact Arr scope:** Evidence IDs must equal persisted `remainingTargets`
exactly, with no duplicates, extras, missing targets, silent disabling/deletion
filters, substitution, or sibling fallback. Explicitly validate each live
instance still resolves to `rollout.arrType`.

**Lifecycle consistency:** Null/corrupt/unsupported evidence is unavailable.
Wrong state remains 409, stale token remains 422, unavailable evidence uses a
safe 409, and no failed check may enqueue. Abort works from any awaiting gate
regardless of evidence.

**UX/accessibility:** Show available-with-changes, available-with-no-changes,
and unavailable as distinct text states. Unavailable includes safe recovery
guidance, disabled Proceed with explanatory text/`aria-describedby`, and enabled
Abort with the existing no-rollback warning.

**Contract fidelity:** Runtime types, strict decoder, OpenAPI source, generated
artifacts, and route responses must agree. List summaries should not gain heavy
evidence blobs.

## Parallelization Opportunities

After agreeing on the exact evidence union, the work can run in dependency-aware
batches:

1. **Foundation:** Type contract, migration/reference schema, and OpenAPI source
   can proceed in parallel, coordinated on field names and null/legacy
   semantics.
2. **Persistence/policy:** Query decoder/write changes depend on the type
   contract. Coordinator evidence building can begin against the contract but
   final integration depends on the query write surface.
3. **Surface:** API route mapping and detail UI can proceed in parallel once
   coordinator/detail DTOs stabilize. Generated API artifacts follow completed
   YAML.
4. **Tests:** Migration/query tests can run alongside coordinator tests;
   route/UI tests follow stable runtime/API shapes. Final type generation/check
   and focused suite run after merging all streams.

Avoid parallel edits to `types.ts`, `coordinator.ts`, or `canaryRollouts.ts` by
multiple implementors; they are the high-conflict contract spine.

## Implementation Constraints

- Scope is issue #239 only: no in-place retry, preview freshness/expiry, role
  redesign, selection changes, batching changes, or promotion-time regeneration.
- The gated start arm should expose evidence through the persisted rollout
  detail; remove the separate transient raw array. The single-target
  `skipped: true` arm is unchanged.
- Available requires exact target cardinality/identity and clean sections. Empty
  mutation lists are valid only after those checks.
- Legacy rows retain historical state; expose null evidence as safe unavailable
  and allow Abort rather than rewriting lifecycle history.
- Existing canary failure/partial-abort paths stop before remaining preview
  generation and remain terminal.
- Keep generated artifacts and `ROADMAP.md` updates until
  implementation/contract work is complete. Mark #239 shipped only in the
  resulting PR.
- Required validation includes focused coordinator and route tests plus
  `deno task check`; persistence adds focused migration/query tests and API
  generation validation.

## Key Recommendations

1. Freeze one evidence shape before implementation:
   `{ version, availability, generatedAt, previews }` or unavailable
   `{ version, availability, generatedAt, failure, partialPreviews }`.
2. Persist the snapshot atomically with the gate decision; this is the evidence
   the operator sees and Proceed evaluates.
3. Put strict target/content validation in one feature-local helper used by
   query decoding and Proceed policy, without broadening generic preview
   modules.
4. Fail closed on every ambiguous condition and preserve existing token/status
   guards as independent requirements.
5. Keep successful partial previews diagnostic only; never let them upgrade
   aggregate availability.
6. Reuse the existing failure classifier and secret-nonleak test patterns from
   `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`.
7. Keep confirmed canary Sync History and planned remaining evidence visually
   and structurally separate.
8. Test the negative authorization path first: unreachable, unauthorized,
   partial section, malformed/null evidence, missing/wrong-Arr targets, stale
   token, no enqueue, and retained Abort; then prove complete zero-change
   evidence remains promotable.
