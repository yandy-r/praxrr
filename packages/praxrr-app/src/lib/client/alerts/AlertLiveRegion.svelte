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

  async function announce(alert: Alert) {
    const text = describe(alert);
    // Clear first, then set on the next tick so identical messages are re-announced.
    if (alert.type === 'error') {
      assertiveText = '';
      await tick();
      assertiveText = text;
    } else {
      politeText = '';
      await tick();
      politeText = text;
    }
  }

  const unsubscribe = alertStore.subscribe((alerts) => {
    const current = new Set<string>();
    for (const alert of alerts) {
      current.add(alert.id);
      if (!seen.has(alert.id)) {
        seen.add(alert.id);
        void announce(alert);
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
