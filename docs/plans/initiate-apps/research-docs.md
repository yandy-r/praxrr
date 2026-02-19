# Documentation Research: initiate-apps

## Overview

This document catalogs all documentation relevant to implementing environment-variable-based Arr instance provisioning at startup. The initiate-apps feature has extensive prior research already completed in six plan documents covering technical architecture, business logic, external APIs, UX patterns, and recommendations. The implementation touches the startup sequence, database migrations, Arr client infrastructure, and the instance CRUD layer -- all of which are well-documented in both the plan files and the existing codebase.

---

## Architecture Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project-level architecture guide. Documents the startup sequence (`hooks.server.ts`), path aliases (`$arr/`, `$db/`, `$config`, etc.), server/client layout, PCD system, database conventions, environment variables (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, etc.), and the Cross-Arr Semantic Validation Policy. **REQUIRED reading** -- contains conventions that directly constrain the implementation (e.g., no `any` types, fail-fast error handling, conventional commits, contract-first API, template-required issue/PR creation).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/hooks.server.ts`: The actual startup sequence implementation (171 lines). Shows the exact insertion point for `reconcileEnvInstances()` between PCD auto-link (line 37-91) and `initializeJobs()` (line 94). The default-DB auto-link block (lines 37-91) is the direct pattern precedent -- reads `PRAXRR_DEFAULT_DB_*` env vars, uses `setupStateQueries` guard, wraps in try/catch, marks as attempted regardless of outcome.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config singleton pattern (114 lines). Shows how existing env vars are read (constructor-time, `Deno.env.get()` with `.trim()` and fallbacks). Documents all current env vars: `APP_BASE_PATH`, `TZ`, `PARSER_HOST`, `PARSER_PORT`, `PORT`, `HOST`, `AUTH`, `OIDC_*`. The new env instance parser should NOT extend this class (single responsibility) but should follow the same env-reading idioms.

---

## Plans (Related Features)

### initiate-apps (Primary -- All Required)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/feature-spec.md`: **Comprehensive feature specification** (431 lines). Covers executive summary, external dependencies (Radarr/Sonarr/Lidarr API details), business rules (10 rules + edge case table), technical specifications (architecture diagram, data model with `source` column, conflict resolution strategy, system integration, env var reference, Docker Compose example), UX considerations (startup logs, error recovery, UI patterns), recommendations (3-phase approach), risk assessment, and full task breakdown with dependency graph. This is the authoritative specification document.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-technical.md`: **Deep technical architecture** (585 lines). Covers current state analysis (startup sequence, `arr_instances` schema, instance CRUD flow, config singleton pattern, setup state pattern), architecture design (env var naming with Pattern A + B, data flow, module structure), data model (source column migration, conflict resolution by `api_key` and `name`, TypeScript type updates), implementation plan with code examples for parser and upsert logic, file-level impact matrix, architectural patterns, edge cases (13 detailed scenarios), security considerations, and testing strategy.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-business.md`: **Business logic and domain model** (267 lines). User stories, 10 business rules, edge case analysis, primary workflow (startup provisioning with 7 steps), error recovery patterns, domain model (entity relationships showing all FK dependencies from `arr_instances`), existing codebase integration points (files to create/modify), and success criteria checklist.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-external.md`: **External API and ecosystem research** (740 lines). Documents Radarr API v3, Sonarr API v3, Lidarr API v1 endpoints and authentication. API version summary table. Comprehensive code examples for env var parser and startup initialization. Ecosystem comparison matrix (Notifiarr `DN_` pattern, Unpackerr `UN_` pattern, Recyclarr YAML, Buildarr YAML). 10 constraints/gotchas with mitigations. Docker Compose example. Sources bibliography.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-ux.md`: **UX research and competitive analysis** (749 lines). Docker Compose configuration workflow, user discovery channels, first-run experience patterns, env-authoritative vs seed-then-DB models (recommends env-authoritative), competitive analysis (Notifiarr, Unpackerr, Recyclarr, Configarr, Grafana, Prowlarr, Overseerr/Jellyseerr), visual indicator patterns (banner, badge, lock icon), error handling UX (log-first principle, error categories table, common mistakes table), performance UX (three-phase startup model), naming convention analysis (1-based vs 0-based), 14 actionable UX patterns ranked by priority.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-recommendations.md`: **Implementation strategy** (348 lines). Recommends app-prefixed pattern only (no generic pattern), new module at `$arr/envInstances.ts`, `source` column for provenance, 3-phase rollout (Core Provisioning -> Connection Validation -> UI Integration). Task breakdown with dependency graph showing parallelization opportunities. Risk assessment (5 risks with mitigations). Alternative approaches analysis (app-prefixed, generic, config file, hybrid).

### external-url (Closely Related -- Recent arr_instances Column Addition)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/external-url/feature-spec.md`: Documents the `external_url` column addition to `arr_instances` (completed). Shows the exact pattern for adding a new column: migration file, schema.sql update, `ArrInstance` interface extension, `CreateArrInstanceInput`/`UpdateArrInstanceInput` extension, form and server action updates. The initiate-apps `source` column follows the same migration and type-extension pattern.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/external-url/research-technical.md`: Shows file-level impact for `arr_instances` schema changes. Documents the `normalizeExternalUrl()` pattern for handling nullable columns. Shows how `arrInstancesQueries.create()` and `update()` were extended.

### enhance-lidarr-support (Arr-Touching Feature Patterns)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-lidarr-support/feature-spec.md`: Documents first-class Lidarr entity migration. Relevant for understanding how Lidarr-specific logic is handled distinctly from Radarr/Sonarr in the codebase. Shows the Cross-Arr Semantic Validation Policy in practice.

### lidarr-metadata-profiles (Recent Arr-Specific Feature)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/lidarr-metadata-profiles/feature-spec.md`: Documents a Lidarr-exclusive entity family. Relevant for understanding how Arr-type-gated features are structured (PCD schema, entity CRUD, sync pipeline, API routes, UI) and the strict Cross-Arr scoping requirement.

### monorepo-strategy (Workspace Structure)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/monorepo-strategy/feature-spec.md`: Documents the monorepo workspace layout with `packages/praxrr-app/`, `packages/praxrr-api/`, `packages/praxrr-db/`, `packages/praxrr-schema/`. Important for understanding file paths -- all runtime app code lives under `packages/praxrr-app/`.

---

## Configuration Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config singleton (see Architecture Docs above). All current env vars documented here.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/Dockerfile`: Multi-stage build. Runtime env vars: `PORT=6868`, `HOST=0.0.0.0`, `APP_BASE_PATH=/config`, `TZ=UTC`. Health check: `curl -sf http://localhost:${PORT}/api/v1/health || exit 1`. Shows the Docker runtime context for env var injection.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docker/entrypoint.sh`: Container entrypoint. Handles `PUID`/`PGID`/`UMASK` setup and directory creation (`/config/data`, `/config/logs`, `/config/backups`, `/config/databases`). The app binary runs as the configured user. No instance-related env vars are processed here.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.envrc`: direnv configuration (encrypted, not readable). Likely contains development-time env vars.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.env.keys`: Dotenvx encryption keys. Not relevant to implementation.

---

## Database Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql`: Reference schema documentation (not executed). Documents all tables including `arr_instances` (lines 24-43), `setup_state` (in migration 039). Currently shows `arr_instances` with `id`, `name` (UNIQUE), `type`, `url`, `external_url`, `api_key`, `tags`, `enabled`, `created_at`, `updated_at`. The new `source` column must be added here after migration.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts`: Migration runner and registry (345 lines). Shows all 55+ migrations statically imported and registered. New migrations must follow the pattern: static import at top, add to `loadMigrations()` array. Latest migration version is `20260219`. The next migration should use `20260220` (or the implementation date).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts`: The most recent `arr_instances` column addition (18 lines). Shows exact pattern: simple `ALTER TABLE ... ADD COLUMN` in `up` string. This is the template for the `source` column migration.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/039_create_setup_state.ts`: Setup state table creation (30 lines). Shows singleton pattern (`id = 1 CHECK`), `default_database_linked` column, and initial INSERT. If a setup_state column is added for env instances, follow this pattern. However, the feature spec recommends running reconciliation every startup (no setup_state guard).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Instance CRUD queries (197 lines). `ArrInstance` interface (10 fields), `CreateArrInstanceInput` interface, `UpdateArrInstanceInput` interface, `normalizeExternalUrl()` helper, and methods: `create()`, `getById()`, `getAll()`, `getByType()`, `getEnabled()`, `update()`, `delete()`, `nameExists()`, `apiKeyExists()`. The `source` column must be added to `ArrInstance`, `CreateArrInstanceInput`, and new query methods (`getBySource()`, `getByApiKey()`, `upsertFromEnv()`) must be added.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: Setup state queries (45 lines). `SetupState` interface, `get()`, `isDefaultDatabaseLinked()`, `markDefaultDatabaseLinked()`. Pattern reference for one-time guards, though initiate-apps runs every startup.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/generalSettings.ts`: General settings queries (61 lines). `shouldApplyDefaultDelayProfiles()` is called during instance creation to decide whether to apply default delay profiles. The env provisioning flow must call this for new Radarr/Sonarr instances.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/db.ts`: Database singleton (DatabaseManager). Shows `transaction()` method for wrapping atomic operations, `exec()` for DDL, `execute()` for DML, `query()`/`queryFirst()` for reads. The reconciliation should use `transaction()` to wrap the full batch.

---

## Arr Client Infrastructure

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Client factory (30 lines). `createArrClient(type, url, apiKey, options)` dispatches to `RadarrClient`, `SonarrClient`, `LidarrClient`, or `ChaptarrClient`. Used for optional connection testing during provisioning.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/types.ts`: Arr type definitions (1052 lines). `ArrType = 'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'` (line 5). `ArrSystemStatus` interface (lines 956-988) with `appName`, `instanceName`, `version` fields used for connection validation. `ArrDelayProfile` interface (lines 735-747) used for default delay profile application.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/defaults.ts`: Default delay profiles (62 lines). `getDefaultDelayProfile(arrType)` returns Radarr or Sonarr delay profiles. Only supports `radarr` and `sonarr` (not `lidarr`). The env provisioning must apply these for new Radarr/Sonarr instances when `generalSettingsQueries.shouldApplyDefaultDelayProfiles()` is true.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/types.ts`: Canonical `ArrAppType` and `ARR_APP_TYPES` definitions. The `ARR_APP_TYPES` array (`['radarr', 'sonarr', 'lidarr']`) is the validation allowlist for env-provisioned instance types.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Arr app capabilities registry. Defines workflow surfaces and sync surfaces per app type. Used for UI feature gating.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/validation/url.ts`: URL validation helper (25 lines). `parseOptionalAbsoluteHttpUrl()` validates http/https URLs. Should be reused for env var URL validation.

---

## Route Reference (Instance Create/Update Patterns)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/new/+page.server.ts`: Instance creation route (158 lines). Shows the canonical validation flow: check required fields, validate type against `VALID_TYPES` (`['radarr', 'sonarr', 'lidarr']`), validate external URL, check `nameExists()`, check `apiKeyExists()`, parse tags, call `arrInstancesQueries.create()`, optionally apply default delay profile. The env provisioning must replicate this business logic.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/test/+server.ts`: Connection test endpoint. Shows `createArrClient` usage with 3-second timeout and 0 retries for testing.

---

## Test Infrastructure

- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/test.ts`: Test runner script (57 lines). Defines test aliases mapping short names to file/directory paths. Tests run with `--allow-read --allow-write --allow-env --allow-ffi` and `APP_BASE_PATH=./dist/test`. A new `env-instances` alias should be added for the new tests.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/`: Test directory containing 33 test files organized by subdirectory (`arr/`, `base/`, `jobs/`, `upgrades/`, `logger/`). Relevant existing tests for pattern reference:
  - `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts`: Tests for the `external_url` column persistence -- closest pattern reference for testing a new `arr_instances` column.
  - `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/arr/resolveArrTargets.test.ts`: Tests for Arr target resolution logic.
  - `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/arr/displayName.test.ts`: Tests for display name utilities.

---

## API Documentation

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/openapi.json`: Praxrr's own OpenAPI specification. No new endpoints are required for initiate-apps (env-sourced instances appear through existing query paths).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/types.ts`: Generated API types from OpenAPI spec. May need updating if the `ArrInstance` type is exposed in the API contract.

---

## Must-Read Documents

These documents are **required reading** before implementing initiate-apps, in priority order:

1. `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/feature-spec.md` -- Authoritative feature specification with all decisions, data models, conflict resolution, and task breakdown.
2. `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md` -- Project conventions, path aliases, Cross-Arr Semantic Validation Policy, env var patterns, and coding standards.
3. `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/hooks.server.ts` -- Current startup sequence; the exact file being modified for integration.
4. `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` -- Current `ArrInstance` interface and CRUD methods; must be extended.
5. `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-technical.md` -- Detailed architecture design including data flow, schema changes, and edge cases.
6. `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/initiate-apps/research-recommendations.md` -- Implementation strategy and risk assessment.
7. `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/new/+page.server.ts` -- Reference implementation for instance creation validation and default delay profile application.
8. `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts` -- Migration pattern template for new `arr_instances` columns.
9. `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts` -- Migration registration pattern (static imports + array).

---

## Documentation Gaps

1. **No analysis-tasks.md or analysis-code.md exist yet** for initiate-apps. These are present in other completed plans (external-url, enhance-lidarr-support, lidarr-metadata-profiles) and are typically created during implementation planning. The feature-spec.md contains a task breakdown preview but not a detailed analysis-tasks checklist.

2. **No test strategy document**: The research-technical.md mentions testing strategy briefly (section 10) but there is no dedicated test plan. Existing test patterns in `packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts` provide the closest template.

3. **No `.env.example` file exists** in the repository. The feature spec includes a Docker Compose example and env var reference, but there is no standalone `.env.example` that could serve as a template for users. This would be valuable documentation to create alongside the feature.

4. **No docker-compose.yml example exists** in the repository for development or production reference. The `Dockerfile` and `docker/entrypoint.sh` exist but there is no compose file showing how env vars are typically injected.

5. **Divergence between feature-spec.md and research-technical.md on Pattern B (generic pattern)**: The feature-spec.md explicitly recommends app-prefixed only and rejects the generic pattern. The research-technical.md and research-business.md still describe supporting both patterns. The feature-spec.md is authoritative (decision made: app-prefixed only).

6. **Divergence between feature-spec.md and research-business.md on run frequency**: The feature-spec.md specifies running reconciliation every startup (no setup_state guard). The research-business.md suggests a one-time `instances_provisioned` setup_state flag. The feature-spec.md is authoritative (decision made: every startup, no guard).

7. **Divergence between feature-spec.md and research-technical.md on upsert key**: The feature-spec.md uses `api_key` as the match key. The research-technical.md section 3.4 uses `name` as the upsert key. The feature-spec.md is authoritative (decision made: match by `api_key`, which is globally unique per Arr install).

8. **No documentation for `db.transaction()` usage patterns**: The `db.ts` file shows the method exists but there is no documentation on proper usage. The reconciliation should wrap the entire batch in a transaction.

9. **OpenAPI spec update**: If the `source` column should be exposed in the Praxrr API, the OpenAPI spec at `packages/praxrr-api/openapi.json` needs updating and types regenerated. This is not documented in the current plan.
