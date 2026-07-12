# PR Review #270 — feat(plugins): add durable registry API

**Reviewed**: 2026-07-12T00:12:10Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/264-durable-plugin-registry → main
**Decision**: REQUEST CHANGES

## Worktree Setup

- **Parent**: `~/.claude-worktrees/praxrr-264-durable-plugin-registry/` (branch: `feat/264-durable-plugin-registry`)

## Summary

The durable registry architecture and contract coverage are strong, but mutations currently leave
live dispatch stale and persisted timestamps violate the declared portable format. Contract,
operability, performance-bound, and documentation findings should also be resolved before merge.

## Findings

### CRITICAL

None.

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/db/migrations/20260724_create_plugin_registry.ts:25` — SQLite `CURRENT_TIMESTAMP` produces `YYYY-MM-DD HH:MM:SS`, while OpenAPI declares RFC 3339 `date-time`; responses return these timestamps unchanged.
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Store RFC 3339 UTC timestamps or normalize them at the repository boundary, then assert live API timestamps satisfy the declared format.

- **[F002]** `packages/praxrr-app/src/lib/server/plugins/responses.ts:134` — Enable/disable updates SQLite without updating the live registry or serializing with reload. Dispatch eligibility can remain stale, and overlapping reloads can publish state inconsistent with durable enablement; the documented conflict outcome is unreachable.
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Serialize mutations with reload or use revision/CAS checks, atomically publish updated memory after commit, implement conflict outcomes, and test immediate disable-to-dispatch plus mutation/reload overlap.

### MEDIUM

- **[F003]** `docs/api/v1/schemas/plugins.yaml:222` — `registry_conflict` is published as a portable error code, but no service outcome or route can emit it.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Implement the conflict outcome with tests, or remove it and regenerate all contract artifacts.

- **[F004]** `docs/architecture/plugins.md:144` — Lifecycle documentation claims management persists transient/rejected states and calls `register()`, while the host persists accepted candidates as `registered` and publishes through `replaceSnapshot()`.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Correct the lifecycle diagram and text to distinguish scan-time outcomes from durable state and describe the actual snapshot path.

- **[F005]** `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts:91` — Listing and reconciliation materialize and revalidate every durable row while missing identities are retained indefinitely, allowing management cost to grow without a defined bound.
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Bound management listing/reload work with pagination or targeted queries and define a retention/archival policy that preserves required enablement intent.

- **[F006]** `packages/praxrr-app/src/lib/server/plugins/host.ts:164` — Reload scanning has no manifest byte-size or parse-complexity budget, so an oversized manifest can consume disproportionate memory/CPU on startup or authenticated reload.
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Enforce a maximum manifest byte size before parsing, bound manifest string/array lengths, reject oversized entries, and test the limits.

- **[F007]** `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts:10` — All five plugin handlers discard internal errors without safe server-side logging, making database or reload failures operationally invisible.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Add centralized safe diagnostic logging before returning the redacted `internal_error` response.

### LOW

- **[F008]** `ROADMAP.md:72` — The delivery row still says PR pending although PR #270 exists.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Link PR #270 and mark it pending review, CI, and merge.

- **[F009]** `docs/prps/reports/264-durable-plugin-registry-report.md:33` — The report claims route-level reload-failure coverage, but the route test has no reload-failure case.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Add the route failure test or narrow the report claim.

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass — `deno task check`; Svelte 0 errors/0 warnings |
| Lint       | Pass for all changed files; repo-wide baseline has unrelated pre-existing warnings |
| Tests      | Pass — 2450 passed across 51 steps, 0 failed; focused plugins 136 passed |
| Build      | Pass — `deno task build` |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/api/v1/openapi.yaml` (Modified)
- `docs/api/v1/paths/mcp.yaml` (Modified)
- `docs/api/v1/paths/plugins.yaml` (Added)
- `docs/api/v1/schemas/plugins.yaml` (Added)
- `docs/architecture/plugins.md` (Modified)
- `docs/prps/plans/.prp-research/264-durable-plugin-registry/infra-research.md` (Added)
- `docs/prps/plans/.prp-research/264-durable-plugin-registry/patterns-research.md` (Added)
- `docs/prps/plans/.prp-research/264-durable-plugin-registry/quality-research.md` (Added)
- `docs/prps/plans/completed/264-durable-plugin-registry.plan.md` (Added)
- `docs/prps/reports/264-durable-plugin-registry-report.md` (Added)
- `docs/prps/specs/264-durable-plugin-registry.spec.md` (Added)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations/20260724_create_plugin_registry.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts` (Added)
- `packages/praxrr-app/src/lib/server/mcp/tools.ts` (Modified)
- `packages/praxrr-app/src/lib/server/plugins/host.ts` (Modified)
- `packages/praxrr-app/src/lib/server/plugins/index.ts` (Modified)
- `packages/praxrr-app/src/lib/server/plugins/registry.ts` (Modified)
- `packages/praxrr-app/src/lib/server/plugins/responses.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/+server.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/+server.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/disable/+server.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts` (Added)
- `packages/praxrr-app/src/routes/api/v1/plugins/reload/+server.ts` (Added)
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts` (Modified)
- `packages/praxrr-app/src/tests/db/pluginRegistryQueries.test.ts` (Added)
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts` (Modified)
- `packages/praxrr-app/src/tests/plugins/executor.test.ts` (Modified)
- `packages/praxrr-app/src/tests/plugins/host.test.ts` (Modified)
- `packages/praxrr-app/src/tests/plugins/registry.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/plugins.test.ts` (Added)
- `scripts/test.ts` (Modified)
