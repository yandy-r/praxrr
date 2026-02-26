<script lang="ts">
	import { RefreshCw, ExternalLink } from 'lucide-svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import Button from '$ui/button/Button.svelte';
	import { alertStore } from '$alerts/store';
	import { page } from '$app/stores';

	$: source = $page.data.source;

	let syncing = false;

	async function handleSync() {
		if (!source || syncing) return;
		syncing = true;
		try {
			const res = await fetch(`/api/v1/trash-guide/sources/${source.id}/sync`, {
				method: 'POST'
			});
			if (res.ok) {
				alertStore.add('success', 'Sync job queued');
			} else if (res.status === 409) {
				alertStore.add('warning', 'Sync is already running');
			} else {
				const data = await res.json().catch(() => ({}));
				alertStore.add('error', data.error || 'Failed to queue sync');
			}
		} catch {
			alertStore.add('error', 'Failed to connect');
		} finally {
			syncing = false;
		}
	}

	function formatSyncStrategy(minutes: number): string {
		if (minutes === 0) return 'Manual';
		if (minutes < 60) return `Every ${minutes} min`;
		if (minutes === 60) return 'Every hour';
		if (minutes < 1440) return `Every ${minutes / 60} hours`;
		return `Every ${minutes / 1440} days`;
	}

	function formatDate(date: string | null): string {
		if (!date) return 'Never';
		return new Date(date).toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>{source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

{#if source}
	<div class="mt-6 space-y-6">
		<!-- Header row -->
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
					Overview
				</h2>
				<Badge variant={source.arrType === 'radarr' ? 'radarr' : 'sonarr'}>
					{source.arrType === 'radarr' ? 'Radarr' : 'Sonarr'}
				</Badge>
				{#if source.enabled}
					<Badge variant="success">Enabled</Badge>
				{:else}
					<Badge variant="neutral">Disabled</Badge>
				{/if}
			</div>
			<Button
				text={syncing ? 'Syncing...' : 'Sync Now'}
				icon={RefreshCw}
				variant="primary"
				disabled={syncing}
				on:click={handleSync}
			/>
		</div>

		<!-- Entity counts grid -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div
				class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
			>
				<div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
					{source.entityCounts.customFormats}
				</div>
				<div class="text-xs text-neutral-500 dark:text-neutral-400">Custom Formats</div>
			</div>
			<div
				class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
			>
				<div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
					{source.entityCounts.qualityProfiles}
				</div>
				<div class="text-xs text-neutral-500 dark:text-neutral-400">Quality Profiles</div>
			</div>
			<div
				class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
			>
				<div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
					{source.entityCounts.qualitySizes}
				</div>
				<div class="text-xs text-neutral-500 dark:text-neutral-400">Quality Sizes</div>
			</div>
			<div
				class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
			>
				<div class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
					{source.entityCounts.naming}
				</div>
				<div class="text-xs text-neutral-500 dark:text-neutral-400">Naming</div>
			</div>
		</div>

		<!-- Source info -->
		<div
			class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
		>
			<div class="divide-y divide-neutral-200 dark:divide-neutral-800">
				<div class="flex items-center justify-between px-4 py-3">
					<span class="text-sm text-neutral-500 dark:text-neutral-400">Repository</span>
					<a
						href={source.repositoryUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
					>
						{source.repositoryUrl.replace('https://github.com/', '')}
						<ExternalLink size={12} />
					</a>
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<span class="text-sm text-neutral-500 dark:text-neutral-400">Branch</span>
					<span class="text-sm text-neutral-900 dark:text-neutral-50">
						{source.branch}
					</span>
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<span class="text-sm text-neutral-500 dark:text-neutral-400">
						Score Profile
					</span>
					<span class="text-sm text-neutral-900 dark:text-neutral-50">
						{source.scoreProfile}
					</span>
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<span class="text-sm text-neutral-500 dark:text-neutral-400">
						Sync Strategy
					</span>
					<span class="text-sm text-neutral-900 dark:text-neutral-50">
						{formatSyncStrategy(source.syncStrategy)}
					</span>
				</div>
				<div class="flex items-center justify-between px-4 py-3">
					<span class="text-sm text-neutral-500 dark:text-neutral-400">Last Synced</span>
					<span class="text-sm text-neutral-900 dark:text-neutral-50">
						{formatDate(source.lastSyncedAt)}
					</span>
				</div>
				{#if source.lastCommitHash}
					<div class="flex items-center justify-between px-4 py-3">
						<span class="text-sm text-neutral-500 dark:text-neutral-400">
							Last Commit
						</span>
						<Badge variant="neutral" mono>
							{source.lastCommitHash.substring(0, 8)}
						</Badge>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
