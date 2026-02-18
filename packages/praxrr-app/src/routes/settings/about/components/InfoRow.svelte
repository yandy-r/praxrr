<script lang="ts">
	export let label: string;
	export let value: string;
	export let type: 'text' | 'code' | 'link' = 'text';
	export let href: string | undefined = undefined;
</script>

<tr class="bg-white dark:bg-neutral-900">
	<td class="w-1/3 px-6 py-4 text-sm font-medium text-neutral-900 dark:text-neutral-50">
		{label}
	</td>
	<td class="px-6 py-4 text-sm">
		{#if type === 'code'}
			<code
				class="rounded bg-neutral-100 px-2 py-1 font-mono text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
			>
				{value}
			</code>
		{:else if type === 'link' && href}
			<a
				{href}
				target="_blank"
				rel="noopener noreferrer"
				data-sveltekit-reload
				class="rounded bg-neutral-100 px-2 py-1 font-mono text-accent-600 hover:text-accent-700 dark:bg-neutral-800 dark:text-accent-400 dark:hover:text-accent-300"
			>
				{value}
			</a>
		{:else}
			{value}
		{/if}
	</td>
</tr>
