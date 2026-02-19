<script lang="ts">
	import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
	import Toggle from '$ui/toggle/Toggle.svelte';
	import SyncFooter from './SyncFooter.svelte';
	import { alertStore } from '$lib/client/alerts/store.ts';

	interface DatabaseWithProfiles {
		id: number;
		name: string;
		qualityProfiles: QualityProfileTableRow[];
	}

	export let databases: DatabaseWithProfiles[];
	export let state: Record<number, Record<string, boolean>> = {};
	export let syncTrigger: 'manual' | 'on_pull' | 'on_change' | 'schedule' = 'manual';
	export let cronExpression: string = '0 * * * *';
	export let canSave: boolean = true;
	export let warning: string | null = null;

	let saving = false;
	let syncing = false;

	// Track saved state for dirty detection
	let savedState = JSON.stringify({ state, syncTrigger, cronExpression });
	$: currentState = JSON.stringify({ state, syncTrigger, cronExpression });
	export let isDirty = false;
	$: isDirty = currentState !== savedState;

	// Initialize state for all databases/profiles
	$: {
		for (const db of databases) {
			if (!state[db.id]) {
				state[db.id] = {};
			}
			for (const profile of db.qualityProfiles) {
				if (state[db.id][profile.name] === undefined) {
					state[db.id][profile.name] = false;
				}
			}
		}
	}

	// Reactive set of selected keys for checkbox state
	$: selectedKeys = new Set(
		Object.entries(state).flatMap(([dbId, profiles]) =>
			Object.entries(profiles)
				.filter(([, selected]) => selected)
				.map(([profileName]) => `${dbId}-${profileName}`)
		)
	);

	function isSelected(databaseId: number, profileName: string): boolean {
		return selectedKeys.has(`${databaseId}-${profileName}`);
	}

	function setProfile(databaseId: number, profileName: string, checked: boolean) {
		state[databaseId][profileName] = checked;
		state = { ...state }; // Reassign to trigger reactivity
	}

	function getSelections(): { databaseId: number; profileName: string }[] {
		const selections: { databaseId: number; profileName: string }[] = [];
		for (const [dbId, profiles] of Object.entries(state)) {
			for (const [profileName, selected] of Object.entries(profiles)) {
				if (selected) {
					selections.push({ databaseId: parseInt(dbId), profileName });
				}
			}
		}
		return selections;
	}

	async function handleSave() {
		saving = true;
		try {
			const formData = new FormData();
			formData.set('selections', JSON.stringify(getSelections()));
			formData.set('trigger', syncTrigger);
			formData.set('cron', cronExpression);

			const response = await fetch('?/saveQualityProfiles', {
				method: 'POST',
				body: formData
			});

			if (response.ok) {
				alertStore.add('success', 'Quality profiles sync config saved');
				// Update saved state to current
				savedState = JSON.stringify({ state, syncTrigger, cronExpression });
			} else {
				alertStore.add('error', 'Failed to save quality profiles sync config');
			}
		} catch {
			alertStore.add('error', 'Failed to save quality profiles sync config');
		} finally {
			saving = false;
		}
	}

	async function handleSync() {
		syncing = true;
		try {
			const response = await fetch('?/syncQualityProfiles', {
				method: 'POST',
				body: new FormData()
			});

			if (response.ok) {
				const data = await response.json();
				alertStore.add('success', data?.message ?? 'Sync queued');
			} else {
				alertStore.add('error', 'Sync failed');
			}
		} catch {
			alertStore.add('error', 'Sync failed');
		} finally {
			syncing = false;
		}
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Quality Profiles</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Select quality profiles to sync to this instance
		</p>
	</div>

	<!-- Content -->
	<div class="p-6">
		{#if databases.length === 0}
			<p class="text-sm text-neutral-500 dark:text-neutral-400">No databases configured</p>
		{:else}
			<div class="space-y-6">
				{#each databases as database}
					<div class="space-y-3">
						<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
							{database.name}
						</h3>

						{#if database.qualityProfiles.length === 0}
							<p class="text-sm text-neutral-500 dark:text-neutral-400">No quality profiles</p>
						{:else}
							<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
								{#each database.qualityProfiles as profile}
									<Toggle
										checked={isSelected(database.id, profile.name)}
										label={profile.name}
										ariaLabel={`Toggle quality profile ${profile.name} from ${database.name}`}
										on:change={(e) => setProfile(database.id, profile.name, e.detail)}
									/>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<SyncFooter
		bind:syncTrigger
		bind:cronExpression
		{saving}
		{syncing}
		{isDirty}
		{canSave}
		{warning}
		on:save={handleSave}
		on:sync={handleSync}
	/>
</div>
