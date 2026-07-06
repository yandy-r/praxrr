---
title: Troubleshooting
description: Diagnose connectivity, sync, authentication, and configuration errors.
---

Use this guide for common operational issues. Check **Arr → {instance} → Logs**
and `APP_BASE_PATH/logs/app.log` for detailed error context.

## Cannot connect to Arr instance

**Symptoms:** Test connection fails, preview errors, or sync logs show HTTP
failures.

**Checks:**

1. **URL** — Use the hostname Praxrr resolves (Docker service name, not
   `localhost` from inside another container).
2. **API key** — Re-enter the key from Arr Settings → General. Confirm
   `ARR_CREDENTIAL_MASTER_KEY` has not changed without `ARR_CREDENTIAL_PREVIOUS_KEYS`.
3. **TLS / reverse proxy** — Canonical URL must reach the Arr API path. External
   URL affects browser links only.
4. **Firewall** — Allow traffic from the Praxrr container or host to Arr ports
   (`7878`, `8989`, `8686` by default).

Set `PRAXRR_VALIDATE_INSTANCES=true` temporarily to surface startup validation
errors for env-managed instances.

## Sync preview fails or shows unexpected deletes

**Symptoms:** Preview status `error`, or many delete actions you did not expect.

**Checks:**

1. Confirm sync selections still match profiles present in the PCD.
2. Pull the PCD and review **Changes** / **Conflicts** for unresolved user ops.
3. Compare preview section errors — quality profile preview requires readable
   remote custom formats and profiles.
4. Verify `arr_type` on each entity matches the instance app.

Re-run preview after resolving conflicts. Preview is read-only and safe to repeat.

## Sync succeeds but Arr looks wrong

**Symptoms:** Push reports success but scores or qualities differ from PCD.

**Checks:**

1. Confirm you synced the intended instance and section.
2. Open the profile in Arr UI — another profile or manual edit may still apply
   to media items.
3. Check for duplicate profile names on the Arr side from earlier manual imports.
4. Re-preview and inspect field-level diffs for scoring and cutoff fields.

## PCD pull or link failures

**Symptoms:** Database stuck out of date, Git errors, or missing entities.

**Checks:**

1. **Private repos** — Set `PRAXRR_DEFAULT_DB_TOKEN` and Git username/email.
2. **Local path sources** — Local PCD folders may not be Git repos; commit and
   changes pages degrade gracefully without Git metadata.
3. **Empty default URL** — `PRAXRR_DEFAULT_DB_URL=""` disables auto-link by design.
4. **Schema mismatch** — Align `PRAXRR_SCHEMA_REF` with the PCD manifest.

## Authentication issues

| Mode         | Common issue                                                         |
| ------------ | -------------------------------------------------------------------- |
| `AUTH=on`    | Reset password via admin flows; confirm session cookies reach the UI |
| `AUTH=oidc`  | Verify `OIDC_*` variables and redirect URIs                          |
| `AUTH=local` | Remember it skips auth only for local-network requests               |
| `AUTH=off`   | **Insecure** — anyone with network access can use the UI             |

> **Warning:** Do not run `AUTH=off` on the public internet. Pair with external
> auth (Authentik, Authelia) if you disable built-in login.

API clients need a valid API key header when auth is enabled.

## CSRF or origin errors behind a proxy

Praxrr may use permissive CSRF trusted origins during development. If forms fail
after tightening deployment:

1. Align the public URL with your reverse-proxy hostname.
2. Configure explicit trusted origins before production.
3. Confirm HTTPS termination preserves the `Host` header expected by the app.

## Parser / testing unavailable

**Symptoms:** Custom format testing fails; parser connection errors in logs.

**Checks:**

1. Parser container running and healthy.
2. `PARSER_HOST` matches the service name on your Docker network.
3. `PARSER_PORT=5000` unless you customized the parser image.

Sync and editing still work without the parser.

## Encrypted credential errors after upgrade

**Symptoms:** Instances show missing API keys or decryption failures.

**Checks:**

1. Same `ARR_CREDENTIAL_MASTER_KEY` as before upgrade, or valid
   `ARR_CREDENTIAL_PREVIOUS_KEYS` during rotation.
2. Restore from backup if the key was lost — encrypted blobs cannot be recovered
   without the original key.
3. Re-enter API keys in instance settings as a last resort.

## Database migration failures

**Symptoms:** Praxrr exits on startup or logs migration errors.

**Checks:**

1. Disk space and write permissions on `APP_BASE_PATH`.
2. Do not run older binaries against a database migrated by a newer version.
3. Restore backup and upgrade again after reviewing release notes.

## Getting more help

- [Architecture Overview](/app/architecture/) — module boundaries
- [Configuration](./configuration/) — environment reference
- [GitHub issues](https://github.com/yandy-r/praxrr/issues) — bug reports

Include Praxrr version, `arr_type`, sanitized logs, and steps to reproduce when
opening an issue. Never paste real API keys or master keys.
