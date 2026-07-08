/**
 * Pure, client-safe presentation helper for Arr support tiers.
 *
 * Maps an `ArrSupportTier` (from the shared, client-safe compatibility model) to
 * the Badge component's real `variant` values plus a display label, a coarse
 * semantic `tone`, and a lucide icon. No server imports — safe in any bundle.
 */
import type { ComponentType } from 'svelte';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-svelte';
import type { ArrSupportTier } from '$shared/arr/compatibility.ts';

/** Subset of Badge.svelte `variant` values used for support tiers. */
export type SupportTierBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

/** Coarse semantic tone, independent of concrete Badge variant naming. */
export type SupportTierTone = 'positive' | 'caution' | 'critical' | 'muted';

export interface SupportTierDescriptor {
  variant: SupportTierBadgeVariant;
  label: string;
  tone: SupportTierTone;
  icon: ComponentType;
}

const SUPPORT_TIER_DESCRIPTORS: Record<ArrSupportTier, SupportTierDescriptor> = {
  supported: { variant: 'success', label: 'Supported', tone: 'positive', icon: CheckCircle2 },
  degraded: { variant: 'warning', label: 'Degraded', tone: 'caution', icon: AlertTriangle },
  unsupported: { variant: 'danger', label: 'Unsupported', tone: 'critical', icon: XCircle },
  unknown: { variant: 'neutral', label: 'Unknown', tone: 'muted', icon: HelpCircle },
};

/**
 * Resolve the badge presentation for a support tier. Falls back to the muted
 * `unknown` descriptor for any unexpected value.
 */
export function describeSupportTier(tier: ArrSupportTier): SupportTierDescriptor {
  return SUPPORT_TIER_DESCRIPTORS[tier] ?? SUPPORT_TIER_DESCRIPTORS.unknown;
}
