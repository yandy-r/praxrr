import { getContext, setContext } from 'svelte';
import type { Readable, Writable } from 'svelte/store';
import { tierToDefaultMode, type ComplexityTier } from '$shared/complexity/tiers.ts';
import type { UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';
import type { UserComplexityTierSectionStore } from '$stores/userComplexityTiers';

const COMPLEXITY_TIER_CONTEXT = Symbol('complexity-tier-context');

export interface ComplexityTierContext {
  tier: Writable<ComplexityTier>;
  advancedToggleCount: Readable<number>;
  lastSuggestedTier: Readable<ComplexityTier | null>;
  suggestionDismissedAt: Readable<string | null>;
  recordActivity: UserComplexityTierSectionStore['recordActivity'];
  dismissSuggestion: UserComplexityTierSectionStore['dismissSuggestion'];
  tierToDefaultMode: (tier: ComplexityTier) => UiPreferenceMode;
}

export function setComplexityTierContext(value: ComplexityTierContext): void {
  setContext(COMPLEXITY_TIER_CONTEXT, value);
}

export function getComplexityTierContext(): ComplexityTierContext | undefined {
  try {
    return getContext<ComplexityTierContext>(COMPLEXITY_TIER_CONTEXT);
  } catch {
    return undefined;
  }
}

export { tierToDefaultMode };
