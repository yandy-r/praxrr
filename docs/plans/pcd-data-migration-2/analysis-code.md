### Executive Summary

PCD lifecycle changes funnel through `PCDManager`, so any migration tooling must respect its
import/compile orchestration and stable-identity guard rails. The converter/parity suite is an
offline CLI that consumes the same cache/serializers as `importBaseOps` and writes files that the
existing reader/deserializers already understand, which keeps runtime import/export behavior
unchanged. Reusing the shared portable serialization/deserialization functions ensures field order,
tagging, and validation stay aligned across converter, API export, and parity verification flows.

### Related Components

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: orchestrates `importBaseOps`, fallback
  handling, and cache compilation: the lifecycle anchor the migration artifacts must integrate with.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: defines directory mappings,
  validation, and deserializer wiring that the converter/parity outputs must match.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: shared serializers that the
  converter and export endpoint rely on to normalize every entity type.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: API facade that already uses the
  serializers, guiding how converter output should be packaged.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: validates portable payloads and
  enforces family constraints, mirroring the expectations for converter/parity inputs.
- `docs/plans/pcd-data-migration-2/feature-spec.md`: enumerates the new CLI/scripts/tests/tasks plus
  migration requirements that implementation must follow.

### Implementation Patterns

**Lifecycle Orchestrator**: `PCDManager.importBaseOpsWithOrchestration` controls migration mode
(SQL-only vs. hybrid) and fallback logging, so migration tooling must defer to this centralized
coordination.

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:400`
- Apply to: [base ingestion coordination, migration-mode handling]

**Portable Serialization Boundary**: The converter should reuse serializers that query cache
rows/tags/tests and produce stable portable payloads, avoiding duplicate mapping logic.

- Example: `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:34`
- Apply to: [converter output formatting, export route reuse, serializer tests]

**Reader-Validated Migration Ingestion**: All generated files must obey `reader.ts`’s directory/type
mapping, slug expectations, and `validatePortableData` checks so deserialization/parity remains
reliable.

- Example: `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:45`
- Apply to: [file layout enforcement, parity verifier inputs, migration import diagnostics]

**Stable Identity Conflict Guard**: `importBaseOps` derives stable identities from SQL metadata and
detects duplicates across SQL and migration sources, so converter outputs must not collide with
existing ops.

- Example: `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:159`
- Apply to: [collision detection, CLI validation, parity/verifier inputs]

### Integration Points

#### Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`: enumerate cache entities,
  serialize through shared helpers, format YAML deterministically, and write files matching
  `reader.ts` directories.
- `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`: build standalone SQL- and
  entity-based caches, snapshot the 37 comparison tables, and emit detailed diffs.
- `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`: shared slug utility so filenames stay
  consistent across converter and reader expectations.
- `packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`: deterministic YAML formatter
  with migration metadata ordering, stable quoting, and explicit nulls.
- `scripts/convert-pcd-to-yaml.ts` and `scripts/verify-pcd-parity.ts`: CLI entry points tied to new
  Deno tasks for conversion and parity verification.
- Tests under `packages/praxrr-app/src/tests/pcd/migration/`: converter, parity verifier, and slug
  suites to ensure deterministic behavior and parity guarantees.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: implement `serializeLidarrNaming`
  (schema fields differ from Sonarr, so move logic from export route to here).
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: switch to the shared
  `serializeLidarrNaming` once added to keep API exports aligned.
- `deno.json`: register `convert:pcd-entities` and `verify:pcd-parity` task aliases that invoke the
  new scripts.

### Conventions

- Naming: entity slugs use a shared lowercase/dash slug function with collision suffixes per
  `entityNameToSlug` so filenames are deterministic and git-diff friendly.
- Error handling: fail fast on stable-identity conflicts, migration reader issues, or missing
  serializers to prevent silent divergence between SQL and YAML sources.
- Testing: add converter, parity verifier, and slug unit tests (plus CI parity checks) to ensure
  byte-identical outputs and round-trip correctness before merging.

### Gotchas and Warnings

- `serialize.ts` currently lacks `serializeLidarrNaming`; without this, neither the converter nor
  export route can emit the true Lidarr naming schema. Add it before tooling touches those entities.
- Tags live inline in each entity payload, so orphan tags (unused by any entity) are intentionally
  pruned; parity comparisons must expect fewer tag rows after conversion.
- `reader.ts` already reserves `tags.yaml` and `quality-api-mappings.yaml` for future non-entity
  seeds; do not generate or rely on those files yet, as they trigger reader warnings.
- The converter is offline (Deno script) and must produce directories that match
  `ENTITY_FORMAT_BY_DIR`/`ENTITY_FORMAT_BY_MEDIA_DIR` so runtime import trusts the same layout.

### Task Guidance by Area

- database: enumerate entity names via ordered `SELECT name FROM ...` queries (distinct for quality
  definitions) and serialize each with shared `serialize*` functions; process entity types in
  dependency order (`regular_expression` -> `custom_format` -> `quality_profile` etc.) so parity
  deserialization matches reader expectations.
- api: keep using the existing export/import endpoints and their shared validation helpers
  (`validatePortableData`, `validateLidarrPayload`); converter/parity outputs must mirror those
  portable schemas so runtime API routes remain consistent.
- ui: no direct UI changes, but any documentation or future UI references should continue to align
  with the portable import/export supported entity list and payload semantics already documented in
  `docs/features/portable-import-export.md`.
