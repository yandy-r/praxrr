<script lang="ts">
	import Badge from '$ui/badge/Badge.svelte';
	import { getArrAppMetadata, type ArrAppType } from '$shared/arr/capabilities.ts';

	export let compatibleArrTypes: ArrAppType[];
	export let label = 'Usable by:';
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#if label}
		<span class="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
	{/if}
	{#if compatibleArrTypes.length === 0}
		<span class="text-xs text-neutral-400 italic dark:text-neutral-500">No compatible apps</span>
	{:else}
		{#each compatibleArrTypes as arrType (arrType)}
			<Badge variant={arrType}>{getArrAppMetadata(arrType).label}</Badge>
		{/each}
	{/if}
</div>
