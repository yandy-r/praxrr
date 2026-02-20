<script lang="ts">
	import { ExternalLink, Unlink, Lock, Code } from 'lucide-svelte';
	import Table from '$ui/table/Table.svelte';
	import TableActionButton from '$ui/table/TableActionButton.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';
	import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
	import { parseUTC } from '$shared/utils/dates';
	import { createEventDispatcher } from 'svelte';
	import DatabaseAvatar from '../components/DatabaseAvatar.svelte';

	export let databases: DatabaseInstance[];

	const dispatch = createEventDispatcher<{
		unlink: DatabaseInstance;
	}>();

	// Avatar handled by DatabaseAvatar component

	// Format sync strategy for display
	function formatSyncStrategy(minutes: number): string {
		if (minutes === 0) return 'Manual';
		if (minutes < 60) return `Every ${minutes} min`;
		if (minutes === 60) return 'Hourly';
		if (minutes < 1440) return `Every ${minutes / 60}h`;
		return `Every ${minutes / 1440}d`;
	}

	// Format last synced date
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

	function getRowHref(database: DatabaseInstance): string {
		return `/databases/${database.id}`;
	}

	// Handle unlink click
	function handleUnlinkClick(e: Event, database: DatabaseInstance) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('unlink', database);
	}

	// Handle external link click
	function handleExternalClick(e: Event, url: string) {
		e.stopPropagation();
		e.preventDefault();
		window.open(url, '_blank');
	}

	// Define table columns
	const columns: Column<DatabaseInstance>[] = [
		{ key: 'name', header: 'Name', align: 'left' },
		{ key: 'repository_url', header: 'Repository', align: 'left' },
		{ key: 'sync_strategy', header: 'Sync', align: 'left', width: 'w-32' },
		{ key: 'last_synced_at', header: 'Last Synced', align: 'left', width: 'w-40' }
	];
</script>

<Table {columns} data={databases} hoverable={true} rowHref={getRowHref}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<div class="flex items-center gap-3">
				<DatabaseAvatar name={row.name} repoUrl={row.repository_url} size="sm" />
				<div class="flex items-center gap-2">
					<div class="font-medium text-neutral-900 dark:text-neutral-50">
						{row.name}
					</div>
					{#if row.is_private}
						<Badge variant="neutral" icon={Lock} mono>Private</Badge>
					{/if}
					{#if row.has_personal_access_token || row.personal_access_token}
						<Badge variant="info" icon={Code} mono>Dev</Badge>
					{/if}
				</div>
			</div>
		{:else if column.key === 'repository_url'}
			<Badge variant="neutral" mono>{row.repository_url.replace('https://github.com/', '')}</Badge>
		{:else if column.key === 'sync_strategy'}
			<Badge variant="neutral" mono>{formatSyncStrategy(row.sync_strategy)}</Badge>
		{:else if column.key === 'last_synced_at'}
			<Badge variant="neutral" mono>{formatLastSynced(row.last_synced_at)}</Badge>
		{/if}
	</svelte:fragment>

	<svelte:fragment slot="actions" let:row>
		<div class="relative z-10 flex items-center justify-end gap-1">
			<TableActionButton
				icon={ExternalLink}
				title="View on GitHub"
				on:click={(e) => handleExternalClick(e, row.repository_url)}
			/>
			<TableActionButton
				icon={Unlink}
				title="Unlink database"
				variant="danger"
				on:click={(e) => handleUnlinkClick(e, row)}
			/>
		</div>
	</svelte:fragment>
</Table>
