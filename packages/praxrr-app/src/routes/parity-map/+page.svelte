<script lang="ts">
  import { goto } from '$app/navigation';
  import ParityMatrix from './ParityMatrix.svelte';
  import SemanticDifferences from './SemanticDifferences.svelte';
  import CompatibilityBadges from '$ui/parity/CompatibilityBadges.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  function handleDatabaseChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    goto(value ? `/parity-map?databaseId=${value}` : '/parity-map');
  }
</script>

<svelte:head>
  <title>Parity Map - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Cross-Arr Parity Map</h1>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Compare entity support and known semantic differences across Radarr, Sonarr, and Lidarr, then check which quality
      profiles in a linked database are usable by each app.
    </p>
  </div>

  <section>
    <h2 class="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Entity Support</h2>
    <ParityMatrix />
  </section>

  <section>
    <h2 class="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Known Semantic Differences</h2>
    <SemanticDifferences />
  </section>

  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Quality Profile Compatibility</h2>
      {#if data.databases.length > 0}
        <label class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          Database:
          <select
            class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={data.selectedDatabaseId ?? ''}
            on:change={handleDatabaseChange}
          >
            <option value="" disabled>Select a database…</option>
            {#each data.databases as database (database.id)}
              <option value={database.id}>{database.name}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    {#if data.error}
      <div
        class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
      >
        {data.error}
      </div>
    {/if}

    {#if data.databases.length === 0}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Link a Praxrr Compliant Database to see quality profile compatibility.
      </div>
    {:else if data.profiles === null}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Select a database above to see which quality profiles are usable by each Arr app.
      </div>
    {:else if data.profiles.length === 0}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        No quality profiles found in this database.
      </div>
    {:else}
      <p class="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        Compatibility is based on each profile's enabled qualities, not app assignment.
      </p>
      <ul class="space-y-2">
        {#each data.profiles as profile (profile.name)}
          <li
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{profile.name}</span>
            <CompatibilityBadges compatibleArrTypes={profile.compatibleArrTypes} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
