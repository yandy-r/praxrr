/**
 * Canary rollout notifications (issue #19).
 *
 * Fire-and-forget helpers that emit `CANARY_FAILED` / `CANARY_PROMOTED` via the
 * `notify()` builder. Both mirror the `record.ts` `fireNotification` idiom and are
 * STRICTLY best-effort: a webhook failure must never throw into the coordinator or
 * rollout handler, so every send is `void`ed with a swallowing `.catch()`.
 *
 * Per-Arr: the embed is scoped to the rollout's single `arrType`; there is no
 * sibling-app blur.
 */

import { notify, createEmbed, Colors, getInstanceIcon } from '$notifications/builder.ts';
import { NotificationTypes } from '$notifications/types.ts';
import type { CanaryInstanceResult, CanaryRolloutDetail } from './types.ts';

const MAX_EMBED_RESULT_LINES = 10;

/** Bullet lines for the non-successful rollout instances (capped for embed width). */
function failedResultLines(results: readonly CanaryInstanceResult[]): string[] {
  const failed = results.filter((result) => result.status !== 'success');
  if (failed.length === 0) {
    return ['See details for the full outcome.'];
  }
  return failed.slice(0, MAX_EMBED_RESULT_LINES).map((result) => `• ${result.instanceName} — ${result.status}`);
}

/**
 * Emit `CANARY_FAILED` on a canary abort or a rollout that finished with any failed
 * instance. Fire-and-forget — never throws.
 */
export function notifyCanaryFailed(rollout: CanaryRolloutDetail): void {
  const title = `Canary failed on ${rollout.arrType} (${rollout.canaryInstanceName})`;
  const message = rollout.canaryError ?? 'Canary sync failed; rollout aborted.';
  const lines = rollout.rolloutResults.length > 0 ? failedResultLines(rollout.rolloutResults) : [message];

  const embed = createEmbed()
    .author(`${getInstanceIcon(rollout.arrType)} ${rollout.canaryInstanceName}`)
    .title(title)
    .lines(lines)
    .field('App', rollout.arrType, true)
    .field('Canary', rollout.canaryStatus ?? 'failed', true)
    .field('Instances synced', String(rollout.rolloutResults.length), true)
    .field('Details', `/canary/${rollout.id}`, false)
    .color(Colors.FAILED)
    .timestamp()
    .footer('Praxrr Canary Sync');

  // Strict fire-and-forget: a webhook failure must never affect the rollout outcome.
  void notify(NotificationTypes.CANARY_FAILED)
    .generic(title, message)
    .discord((discord) => discord.embed(embed))
    .send()
    .catch(() => {
      /* notification delivery is best-effort */
    });
}

/**
 * Emit `CANARY_PROMOTED` on a clean completed rollout (canary passed, all remaining
 * instances synced successfully). Fire-and-forget — never throws.
 */
export function notifyCanaryPromoted(rollout: CanaryRolloutDetail): void {
  const synced = rollout.rolloutResults.length;
  const title = `Canary promoted on ${rollout.arrType} (${rollout.canaryInstanceName})`;
  const message = `Canary passed; ${synced} remaining instance(s) synced.`;

  const embed = createEmbed()
    .author(`${getInstanceIcon(rollout.arrType)} ${rollout.canaryInstanceName}`)
    .title(title)
    .field('App', rollout.arrType, true)
    .field('Canary', rollout.canaryStatus ?? 'success', true)
    .field('Instances synced', String(synced), true)
    .field('Details', `/canary/${rollout.id}`, false)
    .color(Colors.SUCCESS)
    .timestamp()
    .footer('Praxrr Canary Sync');

  // Strict fire-and-forget: a webhook failure must never affect the rollout outcome.
  void notify(NotificationTypes.CANARY_PROMOTED)
    .generic(title, message)
    .discord((discord) => discord.embed(embed))
    .send()
    .catch(() => {
      /* notification delivery is best-effort */
    });
}
