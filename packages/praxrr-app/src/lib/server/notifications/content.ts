/**
 * Provider-neutral content helpers shared by notifiers
 */

import type { Notification, NotificationSeverity } from './types.ts';

/**
 * Severity override if set, else derived from the last segment of the type
 * (e.g. `sync.failed` → error, `drift.detected` → warning, `canary.promoted` → success).
 */
export function resolveSeverity(n: Notification): NotificationSeverity {
  if (n.severity) return n.severity;
  const suffix = n.type.toLowerCase().split('.').pop() ?? '';
  if (suffix.endsWith('failed') || suffix.endsWith('error')) return 'error';
  if (['partial', 'degraded', 'detected', 'warn', 'warning'].some((s) => suffix.endsWith(s))) return 'warning';
  if (suffix.endsWith('success') || suffix.endsWith('promoted')) return 'success';
  return 'info';
}

/**
 * Plain title/message for text-based providers.
 */
export function renderText(n: Notification): { title: string; message: string } {
  return {
    title: n.generic?.title || 'Notification',
    message: n.generic?.message ?? '',
  };
}

/**
 * Cut `text` to at most `max` characters, ending with '…' when cut.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  return `${text.slice(0, max - 1)}…`;
}
