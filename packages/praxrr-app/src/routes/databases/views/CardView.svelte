<script lang="ts">
	import { ExternalLink, Unlink, Lock, Code } from 'lucide-svelte';
	import Badge from '$ui/badge/Badge.svelte';
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

	// Handle unlink click
	function handleUnlinkClick(e: MouseEvent, database: DatabaseInstance) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('unlink', database);
	}

	// Handle external link click
	function handleExternalClick(e: MouseEvent, url: string) {
		e.stopPropagation();
		e.preventDefault();
		window.open(url, '_blank');
	}
</script>

<div class="grid grid-cols-1 gap-3">
	{#each databases as database}
		<a
			href="/databases/{database.id}"
			class="group cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
		>
			<!-- Top row: Avatar, Name, Action buttons -->
			<div class="flex items-center gap-3">
				<DatabaseAvatar name={database.name} repoUrl={database.repository_url} size="md" />
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="truncate font-medium text-neutral-900 dark:text-neutral-100">
							{database.name}
						</span>
						{#if database.is_private}
							<Lock size={14} class="flex-shrink-0 text-neutral-400" />
						{/if}
						{#if database.personal_access_token}
							<Code size={14} class="flex-shrink-0 text-blue-500" />
						{/if}
					</div>
				</div>
				<!-- Action buttons -->
				<div class="relative z-10 flex flex-shrink-0 items-center gap-1">
					<button
						type="button"
						on:click={(e) => handleExternalClick(e, database.repository_url)}
						class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
					>
						<ExternalLink size={16} />
					</button>
					<button
						type="button"
						on:click={(e) => handleUnlinkClick(e, database)}
						class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400"
					>
						<Unlink size={16} />
					</button>
				</div>
			</div>

			<!-- Bottom row: Badges (horizontal wrap) -->
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<Badge variant="neutral" mono>
					{database.repository_url.replace('https://github.com/', '')}
				</Badge>
				<Badge variant="neutral" mono>{formatSyncStrategy(database.sync_strategy)}</Badge>
				<Badge variant="neutral" mono>{formatLastSynced(database.last_synced_at)}</Badge>
			</div>
		</a>
	{/each}
</div>
