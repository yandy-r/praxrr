# PR Review #258 — feat(canary): persist remaining preview evidence

**Reviewed**: 2026-07-10T20:39:00Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/239-canary-preview-evidence → main
**Decision**: APPROVE

## Worktree Setup

- **Parent**: /home/yandy/.claude-worktrees/praxrr-239-canary-preview-evidence/ (branch: feat/239-canary-preview-evidence)

## Summary

Re-review of head `bd23999f` confirms both findings are fixed with no new findings. Promotion now binds non-empty explicit section sequences throughout generation, persistence, reads, and authorization while preserving null/empty configured-section semantics; the native gate controls follow the Svelte 5 handler convention.

## Findings

### CRITICAL

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts:383` — Available evidence is validated against target identity and its own internally consistent section payloads, but never against the rollout's persisted explicit `sections`. Corrupt evidence can omit a requested section while remaining internally valid, so `proceedRollout` can authorize a rollout whose durable plan does not cover the requested scope.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Include persisted `sections` in the evidence context, strictly decode it, and require every available preview to match the explicit requested section sequence before returning `available`; also reject mismatched generated previews in the coordinator and add query/coordinator promotion tests. Preserve per-instance configured-section variance when the persisted value is null.

### MEDIUM

- **[F002]** `packages/praxrr-app/src/routes/canary/[id]/+page.svelte:469` — The changed native Proceed and Abort controls still use legacy `on:click` directives despite the project rule requiring Svelte 5 `onclick` handlers.
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Convert the two native button handlers to `onclick` and extend the focused UI source-contract test so the gate controls cannot regress to legacy event directives.

### LOW

## Validation Results

| Check      | Result                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Type check | Pass — `deno task check` (0 errors, 0 warnings)                                                                                            |
| Lint       | Pass for changed files; project-wide `tsc` substep reproduces unchanged `settings/about/+page.server.ts:56` baseline failure on clean main |
| Tests      | Pass — 2,213 passed, 0 failed; focused query/coordinator/UI suites 38 passed                                                               |
| Build      | Pass — `deno task build`                                                                                                                   |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/api/v1/openapi.yaml` (Modified)
- `docs/api/v1/paths/canary.yaml` (Modified)
- `docs/api/v1/schemas/canary.yaml` (Modified)
- `docs/internal-docs/automation-transparency-audit.md` (Modified)
- `docs/plans/239-canary-preview-evidence/analysis-code.md` (Added)
- `docs/plans/239-canary-preview-evidence/analysis-context.md` (Added)
- `docs/plans/239-canary-preview-evidence/analysis-tasks.md` (Added)
- `docs/plans/239-canary-preview-evidence/feature-spec.md` (Added)
- `docs/plans/239-canary-preview-evidence/parallel-plan.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-architecture.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-business.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-docs.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-external.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-integration.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-patterns.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-practices.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-recommendations.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-security.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-technical.md` (Added)
- `docs/plans/239-canary-preview-evidence/research-ux.md` (Added)
- `docs/plans/239-canary-preview-evidence/shared.md` (Added)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/schema.sql` (Modified)
- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/canary/errors.ts` (Modified)
- `packages/praxrr-app/src/lib/server/sync/canary/types.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte` (Modified)
- `packages/praxrr-app/src/tests/base/canaryPreviewEvidenceUx.test.ts` (Added)
- `packages/praxrr-app/src/tests/db/canaryMigration.test.ts` (Modified)
- `packages/praxrr-app/src/tests/db/canaryQueries.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/canary.test.ts` (Modified)
- `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts` (Modified)
