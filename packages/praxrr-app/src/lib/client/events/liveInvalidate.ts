/**
 * Page-level live refresh: re-runs the `load()` functions that `depends()` on `key` when matching
 * live events (or a `resync`) arrive. Calls are trailing-debounced and deferred while the tab is hidden.
 */
import { invalidate } from '$app/navigation';
import { eventsStore } from '$stores/events';
import type { LiveEvent, LiveEventType } from '$shared/events/types.ts';

export interface LiveSubscriptionSpec {
  /** Dependency key passed to `depends()` in the page load, e.g. `LIVE_DEPENDENCY_KEYS.jobs`. */
  key: string;
  types: LiveEventType[];
  filter?: (e: LiveEvent) => boolean;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function subscribeLive(spec: LiveSubscriptionSpec): () => void {
  const debounceMs = spec.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: number | undefined;
  let pending = false;
  let active = true;

  const fire = () => {
    timer = undefined;
    if (!active) return;
    if (document.hidden) {
      pending = true;
      return;
    }
    pending = false;
    void invalidate(spec.key);
  };

  const schedule = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = window.setTimeout(fire, debounceMs);
  };

  const onVisibilityChange = () => {
    if (pending && !document.hidden) schedule();
  };

  const unsubscribers = spec.types.map((type) =>
    eventsStore.on(type, (e: LiveEvent) => {
      if (spec.filter && !spec.filter(e)) return;
      schedule();
    })
  );
  unsubscribers.push(eventsStore.onResync(schedule));
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (!active) return;
    active = false;
    for (const unsubscribe of unsubscribers) unsubscribe();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearTimeout(timer);
    timer = undefined;
    pending = false;
  };
}
