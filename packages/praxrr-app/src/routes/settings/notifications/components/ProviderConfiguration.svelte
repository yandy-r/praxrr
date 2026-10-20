<script lang="ts">
  import { Check } from 'lucide-svelte';
  import IconCheckbox from '$ui/form/IconCheckbox.svelte';
  import type { ProviderDescriptor, ProviderField } from '$shared/notifications/providers';

  export let descriptor: ProviderDescriptor;
  export let config: Record<string, unknown> = {};
  export let secretsSet: string[] = [];
  export let mode: 'create' | 'edit' = 'create';

  const inputClass =
    'mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500';

  // Secret values are never sent to the browser, so secret inputs always start blank.
  function initialValue(field: ProviderField): string {
    if (field.secret) return '';
    const value = config[field.key] ?? field.defaultValue;
    return value === undefined || value === null || typeof value === 'boolean' ? '' : String(value);
  }

  let checkboxState: Record<string, boolean> = {};
  for (const field of descriptor.fields) {
    if (field.kind === 'checkbox') {
      const value = config[field.key] ?? field.defaultValue;
      checkboxState[field.key] = value === true;
    }
  }

  function isRequired(field: ProviderField): boolean {
    return field.required === true && (!field.secret || mode === 'create');
  }

  function keepsSavedSecret(field: ProviderField): boolean {
    return field.secret === true && mode === 'edit' && secretsSet.includes(field.key);
  }

  function toggle(key: string) {
    checkboxState[key] = !checkboxState[key];
  }

  // Optional saved secrets can be removed explicitly; a blank input alone keeps them.
  let clearState: Record<string, boolean> = {};

  function toggleClear(key: string) {
    clearState[key] = !clearState[key];
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
  <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{descriptor.label} Configuration</h2>
  <p class="mt-1 mb-4 text-sm text-neutral-600 dark:text-neutral-400">{descriptor.description}</p>

  <div class="space-y-4">
    {#each descriptor.fields as field (field.key)}
      {#if field.kind === 'checkbox'}
        <div class="flex items-start gap-3">
          <IconCheckbox icon={Check} checked={checkboxState[field.key]} on:click={() => toggle(field.key)} />
          <input type="hidden" name={field.key} value={checkboxState[field.key] ? 'on' : ''} />
          <button type="button" class="flex-1 text-left" on:click={() => toggle(field.key)}>
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">{field.label}</span>
            {#if field.help}
              <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{field.help}</p>
            {/if}
          </button>
        </div>
      {:else}
        <div>
          <label for="provider-{field.key}" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {field.label}
            {#if isRequired(field)}
              <span class="text-red-500">*</span>
            {/if}
          </label>
          {#if field.kind === 'textarea'}
            <textarea
              id="provider-{field.key}"
              name={field.key}
              rows="4"
              required={isRequired(field)}
              placeholder={keepsSavedSecret(field) ? 'Saved — leave blank to keep' : field.placeholder}
              autocomplete="off"
              class="{inputClass} font-mono">{initialValue(field)}</textarea
            >
          {:else}
            <input
              type={field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : field.kind}
              id="provider-{field.key}"
              name={field.key}
              value={initialValue(field)}
              required={isRequired(field)}
              placeholder={keepsSavedSecret(field) ? 'Saved — leave blank to keep' : field.placeholder}
              autocomplete={field.secret ? 'off' : undefined}
              class={inputClass}
            />
          {/if}
          {#if keepsSavedSecret(field)}
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Leave blank to keep the existing value</p>
            {#if !field.required}
              <div class="mt-2 flex items-center gap-2">
                <IconCheckbox
                  icon={Check}
                  checked={clearState[field.key] === true}
                  on:click={() => toggleClear(field.key)}
                />
                <input type="hidden" name="{field.key}__clear" value={clearState[field.key] ? 'on' : ''} />
                <button
                  type="button"
                  class="text-left text-xs text-neutral-600 dark:text-neutral-400"
                  on:click={() => toggleClear(field.key)}
                >
                  Remove saved value
                </button>
              </div>
            {/if}
          {:else if field.help}
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{field.help}</p>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
