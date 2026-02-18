/**
 * Structured logging for rename jobs
 * Uses the shared logger with source 'RenameJob'
 * Stores run history in the database
 */

import { logger } from '$logger/logger.ts';
import { renameRunsQueries } from '$db/queries/renameRuns.ts';
import type { RenameJobLog } from './types.ts';

const SOURCE = 'RenameJob';

/**
 * Log a rename run with structured data
 */
export async function logRenameRun(log: RenameJobLog): Promise<void> {
  const duration = new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime();

  const parts = ['rename'];
  if (log.config.dryRun) parts.unshift('dry run');
  if (log.config.manual) parts.unshift('manual');
  const mode = parts.join(' ');

  const summary = `Completed Job: ${mode} for "${log.instanceName}": ${log.results.filesRenamed}/${log.results.filesNeedingRename} files renamed (${duration}ms)`;

  const items = log.renamedItems.map((item) => ({
    title: item.title,
    files: item.files,
  }));

  await logger.info(summary, {
    source: SOURCE,
    meta: {
      instanceId: log.instanceId,
      status: log.status,
      dryRun: log.config.dryRun,
      manual: log.config.manual,
      filesNeedingRename: log.results.filesNeedingRename,
      filesRenamed: log.results.filesRenamed,
      foldersRenamed: log.results.foldersRenamed,
      skippedByTag: log.filtering.skippedByTag,
      durationMs: duration,
      items,
    },
  });

  // Save full structured data to database
  try {
    renameRunsQueries.insert(log);
  } catch (err) {
    await logger.error(`Failed to save rename run to database: ${err}`, {
      source: SOURCE,
      meta: { runId: log.id, error: err },
    });
  }
}

/**
 * Log when a rename config is skipped
 */
export async function logRenameSkipped(instanceId: number, instanceName: string, reason: string): Promise<void> {
  await logger.debug(`Skipped ${instanceName}: ${reason}`, {
    source: SOURCE,
    meta: { instanceId, reason },
  });
}

/**
 * Log when rename processing starts
 */
export async function logRenameStart(
  instanceId: number,
  instanceName: string,
  dryRun: boolean,
  manual: boolean = false
): Promise<void> {
  const parts = ['rename'];
  if (dryRun) parts.unshift('dry run');
  if (manual) parts.unshift('manual');
  const mode = parts.join(' ');
  await logger.debug(`Starting Job: ${mode} for "${instanceName}"`, {
    source: SOURCE,
    meta: { instanceId, dryRun, manual },
  });
}

/**
 * Log errors during rename processing
 */
export async function logRenameError(instanceId: number, instanceName: string, error: string): Promise<void> {
  await logger.error(`Rename failed for ${instanceName}: ${error}`, {
    source: SOURCE,
    meta: { instanceId, error },
  });
}
