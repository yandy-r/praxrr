<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { AlertTriangle, FilterX, Loader2, RefreshCw, Save, Search } from 'lucide-svelte';
  import { alertStore } from '$alerts/store.ts';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import SourceBadge from '$ui/badge/SourceBadge.svelte';
  import type { TrashGuideSourceArrType } from '$shared/trashguide/types.ts';
  import type {
    TrashGuideSyncSectionType,
    TrashGuideSyncStatus,
    TrashGuideSyncTrigger,
  } from '$shared/trashguide/types.ts';
  import { parseUTC } from '$shared/utils/dates';
  import { extractFormError } from '$lib/client/utils/extractFormError.ts';

  type ViewState = 'loading' | 'server-error' | 'no-sources' | 'filtered-empty' | 'ready';

  interface TrashGuideSyncConfig {
    trigger: TrashGuideSyncTrigger;
    cron: string | null;
    syncStatus: TrashGuideSyncStatus;
    lastError: string | null;
    lastSyncedAt: string | null;
  }

  interface TrashGuideSyncSelection {
    sectionType: TrashGuideSyncSectionType;
    itemName: string;
  }

  interface TrashGuideAvailableSelectionGroup {
    sectionType: TrashGuideSyncSectionType;
    label: string;
    items: string[];
  }

  interface TrashGuideSyncSourceHydration {
    sourceId: number;
    sourceName: string;
    sourceArrType: TrashGuideSourceArrType;
    config: TrashGuideSyncConfig | null;
    selections: TrashGuideSyncSelection[];
    availableSelections?: TrashGuideAvailableSelectionGroup[];
  }

  interface SourceDraftState {
    trigger: TrashGuideSyncTrigger;
    cronExpression: string;
    selectedKeys: Set<string>;
    savedSnapshot: string;
    saving: boolean;
    syncing: boolean;
  }

  interface SelectionGroup {
    sectionType: TrashGuideSyncSectionType;
    label: string;
    items: string[];
  }

  const SECTION_ORDER: readonly TrashGuideSyncSectionType[] = [
    'qualityProfiles',
    'customFormats',
    'qualityDefinitions',
    'naming',
    'mediaManagement',
  ];

  const SECTION_LABELS: Record<TrashGuideSyncSectionType, string> = {
    qualityProfiles: 'Quality Profiles',
    customFormats: 'Custom Formats',
    qualityDefinitions: 'Quality Definitions',
    naming: 'Naming',
    mediaManagement: 'Media Management',
  };

  const VALID_TRIGGERS: readonly TrashGuideSyncTrigger[] = ['none', 'manual', 'on_pull', 'on_change', 'schedule'];
  const DEFAULT_CRON = '0 * * * *';

  export let sources: TrashGuideSyncSourceHydration[] = [];
  export let isLoading = false;
  export let loadError: string | null = null;
  export let isDirty = false;
  export let previewEnabled = false;

  let sourceFilter = '';
  let sourceRevision = '';
  let sourceState: Record<number, SourceDraftState> = {};

  function compareSources(a: TrashGuideSyncSourceHydration, b: TrashGuideSyncSourceHydration): number {
    const byName = a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: 'base' });
    if (byName !== 0) {
      return byName;
    }

    return a.sourceId - b.sourceId;
  }

  function selectionKey(sectionType: TrashGuideSyncSectionType, itemName: string): string {
    return `${sectionType}\u0000${itemName}`;
  }

  function parseSelectionKey(value: string): TrashGuideSyncSelection {
    const [sectionType, itemName] = value.split('\u0000');
    if (!sectionType || !itemName || !SECTION_ORDER.includes(sectionType as TrashGuideSyncSectionType)) {
      throw new Error(`Invalid TRaSH selection key: ${value}`);
    }

    return {
      sectionType: sectionType as TrashGuideSyncSectionType,
      itemName,
    };
  }

  function normalizeTrigger(value: string | null | undefined): TrashGuideSyncTrigger {
    if (value && VALID_TRIGGERS.includes(value as TrashGuideSyncTrigger)) {
      return value as TrashGuideSyncTrigger;
    }

    return 'manual';
  }

  function buildSnapshot(trigger: TrashGuideSyncTrigger, cronExpression: string, selectedKeys: Set<string>): string {
    const normalizedCron = trigger === 'schedule' ? cronExpression.trim() || DEFAULT_CRON : null;
    return JSON.stringify({
      trigger,
      cron: normalizedCron,
      selections: [...selectedKeys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    });
  }

  function buildInitialState(source: TrashGuideSyncSourceHydration): SourceDraftState {
    const trigger = normalizeTrigger(source.config?.trigger);
    const cronExpression = source.config?.cron?.trim() || DEFAULT_CRON;
    const selectedKeys = new Set(
      source.selections.map((selection) => selectionKey(selection.sectionType, selection.itemName))
    );

    return {
      trigger,
      cronExpression,
      selectedKeys,
      savedSnapshot: buildSnapshot(trigger, cronExpression, selectedKeys),
      saving: false,
      syncing: false,
    };
  }

  function getSelectionGroups(source: TrashGuideSyncSourceHydration): SelectionGroup[] {
    const groups = new Map<TrashGuideSyncSectionType, Set<string>>();

    for (const sectionType of SECTION_ORDER) {
      groups.set(sectionType, new Set<string>());
    }

    for (const group of source.availableSelections ?? []) {
      const sectionType = group.sectionType;
      if (!groups.has(sectionType)) {
        groups.set(sectionType, new Set<string>());
      }

      for (const item of group.items) {
        const normalized = item.trim();
        if (normalized.length > 0) {
          groups.get(sectionType)?.add(normalized);
        }
      }
    }

    for (const selection of source.selections) {
      const normalized = selection.itemName.trim();
      if (normalized.length > 0) {
        groups.get(selection.sectionType)?.add(normalized);
      }
    }

    return SECTION_ORDER.flatMap((sectionType) => {
      const items = groups.get(sectionType);
      if (!items || items.size === 0) {
        return [];
      }

      return [
        {
          sectionType,
          label: SECTION_LABELS[sectionType],
          items: [...items].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        },
      ];
    });
  }

  function getStatusVariant(config: TrashGuideSyncConfig | null): 'neutral' | 'warning' | 'danger' | 'info' {
    if (!config) {
      return 'neutral';
    }

    switch (config.syncStatus) {
      case 'failed':
        return 'danger';
      case 'in_progress':
        return 'info';
      case 'pending':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  function getStatusLabel(config: TrashGuideSyncConfig | null): string {
    if (!config) {
      return 'Not configured';
    }

    switch (config.syncStatus) {
      case 'failed':
        return 'Failed';
      case 'in_progress':
        return 'In progress';
      case 'pending':
        return 'Pending';
      default:
        return 'Idle';
    }
  }

  function formatLastSynced(value: string | null): string {
    const parsed = parseUTC(value);
    if (!parsed) {
      return 'Never';
    }

    return parsed.toLocaleString();
  }

  function clearFilter() {
    sourceFilter = '';
  }

  function updateSourceState(sourceId: number, updater: (current: SourceDraftState) => SourceDraftState): void {
    const current = sourceState[sourceId];
    if (!current) {
      return;
    }

    sourceState = {
      ...sourceState,
      [sourceId]: updater(current),
    };
  }

  function setSourceTrigger(sourceId: number, trigger: TrashGuideSyncTrigger): void {
    updateSourceState(sourceId, (state) => ({
      ...state,
      trigger,
      cronExpression: trigger === 'schedule' ? state.cronExpression.trim() || DEFAULT_CRON : state.cronExpression,
    }));
  }

  function setSourceCron(sourceId: number, cronExpression: string): void {
    updateSourceState(sourceId, (state) => ({
      ...state,
      cronExpression,
    }));
  }

  function toggleSelection(
    sourceId: number,
    sectionType: TrashGuideSyncSectionType,
    itemName: string,
    checked: boolean
  ): void {
    updateSourceState(sourceId, (state) => {
      const key = selectionKey(sectionType, itemName);
      const nextSelected = new Set(state.selectedKeys);
      if (checked) {
        nextSelected.add(key);
      } else {
        nextSelected.delete(key);
      }

      return {
        ...state,
        selectedKeys: nextSelected,
      };
    });
  }

  function getSelectedCount(sourceId: number): number {
    return sourceState[sourceId]?.selectedKeys.size ?? 0;
  }

  function isSourceDirty(sourceId: number): boolean {
    const state = sourceState[sourceId];
    if (!state) {
      return false;
    }

    const currentSnapshot = buildSnapshot(state.trigger, state.cronExpression, state.selectedKeys);
    return currentSnapshot !== state.savedSnapshot;
  }

  function getSourceStateOrThrow(sourceId: number): SourceDraftState {
    const state = sourceState[sourceId];
    if (!state) {
      throw new Error(`Missing source draft state for sourceId=${sourceId}`);
    }

    return state;
  }

  async function saveSource(sourceId: number): Promise<boolean> {
    let state: SourceDraftState;
    try {
      state = getSourceStateOrThrow(sourceId);
    } catch {
      alertStore.add('error', 'Unable to save TRaSH source state');
      return false;
    }

    updateSourceState(sourceId, (current) => ({ ...current, saving: true }));
    try {
      const selections = [...state.selectedKeys].map((key) => parseSelectionKey(key));
      const formData = new FormData();
      formData.set('sourceId', String(sourceId));
      formData.set('trigger', state.trigger);
      if (state.trigger === 'schedule') {
        formData.set('cron', state.cronExpression.trim() || DEFAULT_CRON);
      }
      formData.set('selections', JSON.stringify(selections));

      const response = await fetch('?/saveTrashGuideSource', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const message = await extractFormError(response, 'Failed to save TRaSH source sync config');
        alertStore.add('error', message);
        return false;
      }

      updateSourceState(sourceId, (current) => ({
        ...current,
        savedSnapshot: buildSnapshot(current.trigger, current.cronExpression, current.selectedKeys),
      }));
      alertStore.add('success', 'TRaSH source sync config saved');
      await invalidateAll().catch(() => undefined);
      return true;
    } catch {
      alertStore.add('error', 'Failed to save TRaSH source sync config');
      return false;
    } finally {
      updateSourceState(sourceId, (current) => ({ ...current, saving: false }));
    }
  }

  async function syncSource(sourceId: number): Promise<void> {
    let state: SourceDraftState;
    try {
      state = getSourceStateOrThrow(sourceId);
    } catch {
      alertStore.add('error', 'Unable to sync TRaSH source');
      return;
    }

    if (state.saving || state.syncing) {
      return;
    }

    if (isSourceDirty(sourceId)) {
      const saved = await saveSource(sourceId);
      if (!saved) {
        return;
      }
    }

    updateSourceState(sourceId, (current) => ({ ...current, syncing: true }));
    try {
      const formData = new FormData();
      formData.set('sourceId', String(sourceId));
      const response = await fetch('?/syncTrashGuideSource', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const message = await extractFormError(response, 'TRaSH sync failed');
        alertStore.add('error', message);
        return;
      }

      const payload = (await response.json()) as { message?: string };
      alertStore.add('success', payload.message ?? 'TRaSH source sync queued');
      await invalidateAll().catch(() => undefined);
    } catch {
      alertStore.add('error', 'TRaSH sync failed');
    } finally {
      updateSourceState(sourceId, (current) => ({ ...current, syncing: false }));
    }
  }

  $: nextRevision = JSON.stringify(
    sources.map((source) => ({
      sourceId: source.sourceId,
      trigger: source.config?.trigger ?? null,
      cron: source.config?.cron ?? null,
      selections: source.selections,
      availableSelections: source.availableSelections,
    }))
  );
  $: if (nextRevision !== sourceRevision) {
    sourceRevision = nextRevision;
    sourceState = Object.fromEntries(sources.map((source) => [source.sourceId, buildInitialState(source)] as const));
  }

  $: orderedSources = [...sources].sort(compareSources);
  $: normalizedFilter = sourceFilter.trim().toLowerCase();
  $: filteredSources = orderedSources.filter((source) => {
    if (!normalizedFilter) {
      return true;
    }

    const sourceMatches =
      source.sourceName.toLowerCase().includes(normalizedFilter) ||
      source.sourceArrType.toLowerCase().includes(normalizedFilter);
    if (sourceMatches) {
      return true;
    }

    return getSelectionGroups(source).some((group) =>
      group.items.some((item) => item.toLowerCase().includes(normalizedFilter))
    );
  });

  function deriveViewState(
    loading: boolean,
    error: string | null,
    hasOrderedSources: boolean,
    hasFilteredSources: boolean
  ): ViewState {
    if (loading) {
      return 'loading';
    }

    if (error) {
      return 'server-error';
    }

    if (!hasOrderedSources) {
      return 'no-sources';
    }

    if (!hasFilteredSources) {
      return 'filtered-empty';
    }

    return 'ready';
  }

  $: viewState = deriveViewState(isLoading, loadError, orderedSources.length > 0, filteredSources.length > 0);

  $: isDirty = orderedSources.some((source) => isSourceDirty(source.sourceId));
  $: previewEnabled = false;
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">TRaSH Guide Sources</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Select source-scoped TRaSH entities to sync and manage trigger behavior for this instance.
    </p>
  </div>

  <div class="space-y-4 p-6">
    <div class="relative">
      <Search size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        type="text"
        bind:value={sourceFilter}
        class="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 outline-none transition-colors focus:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        placeholder="Filter sources by name, Arr type, or item"
        disabled={isLoading || orderedSources.length === 0}
        aria-label="Filter TRaSH sources"
      />
    </div>

    {#if viewState === 'loading'}
      <div class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <Loader2 size={14} class="animate-spin" />
        <span>Loading TRaSH source sync state...</span>
      </div>
    {:else if viewState === 'server-error'}
      <div
        class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
      >
        <div class="flex items-start gap-2">
          <AlertTriangle size={14} class="mt-0.5 flex-shrink-0" />
          <div>
            <p class="font-medium">Unable to load TRaSH source sync state</p>
            <p class="mt-1">{loadError ?? 'An unexpected server error occurred.'}</p>
          </div>
        </div>
      </div>
    {:else if viewState === 'no-sources'}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        No enabled TRaSH Guide sources are linked for this instance type.
      </p>
    {:else if viewState === 'filtered-empty'}
      <div class="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
        <div class="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
          <FilterX size={14} />
          <span>No TRaSH sources match your current filter</span>
        </div>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Clear your filter to view all source groups.</p>
        <div class="mt-3">
          <Button text="Clear filter" size="xs" variant="ghost" on:click={clearFilter} />
        </div>
      </div>
    {:else}
      <div class="space-y-4">
        {#each filteredSources as source}
          {@const groups = getSelectionGroups(source)}
          {@const state = sourceState[source.sourceId]}
          <div class="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <SourceBadge sourceType="trash" sourceName={source.sourceName} arrType={source.sourceArrType} />
                <Badge variant={getStatusVariant(source.config)} size="sm">
                  {getStatusLabel(source.config)}
                </Badge>
              </div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400">
                Last synced: {formatLastSynced(source.config?.lastSyncedAt ?? null)}
              </div>
            </div>

            {#if source.config?.lastError}
              <p class="mt-2 text-xs text-red-600 dark:text-red-300">{source.config.lastError}</p>
            {/if}

            {#if state}
              <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,14rem),minmax(0,1fr)]">
                <div>
                  <label
                    class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
                    for={`trigger-${source.sourceId}`}
                  >
                    Trigger
                  </label>
                  <select
                    id={`trigger-${source.sourceId}`}
                    class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    value={state.trigger}
                    on:change={(event) =>
                      setSourceTrigger(
                        source.sourceId,
                        normalizeTrigger((event.currentTarget as HTMLSelectElement).value)
                      )}
                  >
                    <option value="none">Disabled</option>
                    <option value="manual">Manual</option>
                    <option value="on_pull">On Pull</option>
                    <option value="on_change">On Change</option>
                    <option value="schedule">Schedule</option>
                  </select>
                </div>

                {#if state.trigger === 'schedule'}
                  <div>
                    <label
                      class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
                      for={`cron-${source.sourceId}`}
                    >
                      Cron Expression
                    </label>
                    <input
                      id={`cron-${source.sourceId}`}
                      type="text"
                      value={state.cronExpression}
                      on:input={(event) =>
                        setSourceCron(source.sourceId, (event.currentTarget as HTMLInputElement).value)}
                      class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono text-neutral-700 outline-none transition-colors focus:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                      placeholder={DEFAULT_CRON}
                    />
                  </div>
                {/if}
              </div>

              <div class="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
                {getSelectedCount(source.sourceId)} selected {getSelectedCount(source.sourceId) === 1
                  ? 'item'
                  : 'items'}
              </div>

              {#if groups.length === 0}
                <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  No TRaSH entities are cached for this source yet. Pull/sync the source to populate selections.
                </p>
              {:else}
                <div class="mt-3 space-y-3">
                  {#each groups as group}
                    <div>
                      <div
                        class="flex items-center justify-between gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-300"
                      >
                        <span>{group.label}</span>
                        <span>{group.items.length} items</span>
                      </div>
                      <div class="mt-2 grid gap-2 md:grid-cols-2">
                        {#each group.items as item}
                          {@const key = selectionKey(group.sectionType, item)}
                          <label
                            class="flex items-start gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700"
                          >
                            <input
                              type="checkbox"
                              checked={state.selectedKeys.has(key)}
                              on:change={(event) =>
                                toggleSelection(
                                  source.sourceId,
                                  group.sectionType,
                                  item,
                                  (event.currentTarget as HTMLInputElement).checked
                                )}
                              class="mt-0.5"
                            />
                            <span class="min-w-0 break-words text-neutral-700 dark:text-neutral-200">{item}</span>
                          </label>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <div class="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  text={state.saving ? 'Saving...' : 'Save'}
                  variant="secondary"
                  size="sm"
                  disabled={!isSourceDirty(source.sourceId) || state.saving || state.syncing}
                  icon={state.saving ? Loader2 : Save}
                  iconColor={state.saving
                    ? 'text-neutral-600 dark:text-neutral-400 animate-spin'
                    : 'text-green-600 dark:text-green-400'}
                  on:click={() => saveSource(source.sourceId)}
                />
                <Button
                  text={state.syncing ? 'Syncing...' : 'Sync Now'}
                  variant="secondary"
                  size="sm"
                  disabled={state.saving || state.syncing}
                  icon={state.syncing ? Loader2 : RefreshCw}
                  iconColor={state.syncing
                    ? 'text-blue-600 dark:text-blue-400 animate-spin'
                    : 'text-blue-600 dark:text-blue-400'}
                  on:click={() => syncSource(source.sourceId)}
                />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
