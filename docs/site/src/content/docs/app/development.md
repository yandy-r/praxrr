---
title: Development Setup
description: Contributor guide for Deno 2.x, optional parser service, dev tasks, environment variables, Docker workflows, and monorepo layout in Praxrr.
---

This page covers how to run Praxrr locally for development. For end-user installation,
see [Getting Started](/getting-started/) — Docker install tables and production compose
files are documented there, not duplicated here.

## Prerequisites

| Requirement       | Notes                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| **Deno 2.x**      | Primary runtime; invoke tooling through `deno task …`, not npm for app code. |
| **Node.js + npm** | Required for the docs site (`docs/site`) and Svelte client type-check.       |
| **.NET 8+**       | Optional; needed only when running the parser microservice locally.          |
| **Git**           | PCD repositories and export flows depend on Git.                             |

## Monorepo Layout

| Path                      | Purpose                       |
| ------------------------- | ----------------------------- |
| `packages/praxrr-app/`    | SvelteKit application runtime |
| `packages/praxrr-parser/` | C# parser microservice        |
| `packages/praxrr-api/`    | API bundle artifact           |
| `packages/praxrr-db/`     | PCD database mirror           |
| `packages/praxrr-schema/` | PCD schema mirror             |
| `docs/site/`              | Starlight documentation site  |
| `docs/api/v1/`            | OpenAPI contract              |

Build artifacts belong under repo-root `dist/` (gitignored). Tasks set `APP_BASE_PATH`
explicitly — for example `dist/dev` during development.

## Dev Tasks

From the repository root:

| Task                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `deno task dev`        | Parser + Vite dev server (port 6969)            |
| `deno task dev:noauth` | Dev server with `AUTH=off`                      |
| `deno task dev:server` | Vite dev server only (no parser)                |
| `deno task dev:parser` | Parser service only (`dotnet watch`, port 5000) |
| `deno task preview`    | Run compiled binary                             |
| `deno task docs:dev`   | Starlight dev server                            |
| `deno task docs:build` | Build static docs to `docs/site/dist`           |

> **Warning:** `AUTH=off` and `AUTH=local` are for local development only. Never expose
> an instance with authentication disabled on the public internet.

## Environment Variables

Common variables for local development:

| Variable                      | Default / behavior                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `APP_BASE_PATH`               | `./dist/dev` in dev tasks; SQLite and logs live here                                |
| `PORT`                        | `6969` in dev, `6868` in production builds                                          |
| `AUTH`                        | `on` \| `local` \| `off` \| `oidc`                                                  |
| `PARSER_HOST` / `PARSER_PORT` | Parser service location (default host `localhost`, port `5000`)                     |
| `PRAXRR_DEFAULT_DB_URL`       | Defaults to `https://github.com/yandy-r/praxrr-db`; empty string disables auto-link |
| `PRAXRR_DEFAULT_DB_BRANCH`    | Default branch for auto-link (`main`)                                               |
| `PRAXRR_DEFAULT_DB_NAME`      | Display name for auto-linked database (`Praxrr-DB`)                                 |
| `PRAXRR_DEFAULT_DB_TOKEN`     | Optional PAT for private default repo — store as `REDACTED` in docs/examples        |
| `PRAXRR_SCHEMA_REF`           | Optional override for schema dependency resolution                                  |

Secret values (API keys, PATs, `ARR_CREDENTIAL_MASTER_KEY`) must never be committed.
Use environment files excluded from Git and rotate any exposed credentials.

## Docker Dev Tasks

| Task                               | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `deno task docker:dev:up`          | Build and run dev containers with watch |
| `deno task docker:dev:down`        | Stop dev containers                     |
| `deno task docker:arr:up`          | Start local Radarr/Sonarr for testing   |
| `deno task docker:dev:up:with-arr` | Dev stack plus Arr profile              |

See [Docker getting started](/getting-started/docker/) for compose topology and volume
mounts. Do not copy default compose passwords into production deployments.

## Code Generation

| Task                           | Output                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `deno task generate:api-types` | `packages/praxrr-app/src/lib/api/v1.d.ts` from OpenAPI        |
| `deno task generate:pcd-types` | `packages/praxrr-app/src/lib/shared/pcd/types.ts` from schema |

Contract-first workflow: update OpenAPI or schema first, generate types, then implement.

## Verification Before PRs

For application code changes:

```bash
deno task test
deno task lint
deno task check
```

For documentation-only changes, `deno task docs:build` and Prettier on changed paths are
the primary gates. See [Testing](/app/testing/) for test aliases and e2e prerequisites.

## Source References

- Task definitions: `deno.json`
- Dev launcher: `scripts/dev.ts`
- Contributor conventions: `CLAUDE.md`
- Config loader: `packages/praxrr-app/src/lib/server/utils/config/config.ts`

## Related

- [Getting Started](/getting-started/) — user installation
- [Testing](/app/testing/) — unit tests and e2e
- [Startup Sequence](/app/startup/) — server init order
- [Architecture Overview](/app/architecture/) — module map
- [Configuration Guide](/guides/configuration/) — user-facing env reference
