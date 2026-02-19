# Business Logic Research: initiate-apps

## Executive Summary

Praxrr currently requires all Arr instances (Radarr, Sonarr, Lidarr) to be configured manually through the web UI after deployment. The initiate-apps feature enables declarative instance provisioning via environment variables at startup, solving the automation gap for Docker-based and infrastructure-as-code deployments. This follows the same pattern already established by the default database auto-link feature (`PRAXRR_DEFAULT_DB_*` env vars in `hooks.server.ts`), extending it to Arr instance management.

## User Stories

### Primary User: Self-Hosted Media Server Operator

- As a self-hosted operator deploying via Docker Compose, I want to declare my Arr instances in my compose file so that Praxrr is fully provisioned on first startup without manual UI interaction.
- As an operator managing multiple environments (staging, production), I want to define instance configurations in environment variables so that I can replicate my setup across environments using infrastructure-as-code patterns.
- As a home lab user running Radarr, Sonarr, and Lidarr on the same Docker network, I want Praxrr to auto-connect to all my Arr instances at startup so that I can begin configuring sync profiles immediately.

### Secondary User: Platform Operator (Kubernetes / Fleet Deployment)

- As a platform operator managing Praxrr for multiple users, I want to pre-configure known Arr endpoints via environment variables so that end users do not need to know internal URLs and API keys.
- As a CI/CD pipeline operator, I want environment-variable-driven instance setup so that test environments can be spun up with pre-configured instances for automated end-to-end testing.

## Business Rules

### Core Rules

1. **Two Naming Patterns (mutually usable together)**:
   - **Type-prefixed pattern**: `{TYPE}_INSTANCE_URL_{N}`, `{TYPE}_INSTANCE_API_KEY_{N}`, `{TYPE}_INSTANCE_NAME_{N}` where `{TYPE}` is `RADARR`, `SONARR`, or `LIDARR` and `{N}` is a positive integer index (1, 2, 3...).
   - **Generic pattern**: `INSTANCE_TYPE_{N}`, `INSTANCE_URL_{N}`, `INSTANCE_API_KEY_{N}`, `INSTANCE_NAME_{N}` where `INSTANCE_TYPE_{N}` specifies the arr type.
   - Both patterns may coexist. Each index is independent.

2. **Required Fields Per Instance**: URL and API key are mandatory. Missing either for a given index makes that index invalid and it should be skipped with a warning log.

3. **Instance Type Validation**: The type value must be one of the valid `ArrAppType` values: `radarr`, `sonarr`, or `lidarr` (case-insensitive). Invalid types should be rejected with an error log for that index.

4. **Name Auto-Generation**: If no name is provided (`*_INSTANCE_NAME_{N}`), generate a default name using the pattern `{Type} {N}` (e.g., "Radarr 1", "Sonarr 2"). The name must be unique within the existing instance set.

5. **Idempotent Startup**: Env-declared instances should only be created if they do not already exist. Matching should be done by API key (each Arr instance has a globally unique API key). If an instance with the same API key already exists, skip it silently (info log, no error).

6. **No Modification of Existing Instances**: Env-based provisioning is a create-only operation. It must never update or delete existing instances. If an env-declared instance conflicts on name but not API key, it is a conflict that should be logged as a warning and skipped.

7. **Connection Testing is Optional at Startup**: Unlike the UI flow (which tests connection before save), env-based instances should be created without mandatory connection testing. The Arr instance may not be ready at Praxrr startup time (container startup ordering). Connection health will be verified naturally during sync operations.

8. **Default Delay Profile Application**: Follow the same pattern as manual instance creation -- if `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` returns true and the type supports delay profiles (radarr, sonarr), attempt to apply the default delay profile. Failures should be logged but not block instance creation.

9. **Once-Per-Startup Guard**: Like the default database link, env-based instance provisioning should use a `setup_state` flag to ensure it runs only once (on first startup after deployment). Subsequent restarts should not re-process env vars. This prevents accidental re-creation if an operator manually deletes an instance and restarts.

10. **Enabled by Default**: Env-created instances should be created with `enabled = 1` unless an explicit `*_INSTANCE_ENABLED_{N}` env var is set to `false` or `0`.

### Validation Rules

1. **URL Validation**: URL must be a valid absolute HTTP or HTTPS URL. Use the existing `parseOptionalAbsoluteHttpUrl` pattern for consistency, but require (not optional) the main URL.
2. **API Key Validation**: Must be non-empty after trimming. No format validation beyond that (Arr API keys vary in format).
3. **Name Uniqueness**: Case-insensitive uniqueness per existing `arrInstancesQueries.nameExists()`. If the auto-generated or user-provided name collides, append a numeric suffix or skip with a warning.
4. **Index Parsing**: Only positive integers are valid indices. Skip any non-numeric or zero/negative index silently.

### Edge Cases

- **Sparse Indices**: Indices do not need to be sequential. `RADARR_INSTANCE_URL_1` and `RADARR_INSTANCE_URL_5` are both valid without indices 2-4.
- **Duplicate API Key Across Patterns**: If both `RADARR_INSTANCE_API_KEY_1` and `INSTANCE_API_KEY_2` resolve to the same API key, only the first one encountered should be created. The second should be skipped with an info log.
- **Partial Configuration**: An index with only a URL but no API key (or vice versa) should be skipped with a warning. Do not error on incomplete indices -- the operator may have leftover env vars.
- **Empty String Values**: `RADARR_INSTANCE_URL_1=""` should be treated the same as unset. Trim and skip blank values.
- **Name Collision with Existing DB Instance**: If `RADARR_INSTANCE_NAME_1=Movies` and an instance named "Movies" already exists with a different API key, log a warning and skip that env instance (do not overwrite, do not create a duplicate).
- **External URL Support**: Optionally support `*_INSTANCE_EXTERNAL_URL_{N}` for the browser-facing URL override (mirrors the `external_url` column added in migration 20260216).
- **Tags Support**: Optionally support `*_INSTANCE_TAGS_{N}` as a comma-separated list that gets stored as a JSON array.
- **Mixed Pattern Collision**: If both `RADARR_INSTANCE_URL_1` and `INSTANCE_URL_1` (with `INSTANCE_TYPE_1=RADARR`) exist, the type-prefixed pattern should take precedence (or whichever is processed first).

## Workflows

### Primary Workflow: Startup Instance Provisioning

1. **Startup sequence reaches post-migration, pre-jobs phase** (in `hooks.server.ts`, after `pcdManager.initialize()` and the default database link block, before `initializeJobs()`).
2. **Check setup_state flag** `instances_provisioned` (new column on `setup_state` table). If already set to `1`, skip all env parsing.
3. **Scan environment variables** for both naming patterns. Collect all valid indices.
4. **For each discovered index** (ordered by index number):
   a. Parse and validate required fields (url, api_key, type).
   b. Skip invalid indices with appropriate warning logs.
   c. Check if API key already exists in `arr_instances`. If so, skip (info log).
   d. Check if name already exists. If collision, generate alternative name or skip.
   e. Create the instance via `arrInstancesQueries.create()`.
   f. Optionally apply default delay profile (same logic as `arr/new/+page.server.ts`).
   g. Log success.
5. **Mark setup_state flag** `instances_provisioned = 1` regardless of individual successes/failures (same pattern as `markDefaultDatabaseLinked`).
6. **Log summary**: "Provisioned N of M env-declared instances" with details.
7. **Continue startup** to `initializeJobs()`.

### Error Recovery

- **Individual Instance Failure**: Log error, continue to next index. Never fail the entire startup.
- **Database Not Ready**: Not applicable -- this runs after `db.initialize()` and `runMigrations()`.
- **Env Var Parse Error**: Log warning, skip that index, continue.
- **Connection Test Failure**: Not applicable -- connection testing is deferred (not performed at provisioning time).

### Re-provisioning After Reset

- If the operator wants to re-trigger env provisioning, they must either:
  - Delete the database file (fresh start), or
  - Manually reset the `instances_provisioned` flag in `setup_state` (power user operation), or
  - Use a special env var like `PRAXRR_REPROVISION_INSTANCES=true` to force re-scan (stretch goal).

## Domain Model

### Key Entities

- **ArrInstance** (`arr_instances` table): The core entity being provisioned. Fields: `id`, `name`, `type`, `url`, `external_url`, `api_key`, `tags`, `enabled`, `created_at`, `updated_at`.
- **ArrType** (domain type): Enum of `radarr | sonarr | lidarr`. Defined in `$shared/pcd/types.ts` as `ArrAppType`. The `chaptarr` type exists in the client factory but is not a valid `ArrAppType` for provisioning.
- **SetupState** (`setup_state` table): Singleton record tracking one-time setup operations. Will need a new `instances_provisioned` column.
- **GeneralSettings** (`general_settings` table): Controls whether default delay profiles are applied to new instances.

### State Transitions

- **Unprovisioned** (setup_state.instances_provisioned = 0) --> **Provisioned** (= 1): Triggered once during first startup with env vars present.
- Per-instance: **Not exists** --> **Created (enabled)**: Standard creation via `arrInstancesQueries.create()`.
- Per-instance: **Already exists** (same API key) --> **Skipped**: No state change, info log only.

### Entity Relationships (Post-Creation)

Once created, env-provisioned instances participate in the same entity graph as UI-created instances:

- `arr_instances` 1:N `arr_sync_quality_profiles` (sync config)
- `arr_instances` 1:1 `arr_sync_quality_profiles_config` (sync trigger)
- `arr_instances` 1:1 `arr_sync_delay_profiles_config` (delay sync)
- `arr_instances` 1:1 `arr_sync_media_management` (media management sync)
- `arr_instances` 1:1 `arr_sync_metadata_profiles_config` (lidarr only)
- `arr_instances` 1:1 `upgrade_configs` (upgrade automation)
- `arr_instances` 1:1 `arr_rename_settings` (rename automation)
- `arr_instances` 1:N `upgrade_runs` (run history)
- `arr_instances` 1:N `rename_runs` (run history)
- `arr_instances` N:N `arr_database_namespaces` (namespace index)

Note: None of these related records are created at provisioning time. They are created lazily when the user configures sync, upgrades, or rename through the UI. This matches the behavior of manually created instances.

## Existing Codebase Integration

### Related Features

- `/packages/praxrr-app/src/hooks.server.ts` (lines 37-91): **Default database auto-link** -- the closest existing pattern. Reads `PRAXRR_DEFAULT_DB_*` env vars, checks `setup_state`, creates the database link once. The initiate-apps feature should follow this exact architectural pattern.
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: **Config singleton** -- reads env vars in constructor. Not suitable for instance provisioning (config is static, instances require DB access). However, the env-reading patterns (trim, fallback, type coercion) should be consistent.
- `/packages/praxrr-app/src/routes/arr/new/+page.server.ts`: **Manual instance creation** -- the canonical creation flow with validation, duplicate checks, and default delay profile application. The env provisioning flow must replicate its business logic.

### Patterns to Follow

- **Setup state guard pattern** (`setupStateQueries.isDefaultDatabaseLinked()`): Use an analogous `isInstancesProvisioned()` check to prevent re-running.
- **Fire-and-forget error handling**: Like the default DB link, wrap each instance creation in try/catch, log errors, but never fail startup. Mark setup as complete regardless.
- **Logger source convention**: Use `source: 'Setup'` for consistency with the existing auto-link logs.
- **Env var reading pattern**: `Deno.env.get('KEY')?.trim() || undefined` for optional values, explicit empty-string check for opt-out behavior.

### Components to Leverage

- `arrInstancesQueries.create()` (`/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`): Instance creation with all field mapping.
- `arrInstancesQueries.nameExists()`: Name uniqueness check.
- `arrInstancesQueries.apiKeyExists()`: API key duplicate detection.
- `setupStateQueries` (`/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`): Extend with `isInstancesProvisioned()` and `markInstancesProvisioned()`.
- `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` (`/packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`): Delay profile application decision.
- `createArrClient()` (`/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`): For optional connection testing or delay profile application.
- `getDefaultDelayProfile()` (`/packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`): Default delay profile data.
- `parseOptionalAbsoluteHttpUrl()` (`/packages/praxrr-app/src/lib/server/utils/validation/url.ts`): URL validation utility.
- `ARR_APP_TYPES` (`/packages/praxrr-app/src/lib/shared/pcd/types.ts`): Valid arr type values for validation.

### Database Changes Required

- **New migration**: Add `instances_provisioned INTEGER NOT NULL DEFAULT 0` column to `setup_state` table.
- **Schema reference update**: Update `schema.sql` comment block for `setup_state`.
- **setupState queries**: Add `isInstancesProvisioned()` and `markInstancesProvisioned()` methods.

### Files to Create

- `/packages/praxrr-app/src/lib/server/utils/env/instanceProvisioning.ts` (or similar): Pure env-parsing logic, decoupled from DB for testability.
- New migration file in `/packages/praxrr-app/src/lib/server/db/migrations/`.

### Files to Modify

- `/packages/praxrr-app/src/hooks.server.ts`: Add the provisioning block in the startup sequence.
- `/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: Add new query methods.
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Update reference schema documentation.

## Success Criteria

- [ ] A Docker compose file with `RADARR_INSTANCE_URL_1`, `RADARR_INSTANCE_API_KEY_1` env vars creates a Radarr instance on first startup.
- [ ] The generic pattern (`INSTANCE_TYPE_1=SONARR`, `INSTANCE_URL_1`, `INSTANCE_API_KEY_1`) also works.
- [ ] Multiple instances across different types can be declared simultaneously.
- [ ] Restarting the container does not re-create or duplicate instances.
- [ ] Instances that already exist (by API key match) are silently skipped.
- [ ] Name collisions are handled gracefully (skip with warning, not crash).
- [ ] Missing required fields for an index produce a warning log but do not prevent other indices from being provisioned.
- [ ] Default delay profiles are applied when applicable (radarr/sonarr, setting enabled).
- [ ] Created instances are immediately visible in the Arr instances page and usable for sync configuration.
- [ ] All provisioning activity is logged with `source: 'Setup'` for easy filtering.

## Open Questions

1. **Should env-provisioned instances be marked differently?** A potential `source` column or `env_provisioned` flag on `arr_instances` could allow the UI to show which instances were auto-configured vs. manually added. This could also prevent accidental deletion of env-provisioned instances. However, this adds schema complexity -- defer unless requested.

2. **Should connection testing be optional or configurable?** The current recommendation is to skip connection testing at startup (the Arr may not be ready yet). Should there be an env var like `PRAXRR_INSTANCE_TEST_CONNECTION=true` to opt into startup connection validation?

3. **What about env-var-driven instance updates?** The current spec is create-only. Should a future iteration support updating existing instances from env vars (e.g., if the API key changed)? This has significant complexity around conflict resolution and should likely be a separate feature.

4. **Priority between type-prefixed and generic patterns for the same index**: If both `RADARR_INSTANCE_URL_1` and `INSTANCE_URL_1` are set, which wins? Recommendation: type-prefixed takes priority, with a warning log about the shadowed generic entry.

5. **Should the `instances_provisioned` flag be separate from actual instance creation?** The current design marks provisioned=1 even if no env vars were found (preventing future re-scans). Alternative: only mark provisioned=1 if at least one env var was found. The default-database-link pattern marks completed regardless -- this is the safer approach.

## Relevant Files

- `/packages/praxrr-app/src/hooks.server.ts`: Startup sequence where provisioning will be inserted
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Existing env var reading patterns
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD queries
- `/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: One-time setup state tracking
- `/packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`: Delay profile application settings
- `/packages/praxrr-app/src/lib/server/db/schema.sql`: Reference schema documentation
- `/packages/praxrr-app/src/lib/server/db/migrations/039_create_setup_state.ts`: Setup state table creation
- `/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Arr client factory
- `/packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: Default delay profile values
- `/packages/praxrr-app/src/lib/server/utils/validation/url.ts`: URL validation utility
- `/packages/praxrr-app/src/lib/shared/pcd/types.ts`: ArrAppType/ArrType definitions
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Arr app capabilities registry
- `/packages/praxrr-app/src/routes/arr/new/+page.server.ts`: Manual instance creation flow (reference implementation)
- `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: Instance update flow (reference for validation)
- `/packages/praxrr-app/src/routes/arr/test/+server.ts`: Connection testing endpoint
- `/packages/praxrr-app/src/lib/server/jobs/cleanup.ts`: Job cleanup on instance deletion

## Environment Variable Reference

### Type-Prefixed Pattern

```
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
RADARR_INSTANCE_NAME_1=Movies 4K
RADARR_INSTANCE_EXTERNAL_URL_1=https://radarr.example.com
RADARR_INSTANCE_TAGS_1=movies,4k
RADARR_INSTANCE_ENABLED_1=true

SONARR_INSTANCE_URL_1=http://sonarr:8989
SONARR_INSTANCE_API_KEY_1=def456
SONARR_INSTANCE_NAME_1=TV Shows

LIDARR_INSTANCE_URL_1=http://lidarr:8686
LIDARR_INSTANCE_API_KEY_1=ghi789
```

### Generic Pattern

```
INSTANCE_TYPE_1=RADARR
INSTANCE_URL_1=http://radarr:7878
INSTANCE_API_KEY_1=abc123
INSTANCE_NAME_1=Movies 4K

INSTANCE_TYPE_2=SONARR
INSTANCE_URL_2=http://sonarr:8989
INSTANCE_API_KEY_2=def456
```

### Docker Compose Example

```yaml
services:
  praxrr:
    image: ghcr.io/yandy-r/praxrr:v2
    environment:
      - RADARR_INSTANCE_URL_1=http://radarr:7878
      - RADARR_INSTANCE_API_KEY_1=${RADARR_API_KEY}
      - RADARR_INSTANCE_NAME_1=Movies
      - SONARR_INSTANCE_URL_1=http://sonarr:8989
      - SONARR_INSTANCE_API_KEY_1=${SONARR_API_KEY}
      - SONARR_INSTANCE_NAME_1=TV Shows
      - LIDARR_INSTANCE_URL_1=http://lidarr:8686
      - LIDARR_INSTANCE_API_KEY_1=${LIDARR_API_KEY}
```
