<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import { CheckCircle2, Circle, ListChecks, Play, X } from 'lucide-svelte';
  import type { SetupChecklist } from '$server/setup/progress.ts';

  export let checklist: SetupChecklist;

  let busy = false;

  $: rows = [
    {
      key: 'arr',
      label: 'Connect an Arr instance',
      done: checklist.progress.hasArrInstance,
      href: '/arr/new' as string | null,
      hint: '',
    },
    {
      key: 'database',
      label: 'Link a configuration database',
      done: checklist.progress.hasDatabase,
      href: '/databases/new' as string | null,
      hint: '',
    },
    {
      key: 'profiles',
      label: 'Select quality profiles to sync',
      done: checklist.progress.hasProfileSelections,
      href: checklist.primaryInstanceId === null ? null : `/arr/${checklist.primaryInstanceId}/sync`,
      hint: checklist.primaryInstanceId === null ? 'Connect an Arr instance first' : '',
    },
  ];

  async function handleResume() {
    busy = true;
    try {
      const res = await fetch('/api/v1/setup/resume', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to resume setup');
      await invalidateAll();
      await goto('/setup');
    } catch {
      alertStore.add('error', 'Could not resume setup — please try again.');
    } finally {
      busy = false;
    }
  }

  async function handleDismiss() {
    busy = true;
    try {
      const res = await fetch('/api/v1/setup/checklist/dismiss', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to dismiss checklist');
      await invalidateAll();
    } catch {
      alertStore.add('error', 'Could not dismiss the setup checklist — please try again.');
    } finally {
      busy = false;
    }
  }
</script>

<aside
  aria-labelledby="setup-checklist-heading"
  class="m-4 rounded-lg border border-neutral-200 bg-white md:mx-8 md:mt-8 dark:border-neutral-800 dark:bg-neutral-900"
>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800"
  >
    <div class="flex items-center gap-2">
      <ListChecks size={18} class="text-accent-600 dark:text-accent-500" aria-hidden="true" />
      <h2 id="setup-checklist-heading" class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
        Finish setup ({checklist.completedCount}/{checklist.total})
      </h2>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        icon={Play}
        text="Resume guided setup"
        disabled={busy}
        on:click={handleResume}
      />
      <Button variant="ghost" size="sm" icon={X} text="Dismiss" disabled={busy} on:click={handleDismiss} />
    </div>
  </div>

  <ul class="divide-y divide-neutral-200 dark:divide-neutral-800">
    {#each rows as row (row.key)}
      <li class="flex items-center justify-between gap-3 px-6 py-3">
        <div class="flex items-center gap-3">
          {#if row.done}
            <CheckCircle2 size={18} class="text-green-600 dark:text-green-500" aria-hidden="true" />
          {:else}
            <Circle size={18} class="text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
          {/if}
          <span
            class="text-sm {row.done
              ? 'text-neutral-500 line-through dark:text-neutral-400'
              : 'text-neutral-900 dark:text-neutral-50'}"
          >
            {row.label}
            <span class="sr-only">{row.done ? '(done)' : '(not done)'}</span>
          </span>
        </div>
        {#if !row.done}
          {#if row.href}
            <a
              href={row.href}
              aria-label="Open: {row.label}"
              class="text-accent-600 hover:text-accent-700 dark:text-accent-500 dark:hover:text-accent-400 text-sm font-medium"
            >
              Open
            </a>
          {:else}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{row.hint}</span>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</aside>
