/**
 * Tiny in-process TTL cache with in-flight de-duplication, shared by the dashboard sources that
 * are cheap to share but costly to repeat (parser probe). Failures are never cached.
 */

export interface TtlCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

export function createTtlCache<T>(ttlMs: number, load: () => Promise<T>): TtlCache<T> {
  let entry: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;
  let generation = 0;

  return {
    get() {
      if (entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value);
      if (pending) return pending;
      const started = generation;
      const current = load()
        .then((value) => {
          // An invalidation during the load means the value may already be stale: serve it once
          // but do not store it.
          if (started === generation) entry = { value, at: Date.now() };
          return value;
        })
        .finally(() => {
          if (pending === current) pending = null;
        });
      pending = current;
      return current;
    },
    invalidate() {
      generation += 1;
      entry = null;
      pending = null;
    },
  };
}
