<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Card from '$ui/card/Card.svelte';
  import Label from '$ui/label/Label.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import SourceBadge from '$ui/badge/SourceBadge.svelte';
  import Button from '$ui/button/Button.svelte';
  import { Copy, Download } from 'lucide-svelte';
  import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
  import type { SourceRef } from '$shared/sources/types.ts';
  import {
    ARR_APP_TYPES,
    type ArrAppType,
    type ArrIconKey,
    getArrAppMetadata,
    isArrAppType,
  } from '$shared/arr/capabilities.ts';
  import { getMediaManagementDisplayName, getMediaManagementRouteName } from '$shared/arr/displayName.ts';
  import radarrLogo from '$lib/client/assets/Radarr.svg';
  import sonarrLogo from '$lib/client/assets/Sonarr.svg';
  import lidarrLogo from '$lib/client/assets/Lidarr.png';

  export let configs: SourcedQualityDefinitionListItem[];
  export let databaseId: number;
  export let currentDatabaseId: number;
  export let currentDatabaseName: string;
  export let sources: SourceRef[] = [];
  export let showSourceBadges = false;

  const dispatch = createEventDispatcher<{
    clone: { name: string; arr_type: string };
    export: { name: string; arr_type: string };
  }>();

  // Available logo assets keyed by ArrIconKey.
  const logoAssets: Record<string, string> = {
    radarr: radarrLogo,
    sonarr: sonarrLogo,
    lidarr: lidarrLogo,
  };

  const logos: Partial<Record<ArrIconKey, string>> = Object.fromEntries(
    ARR_APP_TYPES.map((type) => [type, logoAssets[type]])
  ) as Partial<Record<ArrIconKey, string>>;
  $: sourceLookup = new Map(sources.map((source) => [`${source.type}:${source.id}`, source] as const));
  $: fallbackSource = {
    type: 'pcd' as const,
    id: currentDatabaseId,
    name: currentDatabaseName,
  };

  interface ResolvedSource {
    type: SourceRef['type'];
    id: number;
    name: string;
    arrType: ArrAppType | null;
  }

  let loadedImages = new SvelteSet<string>();

  function formatTypeLabel(type: string): string {
    if (!type) {
      return 'Unknown';
    }

    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  function getAppLabel(arrType: string): string {
    if (!isArrAppType(arrType)) {
      return formatTypeLabel(arrType);
    }

    return getArrAppMetadata(arrType).label;
  }

  function getLogoPath(arrType: string): string {
    if (!isArrAppType(arrType)) {
      return '';
    }

    const metadata = getArrAppMetadata(arrType);
    return logos[metadata.iconKey] ?? '';
  }

  function getAppInitial(arrType: string): string {
    return getAppLabel(arrType).slice(0, 1).toUpperCase();
  }

  function getMappedQualityLabel(qualityCount: number): string {
    if (qualityCount === 0) {
      return 'No mapped qualities';
    }

    return qualityCount === 1 ? '1 mapped quality' : `${qualityCount} mapped qualities`;
  }

  function resolveSource(config: SourcedQualityDefinitionListItem): ResolvedSource {
    if (config.sourceType && typeof config.sourceDatabaseId === 'number') {
      const matched = sourceLookup.get(`${config.sourceType}:${config.sourceDatabaseId}`);
      if (matched) {
        return {
          type: matched.type,
          id: matched.id,
          name: matched.name,
          arrType: matched.type === 'trash' ? matched.arrType : null,
        };
      }

      return {
        type: config.sourceType,
        id: config.sourceDatabaseId,
        name: config.sourceDatabaseName ?? `Source ${config.sourceDatabaseId}`,
        arrType: null,
      };
    }

    return {
      type: fallbackSource.type,
      id: fallbackSource.id,
      name: fallbackSource.name,
      arrType: null,
    };
  }

  function resolveSourceDatabaseId(config: SourcedQualityDefinitionListItem): number {
    if (config.sourceType === 'pcd' && typeof config.sourceDatabaseId === 'number') {
      return config.sourceDatabaseId;
    }

    return databaseId;
  }

  function isTrashRow(config: SourcedQualityDefinitionListItem): boolean {
    return config.sourceType === 'trash';
  }

  function isEditableRow(config: SourcedQualityDefinitionListItem): boolean {
    return !isTrashRow(config) && resolveSourceDatabaseId(config) === currentDatabaseId;
  }

  function getRowHref(config: SourcedQualityDefinitionListItem): string | undefined {
    if (isTrashRow(config)) {
      return config.trashId
        ? `/databases/trash/${config.sourceDatabaseId}/quality-sizes/${config.trashId}/`
        : undefined;
    }

    const sourceDatabaseId = resolveSourceDatabaseId(config);
    const routeName = getMediaManagementRouteName(config.name, config.arr_type).trim();
    if (!routeName || !isArrAppType(config.arr_type)) {
      return `/media-management/${sourceDatabaseId}/quality-definitions`;
    }

    return `/media-management/${sourceDatabaseId}/quality-definitions/${config.arr_type}/${encodeURIComponent(routeName)}`;
  }

  function handleImageLoad(name: string) {
    loadedImages.add(name);
  }
</script>

<CardGrid columns={1} flush>
  {#each configs as config (config.arr_type + ':' + config.name)}
    {@const appLabel = getAppLabel(config.arr_type)}
    {@const logoPath = getLogoPath(config.arr_type)}
    {@const hasAppMapping = isArrAppType(config.arr_type)}
    {@const hasMappedQualities = config.quality_count > 0}
    {@const mappedQualityLabel = getMappedQualityLabel(config.quality_count)}
    <Card href={getRowHref(config)} hoverable>
      <div class="flex items-center gap-4">
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
                {getAppInitial(config.arr_type)}
              </div>
            {/if}
          </div>
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {getMediaManagementDisplayName(config.name, config.arr_type, config.sourceType)}
            </h3>
            <div class="mt-1 flex flex-wrap items-center gap-1">
              {#if showSourceBadges}
                {@const source = resolveSource(config)}
                <SourceBadge sourceType={source.type} sourceName={source.name} arrType={source.arrType} size="sm" />
              {/if}
              <Badge variant={hasAppMapping ? config.arr_type : 'warning'} size="sm">
                {appLabel}
              </Badge>
              {#if !hasAppMapping}
                <Label variant="warning" size="sm" rounded="md">Missing app mapping</Label>
              {:else if !hasMappedQualities}
                <Label variant="warning" size="sm" rounded="md">Missing quality mappings</Label>
              {/if}
              <Label variant={hasMappedQualities ? 'secondary' : 'warning'} size="sm" rounded="md">
                {mappedQualityLabel}
              </Label>
            </div>
          </div>
        </div>

        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        {#if isEditableRow(config)}
          <div class="flex items-center gap-0.5" on:click|stopPropagation|preventDefault>
            <Button
              icon={Download}
              size="xs"
              variant="ghost"
              tooltip="Export"
              on:click={() => dispatch('export', { name: config.name, arr_type: config.arr_type })}
            />
            <Button
              icon={Copy}
              size="xs"
              variant="ghost"
              tooltip="Clone"
              on:click={() => dispatch('clone', { name: config.name, arr_type: config.arr_type })}
            />
          </div>
        {/if}
      </div>
    </Card>
  {/each}
</CardGrid>
