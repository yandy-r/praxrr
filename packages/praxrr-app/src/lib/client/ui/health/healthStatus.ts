import type { HealthBand } from '$shared/health/index.ts';

/**
 * Shared presentation mapping for a config-health band — the single source of truth for the
 * band label, `Badge` variant, and score text colour used by both the `/config-health`
 * dashboard and the `/config-health/[instanceId]` detail view. Mirrors `driftStatus.ts`.
 */
export type HealthBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: 'Healthy',
  attention: 'Attention',
  'needs-review': 'Needs review',
  unknown: 'Unknown',
};

/** Tailwind text-colour classes for a band, used to tint KPI numbers by band semantics. */
export const HEALTH_BAND_TEXT_CLASS: Record<HealthBand, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  attention: 'text-amber-600 dark:text-amber-400',
  'needs-review': 'text-red-600 dark:text-red-400',
  unknown: 'text-neutral-500 dark:text-neutral-400',
};

export function bandVariant(band: HealthBand): HealthBadgeVariant {
  switch (band) {
    case 'healthy':
      return 'success';
    case 'attention':
      return 'warning';
    case 'needs-review':
      return 'danger';
    case 'unknown':
      return 'neutral';
  }
}
