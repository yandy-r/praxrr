import type { ArrType } from '$shared/pcd/types.ts';

export type ArrAppType = Exclude<ArrType, 'all'>;
export type ArrIconKey = ArrAppType;
export type ArrConditionTargetType = ArrType;
export type ArrConditionTargetCheckboxColor = 'accent' | `var(--arr-${ArrAppType}-color)`;

export type ArrWorkflowSurface = 'instances' | 'library' | 'releases' | 'rename' | 'upgrades';
export type ArrSyncSurface = 'quality_profiles' | 'delay_profiles' | 'media_management';

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
        delay_profiles: true,
        media_management: true,
      },
    },
  },
};

export const ARR_APP_TYPES: ArrAppType[] = Object.keys(ARR_APPS) as ArrAppType[];

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

export function isArrAppType(value: string): value is ArrAppType {
  return Object.hasOwn(ARR_APPS, value);
}

export function getArrAppMetadata(type: ArrAppType): ArrAppMetadata {
  return ARR_APPS[type];
}

export function supportsArrWorkflow(type: ArrAppType, workflow: ArrWorkflowSurface): boolean {
  return ARR_APPS[type].capabilities.workflows[workflow];
}

export function supportsArrSyncSurface(type: ArrAppType, surface: ArrSyncSurface): boolean {
  return ARR_APPS[type].capabilities.sync[surface];
}
