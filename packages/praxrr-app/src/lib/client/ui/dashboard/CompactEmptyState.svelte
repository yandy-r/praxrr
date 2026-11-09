<script lang="ts">
  import type { ComponentType } from 'svelte';
  import { Plus } from 'lucide-svelte';

  export let icon: ComponentType;
  export let title: string;
  export let description: string;
  export let buttonText: string;
  export let buttonHref: string;
</script>

<div
  class="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800/30"
>
  <div class="rounded-full bg-neutral-100 p-3 dark:bg-neutral-800">
    <svelte:component this={icon} class="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
  </div>
  <div class="min-w-48 flex-1">
    <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
    <p class="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
  </div>
  <a
    href={buttonHref}
    class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors"
  >
    <Plus size={14} />
    {buttonText}
  </a>
</div>
