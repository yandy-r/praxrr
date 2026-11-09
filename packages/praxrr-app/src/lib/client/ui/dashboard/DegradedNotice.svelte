<script lang="ts">
  import { AlertTriangle } from 'lucide-svelte';
  import { DASHBOARD_SOURCE_LABEL } from './dashboardFormat.ts';
  import type { DashboardSource } from '$shared/dashboard/types.ts';

  export let sources: DashboardSource[];

  $: names = sources.map((source) => DASHBOARD_SOURCE_LABEL[source]).join(', ');
</script>

{#if sources.length > 0}
  <div
    class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    role="status"
  >
    <AlertTriangle size={16} class="mt-0.5 shrink-0" aria-hidden="true" />
    <p>
      Some dashboard data couldn't be loaded: {names}. What you see below may be incomplete.
    </p>
  </div>
{/if}
