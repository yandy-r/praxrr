# Architecture Research: initiate-apps

## System Overview

Praxrr's startup is a sequential, top-level `await` chain in `hooks.server.ts` that initializes config, database, PCD caches, and job queues before exposing the HTTP handler. Arr instance management is backed by a synchronous SQLite CRUD layer (`arrInstancesQueries`) with uniqueness constraints on `name` and duplicate checking on `api_key`. The new env-instance reconciliation module will slot into the existing startup sequence between the PCD auto-link block (line 91) and `initializeJobs()` (line 94), following the same non-blocking, log-and-continue pattern already used for default database linking.

## Startup Sequence (Current)

Source: `packages/praxrr-app/src/hooks.server.ts`

| Step  | Line(s) | Operation                                           | Blocking | Notes                                                                                      |
| ----- | ------- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| 1     | 2       | `await import('$lib/server/utils/parser/spawn.ts')` | Yes      | Auto-spawn parser binary                                                                   |
| 2     | 19      | `await config.init()`                               | Yes      | Creates directories (logs, data, backups, databases)                                       |
| 3     | 22      | `await db.initialize()`                             | Yes      | Opens SQLite, enables WAL mode, foreign keys                                               |
| 4     | 25      | `await runMigrations()`                             | Yes      | Applies pending migrations (sorted by version)                                             |
| 5     | 28      | `logSettings.load()`                                | Sync     | Loads log settings from DB                                                                 |
| 6     | 31      | `await logContainerConfig()`                        | Yes      | Logs Docker env if containerized                                                           |
| 7     | 34      | `await pcdManager.initialize()`                     | Yes      | Compiles PCD caches from ops                                                               |
| 8     | 37-91   | Default database auto-link                          | Yes      | One-time: checks `setup_state.default_database_linked`, links default PCD repo, marks done |
| **9** | **--**  | **`await reconcileEnvInstances()`**                 | **--**   | **NEW INSERTION POINT**                                                                    |
| 10    | 94      | `await initializeJobs()`                            | Yes      | Recovers running jobs, schedules all jobs, starts dispatcher                               |
| 11    | 97-103  | `cleanupExpiredSessions()`                          | Sync     | Removes expired auth sessions                                                              |
| 12    | 106-108 | Logger: "Server ready"                              | Yes      | Logs server info                                                                           |
| 13    | 112     | `printBanner()`                                     | Sync     | Console output with version and URL                                                        |
| 14    | 118-170 | `export const handle: Handle`                       | --       | Auth middleware (request handler)                                                          |

**Exact insertion point**: Between lines 91 (end of auto-link block `}`) and 94 (`await initializeJobs()`). This position guarantees:

- Database is initialized and migrated (the new `source` column exists)
- PCD manager is initialized (not a dependency, but maintains ordering discipline)
- Jobs have NOT started yet (no sync jobs will fire for instances being reconciled)

## Relevant Components

### Instance CRUD Layer

**File**: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

```typescript
interface ArrInstance {
  id: number;
  name: string;
  type: string;
  url: string;
  external_url: string | null;
  api_key: string;
  tags: string | null; // JSON array string
  enabled: number; // 0 or 1
  created_at: string;
  updated_at: string;
  // NOTE: No `source` column yet - migration needed
}

interface CreateArrInstanceInput {
  name: string;
  type: string;
  url: string;
  apiKey: string;
  externalUrl?: string | null;
  tags?: string[];
  enabled?: boolean;
  // NOTE: No `source` field yet - must be added
}

interface UpdateArrInstanceInput {
  name?: string;
  type?: string;
  url?: string;
  externalUrl?: string | null;
  apiKey?: string;
  tags?: string[];
  enabled?: boolean;
}
```

**Exports used by reconciliation**:

- `arrInstancesQueries.create(input)` -- Returns `number` (new row ID)
- `arrInstancesQueries.getAll()` -- Returns `ArrInstance[]` (ordered by name)
- `arrInstancesQueries.getById(id)` -- Returns `ArrInstance | undefined`
- `arrInstancesQueries.update(id, input)` -- Returns `boolean` (rows affected > 0)
- `arrInstancesQueries.nameExists(name, excludeId?)` -- Returns `boolean`
- `arrInstancesQueries.apiKeyExists(apiKey, excludeId?)` -- Returns `boolean`

**Modifications needed**:

1. Add `source` to `ArrInstance` interface
2. Add optional `source?: string` to `CreateArrInstanceInput`
3. Modify `create()` INSERT to include `source` column
4. Add `getBySource(source: string): ArrInstance[]`
5. Consider adding `getByApiKey(apiKey: string): ArrInstance | undefined` (for efficient matching)

### Arr Client Factory

**File**: `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`

```typescript
function createArrClient(
  type: ArrType, // 'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'
  url: string,
  apiKey: string,
  options?: ArrClientOptions // { timeout?: number; retries?: number }
): BaseArrClient;
```

Used for optional connection testing. Creates the appropriate client subclass based on type.

### Base Arr Client

**File**: `packages/praxrr-app/src/lib/server/utils/arr/base.ts`

```typescript
class BaseArrClient extends BaseHttpClient {
  async testConnection(): Promise<boolean>;
  // Calls GET /api/{version}/system/status
  // Returns true on success, false on failure (after retries)
  // Logs connection info (appName, version, osName) on success
  // Has built-in retry logic (3 attempts with 500ms delay via BaseHttpClient)
}
```

**Retry behavior** (from `BaseHttpClient` at `packages/praxrr-app/src/lib/server/utils/http/client.ts`):

- Default timeout: 30000ms
- Default retries: 3
- Default retry delay: 500ms
- Retries on status codes: 500, 502, 503, 504

### Default Delay Profiles

**File**: `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`

```typescript
function getDefaultDelayProfile(
  arrType: 'radarr' | 'sonarr'
): Omit<ArrDelayProfile, 'id' | 'order'>;
```

Only supports `radarr` and `sonarr` (throws for other types). The reconciliation module should apply delay profiles to new Radarr/Sonarr instances using the same pattern as `packages/praxrr-app/src/routes/arr/new/+page.server.ts` (lines 119-142).

### Database Manager

**File**: `packages/praxrr-app/src/lib/server/db/db.ts`

```typescript
class DatabaseManager {
  async initialize(): Promise<void>;
  exec(sql: string): void;
  query<T>(sql: string, ...params): T[];
  queryFirst<T>(sql: string, ...params): T | undefined;
  execute(sql: string, ...params): number; // returns affected row count
  beginTransaction(): void;
  commit(): void;
  rollback(): void;
  async transaction<T>(fn: () => T | Promise<T>): Promise<T>;
}

export const db: DatabaseManager; // singleton
```

The `transaction()` method wraps a function in BEGIN/COMMIT with automatic ROLLBACK on error. Reconciliation should use this to batch all upsert/disable operations.

### Config Singleton

**File**: `packages/praxrr-app/src/lib/server/utils/config/config.ts`

Environment variables are read via `Deno.env.get()` directly in the constructor or at call sites. The Config class does NOT centralize all env var reading -- the default-DB auto-link in `hooks.server.ts` reads its own env vars inline (lines 38-46). The new env-instance parser should follow the same pattern: read env vars via `Deno.env.toObject()` or `Deno.env.get()` at call time, not through the Config singleton.

### Setup State

**File**: `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`

```typescript
interface SetupState {
  id: number;
  default_database_linked: number;  // 0 or 1
  created_at: string;
  updated_at: string;
}

const setupStateQueries = {
  get(): SetupState
  isDefaultDatabaseLinked(): boolean
  markDefaultDatabaseLinked(): boolean
}
```

The setup_state table uses a singleton pattern (`id=1`). The default-DB auto-link uses this as a one-time guard. The env-instance reconciliation does NOT need a setup_state guard because it must run on every startup (env vars may change between restarts).

### General Settings (Delay Profile Control)

**File**: `packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`

```typescript
const generalSettingsQueries = {
  shouldApplyDefaultDelayProfiles(): boolean
  // Checks general_settings.apply_default_delay_profiles == 1
}
```

Used to gate whether default delay profiles are applied to new instances.

### Type System

**File**: `packages/praxrr-app/src/lib/shared/pcd/types.ts`

```typescript
const ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;
type ArrAppType = 'radarr' | 'sonarr' | 'lidarr';

function isArrType(value: string): value is ArrType;
// Validates against ARR_TYPES which includes 'all'
```

**File**: `packages/praxrr-app/src/lib/server/utils/arr/types.ts`

```typescript
type ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'chaptarr';
```

There are two `ArrType` definitions. The PCD-layer `ArrAppType` covers `radarr | sonarr | lidarr`. The client-layer `ArrType` adds `chaptarr`. The env-instance parser should validate against `ARR_APP_TYPES` from the shared types (the three supported app types), not the client-layer type union.

### URL Validation

**File**: `packages/praxrr-app/src/lib/server/utils/validation/url.ts`

```typescript
function parseOptionalAbsoluteHttpUrl(
  rawUrl: string | null | undefined
): ParsedHttpUrl;
// Returns { value: string | null, isValid: boolean }
// Accepts http: and https: schemes only
```

Should be reused for validating `{APP}_INSTANCE_URL_{N}` and `{APP}_INSTANCE_EXTERNAL_URL_{N}` values.

## Data Flow

### Current Instance Creation (UI)

```
User submits form -> /arr/new/+page.server.ts actions.default
  -> Validate fields (name, type, url, apiKey)
  -> Check arrInstancesQueries.nameExists(name)
  -> Check arrInstancesQueries.apiKeyExists(apiKey)
  -> arrInstancesQueries.create({ name, type, url, externalUrl, apiKey, tags, enabled })
  -> If radarr/sonarr AND shouldApplyDefaultDelayProfiles():
       -> createArrClient(type, url, apiKey)
       -> client.updateDelayProfile(1, { ...defaultProfile, id: 1, order: 2147483647 })
  -> redirect to /arr/{id}/settings
```

### Proposed Env Instance Reconciliation

```
hooks.server.ts (after PCD init, before initializeJobs)
  -> Deno.env.toObject() or Deno.env.get() for indexed keys
  -> parseArrInstanceEnvVars(): ParsedEnvInstance[]
       - Regex scan for {APP}_INSTANCE_{PROP}_{N}
       - Group by (app, index)
       - Validate required fields (url, api_key)
       - Auto-generate names if missing
       - Validate URL format
  -> reconcileEnvInstances(parsed[]):
       - Load all existing instances: arrInstancesQueries.getAll()
       - Build api_key lookup map
       - For each parsed instance:
           - If api_key matches source='env' row -> UPDATE (url, name, tags, enabled, external_url)
           - If api_key matches source='ui' row -> SKIP (warn log)
           - If name collision with existing -> SKIP (warn log)
           - Else -> INSERT with source='env'
       - Disable orphaned source='env' rows (in DB but not in env)
       - Apply default delay profiles to newly created radarr/sonarr instances
  -> Log summary (created, updated, skipped, disabled)
```

## Integration Points

### 1. hooks.server.ts -- Startup Call Site

**Location**: Line 91 (after the auto-link closing brace), before line 94 (`await initializeJobs()`)

**Pattern to follow**: The default-DB auto-link block (lines 37-91) demonstrates the established pattern:

- Read env vars inline with `Deno.env.get()`
- Wrap in try/catch so failures do not crash startup
- Log success/failure with `source: 'Setup'`
- Mark state changes via queries

**Proposed addition**:

```typescript
// Reconcile env-declared Arr instances on every startup
await reconcileEnvInstances();
```

### 2. Migration Registration

**Location**: `packages/praxrr-app/src/lib/server/db/migrations.ts`

**Pattern**: Static import at top of file, add to `loadMigrations()` array. Recent migrations use YYYYMMDD versioning (e.g., `20260219`).

**New migration**: `20260220_add_arr_instance_source.ts` (or next available date)

```sql
ALTER TABLE arr_instances ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
```

### 3. arrInstancesQueries Extension

**Location**: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

**Changes needed**:

- Add `source: string` to `ArrInstance` interface
- Add optional `source?: string` to `CreateArrInstanceInput`
- Modify `create()` INSERT to include `source` column
- Add `getBySource(source: string): ArrInstance[]`
- Add `getByApiKey(apiKey: string): ArrInstance | undefined` (for efficient matching)
- Add `updateSource(id: number, source: string): boolean` (optional, update() already handles dynamic fields)

### 4. New Module

**Location**: `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`

**Exports**:

- `parseArrInstanceEnvVars(envObject: Record<string, string>): ParsedEnvInstance[]` -- Pure function, testable
- `reconcileEnvInstances(): Promise<void>` -- Orchestrator called from hooks.server.ts

## Key Dependencies

Modules the new `envInstances.ts` must import:

| Import                         | Source                           | Purpose                                                    |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------- |
| `arrInstancesQueries`          | `$db/queries/arrInstances.ts`    | Instance CRUD                                              |
| `generalSettingsQueries`       | `$db/queries/generalSettings.ts` | Check delay profile setting                                |
| `createArrClient`              | `$arr/factory.ts`                | Connection testing (Phase 2) and delay profile application |
| `getDefaultDelayProfile`       | `$arr/defaults.ts`               | Default delay profile values                               |
| `db`                           | `$db/db.ts`                      | Transaction wrapper                                        |
| `logger`                       | `$logger/logger.ts`              | Structured logging                                         |
| `ARR_APP_TYPES`                | `$shared/pcd/types.ts`           | Type validation                                            |
| `parseOptionalAbsoluteHttpUrl` | `$utils/validation/url.ts`       | URL validation                                             |

For `hooks.server.ts`:

| Import                  | Source                 | Purpose                     |
| ----------------------- | ---------------------- | --------------------------- |
| `reconcileEnvInstances` | `$arr/envInstances.ts` | Startup reconciliation call |

## Database Schema Impact

### Current arr_instances Schema (from schema.sql, lines 24-43)

```sql
CREATE TABLE arr_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    external_url TEXT,
    api_key TEXT NOT NULL,
    tags TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Migration Required

```sql
ALTER TABLE arr_instances ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
```

`DEFAULT 'ui'` ensures all existing rows (user-created) get the correct source value without a data migration. SQLite supports `ALTER TABLE ADD COLUMN` with `NOT NULL` only if a `DEFAULT` is provided.

### Foreign Key Cascade Impact

Tables with `FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE`:

- `upgrade_configs`
- `arr_sync_quality_profiles`
- `arr_sync_quality_profiles_config`
- `arr_sync_delay_profiles_config`
- `arr_sync_metadata_profiles_config`
- `arr_sync_media_management`
- `arr_database_namespaces`
- `arr_rename_settings`
- `upgrade_runs`
- `rename_runs`

This is why orphaned env instances must be DISABLED (set `enabled=0`) rather than DELETED -- deletion would cascade and destroy all sync/upgrade/rename configuration.

## Migration Pattern

The most recent migration style uses YYYYMMDD versioning. Example from `20260216_add_arr_instance_external_url.ts`:

```typescript
import type { Migration } from '../migrations.ts';

export const migration: Migration = {
  version: 20260216,
  name: 'Add external_url to arr_instances',
  up: `
    ALTER TABLE arr_instances
    ADD COLUMN external_url TEXT;
  `,
};
```

The new migration should follow this exact pattern. The `down` field is optional (not included in the example above).

## Existing Instance Creation Flow (Reference Implementation)

**File**: `packages/praxrr-app/src/routes/arr/new/+page.server.ts` (lines 100-142)

This file is the canonical reference for the full instance creation sequence:

1. Call `arrInstancesQueries.create()` to insert the row
2. Check if type is `radarr` or `sonarr`
3. Check `generalSettingsQueries.shouldApplyDefaultDelayProfiles()`
4. Create client via `createArrClient(type, url, apiKey)`
5. Get default profile via `getDefaultDelayProfile(type)`
6. Call `client.updateDelayProfile(1, { ...defaultProfile, id: 1, order: 2147483647 })`
7. Wrap delay profile application in try/catch (log-and-continue on failure)

The reconciliation module should replicate this pattern for newly created env instances.

## Gotchas and Edge Cases

1. **Two ArrType definitions**: `$shared/pcd/types.ts` has `ArrAppType = 'radarr' | 'sonarr' | 'lidarr'` and `$arr/types.ts` has `ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'`. The env parser should validate against `ARR_APP_TYPES` (the PCD-layer definition) since `chaptarr` is not a user-facing Arr app type.

2. **Lidarr uses API v1**: The `LidarrClient` overrides `apiVersion` to `'v1'`. The `createArrClient` factory handles this automatically, but be aware if implementing manual connection testing.

3. **Default delay profiles only for radarr/sonarr**: `getDefaultDelayProfile()` throws for types other than `radarr` and `sonarr`. The reconciliation must guard the delay profile application with a type check.

4. **SQLite ALTER TABLE NOT NULL constraint**: `ALTER TABLE ADD COLUMN ... NOT NULL` requires a `DEFAULT` value in SQLite. The migration MUST include `DEFAULT 'ui'`.

5. **name uniqueness is case-sensitive in SQLite by default**: The `UNIQUE` constraint on `arr_instances.name` is case-sensitive by default. The `nameExists()` query uses exact match (`name = ?`). Auto-generated names must check for collisions using the same case-sensitive comparison.

6. **HMR recovery in dev mode**: The `DatabaseManager` handles unhealthy connections from Vite HMR. The reconciliation will re-run on every HMR reload in dev, but since it uses upsert logic keyed by `api_key`, this is idempotent.

7. **Transaction semantics**: The `db.transaction()` method wraps operations in BEGIN/COMMIT. Since all arrInstancesQueries methods use `db.execute()` / `db.query()` directly (no nested transactions), wrapping the full reconciliation in a single transaction is safe.

8. **Delay profile application is async and network-dependent**: Applying delay profiles requires the Arr instance to be reachable. At startup, Docker Compose services may not be ready. This must be non-blocking (try/catch with warning log), matching the existing pattern in `arr/new/+page.server.ts`.

9. **api_key is not UNIQUE in the schema**: Despite being treated as globally unique (each Arr install has one API key), there is no UNIQUE constraint on `api_key` in the DDL. The `apiKeyExists()` query does COUNT-based checking instead. The reconciliation should rely on `apiKeyExists()` for collision detection rather than assuming a UNIQUE constraint.

10. **tags column is JSON string, not array**: The `tags` column stores `JSON.stringify(tags)` or `null`. Env var tags (`{APP}_INSTANCE_TAGS_{N}`) will come as comma-separated strings and must be parsed into an array, then JSON-stringified for storage.

## Other Docs

- `docs/plans/initiate-apps/feature-spec.md` -- Full feature specification with data models, env var reference, conflict resolution strategy, task breakdown, and phasing plan
- `docs/plans/initiate-apps/research-technical.md` -- Technical research on startup sequence, data models, and edge cases
- `docs/plans/initiate-apps/research-external.md` -- Arr API documentation, ecosystem tool patterns (Notifiarr, Unpackerr, Recyclarr)
- `docs/plans/initiate-apps/research-business.md` -- User stories and business rules
- `docs/plans/initiate-apps/research-recommendations.md` -- Implementation strategy and risk assessment
