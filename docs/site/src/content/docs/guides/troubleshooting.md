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

1. Confirm the Praxrr app itself is healthy at `GET /api/v1/health`.
2. From inside the same private network namespace as Praxrr, call the parser's
   `GET /health`. A healthy response includes `status: "healthy"` and a behavior
   version. Do not expose this private route through your public proxy.
3. For Docker, confirm the parser container is healthy, `PARSER_HOST` matches its
   Compose service name, and `PARSER_PORT=5000`.
4. For a standalone archive, confirm `praxrr-parser` (`praxrr-parser.exe` on
   Windows) is adjacent to the app binary and executable. Remove an accidental
   `PARSER_HOST` override to restore automatic child-process startup.
5. For a source checkout, run `mise install` and `deno task dev:parser`; the
   repository pins Go 1.26.5.

Sync and editing still work without the parser.

### Parser response classes

Use HTTP status and sanitized log fields such as `outcome` and `error_class`; do
not log or share raw release titles, patterns, request bodies, or regex engine
errors.

| Status | Meaning                                                                          | Recovery                                                            |
| ------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `400`  | Malformed JSON or missing/invalid required fields                                | Correct the request.                                                |
| `413`  | A measured request, text, pattern, count, unique-key, or work limit was exceeded | Reduce the input; do not repeatedly retry the same payload.         |
| `415`  | The request is not JSON                                                          | Send `application/json` or `application/*+json`.                    |
| `503`  | Active-request or matcher capacity is temporarily full                           | Honor `Retry-After: 1` and retry with backoff.                      |
| `500`  | Unexpected internal parser failure                                               | Capture sanitized logs, restart once, then roll back if it repeats. |

Regex timeouts are finite and fail closed for the affected pattern; they do not
make the parser process unhealthy. Rework catastrophic patterns instead of
raising limits. The compatibility contract remains .NET-compatible regex syntax,
even though the current service is implemented in Go.

### Parser recovery and rollback

1. Record the current app release, parser image or archive checksum, and parser
   behavior version from private `/health`.
2. Restart the parser without deleting parser caches. Same-version entries remain
   usable; misses are not filled until health succeeds.
3. If a new parser version is faulty, deploy the previous immutable image digest
   or restore the matching previous standalone archive. Do not roll back with a
   moving tag.
4. Verify private parser `/health`, then exercise one parse and one match through
   the Praxrr UI. Cache namespaces change with behavior versions, so old and new
   results cannot mix.
5. If recovery still fails, omit the parser and keep Praxrr online while collecting
   sanitized diagnostics; linking, editing, and syncing are unaffected.

Release provenance contains the exact artifact checksums, SBOM, behavior version,
and immutable rollback identifiers. Use those records rather than reconstructing
an old runtime from source.

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
- [Startup Sequence](/app/startup/) — init order and fail-fast steps
- [Sync Pipeline](/app/sync-pipeline/) — preview vs execution internals
- [PCD System](/app/pcd-system/) — ops compiler and value guards
- [Job System](/app/jobs/) — background queue and dispatcher
- [Configuration](/guides/configuration/) — environment reference
- [GitHub issues](https://github.com/yandy-r/praxrr/issues) — bug reports

Include Praxrr version, `arr_type`, sanitized logs, and steps to reproduce when
opening an issue. Never paste real API keys or master keys.
