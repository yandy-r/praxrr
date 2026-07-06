---
title: Quick Start
description: Link a PCD, connect an Arr instance, and run your first sync.
---

This walkthrough covers the core Praxrr workflow: **Link → Bridge → Sync**.
Complete it once to confirm your install, credentials, and network paths.

## Prerequisites

- A running Praxrr instance (see [Installation](./installation/))
- `ARR_CREDENTIAL_MASTER_KEY` and `ARR_CREDENTIAL_MASTER_KEY_VERSION` configured
- At least one Arr app (Radarr, Sonarr, or Lidarr) reachable from Praxrr
- An API key from the target Arr instance (Settings → General)

## Step 1 — Link a configuration database

Praxrr reads quality profiles, custom formats, and related settings from a
**Praxrr Compliant Database (PCD)**.

1. Open **Databases** in the sidebar.
2. Choose **Add database** and enter the Git URL (or local path) for your PCD.
3. Save. Praxrr clones the repository under `APP_BASE_PATH/data/databases` and
   compiles base ops into the in-memory PCD cache.

On first startup, Praxrr can auto-link the default PCD when
`PRAXRR_DEFAULT_DB_URL` is set (default:
`https://github.com/yandy-r/praxrr-db`). Set `PRAXRR_DEFAULT_DB_URL=""` to
disable auto-linking.

Optional Git credentials for private repos:

```env
PRAXRR_DEFAULT_DB_TOKEN=REDACTED
PRAXRR_DEFAULT_DB_GIT_USERNAME=your_username
PRAXRR_DEFAULT_DB_GIT_EMAIL=your_email@example.com
```

## Step 2 — Bridge an Arr instance

1. Open **Arr** → **Add instance**.
2. Select the app type (Radarr, Sonarr, or Lidarr).
3. Enter the **URL** Praxrr uses for API calls (for example
   `http://radarr:7878` inside Docker).
4. Paste the Arr **API key**.
5. Optionally set **External URL** for browser "Open in Arr" links when the
   public hostname differs from the internal API URL.
6. Click **Test connection**, then save.

You can also define instances at startup with indexed environment variables such
as `RADARR_INSTANCE_URL_1` and `RADARR_INSTANCE_API_KEY_1`. See
[Connecting Arr Instances](../guides/connecting-arr-instances/).

## Step 3 — Select profiles to sync

1. Open your instance → **Sync**.
2. Under **Quality Profiles**, enable the profiles you want from each linked
   PCD.
3. Configure sync triggers (`on_change`, `on_pull`, or scheduled cron) per
   section.
4. Save selections.

Repeat for delay profiles, media management, or metadata profiles when your
Arr app supports those surfaces.

## Step 4 — Preview and sync

1. On the same **Sync** page, open **Preview** to generate a read-only diff.
2. Review creates, updates, and deletes per section before applying changes.
3. Click **Sync now** (or wait for the configured trigger) to push compiled
   configuration to the Arr API.

Praxrr transforms PCD entities into Arr-specific payloads automatically. Custom
formats referenced by a quality profile sync together with that profile.

## Step 5 — Verify in Arr

Open the Arr app and confirm quality profiles and custom formats match your
expectations. Use Praxrr's **Open in** links (respecting External URL when set)
to jump directly to the remote UI.

## What happens under the hood

- **Base ops** come from the published PCD repository.
- **User ops** store your local overrides and persist across upstream pulls.
- The sync pipeline fetches compiled PCD state, transforms it per `arr_type`,
  and pushes through the Arr REST API.

## Next steps

- [Syncing Profiles](../guides/syncing-profiles/) — preview, dry-run, conflicts
- [Custom Formats](../guides/custom-formats/) — edit formats and shared regex
- [Quality Profiles](../guides/quality-profiles/) — scoring and qualities
- [Troubleshooting](../guides/troubleshooting/) — common setup errors
