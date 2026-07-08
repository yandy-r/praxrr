<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { ArrowLeft, ArrowRight, Loader2, RefreshCw } from 'lucide-svelte';
  import Button from '$ui/button/Button.svelte';
  import SyncPreviewPanel from '../../arr/[id]/sync/components/SyncPreviewPanel.svelte';
  import { alertStore } from '$alerts/store';
  import type { PageData } from './$types';
  import type { SyncPreviewSummary } from '$sync/preview/types.ts';

  export let data: PageData;

  type SyncPreviewTriggerStatus = 'idle' | 'generating' | 'error' | 'ready';

  type SyncPreviewRouteState = {
    previewId: string | null;
    status: SyncPreviewTriggerStatus;
    summary: SyncPreviewSummary | null;
    error: string | null;
  };

  const EMPTY_PREVIEW_SUMMARY: SyncPreviewSummary = {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };

  let previewState: SyncPreviewRouteState = {
    previewId: null,
    status: 'idle',
    summary: null,
    error: null,
  };
  let finishing = false;

  // Generate the initial preview ourselves rather than reusing
  // SyncPreviewTrigger.svelte, which reads $page.params.id — this route has no
  // [id] param, so instanceId is passed explicitly from `data`. Zero selections
  // means there's nothing to preview — skip straight to the empty state below.
  onMount(() => {
    if (data.selectionCount > 0) void generatePreview();
  });

  async function generatePreview() {
    previewState = { previewId: null, status: 'generating', summary: null, error: null };

    try {
      const response = await fetch('/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: data.instanceId, sections: ['qualityProfiles'] }),
      });

      if (response.status === 429) {
        const message = 'Preview busy, retry shortly.';
        previewState = { previewId: null, status: 'error', summary: null, error: message };
        alertStore.add('warning', message);
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        { id: string; summary?: SyncPreviewSummary } | { error: string } | null;

      if (!response.ok || !payload || !('id' in payload)) {
        const message = payload && 'error' in payload && payload.error ? payload.error : 'Failed to generate preview.';
        previewState = { previewId: null, status: 'error', summary: null, error: message };
        alertStore.add('error', message);
        return;
      }

      previewState = {
        previewId: payload.id,
        status: 'ready',
        summary: payload.summary ?? EMPTY_PREVIEW_SUMMARY,
        error: null,
      };
    } catch {
      const message = 'Failed to generate preview.';
      previewState = { previewId: null, status: 'error', summary: null, error: message };
      alertStore.add('error', message);
    }
  }

  async function handleFinish() {
    finishing = true;
    try {
      const response = await fetch('/api/v1/setup/complete', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to complete setup');
      await goto('/setup/done');
    } catch {
      alertStore.add('error', 'Could not complete setup — please try again.');
      finishing = false;
    }
  }
</script>

<svelte:head>
  <title>Preview Sync - Setup - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  {#if data.selectionCount === 0}
    <p class="text-neutral-600 dark:text-neutral-400">
      No profiles selected for <span class="font-medium">{data.instanceName}</span> — there's nothing to sync yet. You can
      finish setup now and add profiles later from the instance's sync page.
    </p>
  {:else}
    <p class="text-neutral-600 dark:text-neutral-400">
      Review the planned quality profile changes for <span class="font-medium">{data.instanceName}</span> before applying.
      You can finish setup with or without syncing now — this preview stays available from the instance's sync page afterward.
    </p>

    <div class="flex justify-end">
      <Button
        variant="secondary"
        size="sm"
        icon={previewState.status === 'generating' ? Loader2 : RefreshCw}
        iconColor={previewState.status === 'generating' ? 'animate-spin' : ''}
        text={previewState.status === 'generating' ? 'Generating…' : 'Refresh preview'}
        disabled={previewState.status === 'generating'}
        on:click={generatePreview}
      />
    </div>

    <SyncPreviewPanel {previewState} instanceName={data.instanceName} focusSection="qualityProfiles" />
  {/if}

  <div class="flex items-center justify-between">
    <Button variant="ghost" size="md" icon={ArrowLeft} text="Back" href="/setup/select-profiles" />
    <Button
      variant="primary"
      size="md"
      icon={ArrowRight}
      iconPosition="right"
      text={finishing ? 'Finishing…' : 'Finish setup'}
      disabled={finishing}
      on:click={handleFinish}
    />
  </div>
</div>
