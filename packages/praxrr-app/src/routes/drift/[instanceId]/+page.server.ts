import type { ServerLoad } from '@sveltejs/kit';

/**
 * Drift detail load.
 *
 * Validates the `[instanceId]` path param and never throws a SvelteKit error page — an
 * invalid id resolves to an inline `{ error }` (mirrors the resolved-config load). The
 * drift detail itself is fetched client-side from `/api/v1/drift/{instanceId}`, which is
 * the authoritative source for existence (404), degraded status, and grouped changes.
 */
export const load: ServerLoad = ({ params }) => {
  const raw = params.instanceId;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!raw || !/^\d+$/.test(raw)) {
    return { instanceId: null, error: 'Invalid instance ID' };
  }

  return { instanceId: Number.parseInt(raw, 10), error: undefined };
};
