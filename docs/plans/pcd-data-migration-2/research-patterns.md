# Pattern Research: pcd-data-migration-2

## Architectural Patterns

**Lifecycle Orchestrator Pattern**: `PCDManager` coordinates git operations, dependency setup,
importing ops, compiling caches, and scheduling downstream syncs while delegating data access to
query modules.

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

**Repository/Query Module Pattern**: DB access is encapsulated in query modules (`databaseInstances`,
`pcdOps`, etc.) instead of inline SQL in higher layers.

- Example: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`

**Portable Serialization Boundary**: All entity format translations are centralized in
`serialize.ts` and `deserialize.ts`, with portable contracts in `portable.ts`.

- Example: `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- Example: `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`

**Cache Compile Pipeline Pattern**: Cache build/compile responsibilities are split between `cache.ts`
and `compiler.ts`, keeping lifecycle and execution concerns separate.

- Example: `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- Example: `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`

## Code Conventions

- Use path aliases from `deno.json` (`$pcd/`, `$db/`, `$shared/`, etc.).
- TypeScript naming conventions: `camelCase` for functions/variables, `PascalCase` for types.
- Keep domain logic in dedicated modules under `src/lib/server/pcd/*`.
- Prefer explicit exported functions per behavior over large mutable service objects.
- Keep migration/entity contracts in shared portable types rather than route-local ad hoc shapes.

## Error Handling

- Fail fast with explicit errors in domain-critical paths (reader validation, compile conflicts,
  deserializer preconditions).
- Use structured logging (`logger.error`, `logger.warn`) and rethrow from service boundaries.
- Preserve transactional integrity in query modules with begin/rollback/commit handling.
- Use domain-specific errors where possible (e.g., migration reader error context).

## Testing Approach

- Tests are organized by feature area under `packages/praxrr-app/src/tests/pcd/*`.
- Use `BaseTest` infrastructure for temp dirs, patching, and deterministic setup/cleanup.
- Prefer focused unit/integration tests around migration behavior (parity, reader, slug,
  serializer/deserializer consistency).
- Use `@std/assert` and deterministic fixture data for reproducible checks.

## Patterns to Follow

- Reuse existing serializers/deserializers and portable types; do not duplicate mapping logic.
- Keep converter/parity logic in migration modules with clear boundaries: enumerate, serialize,
  write, read, deserialize, compare.
- Mirror existing transaction/logging conventions for operational safety and debuggability.
- Place new tests in `src/tests/pcd/migration` and follow `BaseTest` utility patterns.
