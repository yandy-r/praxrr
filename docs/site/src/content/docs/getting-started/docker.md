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

Or run the full dev stack (Praxrr, parser, Arr, and TSDProxy):

```bash
docker compose -f compose.dev.yml --profile dev --profile arr up --build --watch
```

### Tailscale access (dev compose)

The dev compose file does **not** publish host ports. Instead,
[TSDProxy](https://almeidapaulopt.github.io/tsdproxy/) exposes services over
HTTPS on your Tailscale tailnet. All hostnames are prefixed with `praxrr` to
avoid collisions.

#### First-time setup

```bash
mkdir -p .tsdproxy/config .tsdproxy/data
cp docker/tsdproxy.yaml.example .tsdproxy/config/tsdproxy.yaml
```

Optionally set `tailscale.providers.default.authKey` in `.tsdproxy/config/tsdproxy.yaml`
for unattended (headless) Tailscale authentication. Otherwise, authenticate
interactively through the TSDProxy dashboard.

#### Tailscale hostnames

Replace `<tailnet>` with your tailnet name (for example `my-tailnet`):

| Service            | Tailscale name    | URL                                        |
| ------------------ | ----------------- | ------------------------------------------ |
| Praxrr UI          | `praxrr-dev`      | `https://praxrr-dev.<tailnet>.ts.net`      |
| TSDProxy dashboard | `praxrr-tsdproxy` | `https://praxrr-tsdproxy.<tailnet>.ts.net` |
| Radarr             | `praxrr-radarr`   | `https://praxrr-radarr.<tailnet>.ts.net`   |
| Sonarr             | `praxrr-sonarr`   | `https://praxrr-sonarr.<tailnet>.ts.net`   |
| Lidarr             | `praxrr-lidarr`   | `https://praxrr-lidarr.<tailnet>.ts.net`   |

#### Authenticating proxies

After starting the stack:

1. Open `https://praxrr-tsdproxy.<tailnet>.ts.net` from a device on your
   tailnet.
2. Sign in to Tailscale if prompted.
3. Approve each proxy card for the services you want to expose.

The parser service (`parser-dev`) remains internal-only. Praxrr reaches it over
the Docker network at `parser-dev:5000`; it is not proxied to Tailscale.

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
  path. In dev compose, uncomment the Tailscale URL hints in `compose.dev.yml`
  (for example `https://praxrr-radarr.<your-tailnet>.ts.net`). API traffic
  still uses the canonical URL field.
- **Parser:** When enabled, set `PARSER_HOST` to the parser service name
  (`parser` in production, `parser-dev` in dev compose) and `PARSER_PORT=5000`.

### Behind a reverse proxy

When a reverse proxy fronts Praxrr, set `TRUSTED_PROXY` to the proxy's address
as Praxrr sees it so forwarded client IPs are honored (and spoofed ones from
other peers are ignored). On a shared compose network that is the proxy
container's subnet; use `loopback` if the proxy runs on the same host.

```yaml
services:
  praxrr:
    image: ghcr.io/yandy-r/praxrr:latest
    environment:
      - AUTH=local
      - TRUSTED_PROXY=172.18.0.0/16 # the compose network the proxy sits on
```

Leaving `TRUSTED_PROXY` unset is safe (the default) but, under `AUTH=local`
behind a proxy, every request is then graded by the proxy's own IP and must
authenticate. See the [Trusted proxy](/guides/configuration/#trusted-proxy)
guide for the full grammar and failure behavior.

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
