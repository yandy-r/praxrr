### Executive Summary

`initiate-apps` adds env-var-driven Arr instance provisioning that reconciles `RADARR|SONARR|LIDARR_INSTANCE_*_{N}` entries into `arr_instances` during startup. The feature introduces an instance provenance column (`source: 'ui' | 'env'`) and an idempotent reconcile flow keyed by `api_key`, while preserving non-blocking startup behavior. Core implementation centers on a new `$arr/envInstances.ts` module, `arrInstancesQueries` extensions, migration registration, and a startup hook insertion before jobs are initialized.

### Architecture Context

- System Structure: startup flow in `packages/praxrr-app/src/hooks.server.ts` must call reconciliation after migrations and before `initializeJobs()`.
- Data Flow: `Deno.env` -> parse/validate grouped instance variables -> reconcile against DB in transaction -> insert/update/disable env rows -> optional default delay profile application for radarr/sonarr.
- Integration Points: `hooks.server.ts`, `db/queries/arrInstances.ts`, `db/migrations.ts`, `db/schema.sql`, `utils/arr/factory.ts`, `utils/arr/defaults.ts`, `utils/validation/url.ts`.

### Critical Files Reference

- `docs/plans/initiate-apps/feature-spec.md`: authoritative behavior and conflict-resolution rules.
- `packages/praxrr-app/src/hooks.server.ts`: startup insertion point and non-blocking setup pattern.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: source-aware query extensions and upsert support.
- `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: migration template for adding `source` column.

### Patterns to Follow

- Pattern: non-blocking startup setup block with `try/catch` and `source: 'Setup'` logging (`hooks.server.ts`).
- Pattern: typed raw SQL query module organization (`arrInstances.ts`).
- Pattern: default delay profile apply flow for radarr/sonarr only (`routes/arr/new/+page.server.ts`).
- Pattern: optional env read style `Deno.env.get()?.trim() || undefined` (`hooks.server.ts`, `config.ts`).

### Cross-Cutting Concerns

- Security: never log API keys; keep env secrets out of startup summaries.
- Performance: reconcile in one transaction and avoid blocking startup on per-instance failures.
- Testing: add parser + reconciliation tests and runner alias coverage.

### Parallelization Opportunities

- Independent work areas: parser/test implementation and migration/query extension work can run in parallel.
- Coordination hotspots: reconciliation module depends on both parser shape and query API; startup integration depends on reconciliation completion.

### Implementation Constraints

- Must add `arr_instances.source TEXT NOT NULL DEFAULT 'ui'` and keep schema docs in sync.
- Must reconcile every startup (no setup-state one-time guard).
- Must skip overriding user-managed rows and disable orphaned env rows instead of deleting (protect FK-dependent data).
- Must validate app type against Arr-app-only set (no implicit chaptarr fallback).

### Planning Recommendations

- Phase 1: foundation (parser, migration/query extensions, reconciliation, startup wiring).
- Phase 2: resilience/validation (optional connection tests and richer startup reporting).
- Phase 3: UI/docs alignment (env provenance indicators and documentation updates).
