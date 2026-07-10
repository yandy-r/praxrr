# Engineering Practices: Canary Remaining-Preview Evidence

## Executive Summary

Issue #239 should be a narrow contract-hardening change. Today
`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts` converts every
exception from `buildRemainingPreview()` to `[]`; that makes an unreachable or
unauthorized Arr indistinguishable from a successful preview with no changes.
Replace the array with one canary-specific discriminated value, persist that
value on `canary_rollouts`, and return the same shape from start and detail
APIs. Reuse `SyncPreviewFailureReason`, `classifyPreviewFailure()`, and
`buildPreviewFailure()` from `lib/server/sync/preview/{types,failureReason}.ts`;
these already guarantee closed codes and pre-authored copy without raw exception
leakage.

The server must remain authoritative: `proceedRollout()` must reject unavailable
evidence even when the caller supplies a valid `stateToken`. The detail page
should disable/hide only Proceed, show the safe reason and recovery action, and
retain Abort with the existing no-rollback warning. No selection, batching, or
cross-Arr behavior should change.

## Existing Reusable Code

| Existing seam                                                                      | Reuse                                                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `preview/failureReason.ts`: `classifyPreviewFailure()` and `buildPreviewFailure()` | Classify thrown transport failures and partial section failures without parsing or returning raw messages. |
| `preview/orchestrator.ts`: `GeneratePreviewResult.sectionOutcomes`                 | Detect a partial preview by checking any `outcome.failure !== null`; classify it as `sectionErrors`.       |
| `canary/selection.ts`: `resolveCanary()` / `resolveSyncArrType()`                  | Preserve the explicit same-`arr_type` cohort and the pre-preview enabled-instance recheck.                 |
| `db/queries/canaryRollouts.ts`: `rowToDetail()`, `recordCanaryOutcome()`           | Decode the persisted JSON contract and write it with the canary gate decision.                             |
| `canary/coordinator.ts`: `proceedRollout()` / `abortRollout()`                     | Add the availability guard before `markRollingOut()`; leave abort and token guards unchanged.              |
| `tests/base/syncPreviewRouteHardening.test.ts`                                     | Mirror its `HttpError(0/401)` safe-classification and secret-nonleak assertions.                           |

## Modularity Design

Keep the discriminant in `lib/server/sync/canary/types.ts`, because availability
is a canary gate policy, not a generic preview lifecycle state. A minimal
interface is:

```ts
type CanaryRemainingPreview =
  | { available: true; previews: GeneratePreviewResult[] }
  | { available: false; reason: SyncPreviewFailureReason };
```

`coordinator.ts` alone should build/classify it. `canaryRollouts.ts` should
serialize and parse it, returning it on `CanaryRolloutDetail`. The POST start
response may retain its current `remainingPreview` field but change that field
from array to the discriminant; GET detail must also expose the persisted value
so page reloads do not lose the evidence. Update
`docs/api/v1/schemas/canary.yaml`, the OpenAPI component references, and
generated `packages/praxrr-api/{openapi.json,types.ts}` together.

## Shared vs Feature-Specific

Share failure vocabulary and classification only. Do not add canary codes for
unreachable, unauthorized, or section errors: `SyncPreviewFailureCode` already
models them. Keep the wrapper, persistence, proceed policy, and UI wording
canary-specific. The UI can append fixed lifecycle guidance (“abort, correct the
issue, and start a new rollout”) while displaying the shared safe `message` and
`recoveryAction`; raw caught errors remain logger-only.

## KISS

Add one feature-specific JSON column through the next migration registered in
`lib/server/db/migrations.ts`; avoid a new table or generalized evidence
framework. Treat absent, legacy, or malformed JSON as unavailable with
`buildPreviewFailure('internalError', arrType)`. That conservative parser is
intentionally different from `parseJsonArray()`, whose empty-array fallback
would recreate the ambiguity. Persist the evidence in the same guarded
`recordCanaryOutcome()` update as `awaiting_confirmation`; do not expose the
gate first and patch evidence afterward.

## Abstraction vs Repetition

Use a small pure helper to convert returned previews into available/unavailable
evidence. It should mark any failed `sectionOutcome` as unavailable with
`sectionErrors`; a partially successful fleet must not authorize rollout. Keep a
single catch around `generateInstancePreviews()` and classify it with the known
rollout `arrType`. Do not refactor the broader preview processor or canary state
machine for this issue.

## Interfaces

`CanaryRolloutRow` gains the JSON column and `CanaryRolloutDetail` gains the
parsed discriminant. `RecordCanaryOutcomeInput` carries it so persistence is
atomic. `proceedRollout()` checks `rollout.remainingPreview.available` before
calling `markRollingOut()` and raises the existing `CanaryStateError`,
preserving the route's established 409 handling. Abort remains valid whenever
status is `awaiting_confirmation`.

## Testability

Give the preview builder one optional function parameter defaulting to
`generateInstancePreviews`; tests can inject rejection with `HttpError(0, ...)`,
rejection with `HttpError(401, ...)`, and a returned `GeneratePreviewResult`
containing a failed section. Extend `canaryCoordinator.test.ts` to assert safe
codes, persistence, same-Arr target IDs, and failed proceed; extend
`canaryQueries.test.ts` and `canaryMigration.test.ts` for round-trip/backfill;
extend `routes/canary.test.ts` for POST/GET shapes, 409 proceed, and successful
abort. A lightweight source assertion for `canary/[id]/+page.svelte`, plus
`deno task check`, can cover the UI branch.

## Build vs Depend

Build only the small discriminant and migration. Add no package: SQLite JSON
text, existing HTTP errors, existing safe classifiers, Svelte controls, and
generated OpenAPI types cover the work.

## Open Questions

- Should a remaining target disabled between selection and preview be `notFound`
  or `internalError`? Either must be unavailable, not an available empty
  preview.
- Should terminal historical rows be backfilled unavailable, or only legacy
  `awaiting_confirmation` rows? Proceed safety requires at least the latter.
