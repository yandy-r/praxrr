<script lang="ts">
  import Badge from '$ui/badge/Badge.svelte';
  import type { NavBadge } from '$shared/navigation/types.ts';

  export let badge: NavBadge;
  /** `dot` renders a compact overlay marker for the bottom nav. */
  export let compact: boolean = false;

  $: text = badge.count > 99 ? '99+' : String(badge.count);
</script>

{#if compact}
  <span
    class="pointer-events-none absolute -top-1 left-1/2 ml-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-4 font-semibold text-white {badge.tone ===
    'danger'
      ? 'bg-red-600'
      : 'bg-amber-600'}"
    aria-hidden="true"
  >
    {text}
  </span>
  <span class="sr-only">{badge.label}</span>
{:else}
  <span class="ml-auto shrink-0">
    <Badge variant={badge.tone} size="sm"
      ><span aria-hidden="true">{text}</span><span class="sr-only">{badge.label}</span></Badge
    >
  </span>
{/if}
