# Canary Remaining-Target Preview Evidence

The Canary workflow is a two-phase state machine: `startRollout()` runs and
records one exact-Arr canary, then `proceedRollout()` or `abortRollout()`
resolves the persisted verification gate under a `state_token` value guard.
Issue #239 adds a second, explicitly planned evidence domain beside confirmed
canary Sync History: a versioned `available`/`unavailable` remaining-target
preview snapshot persisted on `canary_rollouts`. The coordinator builds and
classifies the snapshot, the query layer strictly decodes and atomically stores
it with the gate decision, start/detail APIs expose the same evidence, and
Proceed rejects anything except complete exact-target available evidence.
Existing selection, batching, execution, confirmed canary evidence,
Abort-without-rollback, and explicit Radarr/Sonarr/Lidarr semantics remain
unchanged.

## Relevant Files

- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`: Builds
  evidence and enforces gate transitions.
- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`: Owns rollout, row,
  and evidence contracts.
- `packages/praxrr-app/src/lib/server/sync/canary/selection.ts`: Resolves the
  exact same-Arr cohort.
- `packages/praxrr-app/src/lib/server/sync/canary/errors.ts`: Typed coordinator
  errors and route predicates.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Produces
  per-instance previews and section failures.
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`: Produces
  closed, safe failure evidence.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: Defines the
  portable safe failure vocabulary.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: Runs bounded
  multi-instance preview generation.
- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`: Persists
  JSON and guards rollout transitions.
- `packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts`:
  Baseline Canary schema.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: Static migration
  registration and ordering.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: Reference application
  schema requiring parity.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`: Start/list
  HTTP boundary.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/+server.ts`:
  Reloadable rollout detail boundary.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`:
  Promotion error/status mapping.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/abort/+server.ts`:
  Abort semantics to preserve.
- `packages/praxrr-app/src/routes/canary/+page.svelte`: Starts rollouts and
  redirects to detail.
- `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts`: Loads rollout
  and confirmed diagnostics.
- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`: Renders
  actual/planned evidence and gate actions.
- `docs/api/v1/schemas/canary.yaml`: Source-of-truth portable Canary schemas.
- `docs/api/v1/schemas/sync.yaml`: Source-of-truth safe preview failure schema.
- `docs/api/v1/paths/canary.yaml`: Source-of-truth Canary endpoint behavior.
- `docs/api/v1/openapi.yaml`: Canary component/path wiring.
- `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`: Executable
  migration shape coverage.
- `packages/praxrr-app/src/tests/db/canaryQueries.test.ts`: Query round-trip and
  guarded transition coverage.
- `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`: Gate matrix
  and exact-target policy coverage.
- `packages/praxrr-app/src/tests/routes/canary.test.ts`: Direct
  route/status/enqueue contract coverage.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`: Safe
  failure and non-leak patterns.
- `ROADMAP.md`: Release status entry updated by the implementation PR.

## Relevant Tables

- `canary_rollouts`: Exact Arr scope, targets, lifecycle, token guard, results,
  and new preview evidence.
- `canary_settings`: Canary selection, batch-size, enablement, and
  partial-policy defaults; unchanged.
- `sync_history`: Confirmed canary execution evidence linked by
  `canary_sync_history_id`; unchanged.
- `job_queue`: Receives `sync.canary.rollout` only after an available-evidence
  guarded transition.

## Relevant Patterns

**Layered Canary orchestration**: Keep selection in `selection.ts`, policy in
`coordinator.ts`, persistence in `canaryRollouts.ts`, and HTTP translation in
routes. See
[`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`](../../../packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts).

**Value-guarded transitions**: Mutations use status and `state_token`
predicates, then enqueue only after the guarded update succeeds. See
[`packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`](../../../packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts).

**Strict authorizing evidence**: Do not reuse `parseJsonArray()`'s empty
fallback; null, malformed, unsupported, partial, or target-mismatched evidence
becomes unavailable. See validity-aware parsing in
[`packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`](../../../packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts).

**Typed safe failures**: Classify only typed/status errors and transport only
pre-authored `{ code, message, recoveryAction }`. See
[`packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`](../../../packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts).

**Exact Arr dispatch**: Every target and preview must match the rollout's
explicit `arrType`; missing/disabled/wrong-Arr targets fail closed instead of
being filtered or substituted. See
[`packages/praxrr-app/src/lib/server/sync/canary/selection.ts`](../../../packages/praxrr-app/src/lib/server/sync/canary/selection.ts).

**Contract-first API generation**: Change source YAML, keep runtime shapes
identical, then regenerate application/distribution types. See
[`docs/api/README.md`](../../api/README.md).

**Migration-first schema evolution**: Add a dated migration, statically register
it, test it through the real chain, and update reference schema parity. See
[`packages/praxrr-app/src/lib/server/db/migrations/20260720_add_sync_history_entity_outcomes.ts`](../../../packages/praxrr-app/src/lib/server/db/migrations/20260720_add_sync_history_entity_outcomes.ts).

**Svelte 5 without runes**: Use exported data, `$:` derivations, existing UI
components, native disabled behavior, and persistent accessible recovery copy.
See
[`packages/praxrr-app/src/routes/canary/[id]/+page.svelte`](../../../packages/praxrr-app/src/routes/canary/%5Bid%5D/+page.svelte).

**Layered verification**: Cover migration/query/coordinator/route boundaries
with real scratch databases and add a focused Svelte source assertion for
action/copy wiring. See
[`packages/praxrr-app/src/tests/routes/canary.test.ts`](../../../packages/praxrr-app/src/tests/routes/canary.test.ts).

## Relevant Docs

**`docs/plans/239-canary-preview-evidence/feature-spec.md`**: You _must_ read
this for the selected evidence contract, scope, UX states, and acceptance tests.

**GitHub issue #239**: You _must_ read this for authoritative scope, exclusions,
acceptance criteria, and minimum commands.

**`docs/internal-docs/automation-transparency-audit.md`**: You _must_ read this
for the originating direct-canary evidence gap.

**`docs/plans/canary-sync-blast-radius/design.md`**: You _must_ read this when
preserving the original state machine, token guard, exact Arr cohort, and Abort
boundary.

**`docs/api/v1/schemas/canary.yaml` and `docs/api/v1/paths/canary.yaml`**: You
_must_ read these before changing the portable API contract.

**`docs/site/src/content/docs/app/sync-pipeline.md`**: You _must_ read this when
changing preview/execution separation or per-Arr dispatch.

**`CLAUDE.md`**: You _must_ read this for contract-first API, migrations,
portable fidelity, Svelte, and cross-Arr rules.

**`docs/api/README.md`**: Reference this for API generation and bundled artifact
workflow.
