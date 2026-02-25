<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { Save, Trash2, Loader2 } from 'lucide-svelte';
	import { alertStore } from '$alerts/store';
	import { isDirty, initEdit, initCreate, update, current, clear } from '$lib/client/stores/dirty';
	import FormInput from '$ui/form/FormInput.svelte';
	import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
	import Modal from '$ui/modal/Modal.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import Button from '$ui/button/Button.svelte';
	import StickyCard from '$ui/card/StickyCard.svelte';
	import type { TrashGuideSourceResponse } from '$lib/server/trashguide/manager.ts';

	export let mode: 'create' | 'edit';
	export let source: TrashGuideSourceResponse | undefined = undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let form: any = undefined;

	const TRASH_GUIDE_REPO_URL = 'https://github.com/TRaSH-Guides/Guides';

	const arrTypeOptions = [
		{ value: 'radarr', label: 'Radarr' },
		{ value: 'sonarr', label: 'Sonarr' },
	];

	const scoreProfileOptions = [
		{ value: 'default', label: 'Default' },
		{ value: 'anime', label: 'Anime' },
		{ value: 'french-vostfr', label: 'French VOSTFR' },
		{ value: 'french-multi-vostfr', label: 'French Multi VOSTFR' },
		{ value: 'french-multi-vf', label: 'French Multi VF' },
		{ value: 'german', label: 'German' },
		{ value: 'sqp-1', label: 'SQP-1 (Streaming)' },
		{ value: 'sqp-2', label: 'SQP-2 (UHD Streaming)' },
		{ value: 'sqp-3', label: 'SQP-3 (UHD Remux)' },
		{ value: 'sqp-4', label: 'SQP-4 (UHD Web)' },
		{ value: 'sqp-5', label: 'SQP-5 (UHD Bluray)' },
	];

	const syncStrategyOptions = [
		{ value: '0', label: 'Manual (no auto-sync)' },
		{ value: '5', label: 'Every 5 minutes' },
		{ value: '15', label: 'Every 15 minutes' },
		{ value: '30', label: 'Every 30 minutes' },
		{ value: '60', label: 'Every hour' },
		{ value: '360', label: 'Every 6 hours' },
		{ value: '720', label: 'Every 12 hours' },
		{ value: '1440', label: 'Every 24 hours' },
	];

	const autoPullOptions = [
		{ value: 'true', label: 'Enabled' },
		{ value: 'false', label: 'Disabled' },
	];

	onMount(() => {
		if (mode === 'edit' && source) {
			initEdit({
				arrType: source.arrType,
				name: source.name,
				scoreProfile: source.scoreProfile,
				syncStrategy: String(source.syncStrategy),
				autoPull: 'true',
			});
		} else {
			initCreate({
				arrType: '',
				name: '',
				scoreProfile: 'default',
				syncStrategy: '60',
				autoPull: 'true',
			});
		}
		return () => clear();
	});

	$: arrType = ($current.arrType ?? '') as string;
	$: name = ($current.name ?? '') as string;
	$: scoreProfile = ($current.scoreProfile ?? 'default') as string;
	$: syncStrategy = ($current.syncStrategy ?? '60') as string;
	$: autoPull = ($current.autoPull ?? 'true') as string;

	// Auto-fill name when arr type changes and name is empty or matches auto-pattern
	let previousAutoName = '';
	function handleArrTypeChange(newArrType: string) {
		update('arrType', newArrType);
		const label = arrTypeOptions.find((o) => o.value === newArrType)?.label ?? '';
		const autoName = label ? `TRaSH - ${label}` : '';
		if (!name || name === previousAutoName) {
			update('name', autoName);
		}
		previousAutoName = autoName;
	}

	let saving = false;
	let savingStatus = '';
	let deleting = false;
	let showDeleteModal = false;

	$: canSubmit = $isDirty && !!name && !!arrType;

	function handleSave() {
		if (!name) {
			alertStore.add('error', 'Name is required');
			return;
		}
		if (!arrType) {
			alertStore.add('error', 'Arr type is required');
			return;
		}
		saving = true;
		savingStatus =
			mode === 'create'
				? 'Cloning TRaSH Guides repository and parsing configurations...'
				: 'Saving settings...';
		const saveForm = document.getElementById('trash-save-form');
		if (saveForm instanceof HTMLFormElement) {
			saveForm.requestSubmit();
		}
	}

	$: title = mode === 'create' ? 'Add TRaSH Guides' : 'Settings';
	$: description =
		mode === 'create'
			? 'Add curated TRaSH Guide configurations for your Arr instance.'
			: `Configure settings for ${source?.name || 'this source'}.`;

	let lastFormId: unknown = null;
	$: if (form && form !== lastFormId) {
		lastFormId = form;
		if (form.success) {
			alertStore.add('success', mode === 'create' ? 'TRaSH source added' : 'Settings saved');
			if (mode === 'edit') {
				initEdit({
					arrType,
					name,
					scoreProfile,
					syncStrategy,
					autoPull,
				});
			}
		}
		if (form.error) {
			alertStore.add('error', form.error);
		}
	}
</script>

{#if saving && mode === 'create'}
	<!-- Loading overlay for create mode (clone + parse takes time) -->
	<div class="space-y-6">
		<StickyCard position="top">
			<svelte:fragment slot="left">
				<h1 class="text-neutral-900 dark:text-neutral-50">{title}</h1>
				<p class="text-neutral-600 dark:text-neutral-400">{description}</p>
			</svelte:fragment>
			<svelte:fragment slot="right">
				<Button
					text="Adding..."
					icon={Save}
					iconColor="text-blue-600 dark:text-blue-400"
					disabled={true}
				/>
			</svelte:fragment>
		</StickyCard>

		<div
			class="flex flex-col items-center justify-center gap-4 rounded-lg border border-neutral-200 bg-white p-12 dark:border-neutral-800 dark:bg-neutral-900"
		>
			<div class="animate-spin text-accent-500">
				<Loader2 size={32} />
			</div>
			<div class="text-center">
				<p class="font-medium text-neutral-900 dark:text-neutral-50">
					Setting up TRaSH Guides
				</p>
				<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
					{savingStatus}
				</p>
				<p class="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
					This may take a minute on first setup
				</p>
			</div>
		</div>
	</div>
{:else}
	<div class="space-y-6" class:mt-6={mode === 'edit'}>
		<StickyCard position="top">
			<svelte:fragment slot="left">
				<h1 class="text-neutral-900 dark:text-neutral-50">{title}</h1>
				<p class="text-neutral-600 dark:text-neutral-400">{description}</p>
			</svelte:fragment>
			<svelte:fragment slot="right">
				{#if mode === 'edit'}
					<Button
						text="Unlink"
						icon={Trash2}
						iconColor="text-red-600 dark:text-red-400"
						disabled={saving || deleting}
						on:click={() => (showDeleteModal = true)}
					/>
				{/if}
				<Button
					text={saving ? 'Saving...' : 'Save'}
					icon={Save}
					iconColor="text-blue-600 dark:text-blue-400"
					disabled={saving || !canSubmit}
					on:click={handleSave}
				/>
			</svelte:fragment>
		</StickyCard>

		<div
			class="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
		>
			<!-- Arr Type -->
			<div class="space-y-2">
				<span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
					Arr Type
				</span>
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					Select the Arr application this source is for
				</p>
				<DropdownSelect
					value={arrType}
					options={arrTypeOptions}
					placeholder="Select Arr type..."
					fullWidth
					disabled={mode === 'edit'}
					on:change={(e) => handleArrTypeChange(e.detail)}
				/>
			</div>

			<!-- Name -->
			<FormInput
				label="Name"
				name="name"
				value={name}
				placeholder="e.g., TRaSH - Radarr"
				description="A friendly name for this TRaSH Guide source"
				required
				on:input={(e) => update('name', e.detail)}
			/>

			<!-- Score Profile -->
			<div class="space-y-2">
				<span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
					Score Profile
				</span>
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					Score set to use for custom format scoring
				</p>
				<DropdownSelect
					value={scoreProfile}
					options={scoreProfileOptions}
					fullWidth
					on:change={(e) => update('scoreProfile', e.detail)}
				/>
			</div>

			<!-- Sync Strategy -->
			<div class="space-y-2">
				<span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
					Sync Strategy
				</span>
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					How often to check for updates from TRaSH Guides
				</p>
				<DropdownSelect
					value={syncStrategy}
					options={syncStrategyOptions}
					fullWidth
					on:change={(e) => update('syncStrategy', e.detail)}
				/>
			</div>

			<!-- Auto Pull -->
			<div class="space-y-2">
				<span class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
					Auto Pull
				</span>
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					Automatically pull updates when available
				</p>
				<DropdownSelect
					value={autoPull}
					options={autoPullOptions}
					on:change={(e) => update('autoPull', e.detail)}
				/>
			</div>
			{#if autoPull === 'false'}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					You will receive notifications when updates are available but they won't be
					applied automatically
				</p>
			{/if}
		</div>
	</div>
{/if}

<!-- Hidden save form -->
<form
	id="trash-save-form"
	method="POST"
	action={mode === 'edit' ? '?/update' : undefined}
	class="hidden"
	use:enhance={() => {
		saving = true;
		savingStatus =
			mode === 'create'
				? 'Cloning TRaSH Guides repository and parsing configurations...'
				: 'Saving settings...';
		return async ({ result, update: formUpdate }) => {
			if (result.type === 'redirect') {
				clear();
				alertStore.add('success', 'TRaSH source added');
			}
			await formUpdate({ reset: false });
			saving = false;
			savingStatus = '';
		};
	}}
>
	<input type="hidden" name="name" value={name} />
	<input type="hidden" name="arr_type" value={arrType} />
	<input type="hidden" name="repository_url" value={TRASH_GUIDE_REPO_URL} />
	<input type="hidden" name="branch" value="master" />
	<input type="hidden" name="score_profile" value={scoreProfile} />
	<input type="hidden" name="sync_strategy" value={syncStrategy} />
	<input type="hidden" name="auto_pull" value={autoPull === 'true' ? '1' : '0'} />
</form>

<!-- Hidden delete form (edit mode only) -->
{#if mode === 'edit'}
	<form
		id="trash-delete-form"
		method="POST"
		action="?/delete"
		class="hidden"
		use:enhance={() => {
			deleting = true;
			return async ({ result, update: formUpdate }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add(
						'error',
						(result.data as { error?: string }).error || 'Failed to unlink source'
					);
				} else if (result.type === 'redirect') {
					alertStore.add('success', 'TRaSH source unlinked');
				}
				await formUpdate();
				deleting = false;
			};
		}}
	></form>
{/if}

<!-- Delete Confirmation Modal -->
{#if mode === 'edit'}
	<Modal
		open={showDeleteModal}
		header="Unlink TRaSH Source"
		bodyMessage={`Are you sure you want to unlink "${source?.name}"? This action cannot be undone and all cached data will be permanently removed.`}
		confirmText="Unlink"
		cancelText="Cancel"
		confirmDanger={true}
		on:confirm={() => {
			showDeleteModal = false;
			const deleteForm = document.getElementById('trash-delete-form');
			if (deleteForm instanceof HTMLFormElement) {
				deleteForm.requestSubmit();
			}
		}}
		on:cancel={() => (showDeleteModal = false)}
	/>
{/if}

<DirtyModal />
