<script lang="ts">
	import {
		ARR_SEMANTIC_DIFFERENCES,
		type ArrSemanticDifference,
		type ParityScope
	} from '$shared/arr/semanticDifferences.ts';
	import { getArrAppMetadata } from '$shared/arr/capabilities.ts';
	import { PARITY_ENTITY_LABELS } from '$shared/arr/parity.ts';
	import Badge from '$ui/badge/Badge.svelte';

	/** Defaults to the full catalog; accepted as a prop so callers can filter/test in isolation. */
	export let differences: ArrSemanticDifference[] = ARR_SEMANTIC_DIFFERENCES;

	/**
	 * Group heading per scope. Entity labels are reused from the single-source
	 * `PARITY_ENTITY_LABELS`; only the workflow-surface labels are authored here.
	 * Exhaustive so a new `ParityScope` member fails to compile until labeled.
	 */
	const SCOPE_LABELS = {
		...PARITY_ENTITY_LABELS,
		instances: 'Instances',
		library: 'Library',
		releases: 'Releases',
		rename: 'Rename',
		upgrades: 'Upgrades'
	} as const satisfies Record<ParityScope, string>;

	interface ScopeGroup {
		scope: ParityScope;
		label: string;
		entries: ArrSemanticDifference[];
	}

	/** Group catalog entries by scope, preserving each scope's first-seen order. */
	function groupByScope(entries: ArrSemanticDifference[]): ScopeGroup[] {
		const groups: ScopeGroup[] = [];
		const indexByScope = new Map<ParityScope, number>();
		for (const entry of entries) {
			let index = indexByScope.get(entry.scope);
			if (index === undefined) {
				index = groups.length;
				indexByScope.set(entry.scope, index);
				groups.push({ scope: entry.scope, label: SCOPE_LABELS[entry.scope], entries: [] });
			}
			groups[index].entries.push(entry);
		}
		return groups;
	}

	$: scopeGroups = groupByScope(differences);
</script>

<div class="space-y-6">
	{#each scopeGroups as group (group.scope)}
		<section>
			<h3 class="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
				{group.label}
			</h3>
			<div class="space-y-3">
				{#each group.entries as entry (entry.summary)}
					<div
						class="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
					>
						<div class="flex flex-wrap items-center gap-2">
							<p class="text-sm font-medium">{entry.summary}</p>
							<div class="flex flex-wrap gap-1">
								{#each entry.apps as app (app)}
									<Badge variant={app} size="sm">{getArrAppMetadata(app).label}</Badge>
								{/each}
							</div>
						</div>
						<p class="mt-1 text-sm">{entry.detail}</p>
						{#if entry.suggestion}
							<p class="mt-1 text-sm font-medium">{entry.suggestion}</p>
						{/if}
						{#if entry.sourceRefs.length > 0}
							<p class="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
								{entry.sourceRefs.join(' · ')}
							</p>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>
