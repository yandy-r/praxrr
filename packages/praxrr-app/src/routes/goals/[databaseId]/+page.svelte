<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { Sliders, Check } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import GeneratedConfig from '$ui/goals/GeneratedConfig.svelte';
  import { alertStore } from '$alerts/store';
  import type { components } from '$api/v1.d.ts';
  import type { PageData } from './$types';

  type GoalPreset = components['schemas']['GoalPreset'];
  type GoalAxisMeta = components['schemas']['GoalAxisMeta'];
  type GoalWeights = components['schemas']['GoalWeights'];
  type GoalPreviewResponse = components['schemas']['GoalPreviewResponse'];
  type GoalBinding = components['schemas']['GoalBinding'];
  type GoalApplyStatus = components['schemas']['GoalApplyStatus'];
  type ArrType = 'radarr' | 'sonarr' | 'lidarr';

  export let data: PageData;

  let presets: GoalPreset[] = [];
  let axes: GoalAxisMeta[] = [];
  let engineVersion = '';

  let arrType: ArrType = 'radarr';
  // Seed the target to a profile the initial Arr app (radarr) can apply to, so a Lidarr-only profile is
  // never the default target for a Radarr goal.
  let profileName = data.qualityProfiles.find((profile) => profile.compatibleArrTypes.includes('radarr'))?.name ?? '';
  let presetId = 'balanced';
  let weights: GoalWeights = {
    qualityVsSize: 50,
    compatibility: 55,
    hdrPreference: 50,
    unwantedStrictness: 80,
    resolutionCeiling: '1080p',
  };

  let preview: GoalPreviewResponse | null = null;
  let previewError: string | null = null;
  let loadingPreview = false;
  let binding: GoalBinding | null = null;
  // Latest apply-journal outcome for the target — surfaces a failed/pending apply (even one that never
  // wrote a binding) and drives the recovery affordance (#236).
  let applyStatus: GoalApplyStatus | null = null;
  let applying = false;
  let reconciling = false;
  let ready = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  // Sequence guards: only the latest in-flight request may write shared state (out-of-order responses).
  let previewRequestId = 0;
  let bindingRequestId = 0;
  let presetsRequestId = 0;

  $: databaseId = data.currentDatabase.id;
  $: changeCount = preview?.configDiff[0]?.changes.length ?? 0;
  $: bindingStale = binding !== null && binding.engineVersion !== engineVersion;
  // A failed/pending apply needs recovery — offer the deterministic reconcile action (#236).
  $: needsRecovery = applyStatus !== null && applyStatus.status !== 'succeeded';
  // Only profiles the selected Arr app can apply to (no sibling fallback) are offered as targets (#222).
  $: compatibleProfiles = data.qualityProfiles.filter((profile) => profile.compatibleArrTypes.includes(arrType));

  function onDatabaseChange(event: Event): void {
    const targetId = (event.currentTarget as HTMLSelectElement).value;
    if (browser) localStorage.setItem('qualityGoalsDatabase', targetId);
    goto(`/goals/${targetId}`);
  }

  function selectPreset(preset: GoalPreset): void {
    presetId = preset.id;
    weights = { ...preset.weights };
    void runPreview();
  }

  function setWeight(key: string, value: number): void {
    weights = { ...weights, [key]: value };
    schedulePreview();
  }

  function setCeiling(value: GoalWeights['resolutionCeiling']): void {
    weights = { ...weights, resolutionCeiling: value };
    void runPreview();
  }

  /** Read a weight axis value reactively (pass `weights` so Svelte tracks the dependency). */
  function axisValue(source: GoalWeights, key: string): number {
    return (source as unknown as Record<string, number>)[key] ?? 0;
  }

  function schedulePreview(): void {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void runPreview(), 250);
  }

  async function loadPresets(): Promise<void> {
    // Sequence guard: rapid Arr switching can race preset fetches — only the latest may write the catalog.
    const requestId = ++presetsRequestId;
    const response = await fetch(`/api/v1/goals/presets?arrType=${arrType}`);
    if (requestId !== presetsRequestId) return;
    if (!response.ok) return;
    const body = (await response.json()) as components['schemas']['GoalPresetsResponse'];
    if (requestId !== presetsRequestId) return;
    presets = body.presets;
    axes = body.axes;
    engineVersion = body.engineVersion;
    const preset = presets.find((candidate) => candidate.id === presetId) ?? presets[0];
    if (preset) {
      presetId = preset.id;
      weights = { ...preset.weights };
    }
  }

  async function loadBinding(): Promise<void> {
    const requestId = ++bindingRequestId;
    if (!profileName) {
      binding = null;
      applyStatus = null;
      return;
    }
    const params = new URLSearchParams({ databaseId: String(databaseId), profileName, arrType });
    const response = await fetch(`/api/v1/goals/binding?${params}`);
    if (requestId !== bindingRequestId) return;
    if (!response.ok) {
      binding = null;
      applyStatus = null;
      return;
    }
    const body = (await response.json()) as components['schemas']['GoalBindingResponse'];
    if (requestId !== bindingRequestId) return;
    binding = body.binding;
    // The binding response carries the latest apply outcome even when `binding` is null, so a failed
    // first apply with no binding row still surfaces its recovery badge (#236).
    applyStatus = body.applyStatus ?? null;
    // Restore the governed profile's goal so the sliders/preset reflect what's applied. Skip when the
    // binding was produced by a different engine version (weights may not map cleanly — prompt re-apply).
    if (binding && binding.engineVersion === engineVersion) {
      presetId = binding.presetId;
      weights = { ...binding.weights };
    }
  }

  async function runPreview(): Promise<void> {
    const requestId = ++previewRequestId;
    if (!profileName) {
      preview = null;
      return;
    }
    loadingPreview = true;
    previewError = null;
    try {
      const response = await fetch('/api/v1/goals/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, arrType, profileName, preset: presetId, weights }),
      });
      if (requestId !== previewRequestId) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        if (requestId !== previewRequestId) return;
        previewError = body?.message ?? body?.error ?? `Preview failed (HTTP ${response.status})`;
        preview = null;
        return;
      }
      const body = (await response.json()) as GoalPreviewResponse;
      if (requestId !== previewRequestId) return;
      preview = body;
    } catch (err) {
      if (requestId !== previewRequestId) return;
      previewError = err instanceof Error ? err.message : 'Preview failed';
      preview = null;
    } finally {
      if (requestId === previewRequestId) loadingPreview = false;
    }
  }

  async function applyGoal(): Promise<void> {
    if (!profileName || applying) return;
    applying = true;
    try {
      const response = await fetch('/api/v1/goals/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          arrType,
          profileName,
          preset: presetId,
          weights,
          expectedEngineVersion: engineVersion,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
          applyStatus?: GoalApplyStatus;
        } | null;
        // Surface the reported outcome (scoring changed?) + reconcile affordance for the partial write.
        if (body?.applyStatus) applyStatus = body.applyStatus;
        alertStore.add('error', body?.message ?? body?.error ?? `Apply failed (HTTP ${response.status})`);
        return;
      }
      alertStore.add('success', `Applied "${presetLabel(presetId)}" to ${profileName}.`);
      await loadBinding();
      // Re-preview so the diff / "Changes on apply" reflect the now-applied state (drops to 0).
      await runPreview();
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Apply failed');
    } finally {
      applying = false;
    }
  }

  /** Recover a failed or pending apply by re-driving the recorded intent idempotently (#236). */
  async function reconcile(): Promise<void> {
    if (!profileName || reconciling) return;
    reconciling = true;
    try {
      const response = await fetch('/api/v1/goals/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, arrType, profileName, expectedEngineVersion: engineVersion }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
          applyStatus?: GoalApplyStatus;
        } | null;
        if (body?.applyStatus) applyStatus = body.applyStatus;
        alertStore.add('error', body?.message ?? body?.error ?? `Reconcile failed (HTTP ${response.status})`);
        return;
      }
      alertStore.add('success', `Recovered the goal apply for ${profileName}.`);
      await loadBinding();
      await runPreview();
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      reconciling = false;
    }
  }

  async function onProfileOrArr(): Promise<void> {
    await loadBinding();
    await runPreview();
  }

  async function onArrChange(): Promise<void> {
    // Switching Arr app swaps the preset/axis catalog (audio vs video) and rescopes the profile list, so
    // reselect a compatible profile before reloading presets, the binding, and the preview.
    const compatible = data.qualityProfiles.filter((profile) => profile.compatibleArrTypes.includes(arrType));
    if (!compatible.some((profile) => profile.name === profileName)) {
      profileName = compatible[0]?.name ?? '';
    }
    await loadPresets();
    await loadBinding();
    await runPreview();
  }

  function presetLabel(id: string): string {
    return presets.find((preset) => preset.id === id)?.label ?? id;
  }

  onMount(async () => {
    await loadPresets();
    await loadBinding();
    await runPreview();
    ready = true;
  });
</script>

<svelte:head>
  <title>Quality Goals - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Quality Goals</h1>
      <p class="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
        Describe what you want in plain terms; Praxrr translates it into custom-format scores and quality-profile
        thresholds. The generated configuration is always shown before you apply, and applied scores stay fully
        editable.
      </p>
    </div>
    <select
      class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      aria-label="Database"
      value={String(databaseId)}
      on:change={onDatabaseChange}
    >
      {#each data.databases as database (database.id)}
        <option value={String(database.id)}>{database.name}</option>
      {/each}
    </select>
  </div>

  {#if data.qualityProfiles.length === 0}
    <EmptyState
      icon={Sliders}
      title="No quality profiles"
      description="This database has no PCD quality profiles yet. Create one to translate a goal into its scores."
      buttonText="Open profiles"
      buttonHref={`/quality-profiles/${databaseId}`}
    />
  {:else}
    <!-- Target selection -->
    <Card>
      <div class="flex flex-wrap items-end gap-4">
        <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          Quality profile
          <select
            class="min-w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            bind:value={profileName}
            on:change={onProfileOrArr}
            disabled={compatibleProfiles.length === 0}
          >
            {#each compatibleProfiles as profile (profile.id)}
              <option value={profile.name}>{profile.name}</option>
            {/each}
          </select>
          {#if compatibleProfiles.length === 0}
            <span class="text-xs text-amber-600 dark:text-amber-400">No profiles are compatible with this Arr app.</span
            >
          {/if}
        </label>
        <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          Arr app
          <select
            class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            bind:value={arrType}
            on:change={onArrChange}
          >
            <option value="radarr">Radarr</option>
            <option value="sonarr">Sonarr</option>
            <option value="lidarr">Lidarr</option>
          </select>
        </label>
        {#if binding}
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Currently governed by <span class="font-medium">{presetLabel(binding.presetId)}</span>
            {#if bindingStale}<span class="text-amber-600 dark:text-amber-400"> · engine updated, re-apply</span>{/if}
          </p>
        {/if}
        {#if needsRecovery && applyStatus}
          <div class="flex w-full items-center gap-2 text-xs">
            <span
              class="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            >
              {applyStatus.status === 'pending' ? 'Apply pending' : 'Apply failed'}{#if applyStatus.scoringChanged}
                · scores changed{/if}
            </span>
            <button
              type="button"
              class="rounded-lg border border-amber-400 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/30"
              disabled={reconciling}
              on:click={reconcile}
            >
              {reconciling ? 'Reconciling…' : 'Reconcile'}
            </button>
          </div>
        {/if}
      </div>
    </Card>

    <!-- Preset cards -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start from a goal</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each presets as preset (preset.id)}
          <button
            type="button"
            aria-pressed={presetId === preset.id}
            class="rounded-xl border bg-white p-4 text-left transition-colors dark:bg-neutral-900 {presetId ===
            preset.id
              ? 'border-accent-500 ring-accent-500 ring-2'
              : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50'}"
            on:click={() => selectPreset(preset)}
          >
            <div class="flex items-center justify-between">
              <span class="font-semibold text-neutral-900 dark:text-neutral-100">{preset.label}</span>
              {#if presetId === preset.id}<Check size={16} class="text-accent-600 dark:text-accent-400" />{/if}
            </div>
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{preset.description}</p>
          </button>
        {/each}
      </div>
    </div>

    <!-- Sliders -->
    <Card>
      <h2 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fine-tune</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        {#each axes as axis (axis.key)}
          <div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-neutral-700 dark:text-neutral-300">{axis.label}</span>
              {#if axis.kind !== 'ceiling'}
                <span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {axisValue(weights, axis.key)}
                </span>
              {/if}
            </div>
            {#if axis.kind === 'ceiling'}
              <div class="mt-1.5 flex gap-1.5">
                {#each axis.options ?? [] as option (option)}
                  <button
                    type="button"
                    aria-label={`${axis.label}: ${option}`}
                    aria-pressed={weights.resolutionCeiling === option}
                    class="flex-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors {weights.resolutionCeiling ===
                    option
                      ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'}"
                    on:click={() => setCeiling(option)}
                  >
                    {option}
                  </button>
                {/each}
              </div>
            {:else}
              <input
                type="range"
                aria-label={axis.label}
                min={axis.min ?? 0}
                max={axis.max ?? 100}
                step={axis.step ?? 1}
                value={axisValue(weights, axis.key)}
                on:input={(event) => setWeight(axis.key, Number(event.currentTarget.value))}
                class="accent-accent-600 mt-1.5 w-full"
              />
            {/if}
            <p class="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{axis.description}</p>
          </div>
        {/each}
      </div>
    </Card>

    <!-- Generated config (transparency) -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Generated configuration
          {#if loadingPreview}<span class="ml-2 text-xs font-normal text-neutral-400">updating…</span>{/if}
        </h2>
        <button
          type="button"
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={applying || loadingPreview || !preview || !!previewError}
          on:click={applyGoal}
        >
          <Check size={16} />
          {applying ? 'Applying…' : 'Apply goal'}
        </button>
      </div>

      {#if previewError}
        <div
          class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
        >
          {previewError}
        </div>
      {:else if preview}
        <GeneratedConfig plan={preview.plan} {changeCount} />
      {:else if ready}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          Select a profile to see the generated configuration.
        </p>
      {/if}
    </section>
  {/if}
</div>
