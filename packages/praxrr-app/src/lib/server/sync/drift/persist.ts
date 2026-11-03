/**
 * Drift persistence + notification
 *
 * The single path both the scheduled sweep and `POST /api/v1/drift/{instanceId}` use, so
 * they can never diverge. Reads the prior row (for dedup + failed-check content
 * preservation), runs `checkInstanceDrift`, upserts the merged latest-state row, then fires
 * a deduped `drift.detected` notification fire-and-forget.
 *
 * Suppression (YAN-514): on a content refresh, acknowledgements that no longer match the new
 * signature are cleared (snoozes persist until expiry), and notification dedup keys on the
 * EFFECTIVE signature (un-acknowledged alerting keys) so acknowledged/snoozed drift never alerts.
 * A successful content refresh then offers the instance to opt-in auto-remediation.
 *
 * MUST NEVER THROW — the sweep runs it under `processBatches` (`Promise.all` per batch, no
 * per-item isolation), so a throw would abort sibling instances. On any unexpected error it
 * logs and returns `{ kind: 'error' }`; an in-flight instance returns `{ kind: 'in_flight' }`.
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import {
  driftStatusQueries,
  type DriftInstanceStatusDetail,
  type UpsertDriftStatusInput,
} from '$db/queries/driftStatus.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import { publishDriftUpdated } from '$lib/server/events/publish.ts';
import { notify, createEmbed, Colors, getInstanceIcon, type EmbedBuilder } from '$notifications/builder.ts';
import { resolveSyncSectionLabel } from '$shared/narration/templates.ts';
import { checkInstanceDrift, driftEntityKey, type DriftCheckDeps } from './check.ts';
import { queueAutoRemediationIfEligible, suggestedReconcileSections } from './remediation.ts';
import { alertingKeys, driftContentSignature, entityAcksFor, resolveDriftSuppression } from './suppression.ts';
import type { DriftSuppression, InstanceDriftResult } from './types.ts';
import type { SyncPreviewSection } from '$sync/preview/types.ts';

const SOURCE = 'DriftPersist';
const MAX_EMBED_CHANGE_LINES = 10;

/** Instances with an in-flight check; prevents a double live-fetch + write race. */
const inFlight = new Set<number>();

/**
 * Pure notification predicate: fire only when an instance is drifted AND its EFFECTIVE alerting
 * set (alerting keys minus content-matching acks; empty while acked or snoozed) is non-empty and
 * differs from the stored last-notified signature. `stored` is the row as persisted AFTER this
 * check's upsert (so a concurrent narrowing ack's dedup carry is honoured). Dedup is keyed purely
 * on `notifiedSignature` (not on status), so a drift that persists across a transient degraded
 * cycle (`drifted → error → drifted`, same signature) never re-fires. `notifiedSignature` is
 * cleared on genuine recovery (see `checkAndPersistInstance`), so an identical drift that returns
 * after a real recovery does re-fire. Never fires on any non-drifted status.
 */
export function shouldNotify(
  stored: Pick<DriftInstanceStatusDetail, 'notifiedSignature'> | undefined,
  next: InstanceDriftResult,
  suppression: Pick<DriftSuppression, 'effectiveSignature'>
): boolean {
  if (next.status !== 'drifted' || suppression.effectiveSignature === null) {
    return false;
  }
  return (stored?.notifiedSignature ?? null) !== suppression.effectiveSignature;
}

/**
 * `drift_detected_at` (drift event identity, plan D1): kept while a content refresh sees the same
 * signature, re-stamped when the signature changes (including drift returning after recovery),
 * null when nothing alerts. A degraded check preserves the prior value with the prior content.
 */
function resolveDriftDetectedAt(
  prior: DriftInstanceStatusDetail | undefined,
  next: InstanceDriftResult,
  contentRefresh: boolean
): string | null {
  if (!contentRefresh) {
    return prior?.driftDetectedAt ?? null;
  }
  if (next.driftSignature === null) {
    return null;
  }
  if (prior?.driftSignature === next.driftSignature && prior.driftDetectedAt !== null) {
    return prior.driftDetectedAt;
  }
  return next.contentCheckedAt;
}

/**
 * Build the `drift.detected` notification over the EFFECTIVE (un-acknowledged) alerting changes.
 * `reconcileSections` is non-empty only in `notify` policy mode and appends the
 * "Reconcile suggested" line with the drift deep link.
 */
function buildDriftNotification(
  next: InstanceDriftResult,
  suppression: DriftSuppression,
  reconcileSections: readonly SyncPreviewSection[]
): {
  title: string;
  message: string;
  embed: EmbedBuilder;
} {
  const title = `Drift detected on ${next.instanceName} (${next.arrType})`;
  const reconcileLine =
    reconcileSections.length > 0
      ? `Reconcile suggested: ${reconcileSections.map(resolveSyncSectionLabel).join(', ')} — /drift/${next.instanceId}`
      : null;
  const counts = `${suppression.effectiveDrifted} changed, ${suppression.effectiveMissing} missing on Arr`;
  const message = reconcileLine ? `${counts}\n${reconcileLine}` : counts;

  const acked = new Set(suppression.acknowledgedEntityKeys);
  const alertingLines = next.changes
    .filter((change) => change.category === 'drift' || change.category === 'missing')
    .filter((change) => !acked.has(driftEntityKey(change)))
    .slice(0, MAX_EMBED_CHANGE_LINES)
    .map((change) => `• ${change.entityType} "${change.name}" — ${change.category}`);
  const lines = alertingLines.length > 0 ? alertingLines : ['Configuration has diverged from the desired state.'];

  const embed = createEmbed()
    .author(`${getInstanceIcon(next.arrType)} ${next.instanceName}`)
    .title(title)
    .lines(reconcileLine ? [...lines, '', reconcileLine] : lines)
    .field('App', next.arrType, true)
    .field('Changed', String(suppression.effectiveDrifted), true)
    .field('Missing on Arr', String(suppression.effectiveMissing), true)
    .field('Unmanaged', String(next.counts.unmanaged), true)
    .field('Details', `/drift/${next.instanceId}`, false)
    .color(Colors.WARNING)
    .timestamp()
    .footer('Praxrr Drift Detection');

  return { title, message, embed };
}

/** Notify-mode reconcile suggestion for the stored row; empty for `off`/`auto` or on any read error. */
async function resolveReconcileSuggestion(
  row: DriftInstanceStatusDetail,
  instance: ArrInstance
): Promise<SyncPreviewSection[]> {
  try {
    const policy = driftRemediationPolicyQueries.get(row.arrInstanceId, row.arrType);
    return policy.mode === 'notify' ? suggestedReconcileSections(row, policy) : [];
  } catch (error) {
    await logger.warn('Drift reconcile suggestion unavailable; notifying without it', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }
}

/** Whether this check produced a fresh successful diff (vs a degraded/failed outcome). */
function isContentRefresh(result: InstanceDriftResult): boolean {
  return result.contentCheckedAt !== null;
}

/**
 * Discriminated result so callers can tell the two "no fresh result" causes apart: an
 * instance already being checked (→ 409 / skip) vs an unexpected persistence error (→ 500).
 * The scheduled sweep treats both non-`ok` kinds identically (ignore).
 */
export type CheckAndPersistOutcome =
  | { readonly kind: 'ok'; readonly result: InstanceDriftResult }
  | { readonly kind: 'in_flight' }
  | { readonly kind: 'error' };

/**
 * Checks an instance and persists the merged latest-state row. Never throws — the scheduled
 * sweep runs it under `processBatches` (`Promise.all` per batch, no per-item isolation), so a
 * throw would abort sibling instances. On any unexpected error it logs and returns
 * `{ kind: 'error' }`; an already-in-flight instance returns `{ kind: 'in_flight' }`.
 */
export async function checkAndPersistInstance(
  instance: ArrInstance,
  deps: Partial<DriftCheckDeps> = {}
): Promise<CheckAndPersistOutcome> {
  if (inFlight.has(instance.id)) {
    return { kind: 'in_flight' };
  }
  inFlight.add(instance.id);

  try {
    const prior = driftStatusQueries.getById(instance.id);
    const next = await checkInstanceDrift(instance, deps);
    const contentRefresh = isContentRefresh(next);

    // On a failed/degraded check (no fresh diff) preserve the last-known content so the UI
    // shows "last good check at X; currently <status>" rather than blanking known drift.
    const upsertInput: UpsertDriftStatusInput = {
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
      driftDetectedAt: resolveDriftDetectedAt(prior, next, contentRefresh),
    };
    driftStatusQueries.upsert(upsertInput);

    // A fresh diff invalidates an instance ack whose reviewed CONTENT no longer matches (plan D5)
    // and prunes entity acks whose entity is gone or drifted further (fingerprint changed).
    // Snoozes are deliberately untouched (expiry only).
    if (contentRefresh) {
      driftStatusQueries.clearStaleAcknowledgements(
        next.instanceId,
        driftContentSignature(next.changes),
        entityAcksFor(next.changes, alertingKeys(next.changes))
      );
    }
    publishDriftUpdated(upsertInput);

    // Genuine recovery: a fresh clean check (no alerting drift) clears the last-notified
    // signature so an identical drift that returns later re-fires. No-op if nothing was notified.
    if (contentRefresh && next.driftSignature === null && prior?.notifiedSignature) {
      driftStatusQueries.markNotified(next.instanceId, null);
    }
    // Same recovery point re-arms auto-remediation: an identical drift recurring after a real
    // recovery is a new drift event and gets its own single auto attempt.
    if (contentRefresh && next.driftSignature === null && prior?.lastAutoAttemptSignature) {
      driftStatusQueries.clearAutoAttempt(next.instanceId);
    }

    const row = driftStatusQueries.getById(next.instanceId);
    const suppression = resolveDriftSuppression(row, (deps.now ?? Date.now)());

    if (row && shouldNotify(row, next, suppression)) {
      const effectiveSignature = suppression.effectiveSignature;
      const reconcileSections = await resolveReconcileSuggestion(row, instance);
      const { title, message, embed } = buildDriftNotification(next, suppression, reconcileSections);
      // Fire-and-forget: never awaited into the result; a notification failure must never
      // affect drift persistence. Advance notified_signature (the EFFECTIVE signature) only
      // after the emit attempt.
      void notify('drift.detected')
        .context({ instanceId: next.instanceId, instanceName: next.instanceName, arrType: next.arrType })
        .generic(title, message)
        .discord((discord) => discord.embed(embed))
        .send()
        .then(() => {
          driftStatusQueries.markNotified(next.instanceId, effectiveSignature);
        })
        .catch(() => {
          /* notification delivery is best-effort */
        });
    }

    // Opt-in auto-remediation sees only fresh diffs; it is synchronous, never throws and only
    // enqueues (every eligibility rule, including `off` by default, lives in remediation.ts).
    if (contentRefresh) {
      queueAutoRemediationIfEligible(instance);
    }

    return { kind: 'ok', result: next };
  } catch (error) {
    await logger.error('Drift check-and-persist failed', {
      source: SOURCE,
      meta: {
        instanceId: instance.id,
        instanceName: instance.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { kind: 'error' };
  } finally {
    inFlight.delete(instance.id);
  }
}
