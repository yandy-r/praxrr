# External Research: Canary Remaining-Target Preview Evidence

## Executive Summary

The current Canary coordinator converts every thrown remaining-target preview
error into `[]`. An empty array can therefore mean no eligible targets, no
changes, or unavailable preview generation. The API and UI cannot prove that the
operator reviewed current evidence before promotion.

Model gate evidence as a discriminated union: `available` carries complete
per-instance previews; `unavailable` carries a safe `SyncPreviewFailureReason`
and non-authoritative partial results. Available previews may legitimately
contain zero mutations. Promotion must independently regenerate complete
evidence before advancing state; a browser-provided flag is not evidence. Abort
remains allowed while evidence is unavailable.

This design reuses the existing closed failure vocabulary and safe recovery
copy. It preserves `AbortError`/timeout classification, same-`arr_type` target
filtering, and the current state-token guard. No new dependency is needed.

## Primary APIs/Contracts

The public contract should introduce a named result such as
`CanaryRemainingPreviewEvidence`:

- `{ availability: 'available', previews: GeneratePreviewResult[] }`
- `{ availability: 'unavailable', failure: SyncPreviewFailureReason, partialPreviews: GeneratePreviewResult[] }`

`availability` is required. `failure` exists only for the unavailable branch and
reuses `SyncPreviewFailureReason`. `partialPreviews` preserves successful
evidence from a mixed batch, but is diagnostic only and cannot authorize
promotion.

This maps to OpenAPI `oneOf` with a discriminator. The official
[OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html#discriminator-object)
requires the discriminator property in the payload and explicitly listed
alternatives. Define named schemas, require `availability` in both, and use
`const: available` / `const: unavailable`.

`CanaryStartGated.remainingPreview` should change from a raw array to this
evidence object. Existing `skipped: true` behavior remains untouched. “No
changes” is represented by available preview objects whose summaries have zero
mutations (or by an available empty list only when no targets remain after
authoritative re-filtering). “Unavailable” is never represented by an empty
array.

## Libraries/SDKs

No additional library is warranted. `classifyPreviewFailure(error, arrType)`
already classifies `HttpError` status `0` as `unreachable`, `401`/`403` as
`unauthorized`, `AbortError` and `TimeoutError` as `timeout`, and unknown errors
as `internalError`, without exposing raw exception text.
`buildPreviewFailure('sectionErrors')` supplies safe aggregate copy for mixed or
section-level failures.

The existing generated OpenAPI TypeScript workflow should consume the new named
schemas. Native TypeScript discriminated-union narrowing is sufficient in server
and Svelte code; no runtime union package is required if route responses are
constructed only through coordinator helpers and normal contract validation
remains in place.

## Integration Patterns

1. Keep authoritative target derivation: enabled instances of the rollout’s
   exact `arrType`, intersected with persisted remaining target IDs.
2. Generate previews for the entire filtered cohort. On a thrown batch error,
   return `unavailable` using `classifyPreviewFailure`; never return raw
   exception messages.
3. Treat a top-level failure, failed section, missing target result, or
   incomplete cardinality as unavailable. Preserve results as `partialPreviews`;
   use `sectionErrors` for mixed failures.
4. At the start gate, return the evidence object so the UI renders a distinct
   recovery panel for unavailable evidence and a zero-change state only for
   available evidence.
5. At promotion, re-fetch state and regenerate complete evidence before the
   value-guarded transition. Only `available` may enqueue. Unavailability leaves
   the rollout awaiting confirmation for retry or abort.
6. Re-check state/token after the asynchronous preview call before transition.
   This prevents a concurrent abort or second proceed from being overwritten.

## Constraints/Gotchas

Never infer categories from error messages or expose Arr URLs, keys, response
bodies, or stacks. Keep the typed/status classifier as the thrown-error
boundary.

Partial preview is not available evidence: promotion without every target must
fail closed. Conversely, zero mutations is successful evidence.

Regeneration makes `proceedRollout` asynchronous. Check the token before work
and atomically again when advancing. Remove newly disabled targets, but do not
add newly enabled targets outside the persisted cohort.

Tests should cover unreachable, unauthorized, `AbortError`, mixed results,
missing cardinality, zero changes, no remaining targets, same-Arr filtering, and
proceed/abort races. Assert safe codes/actions and no enqueue on unavailable
evidence.

## Code Example

```ts
export type CanaryRemainingPreviewEvidence =
  | { availability: 'available'; previews: GeneratePreviewResult[] }
  | {
      availability: 'unavailable';
      failure: SyncPreviewFailureReason;
      partialPreviews: GeneratePreviewResult[];
    };

async function requirePromotionEvidence(rollout: CanaryRolloutDetail) {
  const evidence = await buildRemainingPreview(
    rollout.arrType,
    rollout.remainingTargets,
    rollout.sections
  );
  if (evidence.availability === 'unavailable') {
    throw new CanaryPreviewUnavailableError(evidence.failure);
  }
}
```

Translate `CanaryPreviewUnavailableError` to a stable conflict or unprocessable
response carrying only its typed failure. Transition and enqueue only after this
check.

## Open Questions

- Should promotion-time unavailability return HTTP `409` (gate evidence
  currently unavailable) or `422` (promotion precondition unsatisfied)?
  Whichever is chosen should have a named OpenAPI error response.
- Should failures remain in `partialPreviews`, or use a target-indexed failure
  array?
- Is regeneration sufficient, or should an evidence timestamp/hash be persisted
  for auditability?
- When no targets remain after re-filtering, should promotion complete
  immediately or enqueue an empty rollout job? Either behavior must remain
  explicitly `available`, never `unavailable`.

The recommended implementation uses existing preview classification, TypeScript
unions, and OpenAPI composition; no new dependency is required.
