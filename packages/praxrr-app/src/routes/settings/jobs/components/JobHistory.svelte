<script lang="ts">
  import type { Column } from '$lib/client/ui/table/types';
  import ExpandableTable from '$lib/client/ui/table/ExpandableTable.svelte';
  import Badge from '$lib/client/ui/badge/Badge.svelte';
  import Toggle from '$lib/client/ui/toggle/Toggle.svelte';
  import { CheckCircle, XCircle, Clock, MinusCircle, AlertTriangle } from 'lucide-svelte';
  import { parseUTC } from '$shared/utils/dates';
  import type { SafeJobEvidence } from '$shared/jobs/evidence';

  type JobRun = {
    id: number;
    jobName: string;
    displayName?: string;
    status: 'success' | 'failure' | 'skipped' | 'cancelled';
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error: string | null;
    output: string | null;
    // Structured safe evidence (issue #237); null for legacy rows written before the contract.
    evidence: SafeJobEvidence | null;
  };

  export let jobRuns: JobRun[];

  // Filter state - hide skipped by default
  let showSkipped = false;

  let expandedIds: Set<number> = new Set();

  // Filtered runs based on toggle
  $: filteredRuns = showSkipped ? jobRuns : jobRuns.filter((run) => run.status !== 'skipped');

  // Count of hidden skipped runs
  $: skippedCount = jobRuns.filter((run) => run.status === 'skipped').length;

  const columns: Column<JobRun>[] = [
    { key: 'jobName', header: 'Job', sortable: true },
    { key: 'status', header: 'Status', sortable: true, width: 'w-28' },
    { key: 'startedAt', header: 'Started', sortable: true },
    { key: 'durationMs', header: 'Duration', sortable: true, width: 'w-28' },
    { key: 'summary', header: 'Summary' },
  ];

  // Format duration in ms to human readable
  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  // Format job name: arr.sync -> Arr Sync
  function formatJobName(name: string): string {
    return name
      .replace(/\./g, ' ')
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Get relative time (e.g., "5m ago", "2h ago")
  function getRelativeTime(dateStr: string): string {
    const date = parseUTC(dateStr);
    if (!date) return '-';

    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  // Collapsed-row one-line preview. For evidence rows this is the validated failure message
  // or output/decision; for legacy rows it's the raw free-form text (clearly muted).
  function previewText(run: JobRun): string {
    if (run.evidence) {
      return run.evidence.failure?.message ?? run.evidence.output ?? run.evidence.decision ?? '-';
    }
    return run.error ?? run.output ?? '-';
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <Clock size={18} class="text-neutral-600 dark:text-neutral-400" />
      <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Recent Job Runs</h2>
    </div>

    {#if skippedCount > 0}
      <div class="flex items-center gap-2">
        <span class="text-sm text-neutral-500 dark:text-neutral-400">
          {skippedCount} skipped
        </span>
        <Toggle bind:checked={showSkipped} label="Show skipped runs" />
      </div>
    {/if}
  </div>

  <ExpandableTable
    {columns}
    data={filteredRuns}
    getRowId={(run) => run.id}
    bind:expandedRows={expandedIds}
    chevronPosition="right"
    flushExpanded={true}
    emptyMessage="No job runs yet"
    compact
    responsive
  >
    <svelte:fragment slot="cell" let:row let:column>
      {#if column.key === 'jobName'}
        <span class="text-xs font-medium">{row.displayName ?? formatJobName(row.jobName)}</span>
      {:else if column.key === 'status'}
        {#if row.status === 'success'}
          <Badge variant="success" icon={CheckCircle}>Success</Badge>
        {:else if row.status === 'skipped'}
          <Badge variant="neutral" icon={MinusCircle}>Skipped</Badge>
        {:else if row.status === 'cancelled'}
          <Badge variant="neutral" icon={MinusCircle}>Cancelled</Badge>
        {:else}
          <Badge variant="danger" icon={XCircle}>Failed</Badge>
        {/if}
      {:else if column.key === 'startedAt'}
        <Badge variant="neutral" mono>{getRelativeTime(row.startedAt)}</Badge>
      {:else if column.key === 'durationMs'}
        <Badge variant="neutral" mono>{formatDuration(row.durationMs)}</Badge>
      {:else if column.key === 'summary'}
        <span
          class="line-clamp-1 font-mono text-xs {row.status === 'failure'
            ? 'text-red-600 dark:text-red-400'
            : 'text-neutral-600 dark:text-neutral-400'}"
        >
          {previewText(row)}
        </span>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="expanded" let:row>
      <div class="space-y-3 p-6">
        {#if row.evidence}
          {#if row.evidence.target}
            <div class="flex">
              <span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">Target</span>
              <span class="text-sm break-words text-neutral-900 dark:text-neutral-100">{row.evidence.target}</span>
            </div>
          {/if}

          {#if row.evidence.decision}
            <div class="flex">
              <span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">Decision</span>
              <span class="text-sm break-words text-neutral-900 dark:text-neutral-100">{row.evidence.decision}</span>
            </div>
          {/if}

          {#if row.evidence.output}
            <div class="flex">
              <span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">Output</span>
              <span class="font-mono text-xs break-all whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                {row.evidence.output}
              </span>
            </div>
          {/if}

          {#if row.evidence.failure}
            <div class="flex">
              <span class="w-24 shrink-0 text-sm font-medium text-red-600 dark:text-red-400">Failure</span>
              <span class="text-sm break-words text-neutral-900 dark:text-neutral-100">
                {row.evidence.failure.message}
                <span class="ml-1 font-mono text-xs text-neutral-500 dark:text-neutral-400"
                  >({row.evidence.failure.code})</span
                >
              </span>
            </div>
          {/if}

          {#if row.evidence.recovery}
            <div class="flex">
              <span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">Recovery</span>
              <span class="text-sm break-words text-neutral-700 dark:text-neutral-300">{row.evidence.recovery}</span>
            </div>
          {/if}

          {#if !row.evidence.target && !row.evidence.decision && !row.evidence.output && !row.evidence.failure}
            <span class="text-sm text-neutral-500 dark:text-neutral-400">No additional evidence for this run.</span>
          {/if}
        {:else}
          <div
            class="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          >
            <AlertTriangle size={14} />
            <span>Legacy run — structured evidence was not captured for this run.</span>
          </div>

          {#if row.error || row.output}
            <div>
              <div class="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Unvalidated legacy output
              </div>
              <pre
                class="font-mono text-xs break-all whitespace-pre-wrap {row.error
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-neutral-700 dark:text-neutral-300'}">{row.error ?? row.output}</pre>
            </div>
          {/if}
        {/if}
      </div>
    </svelte:fragment>
  </ExpandableTable>
</div>
