/**
 * Pure unit tests for the drift aggregation core (design §10 "Pure unit").
 *
 * Exercises the three side-effect-free functions that hold the drift semantics:
 *   - `aggregateDrift` — action→category→count mapping, nested section reads, and
 *     `allSectionsErrored`/`comparedAny` derivation from `sectionOutcomes`.
 *   - `driftSignature` — order-stable, remoteId-qualified dedup key over alerting changes.
 *   - `shouldNotify` — the notification transition predicate.
 *
 * No IO: every input is a hand-built fixture, so these tests never touch the DB, the
 * PCD cache, the preview orchestrator, or the notification pipeline.
 */

import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { aggregateDrift, driftSignature } from '$sync/drift/check.ts';
import { shouldNotify } from '$sync/drift/persist.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type {
  EntityChange,
  SyncPreviewAction,
  SyncPreviewSection,
  SyncPreviewSectionOutcome,
} from '$sync/preview/types.ts';
import type { DriftEntityChange, InstanceDriftResult } from '$sync/drift/types.ts';
import type { DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';

// ============================================================================
// Fixture builders
// ============================================================================

function entity(action: SyncPreviewAction, overrides: Partial<EntityChange> = {}): EntityChange {
  return {
    entityType: 'customFormat',
    name: 'Entity',
    action,
    remoteId: null,
    fields: [],
    ...overrides,
  };
}

function outcome(section: SyncPreviewSection, error: string | null = null, skipped = false): SyncPreviewSectionOutcome {
  return { section, error, skipped };
}

function makePreview(overrides: Partial<GeneratePreviewResult> = {}): GeneratePreviewResult {
  return {
    instanceId: 1,
    instanceName: 'Radarr',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: [],
    sectionOutcomes: [],
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    errors: [],
    ...overrides,
  };
}

function driftChange(
  action: 'create' | 'update' | 'delete',
  overrides: Partial<DriftEntityChange> = {}
): DriftEntityChange {
  const category = action === 'update' ? 'drift' : action === 'create' ? 'missing' : 'unmanaged';
  return {
    section: 'qualityProfiles',
    entityType: 'customFormat',
    name: 'CF',
    action,
    category,
    remoteId: null,
    fields: [],
    ...overrides,
  };
}

function makeNext(overrides: Partial<InstanceDriftResult> = {}): InstanceDriftResult {
  return {
    instanceId: 1,
    instanceName: 'Radarr',
    arrType: 'radarr',
    status: 'in-sync',
    reason: null,
    detectedVersion: null,
    counts: { drifted: 0, missing: 0, unmanaged: 0 },
    changes: [],
    driftSignature: null,
    checkedAt: '2026-01-01T00:00:00.000Z',
    contentCheckedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
    ...overrides,
  };
}

function makePrior(overrides: Partial<DriftInstanceStatusDetail> = {}): DriftInstanceStatusDetail {
  return {
    arrInstanceId: 1,
    arrType: 'radarr',
    status: 'in-sync',
    reason: null,
    counts: { drifted: 0, missing: 0, unmanaged: 0 },
    driftSignature: null,
    notifiedSignature: null,
    detectedVersion: null,
    changes: [],
    checkedAt: '2026-01-01T00:00:00.000Z',
    contentCheckedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const QP_ONLY = new Set<SyncPreviewSection>(['qualityProfiles']);

// ============================================================================
// aggregateDrift — action → category → count mapping
// ============================================================================

Deno.test('aggregateDrift maps update→drift, create→missing, delete→unmanaged with matching counts', () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [
        entity('update', { name: 'Drifted CF' }),
        entity('create', { name: 'Missing CF' }),
        entity('delete', { name: 'Unmanaged CF' }),
      ],
      qualityProfiles: [],
    },
    sectionOutcomes: [outcome('qualityProfiles')],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.changes.length, 3);

  const byName = new Map(result.changes.map((c) => [c.name, c]));
  assertEquals(byName.get('Drifted CF')?.action, 'update');
  assertEquals(byName.get('Drifted CF')?.category, 'drift');
  assertEquals(byName.get('Missing CF')?.action, 'create');
  assertEquals(byName.get('Missing CF')?.category, 'missing');
  assertEquals(byName.get('Unmanaged CF')?.action, 'delete');
  assertEquals(byName.get('Unmanaged CF')?.category, 'unmanaged');

  assertEquals(result.counts, { drifted: 1, missing: 1, unmanaged: 1 });
  assertEquals(result.comparedAny, true);
  assertEquals(result.allSectionsErrored, false);
});

Deno.test("aggregateDrift never emits 'unchanged' entities into changes or counts", () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [
        entity('unchanged', { name: 'Stable CF' }),
        entity('update', { name: 'Drifted CF' }),
        entity('unchanged', { name: 'Another Stable CF' }),
      ],
      qualityProfiles: [],
    },
    sectionOutcomes: [outcome('qualityProfiles')],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0].name, 'Drifted CF');
  assert(!result.changes.some((c) => c.action === ('unchanged' as string)));
  assertEquals(result.counts, { drifted: 1, missing: 0, unmanaged: 0 });
});

// ============================================================================
// aggregateDrift — nested section reads (DC-2)
// ============================================================================

Deno.test('aggregateDrift detects CF drift nested under preview.qualityProfiles.customFormats (DC-2)', () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('update', { entityType: 'customFormat', name: 'HD Bluray Tier 01' })],
      qualityProfiles: [],
    },
    sectionOutcomes: [outcome('qualityProfiles')],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0].section, 'qualityProfiles');
  assertEquals(result.changes[0].entityType, 'customFormat');
  assertEquals(result.changes[0].name, 'HD Bluray Tier 01');
  assertEquals(result.changes[0].category, 'drift');
  assertEquals(result.counts.drifted, 1);
});

Deno.test('aggregateDrift reads every nested section payload (QP, delay, media, metadata)', () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('update', { name: 'CF' })],
      qualityProfiles: [entity('update', { entityType: 'qualityProfile', name: 'QP' })],
    },
    delayProfiles: {
      section: 'delayProfiles',
      profile: entity('update', { entityType: 'delayProfile', name: 'Delay' }),
    },
    mediaManagement: {
      section: 'mediaManagement',
      naming: entity('update', { entityType: 'naming', name: 'Naming' }),
      mediaSettings: entity('update', { entityType: 'mediaSettings', name: 'Media' }),
      qualityDefinitions: [entity('update', { entityType: 'qualityDefinition', name: 'QD' })],
    },
    metadataProfiles: {
      section: 'metadataProfiles',
      profile: entity('update', { entityType: 'metadataProfile', name: 'Meta' }),
    },
    sectionOutcomes: [
      outcome('qualityProfiles'),
      outcome('delayProfiles'),
      outcome('mediaManagement'),
      outcome('metadataProfiles'),
    ],
  });

  const all = new Set<SyncPreviewSection>(['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles']);
  const result = aggregateDrift(preview, all);

  // CF + QP + delay + naming + media + QD + metadata = 7 update entities.
  assertEquals(result.counts, { drifted: 7, missing: 0, unmanaged: 0 });
  assertEquals(result.changes.length, 7);
});

// ============================================================================
// aggregateDrift — allSectionsErrored derives from sectionOutcomes, NOT null fields (DC-3)
// ============================================================================

Deno.test('aggregateDrift: null section field + errored outcome → allSectionsErrored (DC-3)', () => {
  const preview = makePreview({
    qualityProfiles: null,
    sectionOutcomes: [outcome('qualityProfiles', 'boom')],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.allSectionsErrored, true);
  assertEquals(result.comparedAny, false);
  assertEquals(result.changes.length, 0);
});

Deno.test('aggregateDrift: SAME null section field + succeeded outcome → NOT errored (DC-3 discriminator)', () => {
  // Identical null `qualityProfiles` field as the errored case above; only the outcome
  // differs. Proves classification derives from sectionOutcomes, not the null field.
  const preview = makePreview({
    qualityProfiles: null,
    sectionOutcomes: [outcome('qualityProfiles', null, false)],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.allSectionsErrored, false);
  assertEquals(result.comparedAny, true);
  assertEquals(result.changes.length, 0);
});

Deno.test('aggregateDrift: mixed errored + succeeded available sections → not allSectionsErrored', () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('update', { name: 'CF' })],
      qualityProfiles: [],
    },
    delayProfiles: null,
    sectionOutcomes: [outcome('qualityProfiles', null), outcome('delayProfiles', 'boom')],
  });

  const result = aggregateDrift(preview, new Set<SyncPreviewSection>(['qualityProfiles', 'delayProfiles']));

  assertEquals(result.allSectionsErrored, false);
  assertEquals(result.comparedAny, true);
  assertEquals(result.counts.drifted, 1);
});

Deno.test('aggregateDrift: only a skipped outcome → neither errored nor compared', () => {
  const preview = makePreview({
    qualityProfiles: null,
    sectionOutcomes: [outcome('qualityProfiles', null, true)],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.allSectionsErrored, false);
  assertEquals(result.comparedAny, false);
});

// ============================================================================
// aggregateDrift — sections outside availableSections are excluded
// ============================================================================

Deno.test('aggregateDrift excludes sections and outcomes outside availableSections', () => {
  const preview = makePreview({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('update', { name: 'In-scope CF' })],
      qualityProfiles: [],
    },
    // Drift present in delayProfiles, but delayProfiles is NOT in availableSections.
    delayProfiles: {
      section: 'delayProfiles',
      profile: entity('update', { entityType: 'delayProfile', name: 'Out-of-scope Delay' }),
    },
    sectionOutcomes: [
      outcome('qualityProfiles', null),
      // An errored out-of-scope outcome must not poison allSectionsErrored.
      outcome('delayProfiles', 'boom'),
    ],
  });

  const result = aggregateDrift(preview, QP_ONLY);

  assertEquals(result.changes.length, 1);
  assertEquals(result.changes[0].name, 'In-scope CF');
  assert(!result.changes.some((c) => c.section === 'delayProfiles'));
  assertEquals(result.allSectionsErrored, false);
  assertEquals(result.comparedAny, true);
});

// ============================================================================
// driftSignature
// ============================================================================

Deno.test('driftSignature is stable under reordering of the same change set', () => {
  const a = [
    driftChange('update', { name: 'Alpha', remoteId: 1 }),
    driftChange('create', { name: 'Beta', remoteId: null }),
    driftChange('update', { name: 'Gamma', remoteId: 3 }),
  ];
  const reordered = [a[2], a[0], a[1]];

  const sigA = driftSignature(a);
  const sigReordered = driftSignature(reordered);

  assertNotEquals(sigA, null);
  assertEquals(sigA, sigReordered);
});

Deno.test('driftSignature is sensitive: adding a drifted entity changes the hash', () => {
  const base = [driftChange('update', { name: 'Alpha', remoteId: 1 })];
  const augmented = [
    driftChange('update', { name: 'Alpha', remoteId: 1 }),
    driftChange('update', { name: 'Delta', remoteId: 2 }),
  ];

  assertNotEquals(driftSignature(base), driftSignature(augmented));
});

Deno.test('driftSignature disambiguates same-name update entities by remoteId', () => {
  const first = [driftChange('update', { name: 'Same Name', remoteId: 1 })];
  const second = [driftChange('update', { name: 'Same Name', remoteId: 2 })];

  const sigFirst = driftSignature(first);
  const sigSecond = driftSignature(second);

  assertNotEquals(sigFirst, null);
  assertNotEquals(sigSecond, null);
  assertNotEquals(sigFirst, sigSecond);
});

Deno.test('driftSignature excludes delete (unmanaged) changes from the hash', () => {
  const alertingOnly = [driftChange('update', { name: 'Alpha', remoteId: 1 })];
  const withDelete = [
    driftChange('update', { name: 'Alpha', remoteId: 1 }),
    driftChange('delete', { name: 'Unmanaged Thing', remoteId: 9 }),
  ];

  // The delete must not perturb the dedup key derived from alerting drift.
  assertEquals(driftSignature(alertingOnly), driftSignature(withDelete));
});

Deno.test("driftSignature excludes 'unchanged'-actioned entries from the hash", () => {
  const alertingOnly = [driftChange('create', { name: 'Missing', remoteId: null })];
  // A non-alerting/unchanged entry (constructed via cast; aggregateDrift never emits one)
  // must be filtered out just like delete.
  const withUnchanged = [
    driftChange('create', { name: 'Missing', remoteId: null }),
    { ...driftChange('update'), action: 'unchanged' } as unknown as DriftEntityChange,
  ];

  assertEquals(driftSignature(alertingOnly), driftSignature(withUnchanged));
});

Deno.test('driftSignature returns null when there is no alerting drift', () => {
  assertEquals(driftSignature([]), null);
  assertEquals(driftSignature([driftChange('delete', { name: 'Only Unmanaged', remoteId: 5 })]), null);
});

// ============================================================================
// shouldNotify — full transition matrix
// ============================================================================

Deno.test('shouldNotify fires on first-ever drift (no prior row)', () => {
  const next = makeNext({ status: 'drifted', driftSignature: 'sig-a' });
  assertEquals(shouldNotify(undefined, next), true);
});

Deno.test('shouldNotify fires on in-sync → drifted transition', () => {
  const prior = makePrior({ status: 'in-sync', notifiedSignature: null });
  const next = makeNext({ status: 'drifted', driftSignature: 'sig-a' });
  assertEquals(shouldNotify(prior, next), true);
});

Deno.test('shouldNotify does NOT fire on drifted → drifted with unchanged signature', () => {
  const prior = makePrior({ status: 'drifted', notifiedSignature: 'sig-a' });
  const next = makeNext({ status: 'drifted', driftSignature: 'sig-a' });
  assertEquals(shouldNotify(prior, next), false);
});

Deno.test('shouldNotify fires on drifted → drifted when the signature changed', () => {
  const prior = makePrior({ status: 'drifted', notifiedSignature: 'sig-a' });
  const next = makeNext({ status: 'drifted', driftSignature: 'sig-b' });
  assertEquals(shouldNotify(prior, next), true);
});

Deno.test('shouldNotify does NOT fire on drifted → in-sync recovery', () => {
  const prior = makePrior({ status: 'drifted', notifiedSignature: 'sig-a' });
  const next = makeNext({ status: 'in-sync', driftSignature: null });
  assertEquals(shouldNotify(prior, next), false);
});

Deno.test('shouldNotify does NOT fire on reachability/error statuses (unreachable, unauthorized, error)', () => {
  const prior = makePrior({ status: 'drifted', notifiedSignature: 'sig-a' });

  for (const status of ['unreachable', 'unauthorized', 'error'] as const) {
    const next = makeNext({ status, reason: 'error', driftSignature: null });
    assertEquals(shouldNotify(prior, next), false, `status=${status} must not notify`);
  }
});
