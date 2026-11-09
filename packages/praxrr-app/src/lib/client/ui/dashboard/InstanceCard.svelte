<script lang="ts">
  import { Activity, GitCompare, HeartPulse, History, RefreshCw } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { DRIFT_STATUS_LABEL, driftStatusVariant } from '$ui/drift/driftStatus.ts';
  import { HEALTH_BAND_LABEL, HEALTH_BAND_TEXT_CLASS, bandVariant } from '$ui/health/healthStatus.ts';
  import { SYNC_HISTORY_STATUS_LABEL, syncHistoryStatusVariant } from '$ui/sync-history/syncHistoryStatus.ts';
  import type { DashboardInstanceCard } from '$shared/dashboard/types.ts';
  import { formatAbsoluteTime, formatRelativeTime } from './dashboardFormat.ts';

  export let instance: DashboardInstanceCard;

  const rowClass =
    '-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700/40';
  const labelClass = 'flex items-center gap-2 text-neutral-600 dark:text-neutral-400';

  $: lastSyncTime = instance.lastSync?.finishedAt ?? instance.lastSync?.startedAt ?? null;
</script>

<!-- Non-link card: each metric is its own link so no interactive element is nested in another. -->
<Card>
  <svelte:fragment slot="header">
    <div class="flex flex-wrap items-center gap-2">
      <a
        href={instance.links.instance}
        class="hover:text-accent-600 dark:hover:text-accent-400 font-semibold text-neutral-900 dark:text-neutral-50"
      >
        {instance.name}
      </a>
      <Badge variant={instance.arrType}>{instance.arrType}</Badge>
      {#if instance.needsAttention}
        <Badge variant="warning">Needs attention</Badge>
      {/if}
    </div>
  </svelte:fragment>

  <div class="space-y-0.5">
    <a href={instance.links.health} class={rowClass}>
      <span class={labelClass}><HeartPulse size={14} aria-hidden="true" /> Health</span>
      {#if instance.health}
        <span class="flex items-center gap-2">
          <span class="font-semibold tabular-nums {HEALTH_BAND_TEXT_CLASS[instance.health.band]}">
            {instance.health.score}
          </span>
          <Badge variant={bandVariant(instance.health.band)}>{HEALTH_BAND_LABEL[instance.health.band]}</Badge>
        </span>
      {:else}
        <span class="text-neutral-500 dark:text-neutral-400">Not scored yet</span>
      {/if}
    </a>

    <a href={instance.links.drift} class={rowClass}>
      <span class={labelClass}><GitCompare size={14} aria-hidden="true" /> Drift</span>
      <span class="flex items-center gap-2">
        {#if instance.drift.changeCount > 0}
          <span class="text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
            {instance.drift.changeCount}
            {instance.drift.changeCount === 1 ? 'change' : 'changes'}
          </span>
        {/if}
        <Badge variant={driftStatusVariant(instance.drift.status)}>{DRIFT_STATUS_LABEL[instance.drift.status]}</Badge>
      </span>
    </a>

    <a href={instance.links.syncHistory} class={rowClass}>
      <span class={labelClass}><History size={14} aria-hidden="true" /> Last sync</span>
      {#if instance.lastSync}
        <span class="flex items-center gap-2">
          <time
            class="text-xs text-neutral-500 dark:text-neutral-400"
            datetime={lastSyncTime ?? undefined}
            title={formatAbsoluteTime(lastSyncTime)}
          >
            {formatRelativeTime(lastSyncTime)}
          </time>
          <Badge variant={syncHistoryStatusVariant(instance.lastSync.status)}>
            {SYNC_HISTORY_STATUS_LABEL[instance.lastSync.status]}
          </Badge>
        </span>
      {:else}
        <span class="text-neutral-500 dark:text-neutral-400">No syncs yet</span>
      {/if}
    </a>
  </div>

  <svelte:fragment slot="footer">
    <div class="flex items-center justify-between gap-2">
      <a
        href={instance.links.previewSync}
        class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors"
      >
        <RefreshCw size={14} aria-hidden="true" />
        Preview sync
      </a>
      <a
        href={instance.links.instance}
        class="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <Activity size={12} aria-hidden="true" />
        Details
      </a>
    </div>
  </svelte:fragment>
</Card>
