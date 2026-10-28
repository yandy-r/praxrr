<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Card from '$ui/card/Card.svelte';
  import Label from '$ui/label/Label.svelte';
  import LocallyModifiedBadge from '$ui/badge/LocallyModifiedBadge.svelte';
  import Button from '$ui/button/Button.svelte';
  import { Copy, Download, DatabaseZap, ClipboardCopy } from 'lucide-svelte';
  import type { MediaSettingsListItem } from '$shared/pcd/display.ts';
  import type { ArrAppType } from '$shared/arr/capabilities.ts';
  import { getMediaManagementDisplayName, getMediaManagementRouteName } from '$shared/arr/displayName.ts';
  import radarrLogo from '$lib/client/assets/Radarr.svg';
  import sonarrLogo from '$lib/client/assets/Sonarr.svg';
  import lidarrLogo from '$lib/client/assets/Lidarr.png';

  export let configs: MediaSettingsListItem[];
  export let databaseId: number;

  const dispatch = createEventDispatcher<{
    clone: { name: string; arr_type: string };
    export: { name: string; arr_type: string };
    copy: { name: string; arr_type: string };
    clipboard: { name: string; arr_type: string };
  }>();

  const logos: Partial<Record<ArrAppType, string>> = {
    radarr: radarrLogo,
    sonarr: sonarrLogo,
    lidarr: lidarrLogo,
  };
  const validArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

  const propersRepacksConfig: Record<string, { variant: 'secondary' | 'success' | 'warning'; label: string }> = {
    doNotPrefer: { variant: 'secondary', label: 'Do Not Prefer' },
    preferAndUpgrade: { variant: 'success', label: 'Prefer & Upgrade' },
    doNotUpgradeAutomatically: { variant: 'warning', label: 'No Auto Upgrade' },
  };

  let loadedImages = new SvelteSet<string>();

  function handleImageLoad(name: string) {
    loadedImages.add(name);
  }

  function isSupportedArrType(arrType: string): arrType is ArrAppType {
    return validArrTypes.includes(arrType as ArrAppType);
  }

  function getAppLabel(arrType: string): string {
    return isSupportedArrType(arrType) ? arrType.charAt(0).toUpperCase() + arrType.slice(1) : 'Unknown';
  }

  function getLogoPath(arrType: string): string {
    if (!isSupportedArrType(arrType)) {
      return '';
    }

    return logos[arrType] ?? '';
  }

  function getTypeInitial(arrType: string): string {
    return getAppLabel(arrType).slice(0, 1).toUpperCase();
  }

  function getRowHref(config: MediaSettingsListItem): string {
    const routeName = getMediaManagementRouteName(config.name, config.arr_type).trim();
    if (!routeName || !isSupportedArrType(config.arr_type)) {
      return `/media-management/${databaseId}/media-settings`;
    }

    return `/media-management/${databaseId}/media-settings/${config.arr_type}/${encodeURIComponent(routeName)}`;
  }
</script>

<CardGrid columns={1} flush>
  {#each configs as config (config.arr_type + ':' + config.name)}
    {@const prConfig = propersRepacksConfig[config.propers_repacks] || {
      variant: 'secondary',
      label: config.propers_repacks,
    }}
    {@const logoPath = getLogoPath(config.arr_type)}
    {@const appLabel = getAppLabel(config.arr_type)}
    {@const appInitial = getTypeInitial(config.arr_type)}
    <Card hoverable className="relative">
      <div class="flex items-center gap-4">
        <a href={getRowHref(config)} aria-label={config.name} class="absolute inset-0 rounded-xl"></a>
        <!-- Logo + Name -->
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="relative h-10 w-10 flex-shrink-0">
            {#if !loadedImages.has(config.name)}
              <div class="absolute inset-0 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700"></div>
            {/if}
            {#if logoPath}
              <img
                src={logoPath}
                alt="{appLabel} logo"
                class="h-10 w-10 rounded-lg {loadedImages.has(config.name) ? 'opacity-100' : 'opacity-0'}"
                on:load={() => handleImageLoad(config.name)}
              />
            {:else}
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {appInitial}
              </div>
            {/if}
          </div>
          <div class="min-w-0">
            <span class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
              >{getMediaManagementDisplayName(config.name, config.arr_type)}</span
            >
            <div class="mt-1 flex flex-wrap items-center gap-1">
              {#if config.locallyModified}
                <LocallyModifiedBadge />
              {/if}
              <Label variant={prConfig.variant} size="sm" rounded="md">{prConfig.label}</Label>
              {#if config.enable_media_info}
                <Label variant="success" size="sm" rounded="md">Media Info</Label>
              {:else}
                <Label variant="secondary" size="sm" rounded="md">No Media Info</Label>
              {/if}
            </div>
          </div>
        </div>

        <div class="relative z-10 flex items-center gap-0.5">
          <Button
            icon={Download}
            size="xs"
            variant="ghost"
            tooltip="Download bundle"
            on:click={() => dispatch('export', { name: config.name, arr_type: config.arr_type })}
          />
          <Button
            icon={DatabaseZap}
            size="xs"
            variant="ghost"
            tooltip="Copy to database…"
            on:click={() => dispatch('copy', { name: config.name, arr_type: config.arr_type })}
          />
          <Button
            icon={ClipboardCopy}
            size="xs"
            variant="ghost"
            tooltip="Copy JSON to clipboard"
            on:click={() => dispatch('clipboard', { name: config.name, arr_type: config.arr_type })}
          />
          <Button
            icon={Copy}
            size="xs"
            variant="ghost"
            tooltip="Clone"
            on:click={() => dispatch('clone', { name: config.name, arr_type: config.arr_type })}
          />
        </div>
      </div>
    </Card>
  {/each}
</CardGrid>
