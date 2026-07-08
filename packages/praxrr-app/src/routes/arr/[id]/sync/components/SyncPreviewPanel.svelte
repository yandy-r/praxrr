<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import { alertStore } from '$alerts/store.ts';
  import SyncPreviewEntityDiff from './SyncPreviewEntityDiff.svelte';
  import type { SyncPreviewSection, SyncPreviewSummary, SyncPreviewResult, EntityChange } from '$sync/preview/types.ts';
  import type { SectionType } from '$sync/types.ts';

  type SyncPreviewTriggerStatus = 'idle' | 'generating' | 'error' | 'ready';

  type SyncPreviewRouteState = {
    previewId: string | null;
    status: SyncPreviewTriggerStatus;
    summary: SyncPreviewSummary | null;
    error: string | null;
  };

  type StalenessState = {
    ageMs: number;
    shouldWarn: boolean;
    shouldBlock: boolean;
  };

  type SectionGroup = {
    section: SyncPreviewSection;
    title: string;
    entities: readonly EntityChange[];
    actionSummary: {
      total: number;
      create: number;
      update: number;
      delete: number;
      unchanged: number;
    };
  };

  const PREVIEW_STALE_WARNING_MS = 5 * 60 * 1000;
  const PREVIEW_STALE_BLOCK_MS = 30 * 60 * 1000;
  const EMPTY_PREVIEW_SUMMARY: SyncPreviewSummary = {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };

  export let previewState: SyncPreviewRouteState;
  export let instanceName = '';
  export let focusSection: SectionType | null = null;

  let preview: SyncPreviewResult | null = null;
  let loading = false;
  let loadError = '';
  let activePreviewId: string | null = null;
  let sectionGroups: SectionGroup[] = [];
  let summary: SyncPreviewSummary = EMPTY_PREVIEW_SUMMARY;
  let hasDeletes = false;
  let hasApplyPermission = false;

  let stalenessNow = Date.now();
  let staleness: StalenessState | null = null;
  let stalenessText = '';
  let showApplyModal = false;
  let deleteConfirmText = '';
  let applying = false;
  let applyError = '';
  let confirmationMatches = false;

  const sectionLabels: Record<SyncPreviewSection, string> = {
    qualityProfiles: 'Quality Profiles',
    delayProfiles: 'Delay Profiles',
    mediaManagement: 'Media Management',
    metadataProfiles: 'Metadata Profiles',
  };

  onMount(() => {
    const timer = setInterval(() => {
      stalenessNow = Date.now();
    }, 15000);

    return () => {
      clearInterval(timer);
    };
  });

  function evaluateStaleness(createdAt: string, nowMs: number): StalenessState | null {
    const createdMs = Date.parse(createdAt);
    if (Number.isNaN(createdMs)) {
      return null;
    }

    const ageMs = Math.max(0, nowMs - createdMs);
    return {
      ageMs,
      shouldWarn: ageMs >= PREVIEW_STALE_WARNING_MS,
      shouldBlock: ageMs >= PREVIEW_STALE_BLOCK_MS,
    };
  }

  function formatAge(ageMs: number): string {
    const totalSeconds = Math.floor(ageMs / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);

    if (totalMinutes < 1) {
      return `${totalSeconds}s old`;
    }
    if (totalMinutes < 60) {
      return `${totalMinutes}m old`;
    }

    const totalHours = Math.floor(totalMinutes / 60);
    return `${totalHours}h old`;
  }

  function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatSummary(summary: SyncPreviewSummary): string {
    const parts = [
      `${summary.totalCreates} create${summary.totalCreates === 1 ? '' : 's'}`,
      `${summary.totalUpdates} update${summary.totalUpdates === 1 ? '' : 's'}`,
      `${summary.totalDeletes} delete${summary.totalDeletes === 1 ? '' : 's'}`,
      `${summary.totalUnchanged} unchanged`,
    ];
    return parts.join(' · ');
  }

  function countByAction(entities: readonly EntityChange[]) {
    const values = {
      total: entities.length,
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 0,
    };

    for (const entity of entities) {
      switch (entity.action) {
        case 'create':
          values.create++;
          break;
        case 'update':
          values.update++;
          break;
        case 'delete':
          values.delete++;
          break;
        case 'unchanged':
          values.unchanged++;
          break;
      }
    }

    return values;
  }

  function pluralize(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? '' : 's'}`;
  }

  function flattenSectionEntities(
    sectionChanges: readonly EntityChange[] | EntityChange | null
  ): readonly EntityChange[] {
    if (!sectionChanges) return [];
    if (Array.isArray(sectionChanges)) {
      return sectionChanges;
    }
    return [sectionChanges as EntityChange];
  }

  function collectSectionGroups(snapshot: SyncPreviewResult): SectionGroup[] {
    const groups: SectionGroup[] = [];

    if (snapshot.qualityProfiles) {
      const entities = [...snapshot.qualityProfiles.customFormats, ...snapshot.qualityProfiles.qualityProfiles];
      if (entities.length > 0) {
        groups.push({
          section: 'qualityProfiles',
          title: sectionLabels.qualityProfiles,
          entities,
          actionSummary: countByAction(entities),
        });
      }
    }

    if (snapshot.delayProfiles) {
      const entities = flattenSectionEntities(snapshot.delayProfiles.profile);
      if (entities.length > 0) {
        groups.push({
          section: 'delayProfiles',
          title: sectionLabels.delayProfiles,
          entities,
          actionSummary: countByAction(entities),
        });
      }
    }

    if (snapshot.mediaManagement) {
      const entities = [
        ...snapshot.mediaManagement.qualityDefinitions,
        ...flattenSectionEntities(snapshot.mediaManagement.naming),
        ...flattenSectionEntities(snapshot.mediaManagement.mediaSettings),
      ];
      if (entities.length > 0) {
        groups.push({
          section: 'mediaManagement',
          title: sectionLabels.mediaManagement,
          entities,
          actionSummary: countByAction(entities),
        });
      }
    }

    if (snapshot.metadataProfiles) {
      const entities = flattenSectionEntities(snapshot.metadataProfiles.profile);
      if (entities.length > 0) {
        groups.push({
          section: 'metadataProfiles',
          title: sectionLabels.metadataProfiles,
          entities,
          actionSummary: countByAction(entities),
        });
      }
    }

    return groups;
  }

  function getSectionSummaryText(values: SectionGroup['actionSummary']): string {
    return `${pluralize(values.create, 'create')}, ${pluralize(values.update, 'update')}, ${pluralize(values.delete, 'delete')}, ${pluralize(values.unchanged, 'unchanged')}`;
  }

  async function loadPreview(previewId: string) {
    activePreviewId = previewId;
    loading = true;
    loadError = '';

    try {
      const response = await fetch(`/api/v1/sync/preview/${previewId}`);
      const payload = (await response.json().catch(() => null)) as SyncPreviewResult | { error: string } | null;
      if (!response.ok || !payload || !('id' in payload)) {
        loadError =
          payload && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to fetch preview details.';
        preview = null;
        return;
      }

      preview = payload;
    } catch {
      loadError = 'Failed to fetch preview details.';
      preview = null;
    } finally {
      loading = false;
    }
  }

  async function handleApply() {
    if (!preview) return;

    const hasDeletes = preview.summary.totalDeletes > 0;
    if (hasDeletes && deleteConfirmText.trim() !== instanceName) return;

    showApplyModal = false;
    applying = true;
    applyError = '';

    try {
      const response = await fetch(`/api/v1/sync/preview/${preview.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        { success: boolean; error?: string; staleWarning?: string } | { error: string; staleWarning?: string };

      if (!response.ok || !payload || !('success' in payload) || payload.success === false) {
        const message =
          payload && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to apply preview.';
        throw new Error(message);
      }

      if ('staleWarning' in payload && payload.staleWarning) {
        alertStore.add('warning', payload.staleWarning);
      }

      alertStore.add('success', 'Preview applied');
      await invalidateAll();
      await loadPreview(preview.id);
      deleteConfirmText = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply preview.';
      applyError = message;
      alertStore.add('error', message);
    } finally {
      applying = false;
    }
  }

  function openApply() {
    deleteConfirmText = '';
    showApplyModal = true;
  }

  function closeApplyModal() {
    showApplyModal = false;
    deleteConfirmText = '';
  }

  $: summary = preview?.summary ?? previewState.summary ?? EMPTY_PREVIEW_SUMMARY;
  $: stalenessText = staleness ? formatAge(staleness.ageMs) : '';
  $: sectionGroups = (() => {
    if (!preview) return [];
    const groups = collectSectionGroups(preview);
    if (!focusSection) return groups;

    const focusedGroups = groups.filter((group) => group.section === focusSection);
    return focusedGroups.length > 0 ? focusedGroups : groups;
  })();
  $: staleness = preview ? evaluateStaleness(preview.createdAt, stalenessNow) : null;
  $: confirmationMatches = deleteConfirmText.trim() === instanceName.trim();
  $: hasApplyPermission = !!preview && preview.status === 'ready' && !applying && !staleness?.shouldBlock;
  $: hasDeletes = summary.totalDeletes > 0;

  $: if (previewState.status === 'ready' && previewState.previewId) {
    if (previewState.previewId !== activePreviewId) {
      void loadPreview(previewState.previewId);
    }
  } else {
    preview = null;
    loadError = previewState.error ?? '';
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <div class="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
    <div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Sync Preview</h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Review planned sync changes before applying.</p>
      </div>
      <div class="text-xs text-neutral-600 dark:text-neutral-400">
        <span class="font-medium">{formatSummary(summary)}</span>
      </div>
    </div>
  </div>

  <div class="space-y-4 p-4 md:p-6">
    {#if previewState.status === 'idle'}
      <p class="text-sm text-neutral-600 dark:text-neutral-400">
        Generate a preview to see per-entity changes before applying.
      </p>
    {:else if previewState.status === 'error'}
      <div
        class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
      >
        {previewState.error || 'Unable to load preview state'}
      </div>
    {:else if previewState.status === 'generating' || loading}
      <div class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <Loader2 size={16} class="animate-spin text-blue-600 dark:text-blue-400" />
        <span>Preparing preview...</span>
      </div>
    {:else if loadError}
      <div
        class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
      >
        {loadError}
      </div>
    {:else if !preview}
      <p class="text-sm text-neutral-600 dark:text-neutral-400">No preview loaded yet.</p>
    {:else}
      <div class="space-y-4">
        <div class="space-y-2 text-sm">
          <div class="flex flex-wrap items-center gap-3">
            <div>
              <span class="text-neutral-500 dark:text-neutral-400">Instance:</span>
              <span class="ml-1 font-medium text-neutral-900 dark:text-neutral-100">{preview.instanceName}</span>
            </div>
            <div>
              <span class="text-neutral-500 dark:text-neutral-400">Generated:</span>
              <span class="ml-1 text-neutral-900 dark:text-neutral-100">{formatDateTime(preview.createdAt)}</span>
            </div>
            <div>
              <span class="text-neutral-500 dark:text-neutral-400">Arr:</span>
              <span class="ml-1 text-neutral-900 dark:text-neutral-100">{preview.arrType}</span>
            </div>
          </div>

          <div class="font-mono text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
            {stalenessText ? `Preview is ${stalenessText}.` : 'No staleness info yet.'}
          </div>
        </div>

        {#if staleness && staleness.shouldWarn && !staleness.shouldBlock}
          <div
            class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <AlertTriangle size={16} class="mt-0.5" />
            <div>
              <p class="font-medium">Preview is stale.</p>
              <p>This snapshot is older than 5 minutes. Re-generating now is recommended before applying.</p>
            </div>
          </div>
        {/if}

        {#if staleness?.shouldBlock}
          <div
            class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
          >
            <AlertTriangle size={16} class="mt-0.5" />
            <div>
              <p class="font-medium">Preview is too old to apply.</p>
              <p>This preview is over 30 minutes old. Generate a fresh preview before applying.</p>
            </div>
          </div>
        {/if}

        {#if hasDeletes}
          <div
            class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
          >
            <AlertTriangle size={16} class="mt-0.5" />
            <div>
              <p class="font-medium">Destructive changes detected.</p>
              <p>This preview includes delete actions and will use additional confirmation before apply.</p>
            </div>
          </div>
        {/if}

        {#if summary.totalCreates === 0 && summary.totalUpdates === 0 && summary.totalDeletes === 0 && summary.totalUnchanged > 0}
          <div
            class="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
          >
            <CheckCircle2 size={16} class="mt-0.5" />
            <p>All synced entities are already up to date. No changes are planned.</p>
          </div>
        {/if}

        {#if sectionGroups.length === 0}
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {#if focusSection && focusSection === 'metadataProfiles' && !preview?.sections?.length}
              Configure and save metadata profile settings first, then generate a new preview.
            {:else}
              The preview snapshot contains no section-level changes.
            {/if}
          </p>
        {:else}
          <div class="space-y-3">
            {#each sectionGroups as sectionGroup}
              <div
                class="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/40"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="font-semibold text-neutral-900 dark:text-neutral-100">
                    {sectionGroup.title}
                  </h3>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {getSectionSummaryText(sectionGroup.actionSummary)}
                  </div>
                </div>

                <div class="mt-3 space-y-2">
                  {#each sectionGroup.entities as entity}
                    <SyncPreviewEntityDiff {entity} defaultExpanded={entity.action !== 'unchanged'} />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {applyError
              ? `Apply error: ${applyError}`
              : 'Apply will run exactly the selected sync operations from this snapshot.'}
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!hasApplyPermission}
              icon={applying ? Loader2 : CheckCircle2}
              iconColor={applying ? 'text-white animate-spin' : 'text-white'}
              on:click={openApply}
              text={applying ? 'Applying...' : 'Apply Preview'}
            />
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<Modal
  open={showApplyModal}
  header={hasDeletes ? 'Confirm Destructive Preview Apply' : 'Confirm Preview Apply'}
  confirmText={hasDeletes ? 'Apply Deletions' : 'Apply Changes'}
  confirmDanger={hasDeletes}
  confirmDisabled={hasDeletes && !confirmationMatches}
  loading={applying}
  on:confirm={handleApply}
  on:cancel={closeApplyModal}
  size="md"
>
  <div slot="body" class="space-y-3">
    <p class="text-sm text-neutral-600 dark:text-neutral-400">
      You are about to apply the planned changes to <strong>{preview?.instanceName ?? instanceName}</strong>.
    </p>

    <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
      Planned changes: {formatSummary(summary)}
    </p>

    {#if staleness?.shouldWarn}
      <div
        class="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200"
      >
        This preview is {stalenessText}. Re-generate if you need fresher data.
      </div>
    {/if}

    {#if hasDeletes}
      <div class="space-y-2">
        <p class="text-sm text-red-700 dark:text-red-200">
          Destructive deletes are included. To continue, type the instance name exactly:
          <strong class="ml-1">{instanceName || (preview?.instanceName ?? 'instance')}</strong>
        </p>
        <FormInput
          label="Type instance name to confirm"
          name="delete-preview-confirm"
          bind:value={deleteConfirmText}
          required
          disabled={applying}
        />
      </div>
    {/if}
  </div>
</Modal>

<div class="sr-only" aria-live="polite">{stalenessText}</div>
