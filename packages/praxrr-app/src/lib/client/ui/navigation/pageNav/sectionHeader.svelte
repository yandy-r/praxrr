<script lang="ts">
	export let label: string;
</script>

<div class="my-3 px-3 space-y-2">
	<div class="h-px rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
	<p
		class="pl-1 text-left text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400"
	>
		{label}
	</p>
	<div class="h-px rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
</div>
