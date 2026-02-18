<script lang="ts">
	import { Trash2, Upload, Sparkles, Loader2 } from 'lucide-svelte';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import { alertStore } from '$alerts/store';

	export let databaseId: number;
	export let selectedCount: number;
	export let selectedFiles: string[] = [];
	export let commitMessage: string;
	export let aiEnabled: boolean = false;
	export let hasIncomingChanges: boolean = false;
	export let adding: boolean = false;
	export let discarding: boolean = false;

	export let onDiscard: () => void;
	export let onAdd: () => void;

	let generating = false;

	$: canDiscard = selectedCount > 0 && !discarding;
	$: canAdd =
		selectedCount > 0 && commitMessage.trim().length > 0 && !hasIncomingChanges && !adding;
	$: canGenerate = aiEnabled && selectedCount > 0 && !generating && !hasIncomingChanges;

	async function handleGenerate() {
		if (!canGenerate) return;

		generating = true;
		try {
			const response = await fetch(`/api/databases/${databaseId}/generate-commit-message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ files: selectedFiles })
			});

			if (response.ok) {
				const data = await response.json();
				commitMessage = data.message;
			} else {
				const error = await response.json();
				alertStore.add('error', error.message || 'Failed to generate commit message');
			}
		} catch (err) {
			alertStore.add('error', 'Failed to generate commit message');
		} finally {
			generating = false;
		}
	}
</script>

<ActionsBar className="w-full">
	<div class="relative flex flex-1">
		<div
			class="flex h-10 w-full items-center border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800 {hasIncomingChanges
				? 'opacity-50'
				: ''}"
		>
			<input
				type="text"
				bind:value={commitMessage}
				disabled={hasIncomingChanges}
				placeholder={hasIncomingChanges ? 'Pull incoming changes first...' : 'Commit message...'}
				class="h-full w-full bg-transparent px-3 font-mono text-sm text-neutral-700 placeholder-neutral-400 outline-none disabled:cursor-not-allowed dark:text-neutral-300 dark:placeholder-neutral-500"
			/>
		</div>
	</div>

	{#if aiEnabled}
		<ActionButton
			icon={generating ? Loader2 : Sparkles}
			iconClass={generating ? 'animate-spin' : ''}
			hasDropdown={true}
			dropdownPosition="right"
			on:click={() => canGenerate && handleGenerate()}
		>
			<svelte:fragment slot="dropdown" let:dropdownPosition let:open>
				<Dropdown position={dropdownPosition} minWidth="12rem">
					<div class="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400">
						{#if hasIncomingChanges}
							Pull incoming changes first
						{:else if generating}
							Generating...
						{:else if !selectedCount}
							Select changes first
						{:else}
							Generate commit message
						{/if}
					</div>
				</Dropdown>
			</svelte:fragment>
		</ActionButton>
	{/if}

	<ActionButton
		icon={adding ? Loader2 : Upload}
		iconClass={adding ? 'animate-spin' : ''}
		hasDropdown={true}
		dropdownPosition="right"
		on:click={() => canAdd && onAdd()}
	>
		<svelte:fragment slot="dropdown" let:dropdownPosition let:open>
			<Dropdown position={dropdownPosition} minWidth="12rem">
				<div class="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400">
					{#if adding}
						Pushing...
					{:else if hasIncomingChanges}
						Pull incoming changes first
					{:else if !selectedCount}
						Select changes to add
					{:else if !commitMessage.trim()}
						Enter a commit message
					{:else}
						Add {selectedCount} change{selectedCount === 1 ? '' : 's'}
					{/if}
				</div>
			</Dropdown>
		</svelte:fragment>
	</ActionButton>

	<ActionButton
		icon={discarding ? Loader2 : Trash2}
		iconClass={discarding ? 'animate-spin' : ''}
		hasDropdown={true}
		dropdownPosition="right"
		on:click={() => canDiscard && onDiscard()}
	>
		<svelte:fragment slot="dropdown" let:dropdownPosition let:open>
			<Dropdown position={dropdownPosition} minWidth="10rem">
				<div class="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400">
					{#if discarding}
						Discarding...
					{:else if selectedCount > 0}
						Discard {selectedCount} change{selectedCount === 1 ? '' : 's'}
					{:else}
						Select changes to discard
					{/if}
				</div>
			</Dropdown>
		</svelte:fragment>
	</ActionButton>
</ActionsBar>
