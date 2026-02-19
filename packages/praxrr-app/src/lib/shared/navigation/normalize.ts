import type { NavChildDef, NavItemDef, ResolvedNavChild, ResolvedNavItem } from './types.ts';

export function normalizeActivePattern(pattern: string | RegExp | undefined): string | undefined {
  if (pattern === undefined) {
    return undefined;
  }

  if (typeof pattern === 'string') {
    return pattern;
  }

  return pattern.source;
}

export function normalizeChild(item: NavChildDef): ResolvedNavChild {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    activePattern: normalizeActivePattern(item.activePattern),
  };
}

export function normalizeChildren(items: NavChildDef[]): ResolvedNavChild[] {
  return items
    .slice()
    .sort((left, right) => {
      if (left.order === right.order) {
        return left.id.localeCompare(right.id);
      }

      return left.order - right.order;
    })
    .map(normalizeChild);
}

export function normalizeNavItem(item: NavItemDef): ResolvedNavItem {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    mobilePriority: item.mobilePriority,
    hasChildren: item.hasChildren,
    activePattern: normalizeActivePattern(item.activePattern),
    children: normalizeChildren(item.children ?? []),
    iconKey: item.iconKey,
    emoji: item.emoji,
  };
}
