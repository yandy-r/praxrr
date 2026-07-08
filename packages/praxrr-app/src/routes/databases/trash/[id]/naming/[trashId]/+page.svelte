<script lang="ts">
  import DetailHeader from '../../components/DetailHeader.svelte';
  import DetailCard from '../../components/DetailCard.svelte';
  import DetailField from '../../components/DetailField.svelte';
  import CodeBlock from '$ui/display/CodeBlock.svelte';
  import { page } from '$app/stores';

  $: source = $page.data.source;
  $: entity = $page.data.entity;
  $: fetchedAt = $page.data.fetchedAt;

  $: templateEntries = entity?.templates ? Object.entries(entity.templates) : [];

  function formatDate(date: string): string {
    return new Date(date).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
</script>

<svelte:head>
  <title>{entity?.name ?? 'Naming'} - Praxrr</title>
</svelte:head>

{#if entity}
  <div class="mt-6 space-y-6">
    <DetailHeader name={entity.name} arrType={source?.arrType ?? 'radarr'} />

    <DetailCard title="Details">
      <DetailField label="Name" value={entity.name} />
      <DetailField label="File Path" value={entity.file_path} mono />
      <DetailField label="Fetched At" value={formatDate(fetchedAt)} />
    </DetailCard>

    {#if templateEntries.length > 0}
      <div>
        <h3 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          Templates ({templateEntries.length})
        </h3>
        <div class="space-y-4">
          {#each templateEntries as [key, value]}
            <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div class="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <h4 class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  {formatKey(key)}
                </h4>
              </div>
              <div class="p-4">
                {#if typeof value === 'string'}
                  <CodeBlock code={value} />
                {:else}
                  <CodeBlock code={JSON.stringify(value, null, 2)} />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">No templates defined for this naming config.</p>
      </div>
    {/if}
  </div>
{/if}
