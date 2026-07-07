# PR Review #203 — feat: add progressive complexity architecture

**Reviewed**: 2026-07-06T23:55:00Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/progressive-complexity-architecture → main
**Decision**: REQUEST CHANGES

## Summary

The progressive complexity foundation is well-structured and mirrors the existing ui-preferences pattern: shared tier contract, migration, OpenAPI route, client store, Svelte context, and reference integration on custom-format general. API/query layers are sound and `deno task test complexity` passes (15/15). However, the reference integration does not seed persisted disclosure modes on first paint (violating documented precedence), the E2E spec targets the wrong route, and `deno task lint` still fails on the PR branch despite the PR claiming otherwise. Validation also reports 3 unrelated full-suite test failures (ARR credential env).

## Findings

### CRITICAL

(none)

### HIGH

- **[F001]** `packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte:40` — Server-preloaded disclosure modes are ignored; persisted `basic|advanced` does not win on first paint when it disagrees with the tier default [correctness]
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: `+page.server.ts` loads `customFormatSectionModes` but `GeneralForm` only consumes tiers. Pass `initialMode` to `DisclosureSection` when the server-loaded disclosure preference is persisted (mirror API `persisted` flag), or teach `DisclosureSection` to accept server-seeded mode that blocks tier defaults until client hydration completes.

- **[F002]** `packages/praxrr-app/src/tests/e2e/specs/2.51-progressive-complexity.spec.ts:59` — E2E targets create route instead of documented edit general reference integration [correctness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Navigate to `/custom-formats/{databaseId}/{id}/general` after seeding tiers; isolate or reset disclosure/tier state; assert panel visibility after hydration. Create route does not server-load `customFormatSectionTiers`.

- **[F003]** `docs/plans/pcd-state-snapshot/feature-spec.md:1` — `deno task lint` fails on PR branch; PR claims Prettier fixes included [pattern compliance]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Format and commit the three failing docs (`feature-spec.md`, `research-recommendations.md`, `parallel-plan.md`) or update the PR body/checklist to acknowledge pre-existing lint debt. None of these files appear in the PR diff.

- **[F004]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:75` — Route uses `console.error` instead of project `$logger` [pattern compliance]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Import `logger` from `$logger/logger.ts` and replace `console.error` calls at lines 75, 130, and 202 to match dominant v1 API route convention.

- **[F005]** `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts:1` — Client store largely duplicates `userInterfacePreferences.ts` sync infrastructure (~300 lines) [maintainability]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Extract shared debounced section-sync primitive (hydration, flush, retry, ref-count, 401 handling); keep tier-specific `recordActivity`/`dismissSuggestion` as thin wrappers.

### MEDIUM

- **[F006]** `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte:50` — `recordActivity` is fire-and-forget with no error handling on manual toggles [correctness]
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Catch errors in `recordActivity` callers or inside the store; surface non-blocking warning on 429/4xx, consistent with tier-persist failure handling.

- **[F007]** `packages/praxrr-app/src/tests/routes/complexityTiersApi.test.ts:1` — Optimistic-lock edge cases only partially covered [completeness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Add tests for PATCH with `expected_updated_at` when no row exists (409), successful `applyConcurrentUpsert` path, and GET for synthetic `user id 0`.

- **[F008]** `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte:1` — Core tier vs disclosure precedence behavior has no dedicated tests [completeness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Add component or unit tests for: tier default when `persisted=false`; persisted disclosure blocks tier; explicit `initialMode` blocks tier; manual toggle persists and stops tier updates.

- **[F009]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:262` — In-memory `rateLimitState` Map never evicts stale keys [performance]
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Prune expired entries on each check or use LRU/max-size eviction (same pattern as `ui-preferences`; acceptable follow-up).

- **[F010]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:45` — Per-process rate limiting ineffective across multiple instances [performance]
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Document single-instance assumption or use shared storage; inherited from `ui-preferences` pattern.

- **[F011]** `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts:1` — File exceeds ~500-line soft cap (547 lines) [maintainability]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Split hydration/persistence into sibling module or extract shared primitive per F005.

- **[F012]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:400` — `applyConcurrentUpsert` uses raw SQL in route handler instead of query module [pattern compliance]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Add `userComplexityTiersQueries.updateIfUpdatedAt(...)` and call from route.

- **[F013]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:246` — Validation/rate-limit helpers duplicated from `ui-preferences/+server.ts` [pattern compliance]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Extract shared `parseSectionKey`, `parseStrictParam`, `checkWriteRateLimit`, and concurrency helpers.

- **[F014]** `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierSelector.svelte:1` — Import/style inconsistency vs `DisclosureSection` (tabs vs spaces, relative vs `$ui/` aliases) [pattern compliance]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Normalize to Prettier project style and consistent `$ui/...` + `.ts` import paths across new complexity UI modules.

### LOW

- **[F015]** `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts:49` — `customFormatSectionModes` computed but unused by `GeneralForm` [completeness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Wire modes into precedence (with F001) or remove dead server work until needed.

- **[F016]** `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts:30` — Uses `console.warn` instead of `$logger` [maintainability]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Use `$logger/` for consistency with API routes.

- **[F017]** `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts:23` — N+1 DB reads (one query per section key) [performance]
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Batch via `getByUserId(userId)` and filter; current call sites use small fixed key sets.

- **[F018]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:341` — Large single-request counter deltas allowed (only total clamped) [security]
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Optionally cap per-request `interaction_delta`/`advanced_toggle_delta` magnitude.

- **[F019]** `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts:52` — GET lacks `user.id <= 0` short-circuit that PATCH has [correctness]
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Return `defaultTierRecord(sectionKey)` without DB query for synthetic API-key user id 0.

- **[F020]** `packages/praxrr-app/src/lib/server/db/migrations/20260706_create_user_complexity_tiers.ts:15` — DB schema lacks upper-bound CHECK on counters [security]
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Add `CHECK (interaction_count <= 1000000)` for defense in depth; app layer already clamps.

- **[F021]** `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierSelector.svelte:29` — `userComplexityTiersQueries.reset()` unused by UI reset control [maintainability]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Wire reset through query `reset()` semantics (clears suggestion metadata) or document as server-only.

## Validation Results

| Check      | Result  |
| ---------- | ------- |
| Type check | Pass    |
| Lint       | Fail    |
| Tests      | Fail    |
| Build      | Skipped |

**Lint detail**: `deno task lint` fails on `docs/plans/pcd-state-snapshot/feature-spec.md`, `docs/plans/score-simulator-phase2/research-recommendations.md`, `docs/plans/score-simulator-phase3/parallel-plan.md` (not in PR diff).

**Tests detail**: `deno task test` — 1032 passed, 3 failed (`arrExternalUrlLayoutPropagation`, `lidarrOnboarding` ×2) due to missing `ARR_CREDENTIAL_MASTER_KEY` env; unrelated to PR. `deno task test complexity` — 15/15 passed.

## Files Reviewed

- `docs/api/endpoints.md` (Modified)
- `docs/api/v1/openapi.yaml` (Modified)
- `docs/features/progressive-disclosure.md` (Modified)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/api-researcher.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/business-analyzer.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/practices-researcher.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/recommendations-agent.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/security-researcher.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/tech-designer.md` (Added)
- `docs/prps/plans/.prp-research/progressive-complexity-architecture/ux-researcher.md` (Added)
- `docs/prps/plans/completed/progressive-complexity-architecture.plan.md` (Added)
- `docs/prps/reports/progressive-complexity-architecture-report.md` (Added)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts` (Added)
- `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityProgressionHint.svelte` (Added)
- `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierProvider.svelte` (Added)
- `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierSelector.svelte` (Added)
- `packages/praxrr-app/src/lib/client/ui/complexity/complexityTierContext.ts` (Added)
- `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte` (Modified)
- `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/migrations.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations/20260706_create_user_complexity_tiers.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/user_complexity_tiers.ts` (Added)
- `packages/praxrr-app/src/lib/shared/complexity/tiers.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts` (Added)
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts` (Modified)
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte` (Modified)
- `packages/praxrr-app/src/tests/complexity/loadSectionTiers.test.ts` (Added)
- `packages/praxrr-app/src/tests/complexity/userComplexityTiersQueries.test.ts` (Added)
- `packages/praxrr-app/src/tests/e2e/specs/2.51-progressive-complexity.spec.ts` (Added)
- `packages/praxrr-app/src/tests/routes/complexityTiersApi.test.ts` (Added)
- `scripts/test.ts` (Modified)
