<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { alertStore } from '$alerts/store';
  import { getComplexityTierContext } from '$ui/complexity/complexityTierContext';
  import { getUserInterfacePreferenceSectionStore } from '$stores/userInterfacePreferences';
  import { AuthRequiredError } from '$stores/sectionDebouncedSync.ts';
  import type { SectionKey, UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';
  import AdvancedSection from './AdvancedSection.svelte';
  import {
    resolveDisclosureInitialMode,
    resolveTierDrivenMode,
    shouldBlockTierUpdates
  } from './disclosureSectionLogic.ts';

  export let sectionKey: SectionKey;
  export let sectionTitle = 'Advanced settings';
  export let sectionHint = 'These options are hidden by default and are optional.';
  export let initialMode: UiPreferenceMode | undefined = undefined;
  export let showAdvancedLabel = 'Show Advanced';
  export let hideAdvancedLabel = 'Hide Advanced';

  const complexityContext = getComplexityTierContext();
  const { hasExplicitInitialMode, resolvedInitialMode } = resolveDisclosureInitialMode(
    initialMode,
    complexityContext ? get(complexityContext.tier) : undefined,
    complexityContext?.tierToDefaultMode ?? (() => 'basic' as UiPreferenceMode)
  );
  const sectionStore = getUserInterfacePreferenceSectionStore(sectionKey, resolvedInitialMode);

  let mode: UiPreferenceMode = resolvedInitialMode;
  let modeSynced: UiPreferenceMode = resolvedInitialMode;
  let preferencePersisted = false;

  const persistActivityFailure = (error: unknown): void => {
    if (error instanceof AuthRequiredError) {
      return;
    }

    if (error instanceof Error) {
      console.error('Failed to record complexity tier activity', {
        sectionKey,
        error: error.message
      });
      alertStore.add(
        'warning',
        `Unable to sync complexity tier activity for section "${sectionKey}". Changes may revert if offline.`
      );
    }
  };

  const recordManualToggleActivity = (nextMode: UiPreferenceMode): void => {
    if (!complexityContext) {
      return;
    }

    const activity =
      nextMode === 'advanced'
        ? { interaction: 1, advancedToggle: 1 }
        : { interaction: 1 };

    void complexityContext.recordActivity(activity).catch(persistActivityFailure);
  };

  const unsubscribeMode = sectionStore.mode.subscribe((value) => {
    if (shouldBlockTierUpdates(hasExplicitInitialMode, preferencePersisted)) {
      modeSynced = value;
      mode = value;
    }
  });

  const unsubscribePersisted = sectionStore.persisted.subscribe((value) => {
    preferencePersisted = value;
  });

  const unsubscribeTier = complexityContext?.tier.subscribe((tier) => {
    const defaultMode = resolveTierDrivenMode(
      tier,
      complexityContext.tierToDefaultMode,
      hasExplicitInitialMode,
      preferencePersisted
    );

    if (defaultMode === null) {
      return;
    }

    modeSynced = defaultMode;
    mode = defaultMode;
  });

  $: if (mode !== modeSynced) {
    sectionStore.mode.set(mode);
    recordManualToggleActivity(mode);
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
