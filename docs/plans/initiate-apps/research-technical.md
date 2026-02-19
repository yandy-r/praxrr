# Initiate Apps -- Technical Research

## Overview

This document specifies the architecture for initializing Arr app instances (Radarr, Sonarr, Lidarr) from environment variables at startup. The feature follows the existing pattern used for default-database auto-linking (`PRAXRR_DEFAULT_DB_*` env vars in `hooks.server.ts`) and extends it to `arr_instances` rows. The goal is to enable headless/IaC deployments where instance configuration lives in `docker-compose.yml` or orchestrator secrets rather than requiring UI-based setup.

---

## 1. Current State Analysis

### 1.1 Startup Sequence (hooks.server.ts)

The current startup sequence in `packages/praxrr-app/src/hooks.server.ts` is:

```
1. config.init()              -- Create directories (logs, data, backups, databases)
2. db.initialize()            -- Open SQLite, enable WAL, foreign keys
3. runMigrations()            -- Apply pending schema migrations
4. logSettings.load()         -- Read log config from DB
5. logContainerConfig()       -- Docker detection logging
6. pcdManager.initialize()    -- Compile PCD caches
7. [Auto-link default DB]     -- One-time default database linking (guarded by setup_state)
8. initializeJobs()           -- Recover stalled jobs, schedule cron, start dispatcher
9. cleanupExpiredSessions()   -- Auth session cleanup
10. Server ready logging
```

Instance initialization must slot in **after step 3 (migrations)** so the `arr_instances` table schema is up to date, and **before step 8 (initializeJobs)** because sync jobs depend on instances existing. The ideal position is between steps 7 and 8 -- immediately after the PCD auto-link block and before job initialization -- so that any env-sourced instances are present when the job scheduler scans for sync/upgrade/rename configurations.

### 1.2 arr_instances Table Schema (Current)

After all migrations, the effective schema is:

```sql
CREATE TABLE arr_instances (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL,                     -- 'radarr' | 'sonarr' | 'lidarr'
    url         TEXT NOT NULL,
    external_url TEXT,                             -- nullable, browser-facing URL
    api_key     TEXT NOT NULL,
    tags        TEXT,                              -- JSON array or null
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Key constraints from the codebase:

- `name` has a UNIQUE constraint (case-sensitive at the SQL level, but `arrInstancesQueries.nameExists` checks exact match).
- `api_key` uniqueness is enforced at the application level via `arrInstancesQueries.apiKeyExists`, not a SQL constraint.
- Valid types are `['radarr', 'sonarr', 'lidarr']` enforced at the route handler level (`arr/new/+page.server.ts` line 11, `arr/test/+server.ts` line 6).
- The `ArrType` union in `$arr/types.ts` also includes `'chaptarr'`, but instance creation routes only allow the three main types.

### 1.3 Instance CRUD Flow

- **Create**: `packages/praxrr-app/src/routes/arr/new/+page.server.ts` -- parses FormData, validates name/type/url/apiKey uniqueness, calls `arrInstancesQueries.create()`, optionally applies default delay profile via `createArrClient`.
- **Read**: `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` -- feeds `instance` to all child routes.
- **Update**: `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` -- re-validates, calls `arrInstancesQueries.update()`.
- **Delete**: Both `arr/+page.server.ts` and `arr/[id]/settings/+page.server.ts` handle deletion, calling `cleanupJobsForArrInstance(id)` before `arrInstancesQueries.delete(id)`.

### 1.4 Config Singleton Pattern

`packages/praxrr-app/src/lib/server/utils/config/config.ts` reads env vars in its constructor (runs at module import time). It does **not** parse any instance-related env vars. The `config.init()` call only creates directories. All instance configuration currently comes from the database.

### 1.5 Setup State Pattern (Precedent)

The default-database auto-link in `hooks.server.ts` (lines 37-91) provides the direct precedent:

- Uses `setupStateQueries.isDefaultDatabaseLinked()` as a one-time guard.
- Reads `PRAXRR_DEFAULT_DB_*` env vars with defaults.
- Calls domain logic (`pcdManager.link`) inside a try/catch.
- Marks the guard flag regardless of success/failure to prevent retry loops.
- Logs results with `source: 'Setup'`.

---

## 2. Architecture Design

### 2.1 Environment Variable Naming Convention

Two patterns must be supported:

**Pattern A: App-Prefixed (Explicit Type)**

```
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
RADARR_INSTANCE_NAME_1=Main Radarr
RADARR_INSTANCE_EXTERNAL_URL_1=https://radarr.example.com
RADARR_INSTANCE_TAGS_1=movies,4k
RADARR_INSTANCE_ENABLED_1=true

SONARR_INSTANCE_URL_1=http://sonarr:8989
SONARR_INSTANCE_API_KEY_1=def456
```

**Pattern B: Generic with Type Field**

```
INSTANCE_TYPE_1=radarr
INSTANCE_URL_1=http://radarr:7878
INSTANCE_API_KEY_1=abc123
INSTANCE_NAME_1=Main Radarr
INSTANCE_EXTERNAL_URL_1=https://radarr.example.com
INSTANCE_TAGS_1=movies,4k
INSTANCE_ENABLED_1=true
```

Field semantics per index:
| Env Var Suffix | Required | Default | Maps To |
|-------------------|----------|---------------------|--------------------------|
| `_URL_{n}` | Yes | -- | `arr_instances.url` |
| `_API_KEY_{n}` | Yes | -- | `arr_instances.api_key` |
| `_TYPE_{n}` | Pattern B only | (inferred from prefix in Pattern A) | `arr_instances.type` |
| `_NAME_{n}` | No | `{Type} {n}` | `arr_instances.name` |
| `_EXTERNAL_URL_{n}` | No | null | `arr_instances.external_url` |
| `_TAGS_{n}` | No | null | `arr_instances.tags` |
| `_ENABLED_{n}` | No | `true` | `arr_instances.enabled` |

Index values are positive integers starting at 1. Gaps are allowed (e.g., `_1` and `_3` without `_2`).

### 2.2 Data Flow

```
Deno.env → parseArrInstanceEnvVars()
        → EnvArrInstanceConfig[]
        → for each config:
              validate type, url, apiKey
              check arrInstancesQueries.nameExists()
              if exists:
                  arrInstancesQueries.update() with upsert semantics
              else:
                  arrInstancesQueries.create()
              optionally test connection (non-blocking)
        → log results
        → mark setup_state flag
```

### 2.3 Startup Sequence Integration

```
 7. [Auto-link default DB]           -- existing
 8. [NEW] initializeArrInstances()   -- env-based instance upsert
 9. initializeJobs()                 -- existing (can now see env-sourced instances)
```

The new step uses the same error-handling philosophy as the default DB auto-link: log failures but do not block startup.

### 2.4 Module Structure

New file: `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`

This module exports:

- `parseArrInstanceEnvVars(): EnvArrInstanceConfig[]` -- pure function, reads `Deno.env`, returns parsed configs.
- `initializeArrInstances(): Promise<void>` -- orchestrates parse, validate, upsert, log.

Rationale for placing it under `$arr/` rather than `$utils/config/`: the logic is Arr-domain-specific (validates types against `ArrAppType`, may invoke `createArrClient.testConnection()`), and the `$arr/` directory already houses the factory, types, and defaults.

---

## 3. Data Model

### 3.1 Schema Change: `source` Column

Add a `source` column to `arr_instances` to distinguish env-sourced instances from UI-created ones:

```sql
ALTER TABLE arr_instances
ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
-- Values: 'ui' | 'env'
```

This migration must set all existing rows to `'ui'` (the DEFAULT handles this). New env-sourced rows get `'env'`.

Why this matters:

- **UI protection**: Env-sourced instances can be flagged as read-only in the UI to prevent accidental edits that would be overwritten on restart.
- **Idempotency**: On restart, the initializer can identify which rows originated from env vars and update them if env values changed, without conflicting with user-created instances.
- **Deletion semantics**: If an env var is removed and the app restarts, the corresponding `source='env'` row can optionally be cleaned up or left orphaned (configurable behavior).

### 3.2 Migration

New file: `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_add_arr_instance_source.ts`

```typescript
import type { Migration } from '../migrations.ts';

export const migration: Migration = {
  version: 20260220, // next available date-based version
  name: 'Add source column to arr_instances',
  up: `
    ALTER TABLE arr_instances
    ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
  `,
};
```

### 3.3 Setup State Extension

Add a `env_instances_initialized` flag to the `setup_state` table:

```sql
ALTER TABLE setup_state
ADD COLUMN env_instances_initialized INTEGER NOT NULL DEFAULT 0;
```

However, unlike the default-database auto-link which is a one-time operation, env instance initialization should run on **every startup** because env vars may change between restarts. The setup_state flag is therefore **not** the right guard here. Instead, the initializer should:

1. Parse env vars on every startup.
2. Upsert matching `source='env'` rows.
3. Optionally remove `source='env'` rows whose env vars no longer exist.

This means no setup_state change is needed. The idempotency is achieved by the upsert logic keyed on the combination of `source='env'` and a stable identifier (the env var index mapped to name, or url+api_key).

### 3.4 Conflict Resolution Strategy

The upsert key for env-sourced instances is the **instance name** (which is UNIQUE in the table):

1. **Env instance, no DB row with that name**: INSERT new row with `source='env'`.
2. **Env instance, existing DB row with `source='env'` and same name**: UPDATE url/apiKey/tags/enabled/externalUrl from env.
3. **Env instance, existing DB row with `source='ui'` and same name**: **Skip and warn**. Do not overwrite a user-created instance. Log a warning so the user knows there is a naming collision.
4. **DB row with `source='env'` but no matching env var on this startup**: Two options:
   - **Conservative (recommended for v1)**: Leave orphaned rows. Log an info message. User can delete manually.
   - **Aggressive (future option)**: Delete orphaned `source='env'` rows. Controlled by `PRAXRR_ENV_INSTANCES_CLEANUP=true`.

### 3.5 Updated TypeScript Types

In `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`:

```typescript
export interface ArrInstance {
  id: number;
  name: string;
  type: string;
  url: string;
  external_url: string | null;
  api_key: string;
  tags: string | null;
  enabled: number;
  source: string; // 'ui' | 'env'
  created_at: string;
  updated_at: string;
}

export interface CreateArrInstanceInput {
  name: string;
  type: string;
  url: string;
  apiKey: string;
  externalUrl?: string | null;
  tags?: string[];
  enabled?: boolean;
  source?: 'ui' | 'env'; // defaults to 'ui'
}
```

---

## 4. API Design

### 4.1 No New Endpoints Required

Env-sourced instances appear in the existing `arrInstancesQueries.getAll()` results. All existing API routes (`/arr`, `/arr/[id]/*`, `/api/v1/arr/*`) will see them automatically.

### 4.2 UI Considerations

Env-sourced instances (`source='env'`) should be visually distinguished in the UI:

- Show a badge or indicator (e.g., "ENV" tag) on the Arr instances list page (`packages/praxrr-app/src/routes/arr/+page.svelte`).
- In the settings page (`packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`), either:
  - Make the form read-only for env-sourced instances, or
  - Allow edits but warn that changes will be overwritten on next restart.

### 4.3 Test Connection During Init

Connection testing at startup is optional and controlled by env var `PRAXRR_ENV_INSTANCES_TEST=true|false` (default `false`). Rationale:

- Arr instances may not be ready when Praxrr starts (Docker Compose ordering).
- Blocking startup on connection tests defeats the purpose of env-based config.
- The existing sync job infrastructure will detect connectivity issues at runtime.

If enabled, use `createArrClient(type, url, apiKey, { timeout: 3000, retries: 0 })` matching the pattern in `packages/praxrr-app/src/routes/arr/test/+server.ts`.

---

## 5. Detailed Implementation Plan

### 5.1 New Files

| File                                                                                   | Purpose                      |
| -------------------------------------------------------------------------------------- | ---------------------------- |
| `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`                         | Env var parser + initializer |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_add_arr_instance_source.ts` | Add `source` column          |

### 5.2 Modified Files

| File                                                                | Change                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/hooks.server.ts`                           | Add `initializeArrInstances()` call between PCD auto-link and job init                                                    |
| `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`     | Add `source` field to interfaces, update `create()` to accept `source`, add `getBySource()` and `upsertFromEnv()` queries |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`               | Register the new migration                                                                                                |
| `packages/praxrr-app/src/lib/server/db/schema.sql`                  | Document the `source` column                                                                                              |
| `packages/praxrr-app/src/routes/arr/+page.svelte`                   | Show source badge on instance cards                                                                                       |
| `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` | Optionally disable editing for env-sourced instances                                                                      |
| `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`  | Guard against updates to env-sourced instances (or warn)                                                                  |

### 5.3 Env Var Parsing Logic

```typescript
interface EnvArrInstanceConfig {
  index: number;
  type: ArrAppType;
  url: string;
  apiKey: string;
  name: string;
  externalUrl: string | null;
  tags: string[];
  enabled: boolean;
}

function parseArrInstanceEnvVars(): EnvArrInstanceConfig[] {
  const configs: EnvArrInstanceConfig[] = [];
  const seenIndices = new Map<number, 'prefixed' | 'generic'>();

  // Scan for Pattern A (app-prefixed): RADARR_INSTANCE_URL_1, SONARR_INSTANCE_URL_1, etc.
  for (const appType of ['RADARR', 'SONARR', 'LIDARR'] as const) {
    for (let i = 1; i <= 100; i++) {
      const url = Deno.env.get(`${appType}_INSTANCE_URL_${i}`)?.trim();
      if (!url) continue;

      const apiKey = Deno.env.get(`${appType}_INSTANCE_API_KEY_${i}`)?.trim();
      if (!apiKey) {
        // Log warning: URL defined but no API key
        continue;
      }

      // ... parse remaining optional fields
      configs.push({ index: i, type: appType.toLowerCase() as ArrAppType, url, apiKey, ... });
    }
  }

  // Scan for Pattern B (generic): INSTANCE_URL_1, INSTANCE_TYPE_1, etc.
  for (let i = 1; i <= 100; i++) {
    const url = Deno.env.get(`INSTANCE_URL_${i}`)?.trim();
    if (!url) continue;

    const type = Deno.env.get(`INSTANCE_TYPE_${i}`)?.trim()?.toLowerCase();
    if (!type || !['radarr', 'sonarr', 'lidarr'].includes(type)) {
      // Log warning: invalid or missing type
      continue;
    }

    // Skip if this index was already handled by Pattern A
    // (Pattern A takes priority)
    const existingPatternA = configs.find(c =>
      c.url === url && c.type === type
    );
    if (existingPatternA) continue;

    const apiKey = Deno.env.get(`INSTANCE_API_KEY_${i}`)?.trim();
    if (!apiKey) continue;

    // ... parse remaining optional fields
    configs.push({ index: i, type: type as ArrAppType, url, apiKey, ... });
  }

  return configs;
}
```

### 5.4 Upsert Logic

New query method in `arrInstancesQueries`:

```typescript
upsertFromEnv(input: CreateArrInstanceInput & { source: 'env' }): { action: 'created' | 'updated' | 'skipped'; id: number; reason?: string } {
  // Check if name exists
  const existing = db.queryFirst<ArrInstance>(
    'SELECT * FROM arr_instances WHERE name = ?', input.name
  );

  if (existing) {
    if (existing.source !== 'env') {
      // UI-created instance with same name -- do not overwrite
      return { action: 'skipped', id: existing.id, reason: 'name collision with ui-created instance' };
    }
    // Update existing env-sourced instance
    // ... update url, api_key, external_url, tags, enabled, updated_at
    return { action: 'updated', id: existing.id };
  }

  // Also check api_key uniqueness
  if (arrInstancesQueries.apiKeyExists(input.apiKey)) {
    return { action: 'skipped', id: 0, reason: 'api_key already exists' };
  }

  // Create new
  const id = arrInstancesQueries.create(input);
  return { action: 'created', id };
}
```

### 5.5 Startup Integration in hooks.server.ts

```typescript
// [After PCD auto-link block, before initializeJobs]

// Initialize arr instances from environment variables
import { initializeArrInstances } from '$arr/envInstances.ts';
await initializeArrInstances();

// Initialize and start job queue
await initializeJobs();
```

The `initializeArrInstances()` function:

1. Calls `parseArrInstanceEnvVars()`.
2. If no env vars found, returns immediately (no log noise).
3. For each parsed config, calls `arrInstancesQueries.upsertFromEnv()`.
4. Logs a summary: `"Initialized N arr instance(s) from environment (M created, K updated, J skipped)"`.
5. Does NOT throw on individual failures -- logs per-instance errors and continues.

---

## 6. Relevant Files

| Path                                                                                         | Role                                                                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/praxrr-app/src/hooks.server.ts`                                                    | Startup sequence -- insertion point for env instance init                   |
| `packages/praxrr-app/src/lib/server/utils/config/config.ts`                                  | Config singleton pattern reference (does NOT need changes for this feature) |
| `packages/praxrr-app/src/lib/server/db/db.ts`                                                | Database singleton, transaction support                                     |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                        | Migration runner, registration of new migrations                            |
| `packages/praxrr-app/src/lib/server/db/migrations/001_create_arr_instances.ts`               | Original arr_instances table creation                                       |
| `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts` | Recent column addition pattern reference                                    |
| `packages/praxrr-app/src/lib/server/db/schema.sql`                                           | Reference schema documentation                                              |
| `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`                              | Instance CRUD queries -- needs `source` field and upsert method             |
| `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`                                | One-time guard pattern reference (not used for this feature)                |
| `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`                                    | `createArrClient()` for optional connection testing                         |
| `packages/praxrr-app/src/lib/server/utils/arr/base.ts`                                       | `BaseArrClient.testConnection()`                                            |
| `packages/praxrr-app/src/lib/server/utils/arr/types.ts`                                      | `ArrType` definition                                                        |
| `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`                                   | Default delay profile application pattern                                   |
| `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`                                     | `ArrAppType`, `ARR_APP_TYPES`, type guards                                  |
| `packages/praxrr-app/src/lib/shared/pcd/types.ts`                                            | Canonical `ArrAppType` and `ARR_APP_TYPES` definitions                      |
| `packages/praxrr-app/src/lib/server/utils/validation/url.ts`                                 | URL validation helper                                                       |
| `packages/praxrr-app/src/routes/arr/new/+page.server.ts`                                     | Instance create route (validation reference)                                |
| `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`                           | Instance update route (validation reference)                                |
| `packages/praxrr-app/src/routes/arr/test/+server.ts`                                         | Connection test endpoint (client creation reference)                        |
| `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`                          | Instance form component (UI impact)                                         |
| `packages/praxrr-app/src/routes/arr/+page.server.ts`                                         | Instance list page (UI impact)                                              |
| `packages/praxrr-app/src/lib/server/jobs/init.ts`                                            | Job initialization (depends on instances existing)                          |
| `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`                                   | Sync queries (depend on arr_instances FK)                                   |

---

## 7. Architectural Patterns

- **Singleton Config + Env Reading**: `config.ts` reads env vars eagerly in the constructor. The new env instance parser follows the same pattern but runs as a startup function rather than a constructor, because it needs the database to be initialized first.
- **Guard-Once vs. Run-Every-Startup**: The default DB auto-link uses `setup_state` to run once. Env instance init must run every startup to pick up changes. No setup_state guard.
- **Upsert on Name**: Instance name is the UNIQUE key in the DB. Env-sourced instances use name as the upsert key, with `source='env'` as a secondary discriminator to avoid overwriting UI-created instances.
- **Fail-Soft Startup**: Both the default DB auto-link and the proposed env instance init catch errors per-instance and continue. Startup is never blocked by instance init failures.
- **Domain-Scoped Module**: New logic goes in `$arr/envInstances.ts`, not in `$utils/config/`, because it depends on Arr domain types and validation.
- **FK Cascade**: All sync tables (`arr_sync_*`) have `ON DELETE CASCADE` referencing `arr_instances(id)`. Deleting an env-sourced instance automatically cleans up sync config.

---

## 8. Edge Cases and Gotchas

- **Name collision between env and UI instances**: If a user creates an instance named "Main Radarr" via UI and then deploys with `RADARR_INSTANCE_NAME_1=Main Radarr`, the env init must skip and warn, not overwrite. The `source` column is the discriminator.
- **API key uniqueness is app-level, not SQL-level**: The `arr_instances` table has no UNIQUE constraint on `api_key`. The check is in `arrInstancesQueries.apiKeyExists()`. Env init must use the same check. Two env vars pointing to the same Arr instance (same API key) should be caught.
- **Type is immutable after creation**: The UI prevents changing instance type after creation (`InstanceForm.svelte` line 321: `disabled={mode === 'edit'}`). Env init should not change the `type` of an existing `source='env'` row either. If the type changes in env vars, skip and warn.
- **Default delay profile application**: When creating a new instance via UI, the system optionally applies a default delay profile (`generalSettingsQueries.shouldApplyDefaultDelayProfiles()`). Env-created instances should follow the same logic, but since Arr instances may not be reachable at startup, this should be attempted but failure should be non-blocking.
- **Empty API keys in env**: `RADARR_INSTANCE_API_KEY_1=""` should be treated as "not set" (skip that instance), not as a valid empty key.
- **Index gaps**: Indices need not be contiguous. `RADARR_INSTANCE_URL_1` and `RADARR_INSTANCE_URL_3` (without `_2`) are valid.
- **Pattern priority**: If both `RADARR_INSTANCE_URL_1` and `INSTANCE_URL_1` (with `INSTANCE_TYPE_1=radarr`) exist and point to different URLs, Pattern A (app-prefixed) takes priority. If they point to the same URL, de-duplicate.
- **Case sensitivity**: Env var values for `type` should be case-insensitive (`RADARR`, `Radarr`, `radarr` all map to `'radarr'`). The env var **names** are case-sensitive per POSIX convention.
- **Hot reload (dev mode)**: In dev mode, `hooks.server.ts` re-runs on HMR. The upsert logic is idempotent, so re-runs are safe. However, the `db.initialize()` health check (lines 36-47 of `db.ts`) handles the HMR case, so the new code benefits from the same resilience.
- **Docker secrets**: Some deployers mount secrets as files rather than env vars. This feature only handles env vars; file-based secrets are out of scope for v1 but the parser could be extended later.
- **Connection test timing**: Arr apps in the same Docker Compose may start after Praxrr. Testing connections at startup would fail. Default should be no connection test; let the sync pipeline discover issues.

---

## 9. Security Considerations

- **API keys in env vars**: This is standard practice for containerized deployments. API keys are already stored in plaintext in the SQLite database. Env vars are not inherently less secure.
- **Logging**: The initializer must NOT log API key values. Log only type, name, URL, and result (created/updated/skipped).
- **Docker secrets support**: Docker secrets are mounted as files in `/run/secrets/`. While not in scope for v1, the `_FILE` suffix convention (e.g., `RADARR_INSTANCE_API_KEY_1_FILE=/run/secrets/radarr_key`) could be added as a follow-up.

---

## 10. Testing Strategy

- **Unit tests** for `parseArrInstanceEnvVars()`: mock `Deno.env.get`, verify Pattern A/B parsing, index gaps, missing required fields, type validation.
- **Unit tests** for `upsertFromEnv()`: test create, update, skip-on-collision, api-key-uniqueness scenarios.
- **Integration test** for `initializeArrInstances()`: set env vars, call function, verify DB state.
- **Test alias**: Add `env-instances` to `scripts/test.ts` aliases.

---

## 11. Environment Variable Reference (Complete)

### Pattern A (App-Prefixed)

```bash
# Required per index
{APP}_INSTANCE_URL_{n}        # Base URL (http://radarr:7878)
{APP}_INSTANCE_API_KEY_{n}    # API key

# Optional per index
{APP}_INSTANCE_NAME_{n}       # Display name (default: "{App} {n}")
{APP}_INSTANCE_EXTERNAL_URL_{n}  # Browser URL override
{APP}_INSTANCE_TAGS_{n}       # Comma-separated tags
{APP}_INSTANCE_ENABLED_{n}    # true|false (default: true)

# Where {APP} is RADARR, SONARR, or LIDARR
# Where {n} is a positive integer (1, 2, 3, ...)
```

### Pattern B (Generic)

```bash
# Required per index
INSTANCE_TYPE_{n}             # radarr|sonarr|lidarr
INSTANCE_URL_{n}              # Base URL
INSTANCE_API_KEY_{n}          # API key

# Optional per index
INSTANCE_NAME_{n}             # Display name (default: "{Type} {n}")
INSTANCE_EXTERNAL_URL_{n}     # Browser URL override
INSTANCE_TAGS_{n}             # Comma-separated tags
INSTANCE_ENABLED_{n}          # true|false (default: true)
```

### Global Options

```bash
PRAXRR_ENV_INSTANCES_TEST=false    # Test connections at startup (default: false)
```

---

## 12. Docker Compose Example

```yaml
services:
  praxrr:
    image: praxrr:latest
    environment:
      # Radarr instances
      - RADARR_INSTANCE_URL_1=http://radarr:7878
      - RADARR_INSTANCE_API_KEY_1=abc123def456
      - RADARR_INSTANCE_NAME_1=Movies
      - RADARR_INSTANCE_URL_2=http://radarr-4k:7878
      - RADARR_INSTANCE_API_KEY_2=ghi789jkl012
      - RADARR_INSTANCE_NAME_2=Movies 4K
      # Sonarr instance
      - SONARR_INSTANCE_URL_1=http://sonarr:8989
      - SONARR_INSTANCE_API_KEY_1=mno345pqr678
      # Lidarr instance (generic pattern)
      - INSTANCE_TYPE_1=lidarr
      - INSTANCE_URL_1=http://lidarr:8686
      - INSTANCE_API_KEY_1=stu901vwx234
    depends_on:
      - radarr
      - sonarr
      - lidarr
```

---

## 13. Open Questions / Decisions Needed

1. **Orphan cleanup**: Should env-sourced instances that are no longer in env vars be automatically deleted on restart? Recommendation: No for v1 (conservative). Add `PRAXRR_ENV_INSTANCES_CLEANUP=true` later.

2. **UI editability**: Should env-sourced instances be fully read-only in the UI, or editable with a "will be overwritten on restart" warning? Recommendation: Editable with warning. This allows temporary debugging/testing without redeploying.

3. **Default delay profile**: Should env-created instances get the default delay profile applied? Recommendation: Yes, follow the same logic as UI create, but make it non-blocking since the Arr app may not be reachable.

4. **Index upper bound**: The parsing loop has an upper bound (100 in the pseudocode). Should this be configurable? Recommendation: Hard-code at 100. Nobody needs more than 100 Arr instances.

5. **Name auto-generation**: When `_NAME_{n}` is not provided, should the default be `"{AppLabel} {n}"` (e.g., "Radarr 1") or `"{AppLabel}"` (dropping the index for index 1)? Recommendation: `"{AppLabel}"` for index 1, `"{AppLabel} {n}"` for n > 1.
