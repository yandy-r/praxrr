<script lang="ts">
	import { RotateCcw } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { getComplexityTierContext } from './complexityTierContext';
	import { COMPLEXITY_TIERS, type ComplexityTier } from '$shared/complexity/tiers.ts';

	const context = getComplexityTierContext();
	const unsubscribers: Array<() => void> = [];
	let activeTier: ComplexityTier = 'beginner';

	const labels: Record<ComplexityTier, string> = {
		beginner: 'Beginner',
		intermediate: 'Intermediate',
		advanced: 'Advanced'
	};

	if (context) {
		unsubscribers.push(
			context.tier.subscribe((value) => {
				activeTier = value;
			})
		);
	}

	function setTier(tier: ComplexityTier) {
		context?.tier.set(tier);
	}

	function resetTier() {
		context?.tier.set('beginner');
	}

	onDestroy(() => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}
	});
</script>

{#if context}
	<div class="flex flex-wrap items-center gap-2">
		<div class="inline-flex overflow-hidden rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
			{#each COMPLEXITY_TIERS as tier}
				<button
					type="button"
					class="px-2.5 py-1.5 text-xs font-medium transition-colors {activeTier === tier
						? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-950'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'}"
					aria-pressed={activeTier === tier}
					onclick={() => setTier(tier)}
				>
					{labels[tier]}
				</button>
			{/each}
		</div>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
			disabled={activeTier === 'beginner'}
			onclick={resetTier}
		>
			<RotateCcw size={13} />
			Reset
		</button>
	</div>
{/if}
