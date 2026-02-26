<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { CustomFormatTableRow } from '$shared/pcd/display.ts';
	import type { SourceRef } from '$shared/sources/types.ts';
	import { FlaskConical, Copy, Download } from 'lucide-svelte';
	import { marked } from 'marked';
	import { sortConditions } from '$shared/pcd/conditions';
	import CardGrid from '$ui/card/CardGrid.svelte';
	import Card from '$ui/card/Card.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import SourceBadge from '$ui/badge/SourceBadge.svelte';
	import Label from '$ui/label/Label.svelte';
	import Button from '$ui/button/Button.svelte';
	import { createProgressiveList } from '$lib/client/utils/progressiveList';
	import {
		getArrAppMetadata,
		isArrAppType,
		type ArrAppType,
		type ArrConditionTargetType
	} from '$shared/arr/capabilities.ts';

	export let formats: CustomFormatTableRow[];
	export let sources: SourceRef[] = [];
	export let currentDatabaseId: number;
	export let currentDatabaseName: string;
	export let showSourceBadges: boolean = false;

	const dispatch = createEventDispatcher<{ clone: { name: string }; export: { name: string } }>();

	$: sourceLookup = new Map(sources.map((source) => [`${source.type}:${source.id}`, source] as const));
	$: fallbackSource = {
		type: 'pcd' as const,
		id: currentDatabaseId,
		name: currentDatabaseName
	};

	interface ResolvedSource {
		type: SourceRef['type'];
		id: number;
		name: string;
		arrType: ArrAppType | null;
	}

	function resolveSourceDatabaseId(row: CustomFormatTableRow): number {
		return typeof row.sourceDatabaseId === 'number' ? row.sourceDatabaseId : currentDatabaseId;
	}

	function isTrashRow(row: CustomFormatTableRow): boolean {
		return row.sourceType === 'trash';
	}

	function isEditableRow(row: CustomFormatTableRow): boolean {
		return !isTrashRow(row) && resolveSourceDatabaseId(row) === currentDatabaseId;
	}

	function getCardHref(row: CustomFormatTableRow): string | undefined {
		if (isTrashRow(row)) {
			return undefined;
		}

		return `/custom-formats/${resolveSourceDatabaseId(row)}/${row.id}`;
	}

	const { visibleCount, sentinel, reset, setTotalCount } = createProgressiveList({ pageSize: 30 });
	$: setTotalCount(formats.length);
	$: formats, reset();
	$: visibleFormats = formats.slice(0, $visibleCount);

	function parseMarkdown(text: string | null): string {
		if (!text) return '';
		return marked.parseInline(text) as string;
	}

	function getConditionVariant(
		condition: CustomFormatTableRow['conditions'][number]
	): 'danger' | 'success' | 'warning' | 'secondary' {
		if (condition.required && condition.negate) return 'danger';
		if (condition.required) return 'success';
		if (condition.negate) return 'warning';
		return 'secondary';
	}

	function getArrTargetLabel(target: ArrConditionTargetType): string {
		return target === 'all' ? 'All Apps' : getArrAppMetadata(target).label;
	}

	function resolveSource(row: CustomFormatTableRow): ResolvedSource {
		if (row.sourceType && typeof row.sourceDatabaseId === 'number') {
			const matched = sourceLookup.get(`${row.sourceType}:${row.sourceDatabaseId}`);
			if (matched) {
				return {
					type: matched.type,
					id: matched.id,
					name: matched.name,
					arrType: matched.type === 'trash' ? matched.arrType : null
				};
			}

			return {
				type: row.sourceType,
				id: row.sourceDatabaseId,
				name: row.sourceDatabaseName ?? `Source ${row.sourceDatabaseId}`,
				arrType: null
			};
		}

		return {
			type: fallbackSource.type,
			id: fallbackSource.id,
			name: fallbackSource.name,
			arrType: null
		};
	}
</script>

<CardGrid flush>
	{#each visibleFormats as format}
		<Card href={getCardHref(format)} hoverable>
			<svelte:fragment slot="header">
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div class="flex items-start justify-between gap-2">
					<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
						{format.name}
					</h3>
					{#if isEditableRow(format)}
						<div class="flex shrink-0 items-center gap-0.5" on:click|stopPropagation|preventDefault>
							{#if format.testCount > 0}
								<div
									class="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
									title="{format.testCount} test{format.testCount !== 1 ? 's' : ''}"
								>
									<FlaskConical size={12} />
									<span>{format.testCount}</span>
								</div>
							{/if}
							<Button
								icon={Download}
								size="xs"
								variant="ghost"
								tooltip="Export"
								on:click={() => dispatch('export', { name: format.name })}
							/>
							<Button
								icon={Copy}
								size="xs"
								variant="ghost"
								tooltip="Clone"
								on:click={() => dispatch('clone', { name: format.name })}
							/>
						</div>
					{:else if format.testCount > 0}
						<div
							class="flex shrink-0 items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
							title="{format.testCount} test{format.testCount !== 1 ? 's' : ''}"
						>
							<FlaskConical size={12} />
							<span>{format.testCount}</span>
						</div>
					{/if}
				</div>
			</svelte:fragment>

			<div class="space-y-3">
				{#if showSourceBadges}
					{@const source = resolveSource(format)}
					<SourceBadge
						sourceType={source.type}
						sourceName={source.name}
						size="sm"
						arrType={source.arrType}
					/>
				{/if}

				{#if format.tags.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each format.tags as tag}
							<Label variant="info" size="sm" rounded="md">{tag.name}</Label>
						{/each}
					</div>
				{/if}

				{#if format.arrTargets.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each format.arrTargets as target}
							{#if isArrAppType(target)}
								<Badge variant={target} size="sm">{getArrTargetLabel(target)}</Badge>
							{:else}
								<Badge variant="neutral" size="sm">{getArrTargetLabel(target)}</Badge>
							{/if}
						{/each}
					</div>
				{/if}

				<!-- Description -->
				{#if format.description}
					<div class="prose-inline line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
						{@html parseMarkdown(format.description)}
					</div>
				{:else}
					<div class="text-xs text-neutral-400 italic dark:text-neutral-500">No description</div>
				{/if}

				<!-- Conditions -->
				{#if format.conditions.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each sortConditions(format.conditions) as condition}
							<Label variant={getConditionVariant(condition)} size="sm" rounded="md" mono>{condition.name}</Label>
						{/each}
					</div>
				{:else}
					<div class="text-xs text-neutral-400">None</div>
				{/if}
			</div>
		</Card>
	{/each}
</CardGrid>
<div use:sentinel></div>

<style>
	:global(.prose-inline code) {
		background-color: rgb(229 231 235);
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-family: ui-monospace, monospace;
	}

	:global(.dark .prose-inline code) {
		background-color: rgb(38 38 38);
	}

	:global(.prose-inline strong) {
		font-weight: 600;
	}

	:global(.prose-inline a) {
		color: rgb(var(--color-accent-600));
		text-decoration: underline;
	}

	:global(.dark .prose-inline a) {
		color: rgb(var(--color-accent-400));
	}
</style>
