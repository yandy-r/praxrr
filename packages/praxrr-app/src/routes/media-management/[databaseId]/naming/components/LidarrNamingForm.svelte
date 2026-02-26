<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import StickyCard from '$ui/card/StickyCard.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import Toggle from '$ui/toggle/Toggle.svelte';
  import { alertStore } from '$alerts/store';
  import { Save, Trash2, Info } from 'lucide-svelte';
  import { current, isDirty, initEdit, initCreate, update } from '$lib/client/stores/dirty';
  import type { LidarrNamingRow } from '$shared/pcd/display.ts';
  import { SONARR_COLON_REPLACEMENT_OPTIONS } from '$shared/pcd/mediaManagement.ts';

  interface LidarrNamingFormData {
    name: string;
    rename: boolean;
    standardTrackFormat: string;
    artistName: string;
    multiDiscTrackFormat: string;
    artistFolderFormat: string;
    replaceIllegalCharacters: boolean;
    colonReplacementFormat: LidarrNamingRow['colon_replacement_format'];
    customColonReplacementFormat: string;
    [key: string]: unknown;
  }

  export let mode: 'create' | 'edit';
  export let databaseName: string;
  export let canWriteToBase: boolean = false;
  export let actionUrl: string = '';
  export let initialData: LidarrNamingRow;

  function mapToFormData(data: LidarrNamingRow): LidarrNamingFormData {
    return {
      name: data.name,
      rename: data.rename,
      standardTrackFormat: data.standard_track_format,
      artistName: data.artist_name,
      multiDiscTrackFormat: data.multi_disc_track_format,
      artistFolderFormat: data.artist_folder_format,
      replaceIllegalCharacters: data.replace_illegal_characters,
      colonReplacementFormat: data.colon_replacement_format,
      customColonReplacementFormat: data.custom_colon_replacement_format || '',
    };
  }

  if (mode === 'create') {
    initCreate(mapToFormData(initialData));
  } else {
    initEdit(mapToFormData(initialData));
  }

  $: formData = $current as LidarrNamingFormData;

  let saving = false;
  let deleting = false;
  let showDeleteModal = false;
  let showInfoModal = false;
  let selectedLayer: 'user' | 'base' = canWriteToBase ? 'base' : 'user';
  let mainFormElement: HTMLFormElement;
  let deleteFormElement: HTMLFormElement;

  $: title = mode === 'create' ? 'New Lidarr Naming Config' : 'Edit Lidarr Naming Config';
  $: description =
    mode === 'create'
      ? `Create a new Lidarr naming configuration for ${databaseName}`
      : 'Update Lidarr naming configuration';
  $: isValid =
    formData.name.trim() !== '' &&
    formData.standardTrackFormat.trim() !== '' &&
    formData.multiDiscTrackFormat.trim() !== '' &&
    formData.artistFolderFormat.trim() !== '';
  $: showCustomColonInput = formData.colonReplacementFormat === 'custom';

  async function handleSaveClick() {
    if (saving) return;
    saving = true;
    selectedLayer = canWriteToBase ? 'base' : 'user';
    await tick();
    mainFormElement?.requestSubmit();
  }

  async function handleDeleteClick() {
    showDeleteModal = true;
  }

  async function handleDeleteConfirm() {
    selectedLayer = canWriteToBase ? 'base' : 'user';
    showDeleteModal = false;
    await tick();
    deleteFormElement?.requestSubmit();
  }

  function handleDeleteCancel() {
    showDeleteModal = false;
  }
</script>

<StickyCard position="top">
  <div slot="left">
    <h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h1>
    <p class="text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
  </div>
  <div slot="right" class="flex items-center gap-2">
    <Button
      text="Info"
      icon={Info}
      iconColor="text-blue-600 dark:text-blue-400"
      on:click={() => (showInfoModal = true)}
    />
    {#if mode === 'edit'}
      <Button
        text={deleting ? 'Deleting...' : 'Delete'}
        icon={Trash2}
        iconColor="text-red-600 dark:text-red-400"
        disabled={deleting || saving}
        on:click={handleDeleteClick}
      />
    {/if}
    <Button
      text={saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
      icon={Save}
      iconColor="text-blue-600 dark:text-blue-400"
      disabled={saving || !isValid || !$isDirty}
      on:click={handleSaveClick}
    />
  </div>
</StickyCard>

<div class="mt-6 md:px-4">
  <div class="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
    <div class="space-y-4">
      <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Basic Info</h2>
      <FormInput
        label="Name"
        name="name"
        required
        value={formData.name}
        placeholder="e.g., default"
        on:input={(e) => update('name', e.detail)}
      />

      <div class="space-y-2">
        <Toggle
          checked={formData.rename}
          label="Rename Tracks"
          ariaLabel="Rename Tracks"
          color={formData.rename ? 'green' : 'neutral'}
          on:change={(e) => update('rename', e.detail)}
        />
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Rename track files to match the naming format.</p>
      </div>
    </div>

    {#if formData.rename}
      <hr class="border-neutral-200 dark:border-neutral-700" />

      <div class="space-y-4">
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Naming Formats</h2>
        <FormInput
          label="Standard Track Format"
          name="standardTrackFormat"
          required
          value={formData.standardTrackFormat}
          placeholder={'e.g., {Artist Name} - {Album Type} - {Album Title} - {(Album Disambiguation)}/...'}
          on:input={(e) => update('standardTrackFormat', e.detail)}
        />
        <FormInput
          label="Multi-Disc Track Format"
          name="multiDiscTrackFormat"
          required
          value={formData.multiDiscTrackFormat}
          placeholder={'e.g., {Artist Name} - {Album Type} - {Album Title} - {(Album Disambiguation)}/...'}
          on:input={(e) => update('multiDiscTrackFormat', e.detail)}
        />
        <FormInput
          label="Artist Folder Format"
          name="artistFolderFormat"
          required
          value={formData.artistFolderFormat}
          placeholder={'e.g., {Artist Name} ({Artist MbId})'}
          on:input={(e) => update('artistFolderFormat', e.detail)}
        />
      </div>

      <hr class="border-neutral-200 dark:border-neutral-700" />

      <div class="space-y-4">
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Character Replacement</h2>
        <div class="space-y-2">
          <Toggle
            checked={formData.replaceIllegalCharacters}
            label="Replace Illegal Characters"
            ariaLabel="Replace Illegal Characters"
            color={formData.replaceIllegalCharacters ? 'green' : 'neutral'}
            on:change={(e) => update('replaceIllegalCharacters', e.detail)}
          />
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Replace characters not allowed in file and folder names.
          </p>
        </div>

        {#if formData.replaceIllegalCharacters}
          <div>
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-300"> Colon Replacement </span>
            <div class="mt-2 grid gap-2">
              {#each SONARR_COLON_REPLACEMENT_OPTIONS as option (option.value)}
                <Toggle
                  checked={formData.colonReplacementFormat === option.value}
                  label={option.label}
                  ariaLabel={`Set colon replacement to ${option.label}`}
                  on:change={(e) => {
                    if (e.detail) update('colonReplacementFormat', option.value);
                  }}
                />
              {/each}
            </div>
          </div>
        {/if}

        {#if showCustomColonInput}
          <FormInput
            label="Custom Colon Replacement"
            name="customColonReplacementFormat"
            value={formData.customColonReplacementFormat}
            placeholder="e.g.,  - "
            on:input={(e) => update('customColonReplacementFormat', e.detail)}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>

<form
  bind:this={mainFormElement}
  method="POST"
  action={actionUrl}
  class="hidden"
  use:enhance={() => {
    saving = true;
    return async ({ result, update: formUpdate }) => {
      if (result.type === 'failure' && result.data) {
        alertStore.add('error', (result.data as { error?: string }).error || 'Operation failed');
      } else if (result.type === 'redirect') {
        alertStore.add('success', mode === 'create' ? 'Naming config created!' : 'Naming config updated!');
        initEdit(formData);
      }
      await formUpdate();
      saving = false;
    };
  }}
>
  <input type="hidden" name="arrType" value="lidarr" />
  <input type="hidden" name="name" value={formData.name} />
  <input type="hidden" name="rename" value={formData.rename} />
  <input type="hidden" name="standardTrackFormat" value={formData.standardTrackFormat} />
  <input type="hidden" name="artistName" value={formData.artistName} />
  <input type="hidden" name="multiDiscTrackFormat" value={formData.multiDiscTrackFormat} />
  <input type="hidden" name="artistFolderFormat" value={formData.artistFolderFormat} />
  <input type="hidden" name="replaceIllegalCharacters" value={formData.replaceIllegalCharacters} />
  <input type="hidden" name="colonReplacementFormat" value={formData.colonReplacementFormat} />
  <input type="hidden" name="customColonReplacementFormat" value={formData.customColonReplacementFormat} />
  <input type="hidden" name="layer" value={selectedLayer} />
</form>

{#if mode === 'edit'}
  <form
    bind:this={deleteFormElement}
    method="POST"
    action="?/delete"
    class="hidden"
    use:enhance={() => {
      deleting = true;
      return async ({ result, update: formUpdate }) => {
        if (result.type === 'failure' && result.data) {
          alertStore.add('error', (result.data as { error?: string }).error || 'Failed to delete');
        } else if (result.type === 'redirect') {
          alertStore.add('success', 'Naming config deleted');
        }
        await formUpdate();
        deleting = false;
      };
    }}
  >
    <input type="hidden" name="layer" value={selectedLayer} />
  </form>
{/if}

<Modal
  open={showDeleteModal}
  header="Delete Lidarr naming config"
  bodyMessage="This will remove the naming config and write a delete op. You can recreate it later if needed."
  confirmText="Delete"
  cancelText="Cancel"
  confirmDanger={true}
  confirmDisabled={deleting}
  loading={deleting}
  on:confirm={handleDeleteConfirm}
  on:cancel={handleDeleteCancel}
/>

<InfoModal bind:open={showInfoModal} header="Lidarr Naming Configuration">
  <div class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    <p>Configure how Lidarr should name tracks and artist folders.</p>
    <p>
      Use formats that match your Lidarr naming policy. These values map to first-class
      <code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">lidarr_naming</code>
      records.
    </p>
  </div>
</InfoModal>
