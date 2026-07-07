// Pure tests -- no I/O, no PCDCache, no database. `computeUserOverrides` is a thin,
// synchronous wrapper around `diffToFieldChanges` with Portable-field-named array-key
// strategies, so these tests exercise it directly against synthetic Portable-shaped
// objects, mirroring `tests/base/syncPreviewDiff.test.ts`'s style.

import { assertEquals } from '@std/assert';
import type {
  PortableCustomFormat,
  PortableDelayProfile,
  PortableLidarrMetadataProfile,
  PortableQualityDefinitions,
  PortableQualityProfile,
} from '$shared/pcd/portable.ts';
import { computeUserOverrides, PORTABLE_ARRAY_KEY_STRATEGIES } from '$pcd/resolved/layerDiff.ts';

function buildQualityProfile(overrides: Partial<PortableQualityProfile> = {}): PortableQualityProfile {
  return {
    name: 'HD-1080p',
    description: null,
    tags: [],
    language: null,
    orderedItems: [
      { type: 'quality', name: 'Bluray-1080p', position: 0, enabled: true, upgradeUntil: false },
      { type: 'quality', name: 'WEBDL-1080p', position: 1, enabled: true, upgradeUntil: false },
      {
        type: 'group',
        name: 'WEB 720p',
        position: 2,
        enabled: true,
        upgradeUntil: false,
        members: [{ name: 'WEBDL-720p' }],
      },
    ],
    minimumScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    customFormatScores: [
      { customFormatName: 'x264', arrType: 'radarr', score: 10 },
      { customFormatName: 'HDR', arrType: 'radarr', score: 20 },
    ],
    ...overrides,
  };
}

function buildCustomFormat(overrides: Partial<PortableCustomFormat> = {}): PortableCustomFormat {
  return {
    name: 'HDR10',
    description: null,
    includeInRename: false,
    tags: [],
    conditions: [
      { name: 'HDR10 Source', type: 'source', arrType: 'radarr', negate: false, required: true, sources: ['hdr10'] },
      {
        name: 'x265 Codec',
        type: 'release_group',
        arrType: 'radarr',
        negate: false,
        required: true,
        patterns: [{ name: 'p', pattern: 'x265' }],
      },
    ],
    tests: [
      { title: 'Matches HDR10 release', type: 'movie', shouldMatch: true, description: null },
      { title: 'Rejects SDR release', type: 'movie', shouldMatch: false, description: null },
    ],
    ...overrides,
  };
}

function buildQualityDefinitions(overrides: Partial<PortableQualityDefinitions> = {}): PortableQualityDefinitions {
  return {
    name: 'radarr-quality-definitions',
    entries: [
      { quality_name: 'Bluray-1080p', min_size: 10, max_size: 100, preferred_size: 50 },
      { quality_name: 'WEBDL-1080p', min_size: 5, max_size: 80, preferred_size: 40 },
    ],
    ...overrides,
  };
}

function buildMetadataProfile(overrides: Partial<PortableLidarrMetadataProfile> = {}): PortableLidarrMetadataProfile {
  return {
    name: 'Standard',
    description: null,
    primaryTypes: [
      { id: 1, name: 'Album', allowed: true },
      { id: 2, name: 'EP', allowed: true },
    ],
    secondaryTypes: [
      { id: 10, name: 'Live', allowed: false },
      { id: 11, name: 'Remix', allowed: true },
    ],
    releaseStatuses: [
      { id: 20, name: 'Official', allowed: true },
      { id: 21, name: 'Bootleg', allowed: false },
    ],
    ...overrides,
  };
}

function buildDelayProfile(overrides: Partial<PortableDelayProfile> = {}): PortableDelayProfile {
  return {
    name: 'Default',
    preferredProtocol: 'prefer_usenet',
    usenetDelay: 0,
    torrentDelay: 0,
    bypassIfHighestQuality: true,
    bypassIfAboveCfScore: false,
    minimumCfScore: 0,
    ...overrides,
  };
}

// ============================================================================
// PORTABLE_ARRAY_KEY_STRATEGIES SHAPE
// ============================================================================

Deno.test('PORTABLE_ARRAY_KEY_STRATEGIES covers the Portable-shaped nested object arrays', () => {
  const paths = PORTABLE_ARRAY_KEY_STRATEGIES.map((strategy) => strategy.path).sort();

  assertEquals(paths, [
    'conditions',
    'customFormatScores',
    'entries',
    'orderedItems',
    'primaryTypes',
    'releaseStatuses',
    'secondaryTypes',
    'tests',
  ]);
});

// ============================================================================
// ARRAY REORDER -> NO CHANGES
// ============================================================================

Deno.test('computeUserOverrides: reordering orderedItems produces no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({ orderedItems: [...base.orderedItems].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering customFormatScores produces no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({ customFormatScores: [...base.customFormatScores].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering custom format conditions and tests produces no changes', () => {
  const base = buildCustomFormat();
  const resolved = buildCustomFormat({
    conditions: [...base.conditions].reverse(),
    tests: [...base.tests].reverse(),
  });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering quality definition entries produces no changes', () => {
  const base = buildQualityDefinitions();
  const resolved = buildQualityDefinitions({ entries: [...base.entries].reverse() });

  assertEquals(computeUserOverrides(base, resolved), []);
});

Deno.test('computeUserOverrides: reordering metadata profile type arrays produces no changes', () => {
  const base = buildMetadataProfile();
  const resolved = buildMetadataProfile({
    primaryTypes: [...base.primaryTypes].reverse(),
    secondaryTypes: [...base.secondaryTypes].reverse(),
    releaseStatuses: [...base.releaseStatuses].reverse(),
  });

  assertEquals(computeUserOverrides(base, resolved), []);
});

// ============================================================================
// VALUE CHANGE -> 'changed' FIELDCHANGE
// ============================================================================

Deno.test("computeUserOverrides: a scalar value change produces a 'changed' FieldChange", () => {
  const base = buildQualityProfile({ minimumScore: 0 });
  const resolved = buildQualityProfile({ minimumScore: 5 });

  assertEquals(computeUserOverrides(base, resolved), [
    { field: 'minimumScore', type: 'changed', current: 0, desired: 5 },
  ]);
});

Deno.test("computeUserOverrides: a keyed array item's field change still reports as 'changed'", () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile({
    customFormatScores: [{ customFormatName: 'x264', arrType: 'radarr', score: 99 }, base.customFormatScores[1]],
  });

  assertEquals(computeUserOverrides(base, resolved), [
    { field: 'customFormatScores["x264:radarr"].score', type: 'changed', current: 10, desired: 99 },
  ]);
});

// ============================================================================
// BASE-ABSENT (undefined/null) -> 'added' CHANGES
// ============================================================================

Deno.test(
  "computeUserOverrides: a null base produces 'added' changes for every resolved field (user-created entity)",
  () => {
    const resolved = buildDelayProfile();

    const changes = computeUserOverrides(null, resolved);

    assertEquals(changes.length > 0, true);
    assertEquals(
      changes.every((change) => change.type === 'added'),
      true
    );
    assertEquals(
      changes.find((change) => change.field === 'name'),
      {
        field: 'name',
        type: 'added',
        current: null,
        desired: 'Default',
      }
    );
  }
);

Deno.test("computeUserOverrides: a null resolved entity produces 'removed' changes for every base field", () => {
  const base = buildDelayProfile();

  const changes = computeUserOverrides(base, null);

  assertEquals(changes.length > 0, true);
  assertEquals(
    changes.every((change) => change.type === 'removed'),
    true
  );
});

Deno.test('computeUserOverrides: identical base and resolved entities produce no changes', () => {
  const base = buildQualityProfile();
  const resolved = buildQualityProfile();

  assertEquals(computeUserOverrides(base, resolved), []);
});
