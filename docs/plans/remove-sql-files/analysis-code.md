### Executive Summary

The codebase already has a complete YAML entity read/deserialize pipeline, but runtime ingestion is
still gated by migration mode and mixed SQL/YAML paths. The highest-impact edits are centralized in
config parsing, import orchestration, and tests that assert hybrid/sql-only behavior. The plan
should isolate these shared files early, then branch into tooling and documentation tracks.

### Related Components

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`:
  dual-path import and SQL metadata parsing.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`:
  fallback logic around import mode.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`:
  migration mode/fallback config contract.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`:
  canonical YAML source reader.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`:
  portable entity to SQL op conversion path.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/compat-check.ts`: current SQL-based
  compatibility validation.

### Implementation Patterns

**Pattern Name**: Mode-driven orchestration removal

- Example:
  `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- Apply to: [config cleanup, manager simplification]

**Pattern Name**: YAML-only base import

- Example:
  `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- Apply to: [ingestion refactor, SQL parser removal]

**Pattern Name**: Preserve layer boundaries

- Example:
  `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- Apply to: [schema/tweaks safety checks]

**Pattern Name**: Backward-compatible cache execution

- Example:
  `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- Apply to: [legacy helper retention, regression prevention]

### Integration Points

#### Files to Create

- None required by current scope.

#### Files to Modify

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`:
  remove SQL file scan and hybrid suppression mechanics.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`:
  remove fallback branch and mode switch.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`:
  remove mode/fallback types and parsing.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/compat-check.ts`: rework compatibility
  validation to avoid `packages/praxrr-db/ops/*.sql`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`:
  rebase test coverage to YAML-only path.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`:
  remove or replace.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`:
  remove or replace.

### Conventions

- Keep strict TypeScript typing and avoid `any`.
- Prefer fail-fast validation and explicit errors.
- Preserve project formatting conventions (tabs, single quotes, 100 char line width).
- Keep tests focused on behavior changes introduced by the SQL-path removal.

### Gotchas and Warnings

- `pcd_ops` SQL replay remains a core runtime behavior; removing disk SQL is not equivalent to
  removing SQL execution.
- `packages/praxrr-schema/ops/*.sql` are required schema inputs and must stay.
- Export utilities still reference `.sql` numbering/patterns and may need an explicit transition
  strategy.
- CI scripts that compare SQL-vs-YAML parity become invalid once SQL base ingestion is removed.

### Task Guidance by Area

- database: keep schema load + cache replay stable while changing base ingestion source.
- api: ensure PCD import/export endpoints no longer expose or depend on migration mode toggles.
- ui: update any surfaced migration-mode docs/settings references if present.
