<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { Save, Wifi, Trash2, Eraser, Loader2 } from 'lucide-svelte';
  import CleanupModal from './CleanupModal.svelte';
  import { alertStore } from '$alerts/store';
  import { isDirty, initEdit, update, current, clear } from '$lib/client/stores/dirty';
  import { isValidExternalUrl } from '$lib/client/validation/arrUrls.ts';
  import type { ArrInstance } from '$db/queries/arrInstances.ts';
  import FormInput from '$ui/form/FormInput.svelte';
  import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
  import TagInput from '$ui/form/TagInput.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import Button from '$ui/button/Button.svelte';
  import StickyCard from '$ui/card/StickyCard.svelte';
  import {
    ARR_APP_OPTIONS,
    isArrAppType,
    supportsArrSyncSurface,
    supportsArrWorkflow,
    type ArrAppType,
    type ArrSyncSurface,
    type ArrWorkflowSurface,
  } from '$shared/arr/capabilities.ts';

  // Props
  export let mode: 'create' | 'edit';
  export let instance: ArrInstance | undefined = undefined;
  export let initialType: string = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export let form: any = undefined;

  // Parse tags from JSON string
  const parseTags = (tagsJson: string | null): string[] => {
    if (!tagsJson) return [];
    try {
      return JSON.parse(tagsJson);
    } catch {
      return [];
    }
  };

  // Initialize dirty tracking on mount
  onMount(() => {
    if (mode === 'edit' && instance) {
      initEdit({
        name: instance.name,
        type: instance.type,
        url: instance.url,
        externalUrl: instance.external_url ?? '',
        apiKey: '', // Never pre-populate for security
        enabled: instance.enabled ? 'true' : 'false',
        tags: JSON.stringify(parseTags(instance.tags)),
      });
    } else {
      // Treat create mode as clean until the user actually edits fields.
      // This avoids false "stay/discard" prompts when navigating away untouched.
      initEdit({
        name: '',
        type: initialType,
        url: '',
        externalUrl: '',
        apiKey: '',
        enabled: 'true',
        tags: '[]',
      });
    }
    return () => clear();
  });

  // Read current values from dirty store
  $: name = ($current.name ?? '') as string;
  $: type = ($current.type ?? '') as string;
  $: url = ($current.url ?? '') as string;
  $: externalUrl = ($current.externalUrl ?? '') as string;
  $: apiKey = ($current.apiKey ?? '') as string;
  $: enabled = ($current.enabled ?? 'true') as string;
  $: tags = JSON.parse(($current.tags ?? '[]') as string) as string[];
  $: externalUrlValidationError = isValidExternalUrl(externalUrl) ? '' : 'External URL must be a valid http(s) URL.';

  // UI state
  let saving = false;
  let testing = false;
  let deleting = false;
  let showDeleteModal = false;
  let showCleanupModal = false;

  // Options for dropdowns
  const typeOptions = ARR_APP_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

  const enabledOptions = [
    { value: 'true', label: 'Enabled' },
    { value: 'false', label: 'Disabled' },
  ];

  const downstreamWorkflowSurfaces: ArrWorkflowSurface[] = ['library', 'releases', 'rename', 'upgrades'];
  const downstreamSyncSurfaces: ArrSyncSurface[] = [
    'quality_profiles',
    'custom_formats',
    'delay_profiles',
    'media_management',
  ];
  const workflowLabels: Record<ArrWorkflowSurface, string> = {
    instances: 'Settings',
    library: 'Library',
    releases: 'Releases',
    rename: 'Rename',
    upgrades: 'Upgrades',
  };
  const syncLabels: Record<ArrSyncSurface, string> = {
    quality_profiles: 'Quality Profiles',
    custom_formats: 'Custom Formats',
    delay_profiles: 'Delay Profiles',
    metadata_profiles: 'Metadata Profiles',
    media_management: 'Media Management',
  };
  const appPorts: Record<ArrAppType, number> = {
    radarr: 7878,
    sonarr: 8989,
    lidarr: 8686,
  };
  const defaultAppType = ARR_APP_OPTIONS[0]!.value;
  const defaultUrlHint = `Use container name if on the same Docker network, e.g. http://${defaultAppType}:${appPorts[defaultAppType]}`;
  const externalUrlHints: Record<ArrAppType, string> = {
    radarr: 'https://radarr.example.com',
    sonarr: 'https://sonarr.example.com',
    lidarr: 'https://lidarr.example.com',
  };

  function joinLabels(labels: string[]): string {
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }

  // Manual test connection
  async function testConnection() {
    if (!type || !url || !apiKey) {
      alertStore.add('error', 'Please fill in Type, URL, and API Key');
      return;
    }

    testing = true;
    try {
      const response = await fetch('/arr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, url, apiKey }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Connection test failed');
      }

      alertStore.add('success', 'Connection successful!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      alertStore.add('error', errorMessage);
    } finally {
      testing = false;
    }
  }

  // Test connection and submit if successful
  async function handleSave() {
    if (!type || !url || !apiKey) {
      alertStore.add('error', 'Please fill in Type, URL, and API Key');
      return;
    }

    saving = true;

    try {
      const response = await fetch('/arr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, url, apiKey }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Connection test failed');
      }

      // Connection successful, submit the form
      const saveForm = document.getElementById('save-form');
      if (saveForm instanceof HTMLFormElement) {
        saveForm.requestSubmit();
      }
    } catch (error) {
      saving = false;
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      alertStore.add('error', errorMessage);
    }
  }

  $: canSubmit = $isDirty && !!name && !!url && !!apiKey && (mode === 'edit' || !!type) && !externalUrlValidationError;

  // Handle form response
  let lastFormId: unknown = null;
  $: if (form && form !== lastFormId) {
    lastFormId = form;
    if (form.success) {
      alertStore.add('success', 'Settings saved successfully');
      // Reset dirty state with new values (keep apiKey empty)
      initEdit({
        name,
        type,
        url,
        externalUrl: externalUrl.trim(),
        apiKey: '',
        enabled,
        tags: JSON.stringify(tags),
      });
    }
    if (form.error) {
      alertStore.add('error', form.error);
    }
  }

  // Display text based on mode
  $: selectedAppType = isArrAppType(type) ? type : null;
  $: unsupportedWorkflowLabels = selectedAppType
    ? downstreamWorkflowSurfaces
        .filter((workflow) => !supportsArrWorkflow(selectedAppType, workflow))
        .map((workflow) => workflowLabels[workflow])
    : [];
  $: unsupportedSyncLabels = selectedAppType
    ? downstreamSyncSurfaces
        .filter((surface) => !supportsArrSyncSurface(selectedAppType, surface))
        .map((surface) => syncLabels[surface])
    : [];
  $: supportedWorkflowLabels = selectedAppType
    ? downstreamWorkflowSurfaces
        .filter((workflow) => supportsArrWorkflow(selectedAppType, workflow))
        .map((workflow) => workflowLabels[workflow])
    : [];
  $: supportedSyncLabels = selectedAppType
    ? downstreamSyncSurfaces
        .filter((surface) => supportsArrSyncSurface(selectedAppType, surface))
        .map((surface) => syncLabels[surface])
    : [];
  $: selectedAppLabel = selectedAppType
    ? (typeOptions.find((option) => option.value === selectedAppType)?.label ?? 'This app')
    : '';
  $: unsupportedWorkflowSummary = joinLabels(unsupportedWorkflowLabels);
  $: unsupportedSyncSummary = joinLabels(unsupportedSyncLabels);
  $: supportedWorkflowSummary = joinLabels(supportedWorkflowLabels);
  $: supportedSyncSummary = joinLabels(supportedSyncLabels);
  $: unsupportedWorkflowMessage =
    selectedAppType && unsupportedWorkflowLabels.length > 0
      ? `${selectedAppLabel} does not support ${unsupportedWorkflowSummary} in Profilarr yet.${supportedWorkflowLabels.length > 0 ? ` You can still use ${supportedWorkflowSummary}.` : ''}`
      : '';
  $: unsupportedSyncMessage =
    selectedAppType && unsupportedSyncLabels.length > 0
      ? `${selectedAppLabel} does not support ${unsupportedSyncSummary} sync in Profilarr yet.${supportedSyncLabels.length > 0 ? ` You can still configure ${supportedSyncSummary}.` : ''}`
      : '';
  $: urlPlaceholder = selectedAppType ? `http://localhost:${appPorts[selectedAppType]}` : 'http://localhost:7878';
  $: externalUrlPlaceholder = selectedAppType ? externalUrlHints[selectedAppType] : 'https://{arr}.example.com';
  $: urlDescription = selectedAppType
    ? `Use container name if on the same Docker network, e.g. http://${selectedAppType}:${appPorts[selectedAppType]}`
    : defaultUrlHint;
  $: title = mode === 'create' ? 'Add Instance' : 'Settings';
  $: description =
    mode === 'create'
      ? 'Configure a new Arr app instance. Workflow and sync availability depend on app capabilities.'
      : `Configure connection and sync settings for ${instance?.name || 'this instance'}.`;
</script>

<div class="space-y-6" class:mt-6={mode === 'edit'}>
  <!-- Header -->
  <StickyCard position="top">
    <svelte:fragment slot="left">
      <h1 class="text-neutral-900 dark:text-neutral-50">{title}</h1>
      <p class="text-neutral-600 dark:text-neutral-400">{description}</p>
    </svelte:fragment>
    <svelte:fragment slot="right">
      {#if mode === 'edit'}
        <Button
          text="Delete"
          icon={Trash2}
          iconColor="text-red-600 dark:text-red-400"
          disabled={saving || deleting}
          on:click={() => (showDeleteModal = true)}
        />
        <Button
          text="Cleanup"
          icon={Eraser}
          iconColor="text-amber-600 dark:text-amber-400"
          disabled={saving || deleting}
          on:click={() => (showCleanupModal = true)}
        />
      {/if}
      <Button
        text={saving ? 'Saving...' : 'Save'}
        icon={Save}
        iconColor="text-blue-600 dark:text-blue-400"
        disabled={saving || !canSubmit}
        on:click={handleSave}
      />
    </svelte:fragment>
  </StickyCard>

  <div class="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
    <!-- Type Row -->
    <div class="space-y-2">
      <span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Type{#if mode === 'create'}<span class="text-red-500">*</span>{/if}
      </span>
      {#if mode === 'edit'}
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Type cannot be changed after creation</p>
      {/if}
      <DropdownSelect
        value={type}
        options={typeOptions}
        placeholder="Select type..."
        disabled={mode === 'edit'}
        on:change={(e) => update('type', e.detail)}
      />
      {#if unsupportedWorkflowMessage}
        <p class="text-xs text-amber-600 dark:text-amber-400" role="status">
          {unsupportedWorkflowMessage}
        </p>
      {/if}
      {#if unsupportedSyncMessage}
        <p class="text-xs text-amber-600 dark:text-amber-400" role="status">
          {unsupportedSyncMessage}
        </p>
      {/if}
    </div>
    <!-- Name + Status Row -->
    <div class="flex flex-col gap-4 md:flex-row md:items-end">
      <div class="flex-1">
        <FormInput
          label="Name"
          name="name"
          value={name}
          placeholder="e.g., Movies, TV, Music"
          required
          on:input={(e) => update('name', e.detail)}
        />
      </div>
      <div class="space-y-1">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Status</span>
        <DropdownSelect value={enabled} options={enabledOptions} on:change={(e) => update('enabled', e.detail)} />
      </div>
    </div>
    {#if enabled === 'false'}
      <p class="text-xs text-amber-600 dark:text-amber-400">Disabled instances are excluded from sync operations</p>
    {/if}
    <!-- URL Row -->
    <FormInput
      label="URL"
      name="url"
      type="url"
      value={url}
      placeholder={urlPlaceholder}
      description={urlDescription}
      required
      on:input={(e) => update('url', e.detail)}
    />
    <div class="space-y-2">
      <FormInput
        label="External URL (optional)"
        name="external_url"
        type="url"
        value={externalUrl}
        placeholder={externalUrlPlaceholder}
        description="Used for Open in links. API calls still use URL."
        on:input={(e) => update('externalUrl', e.detail)}
      />
      {#if externalUrlValidationError}
        <p class="text-xs text-red-600 dark:text-red-400" role="status">{externalUrlValidationError}</p>
      {/if}
    </div>
    <!-- API Key + Test Connection Row -->
    <div class="flex flex-col gap-4 md:flex-row md:items-end">
      <div class="flex-1">
        <FormInput
          label="API Key"
          name="api_key"
          value={apiKey}
          placeholder="Enter API key"
          description={mode === 'edit' ? 'Re-enter API key to save changes' : ''}
          required
          private_
          on:input={(e) => update('apiKey', e.detail)}
        />
      </div>
      <Button
        text={testing ? 'Testing...' : 'Test Connection'}
        icon={testing ? Loader2 : Wifi}
        disabled={testing || !apiKey || !url || (mode === 'create' && !type)}
        on:click={testConnection}
      />
    </div>
    <!-- Tags Row -->
    <div class="space-y-2">
      <span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100"> Tags </span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">Press Enter to add a tag, Backspace to remove</p>
      <TagInput {tags} on:change={(e) => update('tags', JSON.stringify(e.detail))} />
    </div>
  </div>
</div>

<!-- Hidden save form -->
<form
  id="save-form"
  method="POST"
  action={mode === 'edit' ? '?/update' : undefined}
  class="hidden"
  use:enhance={() => {
    saving = true;
    return async ({ result, update: formUpdate }) => {
      if (result.type === 'redirect') {
        // For create mode, clear dirty state before redirect
        clear();
        alertStore.add('success', 'Instance created successfully');
      }
      await formUpdate({ reset: false });
      saving = false;
    };
  }}
>
  <input type="hidden" name="name" value={name} />
  <input type="hidden" name="type" value={type} />
  <input type="hidden" name="url" value={url} />
  <input type="hidden" name="external_url" value={externalUrl.trim()} />
  <input type="hidden" name="api_key" value={apiKey} />
  <input type="hidden" name="enabled" value={enabled === 'true' ? '1' : '0'} />
  <input type="hidden" name="tags" value={JSON.stringify(tags)} />
</form>

<!-- Hidden delete form (edit mode only) -->
{#if mode === 'edit'}
  <form
    id="delete-form"
    method="POST"
    action="?/delete"
    class="hidden"
    use:enhance={() => {
      deleting = true;
      return async ({ result, update }) => {
        if (result.type === 'failure' && result.data) {
          alertStore.add('error', (result.data as { error?: string }).error || 'Failed to delete');
        } else if (result.type === 'redirect') {
          alertStore.add('success', 'Instance deleted successfully');
        }
        await update();
        deleting = false;
      };
    }}
  ></form>
{/if}

<!-- Delete Confirmation Modal -->
{#if mode === 'edit'}
  <Modal
    open={showDeleteModal}
    header="Delete Instance"
    bodyMessage={`Are you sure you want to delete "${instance?.name}"? This action cannot be undone.`}
    confirmText="Delete"
    cancelText="Cancel"
    confirmDanger={true}
    on:confirm={() => {
      showDeleteModal = false;
      const deleteForm = document.getElementById('delete-form');
      if (deleteForm instanceof HTMLFormElement) {
        deleteForm.requestSubmit();
      }
    }}
    on:cancel={() => (showDeleteModal = false)}
  />
{/if}

<DirtyModal />

<!-- Cleanup Modal (edit mode only) -->
{#if mode === 'edit' && instance}
  <CleanupModal bind:open={showCleanupModal} instanceId={instance.id} />
{/if}
