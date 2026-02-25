<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import StickyCard from '$ui/card/StickyCard.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import Toggle from '$ui/toggle/Toggle.svelte';
  import { alertStore } from '$alerts/store';
  import { Save, Trash2, Info } from 'lucide-svelte';
  import { current, isDirty, initEdit, initCreate, update } from '$lib/client/stores/dirty';
  import type { SonarrNamingRow } from '$shared/pcd/display.ts';
  import { getArrAppMetadata } from '$shared/arr/capabilities.ts';
  import type { ArrAppType } from '$shared/pcd/types.ts';
  import {
    SONARR_COLON_REPLACEMENT_OPTIONS,
    MULTI_EPISODE_STYLE_OPTIONS,
    type SonarrColonReplacementFormat,
    type MultiEpisodeStyle,
  } from '$shared/pcd/mediaManagement.ts';
  import { resolveSonarrFormat, getSonarrTokenCategories } from '$shared/pcd/namingTokens.ts';
  import NamingPreview from './NamingPreview.svelte';

  import TokenAutocomplete from './TokenAutocomplete.svelte';

  interface SonarrNamingFormData {
    name: string;
    rename: boolean;
    standardEpisodeFormat: string;
    dailyEpisodeFormat: string;
    animeEpisodeFormat: string;
    seriesFolderFormat: string;
    seasonFolderFormat: string;
    replaceIllegalCharacters: boolean;
    colonReplacementFormat: SonarrColonReplacementFormat;
    customColonReplacementFormat: string;
    multiEpisodeStyle: MultiEpisodeStyle;
    [key: string]: unknown;
  }

  export let mode: 'create' | 'edit';
  export let databaseName: string;
  export let canWriteToBase: boolean = false;
  export let actionUrl: string = '';
  export let initialData: SonarrNamingRow;

  const inferArrTypeFromRoute = (): ArrAppType => {
    const pathname = get(page).url.pathname;
    if (pathname.includes('/naming/lidarr/')) {
      return 'lidarr';
    }
    if (pathname.includes('/naming/sonarr/')) {
      return 'sonarr';
    }
    if (pathname.includes('/naming/radarr/')) {
      return 'radarr';
    }
    return 'sonarr';
  };

  export let arrType: ArrAppType = inferArrTypeFromRoute();

  function mapToFormData(data: SonarrNamingRow): SonarrNamingFormData {
    return {
      name: data.name,
      rename: data.rename,
      standardEpisodeFormat: data.standard_episode_format,
      dailyEpisodeFormat: data.daily_episode_format,
      animeEpisodeFormat: data.anime_episode_format,
      seriesFolderFormat: data.series_folder_format,
      seasonFolderFormat: data.season_folder_format,
      replaceIllegalCharacters: data.replace_illegal_characters,
      colonReplacementFormat: data.colon_replacement_format,
      customColonReplacementFormat: data.custom_colon_replacement_format || '',
      multiEpisodeStyle: data.multi_episode_style,
    };
  }

  if (mode === 'create') {
    initCreate(mapToFormData(initialData));
  } else {
    initEdit(mapToFormData(initialData));
  }

  $: formData = $current as SonarrNamingFormData;

  let saving = false;
  let deleting = false;
  let showDeleteModal = false;
  let showInfoModal = false;
  let selectedLayer: 'user' | 'base' = canWriteToBase ? 'base' : 'user';
  let mainFormElement: HTMLFormElement;
  let deleteFormElement: HTMLFormElement;
  let appLabel = 'Sonarr';
  let standardEpisodeFormatInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let dailyEpisodeFormatInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let animeEpisodeFormatInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let seriesFolderFormatInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let seasonFolderFormatInput: HTMLInputElement | HTMLTextAreaElement | null = null;

  const getErrorMessage = (data: unknown, fallback: string): string => {
    if (!data || typeof data !== 'object') {
      return fallback;
    }

    const payload = data as Record<string, unknown>;
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }

    const validationErrors = payload.errors;
    if (Array.isArray(validationErrors)) {
      const messages = validationErrors
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim());
      if (messages.length > 0) {
        return messages.join(', ');
      }
    }

    if (validationErrors && typeof validationErrors === 'object') {
      const messages = Object.values(validationErrors)
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim());
      if (messages.length > 0) {
        return messages.join(', ');
      }
    }

    return fallback;
  };

  const sonarrTokenCategories = getSonarrTokenCategories();

  $: appLabel = getArrAppMetadata(arrType).label;
  $: title = mode === 'create' ? `New ${appLabel} Naming Config` : `Edit ${appLabel} Naming Config`;
  $: description =
    mode === 'create'
      ? `Create a new ${appLabel.toLowerCase()} naming configuration for ${databaseName}`
      : `Update ${appLabel.toLowerCase()} naming configuration`;
  $: isValid = formData.name.trim() !== '';
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
    <!-- Basic Info -->
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
          label="Rename Episodes"
          ariaLabel="Rename Episodes"
          color={formData.rename ? 'green' : 'neutral'}
          on:change={(e) => update('rename', e.detail)}
        />
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Rename episode files to match the naming format</p>
      </div>
    </div>

    {#if formData.rename}
      <hr class="border-neutral-200 dark:border-neutral-700" />

      <!-- Episode Formats -->
      <div class="space-y-4">
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Episode Formats</h2>
        <div>
          <TokenAutocomplete
            label="Standard Episode Format"
            name="standardEpisodeFormat"
            value={formData.standardEpisodeFormat}
            categories={sonarrTokenCategories}
            bind:inputElement={standardEpisodeFormatInput}
            on:input={(e) => update('standardEpisodeFormat', e.detail)}
          />
          <NamingPreview format={formData.standardEpisodeFormat} resolver={resolveSonarrFormat} />
        </div>

        <div>
          <TokenAutocomplete
            label="Daily Episode Format"
            name="dailyEpisodeFormat"
            value={formData.dailyEpisodeFormat}
            categories={sonarrTokenCategories}
            bind:inputElement={dailyEpisodeFormatInput}
            on:input={(e) => update('dailyEpisodeFormat', e.detail)}
          />
          <NamingPreview format={formData.dailyEpisodeFormat} resolver={resolveSonarrFormat} />
        </div>

        <div>
          <TokenAutocomplete
            label="Anime Episode Format"
            name="animeEpisodeFormat"
            value={formData.animeEpisodeFormat}
            categories={sonarrTokenCategories}
            bind:inputElement={animeEpisodeFormatInput}
            on:input={(e) => update('animeEpisodeFormat', e.detail)}
          />
          <NamingPreview format={formData.animeEpisodeFormat} resolver={resolveSonarrFormat} />
        </div>
      </div>

      <hr class="border-neutral-200 dark:border-neutral-700" />

      <!-- Folder Formats -->
      <div class="space-y-4">
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Folder Formats</h2>
        <div>
          <TokenAutocomplete
            label="Series Folder Format"
            name="seriesFolderFormat"
            value={formData.seriesFolderFormat}
            categories={sonarrTokenCategories}
            bind:inputElement={seriesFolderFormatInput}
            on:input={(e) => update('seriesFolderFormat', e.detail)}
          />
          <NamingPreview format={formData.seriesFolderFormat} resolver={resolveSonarrFormat} />
        </div>

        <div>
          <TokenAutocomplete
            label="Season Folder Format"
            name="seasonFolderFormat"
            value={formData.seasonFolderFormat}
            categories={sonarrTokenCategories}
            bind:inputElement={seasonFolderFormatInput}
            on:input={(e) => update('seasonFolderFormat', e.detail)}
          />
          <NamingPreview format={formData.seasonFolderFormat} resolver={resolveSonarrFormat} />
        </div>
      </div>

      <hr class="border-neutral-200 dark:border-neutral-700" />

      <!-- Multi-Episode Style -->
      <div class="space-y-4">
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Multi-Episode Style</h2>
        <div class="grid gap-2">
          {#each MULTI_EPISODE_STYLE_OPTIONS as option (option.value)}
            <Toggle
              checked={formData.multiEpisodeStyle === option.value}
              label={option.label}
              ariaLabel={`Set multi-episode style to ${option.label}`}
              on:change={(e) => {
                if (e.detail) update('multiEpisodeStyle', option.value);
              }}
            />
          {/each}
        </div>
      </div>

      <hr class="border-neutral-200 dark:border-neutral-700" />

      <!-- Character Replacement -->
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
            Replace characters that are not allowed in file names
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

          {#if showCustomColonInput}
            <FormInput
              label="Custom Replacement"
              name="customColonReplacementFormat"
              value={formData.customColonReplacementFormat}
              placeholder="Enter custom replacement character(s)"
              on:input={(e) => update('customColonReplacementFormat', e.detail)}
            />
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Hidden save form -->
<form
  bind:this={mainFormElement}
  method="POST"
  action={actionUrl}
  class="hidden"
  use:enhance={() => {
    saving = true;
    return async ({ result, update: formUpdate }) => {
      if (result.type === 'failure' && result.data) {
        alertStore.add('error', getErrorMessage(result.data, 'Operation failed'));
      } else if (result.type === 'redirect') {
        alertStore.add('success', mode === 'create' ? 'Naming config created!' : 'Naming config updated!');
        initEdit(formData);
      }
      await formUpdate();
      saving = false;
    };
  }}
>
  <input type="hidden" name="arrType" value={arrType} />
  <input type="hidden" name="name" value={formData.name} />
  <input type="hidden" name="rename" value={formData.rename} />
  <input type="hidden" name="standardEpisodeFormat" value={formData.standardEpisodeFormat} />
  <input type="hidden" name="dailyEpisodeFormat" value={formData.dailyEpisodeFormat} />
  <input type="hidden" name="animeEpisodeFormat" value={formData.animeEpisodeFormat} />
  <input type="hidden" name="seriesFolderFormat" value={formData.seriesFolderFormat} />
  <input type="hidden" name="seasonFolderFormat" value={formData.seasonFolderFormat} />
  <input type="hidden" name="replaceIllegalCharacters" value={formData.replaceIllegalCharacters} />
  <input type="hidden" name="colonReplacementFormat" value={formData.colonReplacementFormat} />
  <input type="hidden" name="customColonReplacementFormat" value={formData.customColonReplacementFormat} />
  <input type="hidden" name="multiEpisodeStyle" value={formData.multiEpisodeStyle} />
  <input type="hidden" name="layer" value={selectedLayer} />
</form>

<!-- Hidden delete form -->
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
          alertStore.add('error', getErrorMessage(result.data, 'Failed to delete'));
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
  header={`Delete ${appLabel} naming config`}
  bodyMessage="This will remove the naming config and write a delete op. You can recreate it later if needed."
  confirmText="Delete"
  cancelText="Cancel"
  confirmDanger={true}
  confirmDisabled={deleting}
  loading={deleting}
  on:confirm={handleDeleteConfirm}
  on:cancel={handleDeleteCancel}
/>

<InfoModal bind:open={showInfoModal} header={`${appLabel} Naming Configuration`}>
  <div class="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Format Strings</div>
      <p class="mt-1">
        Format strings control how {appLabel.toLowerCase()} names episode files and folders. Use tokens like
        <code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{'{Series Title}'}</code>
        and
        <code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{'{Episode Title}'}</code
        >
        to build your naming pattern. {appLabel} has separate formats for standard, daily, and anime episodes.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Token Autocomplete</div>
      <p class="mt-1">
        Type <code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{'{'}</code> in any format
        field to open the token picker. Filter by typing, then use arrow keys and Enter or click to insert.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Live Preview</div>
      <p class="mt-1">
        A preview line below each format field shows how your pattern resolves with sample data, so you can see the
        result as you type.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Multi-Episode Style</div>
      <p class="mt-1">
        Controls how multi-episode files are named. "Extend" appends additional episode numbers (S01E01-E02), while
        other styles use different separator patterns.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Character Replacement</div>
      <p class="mt-1">
        When enabled, illegal filesystem characters are replaced automatically. The colon replacement option controls
        how colons specifically are handled. {appLabel} also supports a custom replacement string.
      </p>
    </div>
  </div>
</InfoModal>
