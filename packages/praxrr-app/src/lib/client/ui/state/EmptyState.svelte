<script lang="ts">
	import { Plus } from 'lucide-svelte';

	export let icon: any; // Lucide icon component
	export let title: string;
	export let description: string;
	export let buttonText: string;
	export let buttonHref: string;
	export let buttonIcon: any = Plus; // Default to Plus icon
</script>

<div class="flex min-h-[calc(100vh-4rem)] items-center justify-center p-8">
	<div class="w-full max-w-md text-center">
		<!-- Icon -->
		<div class="mb-6 flex justify-center">
			<div class="rounded-full bg-neutral-100 p-6 dark:bg-neutral-800">
				<svelte:component this={icon} class="h-12 w-12 text-neutral-400 dark:text-neutral-500" />
			</div>
		</div>

		<!-- Title -->
		<h1 class="mb-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
			{title}
		</h1>

		<!-- Description -->
		<p class="mb-8 text-neutral-600 dark:text-neutral-400">
			{description}
		</p>

		<!-- Action Button -->
		<a
			href={buttonHref}
			class="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
		>
			<svelte:component this={buttonIcon} size={18} />
			{buttonText}
		</a>
	</div>
</div>
