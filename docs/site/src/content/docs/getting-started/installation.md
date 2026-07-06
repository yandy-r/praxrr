---
title: Installation
description: Install Praxrr with Docker, a prebuilt binary, or from source.
---

Praxrr ships as a Docker image, a compiled Deno binary, or a source checkout for
development. Pick the path that matches how you run your Arr stack.

## Prerequisites

All install paths need network access to your Arr instances and, when linking a
remote PCD, outbound Git or HTTPS access to the configuration repository.

- **Docker:** Docker Engine with Compose v2
- **From source:** [Git](https://git-scm.com/), [Deno](https://deno.com/) 2.x
- **Parser (optional):** [.NET SDK](https://dotnet.microsoft.com/) 8.0+ for
  custom format and quality profile testing only

## Docker (recommended)

Pull the develop channel image and mount a persistent config volume:

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
      - ARR_CREDENTIAL_MASTER_KEY=REDACTED
      - ARR_CREDENTIAL_MASTER_KEY_VERSION=v1
    depends_on:
      parser:
        condition: service_healthy

  parser:
    image: ghcr.io/yandy-r/praxrr-parser:develop
    container_name: praxrr-parser
    expose:
      - '5000'
```

The UI listens on port **6868** inside the container. Map host ports as needed.

> **Note:** The parser service is optional. Linking, syncing, and most features
> work without it. Remove the `parser` service and `PARSER_*` variables when you
> do not need CF or quality profile testing.

See [Docker deployment](./docker/) for compose files, volumes, and networking
details.

## Prebuilt binary

Stable releases publish to `ghcr.io/yandy-r/praxrr:latest`. Beta and develop
channels use `:beta` and `:develop` tags. See
[Upgrading](../guides/upgrading/) for channel semantics.

Set `APP_BASE_PATH` to the directory that holds Praxrr data (default `/config`
in Docker):

```bash
export APP_BASE_PATH=/path/to/praxrr-data
export PORT=6868
export ARR_CREDENTIAL_MASTER_KEY=REDACTED
export ARR_CREDENTIAL_MASTER_KEY_VERSION=v1
./praxrr
```

Praxrr stores the SQLite app database, PCD clones, logs, and backups under
`APP_BASE_PATH`.

## From source

Clone the monorepo and start the development launcher:

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

This runs the parser service and Vite dev server on port **6969**. Use
`deno task dev:noauth` when you want authentication disabled for local testing.

> **Warning:** `AUTH=off` and `deno task dev:noauth` disable login. Never expose
> those settings on untrusted networks. Prefer `AUTH=on` (default) or
> `AUTH=oidc` in production.

## Required secrets

Before bridging Arr instances, set credential encryption keys:

| Variable                            | Purpose                            |
| ----------------------------------- | ---------------------------------- |
| `ARR_CREDENTIAL_MASTER_KEY`         | Base64-encoded 32-byte AES-GCM key |
| `ARR_CREDENTIAL_MASTER_KEY_VERSION` | Version label for the active key   |

Store these in your secret manager or `.env` file. Never commit real keys to
Git.

## First login

With `AUTH=on` (default), create the initial admin account on first launch. API
access uses the `X-Api-Key` header or `?apikey=` query parameter after you
generate a key in settings.

## Next steps

- Follow the [Quick Start](./quick-start/) to link a PCD and sync your first
  profile.
- Read [Configuration](../guides/configuration/) for environment variables and
  auth modes.
