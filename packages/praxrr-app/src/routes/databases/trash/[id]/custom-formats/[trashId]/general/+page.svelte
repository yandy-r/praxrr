<script lang="ts">
  import DetailHeader from '../../../components/DetailHeader.svelte';
  import DetailCard from '../../../components/DetailCard.svelte';
  import DetailField from '../../../components/DetailField.svelte';
  import Markdown from '$ui/display/Markdown.svelte';
  import Table from '$ui/table/Table.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { Column } from '$ui/table/types.ts';
  import { page } from '$app/stores';

  $: source = $page.data.source;
  $: entity = $page.data.entity;
  $: fetchedAt = $page.data.fetchedAt;

  $: scoreEntries = entity ? Object.entries(entity.scores).map(([profile, score]) => ({ profile, score })) : [];

  interface ScoreTableRow {
    profile: string;
    score: number;
  }

  $: scoreColumns = [
    {
      key: 'profile',
      header: 'Score Profile',
      sortable: true,
    },
    {
      key: 'score',
      header: 'Score',
      align: 'right' as const,
      sortable: true,
    },
  ] satisfies Column<ScoreTableRow>[];

  function formatDate(date: string): string {
    return new Date(date).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>{entity?.name ?? 'Custom Format'} - General - Praxrr</title>
</svelte:head>

{#if entity}
  <div class="mt-6 space-y-6">
    <DetailHeader name={entity.name} arrType={source?.arrType ?? 'radarr'} externalUrl={entity.regex_url} />

    <DetailCard title="General">
      <DetailField label="Name" value={entity.name} />
      {#if entity.description}
        <div class="flex items-start justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Description</span>
          <div class="max-w-md text-right">
            <Markdown content={entity.description} />
          </div>
        </div>
      {/if}
      <DetailField label="Include in Rename" value={entity.include_in_rename ? 'Yes' : 'No'} />
      <DetailField label="File Path" value={entity.file_path} mono />
      <DetailField label="Fetched At" value={formatDate(fetchedAt)} />
    </DetailCard>

    {#if scoreEntries.length > 0}
      <div>
        <h3 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">Scores</h3>
        <Table columns={scoreColumns} data={scoreEntries} compact hoverable={false} />
      </div>
    {/if}
  </div>
{/if}
