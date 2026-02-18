<script lang="ts">
	import { getContext } from 'svelte';

	export let padding: 'none' | 'sm' | 'md' | 'lg' = 'md';
	export let hoverable: boolean = false;
	export let href: string | undefined = undefined;
	export let onclick: (() => void) | undefined = undefined;
	export let flush: boolean = false;
	export let className: string = '';

	let contextFlush = false;
	try {
		contextFlush = getContext<boolean>('card-flush') ?? false;
	} catch {
		/* no parent CardGrid */
	}
	$: isFlush = flush || contextFlush;

	$: hasHeader = !!$$slots.header;
	$: hasFooter = !!$$slots.footer;
	$: interactive = !!href || !!onclick;

	$: paddingClass = {
		none: '',
		sm: 'px-3 py-2',
		md: 'px-4 py-3',
		lg: 'px-5 py-4'
	}[padding];

	$: dividerClass = {
		none: '',
		sm: 'mx-3',
		md: 'mx-4',
		lg: 'mx-5'
	}[padding];

	$: bgClass = isFlush ? 'bg-neutral-50 dark:bg-neutral-900' : 'bg-white dark:bg-neutral-800/50';

	$: hoverClass =
		hoverable || interactive
			? isFlush
				? 'transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/60'
				: 'transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/80'
			: '';

	$: cursorClass = interactive ? 'cursor-pointer' : '';

	$: cardClass = `overflow-hidden rounded-xl border border-neutral-300 dark:border-neutral-700/60 ${bgClass} ${hoverClass} ${cursorClass} ${className}`;
</script>

{#if href}
	<a {href} class={cardClass}>
		{#if hasHeader}
			<div class={paddingClass}>
				<slot name="header" />
			</div>
			<div class="border-t border-neutral-200 dark:border-neutral-700/60 {dividerClass}"></div>
		{/if}

		<div class={paddingClass}>
			<slot />
		</div>

		{#if hasFooter}
			<div class="border-t border-neutral-200 dark:border-neutral-700/60 {dividerClass}"></div>
			<div class={paddingClass}>
				<slot name="footer" />
			</div>
		{/if}
	</a>
{:else}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class={cardClass} on:click={onclick}>
		{#if hasHeader}
			<div class={paddingClass}>
				<slot name="header" />
			</div>
			<div class="border-t border-neutral-200 dark:border-neutral-700/60 {dividerClass}"></div>
		{/if}

		<div class={paddingClass}>
			<slot />
		</div>

		{#if hasFooter}
			<div class="border-t border-neutral-200 dark:border-neutral-700/60 {dividerClass}"></div>
			<div class={paddingClass}>
				<slot name="footer" />
			</div>
		{/if}
	</div>
{/if}
