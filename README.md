<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/praxrr-app/src/lib/client/assets/banner-light.svg">
    <source media="(prefers-color-scheme: light)" srcset="packages/praxrr-app/src/lib/client/assets/banner-dark.svg">
    <img alt="Praxrr" src="packages/praxrr-app/src/lib/client/assets/banner-dark.svg" width="500">
  </picture>
</p>

<br>

## What I'm Doing

<p align="center"><em>Media automation, perfected in practice.</em></p>

Praxrr is a management and automation platform for the \*arr ecosystem. Configure quality profiles,
custom formats, and media settings once in a Git-backed configuration database, then sync them
across any number of Radarr, Sonarr, and Lidarr instances — with intelligent upgrade automation and
more on the way.

## Features

### Core

- **Link** - Connect to configuration databases like the
  [Praxrr database](https://github.com/yandy-r/praxrr-db) or any Praxrr Compliant Database (PCD)
- **Bridge** - Add your Radarr, Sonarr, and Lidarr instances by URL and API key
- **Sync** - Push configurations to your instances. Praxrr compiles everything to the right format
  automatically

### For Users

- **Ready-to-Use Configurations** - Stop spending hours piecing together settings from forum posts.
  Get complete, tested quality profiles, custom formats, and media settings designed around specific
  goals
- **Stay Updated** - Make local tweaks that persist across upstream updates. View changelogs, diffs,
  and revert changes when needed. Merge conflicts are handled transparently
- **Automated Upgrades** - The arrs don't search for the best release, they grab the first RSS item
  that qualifies. Praxrr triggers intelligent searches based on filters and selectors

### Release Notes

- **Arr "Open in" links now support dual URL mode.** `url` remains the canonical backend API
  endpoint for Praxrr internal calls. Add `External URL` in Arr instance settings to set
  browser-facing link targets (for Docker/reverse-proxy deployments) without affecting API
  connectivity. Clear it to revert to canonical URL behavior.

### For Developers

- **Unified Architecture** - One configuration language that compiles to
  Radarr/Sonarr/Lidarr-specific formats on sync. No more maintaining separate configs for each app
- **Reusable Components** - Regular expressions are separate entities shared across custom formats.
  Change once, update everywhere
- **OSQL** - Configurations stored as append-only SQL operations. Readable, auditable, diffable.
  Git-native version control with complete history
- **Testing** - Validate regex patterns, custom format conditions, and quality profile behavior
  before syncing

### Authentication

- `AUTH=on` (default) - Username/password login required
- `AUTH=local` - Skip auth for local network requests
- `AUTH=oidc` - SSO via OpenID Connect provider
- `AUTH=off` - No authentication (use with external auth like Authentik/Authelia)

API access via `X-Api-Key` header or `?apikey=` query param. See
[auth docs](packages/praxrr-app/src/lib/server/utils/auth/README.md) for details.

> [!NOTE] CSRF origin checks are currently configured with a wildcard
> (`kit.csrf.trustedOrigins = ['*']`) to avoid proxy-origin mismatches during active development
> (for example when running behind Traefik or other reverse proxies with TLS termination). This is a
> temporary dev tradeoff and should be tightened to explicit trusted origin URLs before production
> deployment.

## Documentation

## Getting Started

### Production

```yaml
services:
  praxrr:
    image: ghcr.io/yandy-r/praxrr:develop
    container_name: praxrr
    ports:
      - '6868:6868'
    volumes:
      - ./config:/config
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
      - PARSER_HOST=parser
      - PARSER_PORT=5000
    depends_on:
      parser:
        condition: service_healthy

  # Optional - only needed for CF/QP testing
  parser:
    image: ghcr.io/yandy-r/praxrr-parser:develop
    container_name: praxrr-parser
    expose:
      - '5000'
```

> [!NOTE] The parser service is only required for custom format and quality profile testing.
> Linking, syncing, and all other features work without it. Remove the `parser` service and related
> environment variables if you don't need it.

### Development

#### Prerequisites

- [Git](https://git-scm.com/) (for PCD operations)
- [Deno](https://deno.com/) 2.x
- [.NET SDK](https://dotnet.microsoft.com/) 8.0+ (optional, for parser)

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

This runs the parser service and Vite dev server concurrently. See
[CONTRIBUTING.md](docs/CONTRIBUTING.md) for architecture documentation.

### Environment Variables

| Variable                         | Default                                | Description                                                               |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `PUID`                           | `1000`                                 | User ID for file permissions                                              |
| `PGID`                           | `1000`                                 | Group ID for file permissions                                             |
| `UMASK`                          | `022`                                  | File creation mask                                                        |
| `TZ`                             | `Etc/UTC`                              | Timezone for scheduling                                                   |
| `PORT`                           | `6868`                                 | Web UI port                                                               |
| `HOST`                           | `0.0.0.0`                              | Bind address                                                              |
| `APP_BASE_PATH`                  | `/config`                              | Base path for data, logs, backups                                         |
| `AUTH`                           | `on`                                   | Auth mode: `on`, `local`, `off`, `oidc`                                   |
| `PARSER_HOST`                    | `localhost`                            | Parser service host                                                       |
| `PARSER_PORT`                    | `5000`                                 | Parser service port                                                       |
| `PRAXRR_DEFAULT_DB_TOKEN`        | `your_token`                           | Default database token                                                    |
| `PRAXRR_DEFAULT_DB_GIT_USERNAME` | `your_username`                        | Default database Git username                                             |
| `PRAXRR_DEFAULT_DB_GIT_EMAIL`    | `your_email`                           | Default database Git email                                                |
| `PRAXRR_DEFAULT_DB_URL`          | `https://github.com/yandy-r/praxrr-db` | Default PCD auto-link repository URL                                      |
| `PRAXRR_DEFAULT_DB_BRANCH`       | `v2`                                   | Default PCD auto-link branch                                              |
| `PRAXRR_DEFAULT_DB_NAME`         | `Praxrr-DB`                            | Default PCD display name                                                  |
| `PRAXRR_SCHEMA_REF`              | manifest value                         | Override schema dependency ref (tag or branch, e.g. `v2`, `dev`, `1.0.0`) |

## Monorepo Workspace Layout

Praxrr now uses a Deno workspace with its runtime application code (routes, lib, hooks, and UI) in `packages/praxrr-app/src/` and these package members:

- `packages/praxrr-api` (legacy package surface)
- `packages/praxrr-db` (pcd_ops and base ops)
- `packages/praxrr-schema` (PCD schema SQL and manifest)

Runtime behavior, Arr sync workflows, and API surfaces now live under `packages/praxrr-app/src/`, while the package members above
are consumed through workspace references and mirror publishes.

## Contract Checklist

### Environment Variables

- [ ] `PRAXRR_DEFAULT_DB_URL` defaults to `https://github.com/yandy-r/praxrr-db` when unset.
- [ ] `PRAXRR_DEFAULT_DB_BRANCH` defaults to `v2` when unset.
- [ ] `PRAXRR_DEFAULT_DB_NAME` defaults to `Praxrr-DB` when unset.
- [ ] `PRAXRR_SCHEMA_REF` optionally overrides the schema dependency ref (`tag` or `branch`) at runtime.
- [ ] `PRAXRR_DEFAULT_DB_TOKEN`, `PRAXRR_DEFAULT_DB_GIT_USERNAME`, and
      `PRAXRR_DEFAULT_DB_GIT_EMAIL` remain supported for git push/auth flows.
- [ ] Any custom DB fork used by default-link must be Arr/PCD schema-compatible and PCD manifest-valid.

### Empty URL Behavior

- [ ] `PRAXRR_DEFAULT_DB_URL=""` (empty string) disables startup auto-link.
- [ ] Empty URL behaves differently from unset/undefined: it is an intentional explicit opt-out, not a fallback.
- [ ] Auto-link state is still persisted as attempted/not-linked according to existing startup flow to avoid retries.

### Schema Source Precedence

- [ ] `scripts/generate-pcd-types.ts` resolves schema SQL using local-first precedence:
- [ ] `--local=<path>` (highest priority) takes absolute or repo-relative path from CLI.
- [ ] `packages/praxrr-schema/ops/0.schema.sql` is the implicit local default.
- [ ] `--remote` is only used when explicitly requested after local resolution.
- [ ] Missing local schema path fails fast with non-zero exit and clear error message.

### Mirror Governance

- [ ] `packages/praxrr-db` publishes to `yandy-r/praxrr-db` via subtree mirrors.
- [ ] `packages/praxrr-schema` publishes to `yandy-r/praxrr-schema` via subtree mirrors.
- [ ] Mirror repos are publish consumers only; the monorepo is the source of truth for cross-package changes.
- [ ] Changes touching PCD contracts should update workspace package inputs and root runtime together in one PR.
- [ ] Validate local compatibility before merge so DB/schema changes are compatible with existing sync and type-generation paths.

## License

[AGPL-3.0](LICENSE)

Praxrr is free and open source. You do not need to pay anyone to use it. If someone is charging you
for access to Praxrr, they are violating the spirit of this project.
