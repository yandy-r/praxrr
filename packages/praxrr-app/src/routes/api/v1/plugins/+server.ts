import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { listPlugins, toPluginErrorResponse } from '$server/plugins/index.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** GET the feature-aware, redacted durable plugin registry. Authentication is enforced by the hook. */
export const GET: RequestHandler = () => {
  const outcome = listPlugins();
  if (outcome.kind === 'error') {
    return json(toPluginErrorResponse('internal_error'), { status: 500, headers: NO_STORE_HEADERS });
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
