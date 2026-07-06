<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getComplexityTierContext } from './complexityTierContext';
	import type { ComplexityTier } from '$shared/complexity/tiers.ts';

	const ADVANCED_TOGGLES_BEFORE_SUGGEST = 5;

	const context = getComplexityTierContext();
	const unsubscribers: Array<() => void> = [];
	let currentTier: ComplexityTier = 'beginner';
	let advancedToggleCount = 0;
	let lastSuggestedTier: ComplexityTier | null = null;
	let suggestionDismissedAt: string | null = null;

	if (context) {
		unsubscribers.push(
			context.tier.subscribe((value) => {
				currentTier = value;
			}),
			context.advancedToggleCount.subscribe((value) => {
				advancedToggleCount = value;
			}),
			context.lastSuggestedTier.subscribe((value) => {
				lastSuggestedTier = value;
			}),
			context.suggestionDismissedAt.subscribe((value) => {
				suggestionDismissedAt = value;
			})
		);
	}

	$: suggestedTier = (
		currentTier === 'beginner' ? 'intermediate' : currentTier === 'intermediate' ? 'advanced' : null
	) as ComplexityTier | null;
	$: showHint =
		!!context &&
		suggestedTier !== null &&
		advancedToggleCount >= ADVANCED_TOGGLES_BEFORE_SUGGEST &&
		(lastSuggestedTier !== suggestedTier || suggestionDismissedAt === null);

	async function acceptSuggestion() {
		if (!context || !suggestedTier) {
			return;
		}

		context.tier.set(suggestedTier);
		await context.dismissSuggestion(suggestedTier);
	}

	async function dismissSuggestion() {
		if (!context || !suggestedTier) {
			return;
		}

		await context.dismissSuggestion(suggestedTier);
	}

	onDestroy(() => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}
	});
</script>

{#if showHint && suggestedTier}
	<div
		class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100"
		aria-live="polite"
	>
		<p class="min-w-0 flex-1">
			Opening lots of advanced options — switch this area to {suggestedTier}?
		</p>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-md bg-amber-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
				onclick={acceptSuggestion}
			>
				Switch
			</button>
			<button
				type="button"
				class="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/50"
				onclick={dismissSuggestion}
			>
				Not now
			</button>
		</div>
	</div>
{/if}
