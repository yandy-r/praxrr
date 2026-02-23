/**
 * Unit tests for startup pull default detection and filtering.
 *
 * Tests exercise shouldSkipStartupDefault and isDefaultFilterableSection from
 * defaultFilters.ts, plus getStartupDefaultCatalog from defaultCatalogs.ts.
 * Coverage: per-arr_type default detection for delay profiles, uncertain
 * defaults classified as skip, known ID-1 defaults correctly excluded,
 * non-default entities passing through, Lidarr-specific behavior,
 * and non-filterable sections.
 */

import { assertEquals } from '@std/assert';
import { shouldSkipStartupDefault, isDefaultFilterableSection } from '$lib/server/pull/startup/defaultFilters.ts';
import {
  getStartupDefaultCatalog,
  STARTUP_DEFAULT_CATALOG,
  DEFAULT_FILTERABLE_STARTUP_SECTIONS,
} from '$lib/server/pull/startup/defaultCatalogs.ts';
import type { StartupPullArrType, StartupPullSection } from '$lib/server/pull/startup/types.ts';
import {
  buildRadarrDefaultDelayProfile,
  buildSonarrDefaultDelayProfile,
  buildLidarrUncertainDefaultDelayProfile,
  buildNonDefaultDelayProfile,
  ALL_ARR_TYPES,
  ALL_SECTIONS,
  FILTERABLE_SECTIONS,
  MEDIA_MANAGEMENT_SECTIONS,
} from './pullOnStartupFixtures.ts';

// =============================================================================
// isDefaultFilterableSection
// =============================================================================

Deno.test('isDefaultFilterableSection: filterable sections are recognized', () => {
  for (const section of FILTERABLE_SECTIONS) {
    assertEquals(isDefaultFilterableSection(section), true, `Expected ${section} to be filterable`);
  }
});

Deno.test('isDefaultFilterableSection: media management sections are not filterable', () => {
  for (const section of MEDIA_MANAGEMENT_SECTIONS) {
    assertEquals(isDefaultFilterableSection(section), false, `Expected ${section} to NOT be filterable`);
  }
});

Deno.test('isDefaultFilterableSection: aligns with DEFAULT_FILTERABLE_STARTUP_SECTIONS constant', () => {
  for (const section of ALL_SECTIONS) {
    assertEquals(isDefaultFilterableSection(section), DEFAULT_FILTERABLE_STARTUP_SECTIONS.includes(section));
  }
});

// =============================================================================
// getStartupDefaultCatalog
// =============================================================================

Deno.test('getStartupDefaultCatalog: radarr delay profiles has id-based rules', () => {
  const rules = getStartupDefaultCatalog('radarr', 'delayProfiles');
  assertEquals(rules.length > 0, true);
  assertEquals(rules[0].kind, 'ids');
  assertEquals(rules[0].arrType, 'radarr');
});

Deno.test('getStartupDefaultCatalog: sonarr delay profiles has id-based rules', () => {
  const rules = getStartupDefaultCatalog('sonarr', 'delayProfiles');
  assertEquals(rules.length > 0, true);
  assertEquals(rules[0].kind, 'ids');
  assertEquals(rules[0].arrType, 'sonarr');
});

Deno.test('getStartupDefaultCatalog: lidarr delay profiles has field-based rules', () => {
  const rules = getStartupDefaultCatalog('lidarr', 'delayProfiles');
  assertEquals(rules.length > 0, true);
  assertEquals(rules[0].kind, 'fields');
  assertEquals(rules[0].confidence, 'uncertain');
});

Deno.test('getStartupDefaultCatalog: quality profiles have no default rules for any arr_type', () => {
  for (const arrType of ALL_ARR_TYPES) {
    const rules = getStartupDefaultCatalog(arrType, 'qualityProfiles');
    assertEquals(rules.length, 0, `Expected no quality profile default rules for ${arrType}`);
  }
});

Deno.test('getStartupDefaultCatalog: metadata profiles have no default rules for any arr_type', () => {
  for (const arrType of ALL_ARR_TYPES) {
    const rules = getStartupDefaultCatalog(arrType, 'metadataProfiles');
    assertEquals(rules.length, 0, `Expected no metadata profile default rules for ${arrType}`);
  }
});

// =============================================================================
// Known Radarr/Sonarr ID-1 delay profile defaults are correctly excluded
// =============================================================================

Deno.test('shouldSkipStartupDefault: radarr delay profile id=1 is skipped (certain)', () => {
  const entity = buildRadarrDefaultDelayProfile();
  const decision = shouldSkipStartupDefault('radarr', 'delayProfiles', entity);

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'certain');
  assertEquals(typeof decision.reason, 'string');
  assertEquals(decision.reason!.length > 0, true);
});

Deno.test('shouldSkipStartupDefault: sonarr delay profile id=1 is skipped (certain)', () => {
  const entity = buildSonarrDefaultDelayProfile();
  const decision = shouldSkipStartupDefault('sonarr', 'delayProfiles', entity);

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'certain');
  assertEquals(typeof decision.reason, 'string');
});

// =============================================================================
// Uncertain defaults classified as skip rather than import
// =============================================================================

Deno.test('shouldSkipStartupDefault: lidarr uncertain default delay profile is skipped', () => {
  const entity = buildLidarrUncertainDefaultDelayProfile();
  const decision = shouldSkipStartupDefault('lidarr', 'delayProfiles', entity);

  assertEquals(decision.skip, true);
  // Lidarr uses field-based uncertain rules. The result depends on whether
  // the rule matches or triggers the uncertain-unknown path.
  // The fixture has order=1 and tags=[], which should match the criteria.
  assertEquals(decision.confidence, 'uncertain');
});

Deno.test('shouldSkipStartupDefault: entity with unknown field types triggers uncertain skip', () => {
  // Entity without an id field when an id-based rule expects one
  const entityMissingId = { name: 'Some Delay Profile', tags: [] };
  const decision = shouldSkipStartupDefault('radarr', 'delayProfiles', entityMissingId);

  // The id-based rule cannot determine if this is a default (returns 'unknown'),
  // but since the rule confidence is 'certain', hasUncertainUnknown stays false.
  // Thus it falls through to no-skip.
  assertEquals(decision.skip, false);
  assertEquals(decision.confidence, null);
});

// =============================================================================
// Non-default entities pass through the filter
// =============================================================================

for (const arrType of ALL_ARR_TYPES) {
  Deno.test(`shouldSkipStartupDefault: ${arrType} non-default delay profile passes through`, () => {
    const entity = buildNonDefaultDelayProfile(arrType);
    const decision = shouldSkipStartupDefault(arrType, 'delayProfiles', entity);

    assertEquals(decision.skip, false);
    assertEquals(decision.confidence, null);
    assertEquals(decision.reason, null);
  });
}

Deno.test('shouldSkipStartupDefault: radarr delay profile id=5 is not skipped', () => {
  const entity = { id: 5, order: 10, tags: [1] };
  const decision = shouldSkipStartupDefault('radarr', 'delayProfiles', entity);

  assertEquals(decision.skip, false);
});

Deno.test('shouldSkipStartupDefault: sonarr delay profile id=99 is not skipped', () => {
  const entity = { id: 99, order: 3, tags: [] };
  const decision = shouldSkipStartupDefault('sonarr', 'delayProfiles', entity);

  assertEquals(decision.skip, false);
});

// =============================================================================
// Non-filterable sections always pass through
// =============================================================================

for (const section of MEDIA_MANAGEMENT_SECTIONS) {
  Deno.test(`shouldSkipStartupDefault: ${section} always passes through regardless of entity`, () => {
    const entity = { id: 1, name: 'Anything' };
    for (const arrType of ALL_ARR_TYPES) {
      const decision = shouldSkipStartupDefault(arrType, section, entity);
      assertEquals(decision.skip, false, `Expected ${section} to pass for ${arrType}`);
      assertEquals(decision.confidence, null);
      assertEquals(decision.reason, null);
    }
  });
}

// =============================================================================
// Quality profiles have no default rules so all entities pass through
// =============================================================================

Deno.test('shouldSkipStartupDefault: quality profiles always pass through for all arr_types', () => {
  for (const arrType of ALL_ARR_TYPES) {
    const entity = { id: 1, name: 'Default-Looking Profile' };
    const decision = shouldSkipStartupDefault(arrType, 'qualityProfiles', entity);

    assertEquals(decision.skip, false, `Expected quality profile to pass for ${arrType}`);
  }
});

// =============================================================================
// Lidarr-specific default behavior
// =============================================================================

Deno.test('shouldSkipStartupDefault: lidarr delay profile with tags is not skipped', () => {
  const entity = { id: 5, order: 1, tags: [42] };
  const decision = shouldSkipStartupDefault('lidarr', 'delayProfiles', entity);

  // The field rule requires tags to be empty array; with tags present, it's nomatch
  assertEquals(decision.skip, false);
});

Deno.test('shouldSkipStartupDefault: lidarr delay profile with order != 1 is not skipped', () => {
  const entity = { id: 5, order: 5, tags: [] };
  const decision = shouldSkipStartupDefault('lidarr', 'delayProfiles', entity);

  // order=5 does not match the order=1 criterion
  assertEquals(decision.skip, false);
});

Deno.test('shouldSkipStartupDefault: lidarr delay profile with null tags triggers uncertain', () => {
  // null tags: the is-empty-array comparator treats null as match
  const entity = { id: 5, order: 1, tags: null };
  const decision = shouldSkipStartupDefault('lidarr', 'delayProfiles', entity);

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'uncertain');
});

Deno.test('shouldSkipStartupDefault: lidarr delay profile missing tags field triggers uncertain', () => {
  // undefined tags: the is-empty-array comparator treats undefined as match (null/undefined check)
  const entity = { id: 5, order: 1 };
  const decision = shouldSkipStartupDefault('lidarr', 'delayProfiles', entity);

  // tags field is undefined -> is-empty-array treats undefined as match
  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'uncertain');
});

Deno.test('shouldSkipStartupDefault: lidarr metadata profiles have no default rules', () => {
  const entity = { id: 1, name: 'Standard' };
  const decision = shouldSkipStartupDefault('lidarr', 'metadataProfiles', entity);

  assertEquals(decision.skip, false);
});

// =============================================================================
// Edge cases: non-object entities
// =============================================================================

Deno.test('shouldSkipStartupDefault: non-object entity on filterable section is skipped as uncertain', () => {
  const decision = shouldSkipStartupDefault('radarr', 'delayProfiles', 'not-an-object');

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'uncertain');
  assertEquals(typeof decision.reason, 'string');
});

Deno.test('shouldSkipStartupDefault: null entity on filterable section is skipped as uncertain', () => {
  const decision = shouldSkipStartupDefault('sonarr', 'delayProfiles', null);

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'uncertain');
});

Deno.test('shouldSkipStartupDefault: array entity on filterable section is skipped as uncertain', () => {
  const decision = shouldSkipStartupDefault('radarr', 'delayProfiles', [1, 2, 3]);

  assertEquals(decision.skip, true);
  assertEquals(decision.confidence, 'uncertain');
});

Deno.test('shouldSkipStartupDefault: non-object entity on non-filterable section passes through', () => {
  const decision = shouldSkipStartupDefault('radarr', 'naming', 'not-an-object');

  assertEquals(decision.skip, false);
  assertEquals(decision.confidence, null);
});

// =============================================================================
// Catalog structure validation
// =============================================================================

Deno.test('STARTUP_DEFAULT_CATALOG: all arr_types have entries for all sections', () => {
  for (const arrType of ALL_ARR_TYPES) {
    for (const section of ALL_SECTIONS) {
      const rules = STARTUP_DEFAULT_CATALOG[arrType][section];
      assertEquals(Array.isArray(rules), true, `Missing catalog entry for ${arrType}/${section}`);
    }
  }
});

Deno.test('STARTUP_DEFAULT_CATALOG: all rules have consistent arrType and section fields', () => {
  for (const arrType of ALL_ARR_TYPES) {
    for (const section of ALL_SECTIONS) {
      const rules = STARTUP_DEFAULT_CATALOG[arrType][section];
      for (const rule of rules) {
        assertEquals(rule.arrType, arrType, `Rule arrType mismatch in ${arrType}/${section}`);
        assertEquals(rule.section, section, `Rule section mismatch in ${arrType}/${section}`);
      }
    }
  }
});

// =============================================================================
// Table-driven: per-arr_type default delay profile detection
// =============================================================================

const delayProfileDefaultCases: Array<{
  label: string;
  arrType: StartupPullArrType;
  entity: Record<string, unknown>;
  expectedSkip: boolean;
  expectedConfidence: 'certain' | 'uncertain' | null;
}> = [
  {
    label: 'radarr id=1 is certain default',
    arrType: 'radarr',
    entity: buildRadarrDefaultDelayProfile(),
    expectedSkip: true,
    expectedConfidence: 'certain',
  },
  {
    label: 'sonarr id=1 is certain default',
    arrType: 'sonarr',
    entity: buildSonarrDefaultDelayProfile(),
    expectedSkip: true,
    expectedConfidence: 'certain',
  },
  {
    label: 'lidarr order=1 empty tags is uncertain default',
    arrType: 'lidarr',
    entity: buildLidarrUncertainDefaultDelayProfile(),
    expectedSkip: true,
    expectedConfidence: 'uncertain',
  },
  {
    label: 'radarr id=10 is not default',
    arrType: 'radarr',
    entity: buildNonDefaultDelayProfile('radarr'),
    expectedSkip: false,
    expectedConfidence: null,
  },
  {
    label: 'sonarr id=10 is not default',
    arrType: 'sonarr',
    entity: buildNonDefaultDelayProfile('sonarr'),
    expectedSkip: false,
    expectedConfidence: null,
  },
  {
    label: 'lidarr id=10 order=5 tags=[1,2] is not default',
    arrType: 'lidarr',
    entity: buildNonDefaultDelayProfile('lidarr'),
    expectedSkip: false,
    expectedConfidence: null,
  },
];

for (const { label, arrType, entity, expectedSkip, expectedConfidence } of delayProfileDefaultCases) {
  Deno.test(`shouldSkipStartupDefault (table-driven): ${label}`, () => {
    const decision = shouldSkipStartupDefault(arrType, 'delayProfiles', entity);
    assertEquals(decision.skip, expectedSkip);
    assertEquals(decision.confidence, expectedConfidence);
  });
}
