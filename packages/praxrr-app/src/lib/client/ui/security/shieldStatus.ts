import type { CheckStatus, ShieldBand, TransportTier } from '$shared/security/index.ts';

/**
 * Shared presentation mapping for the security-posture surface — the single source of truth for band,
 * check-status, and transport-tier labels, `Badge` variants, and score text colours used by the
 * `/security-posture` dashboard. Mirrors `$ui/health/healthStatus.ts`. Colour is never the only signal
 * (every badge carries a label), keeping the surface colourblind-safe.
 */
export type ShieldBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const SHIELD_BAND_LABEL: Record<ShieldBand, string> = {
  hardened: 'Hardened',
  guarded: 'Guarded',
  exposed: 'Exposed',
  unknown: 'Unknown',
};

/** Tailwind text-colour classes for a band, used to tint the shield score by band semantics. */
export const SHIELD_BAND_TEXT_CLASS: Record<ShieldBand, string> = {
  hardened: 'text-emerald-600 dark:text-emerald-400',
  guarded: 'text-amber-600 dark:text-amber-400',
  exposed: 'text-red-600 dark:text-red-400',
  unknown: 'text-neutral-500 dark:text-neutral-400',
};

export function bandVariant(band: ShieldBand): ShieldBadgeVariant {
  switch (band) {
    case 'hardened':
      return 'success';
    case 'guarded':
      return 'warning';
    case 'exposed':
      return 'danger';
    case 'unknown':
      return 'neutral';
  }
}

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'Pass',
  advisory: 'Advisory',
  attention: 'Review',
  action: 'Action needed',
  assured: 'Verified',
  na: 'Not evaluated',
};

export function statusVariant(status: CheckStatus): ShieldBadgeVariant {
  switch (status) {
    case 'pass':
    case 'assured':
      return 'success';
    case 'attention':
      return 'warning';
    case 'action':
      return 'danger';
    case 'advisory':
      return 'info';
    case 'na':
      return 'neutral';
  }
}

export const TRANSPORT_TIER_LABEL: Record<TransportTier, string> = {
  encrypted: 'TLS',
  loopback: 'Loopback',
  'docker-alias': 'Container',
  private: 'Private LAN',
  unknown: 'Unclassified',
  public: 'Public',
};

export function tierVariant(tier: TransportTier): ShieldBadgeVariant {
  switch (tier) {
    case 'encrypted':
    case 'loopback':
    case 'docker-alias':
      return 'success';
    case 'private':
    case 'unknown':
      return 'warning';
    case 'public':
      return 'danger';
  }
}
