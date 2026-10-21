<script lang="ts">
  import type { Column } from '$lib/client/ui/table/types';
  import Table from '$lib/client/ui/table/Table.svelte';
  import Badge from '$lib/client/ui/badge/Badge.svelte';
  import { Activity, Loader2 } from 'lucide-svelte';
  import { parseUTC } from '$shared/utils/dates';

  type ActiveJob = {
    id: number;
    jobType: string;
    displayName: string;
    status: string;
    source: string;
    runAt: string;
    startedAt: string | null;
    attempts: number;
  };

  export let jobs: ActiveJob[];

  const columns: Column<ActiveJob>[] = [
    { key: 'displayName', header: 'Job' },
    { key: 'status', header: 'Status', width: 'w-28' },
    { key: 'source', header: 'Source', width: 'w-28' },
    { key: 'startedAt', header: 'Started/Run at' },
  ];

  const SOURCE_LABELS: Record<string, string> = {
    manual: 'Manual',
    schedule: 'Scheduled',
    system: 'System',
  };

  function formatSource(source: string): string {
    return SOURCE_LABELS[source] ?? source;
  }

  // Get relative time (e.g., "in 5s", "2m ago")
  function getRelativeTime(dateStr: string | null): string {
    const date = parseUTC(dateStr);
    if (!date) return '-';

    const diff = date.getTime() - Date.now();
    const isPast = diff < 0;
    const seconds = Math.floor(Math.abs(diff) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return isPast ? `${days}d ago` : `in ${days}d`;
    if (hours > 0) return isPast ? `${hours}h ago` : `in ${hours}h`;
    if (minutes > 0) return isPast ? `${minutes}m ago` : `in ${minutes}m`;
    return isPast ? `${seconds}s ago` : `in ${seconds}s`;
  }
</script>

<div class="mb-8 space-y-4">
  <div class="flex items-center gap-2">
    <Activity size={18} class="text-neutral-600 dark:text-neutral-400" />
    <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Active jobs</h2>
  </div>

  <Table {columns} data={jobs} emptyMessage="No jobs are queued or running" hoverable={false} compact responsive>
    <svelte:fragment slot="cell" let:row let:column>
      {#if column.key === 'displayName'}
        <span class="text-xs font-medium">{row.displayName}</span>
      {:else if column.key === 'status'}
        {#if row.status === 'running'}
          <Badge variant="accent">
            <Loader2 size={10} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Running
          </Badge>
        {:else if row.status === 'queued'}
          <Badge variant="neutral">Queued</Badge>
        {:else}
          <Badge variant="neutral">{row.status}</Badge>
        {/if}
      {:else if column.key === 'source'}
        <span class="text-xs text-neutral-600 dark:text-neutral-400">{formatSource(row.source)}</span>
      {:else if column.key === 'startedAt'}
        <Badge variant="neutral" mono>{getRelativeTime(row.startedAt ?? row.runAt)}</Badge>
      {/if}
    </svelte:fragment>
  </Table>
</div>
