# Architecture Research: pcd-data-migration

## System Overview

Praxrr is a Deno 2.x + SvelteKit (Svelte 5) monorepo with an SQLite-backed runtime, in-memory
caches, and a C# parser microservice, as summarized in `CLAUDE.md:11`‑`CLAUDE.md:15`. The PCD layer
is append-only SQL ops replayed into an in-memory SQLite cache with value guards, so every
create/delete flows through the same compile/validation path before it can reach Arr targets
(`CLAUDE.md:138`). The latest research specifically recommends a hybrid JSON/YAML ↔ SQL migration
that keeps the existing compile/runtime pipeline intact while using portable JSON for authoring and
export, with the value-guard prototype (phase 3) serving as the go/no-go gate
(`research/data-schema/report.md:13`‑`research/data-schema/report.md:70`).

## Relevant Components

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`: `PCDManager` wires Git ops,
  manifest/dependency validation, base-op import/seed, compile/invalidate, and sync-trigger
  orchestration, so any migration must hook into this coordinator for link/sync flows.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:1`: Reads repo `ops/*.sql`, extracts
  metadata/hash, and upserts rows into `pcd_ops`; this is the current ingestion point for canonical
  SQL seeds.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:5`: `PCDCache` brings together
  `@jsr/db__sqlite`, `Kysely`, and `DenoSqlite3Dialect` to execute schema/base/tweak/user layers,
  drive conflict detection/value guards, record history, and expose a compiled view for
  exports/rollbacks.
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:1`: All user changes are written to
  `pcd_ops` with rich metadata/desire-state serialization and hashed content, then recompiled by the
  cache so that migrations always run through the same validation and auto-resolution pipeline.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:1`: The HTTP import endpoint
  validates portable JSON (using `$shared/pcd/portable.ts`) and dispatches to `deserialize` helpers
  tied to the various create flows, so JSON/YAML migrations can reuse the same entry point.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:1`: The export endpoint reuses the
  `serialize` helpers to read canonical entities from the cache, meaning migrations can capture
  existing state by calling the same exporter.
- `packages/praxrr-app/src/lib/shared/pcd/portable.ts:1`: Defines the portable entity schema (custom
  formats, quality profiles, naming rules, etc.) that both export/import and any new migration
  format must align with.

## Data Flow

Link/sync requests hit `PCDManager`, which clones/pulls the repo, validates the
manifest/dependencies, imports SQL ops via `importBaseOps`, seeds built-in ops, and calls `compile`
to rebuild the in-memory cache (`packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`).
Importing operations writes rows into `pcd_ops` through the writer helpers; `loadAllOperations` then
stitches schema ops (from dependencies), repo base ops, tweak files, and published user ops into a
single ordered list, which `PCDCache.build()` executes statement by statement while recording
history and enforcing value guards (`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:1`,
`packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:1`,
`packages/praxrr-app/src/lib/server/pcd/database/cache.ts:5`). Export/import APIs call
`serialize`/`deserialize` helpers that read/write portable JSON via the same cache-backed queries as
the UI create flows, so migration tooling can share the existing entity-level CRUD logic
(`packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:1`,
`packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:1`). The research mandate insists
this pipeline remain intact while the new format sits in front of it
(`research/data-schema/report.md:13`‑`research/data-schema/report.md:70`).

## Integration Points

Migration code should plug into the same channels that already enforce SQL/value-guard invariants:
extend `importBaseOps` (and/or a parallel loader) to ingest the hybrid JSON/YAML when a repo defines
it, reusing `compliedQueryToSql`/`pcdOps.runner` so the output lands in `pcd_ops`; hook `PCDManager`
so staging/deploy phases can seed or swap between SQL and JSON inputs without bypassing compilation
(`packages/praxrr-app/src/lib/server/pcd/core/manager.ts:1`,
`packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:1`,
`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:1`). Use the portable
serializers/deserializers exported to/from `routes/api/v1/pcd/export` and `import` to round-trip
entities, which ensures any JSON/YAML migration produces the same operations and metadata (including
desired-state/value-guard hints) the compiler already expects
(`packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:1`,
`packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:1`,
`packages/praxrr-app/src/lib/shared/pcd/portable.ts:1`). The migration feature should surface
through these endpoints so auditing, validation, and the downstream sync pipeline stay unchanged
while the new format is introduced as a frontend to the existing SQL-based runtime
(`research/data-schema/report.md:13`‑`research/data-schema/report.md:70`).

## Key Dependencies

- Deno 2.x runtime, SvelteKit + Svelte 5 frontend, SQLite via Kysely, and Tailwind v4 for the UI
  stack (`CLAUDE.md:11`, `CLAUDE.md:12`, `CLAUDE.md:13`, `CLAUDE.md:14`).
- Existing compiler dependencies (`@jsr/db__sqlite`, `Kysely`, `@soapbox/kysely-deno-sqlite`, logger
  modules) that power the in-memory cache and value-guard checks
  (`packages/praxrr-app/src/lib/server/pcd/database/cache.ts:5`).
- The portable schema/serializer/deserializer trio plus the import/export HTTP handlers already
  define how JSON payloads become SQL ops, so the migration feature must reuse them rather than
  building parallel runners (`packages/praxrr-app/src/lib/shared/pcd/portable.ts:1`,
  `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:1`,
  `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:1`,
  `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:1`,
  `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:1`).
