import type { ArrType } from '$shared/pcd/types.ts';

import { NAV_GROUP_IDS, NAV_MOBILE_PRIORITIES } from './constants.ts';

export type NavVariant = 'legacy' | 'nav_v2';

/** Top-level navigation group identifier */
export type NavGroupId = (typeof NAV_GROUP_IDS)[number];

/** Mobile visibility priority for bottom navigation */
export type NavMobilePriority = (typeof NAV_MOBILE_PRIORITIES)[number];

export interface NavChildDef {
  id: string;
  label: string;
  href: string;
  activePattern?: string | RegExp;
  order: number;
}

export interface NavItemDef {
  id: string;
  label: string;
  href: string;
  groupId: NavGroupId;
  order: number;
  arrScope: ArrType;
  mobilePriority: NavMobilePriority;
  iconKey: string;
  emoji?: string;
  hasChildren: boolean;
  activePattern?: string | RegExp;
  children?: NavChildDef[];
  featureFlag?: string;
  permission?: string;
  devOnly?: boolean;
}

export interface ResolvedNavChild {
  id: string;
  label: string;
  href: string;
  activePattern?: string;
}

export interface ResolvedNavItem {
  id: string;
  label: string;
  href: string;
  mobilePriority: NavMobilePriority;
  hasChildren: boolean;
  activePattern?: string;
  children: ResolvedNavChild[];
  iconKey: string;
  emoji?: string;
}

export interface ResolvedNavGroup {
  id: NavGroupId;
  label: string;
  items: ResolvedNavItem[];
}

export interface NavShell {
  variant: NavVariant;
  arrScopeOptions: ArrType[];
  groups: ResolvedNavGroup[];
}
