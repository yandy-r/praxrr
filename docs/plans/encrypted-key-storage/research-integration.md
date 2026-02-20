# Integration Research: encrypted-key-storage

## API Endpoints

### Existing Related Endpoints

- `POST /arr/new`: SvelteKit form action in `routes/arr/new/+page.server.ts` validates `name`, `type`, `url`, and `api_key`, checks duplicates via `arrInstancesQueries`, and persists rows into `arr_instances`. Encryption must happen before insert so `arr_instances.api_key` never stores plaintext.
- `POST /arr/[id]/settings`: Update/delete actions in `routes/arr/[id]/settings/+page.server.ts` run duplicate-name/API-key guards and currently write raw `api_key`. The encrypted-key feature must route this value through a credential helper and store ciphertext plus fingerprint.
- `POST /arr/test`: `routes/arr/test/+server.ts` accepts `{ type, url, apiKey }`, validates type, runs a 3s connection test with retries disabled, and returns result. It does not persist the key.
- `GET /arr/[id]/logs`: `routes/arr/[id]/logs/+page.server.ts` loads the instance and calls `createArrClient(instance.type, instance.url, instance.api_key)` to fetch logs. This call site needs just-in-time decrypt before client creation.
- `POST /api/v1/arr/cleanup`: `routes/api/v1/arr/cleanup/+server.ts` loads `instanceId`, creates a client from stored key, and runs `scan` or `execute` stale-item cleanup.
- `GET /api/v1/arr/library`: `routes/api/v1/arr/library/+server.ts` loads enabled Arr instances, enriches with PCD metadata, caches for five minutes, and calls Arr clients with each instance key.
- `GET /api/v1/arr/library/episodes`: `routes/api/v1/arr/library/episodes/+server.ts` fetches Sonarr episode data and caches results.
- `GET /api/v1/arr/releases`: `routes/api/v1/arr/releases/+server.ts` loads an instance, creates the type-specific client, and performs release search.

### Route Organization

SvelteKit routes under `packages/praxrr-app/src/routes/arr/` drive Arr UI flows: `+page` list, `arr/new`, `arr/[id]/settings`, `arr/[id]/logs`, `arr/[id]/library`, plus nested `rename`, `sync`, and `upgrades`. JSON APIs are under `src/routes/api/v1/arr/` and reuse the same `arrInstancesQueries` + `createArrClient` pipeline.

`hooks.server.ts` initializes config, DB migrations, default PCD database linkage, env instance reconciliation (`reconcileEnvInstances()`), and job initialization. Auth middleware in `$auth/middleware.ts` controls public paths and API-key/session access.

## Database

### Relevant Tables

- `arr_instances`: Core Arr instance table with `name`, `type`, `url`, `external_url`, `api_key` (currently plaintext), `tags`, `enabled`, and `source`.
- `upgrade_configs`: One-to-one with `arr_instances` by `arr_instance_id`, cascades on delete.
- `arr_sync_quality_profiles` and other `arr_sync_*` config tables: Reference `arr_instances(id)` with `ON DELETE CASCADE`; store sync schedules/state.
- `jobs`, `job_queue`, `job_runs`, `job_run_history`: Queue and execution data for Arr jobs that consume Arr credentials at runtime.
- `arr_instance_credentials` (proposed): `instance_id` PK/FK, `ciphertext`, `nonce`, `key_version`, `fingerprint`, timestamps; used for encrypted API key storage and lookup.
- `database_instances` and `pcd` tables: Indirectly relevant through sync and metadata enrichment.

### Schema Details

`arr_instances` is the central relation for sync configs, jobs, cleanup, and library/release endpoints. Existing queries in `arrInstancesQueries` (`getById`, `getByApiKey`, `apiKeyExists`, `updateEnvInstanceByApiKey`) compare plaintext `api_key`; cutover needs fingerprint-based comparisons and decrypt-on-read helpers.

Planned migration pattern:

1. Add `arr_instance_credentials` and `api_key_fingerprint`.
2. Backfill existing `arr_instances.api_key` into encrypted records using active master key.
3. Switch queries to fingerprint lookups.
4. Drop plaintext column after rollout hardening.

Master key versioning should be tracked in credential rows and loaded from runtime config.

## External Services

- Arr APIs (Radarr, Sonarr, Lidarr, Chaptarr): Accessed via `createArrClient(type, url, apiKey)` in `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`.
- Deno Web Crypto: Recommended for AES-GCM encryption and HMAC fingerprinting.
- `dotenvx` + `.env.encrypted`: Existing encrypted environment loading path used by local runtime.
- Optional external secret providers (from existing research): Vault/OpenBao, Infisical, 1Password Connect.
- Docker Secrets / SQLCipher: Deployment key source option and deferred full-DB encryption option.

## Internal Services

- `arrInstancesQueries` (`packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`): central CRUD and lookup service for Arr instances.
- Env reconciliation (`packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`): parses env vars, validates instances, and reconciles persisted rows.
- Arr client factory and clients (`packages/praxrr-app/src/lib/server/utils/arr/factory.ts`, `clients/*.ts`): all runtime Arr communication passes through here.
- Job queue/handlers (`packages/praxrr-app/src/lib/server/jobs/`): `arr.sync`, `arr.rename`, `arr.upgrades` handlers load instances and call Arr APIs.
- Startup lifecycle (`packages/praxrr-app/src/hooks.server.ts`): ensures DB init/migrations, env reconciliation, and job startup sequence.
- Cache/logger/PCD services: support library endpoints, telemetry, and metadata linkage.

## Configuration

- Environment instance variables: `RADARR_INSTANCE_*`, `SONARR_INSTANCE_*`, `LIDARR_INSTANCE_*` patterns consumed by env reconciliation.
- Planned encryption config: `ARR_CREDENTIAL_MASTER_KEY`, optional `ARR_CREDENTIAL_MASTER_KEYS`, and `ARR_CREDENTIAL_MASTER_KEY_VERSION`.
- Existing encrypted env path: `.envrc` + `.env.encrypted` via `dotenvx`.
- Auth/job runtime config remains separate, but encrypted-key paths must avoid key exposure in logs and responses.
