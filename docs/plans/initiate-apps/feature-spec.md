# Feature Spec: initiate-apps

## Executive Summary

The initiate-apps feature enables declarative Arr instance (Radarr, Sonarr, Lidarr) provisioning via indexed environment variables at startup, eliminating the need for manual UI configuration in Docker/IaC deployments. Instances are defined using an app-type-prefixed naming pattern (`RADARR_INSTANCE_URL_1`, `RADARR_INSTANCE_API_KEY_1`) and reconciled into the `arr_instances` table on every startup, with a new `source` column (`'ui' | 'env'`) distinguishing provenance. The implementation slots into the existing startup sequence in `hooks.server.ts` between PCD initialization and job startup, reusing the existing `arrInstancesQueries` CRUD layer, `createArrClient` factory, and `BaseArrClient.testConnection()` infrastructure with zero new dependencies. Primary risks include startup failure cascade (mitigated by non-blocking design), data integrity between env and UI-created instances (mitigated by `api_key`-based matching and `source` column discrimination), and orphan handling when env vars are removed (mitigated by disabling rather than deleting).

## External Dependencies

### APIs and Services

#### Radarr API (v3)

- **Documentation**: [https://radarr.video/docs/api/](https://radarr.video/docs/api/)
- **Authentication**: `X-Api-Key` header or `?apikey=` query param
- **Key Endpoints**:
  - `GET /api/v3/system/status`: Connectivity validation (requires API key)
  - `GET /ping`: Unauthenticated health check
- **Rate Limits**: None documented
- **Default Port**: 7878

#### Sonarr API (v3)

- **Documentation**: [https://sonarr.tv/docs/api/](https://sonarr.tv/docs/api/)
- **Authentication**: Same as Radarr
- **Key Endpoints**: Same structure as Radarr at `/api/v3/`
- **Default Port**: 8989

#### Lidarr API (v1)

- **Documentation**: [https://lidarr.audio/docs/api/](https://lidarr.audio/docs/api/)
- **Authentication**: Same as Radarr
- **Key Endpoints**: Same structure at `/api/v1/` (different version)
- **Default Port**: 8686

### Libraries and SDKs

No new dependencies required. The existing Praxrr infrastructure handles everything:

| Component             | Path                          | Purpose                                             |
| --------------------- | ----------------------------- | --------------------------------------------------- |
| `BaseArrClient`       | `$arr/base.ts`                | Connection testing via `testConnection()`           |
| `createArrClient`     | `$arr/factory.ts`             | Typed client creation (handles API version per app) |
| `arrInstancesQueries` | `$db/queries/arrInstances.ts` | Instance CRUD, `nameExists()`, `apiKeyExists()`     |
| `Deno.env.toObject()` | Built-in                      | Environment variable scanning                       |

### Ecosystem Precedent

| Tool      | Pattern               | Index Start | Example                    |
| --------- | --------------------- | ----------- | -------------------------- |
| Notifiarr | `DN_{APP}_{N}_{PROP}` | 0           | `DN_SONARR_0_URL`          |
| Unpackerr | `UN_{APP}_{N}_{PROP}` | 0           | `UN_RADARR_0_URL`          |
| Recyclarr | YAML + `!env_var`     | N/A         | `!env_var RADARR_BASE_URL` |
| Buildarr  | YAML instances block  | N/A         | Named instances            |

## Business Requirements

### User Stories

**Primary User: Self-Hosted Media Server Operator**

- As a Docker Compose user, I want to declare my Arr instances in my compose file so that Praxrr is fully provisioned on first startup without manual UI interaction.
- As a home lab user running Radarr, Sonarr, and Lidarr, I want Praxrr to auto-connect to all my Arr instances at startup so that I can begin configuring sync profiles immediately.
- As an operator managing multiple environments, I want to define instance configurations in environment variables so that I can replicate my setup across environments using IaC patterns.

**Secondary User: Platform Operator (Kubernetes / Fleet Deployment)**

- As a platform operator, I want to pre-configure known Arr endpoints via env vars so that end users do not need to know internal URLs and API keys.

### Business Rules

1. **App-Prefixed Naming Pattern**: Variables follow `{APP}_INSTANCE_{PROP}_{N}` where `{APP}` is `RADARR|SONARR|LIDARR`, `{PROP}` is `URL|API_KEY|NAME|EXTERNAL_URL|TAGS|ENABLED`, and `{N}` is a positive integer.

2. **Required Fields**: URL and API key are mandatory per index. Missing either makes that index invalid (skip with warning log).

3. **Type Validation**: Supported types are `radarr`, `sonarr`, `lidarr` (matching `ARR_APP_TYPES` from `$shared/pcd/types.ts`).

4. **Idempotent Reconciliation**: Env-declared instances are matched against existing DB rows by `api_key` (globally unique per Arr install). Matching `source='env'` rows are updated; matching `source='ui'` rows are skipped with a warning.

5. **Create-Only for User Instances**: Env provisioning never overwrites `source='ui'` instances. Name collisions with user-created instances are logged and skipped.

6. **Non-Blocking Startup**: Connection testing is optional and off by default. Instances are registered regardless of reachability.

7. **Orphan Handling**: Env-sourced instances no longer defined in env vars are disabled (`enabled=0`), not deleted, to preserve foreign key relationships.

8. **Name Auto-Generation**: If `{APP}_INSTANCE_NAME_{N}` is absent, generate `"{AppLabel}"` for index 1, `"{AppLabel} {N}"` for N > 1. Ensure uniqueness via `nameExists()`.

9. **Default Delay Profiles**: Apply default delay profiles to new Radarr/Sonarr instances when `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` returns true, non-blocking on failure.

10. **Run Every Startup**: Unlike the default-DB auto-link (which uses a setup_state guard), env instance reconciliation runs on every startup to detect env var changes.

### Edge Cases

| Scenario                                            | Expected Behavior                    | Notes                                         |
| --------------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| Sparse indices (`_1`, `_3`, no `_2`)                | Process all found indices            | Do not require contiguous numbering           |
| Duplicate API key across indices                    | Skip second occurrence with info log | First encountered wins                        |
| Partial config (URL but no API key)                 | Skip index with warning log          | Do not error on incomplete groups             |
| Empty string values (`URL_1=""`)                    | Treat as unset                       | Trim and skip blank values                    |
| Name collision with UI instance                     | Skip env instance with warning       | Never overwrite `source='ui'`                 |
| API key exists as `source='user'`                   | Skip with warning log                | Do not alter user-created instances           |
| Type mismatch (env says radarr, API returns Sonarr) | Log warning, use detected type       | `appName` from system/status is authoritative |
| Env var removed between restarts                    | Disable orphaned `source='env'` row  | Set `enabled=0`, preserve sync config         |

### Success Criteria

- [ ] Docker Compose with `RADARR_INSTANCE_URL_1`, `RADARR_INSTANCE_API_KEY_1` creates a Radarr instance on first startup
- [ ] Multiple instances across different types declared simultaneously
- [ ] Restarting the container does not duplicate instances
- [ ] Env var value changes are reflected after restart (for `source='env'` instances)
- [ ] Missing required fields produce warning logs without blocking other instances
- [ ] Default delay profiles applied when applicable
- [ ] Created instances visible in UI and usable for sync configuration
- [ ] Orphaned env instances disabled (not deleted) when env vars removed

## Technical Specifications

### Architecture Overview

```text
Startup Sequence:
  config.init() -> db.initialize() -> runMigrations() -> logSettings.load()
    -> pcdManager.initialize() -> [auto-link default DB]
    -> ** reconcileEnvInstances() **     <-- NEW
    -> initializeJobs() -> cleanupExpiredSessions() -> printBanner()

Data Flow:
  Deno.env.toObject()
    -> parseArrInstanceEnvVars()  [pure function, regex matching]
    -> ParsedEnvInstance[]
    -> reconcileEnvInstances()    [DB upsert logic]
      -> for each parsed instance:
           match by api_key in arr_instances
           branch on source column (env vs ui)
           INSERT / UPDATE / SKIP
      -> disable orphaned source='env' rows
    -> log summary
```

### Data Models

#### arr_instances (modified)

New `source` column:

| Field  | Type | Constraints           | Description                            |
| ------ | ---- | --------------------- | -------------------------------------- |
| source | TEXT | NOT NULL DEFAULT 'ui' | Instance provenance: `'ui'` or `'env'` |

All existing columns remain unchanged:

| Field        | Type     | Constraints               | Description                          |
| ------------ | -------- | ------------------------- | ------------------------------------ |
| id           | INTEGER  | PK AUTOINCREMENT          | Primary key                          |
| name         | TEXT     | NOT NULL UNIQUE           | Display name                         |
| type         | TEXT     | NOT NULL                  | `'radarr'` / `'sonarr'` / `'lidarr'` |
| url          | TEXT     | NOT NULL                  | Base URL                             |
| external_url | TEXT     | nullable                  | Browser-facing URL                   |
| api_key      | TEXT     | NOT NULL                  | API key (app-level unique)           |
| tags         | TEXT     | nullable                  | JSON array string                    |
| enabled      | INTEGER  | NOT NULL DEFAULT 1        | Active flag                          |
| source       | TEXT     | NOT NULL DEFAULT 'ui'     | **NEW**: `'ui'` or `'env'`           |
| created_at   | DATETIME | DEFAULT CURRENT_TIMESTAMP | Creation time                        |
| updated_at   | DATETIME | DEFAULT CURRENT_TIMESTAMP | Update time                          |

#### Migration

```sql
ALTER TABLE arr_instances ADD COLUMN source TEXT NOT NULL DEFAULT 'ui';
```

### Conflict Resolution Strategy

| Scenario                                             | Action                                    |
| ---------------------------------------------------- | ----------------------------------------- |
| New env instance, no DB match                        | INSERT with `source='env'`                |
| Env instance, existing `source='env'` same `api_key` | UPDATE url/name/tags/enabled/external_url |
| Env instance, existing `source='ui'` same `api_key`  | SKIP with warning                         |
| Env instance, name collision with `source='ui'`      | SKIP with warning                         |
| DB row `source='env'`, no matching env var           | DISABLE (`enabled=0`)                     |

### API Design

No new API endpoints required. Env-sourced instances appear in existing `arrInstancesQueries.getAll()` results and are accessible through all existing routes.

### System Integration

#### New Files

| File                                                                                   | Purpose                               |
| -------------------------------------------------------------------------------------- | ------------------------------------- |
| `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`                         | Env var parser + reconciliation logic |
| `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_add_arr_instance_source.ts` | Add `source` column                   |

#### Files to Modify

| File                                                            | Change                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/hooks.server.ts`                       | Import and call `reconcileEnvInstances()` between PCD auto-link and `initializeJobs()`               |
| `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` | Add `source` to `ArrInstance` interface and `create()` input; add `getBySource()`, `upsertFromEnv()` |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`           | Register new migration                                                                               |
| `packages/praxrr-app/src/lib/server/db/schema.sql`              | Document `source` column                                                                             |

#### Environment Variable Reference

```bash
# Required per index (Pattern A: App-Prefixed)
{APP}_INSTANCE_URL_{N}            # Base URL (e.g., http://radarr:7878)
{APP}_INSTANCE_API_KEY_{N}        # API key

# Optional per index
{APP}_INSTANCE_NAME_{N}           # Display name (default: auto-generated)
{APP}_INSTANCE_EXTERNAL_URL_{N}   # Browser URL override
{APP}_INSTANCE_TAGS_{N}           # Comma-separated tags
{APP}_INSTANCE_ENABLED_{N}        # true|false (default: true)

# Where {APP} is RADARR, SONARR, or LIDARR
# Where {N} is a positive integer (1, 2, 3, ...)

# Global options
PRAXRR_VALIDATE_INSTANCES=false   # Test connections at startup (default: false)
```

#### Docker Compose Example

```yaml
services:
  praxrr:
    image: praxrr:latest
    environment:
      - RADARR_INSTANCE_URL_1=http://radarr:7878
      - RADARR_INSTANCE_API_KEY_1=${RADARR_API_KEY}
      - RADARR_INSTANCE_NAME_1=Movies
      - RADARR_INSTANCE_URL_2=http://radarr4k:7878
      - RADARR_INSTANCE_API_KEY_2=${RADARR_4K_API_KEY}
      - RADARR_INSTANCE_NAME_2=Movies 4K
      - SONARR_INSTANCE_URL_1=http://sonarr:8989
      - SONARR_INSTANCE_API_KEY_1=${SONARR_API_KEY}
      - LIDARR_INSTANCE_URL_1=http://lidarr:8686
      - LIDARR_INSTANCE_API_KEY_1=${LIDARR_API_KEY}
    depends_on:
      - radarr
      - sonarr
      - lidarr
```

## UX Considerations

### User Workflows

#### Primary Workflow: Docker Compose Configuration

1. **Discovery**: User reads documentation showing env var names and Docker Compose example
2. **Configuration**: User adds variables to `docker-compose.yml` or `.env` file
3. **Deployment**: User runs `docker compose up -d`
4. **Validation**: User checks container logs for startup confirmation
5. **Verification**: User opens web UI to confirm instances appear

#### Startup Log Output

```
INFO [Setup] Environment instance configuration:
  [1] Radarr  (http://radarr:7878)    - Created
  [2] Movies 4K (http://radarr4k:7878) - Created
  [3] Sonarr  (http://sonarr:8989)    - Created
  [4] Lidarr  (http://lidarr:8686)    - Already exists (skipped)
INFO [Setup] Reconciled 4 env instance(s): 3 created, 0 updated, 1 skipped, 0 disabled
```

#### Error Recovery

| Error             | Log Message Pattern                                                        | Recovery                                          |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Missing API key   | `RADARR_INSTANCE_URL_1 set but RADARR_INSTANCE_API_KEY_1 missing; skipped` | Add the missing env var                           |
| Invalid URL       | `RADARR_INSTANCE_URL_1="not-a-url" is not a valid URL; skipped`            | Fix the URL format                                |
| Name collision    | `Name "Movies" already used by a manually-created instance; skipped`       | Change the env var name or remove the UI instance |
| Duplicate API key | `API key for RADARR_INSTANCE_API_KEY_2 already registered; skipped`        | Remove the duplicate                              |

### UI Patterns

| Component         | Pattern                                    | Notes                                                                           |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Instance list     | `ENV` badge on env-sourced instances       | Small tag next to name                                                          |
| Instance settings | Read-only banner for env-sourced instances | "Configured from environment variables. Modify env vars and restart to change." |
| Form fields       | Disabled for env-sourced core fields       | url, api_key, type are read-only                                                |
| Status indicator  | Colored dot + text                         | Green=Connected, Red=Unreachable, Gray=Unknown                                  |
| Test button       | Available for all instances                | Manual "Test Connection" regardless of source                                   |

### Performance UX

- **Env var parsing**: Synchronous, < 10ms (pure string operations)
- **DB reconciliation**: Synchronous, wrapped in transaction
- **Connection testing**: Optional, async, non-blocking. Never delays startup.

## Recommendations

### Implementation Approach

**Recommended Strategy**: App-prefixed env vars only, reconciled into DB on every startup with `source` column for provenance tracking.

**Phasing:**

1. **Phase 1 - Core Provisioning** (MVP): Parser module, DB migration, reconciliation logic, startup integration, unit tests
2. **Phase 2 - Connection Validation**: Optional startup connection testing via `PRAXRR_VALIDATE_INSTANCES`
3. **Phase 3 - UI Integration**: `ENV` badge on instances list, read-only form for env-sourced instances

### Technology Decisions

| Decision           | Recommendation      | Rationale                                                                |
| ------------------ | ------------------- | ------------------------------------------------------------------------ |
| Naming pattern     | App-prefixed only   | Aligns with Cross-Arr Semantic Validation Policy; type is unambiguous    |
| Run frequency      | Every startup       | Env vars may change between restarts; matches Docker expectations        |
| Match key          | `api_key`           | Globally unique per Arr install; stable across URL/name changes          |
| Orphan handling    | Disable, not delete | Preserves FK relationships; safely reversible                            |
| Connection testing | Off by default      | Arr instances may not be ready at startup (Docker Compose ordering)      |
| Generic pattern    | Not supported       | Adds fragile meta-variable coupling; doubles parsing surface for no gain |

### Quick Wins

- Reuse existing `arrInstancesQueries.create()` with minimal extension (add `source` param)
- Reuse existing `createArrClient` factory for connection testing
- Follow the default-DB auto-link pattern in `hooks.server.ts` for startup integration shape

### Future Enhancements

- `_FILE` suffix support for Docker Secrets (`RADARR_INSTANCE_API_KEY_FILE_1=/run/secrets/radarr_key`)
- Config file alternative (`praxrr-instances.yml`) feeding the same reconciliation pipeline
- Health check API endpoint (`GET /api/v1/instances/health`)
- Auto-discovery of local Arr instances via network scanning

## Risk Assessment

### Technical Risks

| Risk                              | Likelihood | Impact | Mitigation                                                  |
| --------------------------------- | ---------- | ------ | ----------------------------------------------------------- |
| Startup cascade failure           | Medium     | High   | Non-blocking design; connection testing off by default      |
| Data integrity (env vs UI)        | Medium     | Medium | `source` column + `api_key` matching + skip-on-conflict     |
| Orphaned instances on env removal | Medium     | Low    | Disable (not delete); preserve sync config                  |
| API key rotation breaks matching  | Low        | Medium | Document as known limitation; user must delete old instance |
| Dev mode HMR re-runs              | Low        | Low    | Upsert logic is idempotent; compare before update           |

### Security Considerations

- **API keys in env vars**: Standard practice for containerized deployments. Keys already stored in plaintext in SQLite DB.
- **Logging**: Never log API key values. Log only masked versions or omit entirely.
- **Docker Secrets**: `_FILE` suffix support deferred to Phase 2+.

## Task Breakdown Preview

### Phase 1: Core Provisioning

**Focus**: Env var parsing, DB schema, reconciliation, startup integration

**Tasks**:

- A1: Define `ParsedEnvInstance` and result types
- A2: Implement env var scanner (regex matching on `Deno.env.toObject()`)
- A3: Validate parsed groups (required fields, type validation, name auto-generation)
- A4: Unit tests for parser edge cases
- B1: Create migration adding `source` column to `arr_instances`
- B2: Update `ArrInstance` interface, `create()` input, add `getBySource()` query
- C1: Implement `reconcileEnvInstances()` with upsert/disable logic
- C2: Transaction wrapping and per-instance error handling
- C3: Integration tests with in-memory SQLite
- D1: Import and call in `hooks.server.ts`, log reconciliation summary
- D2: Apply default delay profiles to new Radarr/Sonarr instances

**Parallelization**: Groups A and B are fully independent. C depends on both. D depends on C.

### Phase 2: Connection Validation

**Focus**: Optional startup health checking
**Dependencies**: Phase 1 complete

**Tasks**:

- E1: Add `PRAXRR_VALIDATE_INSTANCES` env var to config
- E2: Implement optional `testConnection()` call during reconciliation
- E3: Log connection results with version info

### Phase 3: UI Integration

**Focus**: Visual distinction for env-sourced instances
**Dependencies**: Phase 1 migration (B1-B2)

**Tasks**:

- F1: Show `source` badge on instances list page
- F2: Read-only banner and disabled fields for env-sourced instances
- F3: Allow editing of non-env fields (sync config, tags override)

```text
Dependency Graph:
  A (parser) ----\
                  --> C (reconciliation) --> D (startup) --> E (validation)
  B (migration) -/                                       \
                                                          --> F (UI)
```

## Decisions Needed

1. **Generic pattern support**
   - Options: (A) App-prefixed only, (B) Support both patterns
   - Impact: Supporting both doubles parsing surface and documentation
   - Recommendation: **App-prefixed only** -- aligns with codebase conventions and Cross-Arr Semantic Validation Policy

2. **Orphan cleanup strategy**
   - Options: (A) Disable orphaned env instances, (B) Delete orphaned env instances, (C) Leave orphaned instances unchanged
   - Impact: Deletion cascades through sync tables; leaving unchanged means stale config
   - Recommendation: **Disable** -- safe middle ground; preserves sync config while signaling removal

3. **UI editability of env instances**
   - Options: (A) Fully read-only, (B) Read-only core fields (url/apikey/type) but editable non-env fields
   - Impact: Fully read-only is simpler; partial edit allows UI-based sync config
   - Recommendation: **Option B** -- env controls connection params, UI controls sync/upgrade config

4. **Index numbering**
   - Options: (A) 1-based only, (B) Support both 0 and 1-based
   - Impact: 0-based matches Notifiarr/Unpackerr; 1-based is more intuitive
   - Recommendation: **1-based** -- more intuitive for self-hosting audience; document clearly

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Arr API documentation, ecosystem tool patterns, code examples
- [research-business.md](./research-business.md): User stories, business rules, existing codebase analysis
- [research-technical.md](./research-technical.md): Architecture design, data models, startup sequence, edge cases
- [research-ux.md](./research-ux.md): Competitive analysis (Notifiarr, Unpackerr, Recyclarr, Grafana), UI patterns
- [research-recommendations.md](./research-recommendations.md): Implementation strategy, risk assessment, task breakdown
