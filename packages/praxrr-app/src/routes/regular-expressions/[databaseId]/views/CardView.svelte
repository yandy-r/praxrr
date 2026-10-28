<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { RegularExpressionWithTags } from '$shared/pcd/display';
  import { ExternalLink, Copy, Download, DatabaseZap, ClipboardCopy } from 'lucide-svelte';
  import { page } from '$app/stores';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Card from '$ui/card/Card.svelte';
  import Button from '$ui/button/Button.svelte';
  import Label from '$ui/label/Label.svelte';
  import CodeBlock from '$ui/display/CodeBlock.svelte';
  import Markdown from '$ui/display/Markdown.svelte';
  import { createProgressiveList } from '$lib/client/utils/progressiveList';
  import LocallyModifiedBadge from '$ui/badge/LocallyModifiedBadge.svelte';

  export let expressions: RegularExpressionWithTags[];

  const dispatch = createEventDispatcher<{
    clone: { name: string };
    export: { name: string };
    copy: { name: string };
    clipboard: { name: string };
  }>();

  $: databaseId = $page.params.databaseId;

  const { visibleCount, sentinel, reset, setTotalCount } = createProgressiveList({ pageSize: 30 });
  $: setTotalCount(expressions.length);
  $: {
    void expressions;
    reset();
  }
  $: visibleExpressions = expressions.slice(0, $visibleCount);
</script>

<CardGrid flush>
  {#each visibleExpressions as expression (expression.id)}
    <Card hoverable className="relative">
      <a
        href={`/regular-expressions/${databaseId}/${expression.id}`}
        aria-label={expression.name}
        class="absolute inset-0 rounded-xl"
      ></a>
      <svelte:fragment slot="header">
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <span class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{expression.name}</span>
            {#if expression.locallyModified}
              <LocallyModifiedBadge />
            {/if}
            {#each expression.tags as tag}
              <Label variant="info" size="sm" rounded="md">{tag.name}</Label>
            {/each}
          </div>
          <div class="relative z-10 flex shrink-0 items-center gap-0.5">
            {#if expression.regex101_id}
              <Button
                icon={ExternalLink}
                size="xs"
                variant="ghost"
                tooltip="View on regex101"
                on:click={() => window.open(`https://regex101.com/r/${expression.regex101_id}`, '_blank')}
              />
            {/if}
            <Button
              icon={Download}
              size="xs"
              variant="ghost"
              tooltip="Download bundle"
              on:click={() => dispatch('export', { name: expression.name })}
            />
            <Button
              icon={DatabaseZap}
              size="xs"
              variant="ghost"
              tooltip="Copy to database…"
              on:click={() => dispatch('copy', { name: expression.name })}
            />
            <Button
              icon={ClipboardCopy}
              size="xs"
              variant="ghost"
              tooltip="Copy JSON to clipboard"
              on:click={() => dispatch('clipboard', { name: expression.name })}
            />
            <Button
              icon={Copy}
              size="xs"
              variant="ghost"
              tooltip="Clone"
              on:click={() => dispatch('clone', { name: expression.name })}
            />
          </div>
        </div>
      </svelte:fragment>

      <div class="space-y-3">
        <CodeBlock code={expression.pattern} />
        {#if expression.description}
          <Markdown content={expression.description} />
        {/if}
      </div>
    </Card>
  {/each}
</CardGrid>
<div use:sentinel></div>
