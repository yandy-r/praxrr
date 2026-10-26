<script lang="ts">
  // Builds the document title as "most-specific - ... - Praxrr", e.g. parts={['Naming', db.name']}
  // renders "Naming - MyDB - Praxrr". Null/undefined/empty parts are dropped.
  export let parts: Array<string | null | undefined>;

  $: title = [...parts.filter((part) => typeof part === 'string' && part.trim()), 'Praxrr'].join(' - ');
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>
