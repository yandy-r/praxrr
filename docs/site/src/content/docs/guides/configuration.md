---
title: Configuration
description: Environment variables, data paths, PCD defaults, and authentication modes.
---

Praxrr reads configuration from environment variables at startup. The singleton
in `packages/praxrr-app/src/lib/server/utils/config/config.ts` resolves paths,
auth mode, parser URL, and Arr credential keys before the app database opens.

## Data paths

`APP_BASE_PATH` controls where Praxrr stores runtime data. In Docker, mount a
volume at `/config` and leave the default in place.

| Subpath           | Purpose                     |
| ----------------- | --------------------------- |
| `data/praxrr.db`  | Application SQLite database |
| `data/databases/` | Linked PCD clones           |
| `logs/app.log`    | Structured application log  |
| `backups/`        | Backup output               |

When `APP_BASE_PATH` is unset, Praxrr uses the directory containing the
executable.

## Server and scheduling

| Variable                  | Default                 | Description                  |
| ------------------------- | ----------------------- | ---------------------------- |
| `PORT`                    | `6868`                  | Web UI and API port          |
| `HOST`                    | `0.0.0.0`               | Bind address                 |
| `TZ`                      | `Etc/UTC`               | Timezone for cron and logs   |
| `PUID` / `PGID` / `UMASK` | `1000` / `1000` / `022` | File ownership in containers |

## Parser service

| Variable      | Default     | Description     |
| ------------- | ----------- | --------------- |
| `PARSER_HOST` | `localhost` | Parser hostname |
| `PARSER_PORT` | `5000`      | Parser port     |

Praxrr builds the parser URL as `http://{PARSER_HOST}:{PARSER_PORT}`. Omit the
parser entirely when you do not need release-title testing.

## PCD defaults

| Variable                   | Default                                | Description                    |
| -------------------------- | -------------------------------------- | ------------------------------ |
| `PRAXRR_DEFAULT_DB_URL`    | `https://github.com/yandy-r/praxrr-db` | Auto-link on first run         |
| `PRAXRR_DEFAULT_DB_BRANCH` | `main`                                 | Branch to clone                |
| `PRAXRR_DEFAULT_DB_NAME`   | `Praxrr-DB`                            | Display name                   |
| `PRAXRR_SCHEMA_REF`        | manifest value                         | Override schema dependency ref |

Set `PRAXRR_DEFAULT_DB_URL=""` (empty string) to **disable** auto-linking. An
empty value is an intentional opt-out, not a fallback to another URL.

For local schema development:

```env
PRAXRR_SCHEMA_LOCAL_PATH=/schema
```

Git credentials for private PCD repos:

```env
PRAXRR_DEFAULT_DB_TOKEN=REDACTED
PRAXRR_DEFAULT_DB_GIT_USERNAME=your_username
PRAXRR_DEFAULT_DB_GIT_EMAIL=your_email@example.com
```

## Arr credentials

Arr API keys are encrypted at rest. These variables are **required** before
Praxrr can store or use instance credentials:

| Variable                            | Description                        |
| ----------------------------------- | ---------------------------------- |
| `ARR_CREDENTIAL_MASTER_KEY`         | Base64-encoded 32-byte master key  |
| `ARR_CREDENTIAL_MASTER_KEY_VERSION` | Active key version label           |
| `ARR_CREDENTIAL_PREVIOUS_KEYS`      | Optional JSON map for key rotation |

Treat the master key like any other secret. Load it from a secret manager or
`.env` file excluded from version control.

## Startup behavior

| Variable                        | Default | Description                     |
| ------------------------------- | ------- | ------------------------------- |
| `PRAXRR_VALIDATE_INSTANCES`     | `false` | Validate env-managed instances  |
| `PULL_ON_START`                 | `false` | Pull sync selections on startup |
| `PULL_ON_START_MAX_CONCURRENCY` | unset   | Parallel pull limit             |
| `PULL_ON_START_TIMEOUT_MS`      | unset   | Per-instance timeout            |

## Authentication modes

| Mode         | Behavior                             |
| ------------ | ------------------------------------ |
| `AUTH=on`    | Username/password login (default)    |
| `AUTH=local` | Skip auth for local network requests |
| `AUTH=oidc`  | SSO via OpenID Connect               |
| `AUTH=off`   | No authentication                    |

> **Warning:** `AUTH=off` and `AUTH=local` weaken access controls. Use them
> only behind trusted reverse proxies or on isolated lab networks. Prefer
> `AUTH=on` or `AUTH=oidc` in production.

OIDC requires `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`.

API automation uses the `X-Api-Key` header or `?apikey=` query parameter.

## CSRF note

During active development, SvelteKit CSRF trusted origins may include a wildcard
to tolerate reverse-proxy hostname mismatches. Tighten trusted origins to
explicit URLs before production deployment.

## Env-managed Arr instances

Define instances without using the UI:

```env
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=REDACTED
RADARR_INSTANCE_NAME_1=Movies
RADARR_INSTANCE_EXTERNAL_URL_1=https://radarr.example.com
```

Equivalent indexed variables exist for Sonarr and Lidarr. See
[Connecting Arr Instances](./connecting-arr-instances/).

## Next steps

- [Docker](../getting-started/docker/) — compose examples
- [Syncing Profiles](./syncing-profiles/) — triggers and preview
- [Troubleshooting](./troubleshooting/) — misconfiguration symptoms
