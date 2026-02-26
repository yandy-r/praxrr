# PCD Data Migration Runbook

This runbook documents operator checks for the completed YAML-only PCD ingestion model.
Runtime base data ingestion is now YAML-only (`entities/`), with SQL used only for schema/tweak bootstrap
layers (`deps/schema/ops`, repo `tweaks/`).

## Post-cutover operator verification (current)

- Confirm startup/build and sync behavior after cutover are stable.
- Confirm schema/tweak SQL inputs still load and compile with legacy compatibility.
- Confirm no rollback signals appear in `pcd_op_history` after startup and manual checks.

### Preconditions

- A writable app database backup is available.
- Deployed runtime includes YAML-only ingestion changes.
- Logging and admin access to the app DB is available for direct queries.
- At least one linked Arr instance has a known-good baseline sync.

### Verification checklist

1. Confirm linked databases are enabled and discoverable:

   ```sql
   SELECT id, name, enabled
   FROM database_instances
   WHERE enabled = 1
   ORDER BY id;
   ```

2. Confirm operation and history health is stable after startup:

   ```sql
   SELECT database_id, origin, source, state, COUNT(*) AS op_count
   FROM pcd_ops
   GROUP BY database_id, origin, source, state
   ORDER BY database_id, origin, source, state;
   ```

   ```sql
   SELECT h.batch_id,
     h.status,
     COUNT(*) AS status_count
   FROM pcd_op_history h
   WHERE h.applied_at >= datetime('now', '-30 minutes')
   GROUP BY h.batch_id, h.status
   ORDER BY h.batch_id, h.status;
   ```

3. Confirm queue and run health is healthy:

   ```sql
   SELECT job_type, status, COUNT(*) AS job_count
   FROM job_queue
   GROUP BY job_type, status;

   SELECT job_type, status, COUNT(*) AS run_count
   FROM job_run_history
   GROUP BY job_type, status;
   ```

4. Execute one controlled startup + sync roundtrip for a low-risk database and confirm results are bounded and successful.

5. If sustained `error` / `failed` / conflict spikes appear after startup or sync, stop expanding scope and open an incident before enabling additional instances.

## Historical migration-mode guidance (archival)

The sections below are preserved for historical context only. They describe the pre-cutover
`PRAXRR_PCD_MIGRATION_MODE` / SQL fallback process and should not be used for current operations.

### Historical objectives

- Make YAML entity files the canonical base data source at startup.
- Keep SQL ops available as transitional artifacts and fallback-only input.
- Preserve existing runtime semantics (`pcd_ops` -> cache rebuild -> sync queue).
- Make migration outcomes visible through `pcd_ops`, `pcd_op_history`, and job tables.
- Define explicit guard-failure and rollback behavior before broad rollout.

### Historical preconditions

- A writable app database backup is available.
- Feature branch/commit containing migration changes is deployed in staging first.
- Operators know the active conflict strategy (`override`, `align`, or `ask`) for the target instances.
- Logging and admin access to the app DB is available for direct queries.

### Historical runtime mode controls

- Default rollout mode: `PRAXRR_PCD_MIGRATION_MODE=hybrid`
- Transitional fallback (optional): `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK=true`
- SQL-only emergency override: `PRAXRR_PCD_MIGRATION_MODE=sql-only`

### Historical preflight checks (before each rollout phase)

1. Backup each environment database

   ```bash
   cp praxrr.db praxrr.db.backup-$(date +%F-%H%M%S)
   ```

2. Confirm linked databases are reachable and syncable

   ```sql
   SELECT id, name, enabled
   FROM database_instances
   WHERE enabled = 1
   ORDER BY id;
   ```

3. Capture baseline operation/state counts

   ```sql
   SELECT database_id, origin, source, state, COUNT(*) AS op_count
   FROM pcd_ops
   GROUP BY database_id, origin, source, state
   ORDER BY database_id, origin, source, state;
   ```

4. Confirm baseline compile history is clean

   ```sql
   SELECT database_id,
          status,
          COUNT(*) AS history_count
   FROM pcd_op_history
   GROUP BY database_id, status
   ORDER BY database_id, status;
   ```

5. Confirm queue and sync health is normal before change

   ```sql
   SELECT job_type, status, COUNT(*) AS job_count
   FROM job_queue
   GROUP BY job_type, status;

   SELECT job_type, status, COUNT(*) AS run_count
   FROM job_run_history
   GROUP BY job_type, status;
   ```

### Historical phased rollout

#### Historical phase 1 — Staging validation

1. Run migration path in staging only.
2. Execute a small representative portable import/export pair in staging.
3. Apply checkpoints below and verify no unexpected guard failures.
4. Promote to production only if all checkpoints pass for at least one full
   `pcd.sync` cycle.

#### Historical phase 2 — One-database canary

1. Enable migration inputs for a single non-critical PCD database.
2. Run a full startup/import/build cycle and one manual sync for one Arr instance.
3. Pause before additional databases until guard checks pass.

#### Historical phase 3 — Controlled pilot

1. Extend to 10-20% of databases or one low-risk tenant group.
2. Confirm no spike in:
   - guard conflicts,
   - error history rows,
   - in-flight sync failures.
3. Keep rollback artifact available (current backup and previous release image).

#### Historical phase 4 — General rollout

1. Enable migration inputs across remaining databases.
2. Continue monitoring every hour for the first three cycles.
3. If any blocker is hit, pause and revert to rollback path immediately.

### Historical validation checkpoints

#### Historical Checkpoint A — Compile and import health

- Confirm imports/builds for the target database produce expected statuses:

  ```sql
  SELECT h.batch_id,
         h.status,
         COUNT(*) AS status_count
  FROM pcd_op_history h
  WHERE h.applied_at >= datetime('now', '-30 minutes')
  GROUP BY h.batch_id, h.status
  ORDER BY h.batch_id, h.status;
  ```

- `status` should be primarily `applied` and `skipped`.
- Any unexpected `error` rows require immediate block.
- Conflicts should be reviewed at the batch level before proceeding.

#### Historical Checkpoint B — Value-guard confirmation

1. Inspect blocking conflicts:

   ```sql
   SELECT p.id AS op_id,
          p.filename,
          p.source,
          p.metadata,
          h.status,
          h.conflict_reason,
          h.error,
          h.details
   FROM pcd_op_history h
   JOIN pcd_ops p ON p.id = h.op_id
   WHERE h.applied_at >= datetime('now', '-30 minutes')
     AND h.status IN ('conflicted', 'conflicted_pending', 'error')
   ORDER BY h.applied_at DESC;
   ```

2. Validate that `conflict_reason` values are expected for your configured strategy:
   `duplicate_key`, `missing_target`, `guard_mismatch`, `aligned`.
3. For any new `error`, correlate with the same operation `filename` and migration metadata
   and decide whether it is a migration input bug or existing data divergence.

#### Historical Checkpoint C — Sync and queue behavior

1. Ensure one-time sync enqueue behavior remains bounded:

   ```sql
   SELECT job_type, status, COUNT(*) AS run_count
   FROM job_queue
   WHERE created_at >= datetime('now', '-30 minutes')
     AND job_type IN ('pcd.sync', 'arr.sync', 'arr.sync.qualityProfiles', 'arr.sync.delayProfiles', 'arr.sync.mediaManagement', 'arr.sync.metadataProfiles')
   GROUP BY job_type, status
   ORDER BY job_type, status;
   ```

2. Inspect run outcomes:

   ```sql
   SELECT job_type, status, COUNT(*) AS run_count
   FROM job_run_history
   WHERE started_at >= datetime('now', '-30 minutes')
     AND job_type IN ('pcd.sync', 'arr.sync', 'arr.sync.qualityProfiles', 'arr.sync.delayProfiles', 'arr.sync.mediaManagement', 'arr.sync.metadataProfiles')
   GROUP BY job_type, status
   ORDER BY job_type, status;
   ```

3. Validate sync configs move as expected:

   ```sql
   SELECT 'qualityProfiles' AS section, sync_status, COUNT(*) AS cfg_count FROM arr_sync_quality_profiles_config
   UNION ALL
   SELECT 'delayProfiles', sync_status, COUNT(*) FROM arr_sync_delay_profiles_config
   UNION ALL
   SELECT 'mediaManagement', sync_status, COUNT(*) FROM arr_sync_media_management
   UNION ALL
   SELECT 'metadataProfiles', sync_status, COUNT(*) FROM arr_sync_metadata_profiles_config;
   ```

4. Treat any sustained rise in `failed`/`running` queues or `arr.sync` failures as a rollback signal.

### Historical guard failure handling

If any of these conditions appear, stop new migration enablement and execute rollback
immediately for the affected release scope:

- `pcd_op_history` has `error` rows for the migration window.
- `conflicted_pending` appears and the instance conflict strategy is not expected to pause.
- Any migration batch has unexpected high conflict volume (`conflicted` + `conflicted_pending`
  beyond baseline).
- `pcd_cache` build causes repeated startup disable events (`database_instances.enabled = 0`).
- `pcd.sync` or `arr.sync` jobs fail repeatedly for the same targets.

When handling blocked operations:

1. Record all `pcd_ops` and `pcd_op_history` rows for failed batches.
2. Check application logs around:
   - `Failed to build PCD cache`
   - `Recorded op conflict`
   - `Recorded op conflict (full-list mismatch)`
3. Capture operation payload, metadata, and payload names in the incident thread.
4. If not correctable within rollout window, move to rollback path.

### Historical rollback

#### Historical App-level / partial rollback

1. Disable migration input path/flag used for this rollout window.
2. Restore `pcd_ops` and queue state from the latest baseline backup:

   ```bash
   cp praxrr.db.backup-YYYYMMDDHHMMSS praxrr.db
   ```

3. Restart application and confirm startup has no immediate `Failed to build PCD cache`.
4. Re-check:
   - `SELECT COUNT(*) FROM database_instances WHERE enabled = 0;`
   - `SELECT status, COUNT(*) FROM pcd_op_history WHERE applied_at >= datetime('now','-1 hour') GROUP BY status;`

#### Historical Version rollback

1. Keep same DB backup in place and revert to prior application version.
2. Restart with migration disabled.
3. Re-run preflight checks and confirm `arr.sync`/`pcd.sync` jobs return to baseline rates.

### Historical ongoing monitoring (first 48 hours)

Run hourly during rollout and then daily for 1 week:

1. `pcd_op_history` conflict and error trend (windowed 1h and 24h).
2. `pcd_op_history` top failure rows by `op_id` and `conflict_reason`.
3. `job_queue` growth and status distribution for sync/job types.
4. `job_run_history` failure counts and durations.
5. `database_instances` `enabled` flag and any fresh `startup disable` events.
6. User-visible behavior in import/export and UI selection (portable entities available
   at expected names after migration runs).
