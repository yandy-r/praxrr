<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import FormInput from '$ui/form/FormInput.svelte';
	import Modal from '$ui/modal/Modal.svelte';
	import StickyCard from '$ui/card/StickyCard.svelte';
	import Card from '$ui/card/Card.svelte';
	import Button from '$ui/button/Button.svelte';
	import Toggle from '$ui/toggle/Toggle.svelte';
	import { alertStore } from '$alerts/store';
	import { current, isDirty, initCreate, initEdit, update } from '$lib/client/stores/dirty';
	import { Save, Trash2, Loader2 } from 'lucide-svelte';

	interface MetadataProfileTypeToggle {
		id: number;
		name: string;
		allowed: boolean;
	}

	interface MetadataProfileFormData {
		name: string;
		description: string;
		primaryTypes: MetadataProfileTypeToggle[];
		secondaryTypes: MetadataProfileTypeToggle[];
		releaseStatuses: MetadataProfileTypeToggle[];
	}

	export let mode: 'create' | 'edit';
	export let databaseName: string;
	export let canWriteToBase: boolean = false;
	export let actionUrl: string = '';
	export let initialData: MetadataProfileFormData;

	export let onCancel: () => void;

	const defaults: MetadataProfileFormData = {
		name: '',
		description: '',
		primaryTypes: [],
		secondaryTypes: [],
		releaseStatuses: []
	};

	type FormDataRecord = Record<string, unknown>;

	if (mode === 'create') {
		initCreate((initialData ?? defaults) as unknown as FormDataRecord);
	} else {
		initEdit(initialData as unknown as FormDataRecord);
	}

	$: formData = $current as unknown as MetadataProfileFormData;

	let saving = false;
	let deleting = false;
	let showDeleteModal = false;
	let selectedLayer: 'user' | 'base' = canWriteToBase ? 'base' : 'user';
	let deleteLayer: 'user' | 'base' = canWriteToBase ? 'base' : 'user';

	let mainFormElement: HTMLFormElement;
	let deleteFormElement: HTMLFormElement;

	$: title = mode === 'create' ? 'New Metadata Profile' : 'Edit Metadata Profile';
	$: description =
		mode === 'create'
			? `Create metadata profiles for ${databaseName}`
			: 'Update metadata profile settings';
	$: submitText = mode === 'create' ? 'Create Profile' : 'Save Changes';

	$: name = (formData.name ?? '').trim();
	$: descriptionText = (formData.description ?? '').trim();
	$: primaryTypes = (formData.primaryTypes ?? []) as MetadataProfileTypeToggle[];
	$: secondaryTypes = (formData.secondaryTypes ?? []) as MetadataProfileTypeToggle[];
	$: releaseStatuses = (formData.releaseStatuses ?? []) as MetadataProfileTypeToggle[];

	$: hasPrimaryAllowed = primaryTypes.some((entry) => entry.allowed);
	$: hasSecondaryAllowed = secondaryTypes.some((entry) => entry.allowed);
	$: hasReleaseAllowed = releaseStatuses.some((entry) => entry.allowed);

	$: canSave =
		name.length > 0 &&
		hasPrimaryAllowed &&
		hasSecondaryAllowed &&
		hasReleaseAllowed;

	function updateType(section: 'primaryTypes' | 'secondaryTypes' | 'releaseStatuses', index: number, checked: boolean) {
		if (section === 'primaryTypes') {
			const next = primaryTypes.map((entry, itemIndex) =>
				itemIndex === index ? { ...entry, allowed: checked } : entry
			);
			update('primaryTypes', next);
		} else if (section === 'secondaryTypes') {
			const next = secondaryTypes.map((entry, itemIndex) =>
				itemIndex === index ? { ...entry, allowed: checked } : entry
			);
			update('secondaryTypes', next);
		} else {
			const next = releaseStatuses.map((entry, itemIndex) =>
				itemIndex === index ? { ...entry, allowed: checked } : entry
			);
			update('releaseStatuses', next);
		}
	}

	async function handleSaveClick() {
		selectedLayer = canWriteToBase ? 'base' : 'user';
		await tick();
		mainFormElement?.requestSubmit();
	}

	function handleDeleteClick() {
		showDeleteModal = true;
	}

	async function handleDeleteConfirm() {
		deleteLayer = canWriteToBase ? 'base' : 'user';
		showDeleteModal = false;
		await tick();
		deleteFormElement?.requestSubmit();
	}

	function validateSection(sectionName: string, types: MetadataProfileTypeToggle[]): string | null {
		if (types.length === 0) {
			return `No ${sectionName} options are defined`;
		}

		if (!types.some((entry) => entry.allowed)) {
			return `At least one ${sectionName} option must be allowed`;
		}

		return null;
	}

	$: primaryValidation = validateSection('primary', primaryTypes);
	$: secondaryValidation = validateSection('secondary', secondaryTypes);
	$: releaseValidation = validateSection('release status', releaseStatuses);

	function toggleErrorMessage(validationMessage: string | null) {
		return validationMessage ? `text-red-600 dark:text-red-400` : '';
	}
</script>

<div class="space-y-6">
	<StickyCard position="top">
		<svelte:fragment slot="left">
			<div>
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
				<p class="text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
			</div>
		</svelte:fragment>

		<svelte:fragment slot="right">
			<div class="flex items-center gap-2">
				{#if mode === 'edit'}
					<Button
						disabled={deleting}
						icon={deleting ? Loader2 : Trash2}
						iconColor="text-red-600 dark:text-red-400"
						text={deleting ? 'Deleting...' : 'Delete'}
						on:click={handleDeleteClick}
					/>
				{/if}

				<Button text="Cancel" on:click={onCancel} />
				<Button
					disabled={saving || !canSave || !$isDirty}
					icon={saving ? Loader2 : Save}
					iconColor="text-blue-600 dark:text-blue-400"
					text={saving ? (mode === 'create' ? 'Creating...' : 'Saving...') : submitText}
					on:click={handleSaveClick}
				/>
			</div>
		</svelte:fragment>
	</StickyCard>

	<form
		bind:this={mainFormElement}
		method="POST"
		action={actionUrl}
		class="md:px-4"
		use:enhance={() => {
			saving = true;
			return async ({ result, update: formUpdate }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Operation failed');
				} else if (result.type === 'redirect') {
					alertStore.add(
						'success',
						mode === 'create' ? 'Metadata profile created!' : 'Metadata profile updated!'
					);
					initEdit(formData as unknown as FormDataRecord);
				}

				await formUpdate();
				saving = false;
			};
		}}
	>
		<input type="hidden" name="name" value={name} />
		<input type="hidden" name="description" value={descriptionText} />
		<input type="hidden" name="primaryTypes" value={JSON.stringify(primaryTypes)} />
		<input type="hidden" name="secondaryTypes" value={JSON.stringify(secondaryTypes)} />
		<input type="hidden" name="releaseStatuses" value={JSON.stringify(releaseStatuses)} />
		<input type="hidden" name="layer" value={selectedLayer} />

		<Card flush padding="lg">
			<div class="space-y-8">
				<div class="space-y-2">
					<FormInput
						label="Name"
						name="name"
						value={name}
						required
						description="Display name used for Lidarr metadata profile sync selection"
						placeholder="e.g., Discography profile"
						on:input={(event) => update('name', event.detail)}
					/>

					{#if name.length === 0}
						<p class="text-xs text-red-600 dark:text-red-400">Profile name is required.</p>
					{/if}
				</div>

				<div class="space-y-2">
					<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Description</h3>
					<input
						class="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
						name="description"
						type="text"
						value={descriptionText}
						on:change={(event) => {
							update('description', event.currentTarget.value);
						}}
					/>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Primary Types</h3>
						<p class="text-xs {toggleErrorMessage(primaryValidation)}">
							{primaryValidation ?? 'At least one primary type must be allowed'}
						</p>
					</div>
					<div class="grid gap-2">
						{#if primaryTypes.length === 0}
							<p class="text-xs text-neutral-500 dark:text-neutral-400">No primary types available.</p>
						{:else}
							{#each primaryTypes as typeEntry, index}
								<Toggle
									label={`${typeEntry.name} (${typeEntry.id})`}
									checked={typeEntry.allowed}
									on:change={(event: CustomEvent<boolean>) =>
										updateType('primaryTypes', index, event.detail)
									}
								/>
							{/each}
						{/if}
					</div>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Secondary Types</h3>
						<p class="text-xs {toggleErrorMessage(secondaryValidation)}">
							{secondaryValidation ?? 'At least one secondary type must be allowed'}
						</p>
					</div>
					<div class="grid gap-2">
						{#if secondaryTypes.length === 0}
							<p class="text-xs text-neutral-500 dark:text-neutral-400">No secondary types available.</p>
						{:else}
							{#each secondaryTypes as typeEntry, index}
								<Toggle
									label={`${typeEntry.name} (${typeEntry.id})`}
									checked={typeEntry.allowed}
									on:change={(event: CustomEvent<boolean>) =>
										updateType('secondaryTypes', index, event.detail)
									}
								/>
							{/each}
						{/if}
					</div>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Release Statuses</h3>
						<p class="text-xs {toggleErrorMessage(releaseValidation)}">
							{releaseValidation ?? 'At least one release status must be allowed'}
						</p>
					</div>
					<div class="grid gap-2">
						{#if releaseStatuses.length === 0}
							<p class="text-xs text-neutral-500 dark:text-neutral-400">No release statuses available.</p>
						{:else}
							{#each releaseStatuses as typeEntry, index}
								<Toggle
									label={`${typeEntry.name} (${typeEntry.id})`}
									checked={typeEntry.allowed}
									on:change={(event: CustomEvent<boolean>) =>
										updateType('releaseStatuses', index, event.detail)
									}
								/>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		</Card>
	</form>

	{#if mode === 'edit'}
		<form
			bind:this={deleteFormElement}
			method="POST"
			action="?/delete"
			class="hidden"
			use:enhance={() => {
				deleting = true;
				return async ({ result, update: formUpdate }) => {
					if (result.type === 'failure' && result.data) {
						alertStore.add(
							'error',
							(result.data as { error?: string }).error || 'Failed to delete profile'
						);
					} else if (result.type === 'redirect') {
						alertStore.add('success', 'Metadata profile deleted');
					}

					await formUpdate();
					deleting = false;
				};
			}}
		>
			<input type="hidden" name="layer" value={deleteLayer} />
		</form>
	{/if}

	<!-- Delete confirmation -->
	<Modal
		open={showDeleteModal}
		header="Delete metadata profile"
		bodyMessage={`Delete "${formData.name}" and remove it from PCD config? This action cannot be undone.`}
		confirmText="Delete"
		cancelText="Cancel"
		confirmDanger={true}
		loading={deleting}
		confirmDisabled={deleting}
		on:confirm={handleDeleteConfirm}
		on:cancel={() => (showDeleteModal = false)}
	/>
</div>
