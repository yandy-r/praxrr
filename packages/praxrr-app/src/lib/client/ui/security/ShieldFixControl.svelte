<script lang="ts">
  import type { WireFix } from '$lib/server/security/responses.ts';

  /**
   * Renders a single {@link WireFix} — the concrete "here's how to fix it" affordance attached to a
   * shield recommendation or advisory. Internal targets are in-app links; `docs` opens externally;
   * `env-var` is a copyable-looking code chip naming the exact variable to set. `none` renders nothing
   * (only informational recommendations carry `none`, and warning/danger ones never do).
   */
  export let fix: WireFix;

  const linkClass = 'text-accent-600 dark:text-accent-500 text-xs font-medium hover:underline';
</script>

{#if fix.kind === 'settings-link' || fix.kind === 'instance-link'}
  <a href={fix.href} class={linkClass}>{fix.label} →</a>
{:else if fix.kind === 'docs'}
  <a href={fix.href} target="_blank" rel="noopener noreferrer" class={linkClass}>{fix.label} ↗</a>
{:else if fix.kind === 'env-var'}
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <code
      class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
    >
      {fix.name}
    </code>
    <span class="text-xs text-neutral-600 dark:text-neutral-400">{fix.label}</span>
    {#if fix.docHref}
      <a href={fix.docHref} target="_blank" rel="noopener noreferrer" class={linkClass}>docs ↗</a>
    {/if}
  </span>
{/if}
