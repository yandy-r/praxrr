import type { NavChildDef, NavItemDef, ResolvedNavChild, ResolvedNavItem } from './types.ts';

/**
 * Normalises an active-pattern value for serialization.
 * Converts a RegExp to its source string; passes string and undefined through unchanged.
 *
 * @param pattern - A string pattern, RegExp, or undefined
 * @returns The pattern as a plain string, or undefined if no pattern was given
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
 * Converts a raw nav child definition into a resolved, serializable child object.
 *
 * @param item - The raw nav child definition to normalise
 * @returns The resolved nav child with a plain-string active pattern
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
 * Sorts and normalises an array of nav child definitions.
 * Children are sorted by `order` (ascending), with `id` used as a tiebreaker.
 *
 * @param items - The raw nav child definitions to normalise
 * @returns The sorted and resolved nav children
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
 * Converts a raw nav item definition into a fully resolved nav item, including
 * sorted children and a plain-string active pattern.
 *
 * @param item - The raw nav item definition to normalise
 * @returns The resolved nav item ready for rendering
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
