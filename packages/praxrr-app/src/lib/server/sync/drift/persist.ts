/**
 * Drift persistence + notification
 *
 * The single path both the scheduled sweep and `POST /api/v1/drift/{instanceId}` use, so
 * they can never diverge. Reads the prior row (for dedup + failed-check content
 * preservation), runs `checkInstanceDrift`, upserts the merged latest-state row, then fires
 * a deduped `drift.detected` notification fire-and-forget.
 *
 * MUST NEVER THROW — the sweep runs it under `processBatches` (`Promise.all` per batch, no
 * per-item isolation), so a throw would abort sibling instances. On any unexpected error it
 * logs and returns `null`. `null` also signals "skipped, already in-flight".
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { driftStatusQueries, type DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import { notify, createEmbed, Colors, getInstanceIcon } from '$notifications/builder.ts';
import { checkInstanceDrift, type DriftCheckDeps } from './check.ts';
import type { InstanceDriftResult } from './types.ts';

const SOURCE = 'DriftPersist';
const MAX_EMBED_CHANGE_LINES = 10;

/** Instances with an in-flight check; prevents a double live-fetch + write race. */
const inFlight = new Set<number>();

/**
 * Pure notification predicate: fire only when an instance newly enters drift or its alerting
 * drift set changes vs the last-notified signature. Never fires on recovery
 * (`drifted → in-sync`) or on any reachability/error status.
 */
export function shouldNotify(prior: DriftInstanceStatusDetail | undefined, next: InstanceDriftResult): boolean {
  if (next.status !== 'drifted') {
    return false;
  }
  if (!prior || prior.status !== 'drifted') {
    return true;
  }
  return prior.notifiedSignature !== next.driftSignature;
}

function buildDriftNotification(next: InstanceDriftResult): {
  title: string;
  message: string;
  embed: ReturnType<typeof createEmbed>;
} {
  const title = `Drift detected on ${next.instanceName} (${next.arrType})`;
  const message = `${next.counts.drifted} changed, ${next.counts.missing} missing on Arr`;

  const alertingLines = next.changes
    .filter((change) => change.action === 'update' || change.action === 'create')
    .slice(0, MAX_EMBED_CHANGE_LINES)
    .map((change) => `• ${change.entityType} "${change.name}" — ${change.category}`);

  const embed = createEmbed()
    .author(`${getInstanceIcon(next.arrType)} ${next.instanceName}`)
    .title(title)
    .lines(alertingLines.length > 0 ? alertingLines : ['Configuration has diverged from the desired state.'])
    .field('App', next.arrType, true)
    .field('Changed', String(next.counts.drifted), true)
    .field('Missing on Arr', String(next.counts.missing), true)
    .field('Unmanaged', String(next.counts.unmanaged), true)
    .field('Details', `/drift/${next.instanceId}`, false)
    .color(Colors.WARNING)
    .timestamp()
    .footer('Praxrr Drift Detection');

  return { title, message, embed };
}

/** Whether this check produced a fresh successful diff (vs a degraded/failed outcome). */
function isContentRefresh(result: InstanceDriftResult): boolean {
  return result.contentCheckedAt !== null;
}

/**
 * Checks an instance and persists the merged latest-state row. Returns the fresh
 * `InstanceDriftResult`, or `null` when the instance is already being checked (caller maps
 * to a 409 / skip) or an unexpected error occurred (logged, never thrown).
 */
export async function checkAndPersistInstance(
  instance: ArrInstance,
  deps: Partial<DriftCheckDeps> = {}
): Promise<InstanceDriftResult | null> {
  if (inFlight.has(instance.id)) {
    return null;
  }
  inFlight.add(instance.id);

  try {
    const prior = driftStatusQueries.getById(instance.id);
    const next = await checkInstanceDrift(instance, deps);
    const contentRefresh = isContentRefresh(next);

    // On a failed/degraded check (no fresh diff) preserve the last-known content so the UI
    // shows "last good check at X; currently <status>" rather than blanking known drift.
    await driftStatusQueries.upsert({
      arrInstanceId: next.instanceId,
      arrType: next.arrType,
      status: next.status,
      reason: next.reason,
      driftedCount: contentRefresh ? next.counts.drifted : (prior?.counts.drifted ?? 0),
      missingCount: contentRefresh ? next.counts.missing : (prior?.counts.missing ?? 0),
      unmanagedCount: contentRefresh ? next.counts.unmanaged : (prior?.counts.unmanaged ?? 0),
      driftSignature: contentRefresh ? next.driftSignature : (prior?.driftSignature ?? null),
      detectedVersion: next.detectedVersion ?? prior?.detectedVersion ?? null,
      changes: contentRefresh ? next.changes : (prior?.changes ?? []),
      checkedAt: next.checkedAt,
      contentCheckedAt: contentRefresh ? next.contentCheckedAt : (prior?.contentCheckedAt ?? null),
      durationMs: next.durationMs,
    });

    if (shouldNotify(prior, next)) {
      const { title, message, embed } = buildDriftNotification(next);
      // Fire-and-forget: never awaited into the result; a notification failure must never
      // affect drift persistence. Advance notified_signature only after the emit attempt.
      void notify('drift.detected')
        .generic(title, message)
        .discord((discord) => discord.embed(embed))
        .send()
        .then(() => {
          driftStatusQueries.markNotified(next.instanceId, next.driftSignature);
        })
        .catch(() => {
          /* notification delivery is best-effort */
        });
    }

    return next;
  } catch (error) {
    await logger.error('Drift check-and-persist failed', {
      source: SOURCE,
      meta: {
        instanceId: instance.id,
        instanceName: instance.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  } finally {
    inFlight.delete(instance.id);
  }
}
