<script lang="ts">
  import { page } from '$app/stores';
  import { Eye, Loader2 } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import Button from '$ui/button/Button.svelte';
  import type { SyncPreviewResult, SyncPreviewSummary } from '$sync/preview/types.ts';
  import type { SectionType } from '$sync/types.ts';

  type SyncPreviewCreateResponse = SyncPreviewResult | ErrorResponse;

  type ErrorResponse = {
    error?: string;
  };

  function isSyncPreviewSuccessResponse(payload: SyncPreviewCreateResponse | null): payload is SyncPreviewResult {
    return (
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).id === 'string'
    );
  }

  function toErrorMessage(payload: SyncPreviewCreateResponse | null): string {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      // A hard generation failure returns the failed snapshot carrying a typed, safe `failure`.
      const failure = record.failure;
      if (failure && typeof failure === 'object' && typeof (failure as Record<string, unknown>).message === 'string') {
        return (failure as { message: string }).message;
      }
      // 4xx validation errors keep the authored-safe `error` string envelope.
      const candidate = record.error;
      if (typeof candidate === 'string') {
        return candidate;
      }
    }

    return 'Failed to generate preview.';
  }

  export let disabled = false;
  export let sections: readonly SectionType[] = [];
  export let previewConfig: unknown = null;

  const dispatch = createEventDispatcher<{
    previewGenerated: { id: string; summary?: SyncPreviewSummary };
    previewError: { message: string };
  }>();

  const EMPTY_PREVIEW_SUMMARY: SyncPreviewSummary = {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };

  const readOnlyMessage = 'Preview is read-only until you explicitly confirm apply.';

  let generating = false;
  let localError = '';
  let hasPreview = false;
  let currentSummary: SyncPreviewSummary = EMPTY_PREVIEW_SUMMARY;
  let instanceId: number | null = null;

  function parseSummary(value: unknown): SyncPreviewSummary | null {
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

  function parseInstanceId(rawId: string | undefined): number | null {
    if (!rawId) {
      return null;
    }

    const parsed = parseInt(rawId, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
  }

  function formatSummary(summary: SyncPreviewSummary): string {
    return (
      `${summary.totalCreates} create${summary.totalCreates === 1 ? '' : 's'}, ` +
      `${summary.totalUpdates} update${summary.totalUpdates === 1 ? '' : 's'}, ` +
      `${summary.totalDeletes} delete${summary.totalDeletes === 1 ? '' : 's'}, ` +
      `${summary.totalUnchanged} unchanged`
    );
  }

  function buildSectionConfigs(): Record<string, unknown> | null {
    if (!previewConfig || sections.length === 0) {
      return null;
    }

    const sectionConfigs: Record<string, unknown> = {};
    for (const section of sections) {
      sectionConfigs[section] = previewConfig;
    }

    return sectionConfigs;
  }

  $: instanceId = parseInstanceId($page.params.id);
  $: buttonDisabled = disabled || generating;
  $: statusMessage = localError
    ? localError
    : generating
      ? 'Generating preview...'
      : hasPreview
        ? `Preview ready (${formatSummary(currentSummary)}). ${readOnlyMessage}`
        : 'No preview loaded.';

  async function handleCreatePreview() {
    if (!instanceId) {
      localError = 'Unable to generate preview: missing instance id.';
      return;
    }

    generating = true;
    localError = '';
    hasPreview = false;

    try {
      const response = await fetch('/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          ...(sections.length > 0 ? { sections } : {}),
          ...(buildSectionConfigs() ? { sectionConfigs: buildSectionConfigs() } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as SyncPreviewCreateResponse | null;
      if (!response.ok || !isSyncPreviewSuccessResponse(payload)) {
        const message = toErrorMessage(payload);
        localError = message;
        dispatch('previewError', { message });
        return;
      }

      const nextSummary = parseSummary(payload.summary);
      currentSummary = nextSummary ?? EMPTY_PREVIEW_SUMMARY;
      hasPreview = true;
      dispatch('previewGenerated', { id: payload.id, summary: nextSummary ?? undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate preview.';
      localError = message;
      dispatch('previewError', { message });
    } finally {
      generating = false;
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center gap-3">
    <Button
      text="Preview Sync"
      variant="secondary"
      disabled={buttonDisabled}
      icon={generating ? Loader2 : Eye}
      iconColor={generating ? 'text-blue-600 dark:text-blue-400 animate-spin' : 'text-blue-600 dark:text-blue-400'}
      tooltip={statusMessage}
      title={statusMessage}
      on:click={handleCreatePreview}
    />
  </div>
  <p class="sr-only" aria-live="polite">{statusMessage}</p>
</div>
