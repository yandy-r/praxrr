<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/lib/client/assets/banner-light.svg">
    <source media="(prefers-color-scheme: light)" srcset="src/lib/client/assets/banner-dark.svg">
    <img alt="Praxrr" src="src/lib/client/assets/banner-dark.svg" width="500">
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
[auth docs](src/lib/server/utils/auth/README.md) for details.

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

| Variable                         | Default         | Description                             |
| -------------------------------- | --------------- | --------------------------------------- |
| `PUID`                           | `1000`          | User ID for file permissions            |
| `PGID`                           | `1000`          | Group ID for file permissions           |
| `UMASK`                          | `022`           | File creation mask                      |
| `TZ`                             | `Etc/UTC`       | Timezone for scheduling                 |
| `PORT`                           | `6868`          | Web UI port                             |
| `HOST`                           | `0.0.0.0`       | Bind address                            |
| `APP_BASE_PATH`                  | `/config`       | Base path for data, logs, backups       |
| `AUTH`                           | `on`            | Auth mode: `on`, `local`, `off`, `oidc` |
| `PARSER_HOST`                    | `localhost`     | Parser service host                     |
| `PARSER_PORT`                    | `5000`          | Parser service port                     |
| `PRAXRR_DEFAULT_DB_TOKEN`        | `your_token`    | Default database token                  |
| `PRAXRR_DEFAULT_DB_GIT_USERNAME` | `your_username` | Default database Git username           |
| `PRAXRR_DEFAULT_DB_GIT_EMAIL`    | `your_email`    | Default database Git email              |

## License

[AGPL-3.0](LICENSE)

Praxrr is free and open source. You do not need to pay anyone to use it. If someone is charging you
for access to Praxrr, they are violating the spirit of this project.
