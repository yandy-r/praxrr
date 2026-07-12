import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { reloadPlugins } from '$server/plugins/index.ts';
import { pluginInternalError } from '../_errors.ts';
import { rejectCrossOriginPluginMutation } from '../_origin.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** POST a serialized plugin rescan/reconciliation. Authentication is enforced by the global hook. */
export const POST: RequestHandler = async ({ request, url }) => {
  const originRejection = rejectCrossOriginPluginMutation(request, url);
  if (originRejection !== null) {
    return originRejection;
  }

  const outcome = await reloadPlugins();
  if (outcome.kind === 'error') {
    return await pluginInternalError('reload', outcome.error);
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
