# Integration Research: initiate-apps

Environment-variable-based Arr instance provisioning at startup. This document catalogs the complete database schema for `arr_instances` and all referencing tables, the migration system, existing CRUD endpoints, Arr client infrastructure, job/sync dependencies, and configuration patterns -- everything needed to implement the `source` column addition and the `reconcileEnvInstances()` startup function.

## API Endpoints

### Existing Related Endpoints

- **GET /arr** (page load): `packages/praxrr-app/src/routes/arr/+page.server.ts` -- Calls `arrInstancesQueries.getAll()`, returns all instances ordered by name.
- **POST /arr?/delete** (form action): Same file -- Calls `cleanupJobsForArrInstance(id)` then `arrInstancesQueries.delete(id)`. Redirects to `/arr`.
- **POST /arr/new** (form action): `packages/praxrr-app/src/routes/arr/new/+page.server.ts` -- Validates name/type/url/apiKey, checks `nameExists()` and `apiKeyExists()`, creates instance, optionally applies default delay profile for radarr/sonarr via `createArrClient` and `getDefaultDelayProfile`.
- **POST /arr/[id]/settings?/update** (form action): `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` -- Validates fields, checks name/apiKey uniqueness excluding current ID, calls `arrInstancesQueries.update()`.
- **POST /arr/[id]/settings?/delete** (form action): Same file -- Calls `cleanupJobsForArrInstance(id)` then `arrInstancesQueries.delete(id)`. Redirects to `/arr`.
- **POST /arr/test** (API endpoint): `packages/praxrr-app/src/routes/arr/test/+server.ts` -- Accepts `{type, url, apiKey}` JSON, creates client with 3s timeout / 0 retries, calls `testConnection()`, returns `{success: boolean}`.

### Route Organization

Routes follow the SvelteKit file-based pattern under `packages/praxrr-app/src/routes/arr/`:

- `/arr` -- Instance list (load + delete action)
- `/arr/new` -- Create form (default action)
- `/arr/[id]/settings` -- Edit/delete (update + delete actions)
- `/arr/[id]/...` -- Other child routes (sync config, library view, etc.) loaded via `[id]/+layout.server.ts`
- `/arr/test` -- Connection test API endpoint (POST, JSON body)

Valid types enforced at route level: `['radarr', 'sonarr', 'lidarr']` (hardcoded array in `arr/new/+page.server.ts` line 11 and `arr/test/+server.ts` line 6).

## Database

### arr_instances Table (Complete Definition)

```sql
CREATE TABLE arr_instances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,              -- User-friendly name
    type         TEXT NOT NULL,                     -- radarr, sonarr, lidarr
    url          TEXT NOT NULL,                     -- Base URL (e.g., http://localhost:7878)
    external_url TEXT,                              -- Optional browser URL override (migration 20260216)
    api_key      TEXT NOT NULL,                     -- API key (unique enforced at app level, NOT SQL level)
    tags         TEXT,                              -- JSON array of strings, or null
    enabled      INTEGER NOT NULL DEFAULT 1,        -- 1=enabled, 0=disabled
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Key constraints:

- `name` has a SQL-level UNIQUE constraint (case-sensitive).
- `api_key` uniqueness is enforced only at the application level via `arrInstancesQueries.apiKeyExists()` -- there is NO SQL UNIQUE constraint on `api_key`.
- `type` has no CHECK constraint -- validation is purely at the route handler level.
- No index on `api_key` exists (relevant for the env reconciliation `api_key` lookup pattern).

### Tables Referencing arr_instances via Foreign Key

All of the following have `ON DELETE CASCADE` unless noted otherwise:

1. **upgrade_configs** (`packages/praxrr-app/src/lib/server/db/schema.sql`)
   - `arr_instance_id INTEGER NOT NULL UNIQUE` -- One upgrade config per instance
   - `FOREIGN KEY (arr_instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

2. **arr_sync_quality_profiles** (many-to-many profile selections)
   - `instance_id INTEGER NOT NULL` -- Composite PK with `(instance_id, database_id, profile_name)`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

3. **arr_sync_quality_profiles_config** (one per instance)
   - `instance_id INTEGER PRIMARY KEY`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

4. **arr_sync_delay_profiles_config** (one per instance)
   - `instance_id INTEGER PRIMARY KEY`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

5. **arr_sync_metadata_profiles_config** (one per instance, lidarr-scoped)
   - `instance_id INTEGER PRIMARY KEY`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

6. **arr_sync_media_management** (one per instance)
   - `instance_id INTEGER PRIMARY KEY`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

7. **arr_database_namespaces** (per-instance, per-database namespace index)
   - `instance_id INTEGER NOT NULL` -- Composite PK with `(instance_id, database_id)`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

8. **arr_rename_settings** (one per instance)
   - `arr_instance_id INTEGER NOT NULL UNIQUE`
   - `FOREIGN KEY (arr_instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

9. **upgrade_runs** (history, many per instance)
   - `instance_id INTEGER NOT NULL`
   - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

10. **rename_runs** (history, many per instance)
    - `instance_id INTEGER NOT NULL`
    - `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`

**Total: 10 tables reference arr_instances(id), all with ON DELETE CASCADE.**

This means deleting an instance automatically cascades through all sync config, upgrade config, rename settings, namespace assignments, and run history. This is why the feature spec recommends disabling orphaned env instances (`enabled=0`) rather than deleting them -- to preserve these relationships.

### setup_state Table

```sql
CREATE TABLE setup_state (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    default_database_linked  INTEGER NOT NULL DEFAULT 0,  -- 1=default db linked
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Singleton pattern (id=1). Used by the default database auto-link guard in `hooks.server.ts`. The feature spec explicitly states env instance reconciliation should NOT use a setup_state guard -- it runs every startup to detect env var changes.

### general_settings Table

```sql
CREATE TABLE general_settings (
    id                            INTEGER PRIMARY KEY CHECK (id = 1),
    apply_default_delay_profiles  INTEGER NOT NULL DEFAULT 1,  -- 1=apply when adding arr
    created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Singleton pattern (id=1). Relevant because new env-sourced Radarr/Sonarr instances should check `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` before applying default delay profiles (same as the UI create flow in `arr/new/+page.server.ts`).

### Migration Registry

**Total Migrations**: 56 registered in `packages/praxrr-app/src/lib/server/db/migrations.ts`

**Version Numbering**: Two schemes coexist:

- Sequential: `001` through `049` (numeric IDs 1-49)
- Date-based: `20260215`, `20260216` (x2), `20260217`, `20260218`, `20260219`

**Latest Migration Version**: `20260219` (`seed_default_lidarr_metadata_profile`)

**Next Available Version**: `20260220` (using date-based convention for today, 2026-02-19, or `20260220` if targeting tomorrow's date)

**How to Add a New Migration**:

1. Create file: `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_description.ts`
2. Export a `Migration` object:
   ```typescript
   import type { Migration } from '../migrations.ts';
   export const migration: Migration = {
     version: YYYYMMDD,    // Numeric, must be unique and > all existing versions
     name: 'Description',  // Human-readable name
     up: `SQL statements`, // DDL/DML to apply
     down?: `SQL`,         // Optional rollback SQL
     afterUp?: () => void, // Optional callback for data migrations (runs outside transaction)
   };
   ```
3. Add static import in `packages/praxrr-app/src/lib/server/db/migrations.ts`:
   ```typescript
   import { migration as migrationYYYYMMDD } from './migrations/YYYYMMDD_description.ts';
   ```
4. Add to the `loadMigrations()` array.
5. Update `packages/praxrr-app/src/lib/server/db/schema.sql` reference documentation.

**Migration Interface**:

```typescript
export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
  afterUp?: () => void;
}
```

The runner sorts by version, skips already-applied migrations, executes `up` SQL inside a transaction, records in the `migrations` table, then optionally calls `afterUp()` outside the transaction.

## Arr Client Infrastructure

### Factory Pattern

`packages/praxrr-app/src/lib/server/utils/arr/factory.ts`

```typescript
function createArrClient(
  type: ArrType,
  url: string,
  apiKey: string,
  options?: ArrClientOptions
): BaseArrClient;
```

- Returns typed client: `RadarrClient`, `SonarrClient`, `LidarrClient`, or `ChaptarrClient`
- `ArrType` from `$arr/types.ts`: `'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'`
- `ArrClientOptions`: `{ timeout?: number; retries?: number }`

### Base Client

`packages/praxrr-app/src/lib/server/utils/arr/base.ts`

- Extends `BaseHttpClient` with `X-Api-Key` header
- Default API version: `v3` (Lidarr overrides to `v1`)
- `testConnection()`: Calls `GET /api/{version}/system/status`, returns `boolean`, logs success/failure with app name/version/OS
- Connection test in `arr/test/+server.ts` uses `{ timeout: 3000, retries: 0 }` for quick feedback

### Supported Client Types

| Type     | Client Class     | API Version | Module Path                                    |
| -------- | ---------------- | ----------- | ---------------------------------------------- |
| radarr   | `RadarrClient`   | v3          | `$arr/clients/radarr.ts`                       |
| sonarr   | `SonarrClient`   | v3          | `$arr/clients/sonarr.ts`                       |
| lidarr   | `LidarrClient`   | v1          | `$arr/clients/lidarr.ts`                       |
| chaptarr | `ChaptarrClient` | --          | `$arr/clients/chaptarr.ts` (not for instances) |

### Default Delay Profiles

`packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`

- `getDefaultDelayProfile(arrType: 'radarr' | 'sonarr')` -- Only supports radarr and sonarr (throws for other types)
- Applied to the default delay profile (id=1) via `client.updateDelayProfile(1, {...})`
- Called during instance creation in `arr/new/+page.server.ts` when `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` returns true
- Non-blocking: failure is logged as warning, does not prevent instance creation

### URL Validation

`packages/praxrr-app/src/lib/server/utils/validation/url.ts`

- `parseOptionalAbsoluteHttpUrl(rawUrl)`: Returns `{ value: string | null, isValid: boolean }`
- Validates against `http:` and `https:` schemes only
- `null` / empty string / whitespace-only all return `{ value: null, isValid: true }`
- Relevant for validating `external_url` from env vars

### Type Definitions

`packages/praxrr-app/src/lib/shared/pcd/types.ts`:

```typescript
export const ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;
export type ArrAppType = (typeof ARR_APP_TYPES)[number];
```

`packages/praxrr-app/src/lib/server/utils/arr/types.ts`:

```typescript
export type ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'chaptarr';
```

The env instance parser should use `ARR_APP_TYPES` from shared types (excludes `chaptarr`) for validation, matching what the UI routes enforce.

## Job and Sync Dependencies

### Job Initialization

`packages/praxrr-app/src/lib/server/jobs/init.ts`

- `initializeJobs()`: Recovers stalled jobs, calls `scheduleAllJobs()`, starts the dispatcher
- Must run AFTER env instance reconciliation so newly created instances get their jobs scheduled

### Job Scheduling

`packages/praxrr-app/src/lib/server/jobs/schedule.ts`

- `scheduleAllJobs()`: Iterates ALL `arrInstancesQueries.getAll()`, for each instance calls:
  - `scheduleArrSyncForInstance(instance.id)` -- Schedules sync jobs based on trigger config
  - `scheduleUpgradeForInstance(instance.id)` -- Schedules upgrade jobs if enabled
  - `scheduleRenameForInstance(instance.id)` -- Schedules rename jobs if enabled
- Also schedules PCD sync, backup, and log cleanup jobs (not instance-dependent)

This means newly created env instances will automatically get their jobs scheduled when `initializeJobs()` runs. No special job setup is needed in the reconciliation function.

### Job Cleanup on Instance Deletion

`packages/praxrr-app/src/lib/server/jobs/cleanup.ts`

- `cleanupJobsForArrInstance(instanceId)`: Removes queued jobs of types `arr.upgrade`, `arr.rename`, `arr.sync`, `arr.sync.qualityProfiles`, `arr.sync.delayProfiles`, `arr.sync.mediaManagement`, `arr.sync.metadataProfiles` matching the instance ID in payload
- Called by both the `/arr` list page delete action and the `/arr/[id]/settings` delete action
- If orphaned env instances are only disabled (not deleted), cleanup is NOT needed -- jobs simply will not trigger for disabled instances

### Sync Configuration

`packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

- Provides per-instance sync config for quality profiles, delay profiles, media management, and metadata profiles
- All sync config tables use `instance_id` FK to `arr_instances(id)` with `ON DELETE CASCADE`
- Sync status tracking: `idle -> pending -> in_progress -> idle/failed`
- `recoverInterruptedSyncs()`: Resets `in_progress` back to `pending` on startup
- Newly created env instances will have NO sync config until the user configures them via the UI

## Configuration

### Existing Env Var Patterns

`packages/praxrr-app/src/lib/server/utils/config/config.ts`

The `Config` class reads env vars eagerly in the constructor (module import time):

- `APP_BASE_PATH` -- Application base directory
- `TZ` -- Timezone
- `PARSER_HOST` / `PARSER_PORT` -- Parser service location
- `PORT` / `HOST` -- Server bind config
- `AUTH` -- Auth mode (`on|local|off|oidc`)
- `OIDC_DISCOVERY_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` -- OIDC config

The config class does NOT currently handle any instance-related env vars.

### Default Database Env Vars (Precedent Pattern)

Read directly in `hooks.server.ts` (NOT via config singleton):

- `PRAXRR_DEFAULT_DB_URL` -- Default PCD repository URL (undefined=use default, empty string=disable)
- `PRAXRR_DEFAULT_DB_BRANCH` -- Default branch (default: `v2`)
- `PRAXRR_DEFAULT_DB_NAME` -- Default name (default: `Praxrr-DB`)
- `PRAXRR_DEFAULT_DB_TOKEN` -- PAT for private repos
- `PRAXRR_DEFAULT_DB_GIT_USERNAME` / `PRAXRR_DEFAULT_DB_GIT_EMAIL` -- Git identity

This is the closest precedent for the env instance feature. Key patterns to follow:

- Read env vars directly where needed (not via config singleton)
- Use `Deno.env.get()` with `.trim()` and fallback defaults
- Guard with a one-time flag (setup_state) -- BUT env instances should NOT use a one-time guard since they must reconcile on every startup
- Wrap in try/catch, log failures as warnings, never block startup

### Proposed New Env Vars

Per the feature spec:

```
{APP}_INSTANCE_URL_{N}            # Required: Base URL
{APP}_INSTANCE_API_KEY_{N}        # Required: API key
{APP}_INSTANCE_NAME_{N}           # Optional: Display name
{APP}_INSTANCE_EXTERNAL_URL_{N}   # Optional: Browser URL
{APP}_INSTANCE_TAGS_{N}           # Optional: Comma-separated tags
{APP}_INSTANCE_ENABLED_{N}        # Optional: true|false (default: true)
PRAXRR_VALIDATE_INSTANCES=false   # Optional: Test connections at startup
```

Where `{APP}` is `RADARR`, `SONARR`, or `LIDARR`, and `{N}` is a positive integer (1-based).

## Startup Sequence Integration Point

Current sequence in `packages/praxrr-app/src/hooks.server.ts`:

```
1.  await config.init()                    -- Create directories
2.  await db.initialize()                  -- Open SQLite, WAL, foreign keys
3.  await runMigrations()                  -- Apply pending migrations
4.  logSettings.load()                     -- Read log config from DB
5.  await logContainerConfig()             -- Docker detection
6.  await pcdManager.initialize()          -- Compile PCD caches
7.  [Auto-link default DB block]           -- One-time, guarded by setup_state
8.  ** reconcileEnvInstances() **          -- NEW: Insert point
9.  await initializeJobs()                 -- Recover stalled, schedule all, start dispatcher
10. cleanupExpiredSessions()               -- Auth cleanup
11. Server ready logging + printBanner()
```

The new function must run after step 7 (migrations applied, PCD initialized) and before step 9 (job scheduling reads all instances).

## Relevant Files

- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Full reference schema (documentation only, not executed)
- `/packages/praxrr-app/src/lib/server/db/migrations.ts`: Migration runner, registration of all 56 migrations
- `/packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: Recent column-addition migration (pattern reference)
- `/packages/praxrr-app/src/lib/server/db/migrations/20260219_seed_default_lidarr_metadata_profile.ts`: Latest migration, version 20260219
- `/packages/praxrr-app/src/lib/server/db/db.ts`: DatabaseManager singleton, transaction support
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD -- `ArrInstance`, `CreateArrInstanceInput`, `create()`, `getAll()`, `getById()`, `update()`, `delete()`, `nameExists()`, `apiKeyExists()`
- `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Sync config queries for all 4 sync types, status tracking, rename propagation
- `/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: Setup state singleton, `isDefaultDatabaseLinked()`, `markDefaultDatabaseLinked()`
- `/packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`: `shouldApplyDefaultDelayProfiles()` -- needed for default delay profile application
- `/packages/praxrr-app/src/hooks.server.ts`: Startup sequence, auth middleware, default DB auto-link (precedent)
- `/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: `createArrClient()` factory
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient`, `testConnection()`, `ArrClientOptions`
- `/packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: `getDefaultDelayProfile()` for radarr/sonarr
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: `ArrType` definition (includes `chaptarr`)
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: `ARR_APP_TYPES`, `ArrAppType` (excludes `chaptarr`)
- `/packages/praxrr-app/src/lib/server/utils/validation/url.ts`: `parseOptionalAbsoluteHttpUrl()`
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config singleton, env var reading pattern
- `/packages/praxrr-app/src/lib/server/jobs/init.ts`: `initializeJobs()` -- recovers stalled jobs, schedules all, starts dispatcher
- `/packages/praxrr-app/src/lib/server/jobs/schedule.ts`: `scheduleAllJobs()` -- iterates all instances to schedule sync/upgrade/rename
- `/packages/praxrr-app/src/lib/server/jobs/cleanup.ts`: `cleanupJobsForArrInstance()` -- removes queued jobs for a specific instance
- `/packages/praxrr-app/src/routes/arr/+page.server.ts`: Instance list + delete action
- `/packages/praxrr-app/src/routes/arr/new/+page.server.ts`: Instance creation flow (validation + default delay profile)
- `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: Instance update + delete
- `/packages/praxrr-app/src/routes/arr/test/+server.ts`: Connection test endpoint

## Architectural Patterns

- **Singleton Database**: `db` export from `$db/db.ts` is a `DatabaseManager` singleton. All queries use `db.execute()`, `db.query()`, `db.queryFirst()`. Transactions via `db.transaction()`.
- **Query Module Pattern**: Each table gets a queries module (e.g., `arrInstancesQueries`) that exports a const object with typed methods. No ORM -- raw SQL with type assertions.
- **Migration Runner**: `MigrationRunner` class in `migrations.ts` -- sorts by version, applies pending, records in `migrations` table. The `up` SQL runs inside a transaction; optional `afterUp` callback runs outside.
- **Fail-Soft Startup**: Both the default DB auto-link and job initialization catch errors per-item and continue. The env instance reconciliation should follow this same pattern.
- **FK Cascade Cleanup**: All `arr_instances` child tables use `ON DELETE CASCADE`. Deleting an instance automatically cleans up all related config, history, and namespace data.
- **Guard-Once vs. Run-Every**: Default DB auto-link uses `setup_state` flag (runs once). Env instances should NOT use a guard -- they reconcile every startup.
- **App-Level Uniqueness**: `api_key` uniqueness is enforced only via `arrInstancesQueries.apiKeyExists()`, not a SQL constraint. The new `upsertFromEnv()` method must use this same check.
- **Domain-Scoped Modules**: Arr-specific logic lives under `$arr/` (factory, base, clients, defaults, types). The new `envInstances.ts` belongs here.

## Edge Cases and Gotchas

- **api_key has no SQL UNIQUE constraint**: Only application-level checks via `apiKeyExists()`. The env reconciliation must use the same check; it cannot rely on SQL to catch duplicates.
- **name is SQL UNIQUE but case-sensitive**: SQLite's default collation is case-sensitive for UNIQUE constraints. `nameExists()` also does exact match. Two env instances named "Movies" and "movies" would both be allowed by SQL but could confuse users.
- **Type immutability**: The UI prevents changing instance type after creation. If an env var changes from `RADARR_INSTANCE_URL_1` to `SONARR_INSTANCE_URL_1` (same API key, different type), the reconciliation should detect this as a type change and handle it carefully (skip + warn, or update if `source='env'`).
- **Default delay profiles only for radarr/sonarr**: `getDefaultDelayProfile()` throws for lidarr. The env reconciliation must guard this call by type.
- **10 child tables with ON DELETE CASCADE**: Deleting any instance cascades through upgrade_configs, all sync tables, namespace assignments, rename settings, and run history. Disabling is far safer for orphan handling.
- **Job scheduling reads all instances**: `scheduleAllJobs()` in `schedule.ts` iterates `arrInstancesQueries.getAll()` and schedules jobs for every instance regardless of `enabled` status. Disabled instances may still get jobs scheduled (though the job handlers likely check `enabled`).
- **HMR in dev mode**: `hooks.server.ts` re-runs on hot module reload. The reconciliation function must be idempotent -- upsert logic keyed on `api_key` ensures re-runs are safe.
- **Connection test timing**: Arr apps in Docker Compose may not be ready when Praxrr starts. Connection testing must be optional and non-blocking (default: off).
- **External URL validation**: The `parseOptionalAbsoluteHttpUrl()` helper accepts null/empty as valid. Env vars like `RADARR_INSTANCE_EXTERNAL_URL_1=""` should be treated as "not set" (null), not as invalid.
- **Tags format**: UI stores tags as a JSON array string (`'["movies","4k"]'`). Env vars use comma-separated format (`movies,4k`). The parser must convert comma-separated to JSON array.
- **Feature spec decision: app-prefixed only**: The feature spec recommends NOT supporting the generic `INSTANCE_TYPE_1` pattern (Pattern B from the technical research). Only the app-prefixed pattern (`RADARR_INSTANCE_URL_1`) should be implemented. The technical research document still references both patterns -- the feature spec supersedes it.

## Other Docs

- `/docs/plans/initiate-apps/feature-spec.md`: Complete feature specification with business rules, data models, task breakdown
- `/docs/plans/initiate-apps/research-technical.md`: Architecture design, data flow, implementation plan (includes Pattern B which is NOT recommended)
- `/docs/plans/initiate-apps/research-business.md`: User stories, business rules, edge case table
- `/docs/plans/initiate-apps/research-external.md`: Arr API documentation, ecosystem tool patterns
- `/docs/plans/initiate-apps/research-ux.md`: UI patterns for env-sourced instance badges and read-only forms
- `/docs/plans/initiate-apps/research-recommendations.md`: Implementation strategy, risk assessment, phasing
