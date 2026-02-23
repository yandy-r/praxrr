# Documentation Research: pcd-data-migration

## Architecture Docs

- `/docs/ARCHITECTURE.md`: Maps the full PCD pipeline (ops storage, layered compile order, writer
  pipeline, cache build, value guards, op history, schema/manifest expectations) and explicitly
  calls out the built‑in migrations (e.g., Lidarr cutover in §12.4 and the
  `pcd_ops`/`pcd_op_history` tables) that any data migration must respect.
- `/docs/pcdReference/0.schema.sql`: The canonical PCD schema definition; every table referenced by
  migration SQL (tags, custom formats, quality profiles, Arr-specific media tables, etc.) is defined
  here, which is essential when generating YAML/JSON equivalents or verifying compiled caches.
- `/docs/pcdReference/1.initial.sql`: Shows the exact seed data (25K+ lines of tags, regexes, base
  CFs/QPs) that the migration tool serializes into `entities/`; it doubles as the regression target
  for migration verification and gives concrete examples of the ops you must recreate in a new
  format.

## API Docs

- `/docs/api/v1/openapi.yaml`: The root OpenAPI spec that includes the `/api/v1/pcd/export` and
  `/api/v1/pcd/import` paths plus all portable entity schemas; critical for wiring any migration
  that exposes data via HTTP or reuses the portable contract.
- `/docs/api/v1/paths/pcd.yaml`: Describes the export/import endpoints in detail (required
  query/body fields, layer restrictions, error responses, duplicate-name and cache availability
  handling) so you understand how portable payloads are validated during import/export flows in a
  migration scenario.
- `/docs/api/v1/schemas/pcd.yaml`: Enumerates the portable entity schemas, including the expanded
  `EntityType` enum with all `lidarr_*` contracts and the shape of every `Portable*` payload; this
  is the definitive reference for writing migration helpers that emit or consume portable JSON/YAML.

## Development Guides

- `/docs/features/portable-import-export.md`: Step-by-step workflow for exporting/importing portable
  entities (parameters, response shape, troubleshooting), which is the surface area you’ll augment
  or reuse when migrating PCD data between databases or promoting new entity formats.
- `/docs/plans/enhance-lidarr-support/migration-runbook.md`: Operator-level runbook for the Lidarr
  migration (pre-checks, automatic PCD base-op steps, validation, rollback), showing how run-once
  base ops and cache recomputes interact—use this as a template for documenting other data
  migrations.
- `/docs/plans/initiate-apps/research-patterns.md`: Documents the `Migration.afterUp` callback
  pattern, version ordering, and SQL/transaction handling for data migrations, plus the
  `PRAXRR_DEFAULT_DB_*` env-var conventions that migrations must respect when updating persisted
  `pcd.json` manifest references.
- `/docs/plans/initiate-apps/research-architecture.md`: Includes notes (e.g., `DEFAULT 'ui'` when
  adding a NOT NULL column) that explain how to change schema without a full data migration, which
  helps you scope when a migration is actually required.
- `/docs/plans/monorepo-strategy/feature-spec.md`: Defines the strategy for making the default PCD
  repo configurable, seeding manifests, and migrating stored dependency references—key context if
  your migration touches the default `/data/databases/*` clones or their remotes.
- `/docs/plans/monorepo-strategy/research-recommendations.md`: Highlights local schema resolution,
  manifest compatibility checks, and CI validation ideas (type regeneration, compile smoke tests)
  that should accompany any PCD data migration to keep schema and ops in sync.
- `/docs/todo/op-splitting-checklist.md`: Lists the desired op granularity per entity/field (custom
  formats, quality profiles, media management) so you know how fine-grained your migration-generated
  ops must be to avoid needless conflicts.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: In-code documentation of the migration
  runner, the optional `afterUp` data-callback, and how migrations are recorded only after both
  schema and data steps succeed—read this for the low-level lifecycle you’ll hook into for any new
  migration.

## README Files

- `/README.md`: Product overview, key features (link/bridge/sync), and the environment-variable
  table that calls out the default PCD link (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`)
  plus parser/auth settings—use this to explain launch/runtime expectations for the migration.
- `/docs/README.md`: Documentation map that points to architecture, API, and feature guides; helpful
  for steering teammates toward the precise docs once the migration scope is defined.
- `/docs/features/README.md`: Index of feature guides (Link/Bridge/Sync, Entity Testing, Portable
  Import/Export) showing the recommended sequence; reference this when introducing reviewers to the
  workflows the migration affects.

## Must-Read Documents

- `/research/data-schema/report.md` (Required): High-level recommendation for a phased hybrid
  migration (Option E → full-authoring hybrid) with five passes (JSON schema formalization, exchange
  format, value-guard prototype, YAML entity authoring, full operation YAML), plus the conviction
  that value guards are the gating issue—essential orientation before changing any PCD format.
- `/research/data-schema/synthesis/technical-design.md` (Required): Concrete migration path
  (serialize+write YAML, keep the 55 historical ops, verify bit-for-bit cache parity with
  `verifyMigration`, and optional CI automation) that tells you how to build the
  `scripts/migrate-to-yaml.ts` tool and validate it.
- `/research/data-schema/synthesis/decision-framework.md` (Required): Weighted scoring of Options
  A–E, showing why Option E leads (and how phased gates manage risk), which informs prioritization
  decisions when you implement pcd-data-migration.
- `/research/data-schema/synthesis/risk-assessment.md` (Required): Catalog of migration risks (scope
  underestimation, 57-op conversion, verification burden, backward compatibility, value-guard
  fidelity) plus mitigation suggestions (phase the work, keep SQL for hard cases, auto-doc from
  compiled cache); read this so you can argue for or against a given migration path.
- `/research/data-schema/synthesis/convergence-mapping.md` (Nice-to-have): Explains the seed-data
  vs. incremental-op distinction, the value-guard gate, and the Contrarian/Futurist tension—good for
  framing why a hybrid approach can be acceptable even if you can’t complete a full SQL-to-YAML
  rewrite immediately.

## Documentation Gaps

- No single “pcd-data-migration playbook” exists outside the research
  artifacts—`research/data-schema` describes the ideal phases, but there isn’t yet a formal guide
  that tells you how to run `scripts/migrate-to-yaml.ts`, generate the new `entities/` directory, or
  rebase the 55 historical ops inside the repo. Consider documenting the exact commands, required
  cache states, and verification steps once the migration tool stabilizes.
- There is no published guidance on how to extend the portable import/export flow (API, schema,
  feature guide) to participate in a data migration or TRaSH adapter; the feature-guide and OpenAPI
  docs describe current endpoints, but nothing explains how to bulk-import/export during a migration
  sweep or how to hook the import into migration orchestration.
- The docs mention the need for a data migration when manifest entries change (e.g.,
  `docs/plans/monorepo-strategy/research-recommendations.md`), but there isn’t a concrete migration
  checklist or template for updating `pcd.json` metadata or tracked dependency URLs in
  already-linked databases—adding one would prevent drift when default repo URLs/branches change.
