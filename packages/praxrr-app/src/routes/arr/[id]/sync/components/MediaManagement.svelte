<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import SearchDropdown from '$ui/form/SearchDropdown.svelte';
  import SyncFooter from './SyncFooter.svelte';
  import { alertStore } from '$lib/client/alerts/store.ts';
  import { extractFormError } from '$lib/client/utils/extractFormError.ts';
  import type { SectionType } from '$sync/types.ts';
  import type { TrashGuideSourceArrType } from '$shared/trashguide/types.ts';

  interface ConfigOption {
    name: string;
  }

  interface Database {
    id: number;
    name: string;
    namingConfigs: ConfigOption[];
    qualityDefinitionsConfigs: ConfigOption[];
    mediaSettingsConfigs: ConfigOption[];
  }

  interface TrashGuideMediaManagementSource {
    sourceId: number;
    sourceName: string;
    sourceArrType: TrashGuideSourceArrType;
    namingEntities: string[];
    qualitySizeEntities: string[];
    selectedNaming: string | null;
    selectedQualityDefinitions: string | null;
  }

  type SourceType = 'pcd' | 'trash';

  type ParsedSelection =
    | { sourceType: 'pcd'; databaseId: number; configName: string }
    | { sourceType: 'trash'; sourceId: number; itemName: string }
    | null;

  export let databases: Database[];
  export let trashGuideSources: TrashGuideMediaManagementSource[] = [];
  export let state: {
    namingDatabaseId: number | null;
    namingConfigName: string | null;
    qualityDefinitionsDatabaseId: number | null;
    qualityDefinitionsConfigName: string | null;
    mediaSettingsDatabaseId: number | null;
    mediaSettingsConfigName: string | null;
  } = {
    namingDatabaseId: null,
    namingConfigName: null,
    qualityDefinitionsDatabaseId: null,
    qualityDefinitionsConfigName: null,
    mediaSettingsDatabaseId: null,
    mediaSettingsConfigName: null,
  };

  // TRaSH selection state
  let trashNamingSelection: { sourceId: number; itemName: string } | null = null;
  let trashQualityDefinitionsSelection: { sourceId: number; itemName: string } | null = null;

  // Initialize TRaSH selections from server data
  $: {
    if (trashNamingSelection === null) {
      for (const source of trashGuideSources) {
        if (source.selectedNaming) {
          trashNamingSelection = { sourceId: source.sourceId, itemName: source.selectedNaming };
          break;
        }
      }
    }
    if (trashQualityDefinitionsSelection === null) {
      for (const source of trashGuideSources) {
        if (source.selectedQualityDefinitions) {
          trashQualityDefinitionsSelection = {
            sourceId: source.sourceId,
            itemName: source.selectedQualityDefinitions,
          };
          break;
        }
      }
    }
  }

  // Capture savedState after hydration so initial load is not reported as dirty
  let savedStateCaptured = false;
  $: {
    if (!savedStateCaptured) {
      savedState = buildCurrentState();
      savedStateCaptured = true;
    }
  }

  // Expose TRaSH selection state for parent validation
  export let hasTrashNaming = false;
  export let hasTrashQualityDefinitions = false;
  $: hasTrashNaming = trashNamingSelection !== null;
  $: hasTrashQualityDefinitions = trashQualityDefinitionsSelection !== null;

  type SelectionOption = {
    value: string;
    label: string;
  };

  function encodeValue(sourceType: SourceType, id: number, name: string): string {
    return JSON.stringify([sourceType, id, name]);
  }

  function getNamingOptions(): SelectionOption[] {
    const options: SelectionOption[] = [];
    for (const db of databases) {
      for (const config of db.namingConfigs) {
        options.push({
          value: encodeValue('pcd', db.id, config.name),
          label: `${db.name} / ${config.name}`,
        });
      }
    }
    for (const source of trashGuideSources) {
      for (const name of source.namingEntities) {
        options.push({
          value: encodeValue('trash', source.sourceId, name),
          label: `${source.sourceName} / ${name}`,
        });
      }
    }
    return options;
  }

  function getQualityDefinitionsOptions(): SelectionOption[] {
    const options: SelectionOption[] = [];
    for (const db of databases) {
      for (const config of db.qualityDefinitionsConfigs) {
        options.push({
          value: encodeValue('pcd', db.id, config.name),
          label: `${db.name} / ${config.name}`,
        });
      }
    }
    for (const source of trashGuideSources) {
      for (const name of source.qualitySizeEntities) {
        options.push({
          value: encodeValue('trash', source.sourceId, name),
          label: `${source.sourceName} / ${name}`,
        });
      }
    }
    return options;
  }

  function getMediaSettingsOptions(): SelectionOption[] {
    const options: SelectionOption[] = [];
    for (const db of databases) {
      for (const config of db.mediaSettingsConfigs) {
        options.push({
          value: encodeValue('pcd', db.id, config.name),
          label: `${db.name} / ${config.name}`,
        });
      }
    }
    return options;
  }

  $: namingOptions = databases && trashGuideSources && getNamingOptions();
  $: qualityDefinitionsOptions = databases && trashGuideSources && getQualityDefinitionsOptions();
  $: mediaSettingsOptions = databases && getMediaSettingsOptions();

  function parseSelectionValue(value: string): ParsedSelection {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return null;

      // New 3-element format: [sourceType, id, name]
      if (parsed.length === 3) {
        const sourceType = parsed[0] as SourceType;
        const id = Number(parsed[1]);
        const name = String(parsed[2]);
        if (Number.isNaN(id) || !name) return null;

        if (sourceType === 'pcd') {
          return { sourceType: 'pcd', databaseId: id, configName: name };
        }
        if (sourceType === 'trash') {
          return { sourceType: 'trash', sourceId: id, itemName: name };
        }
        return null;
      }

      // Legacy 2-element format: [databaseId, configName]
      if (parsed.length === 2) {
        const databaseId = Number(parsed[0]);
        const configName = String(parsed[1]);
        if (!Number.isNaN(databaseId) && configName) {
          return { sourceType: 'pcd', databaseId, configName };
        }
      }
    } catch {
      // Ignore malformed values and clear selection.
    }
    return null;
  }

  $: namingValue = (() => {
    if (trashNamingSelection) {
      return encodeValue('trash', trashNamingSelection.sourceId, trashNamingSelection.itemName);
    }
    if (state.namingDatabaseId !== null && state.namingConfigName) {
      return encodeValue('pcd', state.namingDatabaseId, state.namingConfigName);
    }
    return '';
  })();

  $: qualityDefinitionsValue = (() => {
    if (trashQualityDefinitionsSelection) {
      return encodeValue('trash', trashQualityDefinitionsSelection.sourceId, trashQualityDefinitionsSelection.itemName);
    }
    if (state.qualityDefinitionsDatabaseId !== null && state.qualityDefinitionsConfigName) {
      return encodeValue('pcd', state.qualityDefinitionsDatabaseId, state.qualityDefinitionsConfigName);
    }
    return '';
  })();

  $: mediaSettingsValue =
    state.mediaSettingsDatabaseId !== null && state.mediaSettingsConfigName
      ? encodeValue('pcd', state.mediaSettingsDatabaseId, state.mediaSettingsConfigName)
      : '';

  function selectNaming(value: string) {
    const parsed = parseSelectionValue(value);
    if (!parsed) {
      state = { ...state, namingDatabaseId: null, namingConfigName: null };
      trashNamingSelection = null;
      return;
    }
    if (parsed.sourceType === 'pcd') {
      state = { ...state, namingDatabaseId: parsed.databaseId, namingConfigName: parsed.configName };
      trashNamingSelection = null;
    } else {
      state = { ...state, namingDatabaseId: null, namingConfigName: null };
      trashNamingSelection = { sourceId: parsed.sourceId, itemName: parsed.itemName };
    }
  }

  function selectQuality(value: string) {
    const parsed = parseSelectionValue(value);
    if (!parsed) {
      state = {
        ...state,
        qualityDefinitionsDatabaseId: null,
        qualityDefinitionsConfigName: null,
      };
      trashQualityDefinitionsSelection = null;
      return;
    }
    if (parsed.sourceType === 'pcd') {
      state = {
        ...state,
        qualityDefinitionsDatabaseId: parsed.databaseId,
        qualityDefinitionsConfigName: parsed.configName,
      };
      trashQualityDefinitionsSelection = null;
    } else {
      state = {
        ...state,
        qualityDefinitionsDatabaseId: null,
        qualityDefinitionsConfigName: null,
      };
      trashQualityDefinitionsSelection = { sourceId: parsed.sourceId, itemName: parsed.itemName };
    }
  }

  function selectMedia(value: string) {
    const parsed = parseSelectionValue(value);
    if (!parsed || parsed.sourceType !== 'pcd') {
      state = { ...state, mediaSettingsDatabaseId: null, mediaSettingsConfigName: null };
      return;
    }
    state = {
      ...state,
      mediaSettingsDatabaseId: parsed.databaseId,
      mediaSettingsConfigName: parsed.configName,
    };
  }

  export async function saveSection() {
    await handleSave();
  }

  export let syncTrigger: 'manual' | 'on_pull' | 'on_change' | 'schedule' = 'manual';
  export let cronExpression: string = '0 * * * *';
  export let previewEnabled = false;
  export let previewConfig: unknown = null;
  export let previewSection: SectionType | null = null;
  export let lastSyncedAt: string | null = null;

  let saving = false;
  let syncing = false;

  function buildCurrentState(): string {
    return JSON.stringify({
      state,
      syncTrigger,
      cronExpression,
      trashNaming: trashNamingSelection,
      trashQualityDefinitions: trashQualityDefinitionsSelection,
    });
  }

  // Track saved state for dirty detection
  let savedState = buildCurrentState();
  $: currentState = JSON.stringify({
    state,
    syncTrigger,
    cronExpression,
    trashNaming: trashNamingSelection,
    trashQualityDefinitions: trashQualityDefinitionsSelection,
  });
  export let isDirty = false;
  $: isDirty = currentState !== savedState;

  $: {
    const hasAnySelection =
      (state.namingDatabaseId !== null && state.namingConfigName !== null) ||
      trashNamingSelection !== null ||
      (state.qualityDefinitionsDatabaseId !== null && state.qualityDefinitionsConfigName !== null) ||
      trashQualityDefinitionsSelection !== null ||
      (state.mediaSettingsDatabaseId !== null && state.mediaSettingsConfigName !== null);

    if (!hasAnySelection) {
      previewEnabled = false;
    } else if (isDirty) {
      previewEnabled = true;
    } else {
      previewEnabled = lastSyncedAt === null;
    }
  }

  async function saveTrashGuideMediaManagementSelections(): Promise<void> {
    // Collect which sources need naming/qualityDefinitions selections saved
    const sourceSelections: Record<number, { sectionType: string; itemName: string }[]> = {};

    if (trashNamingSelection) {
      const list = sourceSelections[trashNamingSelection.sourceId] ?? [];
      list.push({ sectionType: 'naming', itemName: trashNamingSelection.itemName });
      sourceSelections[trashNamingSelection.sourceId] = list;
    }

    if (trashQualityDefinitionsSelection) {
      const list = sourceSelections[trashQualityDefinitionsSelection.sourceId] ?? [];
      list.push({ sectionType: 'qualityDefinitions', itemName: trashQualityDefinitionsSelection.itemName });
      sourceSelections[trashQualityDefinitionsSelection.sourceId] = list;
    }

    // Save for each TRaSH source that has or had naming/qualityDefinitions selections
    for (const source of trashGuideSources) {
      const hasExistingSelections = source.selectedNaming !== null || source.selectedQualityDefinitions !== null;
      const newSelections = sourceSelections[source.sourceId];

      if (!newSelections && !hasExistingSelections) {
        continue;
      }

      const formData = new FormData();
      formData.set('sourceId', String(source.sourceId));
      formData.set('mergeMediaManagementSelections', 'true');
      formData.set('selections', JSON.stringify(newSelections ?? []));

      const response = await fetch('?/saveTrashGuideSource', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = await extractFormError(response, 'Failed to save TRaSH media management selections');
        throw new Error(payload);
      }
    }
  }

  async function handleSave() {
    saving = true;
    try {
      const formData = new FormData();
      formData.set('namingDatabaseId', state.namingDatabaseId?.toString() ?? '');
      formData.set('namingConfigName', state.namingConfigName ?? '');
      formData.set('qualityDefinitionsDatabaseId', state.qualityDefinitionsDatabaseId?.toString() ?? '');
      formData.set('qualityDefinitionsConfigName', state.qualityDefinitionsConfigName ?? '');
      formData.set('mediaSettingsDatabaseId', state.mediaSettingsDatabaseId?.toString() ?? '');
      formData.set('mediaSettingsConfigName', state.mediaSettingsConfigName ?? '');
      formData.set('trigger', syncTrigger);
      formData.set('cron', cronExpression);

      const response = await fetch('?/saveMediaManagement', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        alertStore.add('error', 'Failed to save media management sync config');
        return;
      }

      await saveTrashGuideMediaManagementSelections();
      alertStore.add('success', 'Media management sync config saved');
      savedState = buildCurrentState();
      await invalidateAll().catch(() => undefined);
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to save media management sync config');
    } finally {
      saving = false;
    }
  }

  async function handleSync() {
    syncing = true;
    try {
      const response = await fetch('?/syncMediaManagement', {
        method: 'POST',
        body: new FormData(),
      });

      if (response.ok) {
        const data = await response.json();
        alertStore.add('success', data?.message ?? 'Sync queued');
        await invalidateAll().catch(() => undefined);
      } else {
        alertStore.add('error', 'Sync failed');
      }
    } catch {
      alertStore.add('error', 'Sync failed');
    } finally {
      syncing = false;
    }
  }

  export async function syncSection() {
    await handleSync();
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <!-- Header -->
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Media Management</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Select which database config to use for each media management setting
    </p>
  </div>

  <!-- Content -->
  <div class="p-6">
    <div class="grid gap-6 sm:grid-cols-3">
      <!-- Naming -->
      <SearchDropdown
        label="Naming"
        hideLabel={false}
        fullWidth
        options={namingOptions}
        value={namingValue}
        placeholder={namingOptions.length === 0 ? 'No naming configs available' : 'Select naming config...'}
        disabled={namingOptions.length === 0}
        description="Choose the naming config to sync. Clear to unset."
        on:change={(e) => selectNaming(e.detail)}
      />

      <!-- Quality Definitions -->
      <SearchDropdown
        label="Quality Definitions"
        hideLabel={false}
        fullWidth
        options={qualityDefinitionsOptions}
        value={qualityDefinitionsValue}
        placeholder={qualityDefinitionsOptions.length === 0
          ? 'No quality definitions configs available'
          : 'Select quality definitions config...'}
        disabled={qualityDefinitionsOptions.length === 0}
        description="Choose the quality definitions config to sync. Clear to unset."
        on:change={(e) => selectQuality(e.detail)}
      />

      <!-- Media Settings -->
      <SearchDropdown
        label="Media Settings"
        hideLabel={false}
        fullWidth
        options={mediaSettingsOptions}
        value={mediaSettingsValue}
        placeholder={mediaSettingsOptions.length === 0
          ? 'No media settings configs available'
          : 'Select media settings config...'}
        disabled={mediaSettingsOptions.length === 0}
        description="Choose the media settings config to sync. Clear to unset."
        on:change={(e) => selectMedia(e.detail)}
      />
    </div>
  </div>

  <SyncFooter
    bind:syncTrigger
    bind:cronExpression
    {saving}
    {syncing}
    {isDirty}
    {previewEnabled}
    {previewConfig}
    {previewSection}
    on:previewGenerated
    on:previewError
    on:save={handleSave}
    on:sync={handleSync}
  />
</div>
