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
across any number of Arr instances (for example Radarr, Sonarr, and Lidarr) — with intelligent upgrade automation and
more on the way.

<p align="center">
  <img src="docs/site/src/assets/screenshots/hero.png" alt="Praxrr — quality profiles, score simulator, and sync history" width="100%">
</p>

## A Look Inside

<p align="center">
  <img src="docs/site/src/assets/screenshots/quality-profiles.png" alt="Quality profile catalog" width="100%">
  <br>
  <em>Browse every curated quality profile — target, codec and audio focus, expected sizes, and scored formats.</em>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/profile-scoring.png" alt="Per-app scoring">
      <p><b>Per-app scoring</b> — one scoring table drives Radarr, Sonarr, and Lidarr, with per-app scores.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/custom-formats.png" alt="Custom formats">
      <p><b>Custom formats</b> — tagged, app-scoped formats built from reusable conditions and shared regex.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/arr-sync.png" alt="Sync configuration">
      <p><b>Sync configuration</b> — pick profiles, delay profiles, and media settings per instance; sync manually, on pull, on change, or on a schedule.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/arr-library.png" alt="Library scoring">
      <p><b>Library scoring</b> — every file scored against its profile — see what meets the target, what can upgrade, and what gets rejected.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/score-simulator.png" alt="Score simulator">
      <p><b>Score simulator</b> — paste a release title and see parsed metadata, every format match, and the final score before anything is grabbed.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/quality-goals.png" alt="Quality goals">
      <p><b>Quality goals</b> — describe what you want in plain terms and preview the generated scores before applying them.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/sync-history.png" alt="Sync history">
      <p><b>Sync history</b> — every run recorded as an exportable audit entry with per-section outcomes.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/drift.png" alt="Drift detection">
      <p><b>Drift detection</b> — scheduled checks compare live Arr config with the resolved database state.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/parity-map.png" alt="Cross-Arr parity map">
      <p><b>Cross-Arr parity map</b> — see where Radarr, Sonarr, and Lidarr differ and how Praxrr handles each difference.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/site/src/assets/screenshots/database-commits.png" alt="Git-backed history">
      <p><b>Git-backed history</b> — browse commits, incoming changes, conflicts, tweaks, and snapshots for every linked database.</p>
    </td>
  </tr>
</table>

<p align="center">
  <b><a href="https://docs.praxrr.dev/getting-started/tour/">Take the full feature tour →</a></b>
</p>

## Features

### Core

- **Link** - Connect to configuration databases like the
  [Praxrr database](https://github.com/yandy-r/praxrr-db) or any Praxrr Compliant Database (PCD)
- **Bridge** - Add your Arr instances (for example Radarr, Sonarr, and Lidarr) by URL and API key
- **Sync** - Push configurations to your instances. Praxrr compiles everything to the right format
  automatically

### For Users

- **Ready-to-Use Configurations** - Stop spending hours piecing together settings from forum posts.
  Get complete, tested quality profiles, custom formats, and media settings designed around specific
  goals
- **Stay Updated** - Make local tweaks that persist across upstream updates. View changelogs, diffs,
  and revert changes when needed. Merge conflicts are handled transparently
- **Automated Upgrades** - Arr apps don't search for the best release, they grab the first RSS item
  that qualifies. Praxrr triggers intelligent searches based on filters and selectors

### Release Notes

- **Arr "Open in" links now support dual URL mode.** `url` remains the canonical backend API
  endpoint for Praxrr internal calls. Add `External URL` in Arr instance settings to set
  browser-facing link targets (for Docker/reverse-proxy deployments) without affecting API
  connectivity. Clear it to revert to canonical URL behavior.

### For Developers

- **Unified Architecture** - One configuration language that compiles to
  Arr app-specific formats on sync. No more maintaining separate configs for each app
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

> [!IMPORTANT] Reverse proxies and `AUTH=local`: forwarded headers (`X-Forwarded-For`, `X-Real-IP`,
> …) are trusted **only** from peers listed in `TRUSTED_PROXY` (unset by default). A direct deployment
> needs no change. If a reverse proxy fronts Praxrr under `AUTH=local`, set `TRUSTED_PROXY` to the
> proxy's address/CIDR so the real forwarded client is graded — otherwise Praxrr grades the proxy's own
> IP, which (on a private/LAN subnet) is itself "local", so **every** proxied request skips
> authentication. The proxy must also overwrite/strip client forwarded headers. This closes a
> spoofed-`X-Forwarded-For` bypass; see the
> [Trusted proxy guide](docs/site/src/content/docs/guides/configuration.md).

<!-- markdownlint-disable-next-line MD028 -->

> [!NOTE] Cross-origin mutations are rejected server-side: Praxrr enforces a runtime CSRF origin
> check (covering form and JSON bodies) in `packages/praxrr-app/src/lib/server/security/csrf.ts`.
> Behind a TLS-terminating reverse proxy, set `TRUSTED_PROXY` so the public origin (from
> `X-Forwarded-Proto`/`X-Forwarded-Host`) is accepted, and add any extra browser-reachable origins
> (different hostname, port, or alias) to `PRAXRR_TRUSTED_ORIGINS` (comma-separated). See the
> [Trusted proxy guide](docs/site/src/content/docs/guides/configuration.md).

## Documentation

- [Feature Tour](https://docs.praxrr.dev/getting-started/tour/) — visual walkthrough ([source](docs/site/src/content/docs/getting-started/tour.md))
- [Architecture Guide](docs/ARCHITECTURE.md)
- [Contributing Guide](docs/CONTRIBUTING.md)
- [Parser Service](packages/praxrr-parser/README.md)
- [Development and Release Guide](docs/DEVELOPMENT.md)
- [API v1 OpenAPI Spec](docs/api/v1/openapi.yaml)
- [Documentation Strategy Plan](docs/plans/documentation-strategy.md)

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
- [Go](https://go.dev/) 1.26.6 (optional, for parser development)

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

This runs the Go parser service and Vite dev server concurrently. See the
[parser service guide](packages/praxrr-parser/README.md) for its private four-route contract,
.NET-compatible regex behavior, and standalone/container operation, or
[CONTRIBUTING.md](docs/CONTRIBUTING.md) for the complete development workflow.

## Usage

1. Link a Praxrr Compliant Database (PCD) repository.
2. Bridge Arr instances.
3. Sync configuration changes from Praxrr to connected Arr instances.
4. Use [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
   for deeper implementation and release details.

### Environment Variables

| Variable                            | Default                                | Description                                                                                                                                   |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUID`                              | `1000`                                 | User ID for file permissions                                                                                                                  |
| `PGID`                              | `1000`                                 | Group ID for file permissions                                                                                                                 |
| `UMASK`                             | `022`                                  | File creation mask                                                                                                                            |
| `TZ`                                | `Etc/UTC`                              | Timezone for scheduling                                                                                                                       |
| `PORT`                              | `6868`                                 | Web UI port                                                                                                                                   |
| `HOST`                              | `0.0.0.0`                              | Bind address                                                                                                                                  |
| `APP_BASE_PATH`                     | `/config`                              | Base path for data, logs, backups                                                                                                             |
| `AUTH`                              | `on`                                   | Auth mode: `on`, `local`, `off`, `oidc`                                                                                                       |
| `PRAXRR_COOKIE_SECURE`              | `auto`                                 | Session cookie `Secure` flag: `auto` (Secure over direct HTTPS or trusted proxy), `on` (always Secure), `off` (never Secure)                  |
| `TRUSTED_PROXY`                     | _unset_                                | Reverse-proxy allowlist (IPv4/IPv6/CIDR + `loopback`/`private`/`*`). Forwarded headers honored only from these peers. See Trusted proxy docs. |
| `PARSER_HOST`                       | `localhost`                            | Parser service host                                                                                                                           |
| `PARSER_PORT`                       | `5000`                                 | Parser service port                                                                                                                           |
| `METRICS_ENABLED`                   | `false`                                | Expose Prometheus metrics at `/api/v1/metrics` (accepts `1`, `true`, `yes`, `on`; disabled returns 404)                                       |
| `PRAXRR_DEFAULT_DB_TOKEN`           | `your_token`                           | Default database token                                                                                                                        |
| `PRAXRR_DEFAULT_DB_GIT_USERNAME`    | `your_username`                        | Default database Git username                                                                                                                 |
| `PRAXRR_DEFAULT_DB_GIT_EMAIL`       | `your_email`                           | Default database Git email                                                                                                                    |
| `PRAXRR_DEFAULT_DB_URL`             | `https://github.com/yandy-r/praxrr-db` | Default PCD auto-link repository URL                                                                                                          |
| `PRAXRR_DEFAULT_DB_BRANCH`          | `main`                                 | Default PCD auto-link branch.                                                                                                                 |
| `PRAXRR_DEFAULT_DB_NAME`            | `Praxrr-DB`                            | Default PCD display name                                                                                                                      |
| `PRAXRR_SCHEMA_REF`                 | manifest value                         | Override schema dependency ref (tag or branch, e.g. `v2`, `dev`, `latest`, `1.0.0`)                                                           |
| `PRAXRR_VALIDATE_INSTANCES`         | `false`                                | Validate env-managed instances against Arr API during startup (optional).                                                                     |
| `PULL_ON_START`                     | `false`                                | Pull sync selections from Arr instances on startup (non-blocking background job).                                                             |
| `PULL_ON_START_MAX_CONCURRENCY`     | _unset_                                | Max concurrent Arr instance pulls (optional, positive integer).                                                                               |
| `PULL_ON_START_TIMEOUT_MS`          | _unset_                                | Per-instance pull timeout in milliseconds (optional, positive integer).                                                                       |
| `ARR_CREDENTIAL_MASTER_KEY`         | _required for Arr access_              | Base64-encoded 32-byte master key for AES-GCM encryption and HMAC fingerprinting                                                              |
| `ARR_CREDENTIAL_MASTER_KEY_VERSION` | _required for Arr access_              | Version label for the active master key, used for encryption and lookup                                                                       |
| `ARR_CREDENTIAL_PREVIOUS_KEYS`      | _unset_                                | Optional JSON map of previous versions to base64 keys for decryption during rotation                                                          |
| `RADARR_INSTANCE_URL_<N>`           | _unset_                                | `http://radarr:7878` (required with matching `RADARR_INSTANCE_API_KEY_<N>`)                                                                   |
| `RADARR_INSTANCE_API_KEY_<N>`       | _unset_                                | API key (required with matching `RADARR_INSTANCE_URL_<N>`)                                                                                    |
| `RADARR_INSTANCE_NAME_<N>`          | `Radarr`, `Radarr 2`...                | Optional display name                                                                                                                         |
| `RADARR_INSTANCE_EXTERNAL_URL_<N>`  | _unset_                                | Optional browser URL override                                                                                                                 |
| `RADARR_INSTANCE_TAGS_<N>`          | _unset_                                | Optional comma-separated tags                                                                                                                 |
| `RADARR_INSTANCE_ENABLED_<N>`       | `true`                                 | Optional, `true` or `false`                                                                                                                   |
| `SONARR_INSTANCE_URL_<N>`           | _unset_                                | `http://sonarr:8989` (required with matching `SONARR_INSTANCE_API_KEY_<N>`)                                                                   |
| `SONARR_INSTANCE_API_KEY_<N>`       | _unset_                                | API key (required with matching `SONARR_INSTANCE_URL_<N>`)                                                                                    |
| `SONARR_INSTANCE_NAME_<N>`          | _unset_                                | Optional display name                                                                                                                         |
| `SONARR_INSTANCE_EXTERNAL_URL_<N>`  | _unset_                                | Optional browser URL override                                                                                                                 |
| `SONARR_INSTANCE_TAGS_<N>`          | _unset_                                | Optional comma-separated tags                                                                                                                 |
| `SONARR_INSTANCE_ENABLED_<N>`       | `true`                                 | Optional, `true` or `false`                                                                                                                   |
| `LIDARR_INSTANCE_URL_<N>`           | _unset_                                | `http://lidarr:8686` (required with matching `LIDARR_INSTANCE_API_KEY_<N>`)                                                                   |
| `LIDARR_INSTANCE_API_KEY_<N>`       | _unset_                                | API key (required with matching `LIDARR_INSTANCE_URL_<N>`)                                                                                    |
| `LIDARR_INSTANCE_NAME_<N>`          | _unset_                                | Optional display name                                                                                                                         |
| `LIDARR_INSTANCE_EXTERNAL_URL_<N>`  | _unset_                                | Optional browser URL override                                                                                                                 |
| `LIDARR_INSTANCE_TAGS_<N>`          | _unset_                                | Optional comma-separated tags                                                                                                                 |
| `LIDARR_INSTANCE_ENABLED_<N>`       | `true`                                 | Optional, `true` or `false`                                                                                                                   |

### Arr environment-managed instance examples

Use indexed env vars to create instances automatically at startup:

```env
ARR_CREDENTIAL_MASTER_KEY=<base64_32byte_key>
ARR_CREDENTIAL_MASTER_KEY_VERSION=v1
# Optional for rotations; keep empty to disable
ARR_CREDENTIAL_PREVIOUS_KEYS='{"v0":"<base64_32byte_legacy_key>"}'

RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=REDACTED
RADARR_INSTANCE_NAME_1=Movies
RADARR_INSTANCE_TAGS_1=primary,4k

SONARR_INSTANCE_URL_1=http://sonarr:8989
SONARR_INSTANCE_API_KEY_1=REDACTED
SONARR_INSTANCE_NAME_1=TV
SONARR_INSTANCE_ENABLED_1=false

LIDARR_INSTANCE_URL_1=http://lidarr:8686
LIDARR_INSTANCE_API_KEY_1=REDACTED
PRAXRR_VALIDATE_INSTANCES=true
```

### Compose sample with env-managed instances

```yaml
services:
  praxrr:
    environment:
      - ARR_CREDENTIAL_MASTER_KEY=${PRAXRR_ARR_CREDENTIAL_MASTER_KEY} # required
      - ARR_CREDENTIAL_MASTER_KEY_VERSION=${PRAXRR_ARR_CREDENTIAL_MASTER_KEY_VERSION} # required
      - ARR_CREDENTIAL_PREVIOUS_KEYS=${PRAXRR_ARR_CREDENTIAL_PREVIOUS_KEYS} # optional
      - RADARR_INSTANCE_URL_1=http://radarr:7878
      - RADARR_INSTANCE_API_KEY_1=REDACTED
      - RADARR_INSTANCE_NAME_1=Movies
      - RADARR_INSTANCE_TAGS_1=4k,primary
      - SONARR_INSTANCE_URL_1=http://sonarr:8989
      - SONARR_INSTANCE_API_KEY_1=REDACTED
      - SONARR_INSTANCE_NAME_1=TV
      - SONARR_INSTANCE_ENABLED_1=true
      - LIDARR_INSTANCE_URL_1=http://lidarr:8686
      - LIDARR_INSTANCE_API_KEY_1=REDACTED
      - LIDARR_INSTANCE_NAME_1=Music
      - PRAXRR_DEFAULT_DB_BRANCH=latest
      - PRAXRR_SCHEMA_REF=latest
      - PRAXRR_VALIDATE_INSTANCES=false
```

## Monorepo Workspace Layout

Praxrr now uses a Deno workspace with its runtime application code (routes, lib, hooks, and UI) in
`packages/praxrr-app/src/` and these package members:

- `packages/praxrr-api` (legacy package surface)
- `packages/praxrr-db` (pcd_ops and base ops)
- `packages/praxrr-schema` (PCD schema SQL and manifest)

Runtime behavior, Arr sync workflows, and API surfaces now live under `packages/praxrr-app/src/`,
while the package members above are consumed through workspace references and mirror publishes.

## Contract Checklist

### Environment Variables

- [ ] `PRAXRR_DEFAULT_DB_URL` defaults to `https://github.com/yandy-r/praxrr-db` when unset.
- [ ] `PRAXRR_DEFAULT_DB_BRANCH` defaults to `main` when unset.
- [ ] `PRAXRR_DEFAULT_DB_NAME` defaults to `Praxrr-DB` when unset.
- [ ] `PRAXRR_SCHEMA_REF` optionally overrides the schema dependency ref (`tag` or `branch`) at
      runtime.
- [ ] `PRAXRR_DEFAULT_DB_TOKEN`, `PRAXRR_DEFAULT_DB_GIT_USERNAME`, and `PRAXRR_DEFAULT_DB_GIT_EMAIL`
      remain supported for git push/auth flows.
- [ ] Any custom DB fork used by default-link must be Arr/PCD schema-compatible and PCD
      manifest-valid.

### Empty URL Behavior

- [ ] `PRAXRR_DEFAULT_DB_URL=""` (empty string) disables startup auto-link.
- [ ] Empty URL behaves differently from unset/undefined: it is an intentional explicit opt-out, not
      a fallback.
- [ ] Auto-link state is still persisted as attempted/not-linked according to existing startup flow
      to avoid retries.

### Schema Source Precedence

- [ ] `scripts/generate-pcd-types.ts` resolves schema SQL using local-first precedence:
- [ ] `--local=<path>` (highest priority) takes absolute or repo-relative path from CLI.
- [ ] `packages/praxrr-schema/ops/0.schema.sql` is the implicit local default.
- [ ] `--remote` is only used when explicitly requested after local resolution.
- [ ] Missing local schema path fails fast with non-zero exit and clear error message.

### Mirror Governance

- [ ] `packages/praxrr-db` publishes to `yandy-r/praxrr-db` via subtree mirrors.
- [ ] `packages/praxrr-schema` publishes to `yandy-r/praxrr-schema` via subtree mirrors.
- [ ] Mirror repos are publish consumers only; the monorepo is the source of truth for cross-package
      changes.
- [ ] Changes touching PCD contracts should update workspace package inputs and root runtime
      together in one PR.
- [ ] Validate local compatibility before merge so DB/schema changes are compatible with existing
      sync and type-generation paths.

## License

[AGPL-3.0](LICENSE)

Praxrr is free and open source. You do not need to pay anyone to use it. If someone is charging you
for access to Praxrr, they are violating the spirit of this project.
