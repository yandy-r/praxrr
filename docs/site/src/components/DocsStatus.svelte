<script>
  let detailsOpen = false;

  function toggleDetails() {
    detailsOpen = !detailsOpen;
  }
</script>

<section class="praxrr-docs-panel my-6 bg-white shadow-sm dark:bg-slate-950">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <p class="m-0 text-sm font-semibold text-emerald-700 uppercase dark:text-emerald-300">Docs site status</p>
      <p class="m-0 mt-2 text-base text-slate-700 dark:text-slate-200">
        Astro, Starlight, Svelte islands, Tailwind CSS, and OpenAPI generation are wired into one static build.
      </p>
    </div>

    <button
      type="button"
      class="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-500 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
      aria-expanded={detailsOpen}
      onclick={toggleDetails}
    >
      {detailsOpen ? 'Hide checks' : 'Show checks'}
    </button>
  </div>

  {#if detailsOpen}
    <ul class="mt-4 grid gap-2 pl-5 text-sm text-slate-700 sm:grid-cols-2 dark:text-slate-200">
      <li>Pagefind search is enabled by Starlight during production builds.</li>
      <li>OpenAPI pages are generated from <code>docs/api/v1/openapi.yaml</code>.</li>
      <li>Schema docs are imported from the schema mirror or local package.</li>
      <li>Database docs are imported from the database mirror or local package.</li>
    </ul>
  {/if}
</section>
