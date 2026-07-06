---
title: Docker
description: Run Praxrr with Docker Compose, volumes, networking, and optional parser.
---

Docker is the recommended way to run Praxrr alongside Radarr, Sonarr, and
Lidarr. The repository ships production and development compose files you can
adapt to your stack.

## Production compose

The root `compose.yml` maps host port **6969** to container port **6868** and
mounts `./config` to `/config`:

```bash
docker compose up -d
```

Key environment variables in the sample file:

| Variable                    | Example              | Notes                     |
| --------------------------- | -------------------- | ------------------------- |
| `APP_BASE_PATH`             | `/config`            | Implicit via volume mount |
| `PRAXRR_DEFAULT_DB_URL`     | GitHub URL or empty  | Auto-link on startup      |
| `ARR_CREDENTIAL_MASTER_KEY` | `REDACTED`           | Required for Arr API keys |
| `RADARR_INSTANCE_URL_1`     | `http://radarr:7878` | Docker network hostname   |

Pass secrets through a `.env` file or your orchestrator. Do not commit real API
keys or master keys.

## Development compose

Build from source with live rebuild watches:

```bash
docker compose -f compose.dev.yml --profile dev up --build --watch
```

The dev profile bind-mounts optional local `packages/praxrr-db` and
`packages/praxrr-schema` paths for PCD and schema development.

Start local Arr containers for integration testing:

```bash
docker compose -f compose.dev.yml --profile arr up -d lidarr radarr sonarr
```

Dev Arr services expose host ports `17878`, `18989`, and `18686` mapped to the
standard Arr API ports inside the network.

## Volumes

Mount a persistent volume at `/config` (or set `APP_BASE_PATH` accordingly).
Praxrr stores:

| Path under base   | Contents                |
| ----------------- | ----------------------- |
| `data/praxrr.db`  | App SQLite database     |
| `data/databases/` | Cloned PCD repositories |
| `logs/`           | Application logs        |
| `backups/`        | Backup archives         |

Use matching `PUID`, `PGID`, and `UMASK` values so the container user can write
to the mounted directory.

## Networking

- **Internal API URL:** Set instance URLs to Docker service names (for example
  `http://praxrr-radarr:7878`) so Praxrr reaches Arr over the compose network.
- **External URL:** Set `RADARR_INSTANCE_EXTERNAL_URL_1` (or the Sonarr/Lidarr
  equivalents) when browser links should use a public hostname or reverse-proxy
  path. API traffic still uses the canonical URL field.
- **Parser:** When enabled, set `PARSER_HOST` to the parser service name
  (`parser` in production, `parser-dev` in dev compose) and `PARSER_PORT=5000`.

## Parser opt-in

Custom format testing and quality profile simulation require the optional
`praxrr-parser` container. Minimal production stacks can omit it:

```yaml
services:
  praxrr:
    image: ghcr.io/yandy-r/praxrr:develop
    ports:
      - '6868:6868'
    volumes:
      - ./config:/config
    environment:
      - ARR_CREDENTIAL_MASTER_KEY=REDACTED
      - ARR_CREDENTIAL_MASTER_KEY_VERSION=v1
```

Without a parser, linking and syncing continue to work.

## Pull on startup

Optionally import sync selections from Arr when Praxrr starts:

```env
PULL_ON_START=true
PULL_ON_START_MAX_CONCURRENCY=2
PULL_ON_START_TIMEOUT_MS=30000
```

This runs as a non-blocking background job and reconstructs which profiles are
already present on each instance.

## Validate instances at startup

Set `PRAXRR_VALIDATE_INSTANCES=true` to ping each env-managed instance during
startup. Useful in CI or after rotating API keys.

## Next steps

- [Installation](./installation/) — binary and source paths
- [Configuration](../guides/configuration/) — full environment reference
- [Connecting Arr Instances](../guides/connecting-arr-instances/) — URL modes
