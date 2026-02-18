import type { User } from '$db/queries/users.ts';
import { ARR_TARGET_ORDER } from '$shared/arr/capabilities.ts';
import type { NavItemDef, NavShell, ResolvedNavGroup, ResolvedNavItem } from '$shared/navigation/types.ts';
import { NAV_GROUPS, NAV_REGISTRY } from './registry.ts';

interface ResolveNavShellInput {
  user: User | null;
}

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

function canRenderNavItem(item: NavItemDef, user: User | null): boolean {
  if (item.devOnly && !isServerDev) {
    return false;
  }

  if (item.featureFlag === '__dev__' && !isServerDev) {
    return false;
  }

  if (item.permission && !user) {
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

function resolveNavItem(item: NavItemDef): ResolvedNavItem {
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

export function resolveNavShell({ user }: ResolveNavShellInput): NavShell {
  if (!user) {
    return emptyNavShell();
  }

  const visibleItems = NAV_REGISTRY.filter((item) => canRenderNavItem(item, user));

  const groups = NAV_GROUPS.slice()
    .sort((left, right) => left.order - right.order)
    .map((group): ResolvedNavGroup | undefined => {
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
