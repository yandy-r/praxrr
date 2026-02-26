<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { Info, Loader2, RefreshCw, Save } from 'lucide-svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import StickyCard from '$ui/card/StickyCard.svelte';
  import Button from '$ui/button/Button.svelte';
  import QualityProfiles from './components/QualityProfiles.svelte';
  import DelayProfiles from './components/DelayProfiles.svelte';
  import MediaManagement from './components/MediaManagement.svelte';
  import SyncFooter from './components/SyncFooter.svelte';
  import SyncPreviewPanel from './components/SyncPreviewPanel.svelte';
  import Toggle from '$ui/toggle/Toggle.svelte';
  import { alertStore } from '$alerts/store.ts';
  import type { SyncTrigger } from '$db/queries/arrSync.ts';
  import type { SyncPreviewSummary } from '$sync/preview/types.ts';
  import { initEdit, update, clear } from '$lib/client/stores/dirty';
  import { extractFormError } from '$lib/client/utils/extractFormError.ts';

  type SyncPreviewSection = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';

  type SyncSectionActions = {
    saveSection: () => Promise<void>;
    syncSection: () => Promise<void>;
  };

  type SyncPreviewRouteState = {
    previewId: string | null;
    status: 'idle' | 'generating' | 'error' | 'ready';
    summary: SyncPreviewSummary | null;
    error: string | null;
  };

  const EMPTY_PREVIEW_SUMMARY: SyncPreviewSummary = {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };

  export let data: PageData;

  let showInfoModal = false;
  let showPreviewModal = false;
  let previewState: SyncPreviewRouteState = {
    previewId: data.syncPreview.previewId,
    status: data.syncPreview.status,
    summary: data.syncPreview.summary ?? EMPTY_PREVIEW_SUMMARY,
    error: data.syncPreview.error,
  };
  let activePreviewSection: SyncPreviewSection | null = null;
  let isPreviewSectionActioning = false;

  let qualityProfilesSection: SyncSectionActions | null = null;
  let delayProfilesSection: SyncSectionActions | null = null;
  let mediaManagementSection: SyncSectionActions | null = null;

  const metadataProfilesSupported = data.metadataProfilesSupported;

  // Initialize state from loaded sync data
  function buildProfileState(
    selections: { databaseId: number; profileName: string }[]
  ): Record<number, Record<string, boolean>> {
    const state: Record<number, Record<string, boolean>> = {};
    for (const sel of selections) {
      if (!state[sel.databaseId]) {
        state[sel.databaseId] = {};
      }
      state[sel.databaseId][sel.profileName] = true;
    }
    return state;
  }

  let qualityProfileState = buildProfileState(data.syncData.qualityProfiles.selections);
  let qualityProfileTrigger: SyncTrigger = data.syncData.qualityProfiles.config.trigger;
  let qualityProfileCron: string = data.syncData.qualityProfiles.config.cron || '0 * * * *';

  let delayProfileState = {
    databaseId: data.syncData.delayProfiles.databaseId,
    profileName: data.syncData.delayProfiles.profileName,
  };
  let delayProfileTrigger: SyncTrigger = data.syncData.delayProfiles.trigger;
  let delayProfileCron: string = data.syncData.delayProfiles.cron || '0 * * * *';

  let mediaManagementState = {
    namingDatabaseId: data.syncData.mediaManagement.namingDatabaseId,
    namingConfigName: data.syncData.mediaManagement.namingConfigName,
    qualityDefinitionsDatabaseId: data.syncData.mediaManagement.qualityDefinitionsDatabaseId,
    qualityDefinitionsConfigName: data.syncData.mediaManagement.qualityDefinitionsConfigName,
    mediaSettingsDatabaseId: data.syncData.mediaManagement.mediaSettingsDatabaseId,
    mediaSettingsConfigName: data.syncData.mediaManagement.mediaSettingsConfigName,
  };
  let mediaManagementTrigger: SyncTrigger = data.syncData.mediaManagement.trigger;
  let mediaManagementCron: string = data.syncData.mediaManagement.cron || '0 * * * *';

  let metadataProfileState = {
    databaseId: data.syncData.metadataProfiles.databaseId,
    profileName: data.syncData.metadataProfiles.profileName,
  };
  let metadataProfileTrigger: SyncTrigger = data.syncData.metadataProfiles.trigger;
  let metadataProfileCron: string = data.syncData.metadataProfiles.cron || '0 * * * *';
  $: qualityProfilesPreviewConfig = { ...qualityProfileState };
  $: delayProfilesPreviewConfig = { ...delayProfileState };
  $: mediaManagementPreviewConfig = { ...mediaManagementState };
  $: metadataProfilePreviewConfig = { ...metadataProfileState };

  // Track dirty state from each component
  let qualityProfilesDirty = false;
  let delayProfilesDirty = false;
  let mediaManagementDirty = false;
  let metadataProfilesDirty = false;
  let qualityProfilesPreviewEnabled = false;
  let delayProfilesPreviewEnabled = false;
  let mediaManagementPreviewEnabled = false;
  let metadataProfilesPreviewEnabled = false;

  let metadataProfileSaving = false;
  let metadataProfileSyncing = false;
  let metadataProfileSavedState = JSON.stringify({
    state: metadataProfileState,
    trigger: metadataProfileTrigger,
    cronExpression: metadataProfileCron,
  });

  // Initialize dirty tracking on mount
  onMount(() => {
    initEdit({ anyDirty: false });
    return () => clear();
  });

  // Sync combined dirty state to global dirty store for DirtyModal
  $: anyDirty = qualityProfilesDirty || delayProfilesDirty || mediaManagementDirty || metadataProfilesDirty;
  $: update('anyDirty', anyDirty);

  $: metadataProfileSelectionKey =
    metadataProfileState.databaseId !== null && metadataProfileState.profileName
      ? `${metadataProfileState.databaseId}-${metadataProfileState.profileName}`
      : null;
  $: metadataProfileCurrentState = JSON.stringify({
    state: metadataProfileState,
    trigger: metadataProfileTrigger,
    cronExpression: metadataProfileCron,
  });
  $: metadataProfilesDirty = metadataProfilesSupported && metadataProfileCurrentState !== metadataProfileSavedState;
  $: {
    if (!metadataProfileSelectionKey) {
      metadataProfilesPreviewEnabled = false;
    } else if (metadataProfilesDirty) {
      metadataProfilesPreviewEnabled = true;
    } else {
      metadataProfilesPreviewEnabled = data.syncData.metadataProfiles.lastSyncedAt === null;
    }
  }

  // Validation: Quality profiles require both media management AND delay profiles (saved, not dirty)
  $: hasQualityProfilesSelected = Object.values(qualityProfileState).some((db) =>
    Object.values(db).some((selected) => selected)
  );

  $: hasMediaManagement =
    typeof mediaManagementState.namingDatabaseId === 'number' &&
    typeof mediaManagementState.namingConfigName === 'string' &&
    typeof mediaManagementState.qualityDefinitionsDatabaseId === 'number' &&
    typeof mediaManagementState.qualityDefinitionsConfigName === 'string' &&
    typeof mediaManagementState.mediaSettingsDatabaseId === 'number' &&
    typeof mediaManagementState.mediaSettingsConfigName === 'string';

  $: hasDelayProfile =
    typeof delayProfileState.databaseId === 'number' && typeof delayProfileState.profileName === 'string';

  $: qualityProfilesCanSave =
    !hasQualityProfilesSelected ||
    (hasMediaManagement && !mediaManagementDirty && hasDelayProfile && !delayProfilesDirty);

  function isMetadataProfileSelected(databaseId: number, profileName: string): boolean {
    return metadataProfileSelectionKey === `${databaseId}-${profileName}`;
  }

  function setMetadataProfile(databaseId: number, profileName: string, checked: boolean) {
    if (checked) {
      metadataProfileState = { databaseId, profileName };
      return;
    }

    if (isMetadataProfileSelected(databaseId, profileName)) {
      metadataProfileState = { databaseId: null, profileName: null };
    }
  }

  function getSectionActions(): SyncSectionActions | null {
    switch (activePreviewSection) {
      case 'qualityProfiles':
        return qualityProfilesSection;
      case 'delayProfiles':
        return delayProfilesSection;
      case 'mediaManagement':
        return mediaManagementSection;
      case 'metadataProfiles':
        return {
          saveSection: handleMetadataProfileSave,
          syncSection: handleMetadataProfileSync,
        };
      default:
        return null;
    }
  }

  function parsePreviewSummary(value: unknown): SyncPreviewSummary | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = value as Partial<SyncPreviewSummary>;
    if (
      typeof candidate.totalCreates !== 'number' ||
      typeof candidate.totalUpdates !== 'number' ||
      typeof candidate.totalDeletes !== 'number' ||
      typeof candidate.totalUnchanged !== 'number'
    ) {
      return null;
    }

    return {
      totalCreates: candidate.totalCreates,
      totalUpdates: candidate.totalUpdates,
      totalDeletes: candidate.totalDeletes,
      totalUnchanged: candidate.totalUnchanged,
    };
  }

  function handlePreviewGenerated(section: SyncPreviewSection, event: CustomEvent<{ id: string; summary?: unknown }>) {
    previewState = {
      previewId: event.detail.id,
      status: 'ready',
      summary: parsePreviewSummary(event.detail.summary),
      error: null,
    };
    activePreviewSection = section;
    showPreviewModal = true;
  }

  function handlePreviewError(event: CustomEvent<{ message: string }>) {
    alertStore.add('error', event.detail.message);
  }

  async function handlePreviewSave() {
    const actions = getSectionActions();
    if (!actions || isPreviewSectionActioning) return;

    isPreviewSectionActioning = true;
    try {
      await actions.saveSection();
    } finally {
      isPreviewSectionActioning = false;
    }
  }

  async function handlePreviewSaveAndSync() {
    const actions = getSectionActions();
    if (!actions || isPreviewSectionActioning) return;

    isPreviewSectionActioning = true;
    try {
      await actions.saveSection();
      await actions.syncSection();
    } finally {
      isPreviewSectionActioning = false;
    }
  }

  $: canPreviewAction =
    activePreviewSection !== null &&
    getSectionActions() !== null &&
    (activePreviewSection !== 'qualityProfiles' || qualityProfilesCanSave);

  // Build warning message showing all missing requirements
  $: qualityProfilesWarning = (() => {
    if (!hasQualityProfilesSelected) return null;

    const issues: string[] = [];

    if (!hasMediaManagement) {
      issues.push('media management settings (configure above)');
    } else if (mediaManagementDirty) {
      issues.push('media management settings to be saved');
    }

    if (!hasDelayProfile) {
      issues.push('a delay profile (configure below)');
    } else if (delayProfilesDirty) {
      issues.push('delay profile settings to be saved');
    }

    if (issues.length === 0) return null;
    return `Quality profiles require ${issues.join(' and ')}.`;
  })();

  async function handleMetadataProfileSave() {
    if (!metadataProfilesSupported) {
      alertStore.add('error', 'Metadata profile sync is only available for Lidarr instances');
      return;
    }

    metadataProfileSaving = true;
    try {
      const formData = new FormData();
      formData.set('databaseId', metadataProfileState.databaseId?.toString() ?? '');
      formData.set('profileName', metadataProfileState.profileName ?? '');
      formData.set('trigger', metadataProfileTrigger);
      formData.set('cron', metadataProfileCron);

      const response = await fetch('?/saveMetadataProfiles', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        alertStore.add('success', 'Metadata profiles sync config saved');
        metadataProfileSavedState = JSON.stringify({
          state: metadataProfileState,
          trigger: metadataProfileTrigger,
          cronExpression: metadataProfileCron,
        });
        await invalidateAll().catch(() => undefined);
      } else {
        const payload = await extractFormError(response, 'Failed to save metadata profiles sync config');
        alertStore.add('error', payload);
      }
    } catch {
      alertStore.add('error', 'Failed to save metadata profiles sync config');
    } finally {
      metadataProfileSaving = false;
    }
  }

  async function handleMetadataProfileSync() {
    if (!metadataProfilesSupported) {
      alertStore.add('error', 'Metadata profile sync is only available for Lidarr instances');
      return;
    }

    metadataProfileSyncing = true;
    try {
      const response = await fetch('?/syncMetadataProfiles', {
        method: 'POST',
        body: new FormData(),
      });

      if (response.ok) {
        const data = await response.json();
        alertStore.add('success', data?.message ?? 'Sync queued');
        await invalidateAll().catch(() => undefined);
      } else {
        const payload = await extractFormError(response, 'Sync failed');
        alertStore.add('error', payload);
      }
    } catch {
      alertStore.add('error', 'Sync failed');
    } finally {
      metadataProfileSyncing = false;
    }
  }
</script>

<svelte:head>
  <title>{data.instance.name} - Sync - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-6 pb-32">
  <!-- Header -->
  <StickyCard position="top">
    <svelte:fragment slot="left">
      <h1 class="text-neutral-900 dark:text-neutral-50">Sync Configuration</h1>
      <p class="text-neutral-600 dark:text-neutral-400">
        Configure which profiles and settings to sync to this instance.
      </p>
    </svelte:fragment>
    <svelte:fragment slot="right">
      <Button text="How it works" icon={Info} on:click={() => (showInfoModal = true)} />
    </svelte:fragment>
  </StickyCard>

  <MediaManagement
    bind:this={mediaManagementSection}
    databases={data.databases}
    bind:state={mediaManagementState}
    bind:syncTrigger={mediaManagementTrigger}
    bind:cronExpression={mediaManagementCron}
    bind:isDirty={mediaManagementDirty}
    lastSyncedAt={data.syncData.mediaManagement.lastSyncedAt ?? null}
    previewConfig={mediaManagementPreviewConfig}
    previewSection="mediaManagement"
    bind:previewEnabled={mediaManagementPreviewEnabled}
    on:previewGenerated={(event) => handlePreviewGenerated('mediaManagement', event)}
    on:previewError={handlePreviewError}
  />
  <QualityProfiles
    bind:this={qualityProfilesSection}
    databases={data.databases}
    trashGuideSources={data.trashGuideQualityProfilesBySource}
    bind:state={qualityProfileState}
    bind:syncTrigger={qualityProfileTrigger}
    bind:cronExpression={qualityProfileCron}
    bind:isDirty={qualityProfilesDirty}
    canSave={qualityProfilesCanSave}
    warning={qualityProfilesWarning}
    lastSyncedAt={data.syncData.qualityProfiles.config.lastSyncedAt ?? null}
    previewConfig={qualityProfilesPreviewConfig}
    previewSection="qualityProfiles"
    bind:previewEnabled={qualityProfilesPreviewEnabled}
    on:previewGenerated={(event) => handlePreviewGenerated('qualityProfiles', event)}
    on:previewError={handlePreviewError}
  />
  <DelayProfiles
    bind:this={delayProfilesSection}
    databases={data.databases}
    bind:state={delayProfileState}
    bind:syncTrigger={delayProfileTrigger}
    bind:cronExpression={delayProfileCron}
    bind:isDirty={delayProfilesDirty}
    lastSyncedAt={data.syncData.delayProfiles.lastSyncedAt ?? null}
    previewConfig={delayProfilesPreviewConfig}
    previewSection="delayProfiles"
    bind:previewEnabled={delayProfilesPreviewEnabled}
    on:previewGenerated={(event) => handlePreviewGenerated('delayProfiles', event)}
    on:previewError={handlePreviewError}
  />

  {#if metadataProfilesSupported}
    <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Metadata Profiles</h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Select metadata profiles to sync to this instance
        </p>
      </div>

      <div class="p-6">
        {#if data.databases.length === 0}
          <p class="text-sm text-neutral-500 dark:text-neutral-400">No databases configured</p>
        {:else}
          <div class="space-y-6">
            {#each data.databases as database}
              <div class="space-y-3">
                <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  {database.name}
                </h3>

                {#if database.metadataProfiles.length === 0}
                  <p class="text-sm text-neutral-500 dark:text-neutral-400">No metadata profiles</p>
                {:else}
                  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                    {#each database.metadataProfiles as profile}
                      <Toggle
                        checked={isMetadataProfileSelected(database.id, profile.name)}
                        label={profile.name}
                        ariaLabel={`Toggle metadata profile ${profile.name} from ${database.name}`}
                        on:change={(e) => setMetadataProfile(database.id, profile.name, e.detail)}
                      />
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <SyncFooter
        bind:syncTrigger={metadataProfileTrigger}
        bind:cronExpression={metadataProfileCron}
        saving={metadataProfileSaving}
        syncing={metadataProfileSyncing}
        isDirty={metadataProfilesDirty}
        previewConfig={metadataProfilePreviewConfig}
        previewEnabled={metadataProfilesPreviewEnabled}
        previewSection="metadataProfiles"
        on:previewGenerated={(event) => handlePreviewGenerated('metadataProfiles', event)}
        on:previewError={handlePreviewError}
        on:save={handleMetadataProfileSave}
        on:sync={handleMetadataProfileSync}
      />
    </div>
  {/if}
</div>

<InfoModal bind:open={showPreviewModal} header="Sync Preview" maxWidth="min(60vw, 1200px)" maxHeight="60vh">
  <SyncPreviewPanel {previewState} instanceName={data.instance.name} focusSection={activePreviewSection} />

  <div class="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
    <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Quick actions</p>
    <div class="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        text={isPreviewSectionActioning ? 'Saving...' : 'Save changes'}
        disabled={!canPreviewAction || isPreviewSectionActioning}
        icon={isPreviewSectionActioning ? Loader2 : Save}
        iconColor={isPreviewSectionActioning
          ? 'text-neutral-600 dark:text-neutral-400 animate-spin'
          : 'text-neutral-700 dark:text-neutral-300'}
        on:click={handlePreviewSave}
      />
      <Button
        variant="primary"
        text={isPreviewSectionActioning ? 'Saving & syncing...' : 'Save & Sync'}
        disabled={!canPreviewAction || isPreviewSectionActioning}
        icon={isPreviewSectionActioning ? Loader2 : RefreshCw}
        iconColor={isPreviewSectionActioning ? 'text-white animate-spin' : 'text-white'}
        on:click={handlePreviewSaveAndSync}
      />
    </div>
  </div>
</InfoModal>

<InfoModal bind:open={showInfoModal} header="How Sync Works">
  <div class="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Automatic Dependencies</div>
      <p class="mt-1">
        Quality Profiles will automatically sync the custom formats they need - you don't need to select them
        separately.
      </p>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Namespacing</div>
      <p class="mt-1">
        Similarly named items from different databases will include invisible namespaces to ensure they don't override
        each other.
      </p>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Media Management First</div>
      <p class="mt-1">
        Quality profiles require all media management settings (naming, quality definitions, and media settings) to be
        configured and saved first. This ensures your files are named consistently with what the profile expects.
      </p>
    </div>

    <div class="border-t border-neutral-200 pt-4 dark:border-neutral-700">
      <div class="mb-3 font-medium text-neutral-900 dark:text-neutral-100">Sync Methods</div>

      <div class="space-y-3">
        <div>
          <div class="font-medium text-neutral-800 dark:text-neutral-200">Manual</div>
          <p class="mt-0.5">
            You manually click the sync button. Useful for media management settings that rarely get updates.
          </p>
        </div>

        <div>
          <div class="font-medium text-neutral-800 dark:text-neutral-200">Schedule</div>
          <p class="mt-0.5">Syncs on a defined schedule using cron expressions.</p>
        </div>

        <div>
          <div class="font-medium text-neutral-800 dark:text-neutral-200">On Pull</div>
          <p class="mt-0.5">Syncs when the upstream database gets a change (when you pull from remote).</p>
        </div>

        <div>
          <div class="font-medium text-neutral-800 dark:text-neutral-200">On Change</div>
          <p class="mt-0.5">
            Syncs when anything changes - whether you pull from upstream or change something yourself.
          </p>
        </div>
      </div>
    </div>

    <div class="border-t border-neutral-200 pt-4 dark:border-neutral-700">
      <div class="mb-3 font-medium text-neutral-900 dark:text-neutral-100">Cron Expressions</div>
      <p class="mb-3">
        Schedule uses standard cron syntax: <code
          class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800"
          >minute hour day month weekday</code
        >
      </p>
      <div class="space-y-1.5 font-mono text-xs">
        <div class="flex gap-3">
          <code class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">0 * * * *</code>
          <span class="font-sans">Every hour</span>
        </div>
        <div class="flex gap-3">
          <code class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">*/15 * * * *</code>
          <span class="font-sans">Every 15 minutes</span>
        </div>
        <div class="flex gap-3">
          <code class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">0 0 * * *</code>
          <span class="font-sans">Daily at midnight</span>
        </div>
        <div class="flex gap-3">
          <code class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">0 6 * * 1</code>
          <span class="font-sans">Every Monday at 6am</span>
        </div>
      </div>
    </div>
  </div>
</InfoModal>

<DirtyModal />
