<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getUserInterfacePreferenceSectionStore } from '$stores/userInterfacePreferences';
  import type { SectionKey, UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';
  import AdvancedSection from './AdvancedSection.svelte';

  export let sectionKey: SectionKey;
  export let sectionTitle = 'Advanced settings';
  export let sectionHint = 'These options are hidden by default and are optional.';
  export let initialMode: UiPreferenceMode = 'basic';
  export let showAdvancedLabel = 'Show Advanced';
  export let hideAdvancedLabel = 'Hide Advanced';

  const sectionStore = getUserInterfacePreferenceSectionStore(sectionKey, initialMode);

  let mode: UiPreferenceMode = initialMode;
  let modeSynced: UiPreferenceMode = initialMode;

  const unsubscribe = sectionStore.mode.subscribe((value) => {
    modeSynced = value;
    mode = value;
  });

  $: if (mode !== modeSynced) {
    sectionStore.mode.set(mode);
    modeSynced = mode;
  }

  onDestroy(() => {
    unsubscribe();
    sectionStore.cleanup();
  });
</script>

<AdvancedSection sectionId={sectionKey} {sectionTitle} {sectionHint} {showAdvancedLabel} {hideAdvancedLabel} bind:mode>
  <slot />
  <svelte:fragment slot="advanced">
    <slot name="advanced" />
  </svelte:fragment>
</AdvancedSection>
