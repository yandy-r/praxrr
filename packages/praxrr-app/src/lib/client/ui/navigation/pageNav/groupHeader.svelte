<script lang="ts">
  import { page } from '$app/stores';
  import type { ComponentType } from 'svelte';

  export let label: string;
  export let href: string;
  export let icon: ComponentType | undefined = undefined;
  export let isOpen: boolean;
  export let hasItems: boolean;
  export let onToggle: () => void;
  export let activePattern: string | undefined = undefined;

  $: isActive = activePattern
    ? $page.url.pathname.includes(activePattern)
    : $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
</script>

<div class="group/header flex items-center">
  <!-- Main navigation button (left side) - rounded left, square right (or fully rounded if no items) -->
  <a
    {href}
    class="flex flex-1 items-center gap-2 py-1.5 pr-2 pl-3 font-sans text-sm font-semibold text-neutral-700 transition-colors group-hover/header:bg-neutral-200 hover:bg-neutral-200 dark:text-neutral-300 dark:group-hover/header:bg-neutral-800 dark:hover:bg-neutral-800 {hasItems
      ? 'rounded-l-lg'
      : 'rounded-lg'} {isActive
      ? 'bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700'
      : ''}"
  >
    {#if icon}
      <svelte:component this={icon} class="h-4 w-4" />
    {/if}
    {label}
  </a>

  <!-- Chevron toggle button (right side) - square left, rounded right -->
  {#if hasItems}
    <button
      onclick={onToggle}
      class="flex items-center self-stretch rounded-r-lg pr-1.5 pl-1.5 transition-colors group-hover/header:bg-neutral-200 hover:!bg-neutral-300 dark:group-hover/header:bg-neutral-800 dark:hover:!bg-neutral-700 {isActive
        ? 'bg-neutral-200 hover:!bg-neutral-300 dark:bg-neutral-800 dark:hover:!bg-neutral-700'
        : ''}"
      aria-label={isOpen ? 'Collapse group' : 'Expand group'}
    >
      <svg
        class="h-4 w-4 text-neutral-600 transition-transform dark:text-neutral-400 {isOpen ? 'rotate-90' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  {/if}
</div>
