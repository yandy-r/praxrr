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
import type { CacheBuildStats, Operation, ValidationResult } from '../core/types.ts';

/**
 * Optional per-op hooks for `buildReadOnly`. Used by the field-lineage engine to capture
 * per-op writes during an ephemeral replay. When omitted, `buildReadOnly` is byte-identical
 * to its prior behavior — `build()` (the live registered cache) never passes hooks.
 */
export interface BuildReadOnlyHooks {
  onOp?: {
    /** Runs immediately before `db.exec(op.sql)`. */
    before(op: Operation, db: Database): void;
    /** Runs immediately after a successful `db.exec(op.sql)`. Skipped when exec throws. */
    after(op: Operation, db: Database): void;
  };
}
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
      // 1-2. Create in-memory database, initialize Kysely, and register SQL helper functions.
      this.bootstrap();

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
          this.db!.exec(operation.sql);
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

          if (!isUserOp && gateError.errorCategory === 'non_conflict_error') {
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
   * Build an ephemeral, read-only replay of a subset of PCD layers.
   *
   * This is a side-effect-free sibling to `build()`: it applies operation SQL for the
   * requested `layers` only and never evaluates value guards, never records op history
   * (`pcdOpHistoryQueries.create`), never mutates `pcd_ops.state` (`pcdOpsQueries.update`),
   * and never calls `disableDatabaseInstance` on failure. A base/tweaks/user op that
   * fails to apply is logged via `logger.warn` and skipped so the remaining in-scope
   * operations still run.
   *
   * A `schema`-layer op that fails to apply is different: every later op assumes the
   * schema is fully in place, so warn-skipping it would silently cascade into an
   * incomplete (but still `built: true`) cache -- e.g. a missing table/column makes
   * every later op targeting it fail too, and the resulting cache would misreport
   * entities as absent/user-created rather than surfacing the real schema failure.
   * A failed schema op therefore throws immediately (fail-fast), including the
   * filename/layer in the error. `disableDatabaseInstance()` is still never called --
   * this cache is ephemeral, so there is no persistent database row to disable.
   *
   * The resulting instance is ephemeral: the caller owns its lifecycle and MUST call
   * `close()` when done. It must NEVER be registered via `setCache()` — the cache
   * registry is reserved exclusively for instances produced by `build()`.
   */
  async buildReadOnly(
    options: {
      layers: ReadonlySet<'schema' | 'base' | 'tweaks' | 'user'>;
      snapshotOpIds?: ReadonlySet<number>;
    },
    hooks?: BuildReadOnlyHooks
  ): Promise<void> {
    // 1-2. Create in-memory database, initialize Kysely, and register SQL helper functions
    //      (identical bootstrap to build() step 1-2).
    this.bootstrap();

    // 3. Load all operations, then keep only the requested layers.
    //    loadAllOperations() already returns a fully sorted array, so filtering after
    //    the fact preserves correct relative ordering within the kept layers. When
    //    snapshotOpIds is provided, the base/user layers replay exactly that reconstructed
    //    op set for point-in-time snapshot restore (rollback, issue #16).
    const allOperations = await loadAllOperations(this.pcdPath, this.databaseInstanceId, {
      snapshotOpIds: options.snapshotOpIds,
    });
    const operations = allOperations.filter((operation) => options.layers.has(operation.layer));
    validateOperations(operations);

    // 4. Execute operations in order - no value guards, no history writes, no state mutation.
    //    An optional `onOp` hook wraps each exec to capture per-op writes for field lineage;
    //    when absent this loop is byte-identical to its prior behavior. `after` runs only when
    //    exec succeeds, so an op that fails (and is warn-skipped below) establishes nothing.
    for (const operation of operations) {
      try {
        hooks?.onOp?.before(operation, this.db!);
        this.db!.exec(operation.sql);
        hooks?.onOp?.after(operation, this.db!);
      } catch (error) {
        if (operation.layer === 'schema') {
          throw new Error(
            `buildReadOnly: schema op failed to apply (filename=${operation.filename}, layer=${operation.layer}): ${error}`
          );
        }

        await logger.warn('buildReadOnly: skipping op that failed to apply', {
          source: 'PCDCache',
          meta: {
            error: String(error),
            layer: operation.layer,
            filename: operation.filename,
          },
        });
      }
    }

    this.built = true;
  }

  /**
   * Create the in-memory SQLite database + Kysely query builder and register the SQL helper
   * functions. Shared bootstrap for `build()` and `buildReadOnly()` — purely setup, no writes,
   * no guard/history logic. Enables int64 mode to properly handle large integers (e.g., file
   * sizes in bytes) and foreign key enforcement.
   */
  private bootstrap(): void {
    this.db = new Database(':memory:', { int64: true });
    this.db.exec('PRAGMA foreign_keys = ON');
    this.kysely = new Kysely<PCDDatabase>({
      dialect: new DenoSqlite3Dialect({
        database: this.db,
      }),
    });
    this.registerHelperFunctions();
  }

  /**
   * Register SQL helper functions (qp, cf, dp, mp, tag)
   * Kept for backward compatibility with existing PCD SQL rows that still rely on them.
   */
  private registerHelperFunctions(): void {
    if (!this.db) return;

    // qp(name) - Quality profile lookup by name
    this.db.function('qp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM quality_profiles WHERE name = ?').get(name) as
        { id: number } | undefined;
      if (!result) {
        throw new Error(`Quality profile not found: ${name}`);
      }
      return result.id;
    });

    // cf(name) - Custom format lookup by name
    this.db.function('cf', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM custom_formats WHERE name = ?').get(name) as
        { id: number } | undefined;
      if (!result) {
        throw new Error(`Custom format not found: ${name}`);
      }
      return result.id;
    });

    // dp(name) - Delay profile lookup by name
    this.db.function('dp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM delay_profiles WHERE name = ?').get(name) as
        { id: number } | undefined;
      if (!result) {
        throw new Error(`Delay profile not found: ${name}`);
      }
      return result.id;
    });

    // mp(name) - Lidarr metadata profile lookup by name
    this.db.function('mp', (name: string) => {
      const result = this.db!.prepare('SELECT id FROM lidarr_metadata_profiles WHERE name = ?').get(name) as
        { id: number } | undefined;
      if (!result) {
        throw new Error(`Lidarr metadata profile not found: ${name}`);
      }
      return result.id;
    });

    // tag(name) - Tag lookup by name (throws if not found)
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
   * Returns a ValidationResult with valid=true when all statements are safe,
   * otherwise valid=false with a normalized error message.
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
