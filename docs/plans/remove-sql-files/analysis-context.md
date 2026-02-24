### Executive Summary

This feature removes legacy base-op SQL file ingestion from `packages/praxrr-db/ops/*.sql` and makes
YAML entities in `packages/praxrr-db/entities/` the only base data source. The runtime must keep
schema SQL loading (`packages/praxrr-schema/ops/*.sql`) and DB-first `pcd_ops` replay semantics
unchanged. The main planning goal is to remove dual-path hybrid/sql-only behavior safely while
keeping backward compatibility for existing `pcd_ops` rows.

### Architecture Context

- System Structure: PCD compile flow remains layered (`schema -> base -> tweaks -> user`) with
  schema/tweaks file-based SQL and base/user DB-backed ops.
- Data Flow: Today `importBaseOps()` reads SQL ops + YAML entities; target state reads only YAML
  entities, deserializes to SQL strings, and writes `pcd_ops`.
- Integration Points: `importBaseOps.ts`, `manager.ts`, `config.ts`, migration parity/tooling
  scripts, exporter/git helpers, and migration-mode tests/docs.

### Critical Files Reference

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`:
  remove SQL directory reads and hybrid suppression logic.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`:
  remove sql-only/hybrid orchestration and fallback branch.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`:
  remove migration mode/fallback config and env parsing.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`:
  ensure schema/tweaks SQL loading remains intact.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`:
  preserve helper SQLite functions for legacy SQL in `pcd_ops`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/ops/`: SQL files to delete
  after runtime/tooling references are removed.

### Patterns to Follow

- Single Source of Truth: Treat portable entities as authoritative base source.
- DB-First Replay: Keep generated SQL storage in `pcd_ops` and compile replay model unchanged.
- Fail-Fast Config: Remove deprecated flags instead of introducing compatibility fallback branches.
- Layer Boundary Protection: Keep schema SQL and type-generation behavior unchanged.

### Cross-Cutting Concerns

- Testing: replace/remove SQL-only and hybrid fallback tests with YAML-only import coverage.
- Compatibility: rework scripts and CI that currently read `packages/praxrr-db/ops/*.sql`.
- Backward Compatibility: keep cache helper functions required by historical SQL rows in `pcd_ops`.

### Parallelization Opportunities

- Independent work areas: runtime ingestion cleanup, tooling/CI updates, docs cleanup.
- Coordination hotspots: `importBaseOps.ts` and export/tooling decisions that reference `.sql`
  naming or numbering.

### Implementation Constraints

- Do not remove schema SQL (`packages/praxrr-schema/ops/*.sql`).
- Do not change `pcd_ops` SQL-string storage model.
- Remove `PRAXRR_PCD_MIGRATION_MODE` and `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK` usage
  consistently across code, tests, and docs.

### Planning Recommendations

- Phase runtime changes first, then tooling/CI, then file and docs cleanup.
- Sequence deletion of `packages/praxrr-db/ops/*.sql` after all code/script references are removed.
- Keep explicit verification checkpoints per phase to prevent partial cutover regressions.
