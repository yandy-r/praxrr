import { assert, assertEquals } from '@std/assert';
import {
  PARITY_ENTITIES,
  PARITY_ENTITY_TO_SYNC_SURFACE,
  getEntitySupportStatus,
  type ParityEntity,
  type ParityStatus,
} from '$shared/arr/parity.ts';
import { ARR_SEMANTIC_DIFFERENCES, type ParityScope } from '$shared/arr/semanticDifferences.ts';
import {
  ARR_APP_TYPES,
  ARR_SYNC_SURFACES,
  ARR_WORKFLOW_SURFACES,
  supportsArrSyncSurface,
  type ArrAppType,
} from '$shared/arr/capabilities.ts';
import { isMediaManagementSubsectionSupported } from '$sync/mappings.ts';
import { buildParityRows } from '$shared/arr/parityRows.ts';

// ============================================================================
// TRI-STATE TRUTH TABLE
// ============================================================================

// Golden-master verdicts, mirroring parity.ts's own PARITY_NON_REGRESSION_CHECK.
const EXPECTED_PARITY_STATUS: Record<ParityEntity, Record<ArrAppType, ParityStatus>> = {
  custom_formats: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  quality_profiles: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  quality_definitions: { radarr: 'native', sonarr: 'native', lidarr: 'native' },
  delay_profiles: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  metadata_profiles: { radarr: 'unsupported', sonarr: 'unsupported', lidarr: 'native' },
};

Deno.test('getEntitySupportStatus: matches the tri-state truth table for every (entity x app)', () => {
  for (const entity of PARITY_ENTITIES) {
    for (const app of ARR_APP_TYPES) {
      const expected = EXPECTED_PARITY_STATUS[entity][app];
      assertEquals(getEntitySupportStatus(app, entity), expected, `expected ${entity}/${app} to be '${expected}'`);
    }
  }
});

// ============================================================================
// BRIDGE TOTALITY
// ============================================================================

Deno.test('PARITY_ENTITY_TO_SYNC_SURFACE: every PARITY_ENTITIES entry has a sync-surface mapping', () => {
  for (const entity of PARITY_ENTITIES) {
    const surface = PARITY_ENTITY_TO_SYNC_SURFACE[entity];
    assert(surface !== undefined, `${entity} is missing a PARITY_ENTITY_TO_SYNC_SURFACE mapping`);
    assert(
      ARR_SYNC_SURFACES.includes(surface),
      `${entity} maps to '${surface}', which is not a declared ArrSyncSurface`
    );
  }
});

// ============================================================================
// AXIS <-> CAPABILITIES CONSISTENCY
// ============================================================================

Deno.test('getEntitySupportStatus: unsupported iff the mapped sync surface is off', () => {
  for (const app of ARR_APP_TYPES) {
    for (const entity of PARITY_ENTITIES) {
      const surface = PARITY_ENTITY_TO_SYNC_SURFACE[entity];
      const surfaceOn = supportsArrSyncSurface(app, surface);
      const status = getEntitySupportStatus(app, entity);
      assertEquals(
        status === 'unsupported',
        !surfaceOn,
        `${app}/${entity}: status='${status}' but supportsArrSyncSurface=${surfaceOn}`
      );
    }
  }
});

// ============================================================================
// QUALITY_DEFINITIONS <-> MEDIA-MANAGEMENT SUBSECTION PIN
// ============================================================================

Deno.test('quality_definitions: support status matches the qualityDefinitions subsection pin', () => {
  for (const app of ARR_APP_TYPES) {
    const supported = getEntitySupportStatus(app, 'quality_definitions') !== 'unsupported';
    const subsectionSupported = isMediaManagementSubsectionSupported(app, 'qualityDefinitions');
    assertEquals(
      supported,
      subsectionSupported,
      `${app}: quality_definitions support=${supported} but qualityDefinitions subsection=${subsectionSupported}`
    );
  }
});

// ============================================================================
// CATALOG INVARIANTS
// ============================================================================

const VALID_SCOPES: readonly ParityScope[] = [...PARITY_ENTITIES, ...ARR_WORKFLOW_SURFACES];

Deno.test('ARR_SEMANTIC_DIFFERENCES: has at least 8 entries', () => {
  assert(ARR_SEMANTIC_DIFFERENCES.length >= 8, `expected >= 8 entries, got ${ARR_SEMANTIC_DIFFERENCES.length}`);
});

Deno.test('ARR_SEMANTIC_DIFFERENCES: every entry has non-empty prose, valid apps, and a valid scope', () => {
  for (const entry of ARR_SEMANTIC_DIFFERENCES) {
    assert(entry.summary.length > 0, `entry with scope '${entry.scope}' has an empty summary`);
    assert(entry.detail.length > 0, `entry with scope '${entry.scope}' has an empty detail`);
    assert(entry.sourceRefs.length > 0, `entry with scope '${entry.scope}' has empty sourceRefs`);
    assert(entry.apps.length > 0, `entry with scope '${entry.scope}' has an empty apps list`);
    for (const app of entry.apps) {
      assert(ARR_APP_TYPES.includes(app), `entry with scope '${entry.scope}' names unknown app '${app}'`);
    }
    assert(
      VALID_SCOPES.includes(entry.scope),
      `entry scope '${entry.scope}' is neither a ParityEntity nor an ArrWorkflowSurface`
    );
  }
});

// ============================================================================
// PARITY ROWS
// ============================================================================

Deno.test('buildParityRows: returns one row per PARITY_ENTITIES entry matching getEntitySupportStatus', () => {
  const rows = buildParityRows();
  assertEquals(rows.length, PARITY_ENTITIES.length);

  for (const entity of PARITY_ENTITIES) {
    const row = rows.find((r) => r.entity === entity);
    assert(row !== undefined, `missing parity row for entity '${entity}'`);
    for (const app of ARR_APP_TYPES) {
      assertEquals(
        row[app],
        getEntitySupportStatus(app, entity),
        `row for ${entity}/${app} does not match getEntitySupportStatus`
      );
    }
  }
});
