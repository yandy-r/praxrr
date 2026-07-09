<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$ui/card/Card.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import type {
    TimelineAnnotation,
    TimelineEvent,
    TimelineListResponse,
    TimelineSource,
  } from '$server/timeline/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  const SOURCE_KEYS: TimelineSource[] = ['sync', 'canary', 'snapshot', 'rollback'];
  const SOURCE_LABEL: Record<TimelineSource, string> = {
    sync: 'Sync',
    canary: 'Canary',
    snapshot: 'Snapshot',
    rollback: 'Rollback',
  };
  const STATUS_OPTIONS = ['success', 'partial', 'failed', 'skipped', 'pending', 'info'];
  const PAGE_SIZE = 50;

  // Scope is a single control so the two mutually-exclusive axes can never contradict.
  let scope = 'all';
  let sourceFilters: Record<TimelineSource, boolean> = {
    sync: true,
    canary: true,
    snapshot: true,
    rollback: true,
  };
  let status = '';
  let arrType = '';
  let from = '';
  let to = '';
  let q = '';
  let page = 1;

  let result: TimelineListResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let requestId = 0;

  let selected: TimelineEvent | null = null;
  let noteBody = '';
  let noteError: string | null = null;
  let savingNote = false;

  function buildQuery(includePaging: boolean): URLSearchParams {
    const params = new URLSearchParams();
    if (scope.startsWith('instance:')) params.set('instanceId', scope.slice('instance:'.length));
    else if (scope.startsWith('database:')) params.set('databaseId', scope.slice('database:'.length));

    const chosen = SOURCE_KEYS.filter((key) => sourceFilters[key]);
    if (chosen.length > 0 && chosen.length < SOURCE_KEYS.length) params.set('source', chosen.join(','));

    if (status) params.set('status', status);
    if (arrType) params.set('arrType', arrType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q.trim()) params.set('q', q.trim());
    if (includePaging) {
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
    }
    return params;
  }

  async function load() {
    const rid = ++requestId;
    loading = true;
    loadError = null;
    try {
      const response = await fetch(`/api/v1/timeline?${buildQuery(true).toString()}`);
      if (rid !== requestId) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (rid !== requestId) return;
        loadError = body?.error ?? `Failed to load timeline (HTTP ${response.status})`;
        result = null;
        return;
      }
      const next = (await response.json()) as TimelineListResponse;
      if (rid !== requestId) return;
      result = next;
      if (selected) selected = next.items.find((item) => item.id === selected?.id) ?? null;
    } catch (err) {
      if (rid !== requestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load timeline';
    } finally {
      if (rid === requestId) loading = false;
    }
  }

  function applyFilters() {
    page = 1;
    load();
  }

  function resetFilters() {
    scope = 'all';
    sourceFilters = { sync: true, canary: true, snapshot: true, rollback: true };
    status = '';
    arrType = '';
    from = '';
    to = '';
    q = '';
    page = 1;
    load();
  }

  function goToPage(next: number) {
    page = next;
    load();
  }

  function openDrawer(event: TimelineEvent) {
    selected = event;
    noteBody = '';
    noteError = null;
  }

  function closeDrawer() {
    selected = null;
  }

  async function addNote() {
    if (!selected || !noteBody.trim()) return;
    savingNote = true;
    noteError = null;
    try {
      const response = await fetch('/api/v1/timeline/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: selected.source, eventId: selected.sourceId, body: noteBody }),
      });
      const body = (await response.json().catch(() => null)) as ErrorResponse | TimelineAnnotation | null;
      if (!response.ok) {
        noteError = (body as ErrorResponse)?.error ?? `Failed to add note (HTTP ${response.status})`;
        return;
      }
      noteBody = '';
      await load();
    } catch (err) {
      noteError = err instanceof Error ? err.message : 'Failed to add note';
    } finally {
      savingNote = false;
    }
  }

  async function deleteNote(id: number) {
    const response = await fetch(`/api/v1/timeline/annotations/${id}`, { method: 'DELETE' });
    if (response.ok) await load();
    else {
      const body = (await response.json().catch(() => null)) as ErrorResponse | null;
      noteError = body?.error ?? `Failed to delete note (HTTP ${response.status})`;
    }
  }

  function exportHref(format: 'json' | 'csv'): string {
    const params = buildQuery(false);
    params.set('format', format);
    return `/api/v1/timeline/export?${params.toString()}`;
  }

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  }

  onMount(load);

  $: totalPages = result?.totalPages ?? 0;
  $: sourceCounts = result?.sourceCounts ?? null;
</script>

<svelte:head><title>Timeline · Praxrr</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-4">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Sync Archaeology Timeline</h1>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        A chronological record of syncs, snapshots, rollbacks, and canary rollouts across your instances.
      </p>
    </div>
    <div class="flex gap-2">
      <Button text="Export JSON" variant="secondary" href={exportHref('json')} />
      <Button text="Export CSV" variant="secondary" href={exportHref('csv')} />
    </div>
  </header>

  <Card>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">Scope</span>
        <select bind:value={scope} class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700">
          <option value="all">All instances &amp; databases</option>
          {#if data.instances.length}
            <optgroup label="Arr instances">
              {#each data.instances as instance (instance.id)}
                <option value={`instance:${instance.id}`}>{instance.name} ({instance.type})</option>
              {/each}
            </optgroup>
          {/if}
          {#if data.databases.length}
            <optgroup label="PCD databases">
              {#each data.databases as database (database.id)}
                <option value={`database:${database.id}`}>{database.name}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">Status</span>
        <select
          bind:value={status}
          class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700"
        >
          <option value="">Any status</option>
          {#each STATUS_OPTIONS as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">Arr type</span>
        <select
          bind:value={arrType}
          class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700"
        >
          <option value="">Any app</option>
          <option value="radarr">Radarr</option>
          <option value="sonarr">Sonarr</option>
          <option value="lidarr">Lidarr</option>
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">From</span>
        <input
          type="date"
          bind:value={from}
          class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700"
        />
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">To</span>
        <input
          type="date"
          bind:value={to}
          class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700"
        />
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-neutral-500 dark:text-neutral-400">Search</span>
        <input
          type="text"
          bind:value={q}
          placeholder="Instance name or error"
          class="rounded border border-neutral-300 bg-transparent p-2 dark:border-neutral-700"
        />
      </label>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <span class="text-sm text-neutral-500 dark:text-neutral-400">Event types:</span>
      {#each SOURCE_KEYS as key (key)}
        <label class="flex items-center gap-1 text-sm">
          <input type="checkbox" bind:checked={sourceFilters[key]} />
          <span>{SOURCE_LABEL[key]}</span>
          {#if sourceCounts}<span class="text-neutral-400">({sourceCounts[key] ?? 0})</span>{/if}
        </label>
      {/each}
      <div class="ml-auto flex gap-2">
        <Button text="Apply" variant="primary" on:click={applyFilters} />
        <Button text="Reset" variant="ghost" on:click={resetFilters} />
      </div>
    </div>
  </Card>

  {#if loading && !result}
    <p class="text-sm text-neutral-500">Loading timeline…</p>
  {:else if loadError}
    <div class="rounded-lg border border-neutral-200 p-8 text-center dark:border-neutral-800">
      <h2 class="text-lg font-semibold">Could not load the timeline</h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{loadError}</p>
    </div>
  {:else if result && result.items.length === 0}
    <div class="rounded-lg border border-neutral-200 p-8 text-center dark:border-neutral-800">
      <h2 class="text-lg font-semibold">No events yet</h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Syncs, snapshots, rollbacks, and canary rollouts will appear here as they happen.
      </p>
    </div>
  {:else if result}
    <div class="space-y-2">
      {#each result.items as event (event.id)}
        <button
          type="button"
          class="hover:border-accent-400 flex w-full flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3 text-left transition dark:border-neutral-800"
          on:click={() => openDrawer(event)}
        >
          <Badge variant={event.badge}>{event.status}</Badge>
          <Badge variant="neutral">{SOURCE_LABEL[event.source]}</Badge>
          <span class="font-medium">{event.title}</span>
          {#if event.scope.arrType}<Badge variant={event.scope.arrType}>{event.scope.arrType}</Badge>{/if}
          {#if event.annotations.length}
            <span class="text-accent-600 dark:text-accent-400 text-xs">📝 {event.annotations.length}</span>
          {/if}
          <span class="ml-auto text-xs text-neutral-500 dark:text-neutral-400">{formatWhen(event.timestamp)}</span>
        </button>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="flex items-center justify-center gap-3">
        <Button text="Previous" variant="secondary" disabled={page <= 1} on:click={() => goToPage(page - 1)} />
        <span class="text-sm text-neutral-500">Page {result.page} of {totalPages} · {result.totalRecords} events</span>
        <Button text="Next" variant="secondary" disabled={!result.hasNext} on:click={() => goToPage(page + 1)} />
      </div>
    {/if}
  {/if}
</div>

{#if selected}
  <div class="fixed inset-0 z-40 flex justify-end">
    <button type="button" class="absolute inset-0 bg-black/30" aria-label="Close detail panel" on:click={closeDrawer}
    ></button>
    <div
      class="relative h-full w-full max-w-md overflow-y-auto border-l border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      role="dialog"
      aria-modal="true"
      aria-label="Timeline event detail"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="text-lg font-semibold">{selected.title}</h2>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">{formatWhen(selected.timestamp)}</p>
        </div>
        <Button text="Close" variant="ghost" on:click={closeDrawer} />
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <Badge variant={selected.badge}>{selected.status}</Badge>
        <Badge variant="neutral">{SOURCE_LABEL[selected.source]}</Badge>
        {#if selected.type}<Badge variant="neutral">{selected.type}</Badge>{/if}
        {#if selected.scope.arrType}<Badge variant={selected.scope.arrType}>{selected.scope.arrType}</Badge>{/if}
      </div>

      {#if Object.keys(selected.metrics).length}
        <dl class="mt-4 grid grid-cols-2 gap-2 text-sm">
          {#each Object.entries(selected.metrics) as [key, value] (key)}
            <div class="rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <dt class="text-xs text-neutral-500 dark:text-neutral-400">{key}</dt>
              <dd class="font-medium break-words">{value}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      <a
        href={selected.detailHref}
        class="text-accent-600 dark:text-accent-400 mt-4 inline-block text-sm hover:underline"
      >
        View full detail →
      </a>

      <section class="mt-6">
        <h3 class="text-sm font-semibold">Notes</h3>
        {#if selected.annotations.length === 0}
          <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">No notes yet.</p>
        {:else}
          <ul class="mt-2 space-y-2">
            {#each selected.annotations as note (note.id)}
              <li class="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <p class="break-words">{note.body}</p>
                <div class="mt-1 flex items-center justify-between text-xs text-neutral-400">
                  <span>{note.authorName ?? 'Unknown'} · {formatWhen(note.createdAt)}</span>
                  <button type="button" class="text-red-500 hover:underline" on:click={() => deleteNote(note.id)}
                    >Delete</button
                  >
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="mt-3 space-y-2">
          <textarea
            bind:value={noteBody}
            rows="3"
            maxlength="4000"
            placeholder="Add a note (e.g. rolled back because…)"
            class="w-full rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
          ></textarea>
          {#if noteError}<p class="text-xs text-red-500">{noteError}</p>{/if}
          <Button text="Add note" variant="primary" disabled={savingNote || !noteBody.trim()} on:click={addNote} />
        </div>
      </section>
    </div>
  </div>
{/if}
