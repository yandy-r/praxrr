# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Profilarr manages quality profiles, custom formats, and release profiles for Radarr/Sonarr. It syncs curated configuration databases (PCDs) into Arr instances. V2 is under active development (not production-ready).

## Tech Stack

- **Runtime:** Deno 2.x
- **Web framework:** SvelteKit (Vite + sveltekit-adapter-deno), Svelte 5
- **Database:** SQLite (app DB via Kysely) + in-memory SQLite (PCD cache)
- **UI:** Tailwind CSS v4
- **Parser:** C# microservice (.NET 8+, optional for CF/profile testing)
- **SCM:** Git (PCD repos + export flow)

## Commands

### Development

```bash
deno task dev              # Run parser + Vite dev server (port 6969)
deno task dev:noauth       # Dev server with AUTH=off
deno task dev:server       # Vite dev server only (no parser)
deno task dev:parser       # Parser service only (dotnet watch, port 5000)
```

### Build

```bash
deno task build            # Vite build + Deno compile (Linux x86_64)
deno task build:windows    # Vite build + Deno compile (Windows)
deno task preview          # Run built binary (port 6869)
```

### Lint & Type Check

```bash
deno task lint             # Prettier check + ESLint
deno task format           # Prettier write
deno task check            # Type check both server (deno check) and client (svelte-check)
deno task check:server     # Deno type check server code only
deno task check:client     # svelte-check client code only
```

### Tests

```bash
deno task test             # Run all unit tests
deno task test filters     # Run specific test by alias
deno task test upgrades    # Run test directory by alias
deno task test:watch       # Watch mode
deno task test:e2e         # Playwright e2e tests (requires running server)
deno task test:e2e:headed  # E2e with browser visible
deno task test:e2e:reset   # Reset e2e test state
```

Test aliases defined in `scripts/test.ts`: `filters`, `normalize`, `selectors`, `backup`, `cleanup`, `upgrades`, `jobs`, `logger`.

### Docker

```bash
deno task docker:build     # Build dev image
deno task docker:up        # Build + run dev containers
deno task docker:down      # Stop dev containers
deno task arr              # Run local Radarr/Sonarr for testing
```

### Code Generation

```bash
deno task generate:api-types   # OpenAPI -> TypeScript types (src/lib/api/v1.d.ts)
deno task generate:pcd-types   # PCD schema -> TypeScript types (src/lib/shared/pcd/types.ts)
```

## Architecture

### Path Aliases

Defined in `svelte.config.js` and mirrored in `deno.json`:

| Alias             | Path                                    |
| ----------------- | --------------------------------------- |
| `$lib/`           | `src/lib/`                              |
| `$api/`           | `src/lib/api/`                          |
| `$config`         | `src/lib/server/utils/config/config.ts` |
| `$logger/`        | `src/lib/server/utils/logger/`          |
| `$shared/`        | `src/lib/shared/`                       |
| `$stores/`        | `src/lib/client/stores/`                |
| `$ui/`            | `src/lib/client/ui/`                    |
| `$db/`            | `src/lib/server/db/`                    |
| `$pcd/`           | `src/lib/server/pcd/`                   |
| `$jobs/`          | `src/lib/server/jobs/`                  |
| `$arr/`           | `src/lib/server/utils/arr/`             |
| `$sync/`          | `src/lib/server/sync/`                  |
| `$auth/`          | `src/lib/server/utils/auth/`            |
| `$notifications/` | `src/lib/server/notifications/`         |
| `$cache/`         | `src/lib/server/utils/cache/`           |
| `$http/`          | `src/lib/server/utils/http/`            |
| `$utils/`         | `src/lib/server/utils/`                 |

### Server-Side Layout

- `src/lib/server/pcd/` - PCD system: ops compiler, cache, writer, entity CRUD
- `src/lib/server/db/` - App DB: schema, migrations, queries
- `src/lib/server/sync/` - Sync pipeline to Arr instances
- `src/lib/server/jobs/` - Job queue, dispatcher, handlers
- `src/lib/server/upgrades/` - Upgrade engine for automated searches
- `src/lib/server/rename/` - Rename processor
- `src/lib/server/notifications/` - Notification manager + notifiers
- `src/lib/server/utils/` - HTTP client, Arr clients, auth, config, logger, git, TMDB

### Client-Side Layout

- `src/lib/client/ui/` - Reusable Svelte components (buttons, forms, tables, modals, navigation)
- `src/lib/client/stores/` - Svelte stores
- `src/lib/client/alerts/` - Global alert system
- `src/lib/client/utils/` - Client helpers

### Shared

- `src/lib/shared/` - Types and utilities shared between server and client

### Routes

- `src/routes/api/v1/**` - API v1 endpoints (all new API work goes here)
- `src/routes/{feature}/**` - Feature pages (custom-formats, quality-profiles, databases, etc.)
- `src/routes/auth/**` - Authentication routes
- `src/routes/settings/**` - Settings pages

### Services

- `src/services/parser/` - C# parser microservice (release title parsing)

## Key Concepts

### PCD (Profilarr Config Database)

Configuration is stored as append-only **ops** (SQL operations) in `pcd_ops`. Ops are replayed into an in-memory SQLite cache on each compile. Two layers exist:

- **Base ops**: published canonical state (from repo)
- **User ops**: local overrides that persist across syncs

Writer pipeline: Kysely query -> SQL compile -> validate against cache -> write to `pcd_ops` -> recompile cache.

Updates/deletes use **value guards** (old-value checks) to detect upstream changes.

### App Database

SQLite file (`profilarr.db`) managed by `DatabaseManager` in `$db/db.ts`. Schema changes are done via migrations in `src/lib/server/db/migrations/*.ts` (not the reference `schema.sql`). WAL mode, foreign keys enforced.

### Startup Sequence

`src/hooks.server.ts`: config.init() -> db.initialize() -> runMigrations() -> logSettings.load() -> pcdManager.initialize() -> initializeJobs() -> auth middleware.

## Conventions

- **Svelte 5, no runes.** Use `onclick` handlers, not `$state`/`$derived`.
- **Alerts for user feedback.** Use `alertStore.add(type, message)`.
- **Dirty tracking.** Use the dirty store to block saves + warn on navigation.
- **Routes over modals.** Only use modals for confirmations or rare one-off forms.
- **API namespace.** All new API work under `/api/v1/*`; legacy routes are migration targets.
- **Contract-first API.** Define OpenAPI spec first, generate types, then implement.
- **Conventional commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- **Formatting.** Tabs, single quotes, no trailing commas, 100 char print width (Prettier + prettier-plugin-svelte + prettier-plugin-tailwindcss).
- **Entity names.** Case-insensitive uniqueness enforced on create/rename for all PCD entities.
- **PR body updates.** Use `gh pr create/edit --body-file <file>` rather than inline `--body`; if `gh pr edit` fails with GraphQL `projectCards` deprecation errors, patch the PR via `gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -f body=...`.

### Cross-Arr Semantic Validation Policy

This rule applies to all future enhancements, features, and bug fixes.

- Do not assume Sonarr, Radarr, Lidarr, or other Arr apps share identical domain semantics, even when API shapes look similar.
- Validate behavior per target `arr_type` before reusing handlers, payload parsing, sync logic, or field mappings.
- Keep domain terms, validation rules, and contracts Arr-specific; do not introduce cross-Arr naming shortcuts without parity proof.
- Fail fast on missing, ambiguous, or inferred cross-Arr mappings during implementation, import/export, and migration paths.

Checklist (required for Arr-touching changes):

- [ ] API semantics verified per Arr app involved.
- [ ] Schema/field mappings validated per Arr app involved.
- [ ] Read/write/sync dispatch resolves by explicit `arr_type` (no implicit sibling fallback).
- [ ] Migration/import/export mappings are defined per Arr app and fail-fast on ambiguity.

### Portable Contract Fidelity (Required)

- OpenAPI portable schemas, runtime validators, and entity payload handlers must stay in lockstep.
- Do not document portable fields that current runtime rejects for that `arr_type`.
- Preserve exact config-name identifiers used for sync lookup keys; reject empty values, but do not trim persisted names.
- For scoped rename propagation tests, verify exact `instance_id` targets in addition to update counts.
- For transitional shared-table contracts (for example Sonarr-backed Lidarr entities), define table identifiers once in a shared constants module and reuse across read/create/update/delete paths to prevent silent contract drift between files.

### Arr Cutover Guardrails (Required)

- After promoting an Arr entity family to first-class tables, remove legacy sibling-app fallback paths immediately in route/read/write/sync resolution.
- When introducing built-in PCD base-op migrations, also register them in `src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` so newly initialized databases receive them without rerunning migrations.
- For Arr-specific default templates, update both runtime form defaults and migration/backfill ops in the same change to avoid mixed legacy/native defaults.

## Environment Variables

Key variables for development: `APP_BASE_PATH` (default `./dist/dev` in dev), `PORT` (default 6969 in dev, 6868 in prod), `AUTH` (`on`|`local`|`off`|`oidc`), `PARSER_HOST`/`PARSER_PORT` (parser service location).
