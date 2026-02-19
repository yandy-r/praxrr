<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Download, Trash2, RotateCcw, Upload, FolderArchive, BrushCleaning } from 'lucide-svelte';
	import Modal from '$ui/modal/Modal.svelte';
	import type { PageData } from './$types';
	import type { Column } from '$lib/client/ui/table/types';
	import Table from '$lib/client/ui/table/Table.svelte';
	import Button from '$ui/button/Button.svelte';
	import Badge from '$lib/client/ui/badge/Badge.svelte';
	import ActionsBar from '$lib/client/ui/actions/ActionsBar.svelte';
	import ActionButton from '$lib/client/ui/actions/ActionButton.svelte';
	import SearchAction from '$lib/client/ui/actions/SearchAction.svelte';
	import Tooltip from '$ui/tooltip/Tooltip.svelte';
	import { getPersistentSearchStore } from '$lib/client/stores/search';

	export let data: PageData;

	type Backup = (typeof data.backups)[0];

	// Search store
	const searchStore = getPersistentSearchStore('settingsBackupsSearch');

	// Filtered backups
	$: filteredBackups = searchStore.filterItems(data.backups, ['filename']);

	const columns: Column<Backup>[] = [
		{ key: 'filename', header: 'Filename', sortable: true },
		{ key: 'created', header: 'Created', sortable: true },
		{ key: 'sizeFormatted', header: 'Size', sortable: true, width: 'w-32' }
	];

	// Modal state
	let showDeleteModal = false;
	let showRestoreModal = false;
	let selectedBackup: string | null = null;
	let deleteFormRef: HTMLFormElement | null = null;
	let restoreFormRef: HTMLFormElement | null = null;

	// File upload
	let fileInput: HTMLInputElement;
	let uploadFormRef: HTMLFormElement;
	let createFormRef: HTMLFormElement;
	let cleanupFormRef: HTMLFormElement;

	function downloadBackup(filename: string) {
		window.location.href = `/api/backups/download/${filename}`;
	}

	function triggerFileUpload() {
		fileInput?.click();
	}

	function triggerCreateBackup() {
		createFormRef?.requestSubmit();
	}

	function triggerCleanupBackups() {
		cleanupFormRef?.requestSubmit();
	}

	function formatDateTime(date: Date): string {
		return new Date(date).toLocaleString();
	}

	function openDeleteModal(filename: string, formRef: HTMLFormElement) {
		selectedBackup = filename;
		deleteFormRef = formRef;
		showDeleteModal = true;
	}

	function openRestoreModal(filename: string, formRef: HTMLFormElement) {
		selectedBackup = filename;
		restoreFormRef = formRef;
		showRestoreModal = true;
	}

	function confirmDelete() {
		if (deleteFormRef) {
			deleteFormRef.requestSubmit();
		}
		showDeleteModal = false;
		selectedBackup = null;
		deleteFormRef = null;
	}

	function confirmRestore() {
		if (restoreFormRef) {
			restoreFormRef.requestSubmit();
		}
		showRestoreModal = false;
		selectedBackup = null;
		restoreFormRef = null;
	}

	function cancelDelete() {
		showDeleteModal = false;
		selectedBackup = null;
		deleteFormRef = null;
	}

	function cancelRestore() {
		showRestoreModal = false;
		selectedBackup = null;
		restoreFormRef = null;
	}
</script>

<div class="p-4 md:p-8">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Backups</h1>
		<p class="mt-3 text-base text-neutral-600 md:text-lg dark:text-neutral-400">
			Manage database and configuration backups
		</p>
	</div>

	<!-- Hidden forms for upload and create -->
	<form
		bind:this={uploadFormRef}
		method="POST"
		action="?/uploadBackup"
		enctype="multipart/form-data"
		class="hidden"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add(
						'error',
						(result.data as { error?: string }).error || 'Failed to upload backup'
					);
				} else if (result.type === 'success') {
					alertStore.add('success', 'Backup uploaded successfully');
					fileInput.value = '';
				}
				await update();
			};
		}}
	>
		<input
			type="file"
			name="file"
			accept=".tar.gz"
			bind:this={fileInput}
			on:change={(e) => {
				if (e.currentTarget.files?.length) {
					uploadFormRef.requestSubmit();
				}
			}}
		/>
	</form>

	<form
		bind:this={createFormRef}
		method="POST"
		action="?/createBackup"
		class="hidden"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add(
						'error',
						(result.data as { error?: string }).error || 'Failed to create backup'
					);
				} else if (result.type === 'success') {
					alertStore.add('success', 'Backup queued');
				}
				await update();
			};
		}}
	></form>

	<form
		bind:this={cleanupFormRef}
		method="POST"
		action="?/cleanupBackups"
		class="hidden"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add(
						'error',
						(result.data as { error?: string }).error || 'Failed to run backup cleanup'
					);
				} else if (result.type === 'success') {
					alertStore.add('success', 'Backup cleanup queued');
				}
				await update();
			};
		}}
	></form>

	<!-- Actions Bar -->
	<div class="mb-4">
		<ActionsBar>
			<SearchAction {searchStore} placeholder="Search backups..." />
			<Tooltip text="Upload Backup">
				<ActionButton icon={Upload} on:click={triggerFileUpload} />
			</Tooltip>
			<Tooltip text="Create Backup">
				<ActionButton icon={FolderArchive} on:click={triggerCreateBackup} />
			</Tooltip>
			<Tooltip text="Run Backup Cleanup">
				<ActionButton icon={BrushCleaning} on:click={triggerCleanupBackups} />
			</Tooltip>
		</ActionsBar>
	</div>

	<!-- Backups Table -->
	<Table
		{columns}
		data={filteredBackups}
		emptyMessage="No backups found. Create your first backup to get started."
		compact
		responsive
	>
		<svelte:fragment slot="cell" let:row let:column>
			{#if column.key === 'filename'}
				<Badge variant="neutral" mono>{row.filename}</Badge>
			{:else if column.key === 'created'}
				<Badge variant="neutral" mono>{formatDateTime(row.created)}</Badge>
			{:else if column.key === 'sizeFormatted'}
				<Badge variant="neutral" mono>{row.sizeFormatted}</Badge>
			{/if}
		</svelte:fragment>

		<svelte:fragment slot="actions" let:row>
			<div class="flex items-center justify-end gap-0.5">
				<Button
					icon={Download}
					size="xs"
					variant="ghost"
					tooltip="Download"
					on:click={() => downloadBackup(row.filename)}
				/>

				<form
					method="POST"
					action="?/restoreBackup"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'failure' && result.data) {
								alertStore.add(
									'error',
									(result.data as { error?: string }).error || 'Failed to restore backup'
								);
							} else if (result.type === 'success') {
								alertStore.add(
									'success',
									'Backup restored successfully. Please restart the application.'
								);
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="filename" value={row.filename} />
					<Button
						icon={RotateCcw}
						size="xs"
						variant="ghost"
						tooltip="Restore"
						on:click={(e) => {
							const form = (e.currentTarget as HTMLElement)?.closest('form');
							if (form) openRestoreModal(row.filename, form);
						}}
					/>
				</form>

				<form
					method="POST"
					action="?/deleteBackup"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'failure' && result.data) {
								alertStore.add(
									'error',
									(result.data as { error?: string }).error || 'Failed to delete backup'
								);
							} else if (result.type === 'success') {
								alertStore.add('success', 'Backup deleted successfully');
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="filename" value={row.filename} />
					<Button
						icon={Trash2}
						size="xs"
						variant="ghost"
						tooltip="Delete"
						on:click={(e) => {
							const form = (e.currentTarget as HTMLElement)?.closest('form');
							if (form) openDeleteModal(row.filename, form);
						}}
					/>
				</form>
			</div>
		</svelte:fragment>
	</Table>
</div>

<!-- Delete Confirmation Modal -->
<Modal
	open={showDeleteModal}
	header="Delete Backup"
	bodyMessage="Are you sure you want to delete this backup? This action cannot be undone.{selectedBackup
		? `\n\nBackup: ${selectedBackup}`
		: ''}"
	confirmText="Delete Backup"
	cancelText="Cancel"
	confirmDanger={true}
	on:confirm={confirmDelete}
	on:cancel={cancelDelete}
/>

<!-- Restore Confirmation Modal -->
<Modal
	open={showRestoreModal}
	header="Restore Backup"
	bodyMessage="Restoring this backup will replace all current data with the data from the backup. This action cannot be undone. You will need to restart the application after restoring.{selectedBackup
		? `\n\nBackup: ${selectedBackup}`
		: ''}"
	confirmText="Restore Backup"
	cancelText="Cancel"
	on:confirm={confirmRestore}
	on:cancel={cancelRestore}
/>
