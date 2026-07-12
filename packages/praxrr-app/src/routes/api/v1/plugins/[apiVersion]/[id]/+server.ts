import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getPlugin, toPluginErrorResponse } from '$server/plugins/index.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function isNonEmptyIdentity(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.trim().length > 0;
}

/** GET one exact API-version-qualified plugin. Authentication is enforced by the global hook. */
export const GET: RequestHandler = ({ params }) => {
  const { apiVersion, id } = params;
  if (!isNonEmptyIdentity(apiVersion) || !isNonEmptyIdentity(id)) {
    return json(toPluginErrorResponse('invalid_identity'), { status: 400, headers: NO_STORE_HEADERS });
  }

  const outcome = getPlugin(apiVersion, id);
  if (outcome.kind === 'disabled') {
    return json(toPluginErrorResponse('plugins_disabled'), { status: 409, headers: NO_STORE_HEADERS });
  }
  if (outcome.kind === 'not_found') {
    return json(toPluginErrorResponse('plugin_not_found'), { status: 404, headers: NO_STORE_HEADERS });
  }
  if (outcome.kind === 'error') {
    return json(toPluginErrorResponse('internal_error'), { status: 500, headers: NO_STORE_HEADERS });
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
