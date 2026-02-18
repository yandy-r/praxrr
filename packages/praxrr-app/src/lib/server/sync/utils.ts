/**
 * Sync utility functions
 * Small helpers for cron scheduling and startup recovery
 */

import { Cron } from 'croner';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { logger } from '$logger/logger.ts';

// =============================================================================
// Cron utilities
// =============================================================================

/**
 * Calculate the next run time from a cron expression
 */
export function calculateNextRun(cronExpr: string | null): string | null {
  if (!cronExpr) return null;
  try {
    const cron = new Cron(cronExpr);
    const nextRun = cron.nextRun();
    return nextRun?.toISOString() ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// Startup recovery
// =============================================================================

/**
 * Recover from interrupted syncs on startup
 * Any syncs that were in_progress when the server stopped are reset to pending
 * so they will be retried on the next sync cycle
 */
export async function recoverInterruptedSyncs(): Promise<void> {
  const recovered = arrSyncQueries.recoverInterruptedSyncs();

  if (recovered > 0) {
    await logger.info(`Recovered ${recovered} interrupted sync(s) from previous run`, {
      source: 'SyncRecovery',
      meta: { recoveredCount: recovered },
    });
  }
}
