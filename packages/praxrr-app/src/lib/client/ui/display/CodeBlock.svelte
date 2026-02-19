<script lang="ts">
	export let code: string;
	export let maxLines: number | undefined = undefined;
</script>

<pre class="rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800"><code
		class="block font-mono break-all whitespace-pre-wrap text-neutral-900 dark:text-neutral-100"
		style={maxLines
			? `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${maxLines}; overflow: hidden;`
			: ''}>{code}</code
	></pre>
