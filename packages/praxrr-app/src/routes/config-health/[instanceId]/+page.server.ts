import type { ServerLoad } from '@sveltejs/kit';

/**
 * Config Health detail load.
 *
 * Validates the `[instanceId]` path param and never throws a SvelteKit error page — an
 * invalid id resolves to an inline `{ error }` (mirrors the drift detail load). The report
 * and trend series are fetched client-side from `/api/v1/config-health/{instanceId}` and
 * `/api/v1/config-health/{instanceId}/trends`, the authoritative sources for existence (404),
 * scoring, and history.
 */
export const load: ServerLoad = ({ params }) => {
  const raw = params.instanceId;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!raw || !/^\d+$/.test(raw)) {
    return { instanceId: null, error: 'Invalid instance ID' };
  }

  return { instanceId: Number.parseInt(raw, 10), error: undefined };
};
