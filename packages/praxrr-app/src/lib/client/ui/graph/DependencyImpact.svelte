<script lang="ts">
  import type { components } from '$api/v1.d.ts';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import { Network } from 'lucide-svelte';
  import { NODE_META, focusParam } from './nodeStyles.ts';
  import { formatImpactSummary } from './cascadeSummary.ts';

  type GraphImpactResponse = components['schemas']['GraphImpactResponse'];
  type GraphNodeKind = components['schemas']['GraphNodeKind'];

  // Reusable "Used by" / impact panel embedded in entity editors. Read-only; fed the
  // eager impact payload from the page load(). Referrers link into the dependency-graph
  // page focused on them (the impact payload carries name-keyed refs, not editor ids).
  export let impact: GraphImpactResponse | null = null;
  export let heading = 'Used by';

  interface Referrer {
    kind: GraphNodeKind;
    name: string;
    arrTypes: string[];
  }

  function aggregate(payload: GraphImpactResponse): Referrer[] {
    const useFrom = payload.direction === 'dependents';
    const byKeyed = new Map<string, { kind: GraphNodeKind; name: string; arrTypes: Set<string> }>();
    for (const edge of payload.edges) {
      const ref = useFrom ? edge.from : edge.to;
      const key = `${ref.kind}:${ref.name}`;
      if (!byKeyed.has(key)) byKeyed.set(key, { kind: ref.kind, name: ref.name, arrTypes: new Set() });
      byKeyed.get(key)!.arrTypes.add(edge.arrType);
    }
    return [...byKeyed.values()]
      .map((row) => ({ kind: row.kind, name: row.name, arrTypes: [...row.arrTypes].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function arrVariant(arrType: string): 'radarr' | 'sonarr' | 'lidarr' | 'neutral' {
    return arrType === 'radarr' || arrType === 'sonarr' || arrType === 'lidarr' ? arrType : 'neutral';
  }

  function graphHref(databaseId: number, kind: GraphNodeKind, name: string): string {
    return `/dependency-graph/${databaseId}?focus=${encodeURIComponent(focusParam(kind, name))}`;
  }

  $: referrers = impact ? aggregate(impact) : [];
  $: summary = formatImpactSummary(impact);
</script>

<section class="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
  <div class="mb-2 flex items-center justify-between gap-2">
    <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{heading}</h3>
    {#if impact && impact.hasDownstream}
      <Button
        text="View in graph"
        variant="ghost"
        size="xs"
        icon={Network}
        href={graphHref(impact.databaseId, impact.node.kind, impact.node.name)}
      />
    {/if}
  </div>

  <p class="mb-3 text-sm text-neutral-600 dark:text-neutral-300">{summary}</p>

  {#if impact && referrers.length > 0}
    <ul class="flex flex-col gap-1.5">
      {#each referrers as referrer (referrer.kind + ':' + referrer.name)}
        <li class="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={NODE_META[referrer.kind].badgeVariant} size="sm">
            {NODE_META[referrer.kind].label}
          </Badge>
          <a
            class="text-accent-700 dark:text-accent-300 font-medium hover:underline"
            href={graphHref(impact.databaseId, referrer.kind, referrer.name)}
          >
            {referrer.name}
          </a>
          {#each referrer.arrTypes as arrType (arrType)}
            <Badge variant={arrVariant(arrType)} size="sm">{arrType}</Badge>
          {/each}
        </li>
      {/each}
    </ul>
  {:else}
    <div
      class="rounded border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
    >
      No other entities depend on this yet.
    </div>
  {/if}
</section>
