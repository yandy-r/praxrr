# Architecture Research: pcd-data-migration-2

## System Overview

The monorepo uses Deno 2.x + SvelteKit, with server-side PCD orchestration and API routes under
`packages/praxrr-app/src/lib/server` and `packages/praxrr-app/src/routes/api/v1/*`. PCD data flows
through `pcdManager` and `PCDCache` (link/pull/import/compile) and uses the portable entity pipeline
(`serialize.ts`, `reader.ts`, `deserialize.ts`) for import/export and migration. For phase 2,
converter/parity tooling plugs into this existing pipeline as offline scripts that produce
`entities/*` files compatible with the hybrid ingestion path.

## Relevant Components

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: orchestrates database link/pull, base op
  import, cache compilation, and sync triggers.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: builds in-memory SQLite cache and
  executes schema/base/tweak/user ops.
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: wraps compile lifecycle and
  registry swaps for active cache.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: entity serializers used by export
  and migration conversion.
- `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: portable-to-SQL deserializers
  used by import paths.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: reads `entities/` YAML/JSON files,
  resolves entity type by path, validates payloads.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: hybrid SQL + migration ingestion
  with stable-identity conflict checks.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: existing export endpoint mapping
  compiled entities to portable payloads.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: validates and imports portable
  payloads via deserializers.
- `packages/praxrr-db/ops/0.rosettarr.sql`: primary SQL seed target for conversion.
- `packages/praxrr-schema/ops/`: schema/seed layer consumed before base ops.
- `docs/plans/pcd-data-migration-2/research-technical.md`: implementation blueprint for
  converter/parity design.

## Data Flow

`packages/praxrr-schema/ops/*.sql` and `packages/praxrr-db/ops/*.sql` are loaded into an in-memory
cache through `cache.ts` and `compiler.ts`. The conversion tool should compile this same source
state, enumerate entities by type/name, serialize each entity through `serialize.ts`, and write YAML
files to `entities/<dir>/<slug>.yaml`. Those files are then read by `reader.ts`, validated, and
deserialized through existing entity create paths. Parity verification compares SQL-derived cache
state against migration-file-derived cache state table by table.

## Integration Points

New phase-2 code should be added in `packages/praxrr-app/src/lib/server/pcd/migration/` for
converter/parity helpers and under `scripts/` for CLI entry points. It should reuse `PCDCache`
build/compile utilities, entity serializers/deserializers, and migration reader validation. The
resulting files must strictly follow the reader directory mappings so runtime hybrid import and API
import/export continue to interoperate without schema drift.

## Key Dependencies

- Deno 2.x runtime
- SvelteKit server runtime
- SQLite via `@jsr/db__sqlite`
- Kysely + `@soapbox/kysely-deno-sqlite`
- `yaml` package for parse/stringify in migration paths
- Internal PCD modules: `core`, `database`, `entities`, `ops`, `migration`, `sync`, and `jobs`
