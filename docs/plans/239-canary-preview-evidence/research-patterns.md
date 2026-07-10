# Patterns Research: Canary Remaining-Target Preview Evidence

## Architectural Patterns

The Canary implementation is already layered around a narrow coordinator
boundary. Selection is pure and exact-Arr-scoped in
`packages/praxrr-app/src/lib/server/sync/canary/selection.ts`; lifecycle policy
and job enqueueing live in
`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`; SQL
serialization and value-guarded transitions live in
`packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`; HTTP handlers
translate typed domain failures in
`packages/praxrr-app/src/routes/api/v1/canary/rollouts/**`; and the
server-loaded detail surface is
`packages/praxrr-app/src/routes/canary/[id]/+page.server.ts` plus
`+page.svelte`. Remaining-preview evidence should stay within these boundaries
rather than introduce a parallel service.

The source of truth should be the rollout row. The current start response
returns a transient `remainingPreview`, while the browser immediately navigates
away and the detail load only reads the rollout and linked canary Sync History.
Persisting the versioned evidence on `canary_rollouts` lets start, detail API,
Svelte load, and Proceed all observe the same snapshot. Add the evidence to the
same guarded `recordCanaryOutcome` update that records status and rotates
`state_token`; this follows the repository's statement-atomic/value-guarded
transition model and avoids an `awaiting_confirmation` row without corresponding
evidence.

Keep confirmed and planned evidence separate. `sync_history` remains the actual
canary execution record; the new union is the planned evidence for exact
remaining targets. The available branch is valid only when preview IDs form a
one-to-one set with persisted `remainingTargets`, every preview has the rollout
`arrType`, there are no duplicates/extras, and every `sectionOutcomes[].failure`
is null. This extends the explicit cohort logic in `selection.ts`; it must never
silently re-filter, substitute, or infer a sibling Arr target.

Types belong beside the existing rollout contracts in
`packages/praxrr-app/src/lib/server/sync/canary/types.ts`. Use a `version: 1`
plus `availability: 'available' | 'unavailable'` discriminated union, while
reusing `SyncPreviewFailureReason` and `GeneratePreviewResult`. Keep the OpenAPI
source in `docs/api/v1/schemas/canary.yaml` and `docs/api/v1/paths/canary.yaml`
aligned before regenerating `packages/praxrr-app/src/lib/api/v1.d.ts` and the
`packages/praxrr-api` artifacts.

## Code Conventions

- Use the established aliases (`$sync`, `$db`, `$logger`, `$ui`) and keep row
  shapes snake_case and DTOs camelCase, as in `canary/types.ts` and
  `canaryRollouts.ts`.
- Prefer named domain helpers with narrow inputs: for example,
  `buildRemainingPreviewEvidence`, `decodeRemainingPreviewEvidence`, and
  `hasCompleteRemainingPreviewEvidence`. Keep decoding pure so query and
  coordinator tests can exercise it without HTTP or jobs.
- Narrow `unknown` structurally. Do not treat
  `as CanaryRemainingPreviewEvidence` as validation. Check plain object shape,
  exact version/discriminator, timestamp, arrays, closed failure code, non-empty
  safe copy, preview identity, Arr type, summary values, and section outcomes.
- Use exhaustive discriminator switches. An unknown version or availability
  value takes the unavailable branch; it never defaults to available.
- Preserve the existing no-runes Svelte style in
  `routes/canary/[id]/+page.svelte`: exported `data`, reactive `$:` derivations,
  native event handlers, `Badge`, `Modal`, and `alertStore`. Render actual
  canary diagnostics separately from planned remaining evidence.
- Keep SQL mutation return values boolean (`db.execute(...) > 0`) and retain
  both lifecycle status and token predicates. Evidence validation supplements,
  rather than replaces, the final atomic token guard.

## Error Handling

Strict parsing is a hard boundary for this feature. The existing
`parseJsonArray` in `canaryRollouts.ts` intentionally maps malformed/non-array
JSON to `[]`; that is acceptable for non-authorizing display blobs but unsafe
for gate evidence. A closer pattern is `parseJsonArrayEvidence` in
`packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`, which
returns values plus an explicit `valid` bit. Snapshot restoration likewise maps
absent/malformed manifests to `null` in
`packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts`, allowing the
caller to refuse restore. The new decoder should return a safe unavailable read
model for null, invalid JSON, unsupported version, malformed failure, partial
preview, or target mismatch. It must never throw on detail reads and never
manufacture an empty available result.

Reuse `classifyPreviewFailure` and `buildPreviewFailure` from
`packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`. That
classifier is based only on `HttpError.status` or typed timeout names and uses
pre-authored closed copy; it never parses raw messages or reads Arr response
bodies. A thrown batch failure becomes classified unavailable; returned section
failures become `sectionErrors`. Log a static operation message through the
sanitized logger boundary, with raw diagnostic material only in logger metadata,
and persist/return only `{ code, message, recoveryAction }`.

Follow the typed-error mapping in
`packages/praxrr-app/src/lib/server/sync/canary/errors.ts` and
`routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`: invalid input is 400,
not found is 404, wrong lifecycle or unavailable evidence is 409, and stale
token remains 422. Introduce a named preview-unavailable error/predicate rather
than inspecting error strings. Check evidence before `markRollingOut` and
enqueue; on rejection, leave the row unchanged and enqueue nothing. Abort uses
its existing status/token guard and must not depend on evidence validity.

Route parsing should retain the current fail-fast conventions: digits-only
positive IDs, bounded request bodies checked both by `Content-Length` and actual
encoded size, guarded JSON parsing, and non-empty `stateToken`.
`+page.server.ts` similarly rejects junk IDs with SvelteKit `error(400)` and
unknown rows with `error(404)`.

## Testing Approach

Use the existing scratch-database harnesses rather than mocks for persistence.
In `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`, tests initialize
a unique temp base, run the full migration chain, inspect `PRAGMA table_info`,
verify defaults/constraints, and exercise `down`. Extend it for the nullable
`remaining_preview_evidence` column. Add the dated migration
`20260723_add_canary_preview_evidence.ts`, statically import it and append it
after 20260721 in `packages/praxrr-app/src/lib/server/db/migrations.ts`; the
established additive-column shape is shown by
`migrations/20260720_add_sync_history_entity_outcomes.ts`. Update the reference
`packages/praxrr-app/src/lib/server/db/schema.sql` as required by the feature
spec, while treating migrations as the executable schema source.

Extend `packages/praxrr-app/src/tests/db/canaryQueries.test.ts` beyond
happy-path round trips. Write raw SQL fixtures for null, malformed JSON, wrong
version/discriminator, invalid failure code, duplicate/missing/extra target,
wrong Arr type, and section failure; assert every case decodes as unavailable
and remains abortable. Also assert `recordCanaryOutcome` writes status, rotated
token, and evidence together and rejects a second guarded update.

Coordinator tests in
`packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts` already cover the
gate matrix, partial-abort fail-closed behavior, and remaining-preview
generation. Add deterministic unreachable and unauthorized thrown errors,
partial section outcomes, complete zero-change output, and exact target ID/Arr
assertions. Proceed tests must assert no `sync.canary.rollout` job exists for
unavailable, corrupt, or target-mismatched evidence; Abort must succeed for
those same rows.

Route tests in `packages/praxrr-app/src/tests/routes/canary.test.ts` invoke
handlers directly against a migrated database and already assert 400/404/409/422
mappings plus enqueue counts. Extend them to assert the discriminated
start/detail payload and safe 409 response. Mirror the secret-shaped fixtures
and `assertNoLeak`/closed-code checks in
`packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts` so raw
keys, URLs, response bodies, and stack-like strings appear nowhere in
DB/API/UI-facing evidence.

For the Svelte contract, follow the source-test pattern in
`packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`, which reads
`.svelte` fixtures relative to `import.meta.url` and asserts critical
wiring/copy with `assertStringIncludes` and `assertMatch`. Assert distinct
available-with-changes, available-empty, and unavailable branches; native
disabled Proceed with `aria-describedby`; enabled Abort under unavailable
evidence; safe message/recovery rendering; and removal of the
representative-canary-diff claim. Source tests are a focused regression layer,
not a substitute for route/domain tests or `deno task check:client`.

## Patterns to Follow

1. **Persist one authoritative discriminated snapshot.** Start, detail, UI, and
   Proceed must consume the same decoded evidence.
2. **Parse evidence strictly and fail closed.** Reuse the validity-aware parsing
   concept, but fully validate the union and exact target set; never reuse
   `parseJsonArray`'s `[]` fallback.
3. **Classify safely at the catch boundary.** Reuse `failureReason.ts`; do not
   persist raw exceptions or infer codes from messages.
4. **Keep transition and authorization atomic.** Validate available evidence,
   then preserve the existing `awaiting_confirmation + state_token` guarded
   update and enqueue only after success.
5. **Preserve exact Arr semantics.** Compare target IDs and every preview
   `arrType` against the persisted rollout; missing/disabled/wrong-Arr data is
   unavailable, never silently reduced.
6. **Separate planned from actual UI evidence.** Canary Sync History remains
   confirmed execution; remaining previews are explicitly planned.
   Empty-complete is success, unavailable is an error, Proceed fails closed, and
   Abort remains available.
7. **Test every boundary independently.** Migration shape, strict decoder,
   guarded query, coordinator policy, HTTP mapping/no enqueue, secret redaction,
   and Svelte action-state wiring all need focused assertions.
