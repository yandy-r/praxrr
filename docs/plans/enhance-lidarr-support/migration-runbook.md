# Lidarr Media-Management Cutover: Migration Runbook

This runbook documents the operator steps for the Lidarr first-class media-management migration. It covers pre-checks, migration behavior, validation, and rollback procedures.

## Overview

Profilarr previously stored Lidarr media-management configurations (naming, media settings, quality definitions) in Sonarr-backed tables. This migration introduces dedicated `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions` tables and removes all Sonarr fallback behavior.

Migration is executed automatically via three ordered PCD base-op migrations that run during application startup:

| Migration                                             | Version  | Purpose                                                               |
| ----------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `20260215_add_lidarr_media_management_entities.sql`   | 20260215 | Create Lidarr tables; copy legacy Sonarr-backed rows                  |
| `20260216_enforce_native_lidarr_quality_mappings.sql` | 20260216 | Seed native Lidarr quality names; remove non-native mappings          |
| `20260217_set_lidarr_naming_defaults.sql`             | 20260217 | Normalize legacy Sonarr aliases; seed default Lidarr naming templates |

## Pre-Checks

Before upgrading to this version, verify the following:

### 1. Back Up the Application Database

```bash
cp profilarr.db profilarr.db.backup-$(date +%Y%m%d)
```

The PCD database is an in-memory SQLite cache rebuilt from `pcd_ops` on every compile. The important state to back up is the app database (`profilarr.db`) which stores `pcd_ops`, `arr_instances`, `arr_sync_media_management`, and `database_instances`.

### 2. Note Current Lidarr Sync Assignments

Record which Lidarr instances are assigned which naming, media-settings, and quality-definitions config names in the Sync Settings UI. These config names must exist in the new `lidarr_*` tables after migration for sync to resolve correctly.

```
Instance: <name>
  Naming config: <config_name>
  Media settings config: <config_name>
  Quality definitions config: <config_name>
```

### 3. Verify PCD Databases Are Accessible

Ensure all configured PCD database instances are reachable. Migration ops are inserted per database instance; inaccessible databases will skip migration and require manual re-trigger.

## Migration Behavior

### Automatic Execution

All three migrations run automatically on application startup as part of the standard migration pipeline. No manual SQL or CLI commands are needed.

### Idempotency

Each migration uses `ON CONFLICT ... DO NOTHING` for row insertion and `WHERE NOT EXISTS` guards for PCD ops insertion. Reruns produce stable, identical outcomes:

- Already-migrated rows remain unchanged
- Already-seeded ops are skipped
- No duplicate rows are created

### Conflict Handling

| Scenario                                                      | Behavior                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Lidarr row with same name already exists                      | Existing row preserved (`ON CONFLICT DO NOTHING`)                |
| Legacy Sonarr-named row (name = "Sonarr") in Lidarr table     | Renamed to "Lidarr" if "Lidarr" row does not exist; then deleted |
| Sonarr-derived naming patterns detected in default Lidarr row | Replaced with native Lidarr templates                            |
| Non-native quality mappings for `arr_type = 'lidarr'`         | Deleted; replaced with native Lidarr quality names               |

### Data Flow

1. **Migration 20260215**: Creates `lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions` tables. Copies rows from `sonarr_naming`, `sonarr_media_settings`, `sonarr_quality_definitions` into the new tables. Seeds Lidarr quality API mappings from Sonarr mappings.

2. **Migration 20260216**: Ensures all canonical Lidarr quality names exist in the `qualities` table. Removes non-native Lidarr quality API mappings (leftovers from Sonarr copy). Upserts native Lidarr mappings where `quality_name == api_name`. Normalizes legacy "Sonarr"-named rows to "Lidarr". Seeds default quality definitions for Lidarr if absent.

3. **Migration 20260217**: Normalizes any remaining "Sonarr"-named row in `lidarr_naming` to "Lidarr". Seeds the default Lidarr naming template if absent. Detects and replaces Sonarr-derived episode/series patterns in the default Lidarr naming row with native Lidarr track/artist patterns.

## Post-Migration Validation

After upgrading, verify the following:

### 1. Check Lidarr Entities Exist

Navigate to **Media Management** in the UI and filter by Lidarr. Verify that:

- At least one Lidarr naming config exists (default: "Lidarr")
- At least one Lidarr media settings config exists (default: "Lidarr")
- At least one Lidarr quality definitions config exists (default: "Lidarr")

### 2. Verify Sync Assignments

Navigate to **Settings > Instances** and check each Lidarr instance's sync configuration. Verify that the naming, media-settings, and quality-definitions config names from your pre-check notes still resolve. If a config name no longer exists (e.g., it was only in the Sonarr table and was not copied), create the missing Lidarr config or update the sync assignment.

### 3. Trigger a Test Sync

Run a manual sync for each Lidarr instance and verify:

- Sync completes without errors
- Logs show `Sync:Naming`, `Sync:MediaSettings`, and `Sync:QualityDefinitions` sources resolving from `lidarr_*` entity types
- No log messages reference Sonarr fallback or reuse behavior

### 4. Verify Quality Mappings

Navigate to a Lidarr quality definitions config and confirm that entries reference native Lidarr quality names (e.g., "FLAC", "MP3-320", "ALAC") rather than Sonarr/Radarr quality names.

### 5. Verify Naming Templates

Open the default Lidarr naming config and confirm that field values use Lidarr-native tokens:

- `standard_track_format` contains `{Artist Name}`, `{Album Title}`, `{Track Title}`
- `artist_folder_format` contains `{Artist Name}`, `{Artist MbId}`
- No fields contain Sonarr tokens like `{Series TitleYear}`, `S{season:00}E{episode:00}`

## Rollback Procedure

### Scenario: Migration Produces Unexpected Results

If the migration produces unexpected data but the application is otherwise functional:

1. Stop the application
2. Restore the backup: `cp profilarr.db.backup-YYYYMMDD profilarr.db`
3. Downgrade to the previous application version
4. Restart the application

### Scenario: Application Fails to Start After Migration

1. Stop the application
2. Restore the backup: `cp profilarr.db.backup-YYYYMMDD profilarr.db`
3. Downgrade to the previous application version
4. Report the startup error with full logs

### Scenario: Partial Migration (Some Databases Migrated, Others Not)

The migration is per-database-instance. If some databases were not migrated (e.g., due to inaccessibility during startup):

1. Ensure all PCD database instances are accessible
2. Restart the application -- the migration will run for remaining databases
3. The `seedBuiltInBaseOps` function ensures newly initialized databases also receive the migration ops

### Important Notes on Rollback

- The `down` migration removes the PCD ops entries from `pcd_ops` but does **not** drop the `lidarr_*` tables or delete migrated rows. This is by design: PCD cache is rebuilt from ops on compile, so removing the ops effectively reverts the cache state.
- Sonarr entity data is never modified or deleted by these migrations. Rolling back does not affect Sonarr configurations.
- After rollback, Lidarr sync assignments may reference config names that no longer resolve. Re-assign sync configs after rollback if needed.

## Troubleshooting

| Symptom                                          | Likely Cause                                                      | Resolution                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Lidarr sync fails with "config not found"        | Config name in sync assignment does not exist in `lidarr_*` table | Create the missing Lidarr config or update the sync assignment                            |
| Quality definitions sync skips all entries       | Missing or incomplete Lidarr quality API mappings                 | Verify `quality_api_mappings` has `arr_type = 'lidarr'` rows; restart to re-run migration |
| Naming config shows Sonarr episode tokens        | Migration 20260217 pattern detection did not match                | Manually edit the naming config to use Lidarr-native tokens                               |
| Duplicate config names between Sonarr and Lidarr | Expected: Lidarr tables are independent of Sonarr tables          | No action needed; each arr_type has its own namespace                                     |
| Migration runs but no Lidarr entities appear     | PCD cache not recompiled after ops insertion                      | Restart the application to trigger cache recompile                                        |
