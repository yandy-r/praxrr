/**
 * Page-level live refresh: re-runs the `load()` functions that `depends()` on `key` when matching
 * live events (or a `resync`) arrive. Calls are trailing-debounced with a `maxWait` cap, deferred while
 * the tab is hidden, and tagged `x-praxrr-live: 1` so background refreshes do not extend the session.
 */
import { invalidate } from '$app/navigation';
import { DebounceScheduler } from '$lib/client/events/debounce.ts';
import { runLiveRefresh } from '$lib/client/events/liveFetch.ts';
import { eventsStore } from '$stores/events';
import type { LiveEvent, LiveEventType } from '$shared/events/types.ts';

export interface LiveSubscriptionSpec {
  /** Dependency key passed to `depends()` in the page load, e.g. `LIVE_DEPENDENCY_KEYS.jobs`. */
  key: string;
  types: LiveEventType[];
  filter?: (e: LiveEvent) => boolean;
  debounceMs?: number;
  /** Upper bound on how long a continuous event stream can postpone the refresh. */
  maxWaitMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 2_000;

export function subscribeLive(spec: LiveSubscriptionSpec): () => void {
  let pending = false;
  let active = true;

  const fire = () => {
    if (!active) return;
    if (document.hidden) {
      pending = true;
      return;
    }
    pending = false;
    void runLiveRefresh(() => invalidate(spec.key));
  };

  const scheduler = new DebounceScheduler(
    fire,
    spec.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    spec.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  );
  const schedule = () => {
    if (active) scheduler.schedule();
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
    scheduler.cancel();
    pending = false;
  };
}
