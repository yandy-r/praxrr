import {
  SECTION_KEY_MAX_LENGTH,
  SECTION_KEY_PATTERN,
  type SectionKey,
  type UiPreferenceMode,
} from '$shared/disclosure/sectionKeys.ts';

export { SECTION_KEY_MAX_LENGTH, SECTION_KEY_PATTERN, type SectionKey };

export const COMPLEXITY_TIERS = ['beginner', 'intermediate', 'advanced'] as const;

export type ComplexityTier = (typeof COMPLEXITY_TIERS)[number];
export type SectionTierMap = Partial<Record<SectionKey, ComplexityTier>>;

export function tierToDefaultMode(tier: ComplexityTier): UiPreferenceMode {
  return tier === 'advanced' ? 'advanced' : 'basic';
}
