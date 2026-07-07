<script lang="ts">
  import { goto } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import { ArrowRight } from 'lucide-svelte';

  let advancing = false;

  async function handleGetStarted() {
    advancing = true;
    try {
      const res = await fetch('/api/v1/setup/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: 'connect-arr' }),
      });
      if (!res.ok) throw new Error('Failed to advance setup step');
      await goto('/setup/connect-arr');
    } catch {
      alertStore.add('error', 'Could not start setup — please try again.');
    } finally {
      advancing = false;
    }
  }
</script>

<svelte:head>
  <title>Welcome - Setup - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <p class="text-neutral-600 dark:text-neutral-400">
    Praxrr keeps your Radarr and Sonarr quality profiles, custom formats, and release
    profiles in sync with a curated configuration database. This quick setup connects an
    Arr instance, links a configuration database, and picks the quality profiles to sync
    — it takes about five minutes.
  </p>

  <Button
    variant="primary"
    size="md"
    icon={ArrowRight}
    iconPosition="right"
    text={advancing ? 'Starting…' : 'Get started'}
    disabled={advancing}
    on:click={handleGetStarted}
  />
</div>
