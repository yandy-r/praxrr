<script lang="ts">
  import BundleImportPanel from '$ui/bundles/BundleImportPanel.svelte';
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head><title>Import - {data.database.name} - Praxrr</title></svelte:head>

<div class="mt-6 max-w-5xl space-y-5">
  <header>
    <h1 class="text-2xl font-semibold">Import entity bundle</h1>
    <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
      Import portable entities and their dependencies into {data.database.name}. A dry run is required before any
      changes are applied.
    </p>
  </header>
  <BundleImportPanel
    databaseId={data.database.id}
    canWriteToBase={!!data.database.has_personal_access_token && !data.database.local_ops_enabled}
  />
</div>
