import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setPluginEnabled, toPluginErrorResponse } from '$server/plugins/index.ts';
import { pluginInternalError } from '../../../_errors.ts';
import { rejectCrossOriginPluginMutation } from '../../../_origin.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function isNonEmptyIdentity(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.trim().length > 0;
}

/** POST disablement intent for one exact plugin identity. Authentication is enforced by the hook. */
export const POST: RequestHandler = async ({ params, request, url }) => {
  const originRejection = rejectCrossOriginPluginMutation(request, url);
  if (originRejection !== null) {
    return originRejection;
  }

  const { apiVersion, id } = params;
  if (!isNonEmptyIdentity(apiVersion) || !isNonEmptyIdentity(id)) {
    return json(toPluginErrorResponse('invalid_identity'), { status: 400, headers: NO_STORE_HEADERS });
  }

  const outcome = await setPluginEnabled(apiVersion, id, false);
  if (outcome.kind === 'disabled') {
    return json(toPluginErrorResponse('plugins_disabled'), { status: 409, headers: NO_STORE_HEADERS });
  }
  if (outcome.kind === 'not_found') {
    return json(toPluginErrorResponse('plugin_not_found'), { status: 404, headers: NO_STORE_HEADERS });
  }
  if (outcome.kind === 'error') {
    return await pluginInternalError('disable', outcome.error);
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
