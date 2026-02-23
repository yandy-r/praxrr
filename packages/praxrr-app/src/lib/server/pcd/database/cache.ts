/**
 * PCD Cache - In-memory compiled view of PCD operations
 */

import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import { logger } from '$logger/logger.ts';
import { loadAllOperations } from '../ops/loadOps.ts';
import { validateOperations } from '../utils/operations.ts';
import { databaseInstancesQueries, disableDatabaseInstance } from '$db/queries/databaseInstances.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { CacheBuildStats, ValidationResult } from '../core/types.ts';
import { uuid } from '$shared/utils/uuid.ts';
import { evaluateValueGuardApply, evaluateValueGuardError } from '../migration/valueGuardGate.ts';

/**
 * PCDCache - Manages an in-memory compiled database for a single PCD
 */
export class PCDCache {
  private db: Database | null = null;
  private kysely: Kysely<PCDDatabase> | null = null;
  private pcdPath: string;
  private databaseInstanceId: number;
  private built = false;

  constructor(pcdPath: string, databaseInstanceId: number) {
    this.pcdPath = pcdPath;
    this.databaseInstanceId = databaseInstanceId;
  }

  /**
   * Build the cache by executing all operations in layer order
   * Returns stats about what was loaded
   */
  async build(): Promise<CacheBuildStats> {
    const startTime = performance.now();
    const batchId = uuid();
    const instance = databaseInstancesQueries.getById(this.databaseInstanceId);
    const conflictStrategy = (instance?.conflict_strategy ?? 'override') as 'override' | 'align' | 'ask';
    const userOps = pcdOpsQueries.listByDatabaseAndOrigin(this.databaseInstanceId, 'user', {
      states: ['published'],
    });
    const userOpsById = new Map(userOps.map((op) => [op.id, op]));
    const priorConflicts = new Map<number, string | null>();
    try {
      const latestConflicts = pcdOpHistoryQueries.listLatestByDatabaseWithOps(this.databaseInstanceId, [
        'conflicted',
        'conflicted_pending',
      ]);
      for (const entry of latestConflicts) {
        priorConflicts.set(entry.history.op_id, entry.history.conflict_reason);
      }
    } catch (error) {
      await logger.warn('Failed to load prior conflicts', {
        source: 'PCDCache',
        meta: {
          error: String(error),
          databaseInstanceId: this.databaseInstanceId,
        },
      });
    }

    try {
      // 1. Create in-memory database
      // Enable int64 mode to properly handle large integers (e.g., file sizes in bytes)
      this.db = new Database(':memory:', { int64: true });

      // Enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON');

      // Initialize Kysely query builder
      this.kysely = new Kysely<PCDDatabase>({
        dialect: new DenoSqlite3Dialect({
          database: this.db,
        }),
      });

      // 2. Register helper functions
      this.registerHelperFunctions();

      // 3. Load all operations
      const operations = await loadAllOperations(this.pcdPath, this.databaseInstanceId);
      validateOperations(operations);

      // Count ops per layer
      const stats: CacheBuildStats = {
        schema: operations.filter((o) => o.layer === 'schema').length,
        base: operations.filter((o) => o.layer === 'base').length,
        tweaks: operations.filter((o) => o.layer === 'tweaks').length,
        user: operations.filter((o) => o.layer === 'user').length,
        timing: 0,
      };

      // 4. Execute operations in order
      for (const operation of operations) {
        const opId = parseOpId(operation.filepath);
        const trackHistory = opId !== null;
        const userOp = trackHistory ? userOpsById.get(opId) : undefined;
        const isUserOp = !!userOp;
        const beforeChanges = trackHistory ? this.db!.totalChanges : 0;
        try {
          this.db.exec(operation.sql);
          if (trackHistory) {
            const trackedOpId = opId as number;
            const rowcount = this.db!.totalChanges - beforeChanges;
            try {
              const priorReason = priorConflicts.get(trackedOpId) ?? null;
              const gateResult = evaluateValueGuardApply({
                db: this.db!,
                conflictStrategy,
                isUserOp,
                rowcount,
                metadataJson: userOp?.metadata ?? null,
                desiredStateJson: userOp?.desired_state ?? null,
                priorConflictReason: priorReason,
              });

              let status = gateResult.status;
              let conflictReason = gateResult.conflictReason;

              if (gateResult.shouldAttemptAutoDrop) {
                const dropped = pcdOpsQueries.update(trackedOpId, {
                  state: 'dropped',
                });
                if (dropped) {
                  status = 'dropped';
                  conflictReason = 'aligned';
                  if (gateResult.decision === 'auto_align_full_list') {
                    await logger.info('Forced align conflict (full-list mismatch)', {
                      source: 'PCDCache',
                      meta: {
                        opId: trackedOpId,
                        databaseInstanceId: this.databaseInstanceId,
                        conflictStrategy,
                        conflictReason,
                      },
                    });
                  } else {
                    await logger.info(
                      gateResult.autoAlignReason === 'forced' ? 'Forced align conflict' : 'Auto-aligned conflict',
                      {
                        source: 'PCDCache',
                        meta: {
                          opId: trackedOpId,
                          databaseInstanceId: this.databaseInstanceId,
                          conflictStrategy,
                          conflictReason,
                          autoAlignReason: gateResult.autoAlignReason,
                          autoAlignRule: gateResult.autoAlignRule,
                        },
                      }
                    );
                  }
                } else {
                  status = gateResult.fallbackStatus;
                  conflictReason = gateResult.fallbackConflictReason;
                  if (gateResult.shouldLogConflict) {
                    const message =
                      gateResult.decision === 'auto_align_full_list'
                        ? 'Recorded op conflict (full-list mismatch)'
                        : 'Recorded op conflict';
                    await logger.info(message, {
                      source: 'PCDCache',
                      meta: {
                        opId: trackedOpId,
                        databaseInstanceId: this.databaseInstanceId,
                        conflictStrategy,
                        conflictReason,
                      },
                    });
                  }
                }
              } else if (gateResult.shouldLogConflict) {
                const message =
                  gateResult.decision === 'full_list_conflict'
                    ? 'Recorded op conflict (full-list mismatch)'
                    : 'Recorded op conflict';
                await logger.info(message, {
                  source: 'PCDCache',
                  meta: {
                    opId: trackedOpId,
                    databaseInstanceId: this.databaseInstanceId,
                    conflictStrategy,
                    conflictReason,
                  },
                });
              }

              if (gateResult.needsRebuild) {
                stats.needsRebuild = true;
              }

              pcdOpHistoryQueries.create({
                opId: trackedOpId,
                databaseId: this.databaseInstanceId,
                batchId,
                status,
                rowcount,
                conflictReason,
              });
            } catch (historyError) {
              await logger.warn('Failed to record op history', {
                source: 'PCDCache',
                meta: {
                  opId: trackedOpId,
                  databaseInstanceId: this.databaseInstanceId,
                  error: String(historyError),
                },
              });
            }
          }
        } catch (error) {
          const errorStr = String(error);
          if (!trackHistory) {
            throw new Error(`Failed to execute operation ${operation.filename} in ${operation.layer} layer: ${error}`);
          }
          const trackedOpId = opId as number;
          const gateError = evaluateValueGuardError({
            conflictStrategy,
            error: errorStr,
            isUserOp,
            trackHistory,
            priorConflictReason: priorConflicts.get(trackedOpId) ?? null,
          });

          if (!gateError.shouldRecordHistory) {
            throw new Error(`Failed to execute operation ${operation.filename} in ${operation.layer} layer: ${error}`);
          }

          if (gateError.shouldLogConflict) {
            await logger.info('Recorded op conflict', {
              source: 'PCDCache',
              meta: {
                opId: trackedOpId,
                databaseInstanceId: this.databaseInstanceId,
                conflictStrategy,
                conflictReason: gateError.conflictReason,
              },
            });
          }
          try {
            pcdOpHistoryQueries.create({
              opId: trackedOpId,
              databaseId: this.databaseInstanceId,
              batchId,
              status: gateError.status,
              rowcount: gateError.errorCategory === 'non_conflict_error' ? null : 0,
              conflictReason: gateError.conflictReason,
              error: errorStr,
              details: JSON.stringify({
                layer: operation.layer,
                filename: operation.filename,
              }),
            });
          } catch (historyError) {
            await logger.warn('Failed to record op history', {
              source: 'PCDCache',
              meta: {
                opId: trackedOpId,
                databaseInstanceId: this.databaseInstanceId,
                error: String(historyError),
              },
            });
          }
          continue;
        }
      }

      this.built = true;
      stats.timing = Math.round(performance.now() - startTime);

      return stats;
    } catch (error) {
      await logger.error('Failed to build PCD cache', {
        source: 'PCDCache',
        meta: {
          error: String(error),
          databaseInstanceId: this.databaseInstanceId,
        },
      });

      // Disable the database instance
      await disableDatabaseInstance(this.databaseInstanceId);

      // Clean up
      this.close();
      throw error;
    }
  }

  /**
   * Register SQL helper functions (qp, cf, dp, mp, tag)
   */
  private registerHelperFunctions(): void {
    if (!this.db) return;

    // qp(name) - Quality profile lookup by name
    this.db.function('qp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM quality_profiles WHERE name = ?').get(name) as
        | { id: number }
        | undefined;
      if (!result) {
        throw new Error(`Quality profile not found: ${name}`);
      }
      return result.id;
    });

    // cf(name) - Custom format lookup by name
    this.db.function('cf', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM custom_formats WHERE name = ?').get(name) as
        | { id: number }
        | undefined;
      if (!result) {
        throw new Error(`Custom format not found: ${name}`);
      }
      return result.id;
    });

    // dp(name) - Delay profile lookup by name
    this.db.function('dp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM delay_profiles WHERE name = ?').get(name) as
        | { id: number }
        | undefined;
      if (!result) {
        throw new Error(`Delay profile not found: ${name}`);
      }
      return result.id;
    });

    // mp(name) - Lidarr metadata profile lookup by name
    this.db.function('mp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM lidarr_metadata_profiles WHERE name = ?').get(name) as
        | { id: number }
        | undefined;
      if (!result) {
        throw new Error(`Lidarr metadata profile not found: ${name}`);
      }
      return result.id;
    });

    // tag(name) - Tag lookup by name (creates if not exists)
    this.db.function('tag', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
      if (!result) {
        throw new Error(`Tag not found: ${name}`);
      }
      return result.id;
    });
  }

  /**
   * Check if cache is built and ready
   */
  isBuilt(): boolean {
    return this.built && this.db !== null;
  }

  /**
   * Access the underlying SQLite database instance.
   * Prefer this over private field casts.
   */
  getRawDb(): Database | null {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.kysely) {
      this.kysely.destroy();
      this.kysely = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.built = false;
  }

  /**
   * Get the Kysely query builder
   * Use this for type-safe queries
   */
  get kb(): Kysely<PCDDatabase> {
    if (!this.kysely) {
      throw new Error('Cache not built');
    }
    return this.kysely;
  }

  // ============================================================================
  // QUERY API
  // ============================================================================

  /**
   * Execute a raw SQL query and return all rows
   * Use this in your query functions in pcd/queries/*.ts
   */
  query<T = unknown>(sql: string, ...params: (string | number | null | boolean | Uint8Array)[]): T[] {
    if (!this.isBuilt()) {
      throw new Error('Cache not built');
    }

    return this.db!.prepare(sql).all(...params) as T[];
  }

  /**
   * Execute a raw SQL query and return a single row
   * Use this in your query functions in pcd/queries/*.ts
   */
  queryOne<T = unknown>(sql: string, ...params: (string | number | null | boolean | Uint8Array)[]): T | undefined {
    if (!this.isBuilt()) {
      throw new Error('Cache not built');
    }

    return this.db!.prepare(sql).get(...params) as T | undefined;
  }

  /**
   * Validate SQL statements by doing a dry-run in a transaction
   * Returns null if valid, or an error message if invalid
   *
   * This is a safety check before writing operations to files.
   * It catches FK violations, constraint errors, etc.
   */
  validateSql(sqlStatements: string[]): ValidationResult {
    if (!this.isBuilt()) {
      return { valid: false, error: 'Cache not built' };
    }

    try {
      // Start a savepoint (nested transaction)
      this.db!.exec('SAVEPOINT validation_check');

      try {
        // Try to execute each statement
        for (const sql of sqlStatements) {
          this.db!.exec(sql);
        }

        // All statements executed successfully
        return { valid: true };
      } finally {
        // Always rollback - this is just a validation check
        this.db!.exec('ROLLBACK TO SAVEPOINT validation_check');
        this.db!.exec('RELEASE SAVEPOINT validation_check');
      }
    } catch (error) {
      // Parse the error to provide a helpful message
      const errorStr = String(error);

      // Common SQLite constraint errors
      if (errorStr.includes('FOREIGN KEY constraint failed')) {
        return {
          valid: false,
          error: `Foreign key constraint failed - referenced entity does not exist. ${errorStr}`,
        };
      }
      if (errorStr.includes('UNIQUE constraint failed')) {
        return {
          valid: false,
          error: `Unique constraint failed - duplicate entry. ${errorStr}`,
        };
      }
      if (errorStr.includes('NOT NULL constraint failed')) {
        return {
          valid: false,
          error: `Required field is missing. ${errorStr}`,
        };
      }
      if (errorStr.includes('CHECK constraint failed')) {
        return {
          valid: false,
          error: `Value validation failed. ${errorStr}`,
        };
      }

      return {
        valid: false,
        error: `Database validation failed: ${errorStr}`,
      };
    }
  }
}

function parseOpId(filepath: string): number | null {
  if (!filepath.startsWith('pcd_ops:')) return null;
  const raw = filepath.slice('pcd_ops:'.length);
  const opId = Number(raw);
  return Number.isFinite(opId) ? opId : null;
}
