<script lang="ts">
  import Button from '$ui/button/Button.svelte';
  import { PartyPopper } from 'lucide-svelte';
</script>

<svelte:head>
  <title>All set - Setup - Praxrr</title>
</svelte:head>

<div class="space-y-6 text-center">
  <PartyPopper size={48} class="text-accent-600 dark:text-accent-500 mx-auto" />
  <p class="text-neutral-600 dark:text-neutral-400">
    Praxrr is connected and syncing. You can revisit any of these settings later from the dashboard.
  </p>
  <Button variant="primary" size="md" text="Go to dashboard" href="/" />
</div>
