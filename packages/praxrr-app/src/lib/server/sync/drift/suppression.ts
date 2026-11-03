/**
 * Drift suppression (acknowledge / snooze) — pure core, no I/O.
 *
 * Suppression is a derived overlay over the stored drift row: the stored `status` stays
 * `drifted`, while notifications and health read the EFFECTIVE counts/signature computed here.
 *
 * Acknowledgements are CONTENT-aware: an ack covers the field-level diff the user reviewed, not
 * just the entity identity, so a new field change on an acknowledged entity alerts again.
 *
 * - Snooze is per instance and active iff `snoozedUntil > now`; it ignores signature changes.
 * - Instance ack is active iff `acknowledgedSignature === driftContentSignature(changes)`.
 * - A per-entity ack (`{ key, fingerprint }`) is active iff the current alerting change with that
 *   key has the same `driftEntityFingerprint`; active acks are subtracted from the alerting set.
 *
 * See docs/plans/drift-remediation/plan.md §3.2.
 */

import type { DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import type { SyncPreviewSection } from '$sync/preview/types.ts';
import { driftEntityFingerprint, driftEntityKey, signatureOfKeys } from './check.ts';
import type { DriftEntityAck, DriftEntityChange, DriftSuppression } from './types.ts';

/** Upper bound on a snooze window (90 days). */
export const DRIFT_SNOOZE_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/** Row fields suppression resolution depends on. */
export type DriftSuppressionRow = Pick<
  DriftInstanceStatusDetail,
  'status' | 'changes' | 'acknowledgedSignature' | 'acknowledgedAt' | 'acknowledgedEntities' | 'snoozedUntil'
>;

/** Alerting = managed drift (update) or missing (create); mirrors `driftSignature`'s filter. */
function isAlerting(change: DriftEntityChange): boolean {
  return (
    (change.category === 'drift' || change.category === 'missing') &&
    (change.action === 'update' || change.action === 'create')
  );
}

/** Entity keys of the alerting (drift+missing) changes, in change order. */
export function alertingKeys(changes: readonly DriftEntityChange[]): string[] {
  return changes.filter(isAlerting).map(driftEntityKey);
}

/**
 * Content signature over the alerting changes (key + field diff) — what an instance ack covers.
 * Unlike the key-only `driftSignature` (notification dedup + value guard), it changes when an
 * already-drifted entity drifts further. `null` when nothing alerts.
 */
export function driftContentSignature(changes: readonly DriftEntityChange[]): string | null {
  return signatureOfKeys(changes.filter(isAlerting).map(driftEntityFingerprint));
}

/** Content-matching acks for the current alerting changes (key → ack), stale acks dropped. */
export function currentEntityAcks(
  changes: readonly DriftEntityChange[],
  acks: readonly DriftEntityAck[]
): DriftEntityAck[] {
  const fingerprints = new Map(changes.filter(isAlerting).map((change) => [driftEntityKey(change), change]));
  return acks.filter((ack) => {
    const change = fingerprints.get(ack.key);
    return change !== undefined && driftEntityFingerprint(change) === ack.fingerprint;
  });
}

/** Acks for `keys` at their CURRENT content (the server-side fingerprint of what the user saw). */
export function entityAcksFor(changes: readonly DriftEntityChange[], keys: readonly string[]): DriftEntityAck[] {
  const wanted = new Set(keys);
  return changes
    .filter((change) => isAlerting(change) && wanted.has(driftEntityKey(change)))
    .map((change) => ({ key: driftEntityKey(change), fingerprint: driftEntityFingerprint(change) }));
}

function isSnoozeActive(snoozedUntil: string | null, nowMs: number): boolean {
  if (snoozedUntil === null) {
    return false;
  }
  const untilMs = Date.parse(snoozedUntil);
  return Number.isFinite(untilMs) && untilMs > nowMs;
}

const NO_SUPPRESSION: DriftSuppression = {
  state: 'none',
  acknowledgedSignature: null,
  acknowledgedAt: null,
  acknowledgedEntityKeys: [],
  snoozedUntil: null,
  effectiveDrifted: 0,
  effectiveMissing: 0,
  effectiveSignature: null,
};

/**
 * Resolve the effective suppression for a stored drift row at `nowMs`. An absent row (never
 * checked) or an `in-sync` row has nothing alerting. An active snooze or instance ack zeroes the
 * effective counts and signature; otherwise content-matching entity acks are subtracted.
 */
export function resolveDriftSuppression(row: DriftSuppressionRow | undefined, nowMs: number): DriftSuppression {
  if (!row) {
    return NO_SUPPRESSION;
  }

  const alerting = row.status === 'in-sync' ? [] : row.changes.filter(isAlerting);
  const snoozed = isSnoozeActive(row.snoozedUntil, nowMs);
  const contentSignature = driftContentSignature(alerting);
  const instanceAcked = row.acknowledgedSignature !== null && row.acknowledgedSignature === contentSignature;
  const ackedKeys = currentEntityAcks(alerting, row.acknowledgedEntities).map((ack) => ack.key);
  const ackedKeySet = new Set(ackedKeys);

  const acknowledgedSignature = instanceAcked ? row.acknowledgedSignature : null;
  const acknowledgedAt = instanceAcked || ackedKeys.length > 0 ? row.acknowledgedAt : null;
  const snoozedUntil = snoozed ? row.snoozedUntil : null;

  if (snoozed || instanceAcked) {
    return {
      state: snoozed ? 'snoozed' : 'acknowledged',
      acknowledgedSignature,
      acknowledgedAt,
      acknowledgedEntityKeys: ackedKeys,
      snoozedUntil,
      effectiveDrifted: 0,
      effectiveMissing: 0,
      effectiveSignature: null,
    };
  }

  const unacked = alerting.filter((change) => !ackedKeySet.has(driftEntityKey(change)));
  const state = ackedKeys.length === 0 ? 'none' : unacked.length === 0 ? 'acknowledged' : 'partially_acknowledged';

  return {
    state,
    acknowledgedSignature,
    acknowledgedAt,
    acknowledgedEntityKeys: ackedKeys,
    snoozedUntil,
    effectiveDrifted: unacked.filter((change) => change.category === 'drift').length,
    effectiveMissing: unacked.filter((change) => change.category === 'missing').length,
    effectiveSignature: signatureOfKeys(unacked.map(driftEntityKey)),
  };
}

/**
 * Sections with ≥1 alerting change, minus sections containing an ACTIVE (content-matching) entity
 * ack (an ack means the divergence is intentional, so the section must not be reverted). A stale
 * ack — the entity drifted further since — no longer blocks. First-seen order.
 */
export function remediableSections(
  changes: readonly DriftEntityChange[],
  acks: readonly DriftEntityAck[]
): SyncPreviewSection[] {
  const acked = new Set(currentEntityAcks(changes, acks).map((ack) => ack.key));
  const ordered: SyncPreviewSection[] = [];
  const blocked = new Set<SyncPreviewSection>();
  for (const change of changes) {
    if (acked.has(driftEntityKey(change))) {
      blocked.add(change.section);
    }
    if (isAlerting(change) && !ordered.includes(change.section)) {
      ordered.push(change.section);
    }
  }
  return ordered.filter((section) => !blocked.has(section));
}
