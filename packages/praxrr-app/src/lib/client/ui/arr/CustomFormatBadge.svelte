<script lang="ts">
	export let name: string;
	export let score: number;

	$: scoreClass =
		score > 0
			? 'text-emerald-600 dark:text-emerald-400'
			: score < 0
				? 'text-red-600 dark:text-red-400'
				: 'text-neutral-500';

	$: displayScore = score > 0 ? `+${score.toLocaleString()}` : score.toLocaleString();
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
>
	<span class="text-neutral-500 dark:text-neutral-400">{name}</span>
	<span class="font-mono font-medium {scoreClass}">{displayScore}</span>
</span>
