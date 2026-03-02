# Integration Research: progressive-disclosure

## API Endpoints

### Existing Related Endpoints

- GET `/api/v1/health`: health check endpoint used by startup and monitoring.
- GET `/api/v1/openapi.json`: returns OpenAPI spec loaded from `docs/api/v1/openapi.yaml`.
- GET `/api/v1/system/startup-pull/latest`: reads startup pull summary from `startup_pull` queries.
- POST `/api/v1/entity-testing/evaluate`: parser + custom format evaluation endpoint, good example of request-body validation and async response shape.
- POST `/api/v1/arr/cleanup`: Arr instance maintenance action endpoint (`scan`/`execute`) with instance-aware dispatch.
- GET `/api/v1/arr/releases`: Arr release lookup by `instanceId`, optional `itemId`/`season`.
- GET `/api/v1/arr/library`: paginated library listing endpoint.
- GET `/api/v1/arr/library/episodes`: Sonarr-only episodes endpoint.
- GET `/api/v1/pcd/[databaseId]/snapshots`: list snapshots.
- POST `/api/v1/pcd/[databaseId]/snapshots`: create snapshot.
- GET `/api/v1/pcd/[databaseId]/snapshots/[snapshotId]`: read single snapshot.
- DELETE `/api/v1/pcd/[databaseId]/snapshots/[snapshotId]`: delete snapshot.
- POST `/api/v1/sync/preview`: create sync preview for selected sections.
- GET `/api/v1/sync/preview/[previewId]`: read preview.
- DELETE `/api/v1/sync/preview/[previewId]`: delete preview.
- POST `/api/v1/sync/preview/[previewId]/apply`: apply preview changes via job queue.
- GET `/api/v1/pcd/export`: export portable entity.
- POST `/api/v1/pcd/import`: import portable entity.
- GET `/api/v1/trash-guide/sources`: list TRaSH sources.
- POST `/api/v1/trash-guide/sources`: create TRaSH source.
- GET/PUT/DELETE `/api/v1/trash-guide/sources/[id]`: read/update/delete source.
- GET `/api/v1/trash-guide/sources/[id]/entities`: list entities in source.
- GET `/api/v1/trash-guide/sources/[id]/entities/[trashId]`: read entity mapping item.
- POST `/api/v1/trash-guide/sources/[id]/sync`: trigger source sync job.

- GET `/api/backups/download/[filename]`: streams backup artifact.
- GET `/api/databases/[id]/changes`: app-level DB change stream endpoint.
- GET `/api/databases/[id]/commits`: app-level commit stream.
- GET `/api/databases/[id]/generate-commit-message`: AI-assisted commit message (if enabled).
- GET `/api/ai/status`: whether AI integration is enabled.
- GET `/api/regex101/[id]`: regex101 fetch + parser test.
- GET `/api/tmdb/search`, POST `/api/tmdb/test`: TMDB integration endpoints.
- GET `/api/github/avatar/[owner]`: GitHub avatar caching endpoint.

No dedicated endpoint exists today for storing per-user UI-state (e.g., beginner/advanced + per-section flags), so this appears to be a new API area.

### Route Organization

- SvelteKit route handlers use filesystem routing with `+server.ts`.
- Two API tiers coexist:
  - Legacy/non-v1 APIs under `src/routes/api/**` (auth/settings/helper style integrations mixed with feature endpoints).
  - Primary contract-first APIs under `src/routes/api/v1/**`.
- Dynamic params are in bracketed folders/files, e.g. `[previewId]`, `[databaseId]`, `[id]`, `[trashId]`.
- Route middleware is global via `hooks.server.ts`, which delegates auth/session handling to `src/lib/server/utils/auth/middleware.ts`.
- Middleware behavior:
  - `PUBLIC_PATHS` includes auth/setup routes and `/api/v1/health`.
  - `AUTH=off` bypasses auth.
  - `AUTH=local` allows localhost bypass, otherwise auth applies.
  - API requests use strict error JSON for unauthorized; non-API requests redirect to `/auth/login`.
  - API key support for v1 via `X-Api-Key` header or `apikey` query param.
  - Auth session extension is middleware-driven (`maybeExtendSession`) on each valid request.

## Database

### Relevant Tables

- `users`: core identity records.
- `sessions`: auth sessions scoped to `users`.
- `auth_settings`: API key / session settings.
- `setup_state`: tracks initial setup state and default DB link status.
- `database_instances`: PCD DB instances.
- `pcd_ops`: append-only PCD op history (repo/local/import), used for all entity sync persistence.
- `pcd_snapshots`: generated/manual snapshot records for PCD state captures.
- `arr_instances`: Arr instance registrations.
- `arr_instance_credentials`: encrypted credentials mapped to Arr instances (1:1 to `arr_instances`).
- `jobs`, `job_runs`, `job_queue`, `job_run_history`: async work orchestration.
- `startup_pull_runs`, `startup_pull_instance_outcomes`: startup pull tracking.
- `trash_guide_sources`, `trash_guide_sync_config`, `trash_guide_sync_selections`, `trash_guide_entity_cache`, `trash_id_mappings`: TRaSH guide data model.
- `github_cache`, `regex101_cache`, `parsed_release_cache`, `pattern_match_cache`: external API/cache layers.
- `tmdb_settings`, `ai_settings`, `backup_settings`, `notification_*` tables for integrations/notifications.

### Schema Details

- No existing table currently stores per-user UI preferences; implementing progressive-disclosure persistence likely requires a new user-preference table (for example `user_interface_preferences` with `user_id` + `section_key` + `mode`).
- Auth stack:
  - `users.id` is primary key and referenced by `sessions.user_id`.
  - `sessions` includes expiry and rolling/metadata fields (`last_active_at`, `ip`, `user_agent`).
  - `auth_settings` is effectively singleton config (`id=1`) with API key and session duration.
- Arr + credential split:
  - `arr_instances.id` references credentials via `arr_instance_credentials.instance_id`.
  - credential table uses encryption fields (`ciphertext`, `nonce`, `key_version`) and migration-safe key handling.
- PCD core:
  - `database_instances` is parent for PCD metadata and ops.
  - `pcd_ops` rows carry `database_id`, source, op details, and operation sequencing.
  - `pcd_op_history` mirrors validation/audit trail.
  - `pcd_snapshots` links to `database_instances`, stores `type`, `trigger`, `ops_sequence_max_id`, op counts by layer, and cache hash for determinism.
- TRaSH feature tables (introduced in migrations) split runtime source config, sync targets, entity cache, and ID mappings; no schema coupling to Arr UI mode yet.
- Sync preview lifecycle:
  - preview rows are not only API-facing; they are also scheduled/applied through job tables.
- Migrations to reference (not just schema.sql snapshot):
  - startup pull tables: `20260223` (check exact migration filename in repo).
  - TRaSH guide tables: `20260226`, and normalization pass `20260227`.
  - `pcd_snapshots` table: `20260228`.
- For this feature, migration work should include:
  - new table with indexes for `user_id` and `(user_id, section_key)` uniqueness.
  - potentially a schema migration plus seed/init if default visibility state must exist per user/section.

## External Services

- Arr APIs (Radarr / Sonarr / Lidarr):
  - Each instance has auth/URL stored per `arr_instances` + credential table.
  - Calls are mediated via server-side Arr client modules (`$arr/*`) with arr_type dispatch.
- Parser service:
  - C# microservice integration for release parsing / regex matching / test workflows.
  - Configured by `PARSER_HOST` + `PARSER_PORT`.
- GitHub API:
  - Avatar fetch route, plus Git/PCD repo interaction through internal git utilities (clone/pull/commit workflows).
  - Token-based flows via default DB envs where relevant.
- TMDB API:
  - Used for enrichment/search endpoints and test validation.
- regex101 API:
  - Used to fetch regex source and test it locally via parser.
- AI service:
  - Commit-message generation and status endpoint indicate optional AI integration.
- Notification providers:
  - In-app notification abstraction + provider modules (Discord/others by config) via `notification_services`.
- OIDC provider(s):
  - `AUTH=oidc` mode uses OIDC discovery/client config.
- Backup/exports:
  - Artifact streaming endpoint for backup retrieval indicates filesystem I/O but no separate external API dependency for this feature.

## Internal Services

- `$pcd/*`:
  - PCD ops compiler, reader/writer, snapshot handling, import/export validators.
- `$arr/*`:
  - Instance orchestration, credential-backed clients for Radarr/Sonarr/Lidarr, release/library/cleanup dispatch.
- `$sync/*`:
  - Preview generation, section application, and sync handlers.
- `$jobs/*`:
  - Queue persistence and async worker execution for long-running actions (sync apply, cleanup/sync refresh, TRaSH sync, startup pull).
- `$trashguide/*`:
  - TRaSH source discovery/sync/cache mapping domain logic.
- `$cache/*`:
  - In-memory request-level caches for expensive Arr/library/parser reads.
- `$github/*`, `$tmdb/*`, `$ai/*`, `$http/*`:
  - Service wrappers with typed HTTP + centralized error handling.
- `$auth/*`, `hooks.server.ts`:
  - Global request middleware and auth/session behavior.
- Inter-service communication is in-process module calls plus DB-backed async job table for deferred work; there is no separate internal message broker.

## Configuration

- Auth/session:
  - `AUTH` (`on|local|off|oidc`)
  - `ARR_CREDENTIAL_MASTER_KEY`, `ARR_CREDENTIAL_MASTER_KEY_VERSION`, `ARR_CREDENTIAL_PREVIOUS_KEYS`/`ARR_CREDENTIAL_MASTER_KEYS`
  - OIDC: `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- App/runtime:
  - `APP_BASE_PATH`, `HOST`, `PORT`, `TZ`
  - `PARSER_HOST`, `PARSER_PORT`
- Startup/data source defaults:
  - `PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, `PRAXRR_DEFAULT_DB_NAME`
  - `PRAXRR_DEFAULT_DB_TOKEN`, `PRAXRR_DEFAULT_DB_GIT_USERNAME`, `PRAXRR_DEFAULT_DB_GIT_EMAIL`
- Pull/sync behavior:
  - `PULL_ON_START`, `PULL_ON_START_MAX_CONCURRENCY`, `PULL_ON_START_TIMEOUT_MS`
  - `PRAXRR_VALIDATE_INSTANCES`
- Third-party:
  - TMDB and GitHub/AI keys are consumed through service/config layers (not all names enumerated in this pass; implementation should check provider config modules before adding UI state features).
- Config files of interest for this feature:
  - `packages/praxrr-app/src/lib/server/utils/config/config.ts`
  - route and server hooks in `packages/praxrr-app/src/hooks.server.ts`
  - auth middleware at `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`
  - DB migrations in `packages/praxrr-app/src/lib/server/db/migrations/`.
