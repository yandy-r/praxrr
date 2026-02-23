# Pattern Research: pcd-data-migration

## Architectural Patterns

**PCD lifecycle orchestrator**: `PCDManager` owns link/sync/initialize/unlink workflows,
orchestrating Git operations, manifest checks, dependency validation, base-op imports, cache
compilation, job cleanup, and Arr sync triggers so every stage touches the right subsystem with
centralized logging/context.

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:5`

**Operation + repository service layer**: The `writeOperation` service validates SQL against the
in-memory cache, enforces base-layer guardrails, hashes metadata, writes to `pcd_ops`, logs the
result, re-compiles and supersedes prior user ops; the SQL helpers in `pcdOpsQueries` act as a
lightweight repository for every table/operation mutation.

- Example: `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:274`
- Example: `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:1`

**Serialization + portable schema bridge**: `serialize.ts` (and the matching `portable.ts`
definitions) read from the cache via specialized queries, surface JSON-friendly representations, and
tie directly back to entity creation inputs; this is exactly the “serialize → rename → deserialize”
plumbing the hybrid migration relies on.

- Example: `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:1`
- Example: `packages/praxrr-app/src/lib/shared/pcd/portable.ts:1`

**SQL base-import pipeline**: `importBaseOps` walks the `ops/` directory, parses embedded metadata
comments, orders files, deduplicates via `contentHash`, and marks missing ops as orphaned—ensuring
the repo’s append-only layer is mirrored in the DB before migration kicks in.

- Example: `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:16`

**Cache/auto-resolution loop**: `compiler.ts` boots a new `PCDCache`, swaps it atomically, and then
triggers the auto-override strategy (with locks/round limits) so every migration step sees a
consistent cache while still reconciling conflicts immediately.

- Example: `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts:1`

## Code Conventions

- Domain-focused directories: `pcd/core`, `pcd/database`, `pcd/entities`, `pcd/ops`, `pcd/manifest`,
  and `pcd/utils` keep related services together, mirroring the repository/service/cache layers the
  migration will touch.
  - Example: `packages/praxrr-app/src/lib/server/pcd/entities/customFormats/general/update.ts` shows
    the pattern of per-function responsibility inside the `entities` tree.
- File names/kebab-case: Side-effectful runners (like `seedBuiltInBaseOps.ts`), value-guard helpers
  (e.g., `update.ts`/`delete.ts`), and tests (e.g., `1.1-cf-name-rename.spec.ts`) all use
  hyphenated/kebab naming for clarity.
- Imports favor path aliases (`$pcd`, `$db`, `$logger`, `$sync`, etc.) to group layers and avoid
  relative hell—see how `manager.ts` imports Git helpers, DB queries, cache utilities, logger, and
  jobs in one block.
  - Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:5`
- Types and constants use PascalCase (classes like `PCDManager`, interfaces like
  `PortableCustomFormat`) while runtime helpers stay camelCase; portable schemas intentionally use
  camelCase fields so they can double as create-input payloads.
  - Example: `packages/praxrr-app/src/lib/shared/pcd/portable.ts:11`
- `research/data-schema/synthesis/technical-design.md` prescribes the migration’s file layout (one
  YAML/JSON file per entity, slugified names, `entities/` next to `ops/`) so any new loaders should
  follow that directory and naming convention.

## Error Handling

- Custom error hierarchy: `PCDError` is the base, with specialized subclasses for cache builds,
  operations, validation, dependency resolution, and manifest issues; migration code should throw
  the appropriate subclass so callers can distinguish, log, and respond.
  - Example: `packages/praxrr-app/src/lib/server/pcd/core/errors.ts:1`
- Manifest validation is defensive—every missing or malformed field throws `ManifestValidationError`
  with contextual messaging, ensuring linking/syncing halts before dirty state is introduced.
  - Example: `packages/praxrr-app/src/lib/server/pcd/manifest/manifest.ts:6`
- `writeOperation` never lets raw exceptions bubble straight to the API: it returns
  `{ success: false, error }`, logs structured metadata, enforces base-layer rules, validates
  against the cache, and recompiles before reporting success.
  - Example: `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:274`
- `pcdManager` wraps each sub-step (importing ops, seeding built-in ops, compiling) in `try/catch`
  and logs failures but keeps the higher-level action alive, mirroring the “skip on failure, record
  it, keep operating” posture migration should reuse.
  - Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:39`
- Value guards: entity update/delete helpers compare the current DB state before writing operations
  so conflicting upstream changes are detected deterministically; migration logic must keep this
  pattern intact for writes generated from JSON/YAML diffs.
  - Example: `packages/praxrr-app/src/lib/server/pcd/entities/regularExpressions/update.ts:1`

## Testing Approach

- Base utilities: `BaseTest` provides lifecycle hooks, temp-dir handling, file assertions, patch
  restoration, and timing helpers—migrations should reuse or extend this base when exercising
  filesystem/DB interactions.
  - Example: `packages/praxrr-app/src/tests/base/BaseTest.ts:1`
- Module patching: table-specific tests (e.g., `LidarrBuiltInBaseOpsSeedTest`) stub query helpers
  and logger methods, record calls, and restore originals in `afterEach`, enabling deterministic
  behavior without hitting real SQL or Git.
  - Example: `packages/praxrr-app/src/tests/arr/lidarrBuiltInBaseOpsSeed.test.ts:16`
- Test organization: suites live under feature folders (`base/`, `arr/`, `jobs/`, `e2e/specs/`),
  using numeric prefixes (e.g., `1.1-…`, `2.40-…`) to indicate coverage areas (custom formats vs.
  quality profiles) so new migration tests can slot into the right bucket and be discoverable.
  - Example: `packages/praxrr-app/src/tests/e2e/specs/1.1-cf-name-rename.spec.ts`
- Assertions rely on `@std/assert`, and tests commonly inspect DB fixtures or queued ops via query
  helpers (`pcdOpsQueries`) rather than mocking entire services, reinforcing the preference for
  integration-style validation for data migrations.

## Patterns to Follow

1. **Hybrid JSON/YAML + SQL roadmap**: `research/data-schema/report.md` spells out a five-phase
   migration (JSON schema formalization → JSON exchange + TRaSH adapter → value guard prototype gate
   → YAML entity authoring → full operation YAML). Any work on `pcd-data-migration` should align
   with that phase gating, especially the Phase 3 value-guard prototype mentioned in the report, so
   failure modes are caught early and fallback paths (Option C/D) remain viable.
   - Example reference: `research/data-schema/report.md`
2. **Entity file layout/slug conventions**: The technical design doc
   (`research/data-schema/synthesis/technical-design.md`) mandates one file per entity, slugified
   names in `entities/`, and tight mapping to the existing portable types—new importers/exporters
   should produce and consume that structure to keep diffs intuitive and maintain metadata
   traceability.
   - Example reference: `research/data-schema/synthesis/technical-design.md`
3. **Safety triad & transparent automation**: `research/praxrr-additional-features/report.md`
   emphasizes sync preview, drift detection, and rollback as the safety foundation plus the need for
   deterministic “why this change” explanations. Migration tooling should emit the same structured
   metadata (operation type, entity name, changed fields) so downstream preview/diff tooling can
   reuse it and continue to satisfy the trust-building guidance in the report.
   - Example reference: `research/praxrr-additional-features/report.md`
4. **Reuse existing serialization hooks**: The hybrid story in the report also calls out
   `serialize.ts`/`deserialize.ts` as the current pipeline for JSON ↔ SQL conversion; new migration
   code should plug into those modules and the `portable.ts` schema rather than inventing a parallel
   model, ensuring compatibility with existing clone/export flows.
   - Example reference: `research/data-schema/report.md`
