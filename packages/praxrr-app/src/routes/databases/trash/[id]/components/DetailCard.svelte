<script lang="ts">
	export let title: string = '';
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	{#if title}
		<div class="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
			<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
				{title}
			</h3>
		</div>
	{/if}
	<div class="divide-y divide-neutral-200 dark:divide-neutral-800">
		<slot />
	</div>
</div>
