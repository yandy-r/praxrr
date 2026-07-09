<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw, ShieldCheck, ShieldAlert, CheckCircle2 } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import ShieldRecommendationBlock from '$ui/security/ShieldRecommendationBlock.svelte';
  import ShieldFixControl from '$ui/security/ShieldFixControl.svelte';
  import {
    SHIELD_BAND_LABEL,
    SHIELD_BAND_TEXT_CLASS,
    CHECK_STATUS_LABEL,
    TRANSPORT_TIER_LABEL,
    bandVariant,
    statusVariant,
    tierVariant,
  } from '$ui/security/shieldStatus.ts';
  import { CHECK_CATALOG } from '$shared/security/index.ts';
  import type { SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts';

  type ErrorResponse = { error: string };

  const DESCRIPTIONS = new Map(CHECK_CATALOG.map((meta) => [meta.id, meta.description]));

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }

  function formatScore(score: number | null): string {
    return score === null ? '—' : String(score);
  }

  let summary: SecurityPostureSummaryResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let requestId = 0;
  let verbose = false;

  async function loadSummary() {
    const id = ++requestId;
    loading = true;
    loadError = null;
    try {
      const response = await fetch('/api/v1/security-posture/summary');
      if (id !== requestId) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (id !== requestId) return;
        loadError = body?.error ?? `Failed to load security posture (HTTP ${response.status})`;
        return;
      }
      const next = (await response.json()) as SecurityPostureSummaryResponse;
      if (id !== requestId) return;
      summary = next;
    } catch (err) {
      if (id !== requestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load security posture';
    } finally {
      if (id === requestId) loading = false;
    }
  }

  // The log-redaction check is surfaced in the assurances strip / failure banner, not as a card.
  $: checkCards = summary?.checks.filter((check) => check.id !== 'log_redaction') ?? [];
  $: redactionFailed = summary?.assurances.some((a) => a.id === 'log_redaction' && !a.verified) ?? false;

  onMount(() => {
    void loadSummary();
  });
</script>

<svelte:head>
  <title>Security Posture - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex items-center gap-2">
        <ShieldCheck size={22} class="text-neutral-700 dark:text-neutral-200" />
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Security Posture</h1>
        <Badge variant="neutral">Non-blocking</Badge>
      </div>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        A read-only audit of the security settings Praxrr already knows — no scanning, no probing. It informs; it never
        blocks anything.
      </p>
    </div>
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      disabled={loading}
      on:click={loadSummary}
    >
      <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
      Refresh
    </button>
  </div>

  {#if loadError}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      <span>{loadError}</span>
      <button
        type="button"
        class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
        on:click={loadSummary}
      >
        Retry
      </button>
    </div>
  {:else if loading && !summary}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Loading security posture…
    </div>
  {:else if summary}
    {#if redactionFailed}
      <div
        class="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        <ShieldAlert size={20} class="mt-0.5 shrink-0" />
        <div>
          <p class="font-semibold">Log redaction is not working</p>
          <p class="mt-1">
            The runtime self-check found that a planted secret was not redacted from log metadata. Do not share logs
            until this is fixed — it is a logger regression.
          </p>
        </div>
      </div>
    {/if}

    <!-- Hero: shield score + band -->
    <Card>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div>
            <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Shield score
            </p>
            <p class="mt-1 text-4xl font-bold {SHIELD_BAND_TEXT_CLASS[summary.band]}">
              {summary.band === 'unknown' ? '—' : summary.score}
            </p>
          </div>
          <Badge variant={bandVariant(summary.band)}>{SHIELD_BAND_LABEL[summary.band]}</Badge>
        </div>
        <div class="text-right text-xs text-neutral-500 dark:text-neutral-400">
          <p>Engine v{summary.engineVersion}</p>
          <p>Checked {formatWhen(summary.generatedAt)}</p>
        </div>
      </div>
      {#if summary.bandCappedBy}
        <p class="mt-3 flex items-center gap-1.5 text-xs text-red-700 dark:text-red-300">
          <ShieldAlert size={14} />
          Band limited by a critical finding: {summary.bandCappedBy.label}
        </p>
      {/if}
    </Card>

    <!-- To reach Hardened -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">To reach Hardened</h2>
      {#if summary.topActions.length === 0}
        <Card>
          <div class="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={18} />
            Nothing to improve from what Praxrr can see — every evaluated check is passing.
          </div>
        </Card>
      {:else}
        <div class="space-y-2">
          {#each summary.topActions as action (action.checkId)}
            <Card>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-block h-2 w-2 shrink-0 rounded-full {action.tone === 'danger'
                      ? 'bg-red-500'
                      : action.tone === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-neutral-400'}"
                  ></span>
                  <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{action.headline}</span>
                </div>
                <div class="flex items-center gap-3">
                  <ShieldFixControl fix={action.fix} />
                  <span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400"
                    >+{action.recoverablePoints} pts</span
                  >
                </div>
              </div>
            </Card>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Per-check breakdown -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Checks</h2>
        <button
          type="button"
          class="text-accent-600 dark:text-accent-500 text-xs font-medium hover:underline"
          on:click={() => (verbose = !verbose)}
        >
          {verbose ? 'Hide details' : 'Show details'}
        </button>
      </div>
      <div class="space-y-3">
        {#each checkCards as check (check.id)}
          <Card>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-neutral-900 dark:text-neutral-100">{check.label}</span>
                  <Badge variant={statusVariant(check.status)}>{CHECK_STATUS_LABEL[check.status]}</Badge>
                </div>
                <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{DESCRIPTIONS.get(check.id) ?? ''}</p>
              </div>
              <div class="text-right">
                <p class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{formatScore(check.score)}</p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {check.score === null ? 'Not evaluated' : `weight ${check.weight} · +${check.contribution} pts`}
                </p>
              </div>
            </div>

            {#if check.detail.length > 0}
              <ul class="mt-3 list-disc space-y-0.5 pl-5 text-xs text-neutral-600 dark:text-neutral-400">
                {#each check.detail as detail}
                  <li>{detail}</li>
                {/each}
              </ul>
            {/if}

            {#if check.id === 'arr_transport' && summary.transport.length > 0}
              <div class="mt-3 overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="text-neutral-500 dark:text-neutral-400">
                    <tr>
                      <th class="py-1 pr-3 font-medium">Instance</th>
                      <th class="py-1 pr-3 font-medium">Scheme</th>
                      <th class="py-1 pr-3 font-medium">Host</th>
                      <th class="py-1 pr-3 font-medium">Exposure</th>
                      <th class="py-1 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each summary.transport as row (row.instanceId)}
                      <tr class="border-t border-neutral-100 dark:border-neutral-800">
                        <td class="py-1.5 pr-3">
                          <span class="font-medium text-neutral-800 dark:text-neutral-200">{row.instanceName}</span>
                          <Badge variant={row.arrType}>{row.arrType}</Badge>
                        </td>
                        <td class="py-1.5 pr-3">
                          <Badge variant={row.scheme === 'https' ? 'success' : 'danger'}>{row.scheme}</Badge>
                        </td>
                        <td class="py-1.5 pr-3 font-mono text-neutral-600 dark:text-neutral-400">{row.host}</td>
                        <td class="py-1.5 pr-3"
                          ><Badge variant={tierVariant(row.tier)}>{TRANSPORT_TIER_LABEL[row.tier]}</Badge></td
                        >
                        <td class="py-1.5"><ShieldFixControl fix={row.fix} /></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}

            {#if check.recommendations.length > 0}
              <div class="mt-3 space-y-2">
                {#each check.recommendations as recommendation (recommendation.headline)}
                  <ShieldRecommendationBlock {recommendation} {verbose} />
                {/each}
              </div>
            {/if}
          </Card>
        {/each}
      </div>
    </section>

    <!-- Assurances -->
    {#if summary.assurances.length > 0}
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Always-on protections</h2>
        <CardGrid columns={2}>
          {#each summary.assurances as assurance (assurance.id)}
            <Card>
              <div class="flex items-start gap-2">
                {#if assurance.verified}
                  <CheckCircle2 size={18} class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                {:else}
                  <ShieldAlert size={18} class="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                {/if}
                <div>
                  <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{assurance.label}</p>
                  <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{assurance.note}</p>
                </div>
              </div>
            </Card>
          {/each}
        </CardGrid>
      </section>
    {/if}

    <!-- Advisories -->
    {#if summary.advisories.length > 0}
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Advisories</h2>
        <div class="space-y-3">
          {#each summary.advisories as advisory (advisory.id)}
            <Card>
              <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{advisory.label}</p>
              <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-neutral-600 dark:text-neutral-400">
                {#each advisory.detail as detail}
                  <li>{detail}</li>
                {/each}
              </ul>
              {#if advisory.fix.kind !== 'none'}
                <div class="mt-2"><ShieldFixControl fix={advisory.fix} /></div>
              {/if}
            </Card>
          {/each}
        </div>
      </section>
    {/if}

    {#if summary.transport.length === 0}
      <EmptyState
        icon={ShieldCheck}
        title="No Arr instances to audit for transport"
        description="Connection transport is graded per enabled Radarr, Sonarr, or Lidarr instance. The control-plane checks above still apply."
        buttonText="Add Arr instance"
        buttonHref="/arr"
      />
    {/if}
  {/if}
</div>
