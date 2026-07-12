import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { listPlugins } from '$server/plugins/index.ts';
import { pluginInternalError } from './_errors.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** GET the feature-aware, redacted durable plugin registry. Authentication is enforced by the hook. */
export const GET: RequestHandler = async () => {
  const outcome = listPlugins();
  if (outcome.kind === 'error') {
    return await pluginInternalError('list', outcome.error);
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
