<script lang="ts">
  import { AlertTriangle, Info } from 'lucide-svelte';
  import type { ArrCompatibilityResult, ArrSupportTier } from '$shared/arr/compatibility.ts';

  export let compatibility: ArrCompatibilityResult | undefined = undefined;

  type BannerTone = 'warning' | 'danger' | 'neutral';

  // Only degraded/unsupported are alarming; unknown gets a mild neutral note,
  // supported (incl. untested_newer-only) renders nothing.
  const TONE_BY_TIER: Record<ArrSupportTier, BannerTone | null> = {
    supported: null,
    degraded: 'warning',
    unsupported: 'danger',
    unknown: 'neutral',
  };

  const CONTAINER_CLASSES: Record<BannerTone, string> = {
    warning:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200',
    danger: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200',
    neutral:
      'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/40 dark:text-neutral-300',
  };

  function formatFeature(feature: string): string {
    return feature.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  $: tone = compatibility ? TONE_BY_TIER[compatibility.tier] : null;
  $: warnings = compatibility?.warnings ?? [];
  $: disabledFeatures = compatibility?.disabledFeatures ?? [];
  $: docsHref = warnings.find((warning) => warning.docsHref)?.docsHref ?? compatibility?.range?.docsHref;
  $: icon = tone === 'neutral' ? Info : AlertTriangle;
</script>

{#if compatibility && tone}
  <div role="status" class="flex items-start gap-2 rounded-lg border p-3 text-sm {CONTAINER_CLASSES[tone]}">
    <svelte:component this={icon} size={18} class="mt-0.5 shrink-0" />
    <div class="flex flex-col gap-1">
      {#each warnings as warning (warning.code)}
        <p class="font-medium">{warning.message}</p>
      {/each}
      {#if disabledFeatures.length > 0}
        <p class="text-xs opacity-90">
          Unavailable features: {disabledFeatures.map(formatFeature).join(', ')}
        </p>
      {/if}
      {#if docsHref}
        <a href={docsHref} target="_blank" rel="noopener noreferrer" class="text-xs font-medium underline">
          View compatibility docs
        </a>
      {/if}
    </div>
  </div>
{/if}
