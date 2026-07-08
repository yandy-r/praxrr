<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getUserComplexityTierSectionStore } from '$stores/userComplexityTiers';
  import { setComplexityTierContext, tierToDefaultMode } from './complexityTierContext';
  import type { ComplexityTier, SectionKey } from '$shared/complexity/tiers.ts';

  export let sectionKey: SectionKey;
  export let initialTier: ComplexityTier = 'beginner';

  const sectionStore = getUserComplexityTierSectionStore(sectionKey, initialTier);

  setComplexityTierContext({
    tier: sectionStore.tier,
    advancedToggleCount: sectionStore.advancedToggleCount,
    lastSuggestedTier: sectionStore.lastSuggestedTier,
    suggestionDismissedAt: sectionStore.suggestionDismissedAt,
    recordActivity: sectionStore.recordActivity,
    dismissSuggestion: sectionStore.dismissSuggestion,
    tierToDefaultMode,
  });

  onDestroy(() => {
    sectionStore.cleanup();
  });
</script>

<slot />
