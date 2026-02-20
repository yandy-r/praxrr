# Architecture Research: encrypted-key-storage

## System Overview

The Praxrr runtime is a Deno 2.x/SvelteKit monolith where the server (`packages/praxrr-app/src/lib/server`) owns SQLite-backed state (`praxrr.db` via `DatabaseManager`) and the UI is powered by Svelte 5/Tailwind routes under `packages/praxrr-app/src/routes`. All configuration, including the `arr_instances` table that currently stores Radarr/Sonarr/Lidarr API keys in plaintext, is processed through the server's DB/query layer, job queue (`jobs/`), and sync pipeline (`lib/server/sync`). Encrypted-key-storage would live inside this server layer, intersecting the UI entry points, environment reconciliation helpers, and the consumers that instantiate Arr clients.

## Relevant Components

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: CRUD + helpers for the `arr_instances` table; enforces unique API keys, tracks `source` (`ui` vs `env`), and is the single gate to read/write the stored key material.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts` and `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: SvelteKit form actions that validate user input and call `arrInstancesQueries.create`/`update`, so they are the first place where raw API keys enter the system.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: Reconciler for env vars (for example `RADARR_INSTANCE_API_KEY_<N>`) that parses, validates, tests, and persists API keys with `source='env'`, so it must feed encrypted values when the env key is stored.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` (plus the sync registry under `lib/server/sync/`): Job handlers fetch the stored instance, create an Arr client, and stream sync sections (quality/delay/media/metadata) using the plaintext API key today.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts` (and the client implementations `clients/*.ts`): Central factory that injects the API key into HTTP clients; consumers include sync jobs, `routes/arr/logs`, `routes/arr/test`, `routes/api/v1/arr/cleanup`, and rename/upgrade workflows, so any encryption must decrypt before these factories run.

## Data Flow

User-managed credentials flow from the Svelte UI (`routes/arr/new`, `routes/arr/[id]/settings`, `routes/arr/+page.server.ts`) into `arrInstancesQueries`, which writes them to the SQLite `arr_instances` table via the `db` singleton (`packages/praxrr-app/src/lib/server/db/db.ts`). Environment-managed credentials go through `envInstances.ts`, get validated via `createArrClient`, and upsert into the same table with `source='env'`. In all cases the API key is read back by jobs and sync logic: `arrSyncHandler` (and other job handlers) select enabled rows, instantiate Arr clients (`arr/factory.ts`), and feed metadata/quality/delay syncers, while helper routes like `arr/[id]/logs` and `routes/api/v1/arr/cleanup` also read the same column to talk to upstream Arr services. Business logic and validation are concentrated in the server layer (`lib/server/db`, `jobs`, `sync`, and `utils`), so encrypted-key-storage must integrate there before job or route consumers execute.

## Integration Points

- Encrypt/decrypt logic should wrap `arrInstancesQueries.create`/`update`/`get*` so every write stores ciphertext and every read exposes plaintext only to trusted callers; the table schema (currently `api_key TEXT NOT NULL`) may need a dedicated credential table or IV/nonce columns.
- Inject key derivation/config via `packages/praxrr-app/src/lib/server/utils/config/config.ts` (or a new config helper) so master encryption material can be sourced from env vars or files before `arrInstancesQueries` runs.
- The UI entry points (`routes/arr/new`, `arr/[id]/settings`, plus `routes/arr/+page.server.ts` delete action) and the env reconciler (`lib/server/utils/arr/envInstances.ts`) are the producers of API keys; they should encrypt before calling the query layer or pass through a helper that does so.
- Consumers that instantiate Arr clients (`jobs/handlers/arrSync.ts`, `lib/server/sync/processor.ts`, `routes/arr/logs`, `routes/arr/test`, `routes/api/v1/arr/cleanup`, rename/upgrade processors, and others) must read decrypted keys just before calling `createArrClient`, which could be centralized so raw key material is never exposed to unrelated code.

## Key Dependencies

- Deno 2.x runtime with `SvelteKit` for routes; all server logic is TypeScript under `packages/praxrr-app/src/lib/server`.
- SQLite via `@jsr/db__sqlite` powering `packages/praxrr-app/src/lib/server/db/db.ts` (the singleton `DatabaseManager` used by every query module).
- Internal job queue modules (`packages/praxrr-app/src/lib/server/jobs/*`, `jobQueueRegistry`, `arrSyncQueries`) and the `sync` subsystem (`lib/server/sync/`) that coordinate scheduled/interactive Arr syncs.
- Arr client utils (`packages/praxrr-app/src/lib/server/utils/arr/factory.ts` plus `clients/{radarr,sonarr,lidarr,chaptarr}.ts`) that issue HTTP requests with the API key.
- Optional parser microservice (`packages/praxrr-parser/`) and UI helpers (Tailwind-based components) consume the same `arr_instances` data but do not touch key storage directly.
