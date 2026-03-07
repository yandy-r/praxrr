<script lang="ts">
  import { goto } from '$app/navigation';
  import Button from '$ui/button/Button.svelte';
  import { FlaskConical } from 'lucide-svelte';

  export let databaseId: number;
  export let profileName: string;

  function handleClick() {
    const params = new URLSearchParams({
      profile: `pcd:${encodeURIComponent(profileName)}`,
      arrType: 'radarr',
    });
    void goto(`/score-simulator/${databaseId}?${params.toString()}`);
  }
</script>

{#if profileName}
  <Button variant="secondary" icon={FlaskConical} responsive hideTextOnMobile text="Simulate" on:click={handleClick} />
{/if}
