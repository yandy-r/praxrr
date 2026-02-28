<script lang="ts">
	export let label: string;
	export let value: string | number | boolean | null | undefined = undefined;
	export let mono: boolean = false;
</script>

<div class="flex items-center justify-between px-4 py-3">
	<span class="text-sm text-neutral-500 dark:text-neutral-400">{label}</span>
	<span
		class="text-sm text-neutral-900 dark:text-neutral-50 {mono ? 'font-mono' : ''}"
	>
		{#if value !== undefined && value !== null}
			{value}
		{:else}
			<slot />
		{/if}
	</span>
</div>
