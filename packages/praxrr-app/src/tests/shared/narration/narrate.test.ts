import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { EntityChange, SyncPreviewArrType, SyncPreviewSectionOutcome } from '$sync/preview/types.ts';
import type { DriftEntityChange, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import {
  NARRATION_TEMPLATE_VERSION,
  narrateDriftCounts,
  narrateDriftEntity,
  narrateDriftReason,
  narrateEntityChange,
  narrateEntityChanges,
  narrateSyncPreviewError,
  narrateSyncPreviewSummary,
  narrateSyncSectionOutcome,
} from '../../../lib/shared/narration/index.ts';
import {
  resolveEntityLabel,
  resolveFieldCountPhrase,
  resolveFieldLabel,
  resolveFieldVerb,
} from '../../../lib/shared/narration/templates.ts';

// --- narrateEntityChange (the reusable core) ---------------------------------------------

Deno.test('narrateEntityChange: create summarizes to a single decision headline', () => {
  const change: EntityChange = {
    entityType: 'customFormat',
    name: 'HDR',
    action: 'create',
    remoteId: null,
    fields: [],
  };
  assertEquals(narrateEntityChange(change, 'radarr', 'qualityProfiles', 'summary'), {
    headline: 'Praxrr plans to add Custom Format "HDR".',
    detail: [],
    tone: 'info',
    templateVersion: '2',
  });
});

Deno.test('narrateEntityChange: update verbose adds one detail line per field', () => {
  const change: EntityChange = {
    entityType: 'qualityProfile',
    name: 'HD-1080p',
    action: 'update',
    remoteId: 12,
    fields: [
      { field: 'cutoff', type: 'changed', current: 'a', desired: 'b' },
      { field: 'name', type: 'added', current: null, desired: 'HD' },
    ],
  };
  assertEquals(narrateEntityChange(change, 'radarr', 'qualityProfiles', 'verbose'), {
    headline: 'Praxrr plans to update Quality Profile "HD-1080p" (2 fields differ).',
    detail: ['Cutoff quality changed.', 'Name set.'],
    tone: 'info',
    templateVersion: '2',
  });
});

Deno.test('narrateEntityChange: update summary keeps detail empty', () => {
  const change: EntityChange = {
    entityType: 'qualityProfile',
    name: 'HD',
    action: 'update',
    remoteId: 1,
    fields: [{ field: 'cutoff', type: 'changed', current: 'a', desired: 'b' }],
  };
  const line = narrateEntityChange(change, 'radarr', 'qualityProfiles', 'summary');
  assertEquals(line.detail, []);
  assertEquals(line.headline, 'Praxrr plans to update Quality Profile "HD" (1 field differs).');
});

Deno.test('narrateEntityChange: delete does not over-explain (no verbose detail)', () => {
  const change: EntityChange = { entityType: 'customFormat', name: 'Old', action: 'delete', remoteId: 5, fields: [] };
  const line = narrateEntityChange(change, 'radarr', 'qualityProfiles', 'verbose');
  assertEquals(line.headline, 'Praxrr plans to remove Custom Format "Old".');
  assertEquals(line.detail, []);
  assertEquals(line.tone, 'info');
});

Deno.test('narrateEntityChange: unchanged collapses to a terse neutral line', () => {
  const change: EntityChange = {
    entityType: 'qualityProfile',
    name: 'Any',
    action: 'unchanged',
    remoteId: 1,
    fields: [],
  };
  const summary = narrateEntityChange(change, 'radarr', 'qualityProfiles', 'summary');
  const verbose = narrateEntityChange(change, 'radarr', 'qualityProfiles', 'verbose');
  assertEquals(summary.headline, 'Quality Profile "Any" already matches the resolved config.');
  assertEquals(summary.tone, 'neutral');
  assertEquals(verbose.detail, []); // unchanged never gets verbose noise
});

// --- template resolvers ------------------------------------------------------------------

Deno.test('resolveFieldVerb: each field-change type maps to a distinct verb', () => {
  assertEquals(resolveFieldVerb('added'), 'set');
  assertEquals(resolveFieldVerb('changed'), 'changed');
  assertEquals(resolveFieldVerb('removed'), 'cleared');
});

Deno.test('resolveFieldCountPhrase: pluralizes correctly', () => {
  assertEquals(resolveFieldCountPhrase(1), '1 field differs');
  assertEquals(resolveFieldCountPhrase(3), '3 fields differ');
});

Deno.test('resolveEntityLabel: seeded label resolves; unmapped falls back to raw entityType', () => {
  assertEquals(resolveEntityLabel('radarr', 'customFormat'), 'Custom Format');
  assertEquals(resolveEntityLabel('sonarr', 'customFormat'), 'Custom Format');
  // No sibling borrow: an unmapped entity yields its literal name under every Arr.
  assertEquals(resolveEntityLabel('radarr', 'weirdThing'), 'weirdThing');
  assertEquals(resolveEntityLabel('lidarr', 'weirdThing'), 'weirdThing');
});

Deno.test('resolveFieldLabel: cross-Arr safe — mapped label resolves, unmapped falls back to raw name', () => {
  assertEquals(resolveFieldLabel('radarr', 'qualityProfile', 'qualityProfiles', 'cutoff'), 'Cutoff quality');
  assertEquals(resolveFieldLabel('sonarr', 'qualityProfile', 'qualityProfiles', 'cutoff'), 'Cutoff quality');
  // An unmapped field degrades to the literal field name under every Arr — never a sibling label.
  assertEquals(resolveFieldLabel('radarr', 'qualityProfile', 'qualityProfiles', 'zzz_unknown'), 'zzz_unknown');
  assertEquals(resolveFieldLabel('sonarr', 'qualityProfile', 'qualityProfiles', 'zzz_unknown'), 'zzz_unknown');
});

// --- sync-preview narration --------------------------------------------------------------

Deno.test('narrateSyncPreviewSummary: mixed supplied totals stay planned and verbatim', () => {
  const line = narrateSyncPreviewSummary(
    { totalCreates: 2, totalUpdates: 1, totalDeletes: 3, totalUnchanged: 4 },
    'verbose'
  );

  assertEquals(
    line.headline,
    'Planned changes: 2 entities to add, 1 entity to update, 3 entities to remove, and 4 entities already matching.'
  );
  assertEquals(line.detail, ['These are planned changes, not confirmed apply results.']);
  assertEquals(line.tone, 'warning');
  assertEquals(line.templateVersion, '2');
});

Deno.test('narrateSyncPreviewSummary: zero changes stays neutral without claiming complete coverage', () => {
  const summary = narrateSyncPreviewSummary(
    { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 5 },
    'verbose'
  );

  assertEquals(summary.headline, 'No changes are planned from the supplied preview data.');
  assertEquals(summary.detail, [
    '5 entities already matching.',
    'These are planned changes, not confirmed apply results.',
  ]);
  assertEquals(summary.tone, 'neutral');
});

Deno.test('narrateSyncPreviewSummary: visible rows cannot retally contradictory authoritative totals', () => {
  const visible: EntityChange[] = [
    {
      entityType: 'customFormat',
      name: 'Visible only',
      action: 'update',
      remoteId: 1,
      fields: [{ field: 'score', type: 'changed', current: 1, desired: 2 }],
    },
  ];
  const summary = narrateSyncPreviewSummary(
    { totalCreates: 7, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 9 },
    'summary'
  );
  const rows = narrateEntityChanges(visible, 'radarr', 'qualityProfiles', 'summary');

  assertStringIncludes(summary.headline, '7 entities to add');
  assertStringIncludes(summary.headline, '9 entities already matching');
  assertEquals(rows.length, 1);
  assertStringIncludes(rows[0].headline, 'plans to update');
});

Deno.test('narrateSyncSectionOutcome: every section reports preview-generation coverage only', () => {
  const cases: readonly {
    outcome: SyncPreviewSectionOutcome;
    expectedHeadline: string;
    expectedTone: 'neutral' | 'warning';
  }[] = [
    {
      outcome: { section: 'qualityProfiles', skipped: false, error: null },
      expectedHeadline: 'Quality Profiles was included in preview generation.',
      expectedTone: 'neutral',
    },
    {
      outcome: { section: 'delayProfiles', skipped: true, error: null },
      expectedHeadline: 'Delay Profiles was skipped during preview generation.',
      expectedTone: 'neutral',
    },
    {
      outcome: { section: 'mediaManagement', skipped: false, error: 'upstream detail' },
      expectedHeadline: 'Media Management preview generation failed.',
      expectedTone: 'warning',
    },
    {
      outcome: { section: 'metadataProfiles', skipped: false, error: null },
      expectedHeadline: 'Metadata Profiles was included in preview generation.',
      expectedTone: 'neutral',
    },
  ];

  for (const testCase of cases) {
    const summary = narrateSyncSectionOutcome(testCase.outcome, 'summary');
    const verbose = narrateSyncSectionOutcome(testCase.outcome, 'verbose');
    assertEquals(summary.headline, testCase.expectedHeadline);
    assertEquals(summary.detail, []);
    assertEquals(summary.tone, testCase.expectedTone);
    assertStringIncludes(verbose.detail.at(-1) ?? '', 'preview generation only');
    assert(!/appl(?:y|ied)|succeeded/i.test(summary.headline));
  }
});

Deno.test('narrateSyncSectionOutcome: empty section error remains a failure with generic detail', () => {
  const line = narrateSyncSectionOutcome({ section: 'qualityProfiles', skipped: false, error: '' }, 'verbose');
  assertEquals(line.headline, 'Quality Profiles preview generation failed.');
  assertEquals(line.detail[0], 'No additional error detail was provided.');
  assertEquals(line.tone, 'warning');
});

Deno.test('narrateEntityChanges: delegates planned wording and literal fallback for every Arr type', () => {
  const change: EntityChange = {
    entityType: 'unknownEntity',
    name: '<img src=x onerror=alert(1)>',
    action: 'create',
    remoteId: null,
    fields: [],
  };
  const arrTypes: readonly SyncPreviewArrType[] = ['radarr', 'sonarr', 'lidarr'];

  for (const arrType of arrTypes) {
    const [line] = narrateEntityChanges([change], arrType, 'qualityProfiles', 'summary');
    assertEquals(line, narrateEntityChange(change, arrType, 'qualityProfiles', 'summary'));
    assertEquals(line.headline, 'Praxrr plans to add unknownEntity "<img src=x onerror=alert(1)>".');
    assert(!/created|added|applied|succeeded/i.test(line.headline));
  }
});

Deno.test('narrateSyncPreviewError: arbitrary text is framed without substring classification', () => {
  const unauthorized = narrateSyncPreviewError('unauthorized at upstream host', 'verbose');
  const timeout = narrateSyncPreviewError('timeout while reading', 'verbose');
  const hidden = narrateSyncPreviewError('<script>alert(1)</script>', 'summary');

  assertEquals(unauthorized.headline, 'A trustworthy preview could not be generated.');
  assertEquals(timeout.headline, unauthorized.headline);
  assertEquals(unauthorized.detail, ['Reported detail: unauthorized at upstream host']);
  assertEquals(timeout.detail, ['Reported detail: timeout while reading']);
  assertEquals(hidden.detail, []);
  assertEquals(hidden.headline, unauthorized.headline);
  assertEquals(narrateSyncPreviewError(null, 'verbose').detail, ['No additional error detail was provided.']);
});

// --- narrateDriftEntity (delegates to the core, reframes by category) --------------------

Deno.test('narrateDriftEntity: drift (update) reuses core detail, warns, frames as drifted', () => {
  const change: DriftEntityChange = {
    section: 'qualityProfiles',
    entityType: 'qualityProfile',
    name: 'HD',
    action: 'update',
    category: 'drift',
    remoteId: 3,
    fields: [{ field: 'cutoff', type: 'changed', current: 'a', desired: 'b' }],
  };
  assertEquals(narrateDriftEntity(change, 'radarr', 'verbose'), {
    headline: 'Quality Profile "HD" has drifted from the resolved config (1 field differs).',
    detail: ['Cutoff quality changed.'],
    tone: 'warning',
    templateVersion: '2',
  });
});

Deno.test('narrateDriftEntity: missing (create) frames as missing and warns', () => {
  const change: DriftEntityChange = {
    section: 'qualityProfiles',
    entityType: 'customFormat',
    name: 'X',
    action: 'create',
    category: 'missing',
    remoteId: null,
    fields: [],
  };
  const line = narrateDriftEntity(change, 'radarr', 'verbose');
  assertEquals(line.headline, 'Custom Format "X" is missing on this instance.');
  assertEquals(line.detail, []);
  assertEquals(line.tone, 'warning');
});

Deno.test('narrateDriftEntity: unmanaged (delete) frames as unmanaged and stays neutral', () => {
  const change: DriftEntityChange = {
    section: 'qualityProfiles',
    entityType: 'customFormat',
    name: 'Y',
    action: 'delete',
    category: 'unmanaged',
    remoteId: 9,
    fields: [],
  };
  const line = narrateDriftEntity(change, 'radarr', 'summary');
  assertEquals(line.headline, 'Custom Format "Y" exists on this instance but is not managed by Praxrr.');
  assertEquals(line.tone, 'neutral');
});

// --- narrateDriftReason (failure/state reasons in user language) -------------------------

Deno.test('narrateDriftReason: every drift reason maps to a distinct, non-empty sentence', () => {
  const reasons: DriftReason[] = [
    'unreachable',
    'timeout',
    'unauthorized',
    'invalid_response',
    'not_configured',
    'cache_not_ready',
    'rate_limited',
    'error',
  ];
  const sentences = new Set<string>();
  for (const reason of reasons) {
    const line = narrateDriftReason('error', reason, 'summary');
    assert(line.headline.length > 0, `empty sentence for ${reason}`);
    sentences.add(line.headline);
  }
  assertEquals(sentences.size, reasons.length); // all distinct
});

Deno.test('narrateDriftReason: null reason falls back to a safe status sentence and never throws', () => {
  assertEquals(
    narrateDriftReason('error', null, 'summary').headline,
    'An unexpected error occurred while checking this instance.'
  );
  assertEquals(narrateDriftReason('unreachable', null, 'summary').headline, 'Praxrr could not reach this instance.');
});

Deno.test('narrateDriftReason: distinct sentences across never-checked / in-sync / drifted', () => {
  const statuses: DriftSummaryStatus[] = ['never-checked', 'in-sync', 'drifted'];
  const sentences = new Set(statuses.map((status) => narrateDriftReason(status, null, 'summary').headline));
  assertEquals(sentences.size, 3);
});

Deno.test('narrateDriftReason: verbose adds a retry note for every recoverable failure status', () => {
  const retry = ['Praxrr will retry on the next scheduled drift check.'];
  assertEquals(narrateDriftReason('unreachable', 'timeout', 'verbose').detail, retry);
  assertEquals(narrateDriftReason('unauthorized', null, 'verbose').detail, retry);
  assertEquals(narrateDriftReason('error', 'error', 'verbose').detail, retry);
  assertEquals(narrateDriftReason('in-sync', null, 'verbose').detail, []);
});

Deno.test('narrateDriftReason: tone reflects severity across statuses', () => {
  assertEquals(narrateDriftReason('in-sync', null, 'summary').tone, 'neutral');
  assertEquals(narrateDriftReason('never-checked', null, 'summary').tone, 'neutral');
  assertEquals(narrateDriftReason('drifted', null, 'summary').tone, 'warning');
  assertEquals(narrateDriftReason('unreachable', 'timeout', 'summary').tone, 'warning');
  assertEquals(narrateDriftReason('unauthorized', null, 'summary').tone, 'danger');
  assertEquals(narrateDriftReason('error', null, 'summary').tone, 'danger');
});

// --- narrateDriftCounts (rollup headline; reads counts, never re-tallies) ----------------

Deno.test('narrateDriftCounts: mixed counts read straight from DriftCounts', () => {
  const line = narrateDriftCounts({ drifted: 2, missing: 1, unmanaged: 3 }, 'drifted', 'summary');
  assertEquals(line.headline, 'Praxrr found 2 drifted, 1 missing, and 3 unmanaged.');
  assertEquals(line.tone, 'warning');
  assertEquals(line.detail, []);
});

Deno.test('narrateDriftCounts: verbose explains each non-zero category', () => {
  const line = narrateDriftCounts({ drifted: 2, missing: 1, unmanaged: 3 }, 'drifted', 'verbose');
  assertEquals(line.detail, [
    '2 managed entities drifted from the resolved config.',
    '1 managed entity not present on the instance.',
    '3 unmanaged entities present on the instance (info only).',
  ]);
});

Deno.test('narrateDriftCounts: two non-zero categories join without an Oxford comma', () => {
  const line = narrateDriftCounts({ drifted: 2, missing: 1, unmanaged: 0 }, 'drifted', 'summary');
  assertEquals(line.headline, 'Praxrr found 2 drifted and 1 missing.');
  assertEquals(line.tone, 'warning');
});

Deno.test('narrateDriftCounts: unmanaged-only stays neutral (non-alerting)', () => {
  const line = narrateDriftCounts({ drifted: 0, missing: 0, unmanaged: 2 }, 'in-sync', 'summary');
  assertEquals(line.headline, 'Praxrr found 2 unmanaged.');
  assertEquals(line.tone, 'neutral');
});

Deno.test('narrateDriftCounts: zero counts report a clean in-sync headline', () => {
  const line = narrateDriftCounts({ drifted: 0, missing: 0, unmanaged: 0 }, 'in-sync', 'summary');
  assertEquals(line.headline, 'No drift detected — this instance matches the resolved configuration.');
  assertEquals(line.tone, 'neutral');
});

Deno.test('narrateDriftCounts: never-checked and failed checks do not claim in-sync', () => {
  assertEquals(
    narrateDriftCounts({ drifted: 0, missing: 0, unmanaged: 0 }, 'never-checked', 'summary').headline,
    'This instance has not been checked for drift yet.'
  );
  assertEquals(
    narrateDriftCounts({ drifted: 0, missing: 0, unmanaged: 0 }, 'unreachable', 'summary').headline,
    'Drift could not be determined because the last check did not complete.'
  );
});

// --- version stamp -----------------------------------------------------------------------

Deno.test('every NarrationLine stamps the current template version', () => {
  const entity: EntityChange = { entityType: 'customFormat', name: 'A', action: 'create', remoteId: null, fields: [] };
  const drift: DriftEntityChange = {
    section: 'qualityProfiles',
    entityType: 'customFormat',
    name: 'A',
    action: 'create',
    category: 'missing',
    remoteId: null,
    fields: [],
  };
  const lines = [
    narrateEntityChange(entity, 'radarr', 'qualityProfiles', 'summary'),
    narrateSyncPreviewSummary({ totalCreates: 1, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 }, 'summary'),
    narrateSyncSectionOutcome({ section: 'qualityProfiles', skipped: false, error: null }, 'verbose'),
    narrateSyncPreviewError('opaque detail', 'verbose'),
    narrateDriftEntity(drift, 'radarr', 'verbose'),
    narrateDriftReason('drifted', null, 'summary'),
    narrateDriftCounts({ drifted: 1, missing: 0, unmanaged: 0 }, 'drifted', 'verbose'),
  ];
  for (const line of lines) {
    assertEquals(line.templateVersion, NARRATION_TEMPLATE_VERSION);
  }
});
