<script lang="ts">
  import { ChevronDown, ChevronRight, ArrowRight, Loader2 } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { components } from '$api/v1.d.ts';
  import {
    formatDelta,
    deltaColorClass,
    thresholdStateLabel,
    thresholdStateBadgeVariant,
    type ThresholdState,
  } from '../helpers.ts';

  type ReleaseImpact = components['schemas']['ReleaseImpact'];
  type ProfileImpact = components['schemas']['ProfileImpact'];

  export let releaseImpacts: ReleaseImpact[] = [];
  export let parserAvailable = true;
  export let isSimulating = false;

  let expanded = new Set<string>();

  function rowKey(releaseTitle: string, profileName: string): string {
    return `${releaseTitle}::${profileName}`;
  }

  function toggle(key: string) {
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
    }
    expanded = expanded;
  }

  function hasTransition(profile: ProfileImpact): boolean {
    return profile.currentState !== profile.proposedState;
  }
</script>

<div class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Release impact</h3>
    {#if isSimulating}
      <Loader2 size={16} class="animate-spin text-neutral-400" />
    {/if}
  </div>

  {#if !parserAvailable}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Release scoring is unavailable while the parser service is offline. Config diff and cascade results are still
      shown below.
    </p>
  {:else if releaseImpacts.length === 0}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Add release titles and quality profiles, then run a simulation to see per-release impact.
    </p>
  {:else}
    <div class="space-y-4">
      {#each releaseImpacts as release (release.id ?? release.title)}
        <div class="space-y-2">
          <div class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100" title={release.title}>
            {release.title}
          </div>
          <div class="space-y-1.5">
            {#each release.profiles as profile (profile.profileName)}
              {@const key = rowKey(release.title, profile.profileName)}
              <div class="rounded-md border border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  on:click={() => toggle(key)}
                >
                  <span class="flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                    {#if expanded.has(key)}
                      <ChevronDown size={14} />
                    {:else}
                      <ChevronRight size={14} />
                    {/if}
                    <span class="font-medium">{profile.profileName}</span>
                    {#if !profile.editable}
                      <Badge variant="trash" size="sm">TRaSH</Badge>
                    {/if}
                  </span>
                  <span class="flex items-center gap-2 text-xs">
                    <span class="font-mono text-neutral-500 dark:text-neutral-400">{profile.currentTotal}</span>
                    <ArrowRight size={12} class="text-neutral-400" />
                    <span class="font-mono text-neutral-900 dark:text-neutral-100">{profile.proposedTotal}</span>
                    <span class="font-mono font-semibold {deltaColorClass(profile.delta)}">
                      ({formatDelta(profile.delta)})
                    </span>
                  </span>
                </button>

                {#if hasTransition(profile)}
                  <div class="flex items-center gap-1.5 px-3 pb-2 text-[11px]">
                    <Badge variant={thresholdStateBadgeVariant(profile.currentState as ThresholdState)} size="sm">
                      {thresholdStateLabel(profile.currentState as ThresholdState)}
                    </Badge>
                    <ArrowRight size={12} class="text-neutral-400" />
                    <Badge variant={thresholdStateBadgeVariant(profile.proposedState as ThresholdState)} size="sm">
                      {thresholdStateLabel(profile.proposedState as ThresholdState)}
                    </Badge>
                  </div>
                {/if}

                {#if expanded.has(key)}
                  <div class="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
                    {#if profile.changedCfs.length === 0}
                      <p class="text-xs text-neutral-500 dark:text-neutral-400">
                        No custom-format contribution changes for this profile.
                      </p>
                    {:else}
                      <div class="space-y-1">
                        {#each profile.changedCfs as cf (cf.cfName)}
                          <div class="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
                            <span class="truncate text-neutral-700 dark:text-neutral-300" title={cf.cfName}>
                              {cf.cfName}
                            </span>
                            <span class="flex items-center gap-1.5 font-mono">
                              <span class="text-neutral-500 dark:text-neutral-400">{cf.currentScore}</span>
                              <ArrowRight size={12} class="text-neutral-400" />
                              <span class="text-neutral-900 dark:text-neutral-100">{cf.proposedScore}</span>
                              <span class="font-semibold {deltaColorClass(cf.delta)}">({formatDelta(cf.delta)})</span>
                            </span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
