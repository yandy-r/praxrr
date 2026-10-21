/**
 * Pure stacking rules for the alert store: keyed alerts replace their predecessor and the visible
 * stack is capped, dropping the oldest non-error alert first so failures stay on screen longest.
 */
export const MAX_VISIBLE_ALERTS = 5;

export interface StackableAlert {
  id: string;
  type: string;
  key?: string;
}

/** Returns the new stack after appending `alert`, applying key replacement and the visible cap. */
export function pushAlert<T extends StackableAlert>(alerts: readonly T[], alert: T, max = MAX_VISIBLE_ALERTS): T[] {
  const next = alert.key === undefined ? [...alerts] : alerts.filter((a) => a.key !== alert.key);
  next.push(alert);
  while (next.length > Math.max(1, max)) {
    const dropAt = next.findIndex((a) => a.type !== 'error');
    // All errors: drop the oldest one, never the alert just added.
    next.splice(dropAt === -1 || dropAt === next.length - 1 ? 0 : dropAt, 1);
  }
  return next;
}
