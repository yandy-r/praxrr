<script lang="ts">
	import { setContext } from 'svelte';

	export let columns: 1 | 2 | 3 | 4 | 5 = 3;
	export let gap: 'sm' | 'md' | 'lg' = 'md';
	export let flush: boolean = false;
	export let className: string = '';

	$: setContext('card-flush', flush);

	const gapClasses = {
		sm: 'gap-2',
		md: 'gap-4',
		lg: 'gap-6'
	};

	const columnClasses = {
		1: 'grid-cols-1',
		2: 'grid-cols-1 md:grid-cols-2',
		3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
		4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
		5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
	};
</script>

<div class="grid {columnClasses[columns]} {gapClasses[gap]} {className}">
	<slot />
</div>
