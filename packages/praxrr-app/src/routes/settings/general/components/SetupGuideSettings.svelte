<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import { RotateCcw } from 'lucide-svelte';

  let restarting = false;

  async function handleRestart() {
    restarting = true;
    try {
      const res = await fetch('/api/v1/setup/resume', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to restart setup');
      await invalidateAll();
      await goto('/setup');
    } catch {
      alertStore.add('error', 'Could not restart the setup guide — please try again.');
    } finally {
      restarting = false;
    }
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">Setup guide</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Walk through connecting an Arr instance, linking a database, and selecting profiles again. The guide resumes at
      the first step that is still incomplete.
    </p>
  </div>
  <div class="p-6">
    <Button
      variant="secondary"
      size="sm"
      icon={RotateCcw}
      text="Restart setup guide"
      disabled={restarting}
      on:click={handleRestart}
    />
  </div>
</div>
