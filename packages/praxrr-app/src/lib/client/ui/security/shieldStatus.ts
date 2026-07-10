import type { components } from '$api/v1.d.ts';

type SecuritySchemas = components['schemas'];
type CheckStatus = SecuritySchemas['SecurityCheckStatus'];
type DnsEvidenceSource = SecuritySchemas['SecurityDnsEvidenceSource'];
type DnsOutcome = SecuritySchemas['SecurityDnsOutcome'];
type ShieldBand = SecuritySchemas['SecurityShieldBand'];
type TransportTier = SecuritySchemas['SecurityTransportTier'];

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
  mixed: 'Mixed address scopes',
};

export const DNS_OUTCOME_LABEL: Record<DnsOutcome, string> = {
  'not-applicable': 'DNS not needed',
  resolved: 'DNS resolved',
  partial: 'Partial DNS evidence',
  timeout: 'DNS timed out',
  failed: 'DNS unavailable',
  empty: 'No A/AAAA answers',
  'budget-exceeded': 'DNS lookup deferred',
};

export const DNS_SOURCE_LABEL: Record<DnsEvidenceSource, string> = {
  none: 'No DNS observation',
  fresh: 'Fresh observation',
  cache: 'Cached observation',
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
    case 'mixed':
      return 'danger';
  }
}

export function dnsOutcomeVariant(outcome: DnsOutcome): ShieldBadgeVariant {
  switch (outcome) {
    case 'resolved':
      return 'info';
    case 'partial':
    case 'timeout':
    case 'failed':
    case 'empty':
    case 'budget-exceeded':
      return 'warning';
    case 'not-applicable':
      return 'neutral';
  }
}
