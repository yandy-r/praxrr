<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ViewToggle from '$ui/actions/ViewToggle.svelte';
	import { createDataPageStore } from '$lib/client/stores/dataPage';
	import { browser } from '$app/environment';
	import Table from '$ui/table/Table.svelte';
	import type { Column } from '$ui/table/types';
	import type { LidarrMetadataProfileListItem } from '$shared/pcd/display.ts';
	import CardGrid from '$ui/card/CardGrid.svelte';
	import Card from '$ui/card/Card.svelte';
	import { Tag, CheckCircle2, CalendarClock, Plus, Copy, Download } from 'lucide-svelte';
	import type { PageData } from './$types';
	import { alertStore } from '$alerts/store';
	import Button from '$ui/button/Button.svelte';
	import CloneModal from '$ui/modal/CloneModal.svelte';

	export let data: PageData;

	const { search, view, filtered, setItems } = createDataPageStore(data.metadataProfiles, {
		storageKey: 'metadataProfilesView',
		searchKeys: ['name'],
		searchKey: `metadataProfilesSearch:${data.currentDatabase.id}`,
	});

	$: setItems(data.metadataProfiles);

	$: tabs = data.databases.map((database) => ({
		label: database.name,
		href: `/metadata-profiles/${database.id}`,
		active: database.id === data.currentDatabase.id,
	}));

	$: if (browser && data.currentDatabase?.id) {
		localStorage.setItem('metadataProfilesDatabase', String(data.currentDatabase.id));
	}

	let cloneModalOpen = false;
	let cloneSourceName = '';

	function getRowHref(row: LidarrMetadataProfileListItem): string {
		return `/metadata-profiles/${data.currentDatabase.id}/${encodeURIComponent(row.name)}`;
	}

	function handleClone(name: string) {
		cloneSourceName = name;
		cloneModalOpen = true;
	}

	async function handleExport(name: string) {
		try {
			const params = new URLSearchParams({
				databaseId: String(data.currentDatabase.id),
				entityType: 'lidarr_metadata_profile',
				name
			});

			const res = await fetch(`/api/v1/pcd/export?${params}`);
			const json = await res.json();

			if (!res.ok) {
				alertStore.add('error', json.error || 'Export failed');
				return;
			}

			await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
			alertStore.add('success', `Copied "${name}" to clipboard`);
		} catch {
			alertStore.add('error', 'Export failed');
		}
	}

	const columns: Column<LidarrMetadataProfileListItem>[] = [
		{
			key: 'name',
			header: 'Name',
			headerIcon: Tag,
			align: 'left',
			sortable: true,
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: `<div class="font-medium text-neutral-900 dark:text-neutral-100">${row.name}</div>`,
			}),
		},
		{
			key: 'description',
			header: 'Description',
			align: 'left',
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: row.description ? String(row.description) : '<span class="text-neutral-400">No description</span>',
			}),
		},
		{
			key: 'primaryAllowedCount',
			header: 'Primary',
			align: 'left',
			width: 'w-40',
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.primaryAllowedCount}/${row.primaryTypeCount} allowed</div>`,
			}),
		},
		{
			key: 'secondaryAllowedCount',
			header: 'Secondary',
			align: 'left',
			width: 'w-44',
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.secondaryAllowedCount}/${row.secondaryTypeCount} allowed</div>`,
			}),
		},
		{
			key: 'releaseStatusAllowedCount',
			header: 'Release',
			align: 'left',
			width: 'w-40',
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.releaseStatusAllowedCount}/${row.releaseStatusCount} allowed</div>`,
			}),
		},
		{
			key: 'updated_at',
			header: 'Updated',
			align: 'left',
			width: 'w-40',
			cell: (row: LidarrMetadataProfileListItem) => ({
				html: `<span class="text-xs text-neutral-500 dark:text-neutral-400">${row.updated_at || 'Never'}</span>`,
			}),
		}
	];
</script>

<svelte:head>
	<title>Metadata Profiles - {data.currentDatabase.name} - Profilarr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
	<Tabs {tabs} responsive />

	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search metadata profiles..." responsive />
		<ViewToggle bind:value={$view} />
		<ActionButton
			icon={Plus}
			on:click={() => goto(`/metadata-profiles/${$page.params.databaseId}/new`)}
		/>
	</ActionsBar>

	<div class="mt-6">
		{#if data.metadataProfiles.length === 0}
			<div class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
				<p class="text-neutral-600 dark:text-neutral-400">
					No metadata profiles found for {data.currentDatabase.name}
				</p>
			</div>
		{:else if $filtered.length === 0}
			<div class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
				<p class="text-neutral-600 dark:text-neutral-400">No metadata profiles match your search</p>
			</div>
		{:else if $view === 'table'}
			<Table
				data={$filtered}
				{columns}
				emptyMessage="No metadata profiles found"
				rowHref={getRowHref}
				compact={false}
				hoverable={true}
			>
				<svelte:fragment slot="actions" let:row>
					<div class="flex items-center justify-end gap-0.5" on:click|stopPropagation>
						<Button
							icon={Download}
							size="xs"
							variant="ghost"
							tooltip="Export"
							on:click={() => handleExport(row.name)}
						/>
						<Button
							icon={Copy}
							size="xs"
							variant="ghost"
							tooltip="Clone"
							on:click={() => handleClone(row.name)}
						/>
					</div>
				</svelte:fragment>
			</Table>
		{:else}
			<CardGrid flush>
				{#each $filtered as profile (profile.id)}
					<Card href={getRowHref(profile)} hoverable>
						<svelte:fragment slot="header">
							<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
							<div class="flex items-center justify-between gap-2">
								<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{profile.name}</h3>
								<div class="flex items-center gap-0.5" on:click|stopPropagation|preventDefault>
									<Button
										icon={Download}
										size="xs"
										variant="ghost"
										tooltip="Export"
										on:click={() => handleExport(profile.name)}
									/>
									<Button
										icon={Copy}
										size="xs"
										variant="ghost"
										tooltip="Clone"
										on:click={() => handleClone(profile.name)}
									/>
								</div>
							</div>
						</svelte:fragment>

						<div class="space-y-3 text-xs">
							<div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
								<CheckCircle2 size={12} />
								<span>{profile.primaryAllowedCount}/{profile.primaryTypeCount} primary types allowed</span>
							</div>
							<div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
								<CheckCircle2 size={12} />
								<span>{profile.secondaryAllowedCount}/{profile.secondaryTypeCount} secondary types allowed</span>
							</div>
							<div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
								<CheckCircle2 size={12} />
								<span>{profile.releaseStatusAllowedCount}/{profile.releaseStatusCount} release statuses allowed</span>
							</div>
							<div class="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
								<CalendarClock size={12} />
								<span>{profile.updated_at || 'Never'}</span>
							</div>
						</div>
					</Card>
				{/each}
			</CardGrid>
		{/if}
	</div>
</div>

<CloneModal
	bind:open={cloneModalOpen}
	databaseId={data.currentDatabase.id}
	entityType="lidarr_metadata_profile"
	sourceName={cloneSourceName}
	existingNames={data.metadataProfiles.map((profile) => profile.name)}
	canWriteToBase={data.canWriteToBase}
/>
