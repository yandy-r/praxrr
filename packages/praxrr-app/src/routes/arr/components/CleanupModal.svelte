<script lang="ts">
	import { Loader2, AlertTriangle, Check } from 'lucide-svelte';
	import Modal from '$ui/modal/Modal.svelte';

	export let open = false;
	export let instanceId: number;

	type StaleItem = { id: number; name: string; strippedName: string };
	type SkippedItem = { item: StaleItem; reason: string };
	type ScanResult = { staleCustomFormats: StaleItem[]; staleQualityProfiles: StaleItem[] };
	type DeleteResult = {
		deletedCustomFormats: StaleItem[];
		deletedQualityProfiles: StaleItem[];
		skippedQualityProfiles: SkippedItem[];
	};

	type Phase = 'idle' | 'scanning' | 'preview' | 'executing' | 'results';

	let phase: Phase = 'idle';
	let scanResult: ScanResult | null = null;
	let deleteResult: DeleteResult | null = null;
	let error: string | null = null;

	// Derived modal props
	$: isLoading = phase === 'scanning' || phase === 'executing';
	$: isEmpty = scanResult && scanResult.staleCustomFormats.length === 0 && scanResult.staleQualityProfiles.length === 0;

	$: confirmText = (() => {
		if (phase === 'scanning') return 'Scanning...';
		if (phase === 'executing') return 'Cleaning...';
		if (phase === 'preview' && !isEmpty) return 'Clean Up';
		return 'Close';
	})();

	$: confirmDanger = phase === 'preview' && !isEmpty;
	$: confirmDisabled = phase === 'scanning' || phase === 'executing';

	$: totalStale = scanResult
		? scanResult.staleCustomFormats.length + scanResult.staleQualityProfiles.length
		: 0;

	// Auto-scan when modal opens
	$: if (open && phase === 'idle') {
		scan();
	}

	function reset() {
		phase = 'idle';
		scanResult = null;
		deleteResult = null;
		error = null;
	}

	async function scan() {
		phase = 'scanning';
		error = null;

		try {
			const res = await fetch('/api/v1/arr/cleanup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instanceId, action: 'scan' })
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Scan failed');
			}

			scanResult = await res.json();
			phase = 'preview';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Scan failed';
			phase = 'preview';
		}
	}

	async function execute() {
		if (!scanResult) return;
		phase = 'executing';

		try {
			const res = await fetch('/api/v1/arr/cleanup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ instanceId, action: 'execute', scanResult })
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Cleanup failed');
			}

			deleteResult = await res.json();
			phase = 'results';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Cleanup failed';
			phase = 'results';
		}
	}

	function handleConfirm() {
		if (phase === 'preview' && !isEmpty && !error) {
			execute();
		} else {
			open = false;
			reset();
		}
	}

	function handleCancel() {
		open = false;
		reset();
	}
</script>

<Modal
	{open}
	header="Cleanup Stale Configs"
	{confirmText}
	{confirmDanger}
	{confirmDisabled}
	loading={isLoading}
	on:confirm={handleConfirm}
	on:cancel={handleCancel}
>
	<div slot="body">
		{#if error}
			<!-- Error state -->
			<div class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
				<AlertTriangle size={20} class="mt-0.5 flex-shrink-0 text-red-500" />
				<div>
					<p class="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
					<p class="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
				</div>
			</div>

		{:else if phase === 'scanning'}
			<!-- Scanning -->
			<div class="flex flex-col items-center gap-3 py-8">
				<Loader2 size={32} class="animate-spin text-neutral-400" />
				<p class="text-sm text-neutral-500 dark:text-neutral-400">Scanning for stale configs...</p>
			</div>

		{:else if phase === 'preview' && isEmpty}
			<!-- Nothing to clean -->
			<div class="flex flex-col items-center gap-3 py-8">
				<Check size={32} class="text-emerald-500" />
				<p class="text-sm text-neutral-600 dark:text-neutral-400">No stale configs found. Everything is clean.</p>
			</div>

		{:else if phase === 'preview' && scanResult}
			<!-- Preview summary -->
			<div class="space-y-3">
				<p class="text-sm text-neutral-600 dark:text-neutral-400">
					Found stale configs that are no longer in your sync selections:
				</p>
				<div class="space-y-2">
					{#if scanResult.staleCustomFormats.length > 0}
						<p class="text-sm text-neutral-700 dark:text-neutral-300">
							<span class="font-medium">{scanResult.staleCustomFormats.length}</span> custom format{scanResult.staleCustomFormats.length === 1 ? '' : 's'}
						</p>
					{/if}
					{#if scanResult.staleQualityProfiles.length > 0}
						<p class="text-sm text-neutral-700 dark:text-neutral-300">
							<span class="font-medium">{scanResult.staleQualityProfiles.length}</span> quality profile{scanResult.staleQualityProfiles.length === 1 ? '' : 's'}
						</p>
					{/if}
				</div>
			</div>

		{:else if phase === 'executing'}
			<!-- Executing -->
			<div class="flex flex-col items-center gap-3 py-8">
				<Loader2 size={32} class="animate-spin text-neutral-400" />
				<p class="text-sm text-neutral-500 dark:text-neutral-400">Deleting stale configs...</p>
			</div>

		{:else if phase === 'results' && deleteResult}
			<!-- Results -->
			<div class="space-y-3">
				{#if deleteResult.deletedCustomFormats.length > 0 || deleteResult.deletedQualityProfiles.length > 0}
					<div class="space-y-2">
						{#if deleteResult.deletedCustomFormats.length > 0}
							<div class="flex items-center gap-2">
								<Check size={16} class="flex-shrink-0 text-emerald-500" />
								<p class="text-sm text-neutral-700 dark:text-neutral-300">
									Deleted <span class="font-medium">{deleteResult.deletedCustomFormats.length}</span> custom format{deleteResult.deletedCustomFormats.length === 1 ? '' : 's'}
								</p>
							</div>
						{/if}
						{#if deleteResult.deletedQualityProfiles.length > 0}
							<div class="flex items-center gap-2">
								<Check size={16} class="flex-shrink-0 text-emerald-500" />
								<p class="text-sm text-neutral-700 dark:text-neutral-300">
									Deleted <span class="font-medium">{deleteResult.deletedQualityProfiles.length}</span> quality profile{deleteResult.deletedQualityProfiles.length === 1 ? '' : 's'}
								</p>
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-neutral-500 dark:text-neutral-400">Nothing was deleted.</p>
				{/if}

				{#if deleteResult.skippedQualityProfiles.length > 0}
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<AlertTriangle size={16} class="flex-shrink-0 text-amber-500" />
							<p class="text-sm text-neutral-700 dark:text-neutral-300">
								Skipped {deleteResult.skippedQualityProfiles.length} profile{deleteResult.skippedQualityProfiles.length === 1 ? '' : 's'} assigned to media
							</p>
						</div>
						{#each deleteResult.skippedQualityProfiles as skipped}
							<p class="pl-6 text-sm text-neutral-500 dark:text-neutral-400">{skipped.item.strippedName}</p>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</Modal>
