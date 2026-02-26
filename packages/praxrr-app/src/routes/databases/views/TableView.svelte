<script lang="ts">
	import { ExternalLink, Unlink, Lock, Code, AlertTriangle } from 'lucide-svelte';
	import Table from '$ui/table/Table.svelte';
	import TableActionButton from '$ui/table/TableActionButton.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';
	import { parseUTC } from '$shared/utils/dates';
	import { createEventDispatcher } from 'svelte';
	import DatabaseAvatar from '../components/DatabaseAvatar.svelte';
	import type { UnifiedDatabaseItem } from '../types';

	export let items: UnifiedDatabaseItem[];

	const dispatch = createEventDispatcher<{
		unlink: UnifiedDatabaseItem;
	}>();

	function formatSyncStrategy(minutes: number): string {
		if (minutes === 0) return 'Manual';
		if (minutes < 60) return `Every ${minutes} min`;
		if (minutes === 60) return 'Hourly';
		if (minutes < 1440) return `Every ${minutes / 60}h`;
		return `Every ${minutes / 1440}d`;
	}

	function formatLastSynced(date: string | null): string {
		const d = parseUTC(date);
		if (!d) return 'Never';
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function getRowHref(item: UnifiedDatabaseItem): string {
		return item.type === 'trash' ? `/databases/trash/${item.id}` : `/databases/${item.id}`;
	}

	function handleUnlinkClick(e: Event, item: UnifiedDatabaseItem) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('unlink', item);
	}

	function handleExternalClick(e: Event, url: string) {
		e.stopPropagation();
		e.preventDefault();
		window.open(url, '_blank');
	}

	const columns: Column<UnifiedDatabaseItem>[] = [
		{ key: 'name', header: 'Name', align: 'left' },
		{ key: 'type', header: 'Type', align: 'left', width: 'w-24' },
		{ key: 'repositoryUrl', header: 'Repository', align: 'left' },
		{ key: 'syncStrategy', header: 'Sync', align: 'left', width: 'w-32' },
		{ key: 'lastSyncedAt', header: 'Last Synced', align: 'left', width: 'w-40' }
	];
</script>

<Table {columns} data={items} hoverable={true} rowHref={getRowHref}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<div class="flex items-center gap-3">
				<DatabaseAvatar name={row.name} repoUrl={row.repositoryUrl} size="sm" />
				<div class="flex items-center gap-2">
					<div class="font-medium text-neutral-900 dark:text-neutral-50">
						{row.name}
					</div>
					{#if row.type === 'trash' && row.arrType}
						<Badge
							variant={row.arrType === 'radarr' ? 'radarr' : 'sonarr'}
							size="sm"
						>
							{row.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
						</Badge>
					{/if}
					{#if row.type === 'pcd' && row.isPrivate}
						<Badge variant="neutral" icon={Lock} mono>Private</Badge>
					{/if}
					{#if row.type === 'pcd' && row.hasPersonalAccessToken}
						<Badge variant="info" icon={Code} mono>Dev</Badge>
					{/if}
					{#if row.type === 'pcd' && !row.cacheAvailable}
						<Badge variant="warning" icon={AlertTriangle} mono>Cache Unavailable</Badge>
					{/if}
				</div>
			</div>
		{:else if column.key === 'type'}
			{#if row.type === 'trash'}
				<Badge variant="accent" size="sm">TRaSH</Badge>
			{:else}
				<Badge variant="neutral" size="sm">PCD</Badge>
			{/if}
		{:else if column.key === 'repositoryUrl'}
			<Badge variant="neutral" mono>
				{row.repositoryUrl.replace('https://github.com/', '')}
			</Badge>
		{:else if column.key === 'syncStrategy'}
			<Badge variant="neutral" mono>{formatSyncStrategy(row.syncStrategy)}</Badge>
		{:else if column.key === 'lastSyncedAt'}
			<Badge variant="neutral" mono>{formatLastSynced(row.lastSyncedAt)}</Badge>
		{/if}
	</svelte:fragment>

	<svelte:fragment slot="actions" let:row>
		<div class="relative z-10 flex items-center justify-end gap-1">
			<TableActionButton
				icon={ExternalLink}
				title="View on GitHub"
				on:click={(e) => handleExternalClick(e, row.repositoryUrl)}
			/>
			<TableActionButton
				icon={Unlink}
				title="Unlink"
				variant="danger"
				on:click={(e) => handleUnlinkClick(e, row)}
			/>
		</div>
	</svelte:fragment>
</Table>
