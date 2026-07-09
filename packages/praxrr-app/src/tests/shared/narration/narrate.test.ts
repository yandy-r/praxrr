import { assert, assertEquals } from '@std/assert';
import type { EntityChange } from '$sync/preview/types.ts';
import type { DriftEntityChange, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import {
  NARRATION_TEMPLATE_VERSION,
  narrateDriftCounts,
  narrateDriftEntity,
  narrateDriftReason,
  narrateEntityChange,
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
    headline: 'Add Custom Format "HDR".',
    detail: [],
    tone: 'info',
    templateVersion: '1',
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
    headline: 'Update Quality Profile "HD-1080p" (2 fields differ).',
    detail: ['Cutoff quality changed.', 'Name set.'],
    tone: 'info',
    templateVersion: '1',
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
  assertEquals(line.headline, 'Update Quality Profile "HD" (1 field differs).');
});

Deno.test('narrateEntityChange: delete does not over-explain (no verbose detail)', () => {
  const change: EntityChange = { entityType: 'customFormat', name: 'Old', action: 'delete', remoteId: 5, fields: [] };
  const line = narrateEntityChange(change, 'radarr', 'qualityProfiles', 'verbose');
  assertEquals(line.headline, 'Remove Custom Format "Old".');
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
    templateVersion: '1',
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

Deno.test('narrateDriftReason: verbose adds a retry note only for recoverable failures', () => {
  assertEquals(narrateDriftReason('unreachable', 'timeout', 'verbose').detail, [
    'Praxrr will retry on the next scheduled drift check.',
  ]);
  assertEquals(narrateDriftReason('in-sync', null, 'verbose').detail, []);
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
    narrateDriftEntity(drift, 'radarr', 'verbose'),
    narrateDriftReason('drifted', null, 'summary'),
    narrateDriftCounts({ drifted: 1, missing: 0, unmanaged: 0 }, 'drifted', 'verbose'),
  ];
  for (const line of lines) {
    assertEquals(line.templateVersion, NARRATION_TEMPLATE_VERSION);
  }
});
