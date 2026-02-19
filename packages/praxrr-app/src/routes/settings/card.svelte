<script lang="ts">
	export let label: string;
	export let href: string;
	export let description: string;
</script>

<a
	{href}
	class="block rounded-lg border-2 border-neutral-200 bg-white p-5 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
>
	<h2 class="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
		{label}
	</h2>
	<p class="text-sm text-neutral-600 dark:text-neutral-400">
		{description}
	</p>
</a>
