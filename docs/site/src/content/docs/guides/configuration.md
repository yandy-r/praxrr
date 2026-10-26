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

`backup.create` puts a `VACUUM INTO` snapshot of `praxrr.db` in the archive and leaves out
the live database file and its `-wal`, `-shm`, and `-journal` sidecars. **Settings → Backups**
restore only stages that archive. The next process start swaps it in before opening the
database and keeps the previous `data/` directory as `data.pre-restore-*`. If startup aborts
because `data/` is missing, move that `data.pre-restore-*` directory back to `data/` and
restart.

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

## Observability

| Variable          | Default | Description                                        |
| ----------------- | ------- | -------------------------------------------------- |
| `METRICS_ENABLED` | `false` | Expose `/api/v1/metrics` (Prometheus text format). |

Accepts `1`, `true`, `yes`, or `on`. When disabled, `/api/v1/metrics`
returns 404. See [Metrics](./metrics/).

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

### OIDC endpoint transport

The discovery URL (`OIDC_DISCOVERY_URL`) and the authorization, token, and JWKS
endpoints its discovery document advertises must use `https`. Plain `http` is
accepted only for loopback hosts (`localhost`, `127.x.x.x`, `::1`); any other `http`
endpoint is refused and sign-in fails. Shield Check checks the discovery URL and
those three advertised endpoints and reports any that are insecure.

Praxrr sends a PKCE (`S256`) challenge and a per-login `nonce`, and verifies each ID
token's signature against the provider's JWKS (`jwks_uri`) before trusting any claim.
Supported algorithms are RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA; tokens
signed with `none`, HMAC (`HS*`) or any other algorithm are rejected, as are tokens
whose `nonce` claim is missing or does not match the login that started the flow.

### Restricting which OIDC identities may sign in

By default Praxrr now restricts OIDC sign-in to an operator-configured allowlist
(fail-closed). Set at least one of these variables, or explicitly opt out:

| Variable                | Default  | Description                                                                         |
| ----------------------- | -------- | ----------------------------------------------------------------------------------- |
| `OIDC_ALLOWED_SUBJECTS` | unset    | Comma- or newline-separated `sub` claims allowed to sign in                         |
| `OIDC_ALLOWED_EMAILS`   | unset    | Verified email addresses and/or `@domain.com` entries allowed to sign in            |
| `OIDC_ALLOWED_GROUPS`   | unset    | Exact group names (from the top-level ID-token claim) allowed to sign in            |
| `OIDC_GROUPS_CLAIM`     | `groups` | Top-level ID-token claim from which groups are read; dotted paths are not supported |
| `OIDC_ALLOW_ALL_USERS`  | unset    | Opt-out: accept every identity the provider authenticates                           |

Matching rules:

- **Subject** — exact, case-sensitive match against the ID token's `sub` claim.
- **Email** — the provider must mark the email `email_verified: true` (boolean) or
  `email_verified: 'true'` (string). Addresses match case-insensitively for ASCII
  letters only (no Unicode case folding in the local part), and the domain is
  compared in punycode form, so `@bücher.example` matches `xn--bcher-kva.example`
  and vice versa. `@domain.com` entries match the domain part exactly (no
  subdomain matching).
- **Groups** — the groups claim may be a single string or an array; any overlap
  with the configured list allows sign-in.
- When any list is set, the lists alone decide (the opt-out is ignored).
- When **no** list is set and `OIDC_ALLOW_ALL_USERS` is not enabled, every new
  OIDC sign-in is refused with 403 — a missing allowlist never becomes
  "allow everyone".

All three allowlist variables accept comma- or newline-separated entries. Spaces
inside an entry are preserved, so group names such as `Praxrr Admins` work; do not
use spaces alone as separators. `OIDC_GROUPS_CLAIM` names only a **top-level ID
token claim** (default `groups`): dotted claim paths and userinfo claims are not
read. Praxrr requests the `openid email profile` scopes; a provider-side mapper
may also be required to emit the configured groups claim in the ID token. Never
use user-editable `name` or `preferred_username` values as allowlist identities.
For multi-tenant providers, prefer stable subject and/or group restrictions over
email domains, because a domain alone does not establish tenant membership.

> **Upgrade note:** before this behavior shipped, any identity your provider
> authenticated became an administrator. After upgrading, set an allowlist (or
> `OIDC_ALLOW_ALL_USERS=true` to keep the old behavior) — otherwise **new**
> sign-ins are refused. Users are signed out on the first boot of the upgraded
> version and whenever the allowlist policy changes; an identity refused by the
> current policy loses its sessions. Before upgrading, review and revoke API
> tokens that should no longer have access in **Settings → Security**. Also
> restrict who can use this client in your provider (realm/client restrictions)
> so the control does not depend on Praxrr alone.

Example:

```env
OIDC_ALLOWED_EMAILS=you@example.com,@yourdomain.com
OIDC_ALLOWED_GROUPS=praxrr-admins
```

Malformed entries (for example an `@domain` without a dot) never grant access
and are surfaced by Shield Check.

Mode boundaries: OIDC and local accounts are separate identities. Under `AUTH=oidc`,
password login and first-run setup are disabled and the OIDC endpoints are the only way
in; in other modes the OIDC endpoints return 404. Sessions created in the other mode are
cleared at startup, and switching back to `AUTH=on` restores local (password) access.

API automation uses the `X-Api-Key` header or `?apikey=` query parameter. Create a named
token under **Settings → Security**. The value is shown once and starts with `prx_`. Tokens
authenticate `/api/v1/*` only.

## Trusted proxy

`TRUSTED_PROXY` is an explicit, opt-in allowlist of reverse-proxy addresses.
Forwarded request headers (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`,
…) are honored **only** when the direct socket peer is on this list. It is
**unset (disabled) by default** — a direct deployment sends no forwarded headers
and needs no change.

Why it matters: without an allowlist, any client can forge
`X-Forwarded-For: 127.0.0.1` to look local. Under `AUTH=local` that spoof
previously bypassed authentication entirely. With `TRUSTED_PROXY` set, a forged
header from an untrusted peer is ignored and the request is graded by its real
socket peer.

### Value grammar

Comma- and/or whitespace-separated tokens:

| Token        | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `10.0.0.2`   | A single IPv4 address (implicit `/32`)                      |
| `::1`        | A single IPv6 address (implicit `/128`)                     |
| `10.0.0.0/8` | An IPv4 CIDR range                                          |
| `fc00::/7`   | An IPv6 CIDR range                                          |
| `loopback`   | Expands to `127.0.0.0/8`, `::1/128`                         |
| `private`    | RFC1918 + ULA + link-local ranges (flagged as overly broad) |
| `*` or `all` | Trust every peer — legacy behavior, flagged as overly broad |

Example: `TRUSTED_PROXY=172.18.0.0/16, ::1` trusts a docker-network proxy pool
and an IPv6 loopback proxy.

### Failure behavior (fail-closed)

- **Malformed tokens never grant trust.** An invalid entry (e.g. `999.0.0.0/8`,
  `10.0.0.0/33`) is dropped and surfaced by Shield Check; the rest still parse.
- A wholly-invalid value behaves exactly like unset (trust nobody). Parsing
  **never throws**, so a typo cannot brick startup — Shield Check reports it
  with an actionable fix instead.
- `*` / `all` and supernets `≤ /7` are flagged as overly broad by Shield Check.

### Reverse-proxy examples

nginx passes the observed client as the last `X-Forwarded-For` hop:

```nginx
location / {
  proxy_pass http://praxrr:6868;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Traefik and Caddy append the client to `X-Forwarded-For` automatically. In all
cases, set `TRUSTED_PROXY` to the proxy's address as Praxrr sees it (its
container IP / CIDR on the shared docker network, or `loopback` if the proxy
runs on the same host).

The trusted proxy **must overwrite or strip** the client-supplied forwarded
headers (all of `X-Forwarded-For`, `X-Real-IP`, `X-Client-IP`,
`CF-Connecting-IP`, `Fastly-Client-IP`, `True-Client-IP`, `X-Cluster-Client-IP`).
Praxrr consults `X-Forwarded-For` first and cannot distinguish a proxy-set value
from a forged one the proxy forwarded untouched. `$proxy_add_x_forwarded_for`
appends the real client, so the value is safe; a config that sets only
`X-Real-IP` while passing the client's raw `X-Forwarded-For` through would let a
forged `X-Forwarded-For` win.

### `AUTH=local` behind a proxy

Under `AUTH=local`, do **not** leave `TRUSTED_PROXY` unset behind a reverse
proxy. Praxrr would grade every request by the direct peer — the proxy's own IP
— and because a reverse proxy usually sits on a private/LAN subnet, that IP is
itself "local", so **every** proxied request (including remote clients) skips
authentication. Setting `TRUSTED_PROXY` to the proxy makes Praxrr grade the real
forwarded client: remote clients authenticate, LAN clients keep the intended
local bypass. The Security Posture surfaces the unset case as the
`proxy_trust_missing` advisory.

## CSRF protection

Mutating browser requests (POST/PUT/PATCH/DELETE with form or JSON bodies) are rejected with 403
when the `Origin` header is present and does not match an expected origin. Requests without an
`Origin` header (curl, API keys, server-to-server) pass through to authentication as before.

Expected origins are, in order:

1. The listener origin (what Praxrr itself serves, e.g. `http://praxrr:6868`).
2. The public origin from `X-Forwarded-Proto`/`X-Forwarded-Host` — honored **only** when the
   direct peer is a `TRUSTED_PROXY`-allowlisted reverse proxy. Set `TRUSTED_PROXY` to the proxy's
   address (or `loopback` when it runs on the same host) so the proxied origin is accepted.
3. The explicit allowlist in `PRAXRR_TRUSTED_ORIGINS` — a comma-separated list of extra
   browser-reachable origins, e.g. `PRAXRR_TRUSTED_ORIGINS=https://praxrr.lan,https://praxrr.tailnet`.
   Malformed entries are dropped without bricking boot.

Example nginx setup (from the Trusted proxy section above): with `TRUSTED_PROXY` pointing at the
proxy, `proxy_set_header X-Forwarded-Proto $scheme` makes the proxy-visible `https://…` origin
accepted automatically; only genuinely different hostnames need `PRAXRR_TRUSTED_ORIGINS`. The proxy
**must overwrite** `X-Forwarded-Host`/`X-Forwarded-Proto` (not append); Praxrr reads the first
token, so an appended client-supplied value would win.

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
