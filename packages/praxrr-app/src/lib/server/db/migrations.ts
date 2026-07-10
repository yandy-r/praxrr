import { logger } from '$logger/logger.ts';
import { db } from './db.ts';

// Static imports for all migrations
import { migration as migration001 } from './migrations/001_create_arr_instances.ts';
import { migration as migration002 } from './migrations/002_remove_sync_profile.ts';
import { migration as migration003 } from './migrations/003_create_log_settings.ts';
import { migration as migration004 } from './migrations/004_create_jobs_tables.ts';
import { migration as migration005 } from './migrations/005_create_backup_settings.ts';
import { migration as migration006 } from './migrations/006_simplify_log_settings.ts';
import { migration as migration007 } from './migrations/007_create_notification_tables.ts';
import { migration as migration008 } from './migrations/008_create_database_instances.ts';
import { migration as migration009 } from './migrations/009_add_personal_access_token.ts';
import { migration as migration010 } from './migrations/010_add_is_private.ts';
import { migration as migration011 } from './migrations/011_create_upgrade_configs.ts';
import { migration as migration012 } from './migrations/012_add_upgrade_last_run.ts';
import { migration as migration013 } from './migrations/013_add_upgrade_dry_run.ts';
import { migration as migration014 } from './migrations/014_create_ai_settings.ts';
import { migration as migration015 } from './migrations/015_create_arr_sync_tables.ts';
import { migration as migration016 } from './migrations/016_add_should_sync_flags.ts';
import { migration as migration017 } from './migrations/017_create_regex101_cache.ts';
import { migration as migration018 } from './migrations/018_create_app_info.ts';
import { migration as migration019 } from './migrations/019_default_log_level_debug.ts';
import { migration as migration020 } from './migrations/020_create_tmdb_settings.ts';
import { migration as migration021 } from './migrations/021_create_parsed_release_cache.ts';
import { migration as migration022 } from './migrations/022_add_next_run_at.ts';
import { migration as migration023 } from './migrations/023_create_pattern_match_cache.ts';
import { migration as migration024 } from './migrations/024_create_arr_rename_settings.ts';
import { migration as migration025 } from './migrations/025_add_rename_notification_mode.ts';
import { migration as migration026 } from './migrations/026_create_upgrade_runs.ts';
import { migration as migration027 } from './migrations/027_create_rename_runs.ts';
import { migration as migration028 } from './migrations/028_simplify_delay_profile_sync.ts';
import { migration as migration029 } from './migrations/029_add_database_id_foreign_keys.ts';
import { migration as migration030 } from './migrations/030_create_general_settings.ts';
import { migration as migration031 } from './migrations/031_remove_search_cooldown.ts';
import { migration as migration032 } from './migrations/032_add_filter_id_to_upgrade_runs.ts';
import { migration as migration033 } from './migrations/033_create_github_cache.ts';
import { migration as migration034 } from './migrations/034_add_sync_status.ts';
import { migration as migration035 } from './migrations/035_add_job_skipped_status.ts';
import { migration as migration036 } from './migrations/036_create_auth_tables.ts';
import { migration as migration037 } from './migrations/037_add_session_metadata.ts';
import { migration as migration038 } from './migrations/038_add_media_management_config_names.ts';
import { migration as migration039 } from './migrations/039_create_setup_state.ts';
import { migration as migration040 } from './migrations/040_add_local_ops_enabled.ts';
import { migration as migration041 } from './migrations/041_create_pcd_ops.ts';
import { migration as migration042 } from './migrations/042_create_pcd_op_history.ts';
import { migration as migration043 } from './migrations/043_add_git_identity_to_database_instances.ts';
import { migration as migration044 } from './migrations/044_add_conflict_strategy_to_database_instances.ts';
import { migration as migration045 } from './migrations/045_delay_profile_sync_use_name.ts';
import { migration as migration046 } from './migrations/046_quality_profile_sync_use_name.ts';
import { migration as migration047 } from './migrations/047_create_arr_database_namespaces.ts';
import { migration as migration048 } from './migrations/048_fix_sync_database_foreign_keys.ts';
import { migration as migration049 } from './migrations/049_create_job_queue.ts';
import { migration as migration050 } from './migrations/050_create_user_interface_preferences.ts';
import { migration as migration20260215 } from './migrations/20260215_add_lidarr_media_management_entities.ts';
import { migration as migration20260216ArrInstanceExternalUrl } from './migrations/20260216_add_arr_instance_external_url.ts';
import { migration as migration20260216 } from './migrations/20260216_enforce_native_lidarr_quality_mappings.ts';
import { migration as migration20260217 } from './migrations/20260217_set_lidarr_naming_defaults.ts';
import { migration as migration20260218 } from './migrations/20260218_add_lidarr_metadata_profiles.ts';
import { migration as migration20260219 } from './migrations/20260219_seed_default_lidarr_metadata_profile.ts';
import { migration as migration20260220AddArrInstanceSource } from './migrations/20260220_add_arr_instance_source.ts';
import { migration as migration20260221EncryptArrApiKeys } from './migrations/20260221_encrypt_arr_api_keys.ts';
import { migration as migration20260222EncryptDatabasePat } from './migrations/20260222_encrypt_database_pat.ts';
import { migration as migration20260223CreateStartupPullRuns } from './migrations/20260223_create_startup_pull_runs.ts';
import { migration as migration20260224NormalizeNamingCharacterReplacementDefaults } from './migrations/20260224_normalize_naming_character_replacement_defaults.ts';
import { migration as migration20260225RemoveEmbeddedLidarrSeedOps } from './migrations/20260225_remove_embedded_lidarr_seed_ops.ts';
import { migration as migration20260226CreateTrashGuideTables } from './migrations/20260226_create_trash_guide_tables.ts';
import { migration as migration20260227NormalizeTrashGuideTrashIds } from './migrations/20260227_normalize_trash_guide_trash_ids.ts';
import { migration as migration20260228CreatePcdSnapshots } from './migrations/20260228_create_pcd_snapshots.ts';
import { migration as migration20260706CreateUserComplexityTiers } from './migrations/20260706_create_user_complexity_tiers.ts';
import { migration as migration20260707AddSetupWizardState } from './migrations/20260707_add_setup_wizard_state.ts';
import { migration as migration20260708AddArrInstanceDetectedVersion } from './migrations/20260708_add_arr_instance_detected_version.ts';
import { migration as migration20260709CreateDriftTables } from './migrations/20260709_create_drift_tables.ts';
import { migration as migration20260710CreateSyncHistoryTables } from './migrations/20260710_create_sync_history_tables.ts';
import { migration as migration20260711CreateQualityGoalBindings } from './migrations/20260711_create_quality_goal_bindings.ts';
import { migration as migration20260712ExtendPcdSnapshotTriggerRollback } from './migrations/20260712_extend_pcd_snapshot_trigger_rollback.ts';
import { migration as migration20260713CreatePcdRollbacks } from './migrations/20260713_create_pcd_rollbacks.ts';
import { migration as migration20260714ConfigHealth } from './migrations/20260714_create_config_health_tables.ts';
import { migration as migration20260715CreateCanaryTables } from './migrations/20260715_create_canary_tables.ts';
import { migration as migration20260716CreateTimelineAnnotations } from './migrations/20260716_create_timeline_annotations.ts';
import { migration as migration20260717CreateWebauthnTables } from './migrations/20260717_create_webauthn_tables.ts';
import { migration as migration20260718WidenQualityGoalBindingsArrType } from './migrations/20260718_widen_quality_goal_bindings_arr_type.ts';
import { migration as migration20260719CreateConfigHealthNotificationState } from './migrations/20260719_create_config_health_notification_state.ts';
import { migration as migration20260720AddSyncHistoryEntityOutcomes } from './migrations/20260720_add_sync_history_entity_outcomes.ts';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
  afterUp?: () => void | Promise<void>; // Optional callback for data migrations
}

/**
 * Migration runner for database schema management
 */
class MigrationRunner {
  private migrationsTable = 'migrations';

  /**
   * Initialize the migrations table
   */
  initialize(): void {
    const sql = `
			CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
				version INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`;
    db.exec(sql);
  }

  /**
   * Get the current migration version
   */
  getCurrentVersion(): number {
    const result = db.queryFirst<{ version: number }>(`SELECT MAX(version) as version FROM ${this.migrationsTable}`);
    return result?.version ?? 0;
  }

  /**
   * Check if a migration has been applied
   */
  isApplied(version: number): boolean {
    const result = db.queryFirst<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.migrationsTable} WHERE version = ?`,
      version
    );
    return (result?.count ?? 0) > 0;
  }

  /**
   * Apply a single migration
   */
  private async applyMigration(migration: Migration): Promise<void> {
    try {
      if (migration.afterUp) {
        await db.transaction(async () => {
          // Execute the migration schema first
          db.exec(migration.up);
        });

        await migration.afterUp();

        await db.transaction(() => {
          // Record migration only after data migration succeeds
          db.execute(
            `INSERT INTO ${this.migrationsTable} (version, name) VALUES (?, ?)`,
            migration.version,
            migration.name
          );
        });
        return;
      }

      await db.transaction(async () => {
        // Execute the migration
        db.exec(migration.up);

        // Record the migration
        db.execute(
          `INSERT INTO ${this.migrationsTable} (version, name) VALUES (?, ?)`,
          migration.version,
          migration.name
        );
      });
    } catch (error) {
      await logger.error(`Failed to apply migration ${migration.version}: ${migration.name}`, {
        source: 'DatabaseMigrations',
        meta: error,
      });
      throw error;
    }
  }

  /**
   * Rollback a single migration
   */
  private async rollbackMigration(migration: Migration): Promise<void> {
    const down = migration.down;
    if (!down) {
      throw new Error(`Migration ${migration.version} does not support rollback`);
    }

    try {
      await db.transaction(async () => {
        // Execute the rollback
        db.exec(down);

        // Remove the migration record
        db.execute(`DELETE FROM ${this.migrationsTable} WHERE version = ?`, migration.version);
      });
    } catch (error) {
      await logger.error(`Failed to rollback migration ${migration.version}: ${migration.name}`, {
        source: 'DatabaseMigrations',
        meta: error,
      });
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async up(migrations: Migration[]): Promise<void> {
    this.initialize();

    // Sort migrations by version
    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

    const applied: Array<{ version: number; name: string }> = [];
    for (const migration of sortedMigrations) {
      if (this.isApplied(migration.version)) {
        continue;
      }

      await this.applyMigration(migration);
      applied.push({ version: migration.version, name: migration.name });
    }

    if (applied.length === 0) {
      await logger.debug('Database up to date', {
        source: 'DatabaseMigrations',
      });
    } else {
      await logger.info(`Applied ${applied.length} migration(s)`, {
        source: 'DatabaseMigrations',
        meta: { migrations: applied },
      });
    }
  }

  /**
   * Rollback to a specific version
   */
  async down(migrations: Migration[], targetVersion = 0): Promise<void> {
    this.initialize();

    const currentVersion = this.getCurrentVersion();
    if (currentVersion <= targetVersion) {
      await logger.debug('Already at target version or below', {
        source: 'DatabaseMigrations',
      });
      return;
    }

    // Sort migrations by version in descending order
    const sortedMigrations = [...migrations]
      .filter((m) => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);

    const rolledBack: Array<{ version: number; name: string }> = [];
    for (const migration of sortedMigrations) {
      if (!this.isApplied(migration.version)) {
        continue;
      }

      await this.rollbackMigration(migration);
      rolledBack.push({ version: migration.version, name: migration.name });
    }

    if (rolledBack.length > 0) {
      await logger.info(`Rolled back ${rolledBack.length} migration(s)`, {
        source: 'DatabaseMigrations',
        meta: { migrations: rolledBack },
      });
    }
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): Array<{
    version: number;
    name: string;
    applied_at: string;
  }> {
    return db.query(`SELECT version, name, applied_at FROM ${this.migrationsTable} ORDER BY version`);
  }

  /**
   * Get list of pending migrations
   */
  getPendingMigrations(migrations: Migration[]): Migration[] {
    const pending: Migration[] = [];
    for (const migration of migrations) {
      if (!this.isApplied(migration.version)) {
        pending.push(migration);
      }
    }
    return pending.sort((a, b) => a.version - b.version);
  }

  /**
   * Reset the database (rollback all migrations)
   */
  async reset(migrations: Migration[]): Promise<void> {
    await this.down(migrations, 0);
  }

  /**
   * Fresh migration (reset and reapply all)
   */
  async fresh(migrations: Migration[]): Promise<void> {
    await logger.warn('Resetting database', { source: 'DatabaseMigrations' });
    await this.reset(migrations);
    await this.up(migrations);
  }
}

// Export singleton instance
export const migrationRunner = new MigrationRunner();

/**
 * Helper function to load migrations
 * Returns all statically imported migrations
 */
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = [
    migration001,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
    migration007,
    migration008,
    migration009,
    migration010,
    migration011,
    migration012,
    migration013,
    migration014,
    migration015,
    migration016,
    migration017,
    migration018,
    migration019,
    migration020,
    migration021,
    migration022,
    migration023,
    migration024,
    migration025,
    migration026,
    migration027,
    migration028,
    migration029,
    migration030,
    migration031,
    migration032,
    migration033,
    migration034,
    migration035,
    migration036,
    migration037,
    migration038,
    migration039,
    migration040,
    migration041,
    migration042,
    migration043,
    migration044,
    migration045,
    migration046,
    migration047,
    migration048,
    migration049,
    migration050,
    migration20260215,
    migration20260216ArrInstanceExternalUrl,
    migration20260216,
    migration20260217,
    migration20260218,
    migration20260219,
    migration20260220AddArrInstanceSource,
    migration20260221EncryptArrApiKeys,
    migration20260222EncryptDatabasePat,
    migration20260223CreateStartupPullRuns,
    migration20260224NormalizeNamingCharacterReplacementDefaults,
    migration20260225RemoveEmbeddedLidarrSeedOps,
    migration20260226CreateTrashGuideTables,
    migration20260227NormalizeTrashGuideTrashIds,
    migration20260228CreatePcdSnapshots,
    migration20260706CreateUserComplexityTiers,
    migration20260707AddSetupWizardState,
    migration20260708AddArrInstanceDetectedVersion,
    migration20260709CreateDriftTables,
    migration20260710CreateSyncHistoryTables,
    migration20260711CreateQualityGoalBindings,
    migration20260712ExtendPcdSnapshotTriggerRollback,
    migration20260713CreatePcdRollbacks,
    migration20260714ConfigHealth,
    migration20260715CreateCanaryTables,
    migration20260716CreateTimelineAnnotations,
    migration20260717CreateWebauthnTables,
    migration20260718WidenQualityGoalBindingsArrType,
    migration20260719CreateConfigHealthNotificationState,
    migration20260720AddSyncHistoryEntityOutcomes,
  ];

  // Sort by version number
  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Run migrations
 */
export async function runMigrations(migrations?: Migration[]): Promise<void> {
  const migrationsToRun = migrations ?? loadMigrations();
  await migrationRunner.up(migrationsToRun);
}
