import {
  type ArrType,
  type ArrAppType as SharedArrAppType,
  ARR_APP_TYPES as SHARED_ARR_APP_TYPES,
} from '$shared/pcd/types.ts';

export type ArrAppType = SharedArrAppType;

// ============================================================================
// TYPE ALIASES
// ============================================================================

/** Concrete Arr application type (excludes the 'all' meta-type) */
/** Icon key used to resolve app-specific icon assets */
export type ArrIconKey = ArrAppType;

/** Condition target type including the 'all' meta-type */
export type ArrConditionTargetType = ArrType;

/** CSS color value for condition-target checkboxes */
export type ArrConditionTargetCheckboxColor = 'accent' | `var(--arr-${ArrAppType}-color)`;

// ============================================================================
// CAPABILITY SURFACES
// ============================================================================

/** Feature surfaces driven by page/route access */
export type ArrWorkflowSurface = 'instances' | 'library' | 'releases' | 'rename' | 'upgrades';

/** Feature surfaces driven by sync pipeline support */
export type ArrSyncSurface = 'quality_profiles' | 'custom_formats' | 'delay_profiles' | 'media_management';

/** Ordered list of declared workflow surfaces */
export const ARR_WORKFLOW_SURFACES: ArrWorkflowSurface[] = [
  'instances',
  'library',
  'releases',
  'rename',
  'upgrades',
];

/** Ordered list of declared sync surfaces */
export const ARR_SYNC_SURFACES: ArrSyncSurface[] = [
  'quality_profiles',
  'custom_formats',
  'delay_profiles',
  'media_management',
];

/** Union of all feature surfaces for generic lookups */
export type ArrFeature = ArrWorkflowSurface | ArrSyncSurface;

// ============================================================================
// CAPABILITY INTERFACES
// ============================================================================

export interface ArrCapabilities {
  workflows: Record<ArrWorkflowSurface, boolean>;
  sync: Record<ArrSyncSurface, boolean>;
}

export interface ArrAppMetadata {
  type: ArrAppType;
  label: string;
  iconKey: ArrIconKey;
  conditionTargetCheckboxColor: `var(--arr-${ArrAppType}-color)`;
  capabilities: ArrCapabilities;
}

export interface ArrConditionTargetOption {
  value: ArrConditionTargetType;
  label: string;
  checkboxColor: ArrConditionTargetCheckboxColor;
}

// ============================================================================
// APP REGISTRY
// ============================================================================

export const ARR_APPS: Record<ArrAppType, ArrAppMetadata> = {
  radarr: {
    type: 'radarr',
    label: 'Radarr',
    iconKey: 'radarr',
    conditionTargetCheckboxColor: 'var(--arr-radarr-color)',
    capabilities: {
      workflows: {
        instances: true,
        library: true,
        releases: true,
        rename: true,
        upgrades: true,
      },
      sync: {
        quality_profiles: true,
        custom_formats: true,
        delay_profiles: true,
        media_management: true,
      },
    },
  },
  sonarr: {
    type: 'sonarr',
    label: 'Sonarr',
    iconKey: 'sonarr',
    conditionTargetCheckboxColor: 'var(--arr-sonarr-color)',
    capabilities: {
      workflows: {
        instances: true,
        library: true,
        releases: true,
        rename: true,
        upgrades: false,
      },
      sync: {
        quality_profiles: true,
        custom_formats: true,
        delay_profiles: true,
        media_management: true,
      },
    },
  },
  lidarr: {
    type: 'lidarr',
    label: 'Lidarr',
    iconKey: 'lidarr',
    conditionTargetCheckboxColor: 'var(--arr-lidarr-color)',
    capabilities: {
      workflows: {
        instances: true,
        library: true,
        releases: true,
        rename: false,
        upgrades: false,
      },
      sync: {
        quality_profiles: true,
        custom_formats: true,
        delay_profiles: true,
        media_management: true,
      },
    },
  },
};

// ============================================================================
// DERIVED CONSTANTS
// ============================================================================

export const ARR_APP_TYPES: ArrAppType[] = [...SHARED_ARR_APP_TYPES];

/** Order for displaying arr target badges (all, then radarr, sonarr, lidarr) */
export const ARR_TARGET_ORDER: ArrConditionTargetType[] = ['all', ...SHARED_ARR_APP_TYPES];

export const ARR_APP_OPTIONS: Array<{ value: ArrAppType; label: string }> = ARR_APP_TYPES.map((type) => ({
  value: type,
  label: ARR_APPS[type].label,
}));

export const ARR_CONDITION_TARGET_OPTIONS: ArrConditionTargetOption[] = [
  { value: 'all', label: 'All Apps', checkboxColor: 'accent' },
  ...ARR_APP_TYPES.map((type) => {
    const metadata = ARR_APPS[type];
    return {
      value: type,
      label: metadata.label,
      checkboxColor: metadata.conditionTargetCheckboxColor,
    };
  }),
];

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isArrAppType(value: string): value is ArrAppType {
  return Object.hasOwn(ARR_APPS, value);
}

// ============================================================================
// ACCESSORS
// ============================================================================

/** Return the full metadata record for an Arr app */
export function getArrAppMetadata(type: ArrAppType): ArrAppMetadata {
  return ARR_APPS[type];
}

/** Return just the capabilities record for an Arr app */
export function getArrCapabilities(type: ArrAppType): ArrCapabilities {
  return ARR_APPS[type].capabilities;
}

// ============================================================================
// PREDICATES
// ============================================================================

/** Check whether an Arr app supports a given workflow surface */
export function supportsArrWorkflow(type: ArrAppType, workflow: ArrWorkflowSurface): boolean {
  return ARR_APPS[type].capabilities.workflows[workflow];
}

/** Check whether an Arr app supports a given sync surface */
export function supportsArrSyncSurface(type: ArrAppType, surface: ArrSyncSurface): boolean {
  return ARR_APPS[type].capabilities.sync[surface];
}

/**
 * Resolve arr targets for display (e.g., custom format list badges).
 * Preserves both 'all' and app-specific targets when present—mixed data is valid
 * (e.g., arr_type='all' condition plus Sonarr-specific score override).
 */
export function resolveArrTargets(targets: Set<ArrConditionTargetType> | undefined): ArrConditionTargetType[] {
  if (!targets || targets.size === 0) return ['all'];
  return ARR_TARGET_ORDER.filter((target) => targets.has(target));
}

/**
 * Generic predicate that checks any feature (workflow or sync) by name.
 * Returns false if the feature name is not recognized in either category.
 */
export function supportsFeature(type: ArrAppType, feature: string): boolean {
  const caps = ARR_APPS[type].capabilities;
  if (Object.hasOwn(caps.workflows, feature)) {
    return caps.workflows[feature as ArrWorkflowSurface];
  }
  if (Object.hasOwn(caps.sync, feature)) {
    return caps.sync[feature as ArrSyncSurface];
  }
  return false;
}
