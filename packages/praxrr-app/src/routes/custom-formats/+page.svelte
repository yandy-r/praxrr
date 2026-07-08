<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { Database, Plus } from 'lucide-svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  const storageKey = 'customFormatsDatabase';
  let redirecting = false;

  onMount(() => {
    if (!browser || data.databases.length === 0) return;

    const storedId = localStorage.getItem(storageKey);
    const stored = storedId ? Number(storedId) : NaN;
    const isValidStored = Number.isFinite(stored) && data.databases.some((db) => db.id === stored);
    const targetId = isValidStored ? stored : data.databases[0].id;

    redirecting = true;
    goto(`/custom-formats/${targetId}`);
  });
</script>

<svelte:head>
  <title>Custom Formats - Praxrr</title>
</svelte:head>

{#if data.databases.length === 0}
  <EmptyState
    icon={Database}
    title="No Databases Linked"
    description="Link a Praxrr Compliant Database to manage custom formats."
    buttonText="Link Database"
    buttonHref="/databases/new"
    buttonIcon={Plus}
  />
{:else}
  <div class="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
    {redirecting ? 'Opening your last selected database…' : 'Loading databases…'}
  </div>
{/if}
