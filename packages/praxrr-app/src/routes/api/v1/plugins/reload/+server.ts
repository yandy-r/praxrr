import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { reloadPlugins, toPluginErrorResponse } from '$server/plugins/index.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** POST a serialized plugin rescan/reconciliation. Authentication is enforced by the global hook. */
export const POST: RequestHandler = async () => {
  const outcome = await reloadPlugins();
  if (outcome.kind === 'error') {
    return json(toPluginErrorResponse('internal_error'), { status: 500, headers: NO_STORE_HEADERS });
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
