<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
  type ArrType = 'radarr' | 'sonarr';

  export let data: PageData;

  let presets: GoalPreset[] = [];
  let axes: GoalAxisMeta[] = [];
  let engineVersion = '';

  let arrType: ArrType = 'radarr';
  let profileName = data.qualityProfiles[0]?.name ?? '';
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
  let applying = false;
  let ready = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  $: databaseId = data.currentDatabase.id;
  $: changeCount = preview?.configDiff[0]?.changes.length ?? 0;
  $: bindingStale = binding !== null && binding.engineVersion !== engineVersion;

  function onDatabaseChange(event: Event): void {
    goto(`/goals/${(event.currentTarget as HTMLSelectElement).value}`);
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
    const response = await fetch('/api/v1/goals/presets');
    if (!response.ok) return;
    const body = (await response.json()) as components['schemas']['GoalPresetsResponse'];
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
    if (!profileName) {
      binding = null;
      return;
    }
    const params = new URLSearchParams({ databaseId: String(databaseId), profileName, arrType });
    const response = await fetch(`/api/v1/goals/binding?${params}`);
    if (!response.ok) {
      binding = null;
      return;
    }
    binding = ((await response.json()) as components['schemas']['GoalBindingResponse']).binding;
  }

  async function runPreview(): Promise<void> {
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
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        previewError = body?.message ?? body?.error ?? `Preview failed (HTTP ${response.status})`;
        preview = null;
        return;
      }
      preview = (await response.json()) as GoalPreviewResponse;
    } catch (err) {
      previewError = err instanceof Error ? err.message : 'Preview failed';
      preview = null;
    } finally {
      loadingPreview = false;
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
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        alertStore.add('error', body?.message ?? body?.error ?? `Apply failed (HTTP ${response.status})`);
        return;
      }
      alertStore.add('success', `Applied "${presetLabel(presetId)}" to ${profileName}.`);
      await loadBinding();
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Apply failed');
    } finally {
      applying = false;
    }
  }

  async function onProfileOrArr(): Promise<void> {
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
          >
            {#each data.qualityProfiles as profile (profile.id)}
              <option value={profile.name}>{profile.name}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          Arr app
          <select
            class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            bind:value={arrType}
            on:change={onProfileOrArr}
          >
            <option value="radarr">Radarr</option>
            <option value="sonarr">Sonarr</option>
          </select>
        </label>
        {#if binding}
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Currently governed by <span class="font-medium">{presetLabel(binding.presetId)}</span>
            {#if bindingStale}<span class="text-amber-600 dark:text-amber-400"> · engine updated, re-apply</span>{/if}
          </p>
        {/if}
      </div>
    </Card>

    <!-- Preset cards -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start from a goal</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each presets as preset (preset.id)}
          <Card
            hoverable
            onclick={() => selectPreset(preset)}
            className={presetId === preset.id ? 'ring-2 ring-accent-500' : ''}
          >
            <div class="flex items-center justify-between">
              <span class="font-semibold text-neutral-900 dark:text-neutral-100">{preset.label}</span>
              {#if presetId === preset.id}<Check size={16} class="text-accent-600 dark:text-accent-400" />{/if}
            </div>
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{preset.description}</p>
          </Card>
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
          disabled={applying || !preview || !!previewError}
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
