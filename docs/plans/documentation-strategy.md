# Documentation Strategy

## Run Metadata

- Date: 2026-02-20
- Scope: entire codebase
- Mode: update
- Source audit: `write-docs/scripts/audit-documentation.sh`

## Audit Summary

- Canonical docs currently live in a small set of files:
  - `README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/CONTRIBUTING.md`
  - `docs/DEVELOPMENT.md`
  - `docs/api/v1/openapi.yaml`
- Documentation does not yet have a navigable index (`docs/README.md` missing).
- Architecture content exists but is monolithic; there is no modular `docs/architecture/` set.
- API source-of-truth spec exists, but no reader-oriented docs for auth, errors, and endpoint quick reference.
- Feature-level docs are missing (`docs/features/` absent).
- Root README has an empty `## Documentation` section and weak navigation to canonical docs.
- Existing strategy file was stale and described a different repository structure.

## Gaps

1. No docs information architecture (`docs/README.md`, architecture/API/features hubs).
2. No concise API quickstart docs tied to current `/api/v1` endpoints.
3. No feature workflow docs for link/bridge/sync and entity testing.
4. README navigation is incomplete and does not route users to the right docs quickly.
5. Development docs contain a scoped plan-verification section that should not be in canonical developer guidance.

## Priority Workstreams

1. Architecture docs (`docs/architecture/*`) to split critical architecture guidance into focused pages.
2. API docs (`docs/api/*.md`) to add practical usage docs on top of OpenAPI artifacts.
3. Feature docs (`docs/features/*.md`) to document top workflows and troubleshooting paths.
4. README updates (`README.md`, `docs/CONTRIBUTING.md`) for discoverability and cross-links.

## Planned Changes

### Update

- `README.md`
- `docs/CONTRIBUTING.md`
- `docs/DEVELOPMENT.md`
- `docs/plans/documentation-strategy.md`

### Create

- `docs/README.md`
- `docs/architecture/overview.md`
- `docs/architecture/components.md`
- `docs/architecture/data-flow.md`
- `docs/api/README.md`
- `docs/api/endpoints.md`
- `docs/api/authentication.md`
- `docs/api/errors.md`
- `docs/features/README.md`
- `docs/features/link-bridge-sync.md`
- `docs/features/entity-testing.md`
- `docs/features/portable-import-export.md`

### Remove

- Remove stale section `Task 3.3 Documentation Verification` from `docs/DEVELOPMENT.md`.
- Remove empty/placeholder root README documentation section content and replace with active navigation links.

## Scope and Boundaries

- Keep `docs/api/v1/**` as the OpenAPI source of truth.
- Do not rewrite package distribution READMEs (`packages/praxrr-db/README.md`, `packages/praxrr-schema/README.md`) in this pass.
- Preserve deep reference content in `docs/ARCHITECTURE.md`; new architecture docs provide quick navigation, not replacement.

## Priority Files For Code Documentation Stream

- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`
- `packages/praxrr-app/src/lib/server/sync/index.ts`
- `packages/praxrr-app/src/lib/server/jobs/init.ts`

Code-comment updates are optional in this run and only apply if gaps are found during workstream integration.
