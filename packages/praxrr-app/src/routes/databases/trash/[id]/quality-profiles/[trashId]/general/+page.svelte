<script lang="ts">
  import DetailHeader from '../../../components/DetailHeader.svelte';
  import DetailCard from '../../../components/DetailCard.svelte';
  import DetailField from '../../../components/DetailField.svelte';
  import Markdown from '$ui/display/Markdown.svelte';
  import { ExternalLink } from 'lucide-svelte';
  import { page } from '$app/stores';

  $: source = $page.data.source;
  $: entity = $page.data.entity;
  $: fetchedAt = $page.data.fetchedAt;

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
  <title>{entity?.name ?? 'Quality Profile'} - General - Praxrr</title>
</svelte:head>

{#if entity}
  <div class="mt-6 space-y-6">
    <DetailHeader name={entity.name} arrType={source?.arrType ?? 'radarr'} externalUrl={entity.source_url} />

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
      {#if entity.source_url}
        <div class="flex items-center justify-between px-4 py-3">
          <span class="text-sm text-neutral-500 dark:text-neutral-400">Source URL</span>
          <a
            href={entity.source_url}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            View Guide
            <ExternalLink size={12} />
          </a>
        </div>
      {/if}
      <DetailField label="Score Set" value={entity.score_set ?? '-'} />
      <DetailField label="Language" value={entity.language ?? 'Any'} />
    </DetailCard>

    <DetailCard title="Upgrade Settings">
      <DetailField label="Upgrades Allowed" value={entity.upgrade_allowed ? 'Yes' : 'No'} />
      <DetailField label="Cutoff" value={entity.cutoff} />
      <DetailField label="Minimum Custom Format Score" value={entity.min_format_score} />
      <DetailField label="Upgrade Until Score" value={entity.cutoff_format_score} />
      <DetailField label="Minimum Upgrade Format Score" value={entity.min_upgrade_format_score} />
    </DetailCard>

    <DetailCard title="Metadata">
      <DetailField label="File Path" value={entity.file_path} mono />
      <DetailField label="Fetched At" value={formatDate(fetchedAt)} />
    </DetailCard>
  </div>
{/if}
