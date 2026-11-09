<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { SYNC_HISTORY_STATUS_LABEL, syncHistoryStatusVariant } from '$ui/sync-history/syncHistoryStatus.ts';
  import { CANARY_ROLLOUT_STATUS_LABEL, canaryRolloutStatusVariant } from '$ui/canary/canaryStatus.ts';
  import { SHIELD_BAND_LABEL, SHIELD_BAND_TEXT_CLASS, bandVariant } from '$ui/security/shieldStatus.ts';
  import type { HomeDashboardData } from '$shared/dashboard/types.ts';
  import { formatAbsoluteTime, formatRelativeTime, isDegraded } from './dashboardFormat.ts';

  export let data: HomeDashboardData;

  const linkRow =
    '-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700/40';
  const headingClass =
    'mb-2 flex items-center justify-between text-sm font-semibold text-neutral-900 dark:text-neutral-100';
  $: recentDegraded = isDegraded(data, 'recentSyncs');
  $: canaryDegraded = isDegraded(data, 'canary');
  $: conflictsDegraded = isDegraded(data, 'conflicts');

  const mutedClass = 'text-sm text-neutral-500 dark:text-neutral-400';
</script>

<div class="space-y-4">
  <!-- Recent syncs -->
  <Card>
    <h2 class={headingClass}>
      Recent syncs
      <a href="/sync-history" class="text-xs font-medium text-neutral-500 hover:underline dark:text-neutral-400">
        View all
      </a>
    </h2>
    {#if data.recentSyncs.length === 0}
      <p class={mutedClass}>{recentDegraded ? 'Unavailable right now.' : 'No syncs have run yet.'}</p>
    {:else}
      <ul>
        {#each data.recentSyncs as sync (sync.historyId)}
          <li>
            <a href={sync.href} class={linkRow}>
              <span class="min-w-0">
                <span class="block truncate font-medium text-neutral-800 dark:text-neutral-200">
                  {sync.instanceName}
                </span>
                <time
                  class="text-xs text-neutral-500 dark:text-neutral-400"
                  datetime={sync.startedAt}
                  title={formatAbsoluteTime(sync.startedAt)}
                >
                  {formatRelativeTime(sync.finishedAt ?? sync.startedAt)}
                </time>
              </span>
              <Badge variant={syncHistoryStatusVariant(sync.status)}>{SYNC_HISTORY_STATUS_LABEL[sync.status]}</Badge>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <!-- Active canary rollouts -->
  <Card>
    <h2 class={headingClass}>Active canary rollouts</h2>
    {#if data.canary.length === 0}
      <p class={mutedClass}>{canaryDegraded ? 'Unavailable right now.' : 'No rollouts in progress.'}</p>
    {:else}
      <ul>
        {#each data.canary as rollout (rollout.id)}
          <li>
            <a href={rollout.href} class={linkRow}>
              <span class="min-w-0">
                <span class="block truncate font-medium text-neutral-800 dark:text-neutral-200">
                  {rollout.canaryInstanceName}
                </span>
                <span class="text-xs text-neutral-500 capitalize dark:text-neutral-400">
                  {rollout.arrType} · {formatRelativeTime(rollout.startedAt)}
                </span>
              </span>
              <Badge variant={canaryRolloutStatusVariant(rollout.status)}>
                {CANARY_ROLLOUT_STATUS_LABEL[rollout.status]}
              </Badge>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <!-- Conflicts by database -->
  <Card>
    <h2 class={headingClass}>Conflicts by database</h2>
    {#if data.conflicts.databases.length === 0}
      <p class={mutedClass}>
        {conflictsDegraded ? 'Unavailable right now.' : 'No conflicts. Your databases are clean.'}
      </p>
    {:else}
      <ul>
        {#each data.conflicts.databases as db (db.databaseId)}
          <li>
            <a href={db.href} class={linkRow}>
              <span class="truncate font-medium text-neutral-800 dark:text-neutral-200">{db.databaseName}</span>
              <span class="flex items-center gap-1">
                <Badge variant="warning">{db.count}</Badge>
                <ChevronRight size={14} class="text-neutral-400" aria-hidden="true" />
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <!-- Security posture -->
  <Card>
    <h2 class={headingClass}>Security posture</h2>
    {#if data.security}
      <a href="/security-posture" class={linkRow}>
        <span class="flex items-baseline gap-2">
          <span class="text-2xl font-bold tabular-nums {SHIELD_BAND_TEXT_CLASS[data.security.band]}">
            {data.security.score}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">/ 100</span>
        </span>
        <Badge variant={bandVariant(data.security.band)}>{SHIELD_BAND_LABEL[data.security.band]}</Badge>
      </a>
    {:else}
      <p class={mutedClass}>
        Unavailable right now. <a href="/security-posture" class="underline">Open Security Posture</a>
      </p>
    {/if}
  </Card>

  <!-- Parser status -->
  <div id="parser-status" class="scroll-mt-20">
    <Card>
      <h2 class={headingClass}>
        Parser
        <Badge variant={data.parser.available ? 'success' : 'warning'}>
          {data.parser.available ? 'Available' : 'Unavailable'}
        </Badge>
      </h2>
      <p class={mutedClass}>
        {data.parser.available
          ? 'Custom format and quality profile testing is ready.'
          : 'Custom format and quality profile testing needs the parser service. Everything else keeps working.'}
      </p>
    </Card>
  </div>
</div>
