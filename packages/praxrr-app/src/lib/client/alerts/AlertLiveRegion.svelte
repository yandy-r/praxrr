<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { alertStore, type Alert } from './store';

  // Non-reactive: ids already announced, pruned to the ids still present in the store.
  const seen = new Set<string>();
  let politeText = '';
  let assertiveText = '';

  function describe(alert: Alert): string {
    return alert.action ? `${alert.message}. ${alert.action.label} available.` : alert.message;
  }

  // Alerts arriving in the same tick are batched and joined, so a second one never overwrites the first.
  let politeQueue: string[] = [];
  let assertiveQueue: string[] = [];
  let flushScheduled = false;
  // Per-region sequence: a newer flush supersedes only the region it rewrites.
  let politeSeq = 0;
  let assertiveSeq = 0;
  const RESTORE_DELAY_MS = 50;

  async function flush() {
    flushScheduled = false;
    const polite = politeQueue.join(' ');
    const assertive = assertiveQueue.join(' ');
    politeQueue = [];
    assertiveQueue = [];
    const pSeq = polite ? ++politeSeq : politeSeq;
    const aSeq = assertive ? ++assertiveSeq : assertiveSeq;
    // Clear first, then restore in a later task so identical messages are re-announced
    // (same-tick DOM mutations can be coalesced by assistive tech).
    if (polite) politeText = '';
    if (assertive) assertiveText = '';
    await tick();
    await new Promise<void>((resolve) => setTimeout(resolve, RESTORE_DELAY_MS));
    // Skip stale restores superseded by a newer flush of the same region.
    if (polite && pSeq === politeSeq) politeText = polite;
    if (assertive && aSeq === assertiveSeq) assertiveText = assertive;
  }

  function announce(alert: Alert) {
    (alert.type === 'error' ? assertiveQueue : politeQueue).push(describe(alert));
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => void flush());
  }

  const unsubscribe = alertStore.subscribe((alerts) => {
    const current = new Set<string>();
    for (const alert of alerts) {
      current.add(alert.id);
      if (!seen.has(alert.id)) {
        seen.add(alert.id);
        announce(alert);
      }
    }
    for (const id of seen) {
      if (!current.has(id)) seen.delete(id);
    }
  });

  onDestroy(unsubscribe);
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{politeText}</div>
<div class="sr-only" role="alert" aria-atomic="true">{assertiveText}</div>
