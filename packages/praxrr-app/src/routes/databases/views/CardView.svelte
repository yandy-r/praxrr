<script lang="ts">
  import { ExternalLink, Unlink, Lock, Code, AlertTriangle } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { parseUTC } from '$shared/utils/dates';
  import { createEventDispatcher } from 'svelte';
  import DatabaseAvatar from '../components/DatabaseAvatar.svelte';
  import type { UnifiedDatabaseItem } from '../types';

  export let items: UnifiedDatabaseItem[];
  const dispatch = createEventDispatcher<{
    unlink: UnifiedDatabaseItem;
  }>();

  function formatSyncStrategy(minutes: number): string {
    if (minutes === 0) return 'Manual';
    if (minutes < 60) return `Every ${minutes} min`;
    if (minutes === 60) return 'Hourly';
    if (minutes < 1440) return `Every ${minutes / 60}h`;
    return `Every ${minutes / 1440}d`;
  }

  function formatLastSynced(date: string | null): string {
    const d = parseUTC(date);
    if (!d) return 'Never';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function getItemHref(item: UnifiedDatabaseItem): string {
    return item.type === 'trash' ? `/databases/trash/${item.id}` : `/databases/${item.id}`;
  }

  function handleUnlinkClick(e: MouseEvent, item: UnifiedDatabaseItem) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('unlink', item);
  }

  function handleExternalClick(e: MouseEvent, url: string) {
    e.stopPropagation();
    e.preventDefault();
    window.open(url, '_blank');
  }

  type UnifiedTrashDatabaseItem = Extract<UnifiedDatabaseItem, { type: 'trash' }>;

  function formatEntityCount(item: UnifiedTrashDatabaseItem): string {
    if (!item.entityCounts) return '';
    const parts: string[] = [];
    if (item.entityCounts.customFormats > 0) parts.push(`${item.entityCounts.customFormats} CF`);
    if (item.entityCounts.qualityProfiles > 0) parts.push(`${item.entityCounts.qualityProfiles} QP`);
    if (item.entityCounts.qualitySizes > 0) parts.push(`${item.entityCounts.qualitySizes} QS`);
    if (item.entityCounts.naming > 0) parts.push(`${item.entityCounts.naming} Naming`);
    return parts.join(', ');
  }
</script>

<div class="grid grid-cols-1 gap-3">
  {#each items as item}
    <a
      href={getItemHref(item)}
      class="group cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
    >
      <!-- Top row: Avatar, Name, Action buttons -->
      <div class="flex items-center gap-3">
        <DatabaseAvatar name={item.name} repoUrl={item.repositoryUrl} size="md" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate font-medium text-neutral-900 dark:text-neutral-100">
              {item.name}
            </span>
            {#if item.type === 'trash'}
              <Badge variant="accent" size="sm">TRaSH</Badge>
              {#if item.arrType}
                <Badge variant={item.arrType === 'radarr' ? 'radarr' : 'sonarr'} size="sm">
                  {item.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
                </Badge>
              {/if}
            {:else}
              {#if item.isPrivate}
                <Lock size={14} class="flex-shrink-0 text-neutral-400" />
              {/if}
              {#if item.hasPersonalAccessToken}
                <Code size={14} class="flex-shrink-0 text-blue-500" />
              {/if}
            {/if}
          </div>
        </div>
        <!-- Action buttons -->
        <div class="relative z-10 flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            on:click={(e) => handleExternalClick(e, item.repositoryUrl)}
            class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
          >
            <ExternalLink size={16} />
          </button>
          <button
            type="button"
            on:click={(e) => handleUnlinkClick(e, item)}
            class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400"
          >
            <Unlink size={16} />
          </button>
        </div>
      </div>

      <!-- Bottom row: Badges -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="neutral" mono>
          {item.repositoryUrl.replace('https://github.com/', '')}
        </Badge>
        <Badge variant="neutral" mono>{formatSyncStrategy(item.syncStrategy)}</Badge>
        <Badge variant="neutral" mono>{formatLastSynced(item.lastSyncedAt)}</Badge>
        {#if item.type === 'trash' && item.scoreProfile && item.scoreProfile !== 'default'}
          <Badge variant="neutral" mono>{item.scoreProfile}</Badge>
        {/if}
        {#if item.type === 'trash' && item.entityCounts}
          {@const entitySummary = formatEntityCount(item)}
          {#if entitySummary}
            <Badge variant="neutral" mono>{entitySummary}</Badge>
          {/if}
        {/if}
        {#if item.type === 'pcd' && !item.cacheAvailable}
          <Badge variant="warning" icon={AlertTriangle} mono>Cache Unavailable</Badge>
        {/if}
      </div>
    </a>
  {/each}
</div>
