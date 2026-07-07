/**
 * Resolved Config Viewer -- shared client/server constants.
 *
 * Values here must be safe to import from client-side (Svelte) code: no server-only
 * imports (DB, fs, Node/Deno APIs), no secrets. Kept separate from
 * `$pcd/resolved/limits.ts` (server-only: rate limiting, DB-backed helpers) so the
 * viewer page can import the fan-out cap without pulling in server-only modules.
 */

/**
 * Maximum number of Arr instances a single cross-instance comparison request
 * (`/api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/compare`) may target. Mirrored
 * server-side by `$pcd/resolved/limits.ts::COMPARE_MAX_INSTANCES`, which re-exports this
 * value rather than redeclaring it, so server and client always agree on the cap.
 */
export const COMPARE_MAX_INSTANCES = 8;
