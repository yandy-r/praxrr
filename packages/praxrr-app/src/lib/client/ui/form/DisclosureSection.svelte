<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { getComplexityTierContext } from '$ui/complexity/complexityTierContext';
  import { getUserInterfacePreferenceSectionStore } from '$stores/userInterfacePreferences';
  import type { SectionKey, UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';
  import AdvancedSection from './AdvancedSection.svelte';

  export let sectionKey: SectionKey;
  export let sectionTitle = 'Advanced settings';
  export let sectionHint = 'These options are hidden by default and are optional.';
  export let initialMode: UiPreferenceMode | undefined = undefined;
  export let showAdvancedLabel = 'Show Advanced';
  export let hideAdvancedLabel = 'Hide Advanced';

  const complexityContext = getComplexityTierContext();
  const hasExplicitInitialMode = initialMode !== undefined;
  const initialTierMode =
    !hasExplicitInitialMode && complexityContext
      ? complexityContext.tierToDefaultMode(get(complexityContext.tier))
      : 'basic';
  const resolvedInitialMode = initialMode ?? initialTierMode;
  const sectionStore = getUserInterfacePreferenceSectionStore(sectionKey, resolvedInitialMode);

  let mode: UiPreferenceMode = resolvedInitialMode;
  let modeSynced: UiPreferenceMode = resolvedInitialMode;
  let preferencePersisted = false;

  const unsubscribeMode = sectionStore.mode.subscribe((value) => {
    if (hasExplicitInitialMode || preferencePersisted) {
      modeSynced = value;
      mode = value;
    }
  });

  const unsubscribePersisted = sectionStore.persisted.subscribe((value) => {
    preferencePersisted = value;
  });

  const unsubscribeTier = complexityContext?.tier.subscribe((tier) => {
    if (hasExplicitInitialMode || preferencePersisted) {
      return;
    }

    const defaultMode = complexityContext.tierToDefaultMode(tier);
    modeSynced = defaultMode;
    mode = defaultMode;
  });

  $: if (mode !== modeSynced) {
    sectionStore.mode.set(mode);
    if (mode === 'advanced') {
      void complexityContext?.recordActivity({ interaction: 1, advancedToggle: 1 });
    } else {
      void complexityContext?.recordActivity({ interaction: 1 });
    }
    modeSynced = mode;
  }

  onDestroy(() => {
    unsubscribeMode();
    unsubscribePersisted();
    unsubscribeTier?.();
    sectionStore.cleanup();
  });
</script>

<AdvancedSection sectionId={sectionKey} {sectionTitle} {sectionHint} {showAdvancedLabel} {hideAdvancedLabel} bind:mode>
  <slot />
  <svelte:fragment slot="advanced">
    <slot name="advanced" />
  </svelte:fragment>
</AdvancedSection>
