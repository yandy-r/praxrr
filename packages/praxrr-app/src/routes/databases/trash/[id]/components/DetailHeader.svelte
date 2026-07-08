<script lang="ts">
  import StickyCard from '$ui/card/StickyCard.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { ExternalLink } from 'lucide-svelte';

  export let name: string;
  export let arrType: 'radarr' | 'sonarr' = 'radarr';
  export let externalUrl: string | null = null;
</script>

<StickyCard>
  <svelte:fragment slot="left">
    <h1 class="text-neutral-900 dark:text-neutral-50">{name}</h1>
  </svelte:fragment>
  <svelte:fragment slot="right">
    <Badge variant={arrType === 'radarr' ? 'radarr' : 'sonarr'}>
      {arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
    </Badge>
    <Badge variant="trash">TRaSH</Badge>
    {#if externalUrl}
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
      >
        View Source
        <ExternalLink size={12} />
      </a>
    {/if}
  </svelte:fragment>
</StickyCard>
