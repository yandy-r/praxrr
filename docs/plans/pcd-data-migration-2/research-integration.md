# Integration Research: pcd-data-migration-2

## API Endpoints

### Existing Related Endpoints

- `GET /api/v1/pcd/export`: exports portable entity payloads by database, entity type, and name
  (`packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`).
- `POST /api/v1/pcd/import`: validates and imports portable payloads into base/user layers
  (`packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`).
- `GET/POST /api/v1/pcd/[databaseId]/lidarr-metadata-profiles`: reads/writes metadata profile
  entities and validates schema availability.

### Route Organization

API v1 routes are filesystem-organized under `packages/praxrr-app/src/routes/api/v1/*`. Startup and
request middleware is centralized in `packages/praxrr-app/src/hooks.server.ts`, where
config/db/PCD/job initialization and auth gating are applied before route handlers execute.

## Database

### Relevant Tables

- `database_instances`: linked PCD repositories and sync policy.
- `pcd_ops`: SQL operations with metadata/content hash/layer/source fields.
- `pcd_op_history`: compile/apply history and conflict details.
- `arr_instances`, `arr_instance_credentials`: Arr instance config and encrypted credentials.
- `arr_sync_*`: sync configuration and trigger state.
- `tmdb_settings`: singleton TMDB API key row.
- PCD entity tables from schema: `tags`, `regular_expressions`, `custom_formats`,
  `quality_profiles`, `delay_profiles`, naming/media settings tables, quality definition tables, and
  Lidarr metadata profile tables.

### Schema Details

- Entity relationship-heavy tables (`custom_format_conditions`, `quality_profile_*`,
  `quality_group_members`, metadata profile child tables) use FKs and cascades and are key parity
  comparison surfaces.
- `quality_api_mappings` is keyed by `(quality_name, arr_type)` and seeded in schema layer.
- Most entity tables use name-based stable keys plus audit columns; parity compares should ignore
  autoincrement IDs and timestamp columns.

## External Services

- Git remotes for PCD repositories (`pcdManager.link/pull` and git utils).
- Arr instances (Radarr/Sonarr/Lidarr/Chaptarr) via typed Arr clients and encrypted API keys.
- Optional parser microservice (`praxrr-parser`) for release parsing.
- TMDB API through `TMDBClient` using `tmdb_settings` key.

## Internal Services

- `pcdManager`, cache/compiler, and op importers for lifecycle and compile orchestration.
- Migration reader + entity deserializers for portable file ingestion.
- Job queue and sync processor for downstream Arr synchronization.
- Query modules in `src/lib/server/db/queries/*` as data access layer.

## Configuration

- PCD migration behavior: `PRAXRR_PCD_MIGRATION_MODE`, `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK`.
- Default DB auto-linking: `PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`,
  `PRAXRR_DEFAULT_DB_NAME`, optional token/git identity vars.
- Encryption for Arr credentials: `ARR_CREDENTIAL_MASTER_KEY` and version settings.
- Parser host/port and app auth/network boot settings in `config.ts`.
