# Pattern Research: initiate-apps

This document catalogs the exact coding patterns, conventions, and architectural approaches found in the Praxrr codebase that are directly relevant to implementing environment-variable-based Arr instance provisioning at startup. Every pattern is referenced with file paths and line numbers from actual code.

---

## Relevant Files

- `/packages/praxrr-app/src/hooks.server.ts`: Startup sequence and default-DB auto-link pattern (the primary template for this feature)
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD queries, type interfaces, `nameExists()`/`apiKeyExists()` checks
- `/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: One-time guard pattern (setup_state singleton)
- `/packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`: `shouldApplyDefaultDelayProfiles()` check
- `/packages/praxrr-app/src/lib/server/db/db.ts`: Database singleton (`db.execute`, `db.queryFirst`, `db.query`, `db.transaction`)
- `/packages/praxrr-app/src/lib/server/db/migrations.ts`: Migration runner, `Migration` interface, registration pattern
- `/packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: ALTER TABLE ADD COLUMN pattern
- `/packages/praxrr-app/src/lib/server/db/migrations/_template.ts`: Migration template
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config singleton, env var reading patterns
- `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Logger singleton, async log methods
- `/packages/praxrr-app/src/lib/server/utils/logger/types.ts`: `LogOptions` interface (`source`, `meta`)
- `/packages/praxrr-app/src/lib/server/utils/validation/url.ts`: URL validation helper (`parseOptionalAbsoluteHttpUrl`)
- `/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: `createArrClient()` factory
- `/packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: Default delay profile logic
- `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: `ArrType` union (includes `'chaptarr'`)
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts` (lines 805-806): Canonical `ARR_APP_TYPES` and `ArrAppType` (excludes `'chaptarr'`)
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: `isArrAppType()` guard, `ArrAppType` re-export
- `/packages/praxrr-app/src/routes/arr/new/+page.server.ts`: Instance creation validation flow and delay profile application
- `/packages/praxrr-app/src/routes/arr/test/+server.ts`: Connection test client creation pattern
- `/packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts`: DB mock/stub test pattern for arrInstances
- `/packages/praxrr-app/src/tests/base/BaseTest.ts`: BaseTest class with lifecycle hooks
- `/packages/praxrr-app/src/scripts/test.ts`: Test runner with aliases

---

## Architectural Patterns

### Startup Hook Sequence

**Pattern: Top-level await chain in hooks.server.ts**

The startup sequence runs as sequential top-level `await` statements before the `handle` export. Each step depends on the previous. The new `reconcileEnvInstances()` call slots between the default-DB auto-link block (line 37) and `initializeJobs()` (line 94).

```typescript
// hooks.server.ts structure:
await config.init(); // line 19
await db.initialize(); // line 22
await runMigrations(); // line 25
logSettings.load(); // line 28 (synchronous)
await logContainerConfig(); // line 31
await pcdManager.initialize(); // line 34
// [default-DB auto-link]     // lines 37-91
// ** NEW: reconcileEnvInstances() goes here **
await initializeJobs(); // line 94
```

### Default-DB Auto-Link Pattern (Primary Template)

**Pattern: Guard-check -> env-read -> domain-call -> mark-guard -> log**

This is the closest existing pattern to what `reconcileEnvInstances()` needs. Key differences: the auto-link uses a one-time `setupState` guard, while env instance reconciliation runs every startup (no guard needed).

```typescript
// hooks.server.ts lines 37-91 -- the exact pattern to follow
if (!setupStateQueries.isDefaultDatabaseLinked()) {
  const defaultDatabaseUrlFromEnv = Deno.env.get('PRAXRR_DEFAULT_DB_URL');
  const defaultDatabaseUrl =
    defaultDatabaseUrlFromEnv === undefined
      ? 'https://github.com/yandy-r/praxrr-db'
      : defaultDatabaseUrlFromEnv.trim();
  // ... more env var reads with ?.trim() || 'default' pattern

  if (!defaultDatabaseUrl) {
    setupStateQueries.markDefaultDatabaseLinked();
    await logger.info('Default database auto-link disabled', {
      source: 'Setup',
      meta: { reason: 'PRAXRR_DEFAULT_DB_URL is empty' },
    });
  } else {
    try {
      await pcdManager.link({ ... });
      setupStateQueries.markDefaultDatabaseLinked();
      await logger.info('Default database auto-linked', {
        source: 'Setup',
        meta: { name: ..., url: ..., branch: ... },
      });
    } catch (error) {
      // Don't fail startup, but mark as attempted
      setupStateQueries.markDefaultDatabaseLinked();
      await logger.warn('Failed to auto-link default database', {
        source: 'Setup',
        meta: { error: String(error) },
      });
    }
  }
}
```

Critical takeaways for implementation:

- The guard is checked synchronously.
- Env vars use `Deno.env.get('NAME')?.trim() || 'default'` pattern.
- `undefined` check for env var differentiates "not set" from "set to empty".
- Domain logic is wrapped in `try/catch`. Failures are logged with `logger.warn`, never thrown.
- The `source: 'Setup'` tag is used for startup-related logs.
- `meta` objects include relevant context but never sensitive values.

### Env Var Reading Convention

**Pattern: `Deno.env.get()` with trim and fallback**

Found in `hooks.server.ts` lines 38-46 and `config.ts` constructor:

```typescript
// Pattern 1: Distinguish "not set" from "set to empty" (hooks.server.ts:38-40)
const defaultDatabaseUrlFromEnv = Deno.env.get('PRAXRR_DEFAULT_DB_URL');
const defaultDatabaseUrl =
  defaultDatabaseUrlFromEnv === undefined ? 'https://github.com/yandy-r/praxrr-db' : defaultDatabaseUrlFromEnv.trim();

// Pattern 2: Optional with trim and default (hooks.server.ts:41-45)
const branch = Deno.env.get('PRAXRR_DEFAULT_DB_BRANCH')?.trim() || 'v2';
const token = Deno.env.get('PRAXRR_DEFAULT_DB_TOKEN')?.trim() || undefined;

// Pattern 3: Simple with fallback (config.ts:40-41)
const parserHost = Deno.env.get('PARSER_HOST') || 'localhost';
const parserPort = Deno.env.get('PARSER_PORT') || '5000';

// Pattern 4: Enum validation (config.ts:49-50)
const auth = (Deno.env.get('AUTH') || 'on').toLowerCase();
this.authMode = ['on', 'local', 'off', 'oidc'].includes(auth) ? (auth as AuthMode) : 'on';
```

For `initiate-apps`: use `Deno.env.get()?.trim() || undefined` for required fields (treat empty as unset), and `?.trim() || 'default'` for optional fields.

### Migration Pattern

**Interface**: Defined in `/packages/praxrr-app/src/lib/server/db/migrations.ts` (line 61):

```typescript
export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
  afterUp?: () => void; // Optional callback for data migrations
}
```

**Version numbering**: Recent migrations use `YYYYMMDD` format (e.g., `20260216`, `20260217`, `20260218`, `20260219`). The next available version is `20260220` or later.

**ALTER TABLE ADD COLUMN pattern** (`20260216_add_arr_instance_external_url.ts`):

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

Note: No `down` provided for this simple ALTER TABLE migration.

For a NOT NULL column with DEFAULT, the migration SQL is:

```sql
ALTER TABLE arr_instances ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
```

**Registration**: Each migration is statically imported in `/packages/praxrr-app/src/lib/server/db/migrations.ts` and added to the `loadMigrations()` array (lines 275-332). The import alias follows a consistent pattern:

```typescript
// In migrations.ts -- add at end of imports
import { migration as migration20260220 } from './migrations/20260220_add_arr_instance_source.ts';

// In loadMigrations() -- add at end of array
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = [
    // ... existing migrations
    migration20260219,
    migration20260220, // NEW
  ];
  return migrations.sort((a, b) => a.version - b.version);
}
```

### Database Query Pattern

**Pattern: Raw parameterized SQL via `db` singleton**

All queries in `arrInstances.ts` use raw SQL strings with `?` placeholders passed as rest parameters. No ORM or query builder is used.

```typescript
// Execute (returns affected row count)
db.execute(
  `INSERT INTO arr_instances (name, type, url, external_url, api_key, tags, enabled)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  input.name,
  input.type,
  input.url,
  externalUrl,
  input.apiKey,
  tagsJson,
  enabled
);

// Query first (returns single row or undefined)
const result = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() as id');

// Query all (returns array)
db.query<ArrInstance>('SELECT * FROM arr_instances ORDER BY name');

// Count pattern for existence checks
const result = db.queryFirst<{ count: number }>('SELECT COUNT(*) as count FROM arr_instances WHERE name = ?', name);
return (result?.count ?? 0) > 0;
```

The `db.execute()` method returns the number of affected rows (`db.getDatabase().changes`). The `db.transaction()` method wraps a callback in BEGIN/COMMIT/ROLLBACK.

### Instance Create Flow

**Pattern: Validate -> Check uniqueness -> Insert -> Get ID -> Post-create side effects**

From `/packages/praxrr-app/src/routes/arr/new/+page.server.ts` (lines 27-157):

1. Validate required fields: `name`, `type`, `url`, `apiKey`
2. Validate type against `VALID_TYPES = ['radarr', 'sonarr', 'lidarr']`
3. Validate external URL via `parseOptionalAbsoluteHttpUrl()`
4. Check `arrInstancesQueries.nameExists(name)` -- rejects duplicates
5. Check `arrInstancesQueries.apiKeyExists(apiKey)` -- rejects duplicates
6. Call `arrInstancesQueries.create({ name, type, url, externalUrl, apiKey, tags, enabled })`
7. Apply default delay profile if `type === 'radarr' || type === 'sonarr'` AND `generalSettingsQueries.shouldApplyDefaultDelayProfiles()`
8. Delay profile failure is caught and logged but does not fail instance creation

```typescript
// Delay profile application pattern (lines 119-142)
if ((type === 'radarr' || type === 'sonarr') && generalSettingsQueries.shouldApplyDefaultDelayProfiles()) {
  try {
    const client = createArrClient(type as ArrType, url, apiKey);
    const defaultProfile = getDefaultDelayProfile(type);
    await client.updateDelayProfile(1, { ...defaultProfile, id: 1, order: 2147483647 });
    await logger.info(`Applied default delay profile to ${name}`, {
      source: 'arr/new',
      meta: { id, type, profile: defaultProfile },
    });
  } catch (error) {
    await logger.warn(`Failed to apply default delay profile to ${name}`, {
      source: 'arr/new',
      meta: { id, type, error: error instanceof Error ? error.message : error },
    });
  }
}
```

### ArrInstance Interface and Create Input

From `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`:

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
}
```

The `create()` method (lines 54-74) returns the new row ID. Tags are JSON-stringified, enabled defaults to 1, and `externalUrl` is normalized via `normalizeExternalUrl()`.

### Logger Pattern

**Pattern: `await logger.{level}(message, { source, meta })`**

All logger methods are async and must be awaited. The `LogOptions` interface:

```typescript
export interface LogOptions {
  meta?: unknown;
  source?: string;
}
```

Usage conventions from the codebase:

```typescript
// Info-level for successful operations
await logger.info('Default database auto-linked', {
  source: 'Setup',
  meta: { name: ..., url: ..., branch: ... },
});

// Warn-level for non-fatal failures and skipped operations
await logger.warn('Failed to auto-link default database', {
  source: 'Setup',
  meta: { error: String(error) },
});

// Error-level for unexpected failures (rare in startup code)
await logger.error('Failed to create arr instance', {
  source: 'arr/new',
  meta: error,
});

// Debug-level for internal state (no action required)
await logger.debug('Database up to date', {
  source: 'DatabaseMigrations',
});
```

The `source` field uses short descriptive tags. For this feature, use `'Setup'` to match the default-DB auto-link precedent, or `'Setup:Instances'` for more specificity.

**Critical: Never log API keys.** Existing code logs `url`, `name`, `type`, `id` but never `apiKey`.

### URL Validation Pattern

From `/packages/praxrr-app/src/lib/server/utils/validation/url.ts`:

```typescript
export interface ParsedHttpUrl {
  value: string | null;
  isValid: boolean;
}

export function parseOptionalAbsoluteHttpUrl(rawUrl: string | null | undefined): ParsedHttpUrl {
  const value = rawUrl?.trim() || null;
  if (value === null) return { value: null, isValid: true };
  try {
    const parsed = new URL(value);
    if (!ALLOWED_HTTP_SCHEMES.includes(parsed.protocol as (typeof ALLOWED_HTTP_SCHEMES)[number])) {
      return { value, isValid: false };
    }
    return { value, isValid: true };
  } catch {
    return { value, isValid: false };
  }
}
```

For `initiate-apps`, instance URLs are required and must be valid absolute HTTP(S) URLs. Use `new URL(value)` for validation and check the protocol. External URLs are optional and use this same helper.

### Type Validation Pattern

**Pattern: Static array + `.includes()` check**

From `/packages/praxrr-app/src/routes/arr/new/+page.server.ts` line 11:

```typescript
const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];
```

The canonical source is `/packages/praxrr-app/src/lib/shared/pcd/types.ts` lines 805-806:

```typescript
export const ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;
export type ArrAppType = (typeof ARR_APP_TYPES)[number];
```

And the `isArrAppType()` guard from `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`:

```typescript
export function isArrAppType(value: string): value is ArrAppType {
  return (SHARED_ARR_APP_TYPES as readonly string[]).includes(value);
}
```

Note: `ArrType` in `$arr/types.ts` includes `'chaptarr'`, but `ArrAppType` from `$shared/pcd/types.ts` does not. Instance creation only validates against `['radarr', 'sonarr', 'lidarr']`.

### Connection Test Pattern

From `/packages/praxrr-app/src/routes/arr/test/+server.ts` lines 22-24:

```typescript
const client = createArrClient(type as ArrType, url, apiKey, { timeout: 3000, retries: 0 });
const isConnected = await client.testConnection();
client.close();
```

For startup connection testing (optional Phase 2), follow this exact pattern with `timeout: 3000` and `retries: 0`.

---

## Code Conventions

### Naming

- **File names**: `camelCase.ts` for modules, `YYYYMMDD_snake_case.ts` for migrations
- **Export pattern**: Named exports (`export const arrInstancesQueries`, `export const migration`)
- **Query modules**: Object literal with methods exported as `const xxxQueries = { ... }`
- **Interfaces**: PascalCase, prefixed descriptively (`ArrInstance`, `CreateArrInstanceInput`, `UpdateArrInstanceInput`)
- **SQL column names**: `snake_case` (`api_key`, `external_url`, `created_at`)
- **TypeScript property names**: `camelCase` in interfaces/inputs, except when matching SQL columns directly in query result types (`ArrInstance.api_key` matches the DB column)

### Boolean Storage

SQLite booleans are stored as `INTEGER` (0/1). TypeScript interfaces use `number` for DB types and `boolean` for input types:

```typescript
// DB result type
enabled: number;  // 0 or 1

// Input type
enabled?: boolean;

// Conversion in create()
const enabled = input.enabled !== false ? 1 : 0;
```

### Import Conventions

Path aliases are used consistently:

```typescript
import { db } from '$db/db.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import { config } from '$config';
import { createArrClient } from '$arr/factory.ts';
import { getDefaultDelayProfile } from '$arr/defaults.ts';
import type { ArrType } from '$arr/types.ts';
import { parseOptionalAbsoluteHttpUrl } from '$utils/validation/url.ts';
import { generalSettingsQueries } from '$db/queries/generalSettings.ts';
```

All server-side imports include the `.ts` extension.

---

## Error Handling

### Startup Error Philosophy

**Non-blocking**: Startup operations that are not strictly required for the server to function use try/catch and continue. This is the established pattern for the default-DB auto-link and must be followed by env instance reconciliation.

```typescript
// Pattern: try domain-logic, catch and log, continue startup
try {
  await domainOperation();
  await logger.info('Success message', { source: 'Setup', meta: { ... } });
} catch (error) {
  // Don't fail startup
  await logger.warn('Failure message', {
    source: 'Setup',
    meta: { error: String(error) },
  });
}
```

### Per-Instance Error Isolation

The instance creation route wraps individual instance creation in try/catch and continues. For reconciliation, each env instance should be processed independently so one failure does not block others.

### Error Stringification

When logging caught errors, the codebase uses:

- `String(error)` for unknown error types (hooks.server.ts line 87)
- `error instanceof Error ? error.message : error` for typed errors (arr/new/+page.server.ts line 139)

---

## Testing Approach

### Test Infrastructure

Tests live in `/packages/praxrr-app/src/tests/` organized by domain:

- `base/` -- Foundational feature tests
- `arr/` -- Arr-specific feature tests
- `jobs/` -- Job/sync tests
- `upgrades/` -- Upgrade engine tests

### Test Runner

Tests run via `deno task test` which invokes `/scripts/test.ts`. Custom aliases map to specific files/directories. The runner passes `--allow-read --allow-write --allow-env --allow-ffi` and sets `APP_BASE_PATH=./dist/test`.

A new alias should be added for env instance tests:

```typescript
// In scripts/test.ts aliases
'env-instances': 'packages/praxrr-app/src/tests/base/envInstances.test.ts',
```

### DB Mock Pattern (Simple)

For unit tests that mock `db` methods directly, from `/packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts`:

```typescript
function captureDbWrites(): {
  executeCalls: SqlCall[];
  queryFirstCalls: SqlCall[];
  restore: () => void;
} {
  const executeCalls: SqlCall[] = [];
  const queryFirstCalls: SqlCall[] = [];
  const originalExecute = db.execute;
  const originalQueryFirst = db.queryFirst;

  db.execute = ((sql: string, ...params: unknown[]) => {
    executeCalls.push({ sql, params });
    return 1;
  }) as typeof db.execute;

  db.queryFirst = ((sql: string, ...params: unknown[]) => {
    queryFirstCalls.push({ sql, params });
    return { id: 77 } as { id: number };
  }) as typeof db.queryFirst;

  return {
    executeCalls,
    queryFirstCalls,
    restore: () => {
      db.execute = originalExecute;
      db.queryFirst = originalQueryFirst;
    },
  };
}

Deno.test('test name', () => {
  const harness = captureDbWrites();
  try {
    // ... test logic using arrInstancesQueries ...
    assertEquals(harness.executeCalls.length, 1);
  } finally {
    harness.restore(); // Always restore in finally block
  }
});
```

### BaseTest Class Pattern (Complex)

For more structured tests, extend `BaseTest` from `/packages/praxrr-app/src/tests/base/BaseTest.ts`:

```typescript
class MyFeatureTest extends BaseTest {
  private restores: Restore[] = [];

  protected override beforeEach(): void {
    this.restores = [];
  }
  protected override afterEach(): void {
    for (const restore of this.restores.reverse()) restore();
  }

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    this.restores.push(() => {
      target[key] = original;
    });
  }

  runTests(): void {
    this.test('should do something', () => {
      this.patch(arrInstancesQueries, 'nameExists', () => false);
      // ... test logic
    });
  }
}

const suite = new MyFeatureTest();
suite.runTests();
```

### Env Var Testing

The test runner already passes `--allow-env`, and `Deno.env.toObject()` is already used in the test runner itself (scripts/test.ts line 49). For parser unit tests, use `Deno.env.set()` and `Deno.env.delete()` to set up test scenarios, or mock `Deno.env.get()` / `Deno.env.toObject()`.

---

## Patterns to Follow

### 1. New Module Location

Place the new env instances module at:

```
packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts
```

This aligns with the `$arr/` alias and keeps Arr-domain logic co-located with the factory, types, and defaults.

### 2. Migration File

Create at:

```
packages/praxrr-app/src/lib/server/db/migrations/20260220_add_arr_instance_source.ts
```

Follow the exact structure of `20260216_add_arr_instance_external_url.ts`. Version number `20260220` (next date after existing `20260219`).

### 3. hooks.server.ts Integration

Add the new call between the default-DB auto-link block (line 91) and `initializeJobs()` (line 94):

```typescript
// Initialize arr instances from environment variables
import { reconcileEnvInstances } from '$arr/envInstances.ts';

// ... after default-DB auto-link block ...

// Reconcile arr instances declared via environment variables
await reconcileEnvInstances();

// Initialize and start job queue
await initializeJobs();
```

### 4. Query Extensions

Add to `arrInstancesQueries` in `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`:

- Update `ArrInstance` interface to include `source: string`
- Update `CreateArrInstanceInput` to include `source?: 'ui' | 'env'`
- Update `create()` INSERT statement to include `source` column
- Add `getBySource(source: 'ui' | 'env'): ArrInstance[]` query
- Add `getByApiKey(apiKey: string): ArrInstance | undefined` query (for matching)
- Add `disableOrphanedEnvInstances(activeApiKeys: string[]): number` for orphan handling

### 5. Env Var Scanning

Use `Deno.env.get()` per variable (not `Deno.env.toObject()`), matching the established pattern from hooks.server.ts. Iterate over known app types and index range:

```typescript
const APP_PREFIXES = ['RADARR', 'SONARR', 'LIDARR'] as const;
const MAX_INDEX = 100;

for (const prefix of APP_PREFIXES) {
  for (let i = 1; i <= MAX_INDEX; i++) {
    const url = Deno.env.get(`${prefix}_INSTANCE_URL_${i}`)?.trim();
    if (!url) continue;
    // ...
  }
}
```

### 6. Logging Convention

Use `source: 'Setup'` for consistency with the default-DB auto-link. Log a per-instance line for each action and a summary at the end:

```typescript
await logger.info('Created env instance', {
  source: 'Setup',
  meta: { name, type, url }, // Never log apiKey
});

await logger.warn('Skipped env instance: name collision with UI instance', {
  source: 'Setup',
  meta: { envName: name, existingId: existing.id },
});

await logger.info('Reconciled env instances', {
  source: 'Setup',
  meta: { total: N, created: C, updated: U, skipped: S, disabled: D },
});
```

### 7. Type Validation

Use the canonical `ARR_APP_TYPES` from `$shared/pcd/types.ts` or `isArrAppType()` from `$shared/arr/capabilities.ts` rather than hard-coding the array:

```typescript
import { ARR_APP_TYPES } from '$shared/pcd/types.ts';
// or
import { isArrAppType } from '$shared/arr/capabilities.ts';
```

### 8. Delay Profile Application

Follow the exact pattern from `arr/new/+page.server.ts` lines 119-142. Only applies to `radarr` and `sonarr` (not `lidarr`). Must be non-blocking (catch errors, log, continue).

### 9. URL Validation for Instance URLs

Instance URLs (required) should be validated as absolute HTTP(S) URLs. Reuse `parseOptionalAbsoluteHttpUrl` or use `new URL()` directly since the URL is required (not optional):

```typescript
try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // invalid scheme
  }
} catch {
  // invalid URL
}
```

External URLs (optional) should use the existing `parseOptionalAbsoluteHttpUrl()`.

---

## Edge Cases

- **`api_key` uniqueness is app-level only**: No SQL UNIQUE constraint on `api_key` in `arr_instances`. Must check via `arrInstancesQueries.apiKeyExists()` or a new `getByApiKey()` query.
- **`name` uniqueness is case-sensitive at SQL level**: The UNIQUE constraint on `name` is case-sensitive. `arrInstancesQueries.nameExists()` uses exact match. Two env instances named "Radarr" and "radarr" would be treated as different names.
- **`ArrType` vs `ArrAppType`**: `ArrType` (from `$arr/types.ts`) includes `'chaptarr'`, but instance creation only allows `['radarr', 'sonarr', 'lidarr']`. Use `ArrAppType` from `$shared/pcd/types.ts`.
- **Empty string env vars**: `Deno.env.get('VAR')` returns `undefined` when unset, but returns `""` when set to empty. The `?.trim() || undefined` pattern treats both as absent, which is the correct behavior per feature spec.
- **HMR re-runs in dev**: The upsert logic must be idempotent. Since `hooks.server.ts` re-runs on HMR, the reconciliation will re-execute. This is safe if the logic does compare-before-update.
- **Tag format**: The route handler expects tags as a JSON-stringified array from FormData. Env vars use comma-separated values (`TAGS_1=movies,4k`). Parser must convert comma-separated to `string[]`.
- **Default delay profiles need network access**: If Arr instances are not reachable at startup (common in Docker Compose), delay profile application will fail. This is expected and handled by the existing catch-and-continue pattern.
- **FK cascade on delete**: All sync tables have `ON DELETE CASCADE` referencing `arr_instances(id)`. Disabling orphans (`enabled=0`) preserves FKs; deleting would cascade.

---

## Other Docs

- `/docs/plans/initiate-apps/feature-spec.md`: Complete feature specification with business rules, conflict resolution, and task breakdown
- `/docs/plans/initiate-apps/research-technical.md`: Architecture design, data model, upsert logic, and startup integration details
- `/docs/plans/initiate-apps/research-business.md`: User stories and business rules
- `/docs/plans/initiate-apps/research-recommendations.md`: Implementation strategy and phasing
- `/packages/praxrr-app/src/lib/server/db/migrations/_template.ts`: Migration template with documentation
