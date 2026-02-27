import type { NavChildDef, NavItemDef, ResolvedNavChild, ResolvedNavItem } from './types.ts';

/**
 * Normalize a navigation active pattern into a string representation.
 *
 * @param pattern - A string pattern, RegExp, or undefined.
 * @returns The pattern as a string, or undefined when no pattern is provided.
 */
export function normalizeActivePattern(pattern: string | RegExp | undefined): string | undefined {
  if (pattern === undefined) {
    return undefined;
  }

  if (typeof pattern === 'string') {
    return pattern;
  }

  return pattern.source;
}

/**
 * Normalize a child navigation item into a resolved child item.
 *
 * @param item - Raw navigation child definition.
 * @returns The resolved child item with an active pattern string if provided.
 */
export function normalizeChild(item: NavChildDef): ResolvedNavChild {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    activePattern: normalizeActivePattern(item.activePattern),
  };
}

/**
 * Normalize and sort child navigation items by order then id.
 *
 * @param items - Navigation child definitions.
 * @returns A sorted, resolved list of navigation child items.
 */
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

/**
 * Normalize and sort a root navigation item, resolving nested children.
 *
 * @param item - Raw navigation item definition.
 * @returns A resolved navigation item with normalized active pattern and children.
 */
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
