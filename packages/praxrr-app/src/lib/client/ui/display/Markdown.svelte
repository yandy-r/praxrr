<script lang="ts">
  import { parseMarkdown, parseMarkdownInline } from '$shared/markdown/markdown.ts';

  export let content: string | null = null;
  export let inline: boolean = true;
  export let maxLines: number | undefined = undefined;

  $: html = inline ? parseMarkdownInline(content) : parseMarkdown(content);
</script>

{#if html}
  <span
    class="markdown text-xs text-neutral-600 dark:text-neutral-400"
    style={maxLines
      ? `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${maxLines}; overflow: hidden;`
      : ''}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via $shared/markdown -->
    {@html html}
  </span>
{/if}

<style>
  .markdown :global(code) {
    background-color: rgb(229 231 235);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
  }

  :global(.dark) .markdown :global(code) {
    background-color: rgb(38 38 38);
  }

  .markdown :global(strong) {
    font-weight: 600;
  }

  .markdown :global(a) {
    color: rgb(var(--color-accent-600));
    text-decoration: underline;
  }

  :global(.dark) .markdown :global(a) {
    color: rgb(var(--color-accent-400));
  }
</style>
