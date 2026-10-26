<script lang="ts">
  import { enhance } from '$app/forms';
  import { alertStore } from '$alerts/store';
  import ProviderConfiguration from './ProviderConfiguration.svelte';
  import { getProviderIcon } from './providerIcons';
  import { getProviderDescriptor, notificationProviders } from '$shared/notifications/providers';
  import { groupNotificationTypesByCategory } from '$shared/notifications/types';
  import { Plus, Save, Check } from 'lucide-svelte';
  import IconCheckbox from '$ui/form/IconCheckbox.svelte';
  import DisclosureSection from '$ui/form/DisclosureSection.svelte';
  import { SETTINGS_NOTIFICATION_EVENTS } from '$shared/disclosure/sectionKeys';

  export let mode: 'create' | 'edit' = 'create';
  export let initialData: {
    name?: string;
    serviceType?: string;
    config?: Record<string, unknown>;
    secretsSet?: string[];
    enabledTypes?: string[];
  } = {};

  let selectedType: string = initialData.serviceType || notificationProviders[0].type;
  let serviceName = initialData.name || '';

  $: selectedDescriptor = getProviderDescriptor(selectedType);
  $: selectedIcon = getProviderIcon(selectedType);

  // Group notification types by category
  const groupedTypes = groupNotificationTypesByCategory();

  // Track enabled types state
  let enabledTypesState: Record<string, boolean> = {};

  // Initialize enabled types from initialData
  $: {
    for (const [, types] of Object.entries(groupedTypes)) {
      for (const type of types) {
        if (enabledTypesState[type.id] === undefined) {
          enabledTypesState[type.id] = initialData.enabledTypes?.includes(type.id) || false;
        }
      }
    }
  }
</script>

<form
  method="POST"
  action="?/{mode}"
  use:enhance={() => {
    return async ({ result, update }) => {
      if (result.type === 'failure' && result.data) {
        alertStore.add('error', (result.data as { error?: string }).error || `Failed to ${mode} service`);
      } else if (result.type === 'redirect') {
        alertStore.add('success', `Notification service ${mode === 'create' ? 'created' : 'updated'} successfully`);
      }
      await update();
    };
  }}
  class="space-y-6"
>
  <!-- Basic Settings -->
  <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 class="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Basic Settings</h2>

    <div class="space-y-4">
      <!-- Service Type -->
      <div>
        <label for="type" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Service Type
          <span class="text-red-500">*</span>
        </label>
        <div class="relative mt-1">
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            {#if selectedIcon.kind === 'svg'}
              <svg
                role="img"
                viewBox="0 0 24 24"
                class="h-4 w-4 text-neutral-600 dark:text-neutral-400"
                fill="currentColor"
              >
                <path d={selectedIcon.path} />
              </svg>
            {:else}
              <svelte:component
                this={selectedIcon.component}
                size={16}
                class="text-neutral-600 dark:text-neutral-400"
              />
            {/if}
          </div>
          <select
            id="type"
            name="type"
            bind:value={selectedType}
            required
            disabled={mode === 'edit'}
            class="block w-full rounded-lg border border-neutral-300 bg-white py-2 pr-3 pl-10 text-sm text-neutral-900 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
          >
            {#each notificationProviders as provider (provider.type)}
              <option value={provider.type}>{provider.label}</option>
            {/each}
          </select>
        </div>
        {#if mode === 'edit'}
          <!-- Disabled selects are not submitted; keep the type in the payload. -->
          <input type="hidden" name="type" value={selectedType} />
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Service type cannot be changed after creation
          </p>
        {/if}
      </div>

      <!-- Service Name -->
      <div>
        <label for="name" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Service Name
          <span class="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="name"
          name="name"
          bind:value={serviceName}
          required
          placeholder="e.g., Ops alerts"
          class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
        />
        <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          A friendly name to identify this notification service
        </p>
      </div>
    </div>
  </div>

  <!-- Service Configuration -->
  {#key selectedType}
    {#if selectedDescriptor}
      <ProviderConfiguration
        descriptor={selectedDescriptor}
        config={selectedType === initialData.serviceType ? (initialData.config ?? {}) : {}}
        secretsSet={selectedType === initialData.serviceType ? (initialData.secretsSet ?? []) : []}
        {mode}
      />
    {/if}
  {/key}

  <!-- Notification Types -->
  <div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 class="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Notification Types</h2>

    <!-- Hidden inputs always in DOM for form submission -->
    {#each Object.entries(groupedTypes) as [, types]}
      {#each types as type}
        <input type="hidden" name={type.id} value={enabledTypesState[type.id] ? 'on' : ''} />
      {/each}
    {/each}

    <DisclosureSection
      sectionKey={SETTINGS_NOTIFICATION_EVENTS}
      sectionTitle="Event Types"
      sectionHint="Configure which notification events trigger this service."
    >
      <p class="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Select which types of notifications should be sent to this service
      </p>

      <div class="space-y-4">
        {#each Object.entries(groupedTypes) as [category, types]}
          <div>
            <h3 class="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {category}
            </h3>
            <div class="space-y-2">
              {#each types as type}
                <div class="flex items-center gap-3">
                  <IconCheckbox
                    label={type.label}
                    icon={Check}
                    checked={enabledTypesState[type.id]}
                    on:click={() => (enabledTypesState[type.id] = !enabledTypesState[type.id])}
                  />
                  <button
                    type="button"
                    class="text-sm text-neutral-700 dark:text-neutral-300"
                    on:click={() => (enabledTypesState[type.id] = !enabledTypesState[type.id])}
                  >
                    {type.label}
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </DisclosureSection>
  </div>

  <!-- Actions -->
  <div class="flex justify-end gap-3">
    <a
      href="/settings/notifications"
      class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      Cancel
    </a>
    <button
      type="submit"
      class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
    >
      {#if mode === 'create'}
        <Plus size={16} />
        Create Service
      {:else}
        <Save size={16} />
        Update Service
      {/if}
    </button>
  </div>
</form>
