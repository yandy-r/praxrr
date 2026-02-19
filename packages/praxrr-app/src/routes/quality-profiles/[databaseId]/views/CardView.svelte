<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
	import { page } from '$app/stores';
	import { BookOpenText, Gauge, Earth, Copy, Download } from 'lucide-svelte';
	import CardGrid from '$ui/card/CardGrid.svelte';
	import Card from '$ui/card/Card.svelte';
	import Label from '$ui/label/Label.svelte';
	import Button from '$ui/button/Button.svelte';
	import { createProgressiveList } from '$lib/client/utils/progressiveList';

	export let profiles: QualityProfileTableRow[];

	const dispatch = createEventDispatcher<{ clone: { name: string }; export: { name: string } }>();

	$: databaseId = $page.params.databaseId;

	const { visibleCount, sentinel, reset, setTotalCount } = createProgressiveList({ pageSize: 30 });
	$: setTotalCount(profiles.length);
	$: profiles, reset();
	$: visibleProfiles = profiles.slice(0, $visibleCount);
</script>

<CardGrid flush>
	{#each visibleProfiles as profile}
		<Card href="/quality-profiles/{databaseId}/{profile.id}/general" hoverable>
			<svelte:fragment slot="header">
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div class="flex items-start justify-between gap-2">
					<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{profile.name}</h3>
					<div class="flex shrink-0 items-center gap-0.5" on:click|stopPropagation|preventDefault>
						<Button
							icon={Download}
							size="xs"
							variant="ghost"
							tooltip="Export"
							on:click={() => dispatch('export', { name: profile.name })}
						/>
						<Button
							icon={Copy}
							size="xs"
							variant="ghost"
							tooltip="Clone"
							on:click={() => dispatch('clone', { name: profile.name })}
						/>
					</div>
				</div>
			</svelte:fragment>

			<div class="space-y-3">
				{#if profile.tags.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each profile.tags as tag}
							<Label variant="info" size="sm" rounded="md">{tag.name}</Label>
						{/each}
					</div>
				{/if}

				{#if profile.description}
					<div class="description text-xs text-neutral-600 dark:text-neutral-400">
						{@html profile.description}
					</div>
				{/if}

				<!-- Qualities -->
				<div class="flex flex-wrap items-center gap-1">
					{#each profile.qualities.slice(0, 3) as quality, idx}
						{#if idx > 0}
							<span class="text-xs text-neutral-400">›</span>
						{/if}
						<Label
							variant={quality.is_upgrade_until ? 'success' : 'secondary'}
							size="sm"
							rounded="md"
							mono
						>{quality.name}</Label>
					{/each}
					{#if profile.qualities.length > 3}
						<span class="text-[10px] text-neutral-500 dark:text-neutral-400">
							+{profile.qualities.length - 3} more
						</span>
					{/if}
				</div>
			</div>

			<svelte:fragment slot="footer">
				<div class="flex items-center gap-3 text-xs">
					<div class="flex items-center gap-1">
						<BookOpenText size={12} class="text-neutral-400" />
						<Label variant="secondary" size="sm" rounded="md" mono>{profile.custom_formats.total}</Label>
					</div>
					<div class="flex items-center gap-1">
						<Gauge size={12} class="text-neutral-400" />
						<Label variant="secondary" size="sm" rounded="md" mono>{profile.minimum_custom_format_score}</Label>
					</div>
					<div class="flex items-center gap-1">
						<Earth size={12} class="text-neutral-400" />
						<Label variant="secondary" size="sm" rounded="md">{profile.language ? profile.language.name : 'Any'}</Label>
					</div>
				</div>
			</svelte:fragment>
		</Card>
	{/each}
</CardGrid>
<div use:sentinel></div>

<style>
	.description :global(ul) {
		list-style-type: disc;
		padding-left: 1.5rem;
		margin: 0.5rem 0;
	}

	.description :global(ol) {
		list-style-type: decimal;
		padding-left: 1.5rem;
		margin: 0.5rem 0;
	}

	.description :global(li) {
		margin: 0.25rem 0;
	}

	.description :global(p) {
		margin: 0.5rem 0;
	}

	.description :global(strong) {
		font-weight: 600;
	}
</style>
