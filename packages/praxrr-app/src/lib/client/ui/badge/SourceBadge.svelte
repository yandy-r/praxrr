<script lang="ts">
  import { Database, Trash2 } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { ComponentType } from 'svelte';

  type SourceType = 'pcd' | 'trash';
  type ArrType = 'radarr' | 'sonarr' | 'lidarr';

  const sourceVariantMap: Record<SourceType, 'accent' | 'trash'> = {
    pcd: 'accent',
    trash: 'trash',
  };

  const sourceIconMap: Record<SourceType, ComponentType> = {
    pcd: Database,
    trash: Trash2,
  };

  export let sourceType: SourceType;
  export let sourceName: string;
  export let size: 'sm' | 'md' = 'sm';
  export let arrType: ArrType | null = null;
  export let mono: boolean = false;

  $: variant = sourceVariantMap[sourceType];
  $: icon = sourceIconMap[sourceType];
  $: arrLabel = arrType ? `${arrType.charAt(0).toUpperCase()}${arrType.slice(1)}` : null;
</script>

<span class="inline-flex items-center gap-1.5">
  <Badge {variant} {size} {icon} {mono}>{sourceName}</Badge>
  {#if arrType && arrLabel}
    <Badge variant={arrType} {size}>{arrLabel}</Badge>
  {/if}
</span>
