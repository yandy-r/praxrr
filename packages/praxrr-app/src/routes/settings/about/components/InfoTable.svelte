<script lang="ts">
	export let title: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let icon: any = undefined;
</script>

<div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
	<div
		class="border-b border-neutral-200 bg-neutral-50 px-6 py-3 dark:border-neutral-800 dark:bg-neutral-800"
	>
		<div class="flex items-center gap-2">
			{#if icon}
				<svelte:component this={icon} class="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
			{/if}
			<h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
		</div>
	</div>
	<table class="w-full">
		<tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
			<slot />
		</tbody>
	</table>
</div>
