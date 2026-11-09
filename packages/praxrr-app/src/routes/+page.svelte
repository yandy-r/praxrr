<script lang="ts">
  import { onMount } from 'svelte';
  import { Database, Server } from 'lucide-svelte';
  import { subscribeLive } from '$lib/client/events/liveInvalidate';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import AttentionStrip from '$ui/dashboard/AttentionStrip.svelte';
  import CompactEmptyState from '$ui/dashboard/CompactEmptyState.svelte';
  import InstanceCard from '$ui/dashboard/InstanceCard.svelte';
  import SidePanels from '$ui/dashboard/SidePanels.svelte';
  import DegradedNotice from '$ui/dashboard/DegradedNotice.svelte';
  import { buildAttentionItems, isDegraded } from '$ui/dashboard/dashboardFormat.ts';
  import type { HomeDashboardData } from '$shared/dashboard/types.ts';

  export let data: { dashboard: HomeDashboardData };

  // Matches `event.depends()` in `+page.server.ts`; refresh when syncs, drift or canary state change.
  onMount(() =>
    subscribeLive({
      key: 'app:home-dashboard',
      types: ['sync.recorded', 'drift.updated', 'canary.updated'],
    })
  );

  $: dashboard = data.dashboard;
  $: attentionItems = buildAttentionItems(dashboard);
  $: instancesDegraded = isDegraded(dashboard, 'instances');
  // `databaseCount` comes from the same source as conflicts, so it can't be trusted when that failed.
  $: showNoDatabases = dashboard.databaseCount === 0 && !isDegraded(dashboard, 'conflicts');
</script>

<svelte:head>
  <title>Home - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Home</h1>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      What needs your attention across your Arr instances and databases.
    </p>
  </div>

  <DegradedNotice sources={dashboard.degraded} />

  <AttentionStrip
    items={attentionItems}
    hasInstances={dashboard.instances.length > 0}
    degraded={dashboard.degraded.length > 0}
  />

  {#if showNoDatabases}
    <CompactEmptyState
      icon={Database}
      title="No databases linked"
      description="Link a Praxrr database to get curated profiles and custom formats to sync."
      buttonText="Link a database"
      buttonHref="/databases/new"
    />
  {/if}

  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <section class="space-y-3" aria-labelledby="instances-heading">
      <h2 id="instances-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Instances</h2>
      {#if dashboard.instances.length === 0 && instancesDegraded}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">Instances are unavailable right now.</p>
      {:else if dashboard.instances.length === 0}
        <CompactEmptyState
          icon={Server}
          title="No Arr instances yet"
          description="Connect Radarr, Sonarr, or Lidarr to preview and sync your configuration."
          buttonText="Add an Arr instance"
          buttonHref="/arr/new"
        />
      {:else}
        <CardGrid columns={2}>
          {#each dashboard.instances as instance (instance.id)}
            <InstanceCard {instance} degraded={dashboard.degraded} />
          {/each}
        </CardGrid>
      {/if}
    </section>

    <aside aria-label="Overview panels">
      <SidePanels data={dashboard} />
    </aside>
  </div>
</div>
