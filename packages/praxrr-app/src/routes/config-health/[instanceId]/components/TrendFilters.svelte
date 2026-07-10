<script context="module" lang="ts">
  export type TrendRange = '7' | '30' | '90' | 'all' | 'custom';

  export interface TrendInstanceOption {
    readonly id: number;
    readonly name: string;
    readonly type: 'radarr' | 'sonarr' | 'lidarr';
  }

  export interface TrendFilterSelection {
    readonly range: TrendRange;
    readonly days: 7 | 30 | 90 | null;
    readonly from: string | null;
    readonly to: string | null;
    readonly profile: string | null;
  }
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { createEventDispatcher } from 'svelte';

  const DEFAULT_APPLIED_FILTER: TrendFilterSelection = {
    range: '30',
    days: 30,
    from: null,
    to: null,
    profile: null,
  };

  export let instances: readonly TrendInstanceOption[] = [];
  export let instanceId: number;
  export let availableProfiles: readonly string[] = [];
  export let appliedFilter: TrendFilterSelection = DEFAULT_APPLIED_FILTER;
  export let disabled = false;

  const dispatch = createEventDispatcher<{ apply: TrendFilterSelection }>();

  let syncedAppliedFilter = appliedFilter;
  let draftRange: TrendRange = appliedFilter.range;
  let draftProfile = appliedFilter.profile ?? '';
  let draftFrom = appliedFilter.from ?? '';
  let draftTo = appliedFilter.to ?? '';
  let validationError: string | null = null;

  function syncDraft(filter: TrendFilterSelection): void {
    draftRange = filter.range;
    draftProfile = filter.profile ?? '';
    draftFrom = filter.from ?? '';
    draftTo = filter.to ?? '';
    validationError = null;
  }

  function isValidDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validateCustomRange(): string | null {
    if (draftRange !== 'custom') return null;
    if (!draftFrom && !draftTo) return 'Enter a start date, an end date, or choose All retained.';
    if (draftFrom && !isValidDateOnly(draftFrom)) return 'Enter a valid start date.';
    if (draftTo && !isValidDateOnly(draftTo)) return 'Enter a valid end date.';
    if (draftFrom && draftTo && draftFrom > draftTo) return 'Start date must be on or before end date.';
    return null;
  }

  function selectionFromDraft(): TrendFilterSelection {
    const days = draftRange === '7' ? 7 : draftRange === '30' ? 30 : draftRange === '90' ? 90 : null;
    return {
      range: draftRange,
      days,
      from: draftRange === 'custom' && draftFrom ? draftFrom : null,
      to: draftRange === 'custom' && draftTo ? draftTo : null,
      profile: draftProfile === '' ? null : draftProfile,
    };
  }

  function applyDraft(): void {
    validationError = validateCustomRange();
    if (validationError) return;
    dispatch('apply', selectionFromDraft());
  }

  function submitForm(event: SubmitEvent): void {
    event.preventDefault();
    applyDraft();
  }

  function resetDraft(): void {
    syncDraft(appliedFilter);
  }

  function clearValidation(): void {
    validationError = null;
  }

  function changeInstance(event: Event): void {
    const targetId = Number.parseInt((event.currentTarget as HTMLSelectElement).value, 10);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === instanceId) return;

    // Profiles are exact persisted identifiers and cannot be assumed to exist on another instance.
    draftProfile = '';
    validationError = null;
    void goto(`/config-health/${targetId}`);
  }

  $: if (appliedFilter !== syncedAppliedFilter) {
    syncedAppliedFilter = appliedFilter;
    syncDraft(appliedFilter);
  }

  $: profileOptions =
    draftProfile && !availableProfiles.includes(draftProfile)
      ? [draftProfile, ...availableProfiles]
      : availableProfiles;
  $: appliedRangeLabel =
    appliedFilter.range === 'all'
      ? 'All retained history'
      : appliedFilter.range === 'custom'
        ? `${appliedFilter.from ?? 'Earliest'} through ${appliedFilter.to ?? 'latest'}`
        : `Last ${appliedFilter.days} days`;
  $: appliedProfileLabel = appliedFilter.profile === null ? 'Overall health' : `Profile: ${appliedFilter.profile}`;
</script>

<section
  class="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
  aria-labelledby="trend-filters-heading"
>
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div>
      <h2 id="trend-filters-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Trend filters
      </h2>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        Applied: {appliedRangeLabel} · {appliedProfileLabel}
      </p>
    </div>
  </div>

  <form onsubmit={submitForm} novalidate>
    <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="min-w-0 space-y-1">
        <label for="trend-instance" class="block text-sm text-neutral-600 dark:text-neutral-300">Instance</label>
        <select
          id="trend-instance"
          value={instanceId}
          {disabled}
          onchange={changeInstance}
          class="w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          {#each instances as instance (instance.id)}
            <option value={instance.id}>{instance.name} ({instance.type})</option>
          {/each}
        </select>
      </div>

      <div class="min-w-0 space-y-1">
        <label for="trend-profile" class="block text-sm text-neutral-600 dark:text-neutral-300">Profile scope</label>
        <select
          id="trend-profile"
          bind:value={draftProfile}
          {disabled}
          class="w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          <option value="">Overall health</option>
          {#each profileOptions as profile (profile)}
            <option value={profile}>{profile}</option>
          {/each}
        </select>
      </div>

      <div class="min-w-0 space-y-1 sm:col-span-2 xl:col-span-1">
        <label for="trend-range" class="block text-sm text-neutral-600 dark:text-neutral-300">Time range</label>
        <select
          id="trend-range"
          bind:value={draftRange}
          {disabled}
          onchange={clearValidation}
          class="w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All retained</option>
          <option value="custom">Custom dates</option>
        </select>
      </div>

      {#if draftRange === 'custom'}
        <fieldset class="grid min-w-0 grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-1">
          <legend class="sr-only">Custom inclusive date range</legend>
          <div class="min-w-0 space-y-1">
            <label for="trend-from" class="block text-sm text-neutral-600 dark:text-neutral-300">From</label>
            <input
              id="trend-from"
              type="date"
              bind:value={draftFrom}
              {disabled}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? 'trend-filter-error' : undefined}
              oninput={clearValidation}
              class="w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>
          <div class="min-w-0 space-y-1">
            <label for="trend-to" class="block text-sm text-neutral-600 dark:text-neutral-300">To</label>
            <input
              id="trend-to"
              type="date"
              bind:value={draftTo}
              {disabled}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? 'trend-filter-error' : undefined}
              oninput={clearValidation}
              class="w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>
        </fieldset>
      {/if}
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div class="min-h-5">
        {#if validationError}
          <p id="trend-filter-error" class="text-sm text-red-600 dark:text-red-400" role="alert">
            {validationError}
          </p>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          {disabled}
          onclick={resetDraft}
          class="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Reset draft
        </button>
        <button
          type="submit"
          {disabled}
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply filters
        </button>
      </div>
    </div>
  </form>
</section>
