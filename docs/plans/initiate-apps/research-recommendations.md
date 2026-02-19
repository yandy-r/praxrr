# Initiate Apps: Research and Recommendations

Environment-variable-driven Arr instance provisioning at startup.

## Relevant Files

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: Singleton config class; reads all env vars in constructor, exposes `init()` for directory creation
- `packages/praxrr-app/src/hooks.server.ts`: Startup sequence orchestrator -- config.init -> db.initialize -> runMigrations -> logSettings -> pcdManager -> initializeJobs -> auth middleware
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD queries; `ArrInstance` interface, `nameExists()`, `apiKeyExists()` dedup checks
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Full sync config management per instance (quality profiles, delay profiles, media management, metadata profiles)
- `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: Singleton table pattern for one-time operations; used for default DB auto-link guard
- `packages/praxrr-app/src/lib/server/db/migrations/001_create_arr_instances.ts`: Schema: id, name (UNIQUE), type, url, api_key, tags, enabled, created_at, updated_at
- `packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: Adds optional external_url column
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: `createArrClient(type, url, apiKey, options)` factory dispatching to Radarr/Sonarr/Lidarr/Chaptarr
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`: `BaseArrClient.testConnection()` -- calls `/api/{version}/system/status`; built-in retry logic
- `packages/praxrr-app/src/lib/server/utils/arr/types.ts`: `ArrType` for client layer = `'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'`
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`: `ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr']` -- the PCD-level app types (no chaptarr)
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: Existing create flow -- validates type against `VALID_TYPES`, checks `nameExists`, `apiKeyExists`, optionally applies default delay profile
- `packages/praxrr-app/src/routes/arr/test/+server.ts`: Connection test endpoint -- creates client with 3s timeout, 0 retries
- `packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: Default delay profiles for Radarr/Sonarr applied on instance creation
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: Sync pipeline -- reads instances from DB, creates clients, processes sections with concurrency limit
- `packages/praxrr-app/src/lib/server/jobs/cleanup.ts`: `cleanupJobsForArrInstance()` -- cleans job queue entries for deleted instances
- `packages/praxrr-app/src/lib/server/utils/validation/url.ts`: `parseOptionalAbsoluteHttpUrl()` -- reusable URL validation

---

## 1. Implementation Recommendations

### 1a. Env Var Naming Pattern: Use App-Prefixed Only

**Recommendation**: Use the app-prefixed pattern exclusively (`RADARR_INSTANCE_URL_1`, `LIDARR_INSTANCE_API_KEY_1`).

**Rationale**:

- The codebase enforces strict Arr-type semantics everywhere: `ArrType`, `ARR_APP_TYPES`, per-app client classes, per-app sync handlers. Embedding the type in the variable name makes the intent unambiguous and aligns with the Cross-Arr Semantic Validation Policy in CLAUDE.md.
- The generic pattern (`INSTANCE_TYPE_1=LIDARR`) introduces a meta-variable that must be validated before the rest of the group can be parsed. This adds fragile coupling -- a typo in `INSTANCE_TYPE_1` silently makes the remaining 2-3 variables orphans.
- Docker Compose and Kubernetes env injection tools handle prefixed patterns naturally with minimal overhead.
- Users who provision multiple instances of the same type benefit from the prefix grouping being visually scannable in a `.env` file.

**Proposed env vars per instance**:

```
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
RADARR_INSTANCE_NAME_1=Radarr-4K      # optional, auto-generates if missing
RADARR_INSTANCE_EXTERNAL_URL_1=        # optional
RADARR_INSTANCE_ENABLED_1=true         # optional, default true
RADARR_INSTANCE_TAGS_1=4k,remux        # optional, comma-separated
```

**Why not support both patterns**: Supporting both doubles the parsing surface, creates ambiguity about precedence, and complicates documentation. The app-prefixed pattern alone satisfies all use cases. If a user has many heterogeneous instances, the prefix is still readable and each group is self-contained.

### 1b. Parsing Location

**Recommendation**: Create a new module `packages/praxrr-app/src/lib/server/utils/config/envInstances.ts` that is imported and called from `hooks.server.ts`.

**Rationale**:

- `config.ts` is a simple constructor-based singleton that reads flat env vars. Indexed-group parsing is fundamentally different (scan, group, validate) and should not bloat the config constructor.
- The startup sequence in `hooks.server.ts` already demonstrates the pattern: the default DB auto-link reads env vars and calls `pcdManager.link()` at a specific point in the startup. Instance provisioning should follow the same shape, inserted **after** migrations and **before** `initializeJobs()`.
- The new module should export a single function `reconcileEnvInstances()` that reads env, compares with DB state, and upserts.

**Proposed insertion point in `hooks.server.ts`**:

```
config.init() -> db.initialize() -> runMigrations() -> logSettings.load()
-> logContainerConfig() -> pcdManager.initialize() -> ** reconcileEnvInstances() **
-> initializeJobs() -> cleanupExpiredSessions() -> printBanner()
```

This ensures the DB is migrated and PCD is ready before instances are reconciled, and that jobs (which depend on instance existence) are initialized after.

### 1c. Env-Sourced vs. DB-Stored Instance Relationship

**Recommendation**: Env-defined instances are **reconciled into the DB** and become first-class DB rows. Add a `source` column (`'user' | 'env'`) to `arr_instances` to track provenance.

**Key behaviors**:

- On startup, parse env vars and group by `(arr_type, index)`.
- For each parsed instance, match against existing DB rows by `api_key` (unique per Arr instance in real deployments, already enforced by `apiKeyExists`).
- If no match: INSERT the instance with `source = 'env'`.
- If match exists and `source = 'env'`: UPDATE url/name/tags from env (env is the source of truth for env-sourced instances).
- If match exists and `source = 'user'`: Log a warning and skip. The user created this instance via the UI; env should not silently overwrite it.
- Env-sourced instances with `source = 'env'` that are no longer defined in env: **disable but do not delete** (set `enabled = 0`). This prevents orphaned sync configs and job references from causing errors, and allows the user to re-enable or clean up via the UI.

**Why not delete on env removal**: The instance has foreign key relationships to `arr_sync_quality_profiles`, `arr_sync_delay_profiles_config`, `arr_sync_media_management`, `arr_sync_metadata_profiles_config`, upgrade configs, rename settings, and job queue entries. Cascade delete is configured for sync tables, but hard deletion during startup could destroy user-configured sync relationships if an env var is temporarily removed (typo, rebase, etc.).

### 1d. Phasing Strategy

**Phase 1 -- Core Provisioning** (MVP):

- Env var parser module
- DB migration adding `source` column
- Startup reconciliation logic (insert/update/disable)
- Logging of all provisioning actions
- Unit tests for parser and reconciliation

**Phase 2 -- Connection Validation**:

- Optional startup connection test (configurable via `PRAXRR_VALIDATE_INSTANCES=true`)
- Health status logging per instance
- Mark instances with `enabled = 0` if unreachable (configurable behavior)

**Phase 3 -- UI Integration**:

- Show `source` badge on instances page (env vs user)
- Prevent editing of env-sourced fields in the UI (url, api_key, type are read-only)
- Allow UI-only fields to be edited (sync config, upgrade config)

---

## 2. Improvement Ideas

### 2a. Connection Validation at Startup

The `BaseArrClient.testConnection()` method already exists and calls `/api/{version}/system/status`. Use it with a short timeout (3 seconds, matching the existing test endpoint at `routes/arr/test/+server.ts`) and 0 retries during provisioning. Log the result but do not fail startup.

Consider a new env var `PRAXRR_VALIDATE_INSTANCES` (default `false`):

- `false`: Skip validation, just reconcile to DB
- `true`: Test each instance, log warnings for failures, still create the DB row
- `strict`: Test each instance, skip creating DB row if unreachable

### 2b. Health Check Endpoint

Add `GET /api/v1/instances/health` that returns connection status for all enabled instances. This is useful for monitoring/orchestration and pairs well with Docker HEALTHCHECK. The test endpoint at `/arr/test` already demonstrates the pattern but is form-based, not API-first.

### 2c. Import/Export of Instance Configurations

Lower priority. The env var approach itself is a form of declarative export. A JSON import/export via `GET/POST /api/v1/instances/export` would complement but is not required for the core feature.

### 2d. Instance Groups or Tags

Already supported. The `arr_instances` table has a `tags` column (JSON array). Env vars should support a comma-separated tag list (`RADARR_INSTANCE_TAGS_1=4k,remux`) that gets stored as the JSON array.

### 2e. Auto-Discovery of Local Arr Instances

Not recommended for initial implementation. Auto-discovery would require network scanning or DNS service discovery, which varies dramatically by deployment (Docker bridge, host network, Kubernetes, bare metal). The env var approach is explicit and predictable. Auto-discovery could be a future enhancement but is a separate, larger initiative.

---

## 3. Risk Assessment

### 3a. API Key Exposure in Environment Variables

**Risk**: Medium. API keys in env vars are standard practice for containerized deployments (Radarr/Sonarr themselves use this pattern). The keys are already stored in plaintext in the SQLite DB.

**Mitigations**:

- Document that Docker secrets or Kubernetes secrets are the recommended production approach for sensitive values.
- Do not log API key values during provisioning (log only masked versions: first 4 and last 4 chars).
- The existing `arrInstancesQueries.create()` stores the key; no additional exposure surface.

### 3b. Startup Failure Cascade if Instance Unreachable

**Risk**: High if validation is blocking.

**Mitigations**:

- Default behavior must be non-blocking: parse env, write to DB, log result, continue startup. Validation is optional.
- Even in `strict` mode, failure to reach one instance should not prevent other instances from being provisioned.
- The existing default DB auto-link in `hooks.server.ts` follows this pattern: catch errors, log warning, mark as attempted, continue.

### 3c. Data Integrity Between Env-Configured and DB-Stored Instances

**Risk**: Medium. The `source` column is the key differentiator.

**Mitigations**:

- Match by `api_key` (globally unique per Arr install), not by name or URL (which users may change).
- Never overwrite `source = 'user'` instances from env.
- On conflict (same `api_key` exists with `source = 'user'`), log a clear warning with both the env var name and the existing instance name.

### 3d. Instance Deletion/Orphaning When Env Vars Are Removed

**Risk**: Medium. If an env var group disappears, the instance still exists in the DB.

**Mitigations**:

- Disable (`enabled = 0`) rather than delete. This preserves sync configs and is easily reversible.
- Log a clear message: "Instance 'Radarr-4K' (source: env) no longer defined in environment, disabling."
- Add a setup state flag (`env_instances_reconciled`) following the existing `setup_state` singleton pattern. However, unlike the default DB link, instance reconciliation should run on every startup (not just once), because env vars may change between restarts.

### 3e. Restart Behavior and Idempotency

**Risk**: Medium. Reconciliation must be idempotent.

**Mitigations**:

- Match by `api_key` ensures repeated runs with the same env produce no changes.
- Only update env-sourced instances when the actual values differ (compare url, name, tags, enabled before issuing UPDATE).
- Wrap the entire reconciliation in a transaction. If any step fails, roll back and log the error. Do not partially reconcile.
- The existing `db.transaction()` method in `db.ts` provides this capability.

---

## 4. Alternative Approaches

### 4a. App-Prefixed Pattern (Recommended)

```
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
```

**Pros**: Type-safe by construction, visually scannable, no meta-variables, aligns with Cross-Arr Semantic Validation Policy.

**Cons**: Slightly more verbose for users with one instance of each type.

### 4b. Generic Pattern (Not Recommended)

```
INSTANCE_TYPE_1=radarr
INSTANCE_URL_1=http://radarr:7878
INSTANCE_API_KEY_1=abc123
```

**Pros**: Fewer env var names to remember.

**Cons**: Requires validating a meta-type before other fields, silent failure modes, harder to scan visually in large configs, breaks the codebase convention of Arr-type-prefixed dispatch.

### 4c. Config File Approach (Complement, Not Alternative)

A `praxrr-instances.yml` or `praxrr-instances.json` file in the base path could be an alternative source:

```yaml
instances:
  - name: Radarr-4K
    type: radarr
    url: http://radarr:7878
    apiKey: abc123
    tags: [4k, remux]
```

**Pros**: More expressive, supports complex configs, no index gymnastics.

**Cons**: Requires file management (mount in Docker), different codepath from env vars, harder to integrate with Kubernetes ConfigMaps without templating.

**Recommendation**: Implement env var support first. A config file reader could be added later as an alternative input to the same reconciliation pipeline. The reconciler should accept a `ParsedInstance[]` array regardless of source.

### 4d. Hybrid Approach

Support both env vars and a config file, with env vars taking precedence:

1. Parse config file (if present at `{base_path}/config/instances.yml`)
2. Parse env vars
3. Merge (env overrides file for same index/type combinations)
4. Reconcile merged list against DB

**Recommendation**: Defer hybrid until demand exists. Start with env vars only; design the reconciler interface to accept any `ParsedInstance[]` input so adding a file parser later is trivial.

---

## 5. Task Breakdown Preview

### Phase 1: Core Provisioning (MVP)

**Task Group A: Parser Module** (no dependencies, parallelizable)

- A1: Define `ParsedEnvInstance` interface and `EnvInstanceParseResult` types
- A2: Implement env var scanner -- iterate `Deno.env.toObject()`, group by `(arrType, index)` pattern
- A3: Validate parsed groups (required fields: url, api_key; optional: name, external_url, tags, enabled)
- A4: Auto-generate names for unnamed instances (e.g., `Radarr-1`, `Lidarr-2`)
- A5: Unit tests for parser edge cases (gaps in indices, invalid types, partial groups, duplicate indices)

**Task Group B: DB Migration** (no dependencies, parallelizable with A)

- B1: Create migration adding `source TEXT NOT NULL DEFAULT 'user'` to `arr_instances`
- B2: Update `ArrInstance` interface and `CreateArrInstanceInput` to include `source`
- B3: Add `getBySource(source)` and `getByApiKeyAndSource(apiKey, source)` queries

**Task Group C: Reconciliation Logic** (depends on A, B)

- C1: Implement `reconcileEnvInstances()` function
- C2: Match logic: lookup by `api_key`, branch on `source` column
- C3: Insert new env-sourced instances
- C4: Update changed env-sourced instances (compare fields, skip if identical)
- C5: Disable orphaned env-sourced instances (source='env' not in current env set)
- C6: Transaction wrapping and error handling
- C7: Integration test with in-memory SQLite

**Task Group D: Startup Integration** (depends on C)

- D1: Import and call `reconcileEnvInstances()` in `hooks.server.ts` at the correct position
- D2: Log reconciliation summary (created N, updated N, disabled N, skipped N)
- D3: Apply default delay profiles to newly created Radarr/Sonarr instances (reuse `getDefaultDelayProfile` from `defaults.ts`, gated by `generalSettingsQueries.shouldApplyDefaultDelayProfiles()`)

### Phase 2: Connection Validation

**Task Group E: Validation** (depends on D)

- E1: Add `PRAXRR_VALIDATE_INSTANCES` env var to config
- E2: Implement optional `testConnection()` call during reconciliation
- E3: Log connection results (success with version info, failure with error)
- E4: In `strict` mode, skip instance creation on failure

### Phase 3: UI Integration

**Task Group F: UI** (depends on B)

- F1: Show `source` badge (Env / Manual) on instances list page
- F2: Disable editing of env-sourced core fields (url, api_key, type) in settings form
- F3: Allow editing of non-env fields (sync config, tags override, etc.)

### Dependency Graph

```
A (parser) ----\
                --> C (reconciliation) --> D (startup) --> E (validation)
B (migration) -/                                        \
                                                         --> F (UI)
```

### Parallelization Opportunities

- A and B are fully independent and can be developed in parallel.
- E and F are independent of each other and can be developed in parallel after D.
- Within Group A, tests (A5) can be written alongside implementation (A2-A4).

---

## Architectural Patterns

- **Singleton Config**: `config.ts` uses a class singleton pattern exported as `const config = new Config()`. The new env instance parser should be a standalone function, not added to the Config class, to maintain single responsibility.
- **Setup State Guard**: The `setup_state` table uses a singleton-row pattern (`id = 1`) to guard one-time operations. Instance reconciliation is different -- it should run every startup -- so it should NOT use a setup_state guard.
- **Reconcile-and-continue**: The default DB auto-link in `hooks.server.ts` uses try/catch with `markDefaultDatabaseLinked()` on both success and failure. Instance reconciliation should log and continue on per-instance errors but not mark as permanently attempted.
- **Factory Client Creation**: `createArrClient(type, url, apiKey, options)` dispatches to typed clients. The new module should use this factory for connection testing.
- **Transaction Safety**: `db.transaction()` wraps async functions with auto-rollback on error. The reconciliation should wrap the full batch in a transaction.
- **Dedup by API Key**: `arrInstancesQueries.apiKeyExists()` is the existing uniqueness check. The reconciler should match by `api_key` as the stable identifier (since URLs and names can change).

## Edgecases

- Index gaps in env vars (e.g., `_1`, `_3` with no `_2`) must be handled gracefully -- iterate all matching vars, do not assume contiguous indices.
- An instance whose `api_key` appears in both a `RADARR_INSTANCE_API_KEY_1` env var and an existing `source='user'` DB row must not be overwritten; log a warning with specifics.
- Lidarr uses API v1 (not v3); the `LidarrClient` already overrides `apiVersion`. Connection validation must use the factory, not hardcode a version.
- `chaptarr` is a valid `ArrType` in the client layer but is NOT in `ARR_APP_TYPES` at the PCD/shared level. Decide whether env provisioning should support chaptarr or only the three PCD-recognized types.
- The `VALID_TYPES` array in `routes/arr/new/+page.server.ts` is `['radarr', 'sonarr', 'lidarr']` (no chaptarr). The env parser should use the same allowlist for consistency.
- If `RADARR_INSTANCE_URL_1` is set but `RADARR_INSTANCE_API_KEY_1` is missing, the group is invalid. Log a clear error identifying the incomplete group rather than silently ignoring it.
- Name collision: if auto-generated name `Radarr-1` already exists (created by user), append a disambiguator or use a different scheme like `Radarr (env-1)`.
- The `external_url` column was added by a recent migration (20260216). Ensure the new `source` migration handles the latest schema correctly.
- The `tags` column stores a JSON array string. Env var parsing should split on comma, trim whitespace, and JSON-serialize. Empty string means no tags (null in DB), not `[""]`.

## Other Docs

- `docs/plans/external-url/research-recommendations.md` -- recent migration pattern for adding a column to `arr_instances`
- `docs/plans/enhance-lidarr-support/research-recommendations.md` -- Lidarr-specific sync and client patterns
- `CLAUDE.md` Cross-Arr Semantic Validation Policy -- all Arr-touching changes must validate per-app semantics
