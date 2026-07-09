# PR Review #241 — fix(ci): restore Docker production build

**Reviewed**: 2026-07-09T23:28:57Z
**Mode**: PR
**Author**: yandy-r
**Branch**: agent/fix-docker-goals-route-export → main
**Decision**: APPROVE

## Worktree Setup

- **Parent**: `/home/yandy/.claude-worktrees/praxrr-docker-goals-route-export/` (branch: `agent/fix-docker-goals-route-export`)

## Summary

The patch fixes every non-private runtime helper export in SvelteKit endpoint modules and adds the missing production-build gate to pull-request CI. The changes are narrow, preserve route behavior, update all test references, and pass focused and full validation.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Validation Results

| Check      | Result                                                               |
| ---------- | -------------------------------------------------------------------- |
| Type check | Pass — server and client, 0 errors and 0 warnings                    |
| Lint       | Pass — ESLint and locked Prettier on all changed source/config files |
| Tests      | Pass — 1,801 passed across 31 steps; focused suites 8/8 and 13/13    |
| Build      | Pass — production Vite build completed successfully                  |

## Files Reviewed

- `.github/workflows/compatibility.yml` (Modified)
- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` (Modified)
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/goalsRoutes.test.ts` (Modified)
