import type { User } from '$db/queries/users.ts';
import { ARR_APP_TYPES, supportsFeature, type ArrFeature } from '$shared/arr/capabilities.ts';
import { ARR_TARGET_ORDER } from '$shared/arr/capabilities.ts';
import type { NavItemDef, NavShell, ResolvedNavGroup, ResolvedNavItem } from '$shared/navigation/types.ts';
import { NAV_GROUPS, NAV_REGISTRY } from './registry.ts';

interface ResolveNavShellInput {
  user: User | null;
}

type ArrCapabilityAwareNavItem = NavItemDef & { requiredFeature?: ArrFeature };

type ResolvedNavItemWithFeature = ResolvedNavItem & { requiredFeature?: ArrFeature };
type ResolvedNavGroupWithFeature = ResolvedNavGroup & { items: ResolvedNavItemWithFeature[] };

const isServerDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;

function resolvePattern(pattern: string | RegExp | undefined): string | undefined {
  if (!pattern) {
    return undefined;
  }

  if (typeof pattern === 'string') {
    return pattern;
  }

  return pattern.source;
}

function hasSupportedFeature(feature: ArrFeature | undefined): boolean {
  if (!feature) {
    return true;
  }

  return ARR_APP_TYPES.some((type) => supportsFeature(type, feature));
}

function canRenderNavItem(item: ArrCapabilityAwareNavItem, user: User | null): boolean {
  if (item.devOnly && !isServerDev) {
    return false;
  }

  if (item.featureFlag === '__dev__' && !isServerDev) {
    return false;
  }

  if (item.permission && !user) {
    return false;
  }

  if (!hasSupportedFeature(item.requiredFeature)) {
    return false;
  }

  return true;
}

function resolveChildItems(item: NavItemDef): ResolvedNavItem['children'] {
  const children = item.children ?? [];

  return children
    .slice()
    .sort((left, right) => {
      if (left.order === right.order) {
        return left.id.localeCompare(right.id);
      }

      return left.order - right.order;
    })
    .map((child) => ({
      id: child.id,
      label: child.label,
      href: child.href,
      activePattern: resolvePattern(child.activePattern),
    }));
}

function resolveNavItem(item: ArrCapabilityAwareNavItem): ResolvedNavItemWithFeature {
  const children = resolveChildItems(item);

  return {
    id: item.id,
    label: item.label,
    href: item.href,
    mobilePriority: item.mobilePriority,
    hasChildren: item.hasChildren && children.length > 0,
    activePattern: resolvePattern(item.activePattern),
    iconKey: item.iconKey,
    emoji: item.emoji,
    requiredFeature: item.requiredFeature,
    children,
  };
}

function emptyNavShell(): NavShell {
  return {
    variant: 'legacy',
    arrScopeOptions: [...ARR_TARGET_ORDER],
    groups: [],
  };
}

/**
 * Resolve navigation groups and items visible for the current user context.
 *
 * @param input - Inputs controlling navigation visibility.
 * @returns A fully resolved navigation shell.
 */
export function resolveNavShell({ user }: ResolveNavShellInput): NavShell {
  if (!user) {
    return emptyNavShell();
  }

  const visibleItems = NAV_REGISTRY.filter((item) => canRenderNavItem(item, user));

  const groups = NAV_GROUPS.slice()
    .sort((left, right) => left.order - right.order)
    .map((group): ResolvedNavGroupWithFeature | undefined => {
      const items = visibleItems
        .filter((item) => item.groupId === group.id)
        .slice()
        .sort((left, right) => {
          if (left.order === right.order) {
            return left.label.localeCompare(right.label);
          }

          return left.order - right.order;
        })
        .map(resolveNavItem);

      if (items.length === 0) {
        return undefined;
      }

      return {
        id: group.id,
        label: group.label,
        items,
      };
    })
    .filter((group): group is ResolvedNavGroup => group !== undefined);

  return {
    variant: 'legacy',
    arrScopeOptions: [...ARR_TARGET_ORDER],
    groups,
  };
}
