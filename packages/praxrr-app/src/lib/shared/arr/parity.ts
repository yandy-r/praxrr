import { type ArrAppType, type ArrSyncSurface, supportsArrSyncSurface } from '$shared/arr/capabilities.ts';
import { ARR_APP_TYPES } from '$shared/pcd/types.ts';

// ============================================================================
// ENTITY AXIS
// ============================================================================

/**
 * The five PCD config entities the Cross-Arr Parity Map tracks. `quality_definitions`
 * is listed explicitly because it is a media-management SUBSECTION, not its own
 * ArrSyncSurface - see PARITY_ENTITY_TO_SYNC_SURFACE below.
 */
export type ParityEntity =
  'custom_formats' | 'quality_profiles' | 'quality_definitions' | 'delay_profiles' | 'metadata_profiles';

/** Ordered list of declared parity entities */
export const PARITY_ENTITIES = [
  'custom_formats',
  'quality_profiles',
  'quality_definitions',
  'delay_profiles',
  'metadata_profiles',
] as const satisfies readonly ParityEntity[];

// ============================================================================
// SYNC-SURFACE BRIDGE (derived, not duplicated)
// ============================================================================

/**
 * Total map from parity entity to the ArrSyncSurface that gates it. A total
 * Record (not a partial map) forces a compile-time error if a new ParityEntity
 * is ever added without wiring it to a sync surface.
 */
export const PARITY_ENTITY_TO_SYNC_SURFACE = {
  custom_formats: 'custom_formats',
  quality_profiles: 'quality_profiles',
  quality_definitions: 'media_management', // subsection of media_management, not its own surface
  delay_profiles: 'delay_profiles',
  metadata_profiles: 'metadata_profiles',
} as const satisfies Record<ParityEntity, ArrSyncSurface>;

// ============================================================================
// NATIVE REFINEMENT (the only authored native-vs-shared data)
// ============================================================================

/** Per-app support status for a parity entity. */
export type ParityStatus = 'native' | 'shared' | 'unsupported';

/**
 * The ONLY authored layer of this module: which apps have a dedicated per-app
 * table for a given entity ('native') versus an arr_type-discriminated shared
 * table ('shared'). Whether an app supports the entity at all ('unsupported')
 * is never authored here - it is derived from supportsArrSyncSurface instead.
 */
export const NATIVE_ENTITY_APPS: Record<ParityEntity, readonly ArrAppType[]> = {
  custom_formats: [], // shared arr_type-discriminated table
  quality_profiles: [], // shared arr_type-discriminated table
  quality_definitions: ARR_APP_TYPES, // per-app *_quality_definitions tables
  delay_profiles: [], // shared table (no arr_type column at all)
  metadata_profiles: ['lidarr'], // Lidarr-only lidarr_metadata_profiles
};

// ============================================================================
// PREDICATES
// ============================================================================

/**
 * Resolve an app's support status for a parity entity. Returns 'unsupported'
 * when the app's capabilities.ts sync surface for this entity is off; otherwise
 * 'native' when the app has a dedicated table for the entity, else 'shared'.
 */
export function getEntitySupportStatus(app: ArrAppType, entity: ParityEntity): ParityStatus {
  if (!supportsArrSyncSurface(app, PARITY_ENTITY_TO_SYNC_SURFACE[entity])) return 'unsupported';
  return NATIVE_ENTITY_APPS[entity].includes(app) ? 'native' : 'shared';
}

// Non-regression acceptance check: pins the full (entity x app) parity verdict as
// literal data, mirroring capabilities.ts:168-205,235-237. This is a golden-master
// table (verified against capabilities.ts's own sync-surface booleans) - if
// PARITY_ENTITIES, ParityStatus, or ARR_APP_TYPES ever changes shape, or a verdict
// below stops matching reality, this fails to compile.
const PARITY_NON_REGRESSION_CHECK = {
  custom_formats: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  quality_profiles: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  quality_definitions: { radarr: 'native', sonarr: 'native', lidarr: 'native' },
  delay_profiles: { radarr: 'shared', sonarr: 'shared', lidarr: 'shared' },
  metadata_profiles: { radarr: 'unsupported', sonarr: 'unsupported', lidarr: 'native' },
} as const satisfies Record<ParityEntity, Record<ArrAppType, ParityStatus>>;
void PARITY_NON_REGRESSION_CHECK;
