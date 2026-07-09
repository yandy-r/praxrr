<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { FlaskConical, Play, Shield } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import Table from '$ui/table/Table.svelte';
  import Button from '$ui/button/Button.svelte';
  import Toggle from '$ui/toggle/Toggle.svelte';
  import NumberInput from '$ui/form/NumberInput.svelte';
  import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import { alertStore } from '$alerts/store';
  import type { Column } from '$ui/table/types';
  import type {
    CanaryArrType,
    CanaryOutcomeStatus,
    CanaryRolloutStatus,
    CanaryRolloutSummary,
    CanaryStartResult,
  } from '$sync/canary/types.ts';
  import {
    CANARY_OUTCOME_STATUS_LABEL,
    CANARY_ROLLOUT_STATUS_LABEL,
    canaryOutcomeStatusVariant,
    canaryRolloutStatusVariant,
    type CanaryBadgeVariant,
  } from '$ui/canary/canaryStatus.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  const ARR_TYPE_LABEL: Record<CanaryArrType, string> = {
    radarr: 'Radarr',
    sonarr: 'Sonarr',
    lidarr: 'Lidarr',
  };

  // --- Start-rollout form state -----------------------------------------------

  let selectedInstanceId = data.settings.defaultCanaryInstanceId ? String(data.settings.defaultCanaryInstanceId) : '';
  let maxBatchSize: number | undefined = data.settings.defaultMaxBatchSize;
  let abortOnPartial = data.settings.defaultPartialPolicy === 'abort';
  let starting = false;

  $: instanceOptions = [
    { value: '', label: 'Select an instance…' },
    ...data.instances.map((instance) => ({
      value: String(instance.id),
      label: `${instance.name} · ${ARR_TYPE_LABEL[instance.type]}`,
    })),
  ];

  async function startRollout() {
    const instance = data.instances.find((candidate) => String(candidate.id) === selectedInstanceId);
    if (!instance || starting) return;
    starting = true;
    try {
      const response = await fetch('/api/v1/canary/rollouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrType: instance.type,
          canaryInstanceId: instance.id,
          maxBatchSize,
          partialPolicy: abortOnPartial ? 'abort' : 'gate',
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        alertStore.add('error', body?.message ?? body?.error ?? `Start failed (HTTP ${response.status})`);
        return;
      }
      const result = (await response.json()) as CanaryStartResult;
      if (result.skipped) {
        alertStore.add(
          'success',
          `Only one eligible ${ARR_TYPE_LABEL[instance.type]} instance — synced ${instance.name} directly (${result.result.status}).`
        );
        await invalidateAll();
        return;
      }
      alertStore.add('info', `Canary synced ${instance.name}. Review the gate before rolling out.`);
      await goto(`/canary/${result.rollout.id}`);
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Start failed');
    } finally {
      starting = false;
    }
  }

  // --- Badge rendering (Table cells accept html strings only) -----------------

  const BADGE_BASE = 'inline-flex items-center gap-1 rounded font-medium px-1.5 py-0.5 text-[10px]';

  const STATUS_BADGE_CLASS: Record<CanaryBadgeVariant, string> = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  };

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function rolloutStatusBadgeHtml(status: CanaryRolloutStatus): string {
    const variant = canaryRolloutStatusVariant(status);
    return `<span class="${BADGE_BASE} ${STATUS_BADGE_CLASS[variant]}">${CANARY_ROLLOUT_STATUS_LABEL[status]}</span>`;
  }

  function outcomeBadgeHtml(status: CanaryOutcomeStatus | null): string {
    if (!status) return '<span class="text-neutral-400 dark:text-neutral-500">—</span>';
    const variant = canaryOutcomeStatusVariant(status);
    return `<span class="${BADGE_BASE} ${STATUS_BADGE_CLASS[variant]}">${CANARY_OUTCOME_STATUS_LABEL[status]}</span>`;
  }

  function arrTypeBadgeHtml(arrType: CanaryArrType): string {
    return `<span style="background-color: var(--arr-${arrType}-color); color: #111827;" class="${BADGE_BASE}">${escapeHtml(arrType)}</span>`;
  }

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  }

  const columns: Column<CanaryRolloutSummary>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      width: '180px',
      cell: (row) => ({
        html: `<span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">${escapeHtml(formatWhen(row.startedAt))}</span>`,
      }),
    },
    {
      key: 'canaryInstanceName',
      header: 'Canary',
      cell: (row) => ({
        html: `<div class="flex items-center gap-2"><span class="font-medium text-neutral-900 dark:text-neutral-100">${escapeHtml(row.canaryInstanceName)}</span>${arrTypeBadgeHtml(row.arrType)}</div>`,
      }),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => ({ html: rolloutStatusBadgeHtml(row.status) }),
    },
    {
      key: 'canaryStatus',
      header: 'Canary Outcome',
      cell: (row) => ({ html: outcomeBadgeHtml(row.canaryStatus) }),
    },
    {
      key: 'maxBatchSize',
      header: 'Batch',
      align: 'right',
      cell: (row) => String(row.maxBatchSize),
    },
    {
      key: 'progress',
      header: 'Rolled Out',
      align: 'right',
      cell: (row) => `${row.completedCount} / ${row.completedCount + row.remainingCount}`,
    },
  ];
</script>

<svelte:head>
  <title>Canary Sync - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Canary Sync</h1>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Sync one canary instance first, verify the outcome, then roll out to the remaining instances of the same app in
      controlled batches — no sibling app is ever swept in.
    </p>
  </div>

  {#if !data.settings.enabled}
    <EmptyState
      icon={Shield}
      title="Canary sync is off"
      description="Enable canary sync in settings to gate a full rollout behind a single verified instance."
      buttonText="Open settings"
      buttonHref="/settings"
    />
  {:else}
    <!-- Start a rollout -->
    <Card>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-neutral-500 dark:text-neutral-400">Canary instance</span>
          <DropdownSelect
            value={selectedInstanceId}
            options={instanceOptions}
            placeholder="Select an instance…"
            on:change={(event) => (selectedInstanceId = event.detail)}
          />
        </div>

        <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          Max batch size
          <NumberInput name="maxBatchSize" bind:value={maxBatchSize} min={1} step={1} />
        </label>

        <Toggle bind:checked={abortOnPartial} label="Abort on partial canary" color="amber" />

        <Button
          text="Start rollout"
          icon={Play}
          variant="primary"
          disabled={!selectedInstanceId || starting}
          on:click={startRollout}
        />
      </div>
    </Card>

    {#if data.rollouts.length === 0}
      <EmptyState
        icon={FlaskConical}
        title="No rollouts yet"
        description="Pick a canary instance above and start a rollout — each run is recorded here with its gate decision."
        buttonText="View Arr instances"
        buttonHref="/arr"
      />
    {:else}
      <Table
        {columns}
        data={data.rollouts}
        rowHref={(row) => `/canary/${row.id}`}
        emptyMessage="No canary rollouts recorded yet."
        hoverable
        compact
        responsive
      />
    {/if}
  {/if}
</div>
