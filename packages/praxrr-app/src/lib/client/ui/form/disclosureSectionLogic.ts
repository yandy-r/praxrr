import type { ComplexityTier } from '$shared/complexity/tiers.ts';
import type { UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';

export function resolveDisclosureInitialMode(
  initialMode: UiPreferenceMode | undefined,
  tier: ComplexityTier | undefined,
  tierToDefaultMode: (tier: ComplexityTier) => UiPreferenceMode
): {
  hasExplicitInitialMode: boolean;
  resolvedInitialMode: UiPreferenceMode;
} {
  const hasExplicitInitialMode = initialMode !== undefined;
  const initialTierMode = !hasExplicitInitialMode && tier !== undefined ? tierToDefaultMode(tier) : 'basic';

  return {
    hasExplicitInitialMode,
    resolvedInitialMode: initialMode ?? initialTierMode,
  };
}

export function shouldBlockTierUpdates(hasExplicitInitialMode: boolean, preferencePersisted: boolean): boolean {
  return hasExplicitInitialMode || preferencePersisted;
}

export function resolveTierDrivenMode(
  tier: ComplexityTier,
  tierToDefaultMode: (tier: ComplexityTier) => UiPreferenceMode,
  hasExplicitInitialMode: boolean,
  preferencePersisted: boolean
): UiPreferenceMode | null {
  if (shouldBlockTierUpdates(hasExplicitInitialMode, preferencePersisted)) {
    return null;
  }

  return tierToDefaultMode(tier);
}
