<script lang="ts">
  import { RefreshCw, ExternalLink } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import { alertStore } from '$alerts/store';
  import { page } from '$app/stores';

  // Minimal client-safe mirror of the server `TrashGuideSyncStatusView` / evidence contract (#238).
  interface RunCounts {
    commitsBehind: number;
    parsedFiles: number;
    failedFiles: number;
    activeOperations: number;
    removedEntities: number;
    renamedEntities: number;
  }
  interface RunEvidence {
    runToken: string | null;
    status: 'success' | 'failure' | 'skipped' | 'cancelled';
    counts: RunCounts | null;
    failure: { code: string; message: string; recoveryAction: string } | null;
    retry: { rescheduleAt: string | null; retryable: boolean };
  }
  interface StatusView {
    sourceId: number;
    sourceName: string | null;
    queueId: number | null;
    current: { status: string; runAt: string; startedAt: string | null; runToken: string | null } | null;
    latestRun: { id: number; status: string; finishedAt: string; evidence: RunEvidence | null } | null;
  }

  $: source = $page.data.source;

  let syncing = false;
  let runToken: string | null = null;
  let statusUrl: string | null = null;
  let runView: StatusView | null = null;
  let polling = false;

  const ACTIVE_STATUSES = new Set(['queued', 'running']);

  $: terminalEvidence =
    runView?.latestRun?.evidence && runView.latestRun.evidence.runToken === runToken
      ? runView.latestRun.evidence
      : null;
  $: inFlight = !!runView?.current && ACTIVE_STATUSES.has(runView.current.status) && !terminalEvidence;

  async function handleSync() {
    if (!source || syncing) return;
    syncing = true;
    try {
      const res = await fetch(`/api/v1/trash-guide/sources/${source.id}/sync`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // `|| null` so an uncorrelatable legacy run (empty token) is treated as null, not a sentinel ''.
        runToken = data.runToken || null;
        statusUrl = data.statusUrl ?? `/api/v1/trash-guide/sources/${source.id}/sync`;
        runView = data.view ?? null;
        alertStore.add('success', 'Sync job queued');
        void pollStatus();
      } else if (res.status === 409) {
        // Dedupe: link to the already-running run rather than acking a new one.
        runToken = data.runToken || null;
        statusUrl = data.statusUrl ?? `/api/v1/trash-guide/sources/${source.id}/sync`;
        runView = data.view ?? null;
        alertStore.add('warning', 'Sync is already running — following the current run');
        void pollStatus();
      } else {
        alertStore.add('error', data.error || 'Failed to queue sync');
      }
    } catch {
      alertStore.add('error', 'Failed to connect');
    } finally {
      syncing = false;
    }
  }

  async function pollStatus() {
    if (!statusUrl || polling) return;
    polling = true;
    try {
      // Poll until the run this request initiated reaches its terminal evidence (matched by runToken),
      // or the queue slot is no longer active. No timestamp matching — correlation is the runToken.
      let settled = false;
      for (let i = 0; i < 150; i++) {
        const res = await fetch(statusUrl);
        if (!res.ok) break;
        runView = (await res.json()) as StatusView;
        const done = runView.latestRun?.evidence?.runToken === runToken;
        const active = !!runView.current && ACTIVE_STATUSES.has(runView.current.status);
        if (done || !active) {
          settled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      // Long run exceeded the poll window while still active — tell the operator rather than freeze silently.
      if (!settled && runView?.current && ACTIVE_STATUSES.has(runView.current.status)) {
        alertStore.add('info', 'Sync is still running — reload the page to see the final result.');
      }
    } catch {
      // Transient poll error — leave the last known view in place.
    } finally {
      polling = false;
    }
  }

  function runStatusVariant(status: string | undefined): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
    switch (status) {
      case 'success':
        return 'success';
      case 'failure':
      case 'cancelled':
        return 'danger';
      case 'skipped':
        return 'warning';
      case 'running':
      case 'queued':
        return 'info';
      default:
        return 'neutral';
    }
  }

  function runStatusLabel(): string {
    if (terminalEvidence) {
      switch (terminalEvidence.status) {
        case 'success':
          return 'Completed';
        case 'failure':
          return 'Failed';
        case 'skipped':
          return 'Skipped';
        case 'cancelled':
          return 'Cancelled';
      }
    }
    if (runView?.current?.status === 'running') return 'Running';
    if (runView?.current?.status === 'queued') return 'Queued';
    return 'Unknown';
  }

  function appliedCount(counts: RunCounts): number {
    return counts.activeOperations + counts.removedEntities + counts.renamedEntities;
  }

  function formatSyncStrategy(minutes: number): string {
    if (minutes === 0) return 'Manual';
    if (minutes < 60) return `Every ${minutes} min`;
    if (minutes === 60) return 'Every hour';
    if (minutes < 1440) return `Every ${minutes / 60} hours`;
    return `Every ${minutes / 1440} days`;
  }

  function formatDate(date: string | null): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>{source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

{#if source}
  <div class="mt-6 space-y-6">
    <!-- Header row -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Overview</h2>
        <Badge variant={source.arrType === 'radarr' ? 'radarr' : 'sonarr'}>
          {source.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
        </Badge>
        {#if source.enabled}
          <Badge variant="success">Enabled</Badge>
        {:else}
          <Badge variant="neutral">Disabled</Badge>
        {/if}
      </div>
      <Button
        text={syncing ? 'Syncing...' : 'Sync Now'}
        icon={RefreshCw}
        variant="primary"
        disabled={syncing}
        on:click={handleSync}
      />
    </div>

    {#if runView && (inFlight || terminalEvidence)}
      <!-- Run evidence panel: correlates this manual request to its exact run (#238). -->
      <div class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Sync Run</span>
            <Badge variant={runStatusVariant(terminalEvidence?.status ?? runView.current?.status)} size="sm">
              {runStatusLabel()}
            </Badge>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{runView.sourceName ?? source.name}</span>
          </div>
          {#if inFlight}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">Following the run…</span>
          {/if}
        </div>

        {#if terminalEvidence}
          {#if terminalEvidence.counts}
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div class="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                  {terminalEvidence.counts.parsedFiles}
                </div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400">Files fetched</div>
              </div>
              <div>
                <div class="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                  {appliedCount(terminalEvidence.counts)}
                </div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400">Changes applied</div>
              </div>
              <div>
                <div class="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                  {terminalEvidence.counts.commitsBehind}
                </div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400">Commits behind</div>
              </div>
            </div>
          {/if}

          {#if terminalEvidence.failure}
            <div
              class="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/60 dark:bg-red-950/40"
            >
              <p class="font-medium text-red-700 dark:text-red-300">{terminalEvidence.failure.message}</p>
              <p class="mt-1 text-red-600 dark:text-red-400">{terminalEvidence.failure.recoveryAction}</p>
              {#if terminalEvidence.retry.rescheduleAt}
                <p class="mt-1 text-xs text-red-500 dark:text-red-400">
                  Automatic retry: {formatDate(terminalEvidence.retry.rescheduleAt)}
                </p>
              {/if}
              {#if terminalEvidence.retry.retryable}
                <div class="mt-2">
                  <Button text="Retry sync" size="xs" variant="secondary" disabled={syncing} on:click={handleSync} />
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Entity counts grid -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <a
        href="/databases/trash/{source.id}/custom-formats"
        class="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-50/5"
      >
        <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {source.entityCounts.customFormats}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">Custom Formats</div>
      </a>
      <a
        href="/databases/trash/{source.id}/quality-profiles"
        class="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-50/5"
      >
        <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {source.entityCounts.qualityProfiles}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">Quality Profiles</div>
      </a>
      <a
        href="/databases/trash/{source.id}/quality-sizes"
        class="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-50/5"
      >
        <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {source.entityCounts.qualitySizes}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">Quality Sizes</div>
      </a>
      <a
        href="/databases/trash/{source.id}/naming"
        class="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-50/5"
      >
        <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {source.entityCounts.naming}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">Naming</div>
      </a>
    </div>

    <!-- Source info -->
    <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="divide-y divide-neutral-200 dark:divide-neutral-800">
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Repository</span>
          <a
            href={source.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {source.repositoryUrl.replace('https://github.com/', '')}
            <ExternalLink size={12} />
          </a>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Branch</span>
          <span class="text-sm text-neutral-900 dark:text-neutral-50">
            {source.branch}
          </span>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400"> Score Profile </span>
          <span class="text-sm text-neutral-900 dark:text-neutral-50">
            {source.scoreProfile}
          </span>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400"> Sync Strategy </span>
          <span class="text-sm text-neutral-900 dark:text-neutral-50">
            {formatSyncStrategy(source.syncStrategy)}
          </span>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Last Synced</span>
          <span class="text-sm text-neutral-900 dark:text-neutral-50">
            {formatDate(source.lastSyncedAt)}
          </span>
        </div>
        {#if source.lastCommitHash}
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-neutral-500 dark:text-neutral-400"> Last Commit </span>
            <Badge variant="neutral" mono>
              {source.lastCommitHash.substring(0, 8)}
            </Badge>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
