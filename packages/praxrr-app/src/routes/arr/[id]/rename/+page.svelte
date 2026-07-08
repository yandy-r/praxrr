<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import { alertStore } from '$lib/client/alerts/store';
  import { isDirty, initEdit, update, current, clear } from '$lib/client/stores/dirty';
  import { Info, Save, Play, Settings, History } from 'lucide-svelte';
  import RenameSettings from './components/RenameSettings.svelte';
  import RenameRunHistory from './components/RenameRunHistory.svelte';
  import RenameInfoModal from './components/RenameInfoModal.svelte';
  import DirtyModal from '$lib/client/ui/modal/DirtyModal.svelte';
  import StickyCard from '$ui/card/StickyCard.svelte';
  import Button from '$ui/button/Button.svelte';

  export let data: PageData;
  export let form: ActionData;

  // Initialize dirty tracking on mount (same pattern as sync page)
  onMount(() => {
    const initialFormData = {
      enabled: data.settings?.enabled ?? false,
      dryRun: data.settings?.dryRun ?? true,
      renameFolders: data.settings?.renameFolders ?? false,
      ignoreTag: data.settings?.ignoreTag ?? '',
      schedule: String(data.settings?.schedule ?? 1440),
      summaryNotifications: data.settings?.summaryNotifications ?? true,
    };
    // Always use initEdit - isDirty should be false until user makes changes
    initEdit(initialFormData);
    return () => clear();
  });

  $: isNewConfig = !data.settings;

  let showInfoModal = false;
  let saving = false;
  let running = false;

  $: enabled = ($current.enabled ?? false) as boolean;
  $: dryRun = ($current.dryRun ?? true) as boolean;
  $: renameFolders = ($current.renameFolders ?? false) as boolean;
  $: ignoreTag = ($current.ignoreTag ?? '') as string;
  $: schedule = ($current.schedule ?? '1440') as string;
  $: summaryNotifications = ($current.summaryNotifications ?? true) as boolean;

  let lastFormId: unknown = null;
  $: if (form && form !== lastFormId) {
    lastFormId = form;
    if (form.success && !form.queued) {
      alertStore.add('success', 'Configuration saved successfully');
      initEdit({ enabled, dryRun, renameFolders, ignoreTag, schedule, summaryNotifications });
    }
    if (form.success && form.queued) {
      alertStore.add('success', 'Rename run queued');
      if (form.warning) {
        alertStore.add('warning', form.warning);
      }
    }
    if (form.error) {
      alertStore.add('error', form.error);
    }
  }
</script>

<svelte:head>
  <title>{data.instance.name} - Rename - Praxrr</title>
</svelte:head>

<StickyCard position="top">
  <div slot="left">
    <h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Rename</h1>
    <p class="text-sm text-neutral-500 dark:text-neutral-400">
      Automatically rename files and folders to match your naming format.
    </p>
  </div>
  <div slot="right" class="flex items-center gap-2">
    <Button text="How it works" icon={Info} on:click={() => (showInfoModal = true)} />
    {#if !isNewConfig && data.settings?.dryRun}
      <Button
        text={running ? 'Running...' : 'Test Run'}
        icon={Play}
        iconColor="text-amber-600 dark:text-amber-400"
        disabled={running || saving || $isDirty}
        on:click={() => {
          const runForm = document.getElementById('run-form');
          if (runForm instanceof HTMLFormElement) {
            runForm.requestSubmit();
          }
        }}
      />
    {/if}
    <Button
      text={saving ? 'Saving...' : 'Save'}
      icon={Save}
      iconColor="text-blue-600 dark:text-blue-400"
      disabled={saving || running || !$isDirty}
      on:click={() => {
        const saveForm = document.getElementById('save-form');
        if (saveForm instanceof HTMLFormElement) {
          saveForm.requestSubmit();
        }
      }}
    />
  </div>
</StickyCard>

<div class="mt-6 space-y-6">
  <section>
    <h2 class="mb-3 flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
      <Settings size={18} class="text-neutral-500 dark:text-neutral-400" />
      Settings
    </h2>
    <RenameSettings
      {enabled}
      {dryRun}
      {renameFolders}
      {ignoreTag}
      {schedule}
      {summaryNotifications}
      lastRunAt={data.settings?.lastRunAt ?? null}
      onEnabledChange={(v) => update('enabled', v)}
      onDryRunChange={(v) => update('dryRun', v)}
      onRenameFoldersChange={(v) => update('renameFolders', v)}
      onIgnoreTagChange={(v) => update('ignoreTag', v)}
      onScheduleChange={(v) => update('schedule', v)}
      onSummaryNotificationsChange={(v) => update('summaryNotifications', v)}
    />
  </section>
</div>

<section class="mt-6">
  <h2 class="mb-3 flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
    <History size={18} class="text-neutral-500 dark:text-neutral-400" />
    Run History
  </h2>
  <RenameRunHistory runs={data.renameRuns} />
</section>

<!-- Hidden forms -->
<form
  id="save-form"
  method="POST"
  action={isNewConfig ? '?/save' : '?/update'}
  class="hidden"
  use:enhance={() => {
    saving = true;
    return async ({ update }) => {
      await update({ reset: false });
      saving = false;
    };
  }}
>
  <input type="hidden" name="enabled" value={enabled} />
  <input type="hidden" name="dryRun" value={dryRun} />
  <input type="hidden" name="renameFolders" value={renameFolders} />
  <input type="hidden" name="ignoreTag" value={ignoreTag} />
  <input type="hidden" name="schedule" value={schedule} />
  <input type="hidden" name="summaryNotifications" value={summaryNotifications} />
</form>
{#if !isNewConfig}
  <form
    id="run-form"
    method="POST"
    action="?/run"
    class="hidden"
    use:enhance={() => {
      running = true;
      return async ({ update }) => {
        await update({ reset: false });
        running = false;
      };
    }}
  ></form>
{/if}

<RenameInfoModal bind:open={showInfoModal} />
<DirtyModal />
