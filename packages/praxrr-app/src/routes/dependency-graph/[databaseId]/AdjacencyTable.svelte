<script lang="ts">
  import type { components } from '$api/v1.d.ts';
  import ExpandableTable from '$ui/table/ExpandableTable.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import CompatibilityBadges from '$ui/parity/CompatibilityBadges.svelte';
  import type { Column } from '$ui/table/types';
  import type { ArrAppType } from '$shared/arr/capabilities.ts';
  import { NODE_META, nodeEditorHref } from '$ui/graph/nodeStyles.ts';

  type GraphNode = components['schemas']['GraphNode'];
  type GraphEdge = components['schemas']['GraphEdge'];
  type GraphNodeKind = components['schemas']['GraphNodeKind'];

  // Default dependency-graph view: one row per node with in/out degree, kind, and arr
  // compatibility; expand reveals the 1-hop neighbours as editor links (the interactive
  // click-to-navigate requirement, no JS graph needed).
  export let nodes: GraphNode[] = [];
  export let edges: GraphEdge[] = [];
  export let databaseId: number;
  /** `kind:name` of a node to pre-expand (from the `?focus=` deep-link). */
  export let focusKey: string | null = null;

  interface NeighborLink {
    kind: GraphNodeKind;
    name: string;
    routeId: number | null;
    arrTypes: string[];
  }

  const refKey = (kind: string, name: string): string => `${kind}:${name}`;

  let expandedRows: Set<string> = new Set();

  $: nodeIndex = new Map(nodes.map((node) => [refKey(node.kind, node.name), node]));

  // Pre-expand the focused node once (from the ?focus= deep-link). Tracks the applied
  // value so a user collapsing the row is not undone on the next reactive pass.
  let appliedFocus: string | null = null;
  $: if (focusKey && focusKey !== appliedFocus && nodeIndex.has(focusKey)) {
    appliedFocus = focusKey;
    expandedRows = new Set(expandedRows).add(focusKey);
  }

  // Precompute 1-hop neighbours for every node: dependsOn = outgoing edge targets,
  // referencedBy = incoming edge sources. Neighbour routeId comes from the full node set.
  $: adjacency = buildAdjacency(nodes, edges, nodeIndex);

  function buildAdjacency(
    allNodes: GraphNode[],
    allEdges: GraphEdge[],
    index: Map<string, GraphNode>
  ): Map<string, { dependsOn: NeighborLink[]; referencedBy: NeighborLink[] }> {
    const result = new Map<string, { dependsOn: Map<string, NeighborLink>; referencedBy: Map<string, NeighborLink> }>();
    for (const node of allNodes) {
      result.set(refKey(node.kind, node.name), { dependsOn: new Map(), referencedBy: new Map() });
    }
    const link = (kind: GraphNodeKind, name: string, arrType: string, bucket: Map<string, NeighborLink>) => {
      const key = refKey(kind, name);
      if (!bucket.has(key)) {
        bucket.set(key, { kind, name, routeId: index.get(key)?.routeId ?? null, arrTypes: [] });
      }
      const entry = bucket.get(key)!;
      if (!entry.arrTypes.includes(arrType)) entry.arrTypes.push(arrType);
    };
    for (const edge of allEdges) {
      const fromEntry = result.get(refKey(edge.from.kind, edge.from.name));
      const toEntry = result.get(refKey(edge.to.kind, edge.to.name));
      if (fromEntry) link(edge.to.kind, edge.to.name, edge.arrType, fromEntry.dependsOn);
      if (toEntry) link(edge.from.kind, edge.from.name, edge.arrType, toEntry.referencedBy);
    }
    return new Map(
      [...result.entries()].map(([key, value]) => [
        key,
        {
          dependsOn: [...value.dependsOn.values()].sort((a, b) => a.name.localeCompare(b.name)),
          referencedBy: [...value.referencedBy.values()].sort((a, b) => a.name.localeCompare(b.name)),
        },
      ])
    );
  }

  function arrVariant(arrType: string): 'radarr' | 'sonarr' | 'lidarr' | 'neutral' {
    return arrType === 'radarr' || arrType === 'sonarr' || arrType === 'lidarr' ? arrType : 'neutral';
  }

  const columns: Column<GraphNode>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'kind', header: 'Type', sortable: true },
    { key: 'outDegree', header: 'Depends on', sortable: true, align: 'center' },
    { key: 'inDegree', header: 'Referenced by', sortable: true, align: 'center' },
    { key: 'compat', header: 'Compatible', sortable: false },
  ];
</script>

<ExpandableTable
  {columns}
  data={nodes}
  getRowId={(row) => refKey(row.kind, row.name)}
  bind:expandedRows
  chevronPosition="right"
  emptyMessage="No entities to graph in this database yet."
  responsive
>
  <svelte:fragment slot="cell" let:row let:column>
    {#if column.key === 'name'}
      {@const href = nodeEditorHref(row.kind, databaseId, row.routeId)}
      {#if href}
        <a class="text-accent-700 dark:text-accent-300 font-medium hover:underline" {href}>{row.name}</a>
      {:else}
        <span class="font-medium text-neutral-900 dark:text-neutral-100">{row.name}</span>
      {/if}
    {:else if column.key === 'kind'}
      <Badge variant={NODE_META[row.kind].badgeVariant} size="sm">{NODE_META[row.kind].label}</Badge>
    {:else if column.key === 'outDegree'}
      <span class="font-mono text-neutral-600 dark:text-neutral-400">{row.outDegree}</span>
    {:else if column.key === 'inDegree'}
      <span class="font-mono text-neutral-600 dark:text-neutral-400">{row.inDegree}</span>
    {:else if column.key === 'compat'}
      {#if row.compatibleArrTypes && row.compatibleArrTypes.length > 0}
        <CompatibilityBadges compatibleArrTypes={row.compatibleArrTypes as ArrAppType[]} label="" />
      {:else}
        <span class="text-neutral-400">—</span>
      {/if}
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="expanded" let:row>
    {@const neighbors = adjacency.get(refKey(row.kind, row.name))}
    <div class="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <div class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Depends on
        </div>
        {#if neighbors && neighbors.dependsOn.length > 0}
          <ul class="flex flex-col gap-1.5">
            {#each neighbors.dependsOn as neighbor (refKey(neighbor.kind, neighbor.name))}
              {@const href = nodeEditorHref(neighbor.kind, databaseId, neighbor.routeId)}
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={NODE_META[neighbor.kind].badgeVariant} size="sm">
                  {NODE_META[neighbor.kind].label}
                </Badge>
                {#if href}
                  <a class="text-accent-700 dark:text-accent-300 hover:underline" {href}>{neighbor.name}</a>
                {:else}
                  <span class="text-neutral-800 dark:text-neutral-200">{neighbor.name}</span>
                {/if}
                {#each neighbor.arrTypes as arrType (arrType)}
                  <Badge variant={arrVariant(arrType)} size="sm">{arrType}</Badge>
                {/each}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-neutral-400">Nothing.</div>
        {/if}
      </div>
      <div>
        <div class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Referenced by
        </div>
        {#if neighbors && neighbors.referencedBy.length > 0}
          <ul class="flex flex-col gap-1.5">
            {#each neighbors.referencedBy as neighbor (refKey(neighbor.kind, neighbor.name))}
              {@const href = nodeEditorHref(neighbor.kind, databaseId, neighbor.routeId)}
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={NODE_META[neighbor.kind].badgeVariant} size="sm">
                  {NODE_META[neighbor.kind].label}
                </Badge>
                {#if href}
                  <a class="text-accent-700 dark:text-accent-300 hover:underline" {href}>{neighbor.name}</a>
                {:else}
                  <span class="text-neutral-800 dark:text-neutral-200">{neighbor.name}</span>
                {/if}
                {#each neighbor.arrTypes as arrType (arrType)}
                  <Badge variant={arrVariant(arrType)} size="sm">{arrType}</Badge>
                {/each}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-sm text-neutral-400">Nothing.</div>
        {/if}
      </div>
    </div>
  </svelte:fragment>
</ExpandableTable>
