<script lang="ts">
	/**
	 * Displays a numeric score with optional color coding.
	 * - Positive: green with + prefix (when colored=true)
	 * - Negative: red (when colored=true)
	 * - Zero/neutral: neutral gray
	 */
	export let score: number | null = null;
	export let showSign: boolean = true;
	export let size: 'sm' | 'md' = 'md';
	export let colored: boolean = true;

	$: colorClass =
		score === null
			? 'text-neutral-400'
			: !colored
				? 'text-neutral-900 dark:text-neutral-100'
				: score > 0
					? 'text-emerald-600 dark:text-emerald-400'
					: score < 0
						? 'text-red-600 dark:text-red-400'
						: 'text-neutral-500';

	$: sizeClass = size === 'sm' ? 'text-xs' : 'text-sm';

	$: displayValue =
		score === null
			? null
			: showSign && score > 0
				? `+${score.toLocaleString()}`
				: score.toLocaleString();
</script>

{#if score !== null}
	<span class="font-mono font-medium {colorClass} {sizeClass}">
		{displayValue}
	</span>
{:else}
	<span class="text-neutral-400 {sizeClass}">—</span>
{/if}
