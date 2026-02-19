export const NAV_GROUP_IDS = ['overview', 'apps', 'policies', 'operations', 'settings', 'dev'] as const;

export const NAV_GROUP_ID = {
  overview: 'overview',
  apps: 'apps',
  policies: 'policies',
  operations: 'operations',
  settings: 'settings',
  dev: 'dev',
} as const;

export const NAV_MOBILE_PRIORITIES = ['always', 'medium', 'low'] as const;

export const NAV_MOBILE_PRIORITY = {
  always: 'always',
  medium: 'medium',
  low: 'low',
} as const;
