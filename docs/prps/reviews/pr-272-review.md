# PR Review #272 — feat(plugins): add management console

**Reviewed**: 2026-07-12T02:29:19Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/266-plugin-management-ui → main
**Decision**: APPROVE

## Summary

The implementation is functionally sound, security-conscious, and well tested, with no critical or high-severity findings. Four medium findings should be addressed to tighten origin syntax, complete the accessibility target contract, centralize runtime response validation, and make the navigation invariant test honest.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

- **[F001]** `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts:25` — The guard compares parsed origins but accepts same-host `Origin` values containing credentials, paths, queries, or fragments instead of requiring an origin-only serialization. [correctness]
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Parse once, require a canonical origin-only value exactly equal to `url.origin`, reject credentials/non-root paths/queries/fragments, and extend the no-side-effect route matrix with those malformed same-host shapes.

- **[F002]** `packages/praxrr-app/src/routes/settings/plugins/+page.svelte:35` — The 608-line page hand-maintains the lifecycle set and four wire-response decoders, duplicating the generated contract without focused runtime-decoder tests. [quality]
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Move the lifecycle set and response decoders into a small client-safe contract module, add focused valid/malformed tests for every decoder, and import the boundary from the page.

- **[F003]** `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts:136` — The per-scope loop repeats the same unscoped Settings-child assertion four times and therefore does not test scope-dependent child filtering. [quality]
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Since Settings children are intentionally scope-invariant, replace the loop with one explicit invariant assertion and rename the test to match what it proves.

- **[F004]** `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts:474` — The 44px mobile target assertion covers only disclosure and enablement controls, leaving page reload/refresh/retry and row retry controls below or outside the stated coverage. [correctness]
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Give every plugin-management action/recovery control a 44px minimum target and extend the mobile test to measure header reload/refresh, page recovery, and row retry controls.

### LOW

None.

## Validation Results

| Check      | Result                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Type check | Pass — server check and Svelte check with 0 errors / 0 warnings                                |
| Lint       | Pass for all PR-owned files; repo-wide command retains unchanged main-branch baseline failures |
| Tests      | Pass — 31 focused review tests; prior full audit 2,483/0, plugin alias 158/0, Playwright 11/0  |
| Build      | Pass — documentation build 444 pages; generated API and bundle outputs deterministic           |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/README.md` (Modified)
- `docs/api/endpoints.md` (Modified)
- `docs/api/v1/paths/plugins.yaml` (Modified)
- `docs/architecture/plugins.md` (Modified)
- `docs/features/README.md` (Modified)
- `docs/features/plugin-management.md` (Added)
- `docs/plans/266-plugin-management-ui/analysis-code.md` (Added)
- `docs/plans/266-plugin-management-ui/analysis-context.md` (Added)
- `docs/plans/266-plugin-management-ui/analysis-tasks.md` (Added)
- `docs/plans/266-plugin-management-ui/feature-spec.md` (Added)
- `docs/plans/266-plugin-management-ui/parallel-plan.md` (Added)
- `docs/plans/266-plugin-management-ui/research-architecture.md` (Added)
- `docs/plans/266-plugin-management-ui/research-business.md` (Added)
- `docs/plans/266-plugin-management-ui/research-docs.md` (Added)
- `docs/plans/266-plugin-management-ui/research-external.md` (Added)
- `docs/plans/266-plugin-management-ui/research-integration.md` (Added)
- `docs/plans/266-plugin-management-ui/research-patterns.md` (Added)
- `docs/plans/266-plugin-management-ui/research-practices.md` (Added)
- `docs/plans/266-plugin-management-ui/research-recommendations.md` (Added)
- `docs/plans/266-plugin-management-ui/research-security.md` (Added)
- `docs/plans/266-plugin-management-ui/research-technical.md` (Added)
- `docs/plans/266-plugin-management-ui/research-ux.md` (Added)
- `docs/plans/266-plugin-management-ui/shared.md` (Added)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/plugins/_origin.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/settings/+page.svelte` (Modified)
- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte` (Added)
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte` (Added)
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts` (Added)
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` (Modified)
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts` (Modified)
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/specs/plugin-management.spec.ts` (Added)
- `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts` (Added)
- `packages/praxrr-app/src/tests/routes/plugins.test.ts` (Modified)
- `scripts/test.ts` (Modified)
