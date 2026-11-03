/**
 * Drift auto-remediation — decision core + enqueue shell (docs/plans/drift-remediation/plan.md §3.5, §6).
 *
 * `decideAutoRemediation` is pure: it never writes and only returns `remediate` for a stored,
 * fresh, unsuppressed `drifted` row whose signature has not been attempted yet, restricted to
 * `(remediable ∩ allowed ∩ version-available)` sections, outside Canary gating.
 *
 * `queueAutoRemediationIfEligible` is the only caller-facing side effect: it enqueues a
 * `drift.remediate` job (never writes to an Arr) or records a Canary hold. It never throws.
 *
 * Canary gating is resolved per explicit `arr_type`: the cohort, the default canary, and active
 * rollouts are all scoped to the instance's own app, so a Sonarr rollout never gates Radarr.
 */

import { logger } from '$logger/logger.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { canarySettingsQueries } from '$db/queries/canarySettings.ts';
import { driftRemediationPolicyQueries } from '$db/queries/driftRemediationPolicy.ts';
import { driftStatusQueries, type DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import { publishDriftRowUpdated } from '$lib/server/events/publish.ts';
import { getSectionsInProgress } from '$jobs/handlers/arrSync.ts';
import { upsertScheduledJob } from '$jobs/queueService.ts';
import { notify, createEmbed, Colors, getInstanceIcon } from '$notifications/builder.ts';
import type { NotificationSeverity } from '$notifications/types.ts';
import { isCanaryResolutionError, resolveCanary, resolveSyncArrType } from '$sync/canary/selection.ts';
import { resolveSyncSectionAvailability, SYNC_SECTION_ORDER } from '$sync/mappings.ts';
import { isSyncPreviewArrType, type SyncPreviewArrType, type SyncPreviewSection } from '$sync/preview/types.ts';
import type { SectionType } from '$sync/types.ts';
import { remediableSections, resolveDriftSuppression } from './suppression.ts';
import type { DriftRemediationLink, DriftRemediationPolicy } from './types.ts';

const SOURCE = 'DriftRemediation';

export type AutoRemediationSkipReason =
  | 'mode_off'
  | 'mode_notify'
  | 'not_drifted'
  | 'stale_content'
  | 'suppressed'
  | 'already_attempted'
  | 'no_sections'
  | 'canary_rollout_active'
  | 'sync_in_progress';

export type AutoRemediationDecision =
  | { readonly kind: 'skip'; readonly reason: AutoRemediationSkipReason }
  | { readonly kind: 'hold_canary'; readonly sections: SyncPreviewSection[] }
  | { readonly kind: 'remediate'; readonly sections: SyncPreviewSection[]; readonly link: DriftRemediationLink };

/** Canary facts for the instance's own `arr_type` cohort. */
export interface AutoRemediationCanaryContext {
  readonly enabled: boolean;
  /** Enabled instances of the same `arr_type` (including this one). */
  readonly cohortSize: number;
  /** This instance is the resolved default canary of its cohort. */
  readonly isDefaultCanary: boolean;
  /** A rollout of the same `arr_type` is `canary_running | awaiting_confirmation | rolling_out`. */
  readonly activeRolloutForType: boolean;
}

export interface DecideAutoRemediationArgs {
  readonly policy: DriftRemediationPolicy;
  readonly row: DriftInstanceStatusDetail | undefined;
  readonly nowMs: number;
  readonly canary: AutoRemediationCanaryContext;
  readonly sectionsInProgress: readonly SectionType[];
  readonly versionAvailable: ReadonlySet<SyncPreviewSection>;
}

/** Pure auto-remediation decision. Never writes; see the module doc for the rules. */
export function decideAutoRemediation(args: DecideAutoRemediationArgs): AutoRemediationDecision {
  const { policy, row, nowMs, canary } = args;

  if (policy.mode === 'off') return { kind: 'skip', reason: 'mode_off' };
  if (policy.mode === 'notify') return { kind: 'skip', reason: 'mode_notify' };

  if (!row || row.status !== 'drifted' || row.driftSignature === null) {
    return { kind: 'skip', reason: 'not_drifted' };
  }
  // A row without a fresh content diff, or recorded for a different Arr app, is unknown state.
  if (row.contentCheckedAt === null || row.arrType !== policy.arrType) {
    return { kind: 'skip', reason: 'stale_content' };
  }

  const suppression = resolveDriftSuppression(row, nowMs);
  if (suppression.state === 'acknowledged' || suppression.state === 'snoozed') {
    return { kind: 'skip', reason: 'suppressed' };
  }

  if (row.lastAutoAttemptSignature === row.driftSignature) {
    return { kind: 'skip', reason: 'already_attempted' };
  }

  const allowed = new Set(policy.allowedSections);
  const sections = remediableSections(row.changes, row.acknowledgedEntities).filter(
    (section) => allowed.has(section) && args.versionAvailable.has(section)
  );
  if (sections.length === 0) {
    return { kind: 'skip', reason: 'no_sections' };
  }

  const inProgress = new Set<string>(args.sectionsInProgress);
  if (sections.some((section) => inProgress.has(section))) {
    return { kind: 'skip', reason: 'sync_in_progress' };
  }

  if (canary.activeRolloutForType) {
    return { kind: 'skip', reason: 'canary_rollout_active' };
  }
  if (canary.enabled && canary.cohortSize > 1 && !canary.isDefaultCanary) {
    return { kind: 'hold_canary', sections };
  }

  return {
    kind: 'remediate',
    sections,
    link: {
      instanceId: row.arrInstanceId,
      driftSignature: row.driftSignature,
      driftDetectedAt: row.driftDetectedAt,
      trigger: 'auto',
    },
  };
}

/**
 * Sections a `notify`-mode alert should suggest reconciling: remediable sections of a drifted
 * row, narrowed to `allowedSections` when the policy lists any.
 */
export function suggestedReconcileSections(
  row: DriftInstanceStatusDetail,
  policy: DriftRemediationPolicy
): SyncPreviewSection[] {
  if (row.status !== 'drifted') {
    return [];
  }
  const sections = remediableSections(row.changes, row.acknowledgedEntities);
  if (policy.allowedSections.length === 0) {
    return sections;
  }
  const allowed = new Set(policy.allowedSections);
  return sections.filter((section) => allowed.has(section));
}

// ============================================================================
// CONTEXT GATHERING (reads only)
// ============================================================================

/** Sections the instance's Arr app supports at its last detected version. */
function resolveVersionAvailableSections(
  arrType: SyncPreviewArrType,
  detectedVersion: string | null
): Set<SyncPreviewSection> {
  const available = new Set<SyncPreviewSection>();
  for (const section of SYNC_SECTION_ORDER) {
    if (resolveSyncSectionAvailability(arrType, section, detectedVersion).status !== 'unavailable') {
      available.add(section);
    }
  }
  return available;
}

function resolveCanaryContext(instanceId: number, arrType: SyncPreviewArrType): AutoRemediationCanaryContext {
  const settings = canarySettingsQueries.get();
  const cohort = arrInstancesQueries.getEnabled().filter((instance) => resolveSyncArrType(instance.type) === arrType);
  let isDefaultCanary = false;
  if (settings.enabled && cohort.length > 1) {
    const resolution = resolveCanary({ arrType }, settings);
    isDefaultCanary = !isCanaryResolutionError(resolution) && resolution.canary.instanceId === instanceId;
  }
  return {
    enabled: settings.enabled,
    cohortSize: cohort.length,
    isDefaultCanary,
    activeRolloutForType: canaryRolloutQueries.hasActiveForArrType(arrType),
  };
}

const NEUTRAL_CANARY: AutoRemediationCanaryContext = {
  enabled: false,
  cohortSize: 0,
  isDefaultCanary: false,
  activeRolloutForType: false,
};

export interface AutoRemediationEvaluation {
  readonly decision: AutoRemediationDecision;
  readonly policy: DriftRemediationPolicy;
  readonly row: DriftInstanceStatusDetail | undefined;
}

/**
 * Read the policy, drift row, Canary facts, in-progress sections, and version-available sections
 * for one instance and run {@link decideAutoRemediation}. Canary/section reads are skipped when the
 * policy is not `auto` (the decision short-circuits on mode first). Throws only on DB failure.
 */
export function evaluateAutoRemediation(
  instance: ArrInstance,
  arrType: SyncPreviewArrType,
  nowMs: number
): AutoRemediationEvaluation {
  const policy = driftRemediationPolicyQueries.get(instance.id, arrType);
  const row = driftStatusQueries.getById(instance.id);
  if (policy.mode !== 'auto') {
    const decision = decideAutoRemediation({
      policy,
      row,
      nowMs,
      canary: NEUTRAL_CANARY,
      sectionsInProgress: [],
      versionAvailable: new Set(),
    });
    return { decision, policy, row };
  }

  const decision = decideAutoRemediation({
    policy,
    row,
    nowMs,
    canary: resolveCanaryContext(instance.id, arrType),
    sectionsInProgress: getSectionsInProgress(instance.id),
    versionAvailable: resolveVersionAvailableSections(arrType, row?.detectedVersion ?? null),
  });
  return { decision, policy, row };
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * `partial` is delivered as `drift.remediation.failed` (some sections did not apply) with copy
 * that says what actually happened; there is no separate partial type to subscribe to.
 */
export type DriftRemediationNotificationKind = 'applied' | 'partial' | 'failed' | 'held';

const NOTIFICATION_TYPE: Record<DriftRemediationNotificationKind, string> = {
  applied: 'drift.remediation.applied',
  partial: 'drift.remediation.failed',
  failed: 'drift.remediation.failed',
  held: 'drift.remediation.held',
};

export interface DriftRemediationNotificationInput {
  readonly kind: DriftRemediationNotificationKind;
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SyncPreviewSection[];
  readonly syncHistoryId: number | null;
}

const NOTIFICATION_COPY: Record<
  DriftRemediationNotificationKind,
  { readonly heading: string; readonly detail: string; readonly severity: NotificationSeverity; readonly color: number }
> = {
  applied: {
    heading: 'Drift auto-remediated',
    detail: 'Applied a reviewed plan for the drifted sections.',
    severity: 'success',
    color: Colors.SUCCESS,
  },
  partial: {
    heading: 'Drift auto-remediation partially applied',
    detail: 'Some drifted sections were applied and some failed; review Sync History and reconcile the rest.',
    severity: 'warning',
    color: Colors.WARNING,
  },
  failed: {
    heading: 'Drift auto-remediation failed',
    detail: 'The auto-remediation attempt did not complete; reconcile manually.',
    severity: 'error',
    color: Colors.ERROR,
  },
  held: {
    heading: 'Drift auto-remediation held for Canary',
    detail: 'Canary gating applies to this instance; review and reconcile manually.',
    severity: 'warning',
    color: Colors.WARNING,
  },
};

/** Fire-and-forget `drift.remediation.{applied|failed|held}` notification. Never throws. */
export function notifyDriftRemediation(input: DriftRemediationNotificationInput): void {
  try {
    const copy = NOTIFICATION_COPY[input.kind];
    const title = `${copy.heading} on ${input.instanceName} (${input.arrType})`;
    const sectionsText = input.sections.length > 0 ? input.sections.join(', ') : 'none';
    const driftLink = `/drift/${input.instanceId}`;
    const historyLink = input.syncHistoryId !== null ? `/sync-history/${input.syncHistoryId}` : null;
    const message = [
      copy.detail,
      `Sections: ${sectionsText}`,
      `Drift: ${driftLink}`,
      historyLink && `History: ${historyLink}`,
    ]
      .filter((line): line is string => typeof line === 'string')
      .join('\n');

    const embed = createEmbed()
      .author(`${getInstanceIcon(input.arrType)} ${input.instanceName}`)
      .title(title)
      .lines([copy.detail])
      .field('App', input.arrType, true)
      .field('Sections', sectionsText, true)
      .field('Drift', driftLink, false)
      .color(copy.color)
      .timestamp()
      .footer('Praxrr Drift Remediation');
    if (historyLink) {
      embed.field('Sync History', historyLink, false);
    }

    void notify(NOTIFICATION_TYPE[input.kind])
      .context({ instanceId: input.instanceId, instanceName: input.instanceName, arrType: input.arrType })
      .severity(copy.severity)
      .generic(title, message)
      .discord((discord) => discord.embed(embed))
      .send()
      .catch(() => {
        /* notification delivery is best-effort */
      });
  } catch {
    /* notification construction is best-effort */
  }
}

// ============================================================================
// ENQUEUE SHELL
// ============================================================================

export const DRIFT_REMEDIATE_DEDUPE_PREFIX = 'drift.remediate:';

/**
 * Called by drift persistence after a successful content refresh. Enqueues one `drift.remediate`
 * job (deduped per instance; a running job is never overridden) or records a once-per-signature
 * Canary hold. Synchronous, never writes to an Arr, never throws.
 */
export function queueAutoRemediationIfEligible(instance: ArrInstance): void {
  try {
    if (!isSyncPreviewArrType(instance.type) || instance.enabled !== 1) {
      return;
    }
    const arrType = instance.type;
    const nowMs = Date.now();
    const { decision, row } = evaluateAutoRemediation(instance, arrType, nowMs);

    if (decision.kind === 'skip') {
      if (decision.reason !== 'mode_off') {
        void logger.debug('Drift auto-remediation skipped', {
          source: SOURCE,
          meta: { instanceId: instance.id, reason: decision.reason },
        });
      }
      return;
    }

    const signature = row?.driftSignature;
    if (!signature) {
      return;
    }

    if (decision.kind === 'hold_canary') {
      // Claim the signature first so the hold is recorded and notified once per signature.
      if (!driftStatusQueries.markAutoAttempt(instance.id, signature)) {
        return;
      }
      driftStatusQueries.recordRemediation(instance.id, {
        trigger: 'auto',
        status: 'held_canary',
        signature,
        at: new Date(nowMs).toISOString(),
        syncHistoryId: null,
      });
      publishDriftRowUpdated(instance.id);
      notifyDriftRemediation({
        kind: 'held',
        instanceId: instance.id,
        instanceName: instance.name,
        arrType,
        sections: decision.sections,
        syncHistoryId: null,
      });
      return;
    }

    upsertScheduledJob({
      jobType: 'drift.remediate',
      payload: { instanceId: instance.id, driftSignature: decision.link.driftSignature },
      source: 'system',
      runAt: new Date(nowMs).toISOString(),
      dedupeKey: `${DRIFT_REMEDIATE_DEDUPE_PREFIX}${instance.id}`,
    });
  } catch (error) {
    void logger.error('Drift auto-remediation enqueue failed', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
