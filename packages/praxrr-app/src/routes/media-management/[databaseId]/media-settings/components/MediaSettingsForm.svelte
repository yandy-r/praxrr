<script lang="ts">
	import { enhance } from '$app/forms';
	import { onDestroy, tick } from 'svelte';
	import StickyCard from '$ui/card/StickyCard.svelte';
	import Button from '$ui/button/Button.svelte';
	import Modal from '$ui/modal/Modal.svelte';
	import FormInput from '$ui/form/FormInput.svelte';
	import Toggle from '$ui/toggle/Toggle.svelte';
	import AdvancedSection from '$ui/form/AdvancedSection.svelte';
	import {
		getUserInterfacePreferenceSectionStore,
		type UiPreferenceMode
	} from '$stores/userInterfacePreferences.ts';
	import { alertStore } from '$alerts/store';
	import { Save, Trash2 } from 'lucide-svelte';
	import { current, isDirty, initEdit, initCreate, update } from '$lib/client/stores/dirty';
	import type { RadarrMediaSettingsRow } from '$shared/pcd/display.ts';
	import type { ArrType } from '$shared/pcd/types.ts';
	import { PROPERS_REPACKS_OPTIONS, type PropersRepacks } from '$shared/pcd/mediaManagement.ts';

	interface RadarrMediaSettingsRowFormData {
		name: string;
		propersRepacks: PropersRepacks;
		enableMediaInfo: boolean;
		[key: string]: unknown;
	}

	export let mode: 'create' | 'edit';
	export let arrType: ArrType;
	export let databaseName: string;
	export let canWriteToBase: boolean = false;
	export let actionUrl: string = '';
	export let initialData: RadarrMediaSettingsRow | null;

	const defaults: RadarrMediaSettingsRowFormData = {
		name: '',
		propersRepacks: 'doNotPrefer',
		enableMediaInfo: true
	};

	const mediaSettingsNamingSection = getUserInterfacePreferenceSectionStore(
		'media-management:media-settings:naming'
	);
	const mediaSettingsFolderManagementSection = getUserInterfacePreferenceSectionStore(
		'media-management:media-settings:folder-management'
	);
	const mediaSettingsImportingSection = getUserInterfacePreferenceSectionStore(
		'media-management:media-settings:importing'
	);

	let mediaSettingsNamingMode: UiPreferenceMode = 'basic';
	let mediaSettingsFolderManagementMode: UiPreferenceMode = 'basic';
	let mediaSettingsImportingMode: UiPreferenceMode = 'basic';
	let mediaSettingsNamingModeSynced: UiPreferenceMode = 'basic';
	let mediaSettingsFolderManagementModeSynced: UiPreferenceMode = 'basic';
	let mediaSettingsImportingModeSynced: UiPreferenceMode = 'basic';

	const unsubscribeMediaSettingsNamingMode = mediaSettingsNamingSection.mode.subscribe((mode) => {
		mediaSettingsNamingModeSynced = mode;
		if (mediaSettingsNamingMode !== mode) {
			mediaSettingsNamingMode = mode;
		}
	});
	const unsubscribeMediaSettingsFolderManagementMode = mediaSettingsFolderManagementSection.mode.subscribe(
		(mode) => {
			mediaSettingsFolderManagementModeSynced = mode;
			if (mediaSettingsFolderManagementMode !== mode) {
				mediaSettingsFolderManagementMode = mode;
			}
		}
	);
	const unsubscribeMediaSettingsImportingMode = mediaSettingsImportingSection.mode.subscribe((mode) => {
		mediaSettingsImportingModeSynced = mode;
		if (mediaSettingsImportingMode !== mode) {
			mediaSettingsImportingMode = mode;
		}
	});

	$: if (mediaSettingsNamingMode !== mediaSettingsNamingModeSynced) {
		mediaSettingsNamingModeSynced = mediaSettingsNamingMode;
		mediaSettingsNamingSection.mode.set(mediaSettingsNamingMode);
	}

	$: if (mediaSettingsFolderManagementMode !== mediaSettingsFolderManagementModeSynced) {
		mediaSettingsFolderManagementModeSynced = mediaSettingsFolderManagementMode;
		mediaSettingsFolderManagementSection.mode.set(mediaSettingsFolderManagementMode);
	}

	$: if (mediaSettingsImportingMode !== mediaSettingsImportingModeSynced) {
		mediaSettingsImportingModeSynced = mediaSettingsImportingMode;
		mediaSettingsImportingSection.mode.set(mediaSettingsImportingMode);
	}

	onDestroy(() => {
		unsubscribeMediaSettingsNamingMode();
		unsubscribeMediaSettingsFolderManagementMode();
		unsubscribeMediaSettingsImportingMode();
	});

	function mapToFormData(data: RadarrMediaSettingsRow | null): RadarrMediaSettingsRowFormData {
		if (!data) return defaults;
		return {
			name: data.name,
			propersRepacks: data.propers_repacks,
			enableMediaInfo: data.enable_media_info
		};
	}

	if (mode === 'create') {
		initCreate(mapToFormData(initialData));
	} else {
		initEdit(mapToFormData(initialData));
	}

	$: formData = $current as RadarrMediaSettingsRowFormData;

	let saving = false;
	let deleting = false;
	let showDeleteModal = false;
	let selectedLayer: 'user' | 'base' = canWriteToBase ? 'base' : 'user';
	let mainFormElement: HTMLFormElement;
	let deleteFormElement: HTMLFormElement;

	const arrTypeLabelMap: Record<ArrType, string> = {
		radarr: 'Radarr',
		sonarr: 'Sonarr',
		lidarr: 'Lidarr',
		all: 'All Apps'
	};

	function getResultError(data: unknown): string {
		if (!data || typeof data !== 'object') {
			return 'Operation failed';
		}

		const details = data as { error?: unknown; message?: unknown; errors?: unknown };
		if (typeof details.error === 'string' && details.error.trim()) {
			return details.error;
		}

		if (typeof details.message === 'string' && details.message.trim()) {
			return details.message;
		}

		if (Array.isArray(details.errors)) {
			const messages = details.errors
				.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
				.map((entry) => entry.trim());
			if (messages.length > 0) {
				return messages.join(', ');
			}
		}

		if (details.errors && typeof details.errors === 'object') {
			const messages = Object.values(details.errors)
				.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
				.map((entry) => entry.trim());
			if (messages.length > 0) {
				return messages.join(', ');
			}
		}
		return 'Operation failed';
	}

	$: arrLabel = arrTypeLabelMap[arrType];
	$: title = mode === 'create' ? `New ${arrLabel} Media Settings` : `Edit ${arrLabel} Media Settings`;
	$: description =
		mode === 'create'
			? `Create a new ${arrLabel} media settings configuration for ${databaseName}`
			: `Update ${arrLabel} media settings configuration`;
	$: isValid = formData.name.trim() !== '';

	async function handleSaveClick() {
		if (saving) return;
		saving = true;
		selectedLayer = canWriteToBase ? 'base' : 'user';
		await tick();
		mainFormElement?.requestSubmit();
	}

	async function handleDeleteClick() {
		showDeleteModal = true;
	}

	async function handleDeleteConfirm() {
		selectedLayer = canWriteToBase ? 'base' : 'user';
		showDeleteModal = false;
		await tick();
		deleteFormElement?.requestSubmit();
	}

	function handleDeleteCancel() {
		showDeleteModal = false;
	}

</script>

<StickyCard position="top">
	<div slot="left">
		<h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h1>
		<p class="text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
	</div>
	<div slot="right" class="flex items-center gap-2">
		{#if mode === 'edit'}
			<Button
				text={deleting ? 'Deleting...' : 'Delete'}
				icon={Trash2}
				iconColor="text-red-600 dark:text-red-400"
				disabled={deleting || saving}
				on:click={handleDeleteClick}
			/>
		{/if}
		<Button
			text={saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
			icon={Save}
			iconColor="text-blue-600 dark:text-blue-400"
			disabled={saving || !isValid || !$isDirty}
			on:click={handleSaveClick}
		/>
	</div>
</StickyCard>

<div class="mt-6 md:px-4">
	<div
		class="space-y-6 rounded-xl border border-neutral-300 bg-white p-6 dark:border-neutral-700/60 dark:bg-neutral-800/50"
	>
		<!-- Basic Info -->
		<div class="space-y-4">
			<h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Basic Info</h2>
			<FormInput
				label="Name"
				name="name"
				placeholder="e.g., default"
				required
				value={formData.name}
				on:input={(e) => update('name', e.detail)}
			/>
		</div>

		<hr class="border-neutral-200 dark:border-neutral-700" />

		<!-- Propers and Repacks -->
		<AdvancedSection
			sectionId="media-management:media-settings:naming"
			sectionTitle="Naming"
			sectionHint="Rename token controls and naming strategy options."
			bind:mode={mediaSettingsNamingMode}
		>
			<div slot="advanced" class="space-y-4">
				<h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">Propers and Repacks</h2>
				<div class="grid gap-2">
					{#each PROPERS_REPACKS_OPTIONS as option (option.value)}
						<div>
							<Toggle
								label={option.label}
								checked={formData.propersRepacks === option.value}
								on:change={() => update('propersRepacks', option.value)}
							/>
							<p class="mt-1 px-3 text-xs text-neutral-500 dark:text-neutral-400">
								{option.description}
							</p>
						</div>
					{/each}
				</div>
			</div>
		</AdvancedSection>

		<AdvancedSection
			sectionId="media-management:media-settings:folder-management"
			sectionTitle="Folder Management"
			sectionHint="Folder and organization tuning options."
			bind:mode={mediaSettingsFolderManagementMode}
		>
			<div slot="advanced" class="space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
				No dedicated folder-management controls are available in this form yet.
			</div>
		</AdvancedSection>

		<AdvancedSection
			sectionId="media-management:media-settings:importing"
			sectionTitle="Importing"
			sectionHint="Import behavior toggles and advanced import rules."
			bind:mode={mediaSettingsImportingMode}
		>
			<div slot="advanced" class="space-y-4">
				<div>
					<Toggle
						label="Enable Media Info"
						checked={formData.enableMediaInfo}
						on:change={() => update('enableMediaInfo', !formData.enableMediaInfo)}
					/>
					<p class="mt-1 px-3 text-xs text-neutral-500 dark:text-neutral-400">
						Scan files to extract media information (codec, resolution, audio tracks, etc.)
					</p>
				</div>
			</div>
		</AdvancedSection>
	</div>
	</div>

<!-- Hidden save form -->
<form
	bind:this={mainFormElement}
	method="POST"
	action={actionUrl}
	class="hidden"
	use:enhance={() => {
		saving = true;
		return async ({ result, update: formUpdate }) => {
			if (result.type === 'failure') {
				alertStore.add('error', getResultError(result.data));
			} else if (result.type === 'redirect') {
				alertStore.add(
					'success',
					mode === 'create' ? 'Media settings created!' : 'Media settings updated!'
				);
				initEdit(formData);
			}
			await formUpdate();
			saving = false;
		};
	}}
>
	<input type="hidden" name="arrType" value={arrType} />
	<input type="hidden" name="name" value={formData.name} />
	<input type="hidden" name="propersRepacks" value={formData.propersRepacks} />
	<input type="hidden" name="enableMediaInfo" value={formData.enableMediaInfo} />
	<input type="hidden" name="layer" value={selectedLayer} />
</form>

<!-- Hidden delete form -->
{#if mode === 'edit'}
	<form
		bind:this={deleteFormElement}
		method="POST"
		action="?/delete"
		class="hidden"
		use:enhance={() => {
			deleting = true;
			return async ({ result, update: formUpdate }) => {
				if (result.type === 'failure') {
					alertStore.add(
						'error',
						getResultError(result.data)
					);
				} else if (result.type === 'redirect') {
					alertStore.add('success', 'Media settings deleted');
				}
				await formUpdate();
				deleting = false;
			};
		}}
	>
		<input type="hidden" name="layer" value={selectedLayer} />
	</form>
{/if}

<Modal
	open={showDeleteModal}
	header={`Delete ${arrLabel} media settings`}
	bodyMessage={`This will remove this ${arrLabel.toLowerCase()} media settings configuration and write a delete op. You can recreate it later if needed.`}
	confirmText="Delete"
	cancelText="Cancel"
	confirmDanger={true}
	confirmDisabled={deleting}
	loading={deleting}
	on:confirm={handleDeleteConfirm}
	on:cancel={handleDeleteCancel}
/>
