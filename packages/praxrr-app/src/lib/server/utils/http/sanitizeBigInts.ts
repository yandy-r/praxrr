/**
 * BigInt sanitization for JSON responses.
 *
 * PCD cache tables are opened with `int64: true` (see `PCDCache`), so some integer
 * columns can come back as `bigint`. SvelteKit's `json()` calls `JSON.stringify`
 * internally, which throws on `bigint` -- coerce any bigint (every PCD value is well
 * within the safe-integer range) to `number` before handing the payload off.
 *
 * Single source shared by every `/api/v1` route that returns cache-derived payloads
 * (resolved-config, dependency graph, ...); do not re-copy this into individual route
 * `shared.ts` helpers.
 */
export function sanitizeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))) as T;
}
