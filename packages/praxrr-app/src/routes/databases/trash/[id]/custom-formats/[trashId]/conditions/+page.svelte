<script lang="ts">
	import Table from '$ui/table/Table.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import CodeBlock from '$ui/display/CodeBlock.svelte';
	import type { Column } from '$ui/table/types.ts';
	import type { TrashGuideCustomFormatSpecification } from '$lib/server/trashguide/types.ts';
	import { page } from '$app/stores';

	$: entity = $page.data.entity;
	$: specifications = entity?.specifications
		? ([...entity.specifications] as TrashGuideCustomFormatSpecification[])
		: [];

	interface ConditionTableRow {
		name: string;
		implementation: string;
		negate: boolean;
		required: boolean;
	}

	$: columns = [
		{
			key: 'name',
			header: 'Name',
			sortable: true
		},
		{
			key: 'implementation',
			header: 'Type',
			sortable: true
		},
		{
			key: 'negate',
			header: 'Negate',
			align: 'center' as const,
			cell: (row: ConditionTableRow) =>
				row.negate
					? {
							html: '<span class="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">Yes</span>'
						}
					: {
							html: '<span class="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">No</span>'
						}
		},
		{
			key: 'required',
			header: 'Required',
			align: 'center' as const,
			cell: (row: ConditionTableRow) =>
				row.required
					? {
							html: '<span class="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Yes</span>'
						}
					: {
							html: '<span class="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">No</span>'
						}
		}
	] satisfies Column<ConditionTableRow>[];
</script>

<svelte:head>
	<title>{entity?.name ?? 'Custom Format'} - Conditions - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-6">
	{#if specifications.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No conditions defined for this custom format.
			</p>
		</div>
	{:else}
		<Table
			columns={columns}
			data={specifications}
			compact
			hoverable={false}
			emptyMessage="No conditions"
			responsive
		/>

		<!-- Field details for each specification -->
		<div class="space-y-4">
			{#each specifications as spec}
				{#if spec.fields && Object.keys(spec.fields).length > 0}
					<div
						class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
					>
						<div class="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
							<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
								{spec.name} - Fields
							</h3>
						</div>
						<div class="p-4">
							<CodeBlock code={JSON.stringify(spec.fields, null, 2)} />
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
