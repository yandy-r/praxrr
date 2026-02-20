<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	import { Eye, EyeOff } from 'lucide-svelte';

	export let id = 'masked-api-key';
	export let label = 'API key';
	export let maskedValue = '';
	export let value = '';
	export let hasValue = false;
	export let revealTimeoutMs = 30_000;
	export let copyFeedbackVisibleMs = 2_000;
	export let disabled = false;
	export let revealLabel = 'Reveal';
	export let hideLabel = 'Hide';
	export let copyLabel = 'Copy';
	const noValueLabel = 'No API key configured';

	const dispatch = createEventDispatcher<
		{
			revealChange: { revealed: boolean; reason: 'manual' | 'timeout' };
			copyFeedback: { success: boolean; message: string; error?: Error };
		}
	>();

	let isRevealed = false;
	let statusMessage = '';
	let statusType: 'idle' | 'success' | 'error' | 'info' = 'idle';
	let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

	$: hasDisplayValue = hasValue || Boolean(maskedValue);
	$: canInteract = hasDisplayValue && !disabled;
	$: ariaStatusId = `${id}-status`;
	$: visibleMaskedValue = hasDisplayValue && maskedValue ? maskedValue : maskedValue || '••••••••';
	$: visibleValue = isRevealed ? (value || visibleMaskedValue) : visibleMaskedValue;
	$: revealButtonLabel = isRevealed ? hideLabel : revealLabel;
	$: revealButtonMessage = `${revealButtonLabel} ${label}`;
	$: copyButtonMessage = `${copyLabel} ${label}`;
	$: statusClass = statusType === 'success'
		? 'text-emerald-600 dark:text-emerald-400'
		: statusType === 'error'
			? 'text-red-600 dark:text-red-300'
			: 'text-neutral-500 dark:text-neutral-400';

	$: if (!canInteract && isRevealed) {
		hideValue('timeout');
	}

	function clearFeedback() {
		statusMessage = '';
		statusType = 'idle';
		if (feedbackTimer) {
			clearTimeout(feedbackTimer);
			feedbackTimer = null;
		}
	}

	function clearAutoHideTimer() {
		if (autoHideTimer) {
			clearTimeout(autoHideTimer);
			autoHideTimer = null;
		}
	}

	function publishStatus(message: string, nextType: 'success' | 'error' | 'info', clearAfter = copyFeedbackVisibleMs) {
		statusMessage = message;
		statusType = nextType === 'info' ? 'info' : nextType;

		if (feedbackTimer) {
			clearTimeout(feedbackTimer);
			feedbackTimer = null;
		}

		if (clearAfter > 0) {
			feedbackTimer = setTimeout(() => {
				clearFeedback();
		}, clearAfter);
		}
	}

	function revealByTimeout() {
		autoHideTimer = setTimeout(() => {
			hideValue('timeout');
		}, revealTimeoutMs);
	}

	function hideValue(reason: 'manual' | 'timeout') {
		if (!isRevealed) return;
		isRevealed = false;
		clearAutoHideTimer();
		dispatch('revealChange', { revealed: false, reason });
		if (reason === 'timeout') {
			publishStatus('API key hidden', 'info', 1500);
		}
	}

	function toggleReveal() {
		if (!canInteract) {
			publishStatus('No API key available', 'error', 1500);
			return;
		}

		if (isRevealed) {
			hideValue('manual');
			publishStatus('API key hidden', 'info', 1500);
			return;
		}

		isRevealed = true;
		displayRevealSuccess();
	}

	function displayRevealSuccess() {
		clearAutoHideTimer();
		clearFeedback();
		dispatch('revealChange', { revealed: true, reason: 'manual' });
		if (revealTimeoutMs > 0) {
			revealByTimeout();
		}
		publishStatus('API key visible', 'info', 1500);
	}

	async function copyValue() {
		if (!canInteract) {
			publishStatus('No API key available', 'error', 1500);
			dispatch('copyFeedback', {
				success: false,
				message: 'No API key available',
				error: new Error('No key available to copy')
			});
			return;
		}

		if (!value) {
			publishStatus('Copy failed', 'error', 1500);
			dispatch('copyFeedback', {
				success: false,
				message: 'Copy failed',
				error: new Error('Missing key value')
			});
			return;
		}

		try {
			if (!navigator.clipboard || !navigator.clipboard.writeText) {
				throw new Error('Clipboard API unavailable');
			}

			await navigator.clipboard.writeText(value);
			publishStatus('API key copied', 'success');
			dispatch('copyFeedback', {
				success: true,
				message: 'API key copied'
			});
		} catch (error) {
			publishStatus('Copy failed', 'error');
			dispatch('copyFeedback', {
				success: false,
				message: 'Copy failed',
				error: error instanceof Error ? error : new Error('Copy failed')
			});
		}
	}

	onDestroy(() => {
		clearAutoHideTimer();
		clearFeedback();
	});
</script>

<div class="space-y-2">
	<p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</p>

	<div
		class="rounded-xl border border-neutral-200 bg-white p-2 px-3 font-mono text-sm text-neutral-900 break-all dark:border-neutral-700/70 dark:bg-neutral-900 dark:text-neutral-100"
	>{hasDisplayValue ? visibleValue || '••••••••' : noValueLabel}</div>

	<div class="flex gap-2">
		<button
			type="button"
			class="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
			aria-label={revealButtonMessage}
			aria-pressed={isRevealed}
			title={revealButtonMessage}
			disabled={!canInteract}
			on:click={toggleReveal}
		>
			{#if isRevealed}
				<EyeOff size={16} />
				<span>Hide</span>
			{:else}
				<Eye size={16} />
				<span>Reveal</span>
			{/if}
		</button>

		<button
			type="button"
			class="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
			aria-label={copyButtonMessage}
			title={copyButtonMessage}
			aria-describedby={ariaStatusId}
			disabled={!canInteract}
			on:click={copyValue}
		>
		<span>Copy</span>
		</button>
	</div>

	<p
		id={ariaStatusId}
		role="status"
		aria-live="polite"
		class={`text-xs font-medium ${statusType === 'idle' ? 'sr-only' : statusClass}`}
	>
		{statusMessage || (!hasDisplayValue ? noValueLabel : '')}
	</p>
</div>
