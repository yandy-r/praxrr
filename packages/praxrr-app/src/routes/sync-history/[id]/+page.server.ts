import type { ServerLoad } from '@sveltejs/kit';

/**
 * Sync history detail load.
 *
 * Validates the `[id]` path param and never throws a SvelteKit error page — an invalid
 * id resolves to an inline `{ error }` (mirrors the drift detail load). The entry itself
 * is fetched client-side from `/api/v1/sync-history/{id}`, which is the authoritative
 * source for existence (404) and the decoded section results / entity changes.
 */
export const load: ServerLoad = ({ params }) => {
  const raw = params.id;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!raw || !/^\d+$/.test(raw)) {
    return { id: null, error: 'Invalid sync history id' };
  }

  return { id: Number(raw), error: null };
};
