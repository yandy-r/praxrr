<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
  import SourceBadge from '$ui/badge/SourceBadge.svelte';
  import Toggle from '$ui/toggle/Toggle.svelte';
  import SyncFooter from './SyncFooter.svelte';
  import { alertStore } from '$lib/client/alerts/store.ts';
  import type { SectionType } from '$sync/types.ts';

  type TrashGuideSourceArrType = 'radarr' | 'sonarr' | 'lidarr';
  type TrashGuideSyncTrigger = 'none' | 'manual' | 'on_pull' | 'on_change' | 'schedule';
  type UnifiedSourceType = 'pcd' | 'trash';

  interface DatabaseWithProfiles {
    id: number;
    name: string;
    qualityProfiles: QualityProfileTableRow[];
  }

  interface TrashGuideQualityProfileSource {
    sourceId: number;
    sourceName: string;
    sourceArrType: TrashGuideSourceArrType;
    config: {
      trigger: TrashGuideSyncTrigger;
      cron: string | null;
    } | null;
    selectedQualityProfiles: string[];
    availableQualityProfiles: string[];
  }

  interface UnifiedSourceOption {
    key: string;
    label: string;
    sourceType: UnifiedSourceType;
    sourceName: string;
    sourceArrType: TrashGuideSourceArrType | null;
  }

  interface UnifiedProfileOption {
    key: string;
    profileName: string;
    sourceKey: string;
    sourceType: UnifiedSourceType;
    sourceName: string;
    sourceArrType: TrashGuideSourceArrType | null;
    databaseId: number | null;
    trashSourceId: number | null;
  }

  const DEFAULT_CRON = '0 * * * *';
  const PROFILE_PAGE_SIZE = 25;

  export let databases: DatabaseWithProfiles[];
  export let trashGuideSources: TrashGuideQualityProfileSource[] = [];
  export let state: Record<number, Record<string, boolean>> = {};
  export let syncTrigger: 'manual' | 'on_pull' | 'on_change' | 'schedule' = 'manual';
  export let cronExpression: string = '0 * * * *';
  export let canSave: boolean = true;
  export let warning: string | null = null;
  export let previewEnabled = false;
  export let previewConfig: unknown = null;
  export let previewSection: SectionType | null = null;
  export let lastSyncedAt: string | null = null;

  let saving = false;
  let syncing = false;
  let canSync = false;
  let sourceFilter = 'all';
  let searchTerm = '';
  let currentPage = 1;
  let trashGuideStateKey = '';
  let trashGuideProfileState: Record<number, Record<string, boolean>> = {};

  function normalizeProfileName(value: string): string | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  function getAllProfilesForTrashSource(source: TrashGuideQualityProfileSource): string[] {
    const names = new Set<string>();

    for (const profileName of source.availableQualityProfiles) {
      const normalized = normalizeProfileName(profileName);
      if (normalized) {
        names.add(normalized);
      }
    }

    for (const profileName of source.selectedQualityProfiles) {
      const normalized = normalizeProfileName(profileName);
      if (normalized) {
        names.add(normalized);
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function buildTrashGuideStateKey(sources: TrashGuideQualityProfileSource[]): string {
    return JSON.stringify(
      sources
        .map((source) => ({
          sourceId: source.sourceId,
          selectedQualityProfiles: source.selectedQualityProfiles
            .map((profileName) => normalizeProfileName(profileName))
            .filter((profileName): profileName is string => Boolean(profileName))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          availableQualityProfiles: getAllProfilesForTrashSource(source),
        }))
        .sort((a, b) => a.sourceId - b.sourceId)
    );
  }

  function buildCurrentState(
    profileState: Record<number, Record<string, boolean>>,
    trigger: 'manual' | 'on_pull' | 'on_change' | 'schedule',
    cron: string,
    trashState: Record<number, Record<string, boolean>>,
    sources: TrashGuideQualityProfileSource[]
  ): string {
    const trashGuideSnapshot = sources
      .map((source) => {
        const sourceState = trashState[source.sourceId] ?? {};
        const selectedQualityProfiles = Object.entries(sourceState)
          .filter(([, selected]) => selected)
          .map(([profileName]) => profileName)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        return {
          sourceId: source.sourceId,
          trigger: source.config?.trigger ?? 'manual',
          cron: source.config?.cron ?? null,
          selectedQualityProfiles,
        };
      })
      .sort((a, b) => a.sourceId - b.sourceId);

    return JSON.stringify({
      state: profileState,
      syncTrigger: trigger,
      cronExpression: cron,
      trashGuide: trashGuideSnapshot,
    });
  }

  let hasInitializedSavedState = false;
  let savedState = '';
  let currentState = '';
  $: currentState = buildCurrentState(state, syncTrigger, cronExpression, trashGuideProfileState, trashGuideSources);
  $: if (!hasInitializedSavedState) {
    savedState = currentState;
    hasInitializedSavedState = true;
  }
  export let isDirty = false;
  $: isDirty = hasInitializedSavedState && currentState !== savedState;

  $: {
    for (const db of databases) {
      if (!state[db.id]) {
        state[db.id] = {};
      }

      for (const profile of db.qualityProfiles) {
        if (state[db.id][profile.name] === undefined) {
          state[db.id][profile.name] = false;
        }
      }
    }
  }

  $: {
    const nextKey = buildTrashGuideStateKey(trashGuideSources);
    if (nextKey === trashGuideStateKey) {
      // no-op
    } else {
      const nextState: Record<number, Record<string, boolean>> = {};
      for (const source of trashGuideSources) {
        const selected = new Set(
          source.selectedQualityProfiles
            .map((profileName) => normalizeProfileName(profileName))
            .filter((profileName): profileName is string => Boolean(profileName))
        );
        nextState[source.sourceId] = {};
        for (const profileName of getAllProfilesForTrashSource(source)) {
          nextState[source.sourceId][profileName] = selected.has(profileName);
        }
      }
      trashGuideProfileState = nextState;
      trashGuideStateKey = nextKey;
    }
  }

  $: selectedKeys = new Set(
    Object.entries(state).flatMap(([dbId, profiles]) =>
      Object.entries(profiles)
        .filter(([, selected]) => selected)
        .map(([profileName]) => `${dbId}-${profileName}`)
    )
  );
  $: selectedTrashGuideCount = Object.values(trashGuideProfileState).reduce((count, sourceState) => {
    return count + Object.values(sourceState).filter((selected) => selected).length;
  }, 0);
  $: totalSelectedCount = selectedKeys.size + selectedTrashGuideCount;
  $: canSync = totalSelectedCount > 0;
  $: {
    if (totalSelectedCount === 0) {
      previewEnabled = false;
    } else if (isDirty) {
      previewEnabled = true;
    } else {
      previewEnabled = lastSyncedAt === null;
    }
  }

  let pcdSourceOptions: UnifiedSourceOption[] = [];
  let trashSourceOptions: UnifiedSourceOption[] = [];
  let allSourceOptions: UnifiedSourceOption[] = [];
  let allProfileOptions: UnifiedProfileOption[] = [];

  $: pcdSourceOptions = databases
    .filter((db) => db.qualityProfiles.length > 0)
    .map((db) => ({
      key: `pcd:${db.id}`,
      label: db.name,
      sourceType: 'pcd',
      sourceName: db.name,
      sourceArrType: null,
    }));
  $: trashSourceOptions = trashGuideSources
    .filter((source) => getAllProfilesForTrashSource(source).length > 0)
    .map((source) => ({
      key: `trash:${source.sourceId}`,
      label: source.sourceName,
      sourceType: 'trash',
      sourceName: source.sourceName,
      sourceArrType: source.sourceArrType,
    }));
  $: allSourceOptions = [...pcdSourceOptions, ...trashSourceOptions];

  $: allProfileOptions = [
    ...databases.flatMap((db) =>
      db.qualityProfiles.map((profile) => ({
        key: `pcd:${db.id}:${profile.name}`,
        profileName: profile.name,
        sourceKey: `pcd:${db.id}`,
        sourceType: 'pcd' as const,
        sourceName: db.name,
        sourceArrType: null,
        databaseId: db.id,
        trashSourceId: null,
      }))
    ),
    ...trashGuideSources.flatMap((source) =>
      getAllProfilesForTrashSource(source).map((profileName) => ({
        key: `trash:${source.sourceId}:${profileName}`,
        profileName,
        sourceKey: `trash:${source.sourceId}`,
        sourceType: 'trash' as const,
        sourceName: source.sourceName,
        sourceArrType: source.sourceArrType,
        databaseId: null,
        trashSourceId: source.sourceId,
      }))
    ),
  ];
  $: filteredProfileOptions = allProfileOptions.filter((option) => {
    const sourceMatch = sourceFilter === 'all' || sourceFilter === option.sourceKey;
    if (!sourceMatch) {
      return false;
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return true;
    }

    return (
      option.profileName.toLowerCase().includes(normalizedSearch) ||
      option.sourceName.toLowerCase().includes(normalizedSearch)
    );
  });
  $: totalPages = Math.max(1, Math.ceil(filteredProfileOptions.length / PROFILE_PAGE_SIZE));
  $: if (currentPage > totalPages) {
    currentPage = 1;
  }
  $: startIndex = (currentPage - 1) * PROFILE_PAGE_SIZE;
  $: paginatedProfileOptions = filteredProfileOptions.slice(startIndex, startIndex + PROFILE_PAGE_SIZE);
  $: visibleStart = filteredProfileOptions.length === 0 ? 0 : startIndex + 1;
  $: visibleEnd = Math.min(filteredProfileOptions.length, startIndex + PROFILE_PAGE_SIZE);
  $: showSourceBadgeInToggle = sourceFilter === 'all';

  function setSourceFilter(value: string) {
    sourceFilter = value;
    currentPage = 1;
  }

  function setSearchTerm(value: string) {
    searchTerm = value;
    currentPage = 1;
  }

  function clearFilters() {
    sourceFilter = 'all';
    searchTerm = '';
    currentPage = 1;
  }

  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages) {
      return;
    }
    currentPage = nextPage;
  }

  function isSelected(databaseId: number, profileName: string): boolean {
    return selectedKeys.has(`${databaseId}-${profileName}`);
  }

  function setProfile(databaseId: number, profileName: string, checked: boolean) {
    state[databaseId][profileName] = checked;
    state = { ...state };
  }

  function isTrashGuideProfileSelected(sourceId: number, profileName: string): boolean {
    return trashGuideProfileState[sourceId]?.[profileName] === true;
  }

  function setTrashGuideProfile(sourceId: number, profileName: string, checked: boolean) {
    trashGuideProfileState = {
      ...trashGuideProfileState,
      [sourceId]: {
        ...(trashGuideProfileState[sourceId] ?? {}),
        [profileName]: checked,
      },
    };
  }

  function isProfileOptionSelected(option: UnifiedProfileOption): boolean {
    if (option.sourceType === 'pcd' && typeof option.databaseId === 'number') {
      return isSelected(option.databaseId, option.profileName);
    }

    if (option.sourceType === 'trash' && typeof option.trashSourceId === 'number') {
      return isTrashGuideProfileSelected(option.trashSourceId, option.profileName);
    }

    return false;
  }

  function setProfileOption(option: UnifiedProfileOption, checked: boolean) {
    if (option.sourceType === 'pcd' && typeof option.databaseId === 'number') {
      setProfile(option.databaseId, option.profileName, checked);
      return;
    }

    if (option.sourceType === 'trash' && typeof option.trashSourceId === 'number') {
      setTrashGuideProfile(option.trashSourceId, option.profileName, checked);
    }
  }

  function getSelections(): { databaseId: number; profileName: string }[] {
    const selections: { databaseId: number; profileName: string }[] = [];
    for (const [dbId, profiles] of Object.entries(state)) {
      for (const [profileName, selected] of Object.entries(profiles)) {
        if (selected) {
          selections.push({ databaseId: parseInt(dbId), profileName });
        }
      }
    }
    return selections;
  }

  async function extractFormError(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: unknown } | null;
      if (body && typeof body === 'object' && typeof body.error === 'string') {
        return body.error;
      }
    } catch {
      // fall through to fallback
    }
    return fallback;
  }

  async function saveTrashGuideQualityProfiles(): Promise<void> {
    for (const source of trashGuideSources) {
      const sourceState = trashGuideProfileState[source.sourceId] ?? {};
      const selectedQualityProfiles = Object.entries(sourceState)
        .filter(([, selected]) => selected)
        .map(([profileName]) => ({
          sectionType: 'qualityProfiles',
          itemName: profileName,
        }));

      if (selectedQualityProfiles.length === 0 && !source.config) {
        continue;
      }

      const trigger = source.config?.trigger ?? 'manual';
      const cron = source.config?.cron?.trim() || DEFAULT_CRON;
      const formData = new FormData();
      formData.set('sourceId', String(source.sourceId));
      formData.set('trigger', trigger);
      if (trigger === 'schedule') {
        formData.set('cron', cron);
      }
      formData.set('selections', JSON.stringify(selectedQualityProfiles));

      const response = await fetch('?/saveTrashGuideSource', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = await extractFormError(response, 'Failed to save quality profiles sync config');
        throw new Error(payload);
      }
    }
  }

  export async function saveSection() {
    await handleSave();
  }

  export async function syncSection() {
    await handleSync();
  }

  async function handleSave() {
    saving = true;
    try {
      const formData = new FormData();
      formData.set('selections', JSON.stringify(getSelections()));
      formData.set('trigger', syncTrigger);
      formData.set('cron', cronExpression);

      const response = await fetch('?/saveQualityProfiles', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        alertStore.add('error', 'Failed to save quality profiles sync config');
        return;
      }

      await saveTrashGuideQualityProfiles();
      alertStore.add('success', 'Quality profiles sync config saved');
      savedState = currentState;
      await invalidateAll().catch(() => undefined);
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to save quality profiles sync config');
    } finally {
      saving = false;
    }
  }

  async function handleSync() {
    syncing = true;
    try {
      if (totalSelectedCount === 0) {
        alertStore.add('error', 'No quality profiles selected to sync');
        return;
      }

      const response = await fetch('?/syncQualityProfiles', {
        method: 'POST',
        body: new FormData(),
      });

      if (!response.ok) {
        const payload = await extractFormError(response, 'Quality profile sync failed');
        throw new Error(payload);
      }

      alertStore.add('success', 'Quality profiles sync queued');
      await invalidateAll().catch(() => undefined);
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Sync failed');
    } finally {
      syncing = false;
    }
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Quality Profiles</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Select quality profiles from connected sources to sync to this instance.
    </p>
  </div>

  <div class="space-y-4 p-6">
    <div class="grid gap-3 md:grid-cols-[minmax(220px,280px)_1fr_auto]">
      <label class="space-y-1 text-sm">
        <span class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Source</span>
        <select
          class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          value={sourceFilter}
          on:change={(event) => setSourceFilter((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="all">All sources</option>
          {#each allSourceOptions as source}
            <option value={source.key}>{source.label}</option>
          {/each}
        </select>
      </label>

      <label class="space-y-1 text-sm">
        <span class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Search</span>
        <input
          type="search"
          class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          placeholder="Search profile or source"
          value={searchTerm}
          on:input={(event) => setSearchTerm((event.currentTarget as HTMLInputElement).value)}
        />
      </label>

      <button
        type="button"
        class="self-end rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        on:click={clearFilters}
      >
        Clear
      </button>
    </div>

    {#if allProfileOptions.length === 0}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        No quality profile sources are available for this instance.
      </p>
    {:else if filteredProfileOptions.length === 0}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        No quality profiles match your selected source filters.
      </p>
    {:else}
      <div class="space-y-3">
        <div class="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            Showing {visibleStart}-{visibleEnd} of {filteredProfileOptions.length}
          </span>
          <span>{totalSelectedCount} selected</span>
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {#each paginatedProfileOptions as option}
            <div class="space-y-1">
              <Toggle
                checked={isProfileOptionSelected(option)}
                label={option.profileName}
                ariaLabel={`Toggle quality profile ${option.profileName} from ${option.sourceName}`}
                on:change={(event) => setProfileOption(option, event.detail)}
              />
              {#if showSourceBadgeInToggle}
                <div class="px-1">
                  <SourceBadge
                    sourceType={option.sourceType}
                    sourceName={option.sourceName}
                    arrType={option.sourceArrType}
                    size="sm"
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if totalPages > 1}
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              disabled={currentPage <= 1}
              on:click={() => changePage(currentPage - 1)}
            >
              Previous
            </button>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              class="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              disabled={currentPage >= totalPages}
              on:click={() => changePage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <SyncFooter
    bind:syncTrigger
    bind:cronExpression
    {saving}
    {syncing}
    {isDirty}
    {canSave}
    {canSync}
    {warning}
    {previewEnabled}
    {previewConfig}
    {previewSection}
    on:previewGenerated
    on:previewError
    on:save={handleSave}
    on:sync={handleSync}
  />
</div>
