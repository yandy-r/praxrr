<script lang="ts">
	export let status: 'up-to-date' | 'out-of-date' | 'dev-build';

	const statusConfig = {
		'up-to-date': {
			label: 'Up to date',
			class: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
		},
		'out-of-date': {
			label: 'Out of date',
			class: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
		},
		'dev-build': {
			label: 'Dev build',
			class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
		}
	};

	const config = statusConfig[status];
</script>

<span
	class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {config.class}"
>
	{config.label}
</span>
