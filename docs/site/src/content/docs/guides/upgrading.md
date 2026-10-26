---
title: Upgrading
description: Upgrade Praxrr between release channels and handle database migrations.
---

Praxrr uses semantic versioning and Docker release channels. Plan upgrades so
your `APP_BASE_PATH` data, encrypted Arr credentials, and PCD links survive
the transition.

## Release channels

| Channel | Docker tag | Trigger               | Stability |
| ------- | ---------- | --------------------- | --------- |
| Develop | `:develop` | Every push to `main`  | Unstable  |
| Beta    | `:beta`    | `v*-beta.*` tag       | Testing   |
| Stable  | `:latest`  | `v*` tag (no `-beta`) | Stable    |

Version pins such as `:v2.1.0` are also published for immutable deployments.

Stable releases target Wednesdays after at least one week in beta without major
issues. See the development guide in the repository for tagging workflow.

## Upgrade steps (Docker)

1. Back up the `APP_BASE_PATH` volume (at minimum `data/praxrr.db` and
   `data/databases/`).
2. Pull the new image tag:

```bash
docker compose pull praxrr
docker compose up -d
```

3. Watch container logs for migration output on first startup.
4. Open the UI and confirm linked PCDs and Arr instances remain connected.
5. Run **Sync Preview** on critical instances before applying changes.

## Upgrade steps (binary)

1. Stop the running process.
2. Back up `APP_BASE_PATH`.
3. Replace the executable with the new build.
4. Start Praxrr with the same environment variables (especially
   `ARR_CREDENTIAL_MASTER_KEY` and version).
5. Verify migrations completed via logs.

## Database migrations

Praxrr runs SQLite migrations automatically during startup
(`hooks.server.ts` sequence: config → staged restore → database → migrations → PCD → jobs).

- App schema changes live in `packages/praxrr-app/src/lib/server/db/migrations/`.
- Do not downgrade to an older Praxrr version after migrations advance without
  restoring a backup.
- PCD schema updates may require a compatible `PRAXRR_SCHEMA_REF` or local schema
  path when developing against custom forks.

## Credential key rotation

When rotating `ARR_CREDENTIAL_MASTER_KEY`:

1. Set `ARR_CREDENTIAL_PREVIOUS_KEYS` to a JSON map of old version → base64 key.
2. Deploy the new `ARR_CREDENTIAL_MASTER_KEY` and `ARR_CREDENTIAL_MASTER_KEY_VERSION`.
3. Re-save or re-import Arr instance API keys if decryption errors appear in logs.

Never commit master keys to Git.

## PCD compatibility

After upgrading, pull linked PCD repositories so base ops match the expected
schema. If type generation or sync fails, confirm your PCD fork matches the
Praxrr release's schema manifest.

Set `PRAXRR_SCHEMA_REF` to pin a known-good schema tag when running curated
stacks (for example `latest` or a release tag).

## Sessions after upgrade

Migration `20261026` deletes every session whose stored id is not already a SHA-256 hex
digest. Cookies issued before that migration no longer match, so everyone must sign in
again. Later sliding renewals keep the same cookie value and only refresh its expiry.

Before downgrading below that migration, run `DELETE FROM sessions`. Older builds treat
`sessions.id` as the cookie value, so a stored hash would be a valid bearer.

## OIDC sign-in

`AUTH=oidc` refuses a new sign-in unless an allowlist is set or `OIDC_ALLOW_ALL_USERS` is
enabled. See [Configuration](./configuration/). The first OIDC boot on this behavior, and
any later change to the effective allowlist, signs out OIDC sessions. API tokens are
separate; review them in **Settings → Security** before upgrading.

## In-app backup restore

**Settings → Backups** does not replace the live database immediately. It stages the
archive. Restart Praxrr to apply it. The previous `data/` directory is kept as
`data.pre-restore-*`. Copying a backup over the open SQLite files is not the in-app path.

## Rollback

If an upgrade fails:

1. Stop Praxrr.
2. Restore the backed-up `APP_BASE_PATH` directory.
3. Redeploy the previous Docker tag or binary version.
4. Investigate logs before retrying.

## Next steps

- [Configuration](./configuration/) — environment reference
- [Troubleshooting](./troubleshooting/) — post-upgrade errors
- [Architecture Overview](/app/architecture/) — startup sequence detail
