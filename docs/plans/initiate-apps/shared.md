# initiate-apps

Environment-variable-based Arr instance provisioning adds a `reconcileEnvInstances()` startup function to `hooks.server.ts` that parses app-prefixed env vars (`RADARR_INSTANCE_URL_1`, `RADARR_INSTANCE_API_KEY_1`, etc.), validates them against the existing `arrInstancesQueries` CRUD layer, and upserts instances into `arr_instances` with a new `source` column (`'ui' | 'env'`) for provenance tracking. The function slots between the PCD auto-link block (line 91) and `initializeJobs()` (line 94) in the startup sequence, matching by `api_key` for idempotent reconciliation on every restart, with orphaned `source='env'` rows disabled rather than deleted to preserve 10 cascade-dependent child tables. The implementation requires a new migration for the `source` column, a new `envInstances.ts` module under `$arr/`, extensions to `arrInstancesQueries` for source-aware queries, and follows the established non-blocking startup pattern from the default-DB auto-link.

## Relevant Files

- packages/praxrr-app/src/hooks.server.ts: Startup sequence; insertion point at line 91-94 between PCD auto-link and initializeJobs()
- packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts: ArrInstance interface, CreateArrInstanceInput, create(), nameExists(), apiKeyExists() -- all need source column extension
- packages/praxrr-app/src/lib/server/db/queries/setupState.ts: Setup state singleton pattern reference (NOT used as guard for this feature)
- packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts: shouldApplyDefaultDelayProfiles() -- gates delay profile application for new radarr/sonarr instances
- packages/praxrr-app/src/lib/server/db/db.ts: DatabaseManager singleton with transaction() for atomic reconciliation batch
- packages/praxrr-app/src/lib/server/db/migrations.ts: Migration runner and registry; 56 migrations, latest version 20260219, next available 20260220
- packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts: Exact template for ALTER TABLE ADD COLUMN migration pattern
- packages/praxrr-app/src/lib/server/db/schema.sql: Reference schema documentation; must be updated after migration
- packages/praxrr-app/src/lib/server/utils/arr/factory.ts: createArrClient(type, url, apiKey, options) factory for connection testing and delay profile application
- packages/praxrr-app/src/lib/server/utils/arr/base.ts: BaseArrClient.testConnection() -- calls /api/{version}/system/status with retry logic
- packages/praxrr-app/src/lib/server/utils/arr/defaults.ts: getDefaultDelayProfile() for radarr/sonarr only (throws on lidarr)
- packages/praxrr-app/src/lib/server/utils/arr/types.ts: ArrType union including 'chaptarr' -- NOT the validation source for env instances
- packages/praxrr-app/src/lib/shared/pcd/types.ts: ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr'] and ArrAppType -- canonical type validation source
- packages/praxrr-app/src/lib/shared/arr/capabilities.ts: isArrAppType() guard for validating untrusted type strings
- packages/praxrr-app/src/lib/server/utils/validation/url.ts: parseOptionalAbsoluteHttpUrl() for external URL validation
- packages/praxrr-app/src/lib/server/utils/config/config.ts: Config singleton; env var reading patterns (Deno.env.get()?.trim()) but NOT where instance env vars go
- packages/praxrr-app/src/lib/server/utils/logger/logger.ts: Async logger with source/meta options; use source: 'Setup' for startup logs
- packages/praxrr-app/src/routes/arr/new/+page.server.ts: Reference implementation for instance creation validation, nameExists/apiKeyExists checks, and delay profile application
- packages/praxrr-app/src/routes/arr/test/+server.ts: Connection test pattern with createArrClient({timeout: 3000, retries: 0})
- packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts: Instance update validation reference; type is immutable after creation
- packages/praxrr-app/src/routes/arr/+page.server.ts: Instance list page loading via arrInstancesQueries.getAll(); UI impact for ENV badge
- packages/praxrr-app/src/lib/server/jobs/init.ts: initializeJobs() -- runs AFTER reconciliation; schedules jobs for all instances
- packages/praxrr-app/src/lib/server/jobs/schedule.ts: scheduleAllJobs() iterates arrInstancesQueries.getAll() -- auto-picks up new env instances
- packages/praxrr-app/src/lib/server/jobs/cleanup.ts: cleanupJobsForArrInstance() -- not needed if orphans are disabled instead of deleted
- packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts: DB mock/stub test pattern for arr_instances column testing
- packages/praxrr-app/src/tests/base/BaseTest.ts: BaseTest class with lifecycle hooks and patch() helpers for structured tests
- scripts/test.ts: Test runner with aliases; needs new 'env-instances' alias

## Relevant Tables

- arr_instances: Core table being modified; gets new `source TEXT NOT NULL DEFAULT 'ui'` column. Columns: id, name (UNIQUE), type, url, external_url, api_key (app-level unique only), tags (JSON), enabled (0/1), created_at, updated_at
- setup_state: Singleton (id=1) with default_database_linked flag. Referenced as pattern but NOT used as guard for env reconciliation (runs every startup)
- general_settings: Singleton (id=1) with apply_default_delay_profiles flag. Checked before applying delay profiles to new radarr/sonarr instances
- upgrade_configs: FK to arr_instances(id) ON DELETE CASCADE. One per instance
- arr_sync_quality_profiles: FK to arr_instances(id) ON DELETE CASCADE. Many-to-many profile selections
- arr_sync_quality_profiles_config: FK to arr_instances(id) ON DELETE CASCADE. One per instance
- arr_sync_delay_profiles_config: FK to arr_instances(id) ON DELETE CASCADE. One per instance
- arr_sync_metadata_profiles_config: FK to arr_instances(id) ON DELETE CASCADE. One per instance (lidarr-scoped)
- arr_sync_media_management: FK to arr_instances(id) ON DELETE CASCADE. One per instance
- arr_database_namespaces: FK to arr_instances(id) ON DELETE CASCADE. Composite PK
- arr_rename_settings: FK to arr_instances(id) ON DELETE CASCADE. One per instance
- upgrade_runs: FK to arr_instances(id) ON DELETE CASCADE. History records
- rename_runs: FK to arr_instances(id) ON DELETE CASCADE. History records

## Relevant Patterns

**Default-DB Auto-Link Startup Pattern**: Guard-check -> env-read -> domain-call -> mark-guard -> log-and-continue. The primary template for env instance reconciliation, except without the one-time setup_state guard. See [hooks.server.ts lines 37-91](/packages/praxrr-app/src/hooks.server.ts).

**Migration ADD COLUMN Pattern**: Simple `ALTER TABLE ... ADD COLUMN` with `NOT NULL DEFAULT` for SQLite compatibility. Import and register in migrations.ts. See [20260216_add_arr_instance_external_url.ts](/packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts).

**Query Module Pattern**: Raw parameterized SQL via db singleton (db.execute, db.query, db.queryFirst). No ORM. Queries exported as const object with typed methods. See [arrInstances.ts](/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts).

**Instance Create + Delay Profile Pattern**: Validate -> check nameExists/apiKeyExists -> create() -> optionally apply default delay profile for radarr/sonarr wrapped in try/catch. See [arr/new/+page.server.ts lines 100-142](/packages/praxrr-app/src/routes/arr/new/+page.server.ts).

**Env Var Reading Pattern**: `Deno.env.get('KEY')?.trim() || undefined` for optional values; distinguish undefined (not set) from empty string (explicitly empty). See [hooks.server.ts lines 38-46](/packages/praxrr-app/src/hooks.server.ts) and [config.ts constructor](/packages/praxrr-app/src/lib/server/utils/config/config.ts).

**Non-Blocking Startup Error Handling**: Wrap each operation in try/catch, log with `source: 'Setup'`, never throw. Per-instance error isolation so one failure doesn't block others. See [hooks.server.ts auto-link block](/packages/praxrr-app/src/hooks.server.ts).

**DB Mock/Stub Test Pattern**: Override db.execute/db.queryFirst with mock functions, capture calls, restore in finally block. See [arrExternalUrlPersistence.test.ts](/packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts).

**Type Validation Pattern**: Use `ARR_APP_TYPES` from `$shared/pcd/types.ts` or `isArrAppType()` from `$shared/arr/capabilities.ts` -- NOT `ArrType` from `$arr/types.ts` which includes 'chaptarr'. See [pcd/types.ts lines 805-806](/packages/praxrr-app/src/lib/shared/pcd/types.ts).

## Relevant Docs

**/docs/plans/initiate-apps/feature-spec.md**: You _must_ read this when working on any implementation task. Authoritative specification with all design decisions, data models, conflict resolution strategy (match by api_key, skip source='ui', disable orphans), env var reference, Docker Compose example, and phased task breakdown.

**/CLAUDE.md**: You _must_ read this when working on any code changes. Project conventions including Cross-Arr Semantic Validation Policy, path aliases, formatting rules, conventional commits, and the requirement to validate behavior per target arr_type.

**/docs/plans/initiate-apps/research-architecture.md**: You _must_ read this when working on startup integration or database changes. Exact component interfaces (ArrInstance, CreateArrInstanceInput, createArrClient signature), startup sequence with line numbers, and key dependencies map.

**/docs/plans/initiate-apps/research-patterns.md**: You _must_ read this when writing implementation code. Exact code patterns from the codebase with line references: migration registration, query structure, logger usage, env var reading, URL validation, and test infrastructure.

**/docs/plans/initiate-apps/research-integration.md**: You _must_ read this when working on database schema or sync/job integration. Complete arr_instances schema, all 10 FK-dependent tables with cascade behavior, migration registry state, and job scheduling dependencies.

**/docs/plans/initiate-apps/research-recommendations.md**: Reference for implementation strategy, phasing (Core -> Validation -> UI), risk assessment, and alternative approach analysis.

**/docs/plans/initiate-apps/research-external.md**: Reference for Arr API documentation, ecosystem tool patterns (Notifiarr, Unpackerr, Recyclarr naming conventions), and integration constraints.

**/docs/plans/initiate-apps/research-ux.md**: Reference for UI integration patterns (ENV badge, read-only banner, status indicators) and competitive analysis.

**/docs/plans/external-url/feature-spec.md**: Reference for the most recent arr_instances column addition pattern (external_url). Shows the exact file-level impact.
