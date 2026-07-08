import { assert, assertEquals } from '@std/assert';
import {
  ARR_FEATURES,
  ARR_SUPPORT_NON_REGRESSION_CHECK,
  buildVersionCompatibilityMatrix,
  classifyArrVersion,
  resolveArrCapability,
  resolveArrCompatibility,
  type ArrSupportRange,
  type ArrSupportTier,
} from '$shared/arr/compatibility.ts';
import { ARR_TIER_CASES } from './arrVersionFixtures.ts';

// ============================================================================
// (a) classifyArrVersion — every branch, with synthetic ranges
// ============================================================================

Deno.test('classifyArrVersion: breakingAtOrAbove yields unsupported/untested_major', () => {
  const range: ArrSupportRange = {
    minimumSupported: '3.0.0.0',
    latestTested: '4.0.0.0',
    breakingAtOrAbove: '5.0.0.0',
  };
  for (const version of ['5.0.0.0', '6.2.0.0']) {
    const { tier, warnings } = classifyArrVersion(range, version);
    assertEquals(tier, 'unsupported', version);
    assertEquals(warnings[0]?.code, 'untested_major', version);
  }
});

Deno.test('classifyArrVersion: below minimumSupported yields unsupported/below_minimum', () => {
  const range: ArrSupportRange = { minimumSupported: '3.0.0.0', latestTested: '4.0.0.0' };
  const { tier, warnings } = classifyArrVersion(range, '2.9.9.9');
  assertEquals(tier, 'unsupported');
  assertEquals(warnings[0]?.code, 'below_minimum');
});

Deno.test('classifyArrVersion: at/below eolBelow yields degraded/eol with the eolNote appended', () => {
  const range: ArrSupportRange = {
    minimumSupported: '3.0.0.0',
    latestTested: '4.0.0.0',
    eolBelow: '3.5.0.0',
    eolNote: 'Migrate soon.',
  };
  const { tier, warnings } = classifyArrVersion(range, '3.2.0.0');
  assertEquals(tier, 'degraded');
  assertEquals(warnings[0]?.code, 'eol');
  assert(warnings[0]?.message.includes('Migrate soon.'), 'eolNote should be appended to the message');
});

Deno.test('classifyArrVersion: below minimumRecommended yields degraded/below_recommended', () => {
  const range: ArrSupportRange = {
    minimumSupported: '3.0.0.0',
    minimumRecommended: '4.0.0.0',
    latestTested: '5.0.0.0',
  };
  const { tier, warnings } = classifyArrVersion(range, '3.5.0.0');
  assertEquals(tier, 'degraded');
  assertEquals(warnings[0]?.code, 'below_recommended');
});

Deno.test('classifyArrVersion: newer than latestTested stays supported with untested_newer info', () => {
  const range: ArrSupportRange = { minimumSupported: '3.0.0.0', latestTested: '4.0.0.0' };
  const { tier, warnings } = classifyArrVersion(range, '5.0.0.0');
  assertEquals(tier, 'supported');
  assertEquals(warnings[0]?.code, 'untested_newer');
});

Deno.test('classifyArrVersion: in-range version is plainly supported with no warnings', () => {
  const range: ArrSupportRange = {
    minimumSupported: '3.0.0.0',
    minimumRecommended: '3.5.0.0',
    latestTested: '4.0.0.0',
  };
  const { tier, warnings } = classifyArrVersion(range, '3.8.0.0');
  assertEquals(tier, 'supported');
  assertEquals(warnings, []);
});

Deno.test('classifyArrVersion: undetected vs unparseable both resolve to the unknown tier', () => {
  const range: ArrSupportRange = { minimumSupported: '3.0.0.0', latestTested: '4.0.0.0' };

  const undetected = classifyArrVersion(range, null);
  assertEquals(undetected.tier, 'unknown');
  assertEquals(undetected.warnings[0]?.code, 'not_detected');

  const empty = classifyArrVersion(range, '   ');
  assertEquals(empty.tier, 'unknown');
  assertEquals(empty.warnings[0]?.code, 'not_detected');

  const garbage = classifyArrVersion(range, 'not-a-version');
  assertEquals(garbage.tier, 'unknown');
  assertEquals(garbage.warnings[0]?.code, 'unparseable');
});

// ============================================================================
// (b) resolveArrCapability — base capability is a HARD FLOOR
// ============================================================================

Deno.test('resolveArrCapability: base-false feature is always unavailable regardless of version', () => {
  // radarr does not support metadata_profiles; lidarr does not support rename.
  const baseFalse: Array<{ arrType: string; feature: string }> = [
    { arrType: 'radarr', feature: 'metadata_profiles' },
    { arrType: 'lidarr', feature: 'rename' },
  ];
  const versions: Array<string | null> = ['5.14.0.9383', '4.7.5.0', '3.0.0.0', 'garbage', null];

  for (const { arrType, feature } of baseFalse) {
    for (const version of versions) {
      const resolved = resolveArrCapability(arrType, feature as (typeof ARR_FEATURES)[number], version);
      assertEquals(resolved.status, 'unavailable', `${arrType}.${feature}@${version}`);
      assertEquals(resolved.reason, 'base_unsupported', `${arrType}.${feature}@${version}`);
    }
  }
});

Deno.test('resolveArrCapability: version only downgrades a base-true feature, never upgrades it', () => {
  // radarr supports quality_profiles (a sync surface).
  const supported = resolveArrCapability('radarr', 'quality_profiles', '5.14.0.9383');
  assertEquals(supported.status, 'available');

  // Unsupported version withholds the write-heavy sync surface.
  const unsupported = resolveArrCapability('radarr', 'quality_profiles', '3.0.0.0');
  assertEquals(unsupported.status, 'unavailable');
  assertEquals(unsupported.reason, 'version_unsupported');

  // Unknown/undetected version is optimistic passthrough (never withheld).
  const unknown = resolveArrCapability('radarr', 'quality_profiles', null);
  assertEquals(unknown.status, 'available');
  assertEquals(unknown.reason, 'version_unknown');
});

Deno.test('resolveArrCapability: an untracked arr_type passes through as available/unknown_arr_type', () => {
  const resolved = resolveArrCapability('chaptarr', 'library', '5.0.0.0');
  assertEquals(resolved.status, 'available');
  assertEquals(resolved.reason, 'unknown_arr_type');
});

// ============================================================================
// (c) resolveArrCompatibility over the REAL ranges — golden non-regression table
// ============================================================================

Deno.test('resolveArrCompatibility matches the pinned ARR_SUPPORT_NON_REGRESSION_CHECK table', () => {
  for (const [key, expectedTier] of Object.entries(ARR_SUPPORT_NON_REGRESSION_CHECK)) {
    const [arrType, version] = key.split('@');
    const result = resolveArrCompatibility(arrType, version);
    assertEquals(result.tier, expectedTier as ArrSupportTier, key);
    assertEquals(result.detectedVersion, version, key);
  }
});

Deno.test('resolveArrCompatibility matches the shared fixtures tier table', () => {
  for (const testCase of ARR_TIER_CASES) {
    const result = resolveArrCompatibility(testCase.arrType, testCase.version);
    assertEquals(result.tier, testCase.expectedTier, `${testCase.arrType}@${testCase.version} (${testCase.note})`);
  }
});

// ============================================================================
// (d) non-ArrAppType resolves to unknown and never throws
// ============================================================================

Deno.test('resolveArrCompatibility: untracked arr_type resolves to unknown without throwing', () => {
  const result = resolveArrCompatibility('chaptarr', '5.0.0.0');
  assertEquals(result.arrType, 'chaptarr');
  assertEquals(result.tier, 'unknown');
  assertEquals(result.features, []);
  assertEquals(result.disabledFeatures, []);
  assertEquals(result.range, undefined);
  assert(
    result.warnings.some((warning) => warning.code === 'unknown_arr_type'),
    'expected an unknown_arr_type warning'
  );
});

// ============================================================================
// (e) buildVersionCompatibilityMatrix — shape
// ============================================================================

Deno.test('buildVersionCompatibilityMatrix: 3 apps, each with a range and per-tier feature statuses', () => {
  const matrix = buildVersionCompatibilityMatrix();
  assertEquals(matrix.apps.length, 3);

  const tierKeys: ArrSupportTier[] = ['supported', 'degraded', 'unsupported', 'unknown'];

  for (const app of matrix.apps) {
    assert(['radarr', 'sonarr', 'lidarr'].includes(app.arrType), app.arrType);
    assert(typeof app.range.minimumSupported === 'string', 'range.minimumSupported present');
    assert(typeof app.range.latestTested === 'string', 'range.latestTested present');
    assertEquals(app.features.length, ARR_FEATURES.length);

    for (const feature of app.features) {
      for (const tier of tierKeys) {
        assert(
          ['available', 'degraded', 'unavailable'].includes(feature.tiers[tier]),
          `${app.arrType}.${feature.feature}.${tier} -> ${feature.tiers[tier]}`
        );
      }
    }
  }

  // Spot-check a base-false cell (radarr metadata_profiles) stays unavailable across every tier,
  // and a base-true cell (radarr quality_profiles) tracks the tier.
  const radarr = matrix.apps.find((app) => app.arrType === 'radarr');
  assert(radarr, 'radarr app present');
  const metadata = radarr.features.find((feature) => feature.feature === 'metadata_profiles');
  assert(metadata, 'radarr metadata_profiles present');
  for (const tier of tierKeys) {
    assertEquals(metadata.tiers[tier], 'unavailable', `radarr metadata_profiles ${tier}`);
  }
  const quality = radarr.features.find((feature) => feature.feature === 'quality_profiles');
  assert(quality, 'radarr quality_profiles present');
  assertEquals(quality.tiers.supported, 'available');
  assertEquals(quality.tiers.unsupported, 'unavailable');
  assertEquals(quality.tiers.unknown, 'available');
});
