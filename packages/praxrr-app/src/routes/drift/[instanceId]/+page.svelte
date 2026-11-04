<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { BellOff, Check, Clock, Loader2, RefreshCw, Save, Wrench, X } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import DriftFieldDiff from '$ui/drift/DriftFieldDiff.svelte';
  import NarrationBlock from '$ui/narration/NarrationBlock.svelte';
  import SyncPreviewPanel from '../../arr/[id]/sync/components/SyncPreviewPanel.svelte';
  import { rememberSyncPreviewRequest } from '../../arr/[id]/sync/components/SyncPreviewTrigger.svelte';
  import {
    DRIFT_REMEDIATION_MODE_DESCRIPTION,
    DRIFT_REMEDIATION_MODE_LABEL,
    DRIFT_REMEDIATION_STATUS_LABEL,
    DRIFT_REMEDIATION_TRIGGER_LABEL,
    DRIFT_STATUS_LABEL,
    DRIFT_SUPPRESSION_LABEL,
    driftRemediationStatusVariant,
    driftStatusVariant,
    driftSuppressionVariant,
  } from '$ui/drift/driftStatus.ts';
  import { alertStore } from '$alerts/store';
  import { eventsStore } from '$stores/events';
  import { clear, current, initEdit, isDirty, resetFromServer, update } from '$stores/dirty';
  import { supportsFeature, type ArrSyncSurface } from '$shared/arr/capabilities.ts';
  import { narrateDriftReason, narrateDriftCounts, narrateDriftEntity } from '$shared/narration/index.ts';
  import { resolveSyncSectionLabel } from '$shared/narration/templates.ts';
  import type { NarrationLevel } from '$shared/narration/index.ts';
  import type { DriftDetailResponse, DriftEntityChangeResponse } from '$sync/drift/responses.ts';
  import type { DriftRemediationMode, DriftRemediationPolicy } from '$sync/drift/types.ts';
  import type { SyncPreviewResult, SyncPreviewSection, SyncPreviewSummary } from '$sync/preview/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  type SyncPreviewRouteState = {
    previewId: string | null;
    status: 'idle' | 'generating' | 'error' | 'ready';
    summary: SyncPreviewSummary | null;
    error: string | null;
    recoveryAction: string | null;
  };

  type SuppressionInput = {
    acknowledgeInstance: boolean;
    acknowledgedEntityKeys: string[];
    snoozedUntil: string | null;
  };

  const IDLE_PREVIEW: SyncPreviewRouteState = {
    previewId: null,
    status: 'idle',
    summary: null,
    error: null,
    recoveryAction: null,
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const SNOOZE_PRESETS: readonly { days: number; label: string }[] = [
    { days: 1, label: '1 day' },
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
  ];

  /** Sync sections in canonical order with the capability surface that gates each per Arr app. */
  const POLICY_SECTIONS: readonly { section: SyncPreviewSection; surface: ArrSyncSurface }[] = [
    { section: 'qualityProfiles', surface: 'quality_profiles' },
    { section: 'delayProfiles', surface: 'delay_profiles' },
    { section: 'mediaManagement', surface: 'media_management' },
    { section: 'metadataProfiles', surface: 'metadata_profiles' },
  ];

  const MODE_OPTIONS = (['off', 'notify', 'auto'] as const).map((mode) => ({
    value: mode,
    label: DRIFT_REMEDIATION_MODE_LABEL[mode],
    description: DRIFT_REMEDIATION_MODE_DESCRIPTION[mode],
  }));

  function formatWhen(iso: string | null): string {
    if (!iso) return 'Never';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
  }

  function changeId(change: DriftEntityChangeResponse): string {
    return `${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`;
  }

  /** Mirrors the server's alerting rule: only managed drift (update) and missing (create) ack. */
  function isAcknowledgeable(change: DriftEntityChangeResponse): boolean {
    return change.action === 'update' || change.action === 'create';
  }

  async function readError(response: Response, fallback: string): Promise<string> {
    const body = (await response.json().catch(() => null)) as ErrorResponse | null;
    return typeof body?.error === 'string' ? body.error : `${fallback} (HTTP ${response.status})`;
  }

  let detail: DriftDetailResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let refreshing = false;
  let detailRequestId = 0;
  let verbose = false;
  $: level = (verbose ? 'verbose' : 'summary') as NarrationLevel;

  // Reconcile → reviewed preview rendered by the shared SyncPreviewPanel.
  let previewState: SyncPreviewRouteState = IDLE_PREVIEW;
  let reconciling = false;

  // Suppression (acknowledge / snooze).
  let savingSuppression = false;

  // Remediation policy form (dirty-tracked).
  let serverPolicy: DriftRemediationPolicy | null = null;
  let policyHydrated = false;
  let savingPolicy = false;
  let showAutoConfirm = false;

  function hydratePolicy(policy: DriftRemediationPolicy) {
    serverPolicy = policy;
    const snapshot = { mode: policy.mode, allowedSections: [...policy.allowedSections] };
    if (!policyHydrated) {
      initEdit(snapshot);
      policyHydrated = true;
      return;
    }
    // A live reload must never clobber an in-progress edit.
    if (!savingPolicy && !get(isDirty)) resetFromServer(snapshot);
  }

  function setDetail(next: DriftDetailResponse) {
    detail = next;
    hydratePolicy(next.remediationPolicy);
  }

  async function loadDetail() {
    if (data.instanceId === null) return;
    const instanceId = data.instanceId;
    const requestId = ++detailRequestId;
    loading = true;
    loadError = null;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}`);
      if (requestId !== detailRequestId) return;

      if (!response.ok) {
        const message = await readError(response, 'Failed to load drift detail');
        if (requestId !== detailRequestId) return;
        loadError = message;
        return;
      }

      const next = (await response.json()) as DriftDetailResponse;
      if (requestId !== detailRequestId) return;
      setDetail(next);
    } catch (err) {
      if (requestId !== detailRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load drift detail';
    } finally {
      // loadDetail is the sole owner of `loading` (calls never overlap; refreshNow doesn't set
      // it), so clear it unconditionally — otherwise a refresh that bumps the guard mid-load
      // would strand the spinner forever.
      loading = false;
    }
  }

  /**
   * Run a fresh drift check. `afterApply` is the post-reconcile verification: a rate limit there
   * is informational (the apply already succeeded), and the result message reports whether the
   * instance is now in sync.
   */
  async function refreshNow(afterApply = false) {
    if (data.instanceId === null || refreshing) return;
    const instanceId = data.instanceId;
    // A fresh check supersedes any in-flight GET: bump the guard so a slow load can't
    // clobber the POST result assigned below.
    const requestId = ++detailRequestId;
    refreshing = true;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}`, { method: 'POST' });

      if (response.status === 429) {
        if (afterApply) {
          alertStore.add('info', 'Reconcile applied. The drift re-check is rate-limited; it will update shortly.');
        } else {
          alertStore.add('warning', 'Too many drift refreshes for this instance — try again shortly.');
        }
        return;
      }
      if (response.status === 409) {
        alertStore.add('info', 'A drift check for this instance is already in progress.');
        return;
      }
      if (!response.ok) {
        alertStore.add('error', await readError(response, 'Failed to refresh drift'));
        return;
      }

      const next = (await response.json()) as DriftDetailResponse;
      if (requestId !== detailRequestId) return;
      setDetail(next);
      if (!afterApply) {
        alertStore.add('success', 'Drift check complete.');
      } else if (next.status === 'in-sync') {
        alertStore.add('success', 'Reconcile verified — this instance is back in sync.');
      } else if (next.status === 'drifted') {
        alertStore.add('warning', 'Reconcile applied, but drift remains. Review the remaining changes.');
      } else {
        alertStore.add('warning', 'Reconcile applied, but the drift re-check could not confirm the instance state.');
      }
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to refresh drift');
    } finally {
      refreshing = false;
    }
  }

  function isPreviewResult(payload: unknown): payload is SyncPreviewResult {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const candidate = payload as Partial<SyncPreviewResult>;
    return typeof candidate.id === 'string' && !!candidate.summary;
  }

  async function reconcile() {
    if (data.instanceId === null || reconciling) return;
    const instanceId = data.instanceId;
    reconciling = true;
    previewState = { ...IDLE_PREVIEW, status: 'generating' };
    // Empty body ⇒ the server reconciles every currently drifted section. Regenerating re-sends
    // this same body so the new preview reflects the drift at that moment.
    const requestBody = '{}';

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.status === 409) {
        previewState = IDLE_PREVIEW;
        alertStore.add('warning', await readError(response, 'Drift changed; nothing to reconcile'));
        await loadDetail();
        return;
      }
      if (response.status === 429) {
        previewState = IDLE_PREVIEW;
        alertStore.add('warning', 'Preview capacity is busy — try reconciling again shortly.');
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isPreviewResult(payload)) {
        // A hard generation failure returns the failed snapshot with a typed, safe `failure`;
        // 4xx validation errors keep the authored-safe `error` string. Never raw text.
        const record = (payload ?? {}) as {
          error?: unknown;
          failure?: { message?: unknown; recoveryAction?: unknown } | null;
        };
        const message =
          record.failure && typeof record.failure.message === 'string'
            ? record.failure.message
            : typeof record.error === 'string'
              ? record.error
              : 'Failed to create a reconcile preview.';
        const recoveryAction =
          record.failure && typeof record.failure.recoveryAction === 'string' ? record.failure.recoveryAction : null;
        previewState = { ...IDLE_PREVIEW, status: 'error', error: message, recoveryAction };
        alertStore.add('error', message);
        return;
      }

      rememberSyncPreviewRequest(payload.id, requestBody);
      previewState = {
        previewId: payload.id,
        status: 'ready',
        summary: payload.summary,
        error: null,
        recoveryAction: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create a reconcile preview.';
      previewState = { ...IDLE_PREVIEW, status: 'error', error: message };
      alertStore.add('error', message);
    } finally {
      reconciling = false;
    }
  }

  function dismissPreview() {
    previewState = IDLE_PREVIEW;
  }

  function handleApplied() {
    void refreshNow(true);
  }

  function currentSuppression(): SuppressionInput {
    const suppression = detail?.suppression;
    return {
      acknowledgeInstance: !!suppression && suppression.acknowledgedSignature !== null,
      acknowledgedEntityKeys: suppression ? [...suppression.acknowledgedEntityKeys] : [],
      snoozedUntil: suppression?.snoozedUntil ?? null,
    };
  }

  async function putSuppression(input: SuppressionInput, successMessage: string) {
    if (data.instanceId === null || !detail || savingSuppression) return;
    const instanceId = data.instanceId;
    const requestId = ++detailRequestId;
    savingSuppression = true;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}/suppression`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedSignature: detail.driftSignature, ...input }),
      });

      if (response.status === 409) {
        alertStore.add('warning', 'Drift changed since you reviewed it. Showing the latest drift — review and retry.');
        await loadDetail();
        return;
      }
      if (!response.ok) {
        alertStore.add('error', await readError(response, 'Failed to update drift suppression'));
        return;
      }

      const next = (await response.json()) as DriftDetailResponse;
      if (requestId === detailRequestId) setDetail(next);
      alertStore.add('success', successMessage);
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to update drift suppression');
    } finally {
      savingSuppression = false;
    }
  }

  function acknowledgeAll() {
    void putSuppression({ ...currentSuppression(), acknowledgeInstance: true }, 'Drift acknowledged.');
  }

  function snooze(days: number) {
    const snoozedUntil = new Date(Date.now() + days * DAY_MS).toISOString();
    void putSuppression(
      { ...currentSuppression(), snoozedUntil },
      `Drift alerts snoozed for ${days} day${days === 1 ? '' : 's'}.`
    );
  }

  function clearSuppression() {
    void putSuppression(
      { acknowledgeInstance: false, acknowledgedEntityKeys: [], snoozedUntil: null },
      'Acknowledgement and snooze cleared.'
    );
  }

  function toggleEntityAck(key: string) {
    const base = currentSuppression();
    const acked = base.acknowledgedEntityKeys.includes(key);
    const acknowledgedEntityKeys = acked
      ? base.acknowledgedEntityKeys.filter((existing) => existing !== key)
      : [...base.acknowledgedEntityKeys, key];
    void putSuppression(
      { ...base, acknowledgedEntityKeys },
      acked ? 'Change acknowledgement removed.' : 'Change acknowledged.'
    );
  }

  function setPolicyMode(event: CustomEvent<string>) {
    update('mode', event.detail as DriftRemediationMode);
  }

  function togglePolicySection(section: SyncPreviewSection, checked: boolean) {
    const selected = new Set(policySections);
    if (checked) selected.add(section);
    else selected.delete(section);
    // Keep canonical order so the dirty snapshot compare is order-stable.
    update(
      'allowedSections',
      POLICY_SECTIONS.map((entry) => entry.section).filter((value) => selected.has(value))
    );
  }

  function requestSavePolicy() {
    if (policyMode === 'auto' && serverPolicy?.mode !== 'auto') {
      showAutoConfirm = true;
      return;
    }
    void savePolicy();
  }

  async function savePolicy() {
    showAutoConfirm = false;
    if (data.instanceId === null || savingPolicy) return;
    const instanceId = data.instanceId;
    savingPolicy = true;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}/remediation-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: policyMode, allowedSections: policySections }),
      });

      if (!response.ok) {
        alertStore.add('error', await readError(response, 'Failed to save remediation policy'));
        return;
      }

      const policy = (await response.json()) as DriftRemediationPolicy;
      serverPolicy = policy;
      resetFromServer({ mode: policy.mode, allowedSections: [...policy.allowedSections] });
      if (detail) detail = { ...detail, remediationPolicy: policy };
      alertStore.add('success', `Remediation policy saved (${DRIFT_REMEDIATION_MODE_LABEL[policy.mode]}).`);
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to save remediation policy');
    } finally {
      savingPolicy = false;
    }
  }

  $: policyMode = ($current.mode ?? 'off') as DriftRemediationMode;
  $: policySections = ($current.allowedSections ?? []) as SyncPreviewSection[];
  $: policyArrType = detail?.arrType ?? null;
  $: availablePolicySections = policyArrType
    ? POLICY_SECTIONS.filter((entry) => policyArrType !== null && supportsFeature(policyArrType, entry.surface)).map(
        (entry) => entry.section
      )
    : [];
  $: policyInvalid = policyMode === 'auto' && policySections.length === 0;

  $: suppression = detail?.suppression ?? null;
  $: instanceAcked = !!suppression && suppression.acknowledgedSignature !== null;
  $: ackedKeys = new Set(suppression?.acknowledgedEntityKeys ?? []);
  $: showSuppressionBar = !!detail && (detail.status === 'drifted' || suppression?.state !== 'none');
  $: canAcknowledge = detail?.status === 'drifted' && detail.driftSignature !== null;
  $: canReconcile = detail?.status === 'drifted' && detail.reconcilableSections.length > 0;
  $: reconcileSections = detail?.reconcilableSections ?? [];
  $: reconcileIncludesAcked =
    instanceAcked ||
    [...(detail?.drift ?? []), ...(detail?.missing ?? [])].some(
      (change) => ackedKeys.has(change.key) && reconcileSections.includes(change.section)
    );
  $: lastRemediation = detail?.lastRemediation ?? null;

  // Drift data is client-fetched (no `depends()`), so live events re-run the guarded loader directly.
  const LIVE_RELOAD_DEBOUNCE_MS = 500;

  onMount(() => {
    void loadDetail();

    let timer: number | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        // A manual refresh or suppression save already returns fresh detail; skip so it is
        // not superseded.
        if (refreshing || savingSuppression) return;
        void loadDetail();
      }, LIVE_RELOAD_DEBOUNCE_MS);
    };
    const off = eventsStore.on('drift.updated', (e) => {
      if (e.instanceId === data.instanceId) schedule();
    });
    const offResync = eventsStore.onResync(schedule);

    return () => {
      off();
      offResync();
      clearTimeout(timer);
      clear();
    };
  });
</script>

<svelte:head>
  <title>{detail?.instanceName ?? `Instance ${data.instanceId}`} - Drift Detail - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/drift" class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline">← Back to drift</a
    >
  </div>

  {#if data.instanceId === null || data.error}
    <div
      class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      {data.error ?? 'Invalid instance ID'}
    </div>
  {:else}
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {detail?.instanceName ?? `Instance ${data.instanceId}`}
        </h1>
        {#if detail}
          <Badge variant={detail.arrType}>{detail.arrType}</Badge>
          <Badge variant={driftStatusVariant(detail.status)}>{DRIFT_STATUS_LABEL[detail.status]}</Badge>
          {#if detail.suppression.state !== 'none'}
            <Badge variant={driftSuppressionVariant(detail.suppression.state)}>
              {DRIFT_SUPPRESSION_LABEL[detail.suppression.state]}
            </Badge>
          {/if}
          {#if detail.remediationPolicy.mode === 'auto'}
            <Badge variant="accent">Auto</Badge>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if canReconcile}
          <button
            type="button"
            class="flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            disabled={reconciling || refreshing}
            on:click={reconcile}
          >
            {#if reconciling}
              <Loader2 size={14} class="animate-spin" />
            {:else}
              <Wrench size={14} />
            {/if}
            Reconcile
          </button>
        {/if}
        <button
          type="button"
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={refreshing || (loading && !detail)}
          on:click={() => refreshNow()}
        >
          <RefreshCw size={14} class={refreshing ? 'animate-spin' : ''} />
          Refresh now
        </button>
      </div>
    </div>

    {#if loadError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        <span>{loadError}</span>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          on:click={loadDetail}
        >
          Retry
        </button>
      </div>
    {:else if loading && !detail}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Loading drift detail…
      </div>
    {:else if detail}
      <div class="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>Drifted {detail.counts.drifted}</span>
        <span>Missing {detail.counts.missing}</span>
        <span>Unmanaged {detail.counts.unmanaged}</span>
        <span>Pending removal {detail.counts.prune}</span>
        {#if detail.suppression.state !== 'none'}
          <span>Alerting {detail.suppression.effectiveDrifted + detail.suppression.effectiveMissing}</span>
        {/if}
        <span>Checked {formatWhen(detail.checkedAt)}</span>
        {#if detail.driftDetectedAt}
          <span>Drift detected {formatWhen(detail.driftDetectedAt)}</span>
        {/if}
      </div>

      {#if lastRemediation && lastRemediation.status}
        <div class="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span class="font-medium text-neutral-700 dark:text-neutral-300">
            Last {lastRemediation.trigger ? DRIFT_REMEDIATION_TRIGGER_LABEL[lastRemediation.trigger] : 'remediation'}:
          </span>
          <Badge variant={driftRemediationStatusVariant(lastRemediation.status)}>
            {DRIFT_REMEDIATION_STATUS_LABEL[lastRemediation.status]}
          </Badge>
          <span>{formatWhen(lastRemediation.at)}</span>
          {#if lastRemediation.syncHistoryId !== null}
            <a
              href={`/sync-history/${lastRemediation.syncHistoryId}`}
              class="text-accent-600 dark:text-accent-500 font-medium hover:underline"
            >
              Sync history #{lastRemediation.syncHistoryId} →
            </a>
          {/if}
        </div>
      {/if}

      <div class="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div class="flex items-start justify-between gap-3">
          <NarrationBlock line={narrateDriftReason(detail.status, detail.reason, level)} {verbose} />
          <button
            type="button"
            class="text-accent-600 dark:text-accent-500 shrink-0 text-xs font-medium hover:underline"
            on:click={() => (verbose = !verbose)}
          >
            {verbose ? 'Hide details' : 'Show details'}
          </button>
        </div>
        {#if detail.counts.drifted > 0 || detail.counts.missing > 0 || detail.counts.unmanaged > 0 || detail.counts.prune > 0}
          <NarrationBlock line={narrateDriftCounts(detail.counts, detail.status, level)} {verbose} />
        {/if}
      </div>

      {#if showSuppressionBar && suppression}
        <section
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          aria-labelledby="drift-suppression-heading"
        >
          <div class="space-y-1">
            <h2 id="drift-suppression-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Alerts
            </h2>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {#if suppression.state === 'snoozed'}
                Snoozed until {formatWhen(suppression.snoozedUntil)} — no drift notifications or health penalty until then.
              {:else if suppression.state === 'acknowledged'}
                Acknowledged {formatWhen(suppression.acknowledgedAt)} — muted until this drift changes.
              {:else if suppression.state === 'partially_acknowledged'}
                {suppression.acknowledgedEntityKeys.length} acknowledged · {suppression.effectiveDrifted +
                  suppression.effectiveMissing} still alerting.
              {:else}
                Acknowledge intentional drift or snooze alerts. Nothing on the instance changes.
              {/if}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Drift alert suppression">
            <Button
              text="Acknowledge all"
              size="xs"
              icon={Check}
              disabled={savingSuppression || !canAcknowledge || instanceAcked}
              on:click={acknowledgeAll}
            />
            {#each SNOOZE_PRESETS as preset (preset.days)}
              <Button
                text={`Snooze ${preset.label}`}
                size="xs"
                icon={Clock}
                disabled={savingSuppression}
                on:click={() => snooze(preset.days)}
              />
            {/each}
            <Button
              text="Clear"
              size="xs"
              variant="ghost"
              icon={X}
              disabled={savingSuppression ||
                (!instanceAcked && suppression.acknowledgedEntityKeys.length === 0 && !suppression.snoozedUntil)}
              on:click={clearSuppression}
            />
          </div>
        </section>
      {/if}

      {#if canReconcile && previewState.status === 'idle'}
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          Reconcile builds a reviewed sync preview limited to the drifted sections:
          {detail.reconcilableSections.map(resolveSyncSectionLabel).join(', ')}. Nothing is written until you apply it.
          {#if reconcileIncludesAcked}
            Acknowledged changes in these sections are reverted too.
          {/if}
        </p>
      {/if}

      {#if previewState.status !== 'idle'}
        <section class="space-y-2" aria-label="Reconcile preview">
          <div class="flex justify-end">
            <Button
              text="Dismiss preview"
              size="xs"
              variant="ghost"
              icon={X}
              disabled={reconciling}
              on:click={dismissPreview}
            />
          </div>
          <SyncPreviewPanel
            {previewState}
            instanceName={detail.instanceName}
            regenerateEndpoint={`/api/v1/drift/${detail.instanceId}/reconcile`}
            on:applied={handleApplied}
          />
        </section>
      {/if}

      {#if detail.drift.length === 0 && detail.missing.length === 0 && detail.unmanaged.length === 0 && detail.prune.length === 0}
        <div
          class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
        >
          No drift detected — this instance matches the resolved PCD state.
        </div>
      {/if}

      {#if detail.drift.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Drifted <span class="text-neutral-500 dark:text-neutral-400">({detail.drift.length})</span>
          </h2>
          <div class="space-y-3">
            {#each detail.drift as change (changeId(change))}
              {@const acked = instanceAcked || ackedKeys.has(change.key)}
              <div class="space-y-2 {acked ? 'opacity-60' : ''}">
                <div class="flex items-start justify-between gap-3">
                  <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                  {#if canAcknowledge && isAcknowledgeable(change)}
                    <Button
                      text={ackedKeys.has(change.key) ? 'Acknowledged' : 'Acknowledge'}
                      size="xs"
                      variant="ghost"
                      icon={ackedKeys.has(change.key) ? Check : BellOff}
                      aria-pressed={ackedKeys.has(change.key)}
                      title={instanceAcked
                        ? 'The whole instance is acknowledged'
                        : ackedKeys.has(change.key)
                          ? `Stop acknowledging ${change.name}`
                          : `Acknowledge ${change.name}`}
                      disabled={savingSuppression || instanceAcked}
                      on:click={() => toggleEntityAck(change.key)}
                    />
                  {/if}
                </div>
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if detail.missing.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Missing <span class="text-neutral-500 dark:text-neutral-400">({detail.missing.length})</span>
          </h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Managed entities absent on this instance — a sync would create them.
          </p>
          <div class="space-y-2">
            {#each detail.missing as change (changeId(change))}
              {@const acked = instanceAcked || ackedKeys.has(change.key)}
              <div class="space-y-2 {acked ? 'opacity-60' : ''}">
                <div class="flex items-start justify-between gap-3">
                  <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                  {#if canAcknowledge && isAcknowledgeable(change)}
                    <Button
                      text={ackedKeys.has(change.key) ? 'Acknowledged' : 'Acknowledge'}
                      size="xs"
                      variant="ghost"
                      icon={ackedKeys.has(change.key) ? Check : BellOff}
                      aria-pressed={ackedKeys.has(change.key)}
                      title={instanceAcked
                        ? 'The whole instance is acknowledged'
                        : ackedKeys.has(change.key)
                          ? `Stop acknowledging ${change.name}`
                          : `Acknowledge ${change.name}`}
                      disabled={savingSuppression || instanceAcked}
                      on:click={() => toggleEntityAck(change.key)}
                    />
                  {/if}
                </div>
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if detail.unmanaged.length > 0}
        <details class="rounded-lg border border-neutral-200 dark:border-neutral-800">
          <summary class="cursor-pointer px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">
            Unmanaged on instance ({detail.unmanaged.length}) — info only, not alerting
          </summary>
          <div class="space-y-2 px-4 pt-1 pb-4 opacity-70">
            {#each detail.unmanaged as change (changeId(change))}
              <div class="space-y-2">
                <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </details>
      {/if}
      {#if detail.prune.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Pending removal <span class="text-neutral-500 dark:text-neutral-400">({detail.prune.length})</span>
          </h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Praxrr-managed entities that are no longer in your database. A reviewed sync deletes them when pruning is
            on.
          </p>
          <div class="space-y-2">
            {#each detail.prune as change (changeId(change))}
              <div class="space-y-2">
                <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section
        class="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        aria-labelledby="drift-policy-heading"
      >
        <div class="space-y-1">
          <h2 id="drift-policy-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Remediation policy
          </h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            How Praxrr responds when this instance drifts. {DRIFT_REMEDIATION_MODE_DESCRIPTION[policyMode]}
          </p>
        </div>

        <div class="flex flex-wrap items-start gap-6">
          <DropdownSelect
            label="Mode"
            value={policyMode}
            options={MODE_OPTIONS}
            disabled={savingPolicy}
            on:change={setPolicyMode}
          />

          <fieldset class="space-y-2" disabled={savingPolicy}>
            <legend class="text-sm text-neutral-500 dark:text-neutral-400">Allowed sections</legend>
            <div class="flex flex-wrap gap-4">
              {#each availablePolicySections as section (section)}
                <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
                    checked={policySections.includes(section)}
                    on:change={(event) => togglePolicySection(section, event.currentTarget.checked)}
                  />
                  {resolveSyncSectionLabel(section)}
                </label>
              {/each}
            </div>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {#if policyMode === 'notify'}
                Limits which sections a notification suggests reconciling. Leave empty to suggest all.
              {:else if policyMode === 'auto'}
                Only these sections are ever reconciled automatically.
              {:else}
                Used by Notify and Auto modes.
              {/if}
            </p>
          </fieldset>
        </div>

        {#if policyMode === 'auto'}
          <div
            class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
            role="note"
          >
            Auto mode writes to this {detail.arrType} instance without a human reviewing each change. Praxrr still creates
            and verifies a reviewed preview first, and it never deletes, skips acknowledged or snoozed drift, holds when Canary
            gating applies, and tries once per distinct drift.
          </div>
        {/if}
        {#if policyInvalid}
          <p class="text-xs text-red-700 dark:text-red-300">Select at least one section to enable auto mode.</p>
        {/if}

        <div class="flex items-center justify-end gap-3">
          {#if $isDirty}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">Unsaved changes</span>
          {/if}
          <Button
            text={savingPolicy ? 'Saving…' : 'Save policy'}
            variant="primary"
            icon={savingPolicy ? Loader2 : Save}
            iconColor={savingPolicy ? 'text-white animate-spin' : 'text-white'}
            disabled={savingPolicy || !$isDirty || policyInvalid}
            on:click={requestSavePolicy}
          />
        </div>
      </section>
    {/if}
  {/if}
</div>

<Modal
  open={showAutoConfirm}
  header="Enable auto-remediation?"
  confirmText="Enable auto mode"
  confirmDisabled={savingPolicy}
  loading={savingPolicy}
  on:confirm={savePolicy}
  on:cancel={() => (showAutoConfirm = false)}
>
  <div slot="body" class="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
    <p>
      Praxrr will automatically reconcile drift on <strong>{detail?.instanceName ?? 'this instance'}</strong> for:
      <strong>{policySections.map(resolveSyncSectionLabel).join(', ')}</strong>.
    </p>
    <p>
      Each run goes through a reviewed preview and is recorded in sync history. Auto mode never deletes, skips
      acknowledged or snoozed drift, and holds for a human when Canary gating applies.
    </p>
  </div>
</Modal>

<DirtyModal />
