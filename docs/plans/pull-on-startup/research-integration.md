# Integration Research: pull-on-startup

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/health`: Runtime health including uptime, DB, repos, jobs, and logs.
- `POST /api/v1/sync/preview`: Generates Arr sync preview by `instanceId` and `arr_type`.
- `GET /api/v1/sync/preview/{previewId}`: Retrieves preview status and details.
- `POST /api/v1/sync/preview/{previewId}/apply`: Applies eligible preview sections with guardrails.
- `GET /api/v1/arr/library`: Arr library view with explicit `radarr|sonarr|lidarr` branching.
- `GET /api/v1/arr/releases`: Arr interactive release search by `arr_type`.
- Legacy but relevant operational routes:
  - `GET /api/databases`
  - `GET /api/databases/{id}/changes`
  - `GET /api/databases/{id}/commits`

### Route Organization

- Contract-first APIs are under `/packages/praxrr-app/src/routes/api/v1/**` and defined in `/docs/api/v1/openapi.yaml`.
- Some operational endpoints still exist under legacy `/packages/praxrr-app/src/routes/api/**`.
- Sync configuration persistence is currently driven by route actions in `/packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`.

## Database

### Relevant Tables

- `arr_instances`: Arr instance registry (`type`, `url`, `enabled`, source metadata).
- `arr_instance_credentials`: Encrypted API key per Arr instance.
- `database_instances`: Linked PCD repositories and sync strategy metadata.
- `setup_state`: Singleton startup/setup state (default DB link tracking).
- `arr_sync_quality_profiles` and `arr_sync_quality_profiles_config`: quality profile selections and sync state.
- `arr_sync_delay_profiles_config`: delay profile mapping and sync state.
- `arr_sync_media_management`: naming/media settings/quality definitions mapping and sync state.
- `arr_sync_metadata_profiles_config`: Lidarr metadata profile mapping and sync state.
- `arr_database_namespaces`: namespace registry for Arr/database links.
- `job_queue`: queued background jobs with dedupe keys and scheduling fields.
- `job_run_history`: persisted run results/outcomes for jobs.

### Schema Details

- Arr sync config tables reference `arr_instances`; selection tables reference both `arr_instances` and `database_instances`.
- Credential tables are 1:1 with parent instances and use foreign keys.
- Sync status lifecycle (`idle`, `pending`, `in_progress`, `failed`) already supports recovery flows.
- Lidarr metadata profile sync is explicitly gated by instance type in query logic and routes.
- No active runtime table currently persists startup pull runs for this feature.

## External Services

- Arr APIs via typed clients:
  - Radarr/Sonarr use `/api/v3/*`
  - Lidarr uses `/api/v1/*`
- PCD repositories are integrated through git operations in the PCD manager pipeline.
- Parser service exists for release parsing but is secondary to startup pull configuration reconstruction.

## Internal Services

- Startup orchestration: `/packages/praxrr-app/src/hooks.server.ts`.
- PCD lifecycle and on-pull sync trigger: `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`.
- Sync trigger fanout and section queueing: `/packages/praxrr-app/src/lib/server/sync/processor.ts`.
- Queue execution and history persistence: `/packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`.
- Arr client creation with encrypted credentials: `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`.
- Arr sync persistence API: `/packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`.

## Configuration

- Existing startup-related env controls are parsed in `/packages/praxrr-app/src/lib/server/utils/config/config.ts`.
- Default DB auto-link startup behavior uses `PRAXRR_DEFAULT_DB_URL` and related variables in `/packages/praxrr-app/src/hooks.server.ts`.
- `PULL_ON_START` is specified in planning docs but is not currently parsed by runtime config.
- Arr-type semantic rules must remain explicit; no sibling fallback for unsupported mappings.
