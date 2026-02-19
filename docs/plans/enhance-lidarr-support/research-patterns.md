# Pattern Research: enhance-lidarr-support

## Architectural Patterns

**Thin Route + Entity Module Pattern**: Route `load/actions` validate request inputs and delegate persistence to entity helpers.

- Example: `packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts`
- Example: `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts`

**Entity Family Module Pattern**: Each media-management family is split into `read/create/update/delete/override` modules.

- Example: `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/*`
- Example: `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/quality-definitions/*`

**Sync Resolver Pattern**: syncer chooses source config and pushes to Arr client with mapping/capability checks.

- Example: `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`

## Code Conventions

- Use path aliases (`$pcd`, `$shared`, `$server`, `$arr`, `$logger`) instead of deep relative imports.
- Keep arr-type branching explicit and validated before operation dispatch.
- Keep operations deterministic via stable metadata in write operations.
- Follow existing file naming and module split conventions in media-management folders.

## Error Handling

- Fail fast on invalid ids/arr types/layers/form payloads (`fail(400, ...)`).
- Use structured server logging for sync diagnostics and mapping misses.
- Avoid silent fallback paths; return explicit failure reasons for validation and mapping errors.
- Use centralized validation helpers for portable payloads before deserialize/write.

## Testing Approach

- Place feature tests under `packages/praxrr-app/src/tests/arr/`, `packages/praxrr-app/src/tests/base/`, and relevant sync/job test domains.
- Cover both positive and failure paths (duplicates, mapping gaps, unsupported payloads).
- Verify logs/diagnostics for sync skip/warning behavior where relevant.
- Add migration idempotency tests (rerun behavior and conflict handling).

## Patterns to Follow

- Preserve thin route handlers and move complexity into entity/sync modules.
- Add first-class Lidarr helpers rather than extending implicit Sonarr reuse branches.
- Keep import/export and runtime entity contracts synchronized in one change set.
- Mirror existing tests for Radarr/Sonarr flows when adding Lidarr first-class coverage.
