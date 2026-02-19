# Integration Research: monorepo-strategy

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/health`: returns component statuses (SQLite/migration health, repo caches, job
  queue/backups/logs) by reading `migrationRunner`, `databaseInstancesQueries`, `jobQueueQueries`,
  `backupSettingsQueries`, `appInfoQueries`, and `pcdManager.getCache`. Useful for guarding the
  system after relocating the code into `packages/praxrr` and keeping track of migrations referenced
  in `packages/praxrr-app/src/lib/server/db/migrations.ts`.
- `GET /api/databases`: mirrors `pcdManager.getAll()` and surfaces every linked Praxrr Config
  Database (`packages/praxrr-app/src/routes/api/databases/+server.ts`). This is the UI entry point for the database
  dashboard, so the monorepo move needs to keep the `pcdManager` API stable.
- `GET /api/databases/:id/changes`: gathers git status, incoming changes, branches, and draft PCD
  edits via `databaseInstancesQueries`, `getStatus`, `listDraftEntityChanges`, and `getRepoInfo`
  (`packages/praxrr-app/src/routes/api/databases/[id]/changes/+server.ts`). It depends on `pcd` clones and Git helpers,
  so workspace relocation must keep those paths intact.
- `GET /api/databases/:id/commits`: exposes git history for a database by calling `getCommits` and
  reading from `databaseInstancesQueries` (`packages/praxrr-app/src/routes/api/databases/[id]/commits/+server.ts`).
  Commit generation for monorepo-shared `packages/praxrr-db` needs to treat these references as
  pointing to whatever clone the UI is working with.
- `POST /api/databases/:id/generate-commit-message`: forwards diffs to the AI client when
  `aiSettings` enables it (`packages/praxrr-app/src/routes/api/databases/[id]/generate-commit-message/+server.ts`), so
  the new monorepo layout must keep AI configuration and `ai_settings` (migration
  `014_create_ai_settings.ts`) consistent with the `pcd_ops` files that get committed.
- `GET /api/v1/pcd/export`: serializes delay profiles, quality profiles, names, and media settings
  from the requested cache via `serializeEntity` and `pcdManager`
  (`packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`). The monorepo change should not affect the cache
  registration logic in `pcd/database/registry.ts`.
- `POST /api/v1/pcd/import`: validates portable payloads, gates base-layer writes with
  `canWriteToBase`, and deserializes into the cache via `deserializeEntity` helpers
  (`packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`). Maintaining the schema alias resolution for `ops/`
  files is vital for the shared `packages/praxrr-db` package.
- `POST /api/v1/arr/cleanup`: scans or executes namespace cleanup via arr clients,
  `scanForStaleItems`, and `deleteStaleItems` (`packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`). It
  touches the same arr sync configuration that lives in tables created by migration
  `015_create_arr_sync_tables.ts` and thus needs compatible database access after directory moves.
- `GET /api/v1/arr/library`: fetches paginated Radarr/Sonarr/Lidarr libraries, applies query/sort
  sanitization, and caches results (`packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`). Because it
  instantiates arr clients in `packages/praxrr-app/src/lib/server/utils/arr/clients`, ensuring those utility paths
  survive the move is critical.
- `GET /api/v1/arr/releases`: runs interactive searches through `RadarrClient`, `SonarrClient`, or
  `LidarrClient` and deduplicates them via `group*Releases` helpers
  (`packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`). Monorepo restructuring should keep these client
  factories in `$utils/arr/` available to the route.
- `GET /api/tmdb/search` and `POST /api/tmdb/test`: proxy TMDB Movie/TV search and key validation
  through `TMDBClient` and the singleton `tmdb_settings` row
  (`packages/praxrr-app/src/routes/api/tmdb/search/+server.ts`, `packages/praxrr-app/src/routes/api/tmdb/test/+server.ts`). TMDB integration
  requires no code change but must keep the `tmdb_settings` migration
  (`020_create_tmdb_settings.ts`) and API key persistence intact.
- `GET /api/regex101/:id`: fetches regex definitions from regex101.com, caches them to
  `regex101_cache`, and validates unit tests via the parser service
  (`packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`). The parser spawn logic in
  `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` runs before `hooks.server.ts` and must still be reachable
  after moving `hooks.server.ts` into `packages/praxrr`.
- `GET /api/github/avatar/:owner`: returns cached avatars from `github_cache`
  (`packages/praxrr-app/src/routes/api/github/avatar/[owner]/+server.ts`) and therefore depends on the `github_cache`
  table created by migration `033_create_github_cache.ts` and the GitHub cache helpers in
  `$lib/server/utils/github/cache.ts` that wrap GitHub API calls for repo info and releases.

### Route Organization

- The SvelteKit project keeps API handlers inside `packages/praxrr-app/src/routes/api` (e.g., `api/databases`,
  `api/tmdb`, `api/regex101`), while versioned service endpoints live under `packages/praxrr-app/src/routes/api/v1`
  (e.g., `/api/v1/pcd`, `/api/v1/arr`, `/api/v1/health`). Both the `+server.ts` handlers and the
  companion `+page.server.ts` modules (like `/databases/new/+page.server.ts`) import the same `$lib`
  helpers, so `packages/praxrr` must carry along the `packages/praxrr-app/src/lib` tree intact when the monorepo
  resizes.
- `packages/praxrr-app/src/routes/databases/new/+page.server.ts` orchestrates `pcdManager.link()` and logs via `logger`,
  so any path reorganization must leave `$pcd/index.ts`, `$db/queries`, and `jobs/init.ts`
  reachable. The `pcdManager` also calls `schedulePcdSyncForDatabase`, linking APIs to the job queue
  described below.
- All HTTP traffic funnels through `hooks.server.ts`, which now needs to live in the
  `packages/praxrr` package. On startup it initializes the config singleton
  (`packages/praxrr-app/src/lib/server/utils/config/config.ts`), database (`$db/db.ts`), migrations, log settings, PCD
  caches, auto-link default DB (via `setupStateQueries` and `pcdManager`), job queue
  (`initializeJobs`), expired session cleanup, and the parser spawn helper. The exported `handle`
  function performs authentication via `$auth/middleware.ts`, redirects to `/auth/setup` when
  needed, enforces `AUTH=off`/`local`, respects `isPublicPath`, and slides session expiry with
  `maybeExtendSession`. Preserving these middleware semantics is essential for the monorepo
  restructuring.

## Database

### Relevant Tables

- `database_instances` (migrations `008_create_database_instances.ts`,
  `009_add_personal_access_token.ts`, `010_add_is_private.ts`,
  `043_add_git_identity_to_database_instances.ts`,
  `044_add_conflict_strategy_to_database_instances.ts`): tracks each linked Praxrr Config Database
  with `uuid`, `repository_url`, `local_path`, `sync_strategy`, `auto_pull`, credential fields
  (`personal_access_token`, git identity), `conflict_strategy`, and `enabled`. References to
  `database_instances.id` appear in `pcd_ops`, `pcd_op_history`, `arr_sync_*`, `job_queue` payloads,
  and `schedulePcdSyncForDatabase` since the `pcdManager` relies on these rows when cloning or
  syncing repos.
- `arr_instances` (`001_create_arr_instances.ts` plus later
  `20260216_add_arr_instance_external_url.ts`): stores Radarr/Sonarr/Lidarr/Readarr/Prowlarr
  connection info read by the arr endpoints and the sync processor. Foreign keys from `arr_sync_*`
  tables and `arr_database_namespaces` tie sync behavior to these rows.
- `pcd_ops` (`041_create_pcd_ops.ts`) and `pcd_op_history` (`042_create_pcd_op_history.ts`):
  base/user SQL operations imported from repo files or seeded built-ins. `pcd_ops` stores ordering
  (`sequence`, `op_number`), origin (`base`/`user`), state (`published`/`draft`), content hashes,
  and metadata; it is indexed by `idx_pcd_ops_apply_order`, `idx_pcd_ops_base_filename`, and
  `idx_pcd_ops_hash` for efficient application ordering during cache builds. `pcd_op_history`
  records per-op statuses (applied/skipped/conflicted), timestamps, and conflict reasons for
  auditing imported ops.
- `setup_state` (`039_create_setup_state.ts`): singleton row (`id=1`) with `default_database_linked`
  flag. This gate determines whether the startup hook calls `pcdManager.link()` for the default
  database, so the new `PRAXRR_DEFAULT_DB_*` env vars must still respect this table.
- `arr_sync_*` tables (`015_create_arr_sync_tables.ts`, `016_add_should_sync_flags.ts`,
  `028_simplify_delay_profile_sync.ts`, `029_add_database_id_foreign_keys.ts`,
  `034_add_sync_status.ts`, `038_add_media_management_config_names.ts`, plus
  `20260218_add_lidarr_metadata_profiles.ts`): store trigger configuration, cron expressions,
  `sync_status`, `next_run_at`, last error, database references, and namespace indexes for quality
  profiles, delay profiles, metadata profiles, and media management settings. They all reference
  `arr_instances.id` (and `database_instances.id` once `database_id` fields were added) and feed the
  sync processor in `packages/praxrr-app/src/lib/server/sync/processor.ts`.
- `arr_database_namespaces` (`047_create_arr_database_namespaces.ts`): maps each
  `(instance_id, database_id)` pair to `namespace_index`, ensuring the cleanup job can distinguish
  namespace-suffixed configs.
- Job tables: `jobs`/`job_runs` (`004_create_jobs_tables.ts`, `035_add_job_skipped_status.ts`) keep
  general job metadata, while `job_queue`/`job_run_history` (`049_create_job_queue.ts`) contain
  scheduled runs, dedupe keys, status, and payload JSON. These back the `initializeJobs`,
  `jobDispatcher`, and `jobDispatcher.schedule*` helpers that enqueue PCD syncs, arr syncs,
  upgrades, renames, and backups.
- `tmdb_settings` (`020_create_tmdb_settings.ts`): singleton storing the TMDB API key consumed by
  `TMDBClient`; the `/api/tmdb/test` route writes it via `tmdbSettingsQueries`.
- `ai_settings` (`014_create_ai_settings.ts`): stores AI provider configuration (api_url, api_key,
  model, `enabled`). `ai/client.ts` reads this row when `generate-commit-message` is invoked.
- Caching tables: `regex101_cache` (`017_create_regex101_cache.ts`) stores regex101 responses,
  `github_cache` (`033_create_github_cache.ts`) caches repo/avatars/releases, `parsed_release_cache`
  (`021_create_parsed_release_cache.ts`) and `pattern_match_cache`
  (`023_create_pattern_match_cache.ts`) speed up parser and regex operations.
- Auth tables: `users`, `sessions`, and `auth_settings` (`036_create_auth_tables.ts`,
  `037_add_session_metadata.ts`) underpin the middleware in `hooks.server.ts` that gate the API
  routes.

### Schema Details

The schema file `packages/praxrr-app/src/lib/server/db/schema.sql` documents every column, constraint, and index. Key relationships: `database_instances.id` is the foreign key target for `pcd_ops.database_id`, `pcd_op_history.database_id`, `arr_sync_*` tables, and namespace mapping; `arr_instances.id` is referenced by every `arr_sync_*` table. The `pcd_ops` table maintains unique `(database_id, origin, filename)` via `idx_pcd_ops_base_filename` and orders operations through the multi-column `idx_pcd_ops_apply_order`. The job queue uses `dedupe_key`, `status`, and `run_at` indexes (`idx_job_queue_dedupe_key`, `idx_job_queue_status_run_at`) to avoid duplicate sync runs and to prioritize due jobs. `setup_state` exists as a singleton row with a simple boolean, so bootstrapping the default database is controlled centrally. All of these tables are recreated via the migrations listed above, which the monorepo upgrade must run in order so `packages/praxrr` (the new app package) still sees the same schema.

## External Services

- **GitHub (PCD deps, schema fetch, mirrors)**: `pcdManager.link()` clones arbitrary git URLs and
  the `processDependencies` helpers clone `pcd.json` dependencies (e.g., the canonical
  `https://github.com/yandy-r/praxrr-schema` entry) before importing them
  (`packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts`). `scripts/generate-pcd-types.ts` presently fetches
  `https://raw.githubusercontent.com/yandy-r/praxrr-schema/{version}/ops/0.schema.sql`, reading
  tokens from `PRAXRR_SCHEMA_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`; the monorepo change wants this
  to default to `packages/praxrr-schema/ops/0.schema.sql` while keeping the ability to override with
  a remote branch. Publish workflows will continue to mirror
  `packages/praxrr-db`/`packages/praxrr-schema` back to their GitHub repos, so
  `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` should still point to those mirrors until
  the new packages are ready.
- **TMDB**: `TMDBClient` in `packages/praxrr-app/src/lib/server/utils/tmdb/client.ts` calls
  `https://api.themoviedb.org/3` with the `tmdb_settings.api_key` bearer token. `/api/tmdb/search`
  and `/api/tmdb/test` validate and exercise that key, so the TMDB key must be written through the
  app’s settings UI (persisted to `tmdb_settings`) after the monorepo move.
- **regex101.com**: `/api/regex101/:id` hits the regex101 public REST API, caches responses in
  `regex101_cache`, and then evaluates the suite by forwarding patterns to the parser service for
  match results (`regex101CacheQueries` + `runRegexTests`). No credentials are required, but caching
  ensures the third-party URL path remains consistent after relocation.
- **AI providers (OpenAI/Anthropic style)**: The AI client (`packages/praxrr-app/src/lib/server/utils/ai/client.ts`)
  talks to an OpenAI-compatible base URL stored in `ai_settings.api_url`, using
  `ai_settings.api_key` for `Authorization`. The `/api/databases/:id/generate-commit-message`
  endpoint guards this with `isAIEnabled()` and uses either the Responses API or the chat
  completions API depending on whether `model` starts with `gpt-5`. The new package layout must keep
  this table and the `ai` helpers reachable.

## Internal Services

- **PCD Manager (`pcdManager`)**: Located at `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`, it orchestrates
  cloning (`clone`, `checkout`, `getStatus` from `$utils/git`), manifest validation, dependency
  processing (`processDependencies`), base op import (`importBaseOps`), built-in op seeding
  (`seedBuiltInBaseOps`), cache compilation (`compile`), and cache invalidation. The
  `hooks.server.ts` startup sequence calls `pcdManager.initialize()` and auto-links the default
  database via `setupStateQueries` and `pcdManager.link()`; these calls must still happen when the
  app lives under `packages/praxrr`.
- **Job subsystem**: `initializeJobs`, `jobQueue`, and `jobDispatcher` in `packages/praxrr-app/src/lib/server/jobs/*`
  schedule recurring syncs (PCD pull, arr sync, upgrades, renames, backups) by enqueuing records in
  `job_queue`. Many routes (e.g., `/databases/new`) call `schedulePcdSyncForDatabase` to spin up a
  job for the new repo. The job dispatcher also powers the sync processor by calling
  `processPendingSyncs` through `triggerSyncs()` after a pull.
- **Sync processor**: `packages/praxrr-app/src/lib/server/sync/processor.ts` groups scheduled `arr_sync_*` configs by
  instance, creates arr clients from `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`, and runs each section
  handler (`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`). That
  processor fires when `triggerSyncs()` is called after `pcdManager.sync()` or when cron timers in
  `evaluateScheduledSyncs()` tick, so monorepo changes must preserve these handlers and their
  registry entries.
- **Arr clients and cleanup helpers**: `packages/praxrr-app/src/lib/server/utils/arr/clients` hosts `RadarrClient`,
  `SonarrClient`, and `LidarrClient`, while `sync/cleanup.ts` implements namespace cleanup used by
  `/api/v1/arr/cleanup`. Keeping the `$utils/arr` directory in place ensures the arr-based API
  endpoints continue to function.
- **Parser service**: `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` tries to auto-start the bundled `.NET`
  parser (from `packages/praxrr-parser`) when `PARSER_HOST` is unset and the app isn’t running in
  Docker. `config.parserUrl` is then used by regex101 and other HTTP handlers; the spawn logic must
  still run before `hooks.server.ts` imports `$config` so parser-based features stay available in
  the new package layout.
- **AI client**: `ai/client.ts` caches the HTTP client for the AI provider and is invoked by
  `/api/databases/:id/generate-commit-message`. Making sure `ai_settings` is populated before the
  route is hit ensures the commit message workflow survives the move.

## Configuration

- **Environment variables** (see `packages/praxrr-app/src/lib/server/utils/config/config.ts` and the startup logic in
  `hooks.server.ts`):
  1. `APP_BASE_PATH`: root of `logs`, `data/databases`, and `backups`; defaults to the directory
     containing the executable. The monorepo move must keep this path configuration intact relative
     to `packages/praxrr/dist`.
  2. `TZ`: timezone fallback for logging.
  3. `PARSER_HOST`/`PARSER_PORT`: override the parser microservice if it runs separately; otherwise
     the startup helper spawns `praxrr-parser` and sets these values.
  4. `PORT`/`HOST`: bind address for the SvelteKit server.
  5. `AUTH` (and `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`): control auth mode
     (`on`, `local`, `off`, `oidc`) and influence `hooks.server.ts` behavior.
  6. `PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, `PRAXRR_DEFAULT_DB_NAME`,
     `PRAXRR_DEFAULT_DB_SYNC_STRATEGY`, `PRAXRR_DEFAULT_DB_TOKEN`, `PRAXRR_DEFAULT_DB_GIT_USERNAME`,
     `PRAXRR_DEFAULT_DB_GIT_EMAIL`: new env vars recommended by the monorepo plan to make the
     auto-link default repo configurable; `hooks.server.ts` currently hardcodes the GitHub defaults,
     so these vars must be introduced when `packages/praxrr` is created.
  7. `PRAXRR_SCHEMA_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`: tokens consumed by
     `scripts/generate-pcd-types.ts` when it fetches schema SQL via the GitHub raw URL, to be
     replaced or augmented by a local path after the migration.
  8. Feature-specific settings persisted in tables: `tmdb_settings.api_key` for TMDB, `ai_settings`
     for the AI provider, and `auth_settings` for session duration/API key.
- **Deno configuration**: the root `deno.json` will become a bare workspace manifest that lists
  `packages/praxrr`, `packages/praxrr-api`, `packages/praxrr-db`, and `packages/praxrr-schema` and
  defines high-level tasks that `cd` into `packages/praxrr`. The existing root `deno.json` (which
  currently hosts `$lib` import maps, tasks, `compilerOptions`, `fmt`, `lint`, `allowScripts`) must
  move into `packages/praxrr/deno.json`, preserving aliases such as `$pcd/`, `$db/`, `$utils/`, and
  tasks like `deno task dev`. `packages/praxrr-db` and `packages/praxrr-schema` will each get
  minimal `deno.json` manifests to track `name`/`version`. The monorepo strategy also reuses the
  existing `packages/praxrr-api` member, so any reference to `$api/v1.d.ts` (e.g.,
  `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`) must still resolve via the new workspace structure.
- **Scripts**: `scripts/generate-pcd-types.ts` (which currently fetches from GitHub) should default
  to `packages/praxrr-schema/ops/0.schema.sql` with a `--remote` fallback; `scripts/bundle-api.ts`
  (which writes to `packages/praxrr-api`) already spans multiple packages, so keeping it at the repo
  root (as described in the migration plan) is important for the monorepo.
- **App settings**: `hooks.server.ts` logs the startup banner, registers log settings, and
  initializes the job queue before `handle` runs; these steps must be preserved when the file moves
  into `packages/praxrr`.
