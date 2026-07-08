<script lang="ts">
  import TrashGuideForm from '../../../components/TrashGuideForm.svelte';
  import type { ActionData } from './$types';
  import { page } from '$app/stores';

  export let form: ActionData;

  $: source = $page.data.source;
</script>

<svelte:head>
  <title>Settings - {source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<TrashGuideForm mode="edit" {source} {form} />
