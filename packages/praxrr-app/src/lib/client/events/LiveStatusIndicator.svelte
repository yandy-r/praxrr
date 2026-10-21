<script lang="ts">
  import { onDestroy } from 'svelte';
  import { eventsStore } from '$stores/events';

  const { status, downSince, stopReason } = eventsStore;

  const SHOW_AFTER_MS = 10_000;

  let now = Date.now();
  let ticker: number | undefined;

  // Tick only while the stream is down so a healthy connection costs nothing.
  $: if ($downSince !== null && ticker === undefined) {
    now = Date.now();
    ticker = window.setInterval(() => {
      now = Date.now();
    }, 1_000);
  } else if ($downSince === null && ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }

  $: stopped = $status === 'stopped';
  $: visible = stopped ? $stopReason !== null : $downSince !== null && now - $downSince > SHOW_AFTER_MS;

  function retry() {
    eventsStore.stop();
    eventsStore.start();
  }

  onDestroy(() => {
    clearInterval(ticker);
    ticker = undefined;
  });
</script>

{#if visible}
  <button
    type="button"
    onclick={retry}
    title="Live updates are temporarily unavailable; pages still work."
    class="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
  >
    <span class="h-2 w-2 shrink-0 rounded-full {stopped ? 'bg-neutral-400' : 'bg-amber-500'}" aria-hidden="true"></span>
    <span>{stopped ? 'Live updates paused' : 'Reconnecting…'}</span>
  </button>
{/if}
