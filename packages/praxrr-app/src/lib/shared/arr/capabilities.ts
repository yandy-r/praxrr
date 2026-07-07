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
export type ArrSyncSurface =
  'quality_profiles' | 'custom_formats' | 'delay_profiles' | 'media_management' | 'metadata_profiles';

/** Ordered list of declared workflow surfaces */
export const ARR_WORKFLOW_SURFACES = [
  'instances',
  'library',
  'releases',
  'rename',
  'upgrades',
] as const satisfies readonly ArrWorkflowSurface[];

/** Ordered list of declared sync surfaces */
export const ARR_SYNC_SURFACES = [
  'quality_profiles',
  'custom_formats',
  'delay_profiles',
  'media_management',
  'metadata_profiles',
] as const satisfies readonly ArrSyncSurface[];

// Non-regression acceptance checks: capability surface keys stay stable.
const ARR_CAPABILITY_KEY_NON_REGRESSION_CHECK = {
  workflows: ARR_WORKFLOW_SURFACES,
  sync: ARR_SYNC_SURFACES,
} as const satisfies {
  workflows: readonly ['instances', 'library', 'releases', 'rename', 'upgrades'];
  sync: readonly ['quality_profiles', 'custom_formats', 'delay_profiles', 'media_management', 'metadata_profiles'];
};
void ARR_CAPABILITY_KEY_NON_REGRESSION_CHECK;

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

const RADARR_CAPABILITIES = {
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
    metadata_profiles: false,
  },
} as const satisfies ArrCapabilities;

const SONARR_CAPABILITIES = {
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
    metadata_profiles: false,
  },
} as const satisfies ArrCapabilities;

const LIDARR_CAPABILITIES = {
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
    metadata_profiles: true,
  },
} as const satisfies ArrCapabilities;

// ============================================================================
// APP REGISTRY
// ============================================================================

export const ARR_APPS = {
  radarr: {
    type: 'radarr',
    label: 'Radarr',
    iconKey: 'radarr',
    conditionTargetCheckboxColor: 'var(--arr-radarr-color)',
    capabilities: RADARR_CAPABILITIES,
  },
  sonarr: {
    type: 'sonarr',
    label: 'Sonarr',
    iconKey: 'sonarr',
    conditionTargetCheckboxColor: 'var(--arr-sonarr-color)',
    capabilities: SONARR_CAPABILITIES,
  },
  lidarr: {
    type: 'lidarr',
    label: 'Lidarr',
    iconKey: 'lidarr',
    conditionTargetCheckboxColor: 'var(--arr-lidarr-color)',
    capabilities: LIDARR_CAPABILITIES,
  },
} as const satisfies Record<ArrAppType, ArrAppMetadata>;

// Non-regression acceptance checks: Radarr/Sonarr capability behavior is unchanged.
const ARR_CAPABILITY_NON_REGRESSION_CHECK = {
  radarr: ARR_APPS.radarr.capabilities,
  sonarr: ARR_APPS.sonarr.capabilities,
} as const satisfies {
  radarr: {
    workflows: {
      instances: true;
      library: true;
      releases: true;
      rename: true;
      upgrades: true;
    };
    sync: {
      quality_profiles: true;
      custom_formats: true;
      delay_profiles: true;
      media_management: true;
      metadata_profiles: false;
    };
  };
  sonarr: {
    workflows: {
      instances: true;
      library: true;
      releases: true;
      rename: true;
      upgrades: false;
    };
    sync: {
      quality_profiles: true;
      custom_formats: true;
      delay_profiles: true;
      media_management: true;
      metadata_profiles: false;
    };
  };
};
void ARR_CAPABILITY_NON_REGRESSION_CHECK;

// Non-regression acceptance checks:
// - arr app keys remain explicit and complete;
// - Radarr/Sonarr media-management support stays true;
// - Lidarr media-management support is explicit in this contract surface.
const ARR_APP_KEY_NON_REGRESSION_CHECK = {
  radarr: 'radarr',
  sonarr: 'sonarr',
  lidarr: 'lidarr',
} as const satisfies Record<ArrAppType, ArrAppType>;

const ARR_MEDIA_MANAGEMENT_SYNC_CAPABILITY_NON_REGRESSION_CHECK = {
  radarr: ARR_APPS.radarr.capabilities.sync.media_management,
  sonarr: ARR_APPS.sonarr.capabilities.sync.media_management,
  lidarr: ARR_APPS.lidarr.capabilities.sync.media_management,
} as const satisfies {
  radarr: true;
  sonarr: true;
  lidarr: true;
};
const ARR_METADATA_PROFILES_SYNC_CAPABILITY_NON_REGRESSION_CHECK = {
  radarr: ARR_APPS.radarr.capabilities.sync.metadata_profiles,
  sonarr: ARR_APPS.sonarr.capabilities.sync.metadata_profiles,
  lidarr: ARR_APPS.lidarr.capabilities.sync.metadata_profiles,
} as const satisfies {
  radarr: false;
  sonarr: false;
  lidarr: true;
};
void ARR_APP_KEY_NON_REGRESSION_CHECK;
void ARR_MEDIA_MANAGEMENT_SYNC_CAPABILITY_NON_REGRESSION_CHECK;
void ARR_METADATA_PROFILES_SYNC_CAPABILITY_NON_REGRESSION_CHECK;

// ============================================================================
// DERIVED CONSTANTS
// ============================================================================

export const ARR_APP_TYPES = SHARED_ARR_APP_TYPES;

/** Order for displaying arr target badges (all, then radarr, sonarr, lidarr) */
export const ARR_TARGET_ORDER = ['all', ...SHARED_ARR_APP_TYPES] as const satisfies readonly ArrConditionTargetType[];

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

/**
 * Check whether a value matches a supported Arr app type.
 *
 * @param value - Unknown value to test.
 * @returns True when the value is a supported Arr app type.
 */
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
