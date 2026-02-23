# Lidarr Media-Management Cutover: Migration Runbook

This runbook documents the operator steps for the Lidarr first-class media-management migration. It covers pre-checks, migration behavior, validation, and rollback procedures.

## Overview

Praxrr previously stored Lidarr media-management configurations (naming, media settings, quality definitions) in Sonarr-backed tables. This migration introduces dedicated `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions` tables and removes all Sonarr fallback behavior.

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
cp praxrr.db praxrr.db.backup-$(date +%Y%m%d)
```

The PCD database is an in-memory SQLite cache rebuilt from `pcd_ops` on every compile. The important state to back up is the app database (`praxrr.db`) which stores `pcd_ops`, `arr_instances`, `arr_sync_media_management`, and `database_instances`.

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

## Hybrid Migration Rollout (Task 3.3)

For deterministic phase progression, complete the Task 3.4 rollout checklist before each phase transition:

`docs/plans/pcd-data-migration/rollout-checklist.md`

### Phased rollout

1. **Phase 0 — SQL-only baseline**

- Keep `PRAXRR_PCD_MIGRATION_MODE=sql-only` for one maintenance window.
- Capture baseline `pcd_ops`, `pcd_op_history`, `job_queue`, and `job_run_history` counts.

2. **Phase 1 — Canaries**
   - Enable `PRAXRR_PCD_MIGRATION_MODE=hybrid` for one low-risk database.
   - Keep `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK=true`.
   - Validate startup success, compile success, and no unexpected fallback logs.
3. **Phase 2 — Controlled rollout**
   - Expand to a small subset of production databases using the same checks.
   - Confirm sync trigger behavior and history visibility are consistent.
4. **Phase 3 — Full rollout**
   - Expand to all remaining databases after two stable checkpoints.
   - Decide whether to keep legacy fallback enabled as a guardrail.

### Preflight checks

1. Backup app DB:

```bash
cp praxrr.db praxrr.db.backup-$(date +%Y%m%d)
```

2. Validate migration mode:

```bash
echo "PRAXRR_PCD_MIGRATION_MODE=$PRAXRR_PCD_MIGRATION_MODE"
echo "PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK=$PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK"
```

3. Capture baseline rows:

```sql
SELECT database_id, origin, source, state, COUNT(*) AS ops
FROM pcd_ops
GROUP BY database_id, origin, source, state
ORDER BY database_id, origin, source;

SELECT database_id, status, COUNT(*) AS rows
FROM pcd_op_history
GROUP BY database_id, status
ORDER BY database_id, status;
```

4. Confirm sync queue baselines:

```sql
SELECT job_type, status, COUNT(*) AS rows
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;
```

### Guard verification checkpoints

#### Ingestion checkpoint

After each phase change:

- **Expected logs**
  - `Imported base ops from repo` (`PCDImporter`)
  - `Cache compiled for "<instance>"` (`PCDManager`)
  - No immediate `Hybrid base-op ingestion failed; falling back to SQL-only path` for the phase target unless explicitly approved.
- **Expected history**
  - New or updated base rows in `pcd_ops` for the target database.
  - Latest `pcd_op_history` rows for that database are primarily `applied`.
- **Expected command**

```sql
SELECT h.id, h.op_id, h.status, h.rowcount, h.conflict_reason, h.applied_at
FROM pcd_op_history h
WHERE h.database_id = :databaseId
ORDER BY h.applied_at DESC, h.id DESC
LIMIT 200;
```

#### Value-guard checkpoint

- Verify conflict signals are scoped and intentional:

```sql
SELECT h.id, h.op_id, h.status, h.conflict_reason, h.error, h.details, h.applied_at
FROM pcd_op_history h
WHERE h.database_id = :databaseId
  AND h.status IN ('conflicted', 'conflicted_pending', 'error')
ORDER BY h.applied_at DESC, h.id DESC
LIMIT 200;
```

- Any unexpected rows in this set before advancing phase requires holding rollout and investigating the failing payload.

#### Sync trigger checkpoint

- Confirm event-trigger jobs are deduplicated and queued for active Lidarr/Arr instances:

```sql
SELECT id, job_type, status, json_extract(payload, '$.instanceId') AS instance_id, dedupe_key, run_at
FROM job_queue
WHERE dedupe_key LIKE 'arr.sync.%:event:%'
  OR job_type = 'arr.sync.mediaManagement'
ORDER BY run_at DESC
LIMIT 200;
```

- Confirm completion state in job run history:

```sql
SELECT queue_id, job_type, status, started_at, finished_at, duration_ms
FROM job_run_history
ORDER BY started_at DESC
LIMIT 200;
```

### Rollback criteria for hybrid rollout

Pause rollout and rollback to SQL-only immediately if any are observed in the same phase:

1. Repeated startup/import failure logs:
   - `Failed to import base ops...`
   - `Failed to compile PCD cache`
2. New unexpected conflict/error rows in `pcd_op_history`.
3. Missing or duplicate evented `arr.sync.*` jobs for a database after a migration run.
4. Post-migration UI behavior regresses (for example, Lidarr sync assignments resolve to fallback names or missing `lidarr_*` entities).

For immediate rollback:

1. Set `PRAXRR_PCD_MIGRATION_MODE=sql-only`.
2. Restart the application.
3. Restore `praxrr.db.backup-YYYYMMDD` if business impact requires.

## Rollback Procedure

### Scenario: Migration Produces Unexpected Results

If the migration produces unexpected data but the application is otherwise functional:

1. Stop the application
2. Restore the backup: `cp praxrr.db.backup-YYYYMMDD praxrr.db`
3. Downgrade to the previous application version
4. Restart the application

### Scenario: Application Fails to Start After Migration

1. Stop the application
2. Restore the backup: `cp praxrr.db.backup-YYYYMMDD praxrr.db`
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
