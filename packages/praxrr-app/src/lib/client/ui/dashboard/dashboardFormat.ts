import type { DashboardSource, HomeDashboardData } from '$shared/dashboard/types.ts';

/** Short relative time ("5 min ago") with a stable fallback for missing or invalid input. */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never';

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

export type AttentionTone = 'warning' | 'danger' | 'info';

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  text: string;
  href: string;
}

function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Friendly names for degraded sources, shown in the "couldn't be loaded" notice. */
export const DASHBOARD_SOURCE_LABEL: Record<DashboardSource, string> = {
  instances: 'Arr instances',
  drift: 'drift status',
  health: 'config health',
  lastSync: 'last sync results',
  recentSyncs: 'recent syncs',
  conflicts: 'conflicts and databases',
  canary: 'canary rollouts',
  security: 'security posture',
};

export function isDegraded(data: HomeDashboardData, source: DashboardSource): boolean {
  return data.degraded.includes(source);
}

/** Collapse the dashboard payload into the ordered list of things that need action. */
export function buildAttentionItems(data: HomeDashboardData): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { driftInstances, healthInstances, failedSyncInstances } = data.attention;

  // `driftInstances` already covers drifted + unreachable/unauthorized/error and skips
  // acknowledged/snoozed, so one item replaces the old per-status counts.
  if (driftInstances > 0) {
    items.push({
      id: 'drift',
      tone: 'warning',
      text: `${plural(driftInstances, 'instance')} ${driftInstances === 1 ? 'needs' : 'need'} drift attention`,
      href: '/drift',
    });
  }

  if (healthInstances > 0) {
    items.push({
      id: 'health',
      tone: 'warning',
      text: `${plural(healthInstances, 'instance')} ${healthInstances === 1 ? 'needs' : 'need'} a health review`,
      href: '/config-health',
    });
  }

  if (failedSyncInstances > 0) {
    items.push({
      id: 'failed-syncs',
      tone: 'danger',
      text: `${plural(failedSyncInstances, 'instance')} had a failed sync`,
      href: '/sync-history?status=failed',
    });
  }

  if (data.conflicts.total > 0) {
    const only = data.conflicts.databases.length === 1 ? data.conflicts.databases[0] : null;
    items.push({
      id: 'conflicts',
      tone: 'danger',
      text: `${plural(data.conflicts.total, 'conflict')} to resolve`,
      href: only?.href ?? '/databases',
    });
  }

  if (data.canary.length > 0) {
    items.push({
      id: 'canary',
      tone: 'info',
      text: `${plural(data.canary.length, 'canary rollout')} in progress`,
      href: data.canary.length === 1 ? data.canary[0].href : '/canary',
    });
  }

  // The parser is optional, so this is informational rather than a warning.
  if (!data.parser.available) {
    items.push({
      id: 'parser',
      tone: 'info',
      text: 'Parser service unavailable',
      href: '#parser-status',
    });
  }

  if (data.security?.band === 'exposed') {
    items.push({
      id: 'security',
      tone: 'danger',
      text: 'Security posture is exposed',
      href: '/security-posture',
    });
  }

  return items;
}
