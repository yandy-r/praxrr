/**
 * Pure unit tests for drift suppression (acknowledge / snooze) and the entity-key helpers.
 * See docs/plans/drift-remediation/plan.md §3.2 / §8 "Snooze expiry".
 *
 * No IO: rows are hand-built fixtures.
 */

import { assertEquals, assertNotEquals } from '@std/assert';
import { driftEntityFingerprint, driftEntityKey, driftSignature, signatureOfKeys } from '$sync/drift/check.ts';
import {
  alertingKeys,
  DRIFT_SNOOZE_MAX_MS,
  driftContentSignature,
  entityAcksFor,
  type DriftSuppressionRow,
  remediableSections,
  resolveDriftSuppression,
} from '$sync/drift/suppression.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';

// ============================================================================
// Fixtures
// ============================================================================

const NOW_MS = Date.parse('2026-11-03T12:00:00.000Z');

function change(overrides: Partial<DriftEntityChange> = {}): DriftEntityChange {
  return {
    section: 'qualityProfiles',
    entityType: 'custom_format',
    name: 'HDR10',
    action: 'update',
    category: 'drift',
    remoteId: 42,
    fields: [],
    ...overrides,
  };
}

const DRIFT_CF = change();
const MISSING_QP = change({
  entityType: 'quality_profile',
  name: 'HD-1080p',
  action: 'create',
  category: 'missing',
  remoteId: null,
});
const DRIFT_MM = change({ section: 'mediaManagement', entityType: 'naming', name: 'naming', remoteId: null });
const UNMANAGED = change({ name: 'Stray', action: 'delete', category: 'unmanaged', remoteId: 7 });
const PRUNE = change({ name: 'Removed', action: 'delete', category: 'prune', remoteId: 8 });

const CHANGES: DriftEntityChange[] = [DRIFT_CF, MISSING_QP, DRIFT_MM, UNMANAGED, PRUNE];
const SIGNATURE = driftSignature(CHANGES);
const CONTENT_SIGNATURE = driftContentSignature(CHANGES);

/** Ack for a change at its current content. */
function ack(target: DriftEntityChange) {
  return { key: driftEntityKey(target), fingerprint: driftEntityFingerprint(target) };
}

function row(overrides: Partial<DriftSuppressionRow> = {}): DriftSuppressionRow {
  return {
    status: 'drifted',
    changes: CHANGES,
    acknowledgedSignature: null,
    acknowledgedAt: null,
    acknowledgedEntities: [],
    snoozedUntil: null,
    ...overrides,
  };
}

// ============================================================================
// driftEntityKey / signatureOfKeys / driftSignature
// ============================================================================

/** The pre-refactor driftSignature algorithm, inlined verbatim as a byte-identity oracle. */
function legacyDriftSignature(changes: readonly DriftEntityChange[]): string | null {
  const tokens = changes
    .filter(
      (c) => (c.category === 'drift' || c.category === 'missing') && (c.action === 'update' || c.action === 'create')
    )
    .map((c) => `${c.section}|${c.entityType}|${c.name}|${c.remoteId ?? 'new'}|${c.action}`)
    .sort();
  if (tokens.length === 0) return null;
  let hash = 0x811c9dc5;
  const input = tokens.join('\n');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

Deno.test('driftEntityKey returns the remoteId-qualified signature token', () => {
  assertEquals(driftEntityKey(DRIFT_CF), 'qualityProfiles|custom_format|HDR10|42|update');
  assertEquals(driftEntityKey(MISSING_QP), 'qualityProfiles|quality_profile|HD-1080p|new|create');
});

Deno.test('driftSignature output is byte-identical to the pre-refactor algorithm', () => {
  assertEquals(driftSignature(CHANGES), legacyDriftSignature(CHANGES));
  assertEquals(driftSignature([DRIFT_MM]), legacyDriftSignature([DRIFT_MM]));
  assertEquals(driftSignature([UNMANAGED, PRUNE]), null);
  assertEquals(driftSignature([]), null);
});

Deno.test('signatureOfKeys is order-insensitive, null when empty, and equals driftSignature over alerting keys', () => {
  const keys = alertingKeys(CHANGES);
  assertEquals(signatureOfKeys(keys), SIGNATURE);
  assertEquals(signatureOfKeys([...keys].reverse()), SIGNATURE);
  assertEquals(signatureOfKeys([]), null);
  // Does not mutate its input.
  const input = ['b', 'a'];
  signatureOfKeys(input);
  assertEquals(input, ['b', 'a']);
});

Deno.test('alertingKeys keeps drift+missing only, in change order', () => {
  assertEquals(alertingKeys(CHANGES), [driftEntityKey(DRIFT_CF), driftEntityKey(MISSING_QP), driftEntityKey(DRIFT_MM)]);
});

// ============================================================================
// resolveDriftSuppression
// ============================================================================

Deno.test('resolveDriftSuppression: absent row and unsuppressed drift', () => {
  assertEquals(resolveDriftSuppression(undefined, NOW_MS), {
    state: 'none',
    acknowledgedSignature: null,
    acknowledgedAt: null,
    acknowledgedEntityKeys: [],
    snoozedUntil: null,
    effectiveDrifted: 0,
    effectiveMissing: 0,
    effectiveSignature: null,
  });

  const open = resolveDriftSuppression(row(), NOW_MS);
  assertEquals(open.state, 'none');
  assertEquals(open.effectiveDrifted, 2);
  assertEquals(open.effectiveMissing, 1);
  assertEquals(open.effectiveSignature, SIGNATURE);
});

Deno.test('resolveDriftSuppression: snooze active at now+1ms, expired at now >= until', () => {
  const until = new Date(NOW_MS + 1).toISOString();
  const snoozed = resolveDriftSuppression(row({ snoozedUntil: until }), NOW_MS);
  assertEquals(snoozed.state, 'snoozed');
  assertEquals(snoozed.snoozedUntil, until);
  assertEquals(snoozed.effectiveDrifted, 0);
  assertEquals(snoozed.effectiveMissing, 0);
  assertEquals(snoozed.effectiveSignature, null);

  const atBoundary = resolveDriftSuppression(row({ snoozedUntil: until }), NOW_MS + 1);
  assertEquals(atBoundary.state, 'none');
  assertEquals(atBoundary.snoozedUntil, null);
  assertEquals(atBoundary.effectiveDrifted, 2);
  assertEquals(atBoundary.effectiveSignature, SIGNATURE);

  const past = resolveDriftSuppression(row({ snoozedUntil: new Date(NOW_MS - 1).toISOString() }), NOW_MS);
  assertEquals(past.state, 'none');
  assertEquals(past.effectiveMissing, 1);

  // Unparseable snooze is never treated as active.
  assertEquals(resolveDriftSuppression(row({ snoozedUntil: 'not-a-date' }), NOW_MS).state, 'none');
});

Deno.test('resolveDriftSuppression: snooze survives a signature change', () => {
  const until = new Date(NOW_MS + 60_000).toISOString();
  const changed = [DRIFT_CF, change({ name: 'Brand New', remoteId: 99 })];
  const result = resolveDriftSuppression(row({ changes: changed, snoozedUntil: until }), NOW_MS);
  assertEquals(result.state, 'snoozed');
  assertEquals(result.effectiveDrifted, 0);
  assertEquals(result.effectiveSignature, null);
});

Deno.test('resolveDriftSuppression: instance ack is active only while it equals the content signature', () => {
  const acked = resolveDriftSuppression(
    row({ acknowledgedSignature: CONTENT_SIGNATURE, acknowledgedAt: '2026-11-03T11:00:00.000Z' }),
    NOW_MS
  );
  assertEquals(acked.state, 'acknowledged');
  assertEquals(acked.acknowledgedSignature, CONTENT_SIGNATURE);
  assertEquals(acked.acknowledgedAt, '2026-11-03T11:00:00.000Z');
  assertEquals(acked.effectiveDrifted, 0);
  assertEquals(acked.effectiveMissing, 0);
  assertEquals(acked.effectiveSignature, null);

  const stale = resolveDriftSuppression(
    row({ acknowledgedSignature: 'deadbeef', acknowledgedAt: '2026-11-03T11:00:00.000Z' }),
    NOW_MS
  );
  assertEquals(stale.state, 'none');
  assertEquals(stale.acknowledgedSignature, null);
  assertEquals(stale.acknowledgedAt, null);
  assertEquals(stale.effectiveSignature, SIGNATURE);
});

Deno.test('resolveDriftSuppression: per-entity acks subtract and partially acknowledge', () => {
  const ackedKey = driftEntityKey(DRIFT_CF);
  const partial = resolveDriftSuppression(
    row({
      acknowledgedEntities: [ack(DRIFT_CF), { key: 'stale|key', fingerprint: 'x' }],
      acknowledgedAt: '2026-11-03T11:00:00.000Z',
    }),
    NOW_MS
  );
  assertEquals(partial.state, 'partially_acknowledged');
  // Keys absent from the current alerting set are not reported.
  assertEquals(partial.acknowledgedEntityKeys, [ackedKey]);
  assertEquals(partial.effectiveDrifted, 1);
  assertEquals(partial.effectiveMissing, 1);
  assertEquals(partial.effectiveSignature, signatureOfKeys([driftEntityKey(MISSING_QP), driftEntityKey(DRIFT_MM)]));
  assertNotEquals(partial.effectiveSignature, SIGNATURE);

  const all = resolveDriftSuppression(
    row({ acknowledgedEntities: entityAcksFor(CHANGES, alertingKeys(CHANGES)) }),
    NOW_MS
  );
  assertEquals(all.state, 'acknowledged');
  assertEquals(all.effectiveDrifted, 0);
  assertEquals(all.effectiveSignature, null);

  // Acking a non-alerting (unmanaged) key is not a suppression.
  const nonAlerting = resolveDriftSuppression(row({ acknowledgedEntities: [ack(UNMANAGED)] }), NOW_MS);
  assertEquals(nonAlerting.state, 'none');
  assertEquals(nonAlerting.acknowledgedEntityKeys, []);
});

Deno.test('resolveDriftSuppression: in-sync row has nothing alerting', () => {
  const result = resolveDriftSuppression(row({ status: 'in-sync', changes: [UNMANAGED] }), NOW_MS);
  assertEquals(result.state, 'none');
  assertEquals(result.effectiveDrifted, 0);
  assertEquals(result.effectiveSignature, null);
});

Deno.test('DRIFT_SNOOZE_MAX_MS is 90 days', () => {
  assertEquals(DRIFT_SNOOZE_MAX_MS, 90 * 24 * 60 * 60 * 1000);
});

// ============================================================================
// remediableSections
// ============================================================================

Deno.test('remediableSections: alerting sections minus sections containing an acked entity', () => {
  assertEquals(remediableSections(CHANGES, []), ['qualityProfiles', 'mediaManagement']);
  assertEquals(remediableSections(CHANGES, [ack(DRIFT_CF)]), ['mediaManagement']);
  assertEquals(remediableSections(CHANGES, [ack(DRIFT_MM)]), ['qualityProfiles']);
  // Sections with only non-alerting changes are never remediable.
  assertEquals(remediableSections([UNMANAGED, PRUNE], []), []);
  assertEquals(remediableSections([], []), []);
});

// ============================================================================
// Content-aware acknowledgement (an ack covers the reviewed field diff, not just the entity)
// ============================================================================

const EDITED_CF = change({ fields: [{ field: 'score', type: 'changed', current: 10, desired: 50 }] });
const EDITED_CHANGES: DriftEntityChange[] = [EDITED_CF, MISSING_QP, DRIFT_MM, UNMANAGED, PRUNE];

Deno.test('driftEntityFingerprint: same key, different fields → different fingerprint; key order stable', () => {
  assertEquals(driftEntityKey(EDITED_CF), driftEntityKey(DRIFT_CF));
  assertNotEquals(driftEntityFingerprint(EDITED_CF), driftEntityFingerprint(DRIFT_CF));
  const reordered = change({ fields: [{ desired: 50, current: 10, type: 'changed', field: 'score' }] as never });
  assertEquals(driftEntityFingerprint(reordered), driftEntityFingerprint(EDITED_CF));
  // Key-only driftSignature is unaffected (notify dedup / value guard), the content signature moves.
  assertEquals(driftSignature(EDITED_CHANGES), SIGNATURE);
  assertNotEquals(driftContentSignature(EDITED_CHANGES), CONTENT_SIGNATURE);
});

Deno.test('resolveDriftSuppression: an entity ack stops covering the entity once its fields change', () => {
  const stale = resolveDriftSuppression(
    row({ changes: EDITED_CHANGES, acknowledgedEntities: [ack(DRIFT_CF)] }),
    NOW_MS
  );
  assertEquals(stale.state, 'none');
  assertEquals(stale.acknowledgedEntityKeys, []);
  assertEquals(stale.effectiveDrifted, 2);
  assertEquals(stale.effectiveSignature, SIGNATURE);
  // The section is remediable again: a stale ack no longer marks the divergence as intentional.
  assertEquals(remediableSections(EDITED_CHANGES, [ack(DRIFT_CF)]), ['qualityProfiles', 'mediaManagement']);
});

Deno.test('resolveDriftSuppression: an instance ack stops covering the drift once any field changes', () => {
  const result = resolveDriftSuppression(
    row({ changes: EDITED_CHANGES, acknowledgedSignature: CONTENT_SIGNATURE }),
    NOW_MS
  );
  assertEquals(result.state, 'none');
  assertEquals(result.acknowledgedSignature, null);
  assertEquals(result.effectiveSignature, SIGNATURE);
});
