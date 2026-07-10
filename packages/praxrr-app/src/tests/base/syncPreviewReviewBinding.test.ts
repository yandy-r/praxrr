import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from '@std/assert';
import {
  buildSyncPreviewReviewBinding,
  canonicalizeReviewValue,
  compareReviewedEvidence,
  sortReviewEvidenceSet,
  type SyncPreviewSectionReviewEvidenceInput,
} from '$sync/preview/reviewBinding.ts';
import type {
  SyncPreviewArrType,
  SyncPreviewReviewBinding,
  SyncPreviewReviewTargetInput,
  SyncPreviewSection,
} from '$sync/preview/types.ts';

const ALL_SECTIONS: readonly SyncPreviewSection[] = ['qualityProfiles', 'mediaManagement'];

function evidenceFor(
  sections: readonly SyncPreviewSection[],
  overrides: Partial<Record<SyncPreviewSection, Partial<SyncPreviewSectionReviewEvidenceInput>>> = {}
): SyncPreviewSectionReviewEvidenceInput[] {
  return sections.map((section) => ({
    section,
    pcd: { selected: `${section}-pcd`, values: [1, 2] },
    arr: { current: `${section}-arr`, remoteId: 10 },
    plan: { section, actions: ['create', 'update'] },
    ...overrides[section],
  }));
}

function buildBinding(
  sections: readonly SyncPreviewSection[] = ALL_SECTIONS,
  options: {
    arrType?: SyncPreviewArrType;
    instanceId?: number;
    evidence?: readonly SyncPreviewSectionReviewEvidenceInput[];
    sectionConfigs?: Partial<Record<SyncPreviewSection, unknown>>;
    target?: SyncPreviewReviewTargetInput;
  } = {}
): Promise<SyncPreviewReviewBinding> {
  const sectionConfigs =
    options.sectionConfigs ??
    Object.fromEntries(sections.map((section) => [section, { databaseId: 7, profile: `${section}-profile` }]));
  return buildSyncPreviewReviewBinding({
    instanceId: options.instanceId ?? 42,
    arrType: options.arrType ?? 'lidarr',
    target: options.target ?? {
      url: 'HTTP://ARR.TEST:8686/api/',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
    sections,
    sectionConfigs,
    evidence: options.evidence ?? evidenceFor(sections),
  });
}

Deno.test('review binding canonicalization is stable by object key and preserves semantic array order', async () => {
  assertEquals(
    canonicalizeReviewValue({ z: 1, nested: { beta: true, alpha: null } }),
    canonicalizeReviewValue({ nested: { alpha: null, beta: true }, z: 1 })
  );
  assertNotEquals(
    canonicalizeReviewValue({ values: ['first', 'second'] }),
    canonicalizeReviewValue({
      values: ['second', 'first'],
    })
  );

  const left = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { pcd: { z: 1, a: 2 } },
    }),
  });
  const sameDifferentKeyOrder = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { pcd: { a: 2, z: 1 } },
    }),
  });
  const reorderedSemanticArray = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { pcd: { z: 1, a: 2, values: [2, 1] } },
    }),
  });
  const orderedSemanticArray = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { pcd: { z: 1, a: 2, values: [1, 2] } },
    }),
  });

  assertEquals(left.evidence.qualityProfiles?.pcdHash, sameDifferentKeyOrder.evidence.qualityProfiles?.pcdHash);
  assertNotEquals(
    reorderedSemanticArray.evidence.qualityProfiles?.pcdHash,
    orderedSemanticArray.evidence.qualityProfiles?.pcdHash
  );
});

Deno.test('review binding canonicalizes target URLs and invalidates retarget or credential rotation', async () => {
  const expected = await buildBinding(['qualityProfiles']);
  const equivalentUrl = await buildBinding(['qualityProfiles'], {
    target: {
      url: 'http://arr.test:8686/api',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
  });
  const retargeted = await buildBinding(['qualityProfiles'], {
    target: {
      url: 'http://arr.test:8787/api',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
  });
  const rotated = await buildBinding(['qualityProfiles'], {
    target: {
      url: 'http://arr.test:8686/api',
      credentialFingerprint: 'credential-v2',
      credentialKeyVersion: 'key-v2',
      credentialRevision: 'revision-v2',
    },
  });

  assertEquals(expected.targetHash, equivalentUrl.targetHash);
  assertNotEquals(expected.targetHash, retargeted.targetHash);
  assertNotEquals(expected.targetHash, rotated.targetHash);
  assertEquals(compareReviewedEvidence(expected, retargeted, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'scope_drift',
    changedEvidence: [],
    changedSections: ['qualityProfiles'],
  });
});

Deno.test('review binding sorts only explicitly declared true sets with a caller comparator', () => {
  const sorted = sortReviewEvidenceSet([{ name: 'Zulu' }, { name: 'Alpha' }], (left, right) => {
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
  assertEquals(sorted, [{ name: 'Alpha' }, { name: 'Zulu' }]);
  assert(Object.isFrozen(sorted));
  assert(Object.isFrozen(sorted[0]));

  assertThrows(() => sortReviewEvidenceSet([{ name: 'same' }, { name: 'same' }], () => 0), TypeError, 'ambiguous');
});

Deno.test('review binding enforces one aggregate canonical byte budget before serialization', () => {
  const oversized = Array.from({ length: 17 }, (_, index) => ({
    name: `${String(index).padStart(2, '0')}:${'x'.repeat(999_997)}`,
  }));

  assertThrows(() => canonicalizeReviewValue(oversized), TypeError, 'canonical byte limit exceeded');
  assertThrows(
    () =>
      sortReviewEvidenceSet(oversized, (left, right) => {
        if (left.name === right.name) return 0;
        return left.name < right.name ? -1 : 1;
      }),
    TypeError,
    'canonical byte limit exceeded'
  );
});

Deno.test('review binding clones effective config immutably and includes it only in PCD evidence', async () => {
  const sourceConfig = {
    databaseId: 7,
    names: ['One', 'Two'],
    nested: { enabled: true },
  };
  const expected = await buildBinding(['qualityProfiles'], {
    sectionConfigs: { qualityProfiles: sourceConfig },
  });
  const changedConfig = await buildBinding(['qualityProfiles'], {
    sectionConfigs: {
      qualityProfiles: {
        databaseId: 8,
        names: ['One', 'Two'],
        nested: { enabled: true },
      },
    },
  });

  sourceConfig.databaseId = 99;
  sourceConfig.names.reverse();
  sourceConfig.nested.enabled = false;

  const retained = expected.sectionConfigs.qualityProfiles as {
    databaseId: number;
    names: string[];
    nested: { enabled: boolean };
  };
  assertEquals(retained, {
    databaseId: 7,
    names: ['One', 'Two'],
    nested: { enabled: true },
  });
  assert(Object.isFrozen(expected.sectionConfigs));
  assert(Object.isFrozen(retained));
  assert(Object.isFrozen(retained.names));
  assert(Object.isFrozen(retained.nested));
  assertThrows(() => {
    retained.databaseId = 100;
  }, TypeError);

  assertNotEquals(expected.evidence.qualityProfiles?.pcdHash, changedConfig.evidence.qualityProfiles?.pcdHash);
  assertEquals(expected.evidence.qualityProfiles?.arrHash, changedConfig.evidence.qualityProfiles?.arrHash);
  assertEquals(expected.evidence.qualityProfiles?.planHash, changedConfig.evidence.qualityProfiles?.planHash);
});

Deno.test('review binding source mutations classify PCD, Arr, both, and plan-only ambiguity', async () => {
  const expected = await buildBinding(['qualityProfiles']);
  const pcdChanged = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { pcd: { selected: 'changed' } },
    }),
  });
  const arrChanged = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { arr: { current: 'changed' } },
    }),
  });
  const bothChanged = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: {
        pcd: { selected: 'changed' },
        arr: { current: 'changed' },
      },
    }),
  });
  const planOnlyChanged = await buildBinding(['qualityProfiles'], {
    evidence: evidenceFor(['qualityProfiles'], {
      qualityProfiles: { plan: { actions: ['delete'] } },
    }),
  });

  assertEquals(compareReviewedEvidence(expected, expected, ['qualityProfiles']), { kind: 'match' });
  assertEquals(compareReviewedEvidence(expected, pcdChanged, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'pcd_drift',
    changedEvidence: ['pcd'],
    changedSections: ['qualityProfiles'],
  });
  assertEquals(compareReviewedEvidence(expected, arrChanged, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'arr_drift',
    changedEvidence: ['arr'],
    changedSections: ['qualityProfiles'],
  });
  assertEquals(compareReviewedEvidence(expected, bothChanged, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'pcd_and_arr_drift',
    changedEvidence: ['pcd', 'arr'],
    changedSections: ['qualityProfiles'],
  });
  assertEquals(compareReviewedEvidence(expected, planOnlyChanged, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'unverifiable_review',
    changedEvidence: [],
    changedSections: ['qualityProfiles'],
  });
});

Deno.test('review binding comparison validates the exact selected subset and ignores unselected drift', async () => {
  const expected = await buildBinding();
  const selectedOnly = await buildBinding(['mediaManagement']);
  const selectedOnlyChanged = await buildBinding(['mediaManagement'], {
    evidence: evidenceFor(['mediaManagement'], {
      mediaManagement: { arr: { current: 'changed' } },
    }),
  });
  const expandedFreshBinding = await buildBinding();

  assertEquals(compareReviewedEvidence(expected, selectedOnly, ['mediaManagement']), { kind: 'match' });
  assertEquals(compareReviewedEvidence(expected, selectedOnlyChanged, ['mediaManagement']), {
    kind: 'invalidated',
    reason: 'arr_drift',
    changedEvidence: ['arr'],
    changedSections: ['mediaManagement'],
  });
  assertEquals(compareReviewedEvidence(expected, expandedFreshBinding, ['mediaManagement']), {
    kind: 'invalidated',
    reason: 'scope_drift',
    changedEvidence: [],
    changedSections: ['mediaManagement'],
  });
  assertEquals(compareReviewedEvidence(expected, selectedOnly, ['metadataProfiles']), {
    kind: 'invalidated',
    reason: 'scope_drift',
    changedEvidence: [],
    changedSections: ['metadataProfiles'],
  });
});

Deno.test('review binding fails closed on unsupported, non-finite, missing, and unknown-version input', async () => {
  await assertRejects(
    () =>
      buildSyncPreviewReviewBinding({
        instanceId: 1,
        arrType: 'radarr',
        target: {
          url: 'http://radarr.test',
          credentialFingerprint: 'credential-v1',
          credentialKeyVersion: 'key-v1',
          credentialRevision: 'revision-v1',
        },
        sections: ['metadataProfiles'],
        evidence: evidenceFor(['metadataProfiles']),
      }),
    TypeError
  );
  await assertRejects(
    () =>
      buildBinding(['qualityProfiles'], {
        evidence: evidenceFor(['qualityProfiles'], {
          qualityProfiles: { pcd: { score: Number.NaN } },
        }),
      }),
    TypeError,
    'finite'
  );
  await assertRejects(
    () =>
      buildBinding(['qualityProfiles'], {
        evidence: [
          {
            section: 'qualityProfiles',
            pcd: undefined,
            arr: {},
            plan: {},
          },
        ],
      }),
    TypeError,
    'undefined'
  );

  const binding = await buildBinding(['qualityProfiles']);
  const unknownVersion = { ...binding, version: 2 };
  assertEquals(compareReviewedEvidence(binding, unknownVersion, ['qualityProfiles']), {
    kind: 'invalidated',
    reason: 'unverifiable_review',
    changedEvidence: [],
    changedSections: ['qualityProfiles'],
  });
});

Deno.test('review binding retains hashes but never raw PCD, Arr, or material-plan evidence', async () => {
  const binding = await buildBinding(['qualityProfiles'], {
    evidence: [
      {
        section: 'qualityProfiles',
        pcd: { privateMarker: 'RAW_PCD_MARKER' },
        arr: { privateMarker: 'RAW_ARR_MARKER' },
        plan: { privateMarker: 'RAW_PLAN_MARKER' },
      },
    ],
    sectionConfigs: {
      qualityProfiles: { profileName: 'RetainedReviewedConfig' },
    },
  });
  const serialized = JSON.stringify(binding);

  assert(!serialized.includes('RAW_PCD_MARKER'));
  assert(!serialized.includes('RAW_ARR_MARKER'));
  assert(!serialized.includes('RAW_PLAN_MARKER'));
  assert(!serialized.includes('ARR.TEST'));
  assert(!serialized.includes('credential-v1'));
  assert(serialized.includes('RetainedReviewedConfig'));
  assertEquals(Object.keys(binding.evidence), ['qualityProfiles']);
  assertEquals(Object.keys(binding.evidence.qualityProfiles ?? {}).sort(), [
    'arrHash',
    'pcdHash',
    'planHash',
    'section',
  ]);
});
