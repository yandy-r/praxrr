/**
 * Sync history recorder (issue #17).
 *
 * Two best-effort entry points used by `arrSyncHandler`:
 * - {@link capturePreSyncChanges} runs the read-only preview engine BEFORE the
 *   sync write loop to capture the intended before/after diff (running it after
 *   the writes would show an empty diff, since Arr already matches desired).
 * - {@link recordSyncHistory} appends one audit row at each terminal exit and
 *   fires the failed/partial notification.
 *
 * BOTH NEVER THROW — a preview or audit failure must never affect the sync result.
 * Both are gated on `sync_history_settings.enabled` so disabling history also
 * avoids the extra preview traffic.
 */

import { logger } from '$logger/logger.ts';
import { notify, createEmbed, Colors, getInstanceIcon } from '$notifications/builder.ts';
import { NotificationTypes } from '$notifications/types.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';
import { syncHistorySettingsQueries } from '$db/queries/syncHistorySettings.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { SectionType } from '$sync/types.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import type { SyncEntityOutcome } from '$sync/types.ts';
import type { SyncEntityChange, SyncHistoryInput, SyncOperationStatus, SyncSectionResult } from './types.ts';

const SOURCE = 'SyncHistoryRecord';
const MAX_EMBED_CHANGE_LINES = 10;

/**
 * Derive the audit status from a run's outcome. Discriminates `partial` vs `failed`
 * on whether ANY section actually succeeded — NOT on total item count, because a
 * successful no-op section reports 0 items and a failing section can report >0. So a
 * mixed run (some sections succeed, some fail) is correctly `partial`, and a run
 * where every ran section failed is `failed`.
 *
 * Also outcome-aware (issue #232): a per-entity `failed` outcome (e.g. a single
 * custom format that failed inside an otherwise-successful quality-profiles section)
 * pulls the run to at least `partial` so a confirmed failure can never collapse to
 * `success`.
 */
export function deriveSyncHistoryStatus(
  ranSections: number,
  failures: number,
  sectionResults: readonly SyncSectionResult[],
  entityOutcomes: readonly SyncEntityOutcome[] = []
): SyncOperationStatus {
  if (ranSections === 0) {
    return 'skipped';
  }
  const successCount = sectionResults.filter((section) => section.status === 'success').length;
  const hasFailedOutcome = entityOutcomes.some((outcome) => outcome.status === 'failed');
  if (failures === 0 && !hasFailedOutcome) {
    return 'success';
  }
  // At least one failure signal exists: `failed` only when nothing succeeded.
  if (successCount === 0 && failures > 0) {
    return 'failed';
  }
  return 'partial';
}

/** Whether recording (and pre-sync preview capture) is enabled. */
export function isSyncHistoryEnabled(): boolean {
  try {
    return syncHistorySettingsQueries.get().enabled === 1;
  } catch {
    return false;
  }
}

function tag(
  changes: readonly EntityChange[] | null,
  section: SyncEntityChange['section'],
  category: string
): SyncEntityChange[] {
  if (!changes) {
    return [];
  }
  return changes.filter((change) => change.action !== 'unchanged').map((change) => ({ ...change, section, category }));
}

/** Flatten a preview result into tagged, changed-only entity changes. */
function flattenPreview(preview: GeneratePreviewResult): SyncEntityChange[] {
  const out: SyncEntityChange[] = [];

  if (preview.qualityProfiles) {
    out.push(...tag(preview.qualityProfiles.customFormats, 'qualityProfiles', 'customFormats'));
    out.push(...tag(preview.qualityProfiles.qualityProfiles, 'qualityProfiles', 'qualityProfiles'));
  }
  if (preview.delayProfiles) {
    out.push(
      ...tag(preview.delayProfiles.profile ? [preview.delayProfiles.profile] : null, 'delayProfiles', 'delayProfiles')
    );
  }
  if (preview.mediaManagement) {
    out.push(
      ...tag(preview.mediaManagement.naming ? [preview.mediaManagement.naming] : null, 'mediaManagement', 'naming')
    );
    out.push(...tag(preview.mediaManagement.qualityDefinitions, 'mediaManagement', 'qualityDefinitions'));
    out.push(
      ...tag(
        preview.mediaManagement.mediaSettings ? [preview.mediaManagement.mediaSettings] : null,
        'mediaManagement',
        'mediaSettings'
      )
    );
  }
  if (preview.metadataProfiles) {
    out.push(
      ...tag(
        preview.metadataProfiles.profile ? [preview.metadataProfiles.profile] : null,
        'metadataProfiles',
        'metadataProfiles'
      )
    );
  }

  return out;
}

/**
 * Best-effort pre-sync diff capture. Reuses the read-only preview engine to
 * compute intended before/after changes for the sections about to be synced.
 * Returns `[]` if history is disabled or on any failure — never throws.
 */
export async function capturePreSyncChanges(
  instance: ArrInstance,
  sections: SectionType[]
): Promise<SyncEntityChange[]> {
  if (!isSyncHistoryEnabled()) {
    return [];
  }
  try {
    const preview = await generatePreview({ instance, sections });
    return flattenPreview(preview);
  } catch (error) {
    await logger.warn('Sync history pre-sync change capture failed (recording counts only)', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }
}

function fireNotification(id: number, input: SyncHistoryInput): void {
  if (input.status !== 'failed' && input.status !== 'partial') {
    return;
  }

  const type = input.status === 'failed' ? NotificationTypes.SYNC_FAILED : NotificationTypes.SYNC_PARTIAL;
  const failedSections = input.sectionResults
    .filter((section) => section.status === 'failed')
    .map((section) => section.section);
  const title = `Sync ${input.status} on ${input.instanceName} (${input.arrType})`;
  const message = input.error ?? `${input.failureCount} section(s) failed`;

  const lines =
    failedSections.length > 0 ? failedSections.map((section) => `• ${section}`) : ['See details for the full outcome.'];

  const embed = createEmbed()
    .author(`${getInstanceIcon(input.arrType)} ${input.instanceName}`)
    .title(title)
    .lines(lines)
    .field('App', input.arrType, true)
    .field('Items synced', String(input.itemsSynced), true)
    .field('Failures', String(input.failureCount), true)
    .field('Details', `/sync-history/${id}`, false)
    .color(input.status === 'failed' ? Colors.FAILED : Colors.WARNING)
    .timestamp()
    .footer('Praxrr Sync History');

  // Strict fire-and-forget: a webhook failure must never affect the audit write.
  void notify(type)
    .generic(title, message)
    .discord((discord) => discord.embed(embed))
    .send()
    .catch(() => {
      /* notification delivery is best-effort */
    });
}

/**
 * Append one audit row and fire the failed/partial notification. Never throws;
 * gated on `sync_history_settings.enabled`. Returns the durable row id (used to
 * correlate confirmed outcomes back to the run, issue #232), or `null` when
 * recording is disabled or the insert failed.
 */
export function recordSyncHistory(input: SyncHistoryInput): number | null {
  try {
    if (!isSyncHistoryEnabled()) {
      return null;
    }
    const id = syncHistoryQueries.insert(input);
    fireNotification(id, input);
    return id;
  } catch (error) {
    // A silently-dropped audit record is bad, but breaking the sync is worse.
    void logger.error('Failed to record sync history', {
      source: SOURCE,
      meta: {
        instanceId: input.arrInstanceId,
        instanceName: input.instanceName,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}
