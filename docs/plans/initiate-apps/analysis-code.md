### Executive Summary

The feature aligns with existing server startup and DB query conventions: migrations first, then reconciliation, then job initialization. The largest changes concentrate in startup orchestration, `arrInstances` query contracts, and a new `envInstances` utility module. Existing Arr client, validation, and logging utilities already provide the needed primitives and should be reused directly.

### Related Components

- `packages/praxrr-app/src/hooks.server.ts`: sequential startup orchestration and insertion point.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: instance CRUD/query surface to extend with source-aware behavior.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: migration registry update.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: schema documentation update.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Arr client creation for optional connectivity and delay profile operations.
- `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: default delay profile logic.
- `packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`: gate for applying default delay profiles.
- `scripts/test.ts`: scoped test alias additions.

### Implementation Patterns

**Startup Non-Blocking Setup Block**: keep each operation isolated in `try/catch`; log and continue.

- Example: `packages/praxrr-app/src/hooks.server.ts:37`
- Apply to: startup reconciliation integration, per-instance error isolation.

**Typed Raw SQL Query Module**: keep query helpers typed and minimal; avoid hidden side effects.

- Example: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts:30`
- Apply to: source column wiring, new lookup/update helpers.

**SQLite ADD COLUMN Migration Pattern**: add non-null column with default and register migration.

- Example: `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts:1`
- Apply to: `source` column migration.

**Delay Profile Apply Pattern**: only for supported arr apps, guarded by settings and wrapped in error handling.

- Example: `packages/praxrr-app/src/routes/arr/new/+page.server.ts:100`
- Apply to: post-create handling in reconciliation.

### Integration Points

#### Files to Create

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: parse env variables and reconcile state into DB.
- `packages/praxrr-app/src/lib/server/db/migrations/20260220_add_arr_instance_source.ts`: schema migration.
- `packages/praxrr-app/src/tests/base/envInstances.test.ts`: parser/reconciliation unit tests.

#### Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`: invoke reconciliation in startup sequence.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: add source-aware interfaces and query helpers.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: register new migration.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: document `source` column.
- `scripts/test.ts`: add `env-instances` alias.
- `packages/praxrr-app/src/routes/arr/+page.server.ts`: ensure source is exposed for list UI.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: support env-source edit restrictions.

### Conventions

- Use strict TS types and existing path aliases.
- Fail fast on malformed config while keeping startup globally non-blocking.
- Keep task-level file touch count narrow (1-3 files each).

### Gotchas and Warnings

- Do not delete orphaned env instances because FK cascades can remove unrelated configuration history.
- `api_key` uniqueness is enforced in logic, not by DB unique constraint; explicit lookup logic is required.
- Lidarr must not use radarr/sonarr-specific delay profile defaults.
- Avoid introducing cross-arr semantic assumptions; dispatch by explicit `arr_type`.

### Task Guidance by Area

- database: migration + query extensions + orphan disable semantics.
- api: startup call sequencing + reconcile flow + optional connectivity gate.
- ui: env provenance presentation and editability constraints.
