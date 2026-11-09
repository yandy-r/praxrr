<script lang="ts">
  import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from 'lucide-svelte';
  import type { AttentionItem } from './dashboardFormat.ts';

  export let items: AttentionItem[];
  /** Whether there is anything to monitor; an empty strip is only "all clear" when true. */
  export let hasInstances: boolean;
  /** When any source failed to load, an empty list must not read as "all clear". */
  export let degraded: boolean = false;

  const toneClass: Record<AttentionItem['tone'], string> = {
    warning:
      'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30',
    danger:
      'border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/30',
    info: 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30',
  };
  const toneIcon = { warning: AlertTriangle, danger: XCircle, info: Info };
</script>

{#if items.length > 0}
  <section aria-labelledby="attention-heading" class="space-y-2">
    <h2 id="attention-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      Needs attention
      <span class="ml-1 font-normal text-neutral-500 dark:text-neutral-400">({items.length})</span>
    </h2>
    <ul class="flex flex-wrap gap-2">
      {#each items as item (item.id)}
        <li>
          <a
            href={item.href}
            class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors {toneClass[
              item.tone
            ]}"
          >
            <svelte:component this={toneIcon[item.tone]} size={14} aria-hidden="true" />
            {item.text}
            <ChevronRight size={14} class="opacity-60" aria-hidden="true" />
          </a>
        </li>
      {/each}
    </ul>
  </section>
{:else if hasInstances && !degraded}
  <div
    class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
    role="status"
  >
    <CheckCircle2 size={16} aria-hidden="true" />
    Nothing needs your attention right now.
  </div>
{/if}
