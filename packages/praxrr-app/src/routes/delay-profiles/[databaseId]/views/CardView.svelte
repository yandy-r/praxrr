<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { DelayProfileListItem } from '$shared/pcd/display.ts';
  import { page } from '$app/stores';
  import { Clock, Zap, Shield, Copy, Download, DatabaseZap, ClipboardCopy } from 'lucide-svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Card from '$ui/card/Card.svelte';
  import Button from '$ui/button/Button.svelte';
  import { createProgressiveList } from '$lib/client/utils/progressiveList';
  import LocallyModifiedBadge from '$ui/badge/LocallyModifiedBadge.svelte';

  export let profiles: DelayProfileListItem[];

  const dispatch = createEventDispatcher<{
    clone: { name: string };
    export: { name: string };
    copy: { name: string };
    clipboard: { name: string };
  }>();

  $: databaseId = $page.params.databaseId;

  const { visibleCount, sentinel, reset, setTotalCount } = createProgressiveList({ pageSize: 30 });
  $: setTotalCount(profiles.length);
  $: {
    void profiles;
    reset();
  }
  $: visibleProfiles = profiles.slice(0, $visibleCount);

  function formatProtocol(protocol: string): string {
    switch (protocol) {
      case 'prefer_usenet':
        return 'Prefer Usenet';
      case 'prefer_torrent':
        return 'Prefer Torrent';
      case 'only_usenet':
        return 'Only Usenet';
      case 'only_torrent':
        return 'Only Torrent';
      default:
        return protocol;
    }
  }

  function formatDelay(minutes: number | null): string {
    if (minutes === null) return '-';
    if (minutes === 0) return 'No delay';
    return `${minutes}m`;
  }
</script>

<CardGrid columns={5} flush>
  {#each visibleProfiles as profile}
    <Card hoverable className="relative">
      <a
        href={`/delay-profiles/${databaseId}/${encodeURIComponent(profile.name)}`}
        aria-label={profile.name}
        class="absolute inset-0 rounded-xl"
      ></a>
      <svelte:fragment slot="header">
        <div class="flex items-center justify-between">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{profile.name}</span>
          </div>
          <div class="relative z-10 flex items-center gap-0.5">
            <Button
              icon={Download}
              size="xs"
              variant="ghost"
              tooltip="Download bundle"
              on:click={() => dispatch('export', { name: profile.name })}
            />
            <Button
              icon={DatabaseZap}
              size="xs"
              variant="ghost"
              tooltip="Copy to database…"
              on:click={() => dispatch('copy', { name: profile.name })}
            />
            <Button
              icon={ClipboardCopy}
              size="xs"
              variant="ghost"
              tooltip="Copy JSON to clipboard"
              on:click={() => dispatch('clipboard', { name: profile.name })}
            />
            <Button
              icon={Copy}
              size="xs"
              variant="ghost"
              tooltip="Clone"
              on:click={() => dispatch('clone', { name: profile.name })}
            />
          </div>
        </div>
      </svelte:fragment>

      <div class="space-y-2.5">
        <div class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Zap size={12} />
          <span>{formatProtocol(profile.preferred_protocol)}</span>
        </div>

        <div class="space-y-1">
          {#if profile.usenet_delay !== null}
            <div class="flex items-center justify-between text-xs">
              <span class="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                <Clock size={11} />Usenet
              </span>
              <span class="font-mono text-neutral-900 dark:text-neutral-100">{formatDelay(profile.usenet_delay)}</span>
            </div>
          {/if}
          {#if profile.torrent_delay !== null}
            <div class="flex items-center justify-between text-xs">
              <span class="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                <Clock size={11} />Torrent
              </span>
              <span class="font-mono text-neutral-900 dark:text-neutral-100">{formatDelay(profile.torrent_delay)}</span>
            </div>
          {/if}
        </div>

        {#if profile.bypass_if_highest_quality || profile.bypass_if_above_custom_format_score}
          <div class="space-y-1 border-t border-neutral-200 pt-2.5 dark:border-neutral-700/60">
            {#if profile.bypass_if_highest_quality}
              <div class="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                <Shield size={11} />
                <span>Highest Quality</span>
              </div>
            {/if}
            {#if profile.bypass_if_above_custom_format_score && profile.minimum_custom_format_score !== null}
              <div class="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                <Shield size={11} />
                <span>CF ≥ {profile.minimum_custom_format_score}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </Card>
  {/each}
</CardGrid>
<div use:sentinel></div>
