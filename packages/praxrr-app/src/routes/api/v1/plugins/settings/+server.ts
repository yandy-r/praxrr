import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getPluginSettings, setPluginSettings, toPluginErrorResponse } from '$server/plugins/index.ts';
import { pluginInternalError } from '../_errors.ts';
import { rejectCrossOriginPluginMutation } from '../_origin.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 4 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** GET the global plugin-ecosystem enablement flag. Authentication is enforced by the hook. */
export const GET: RequestHandler = async () => {
  const outcome = getPluginSettings();
  if (outcome.kind === 'error') {
    return await pluginInternalError('settings', outcome.error);
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};

/**
 * PATCH global enablement and hot-apply host initialize/reset.
 * Browser mutations must be same-origin; authentication remains middleware-owned.
 */
export const PATCH: RequestHandler = async ({ request, url }) => {
  const rejected = rejectCrossOriginPluginMutation(request, url);
  if (rejected) {
    return rejected;
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(toPluginErrorResponse('invalid_identity'), {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json(toPluginErrorResponse('invalid_identity'), {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json(
      { code: 'invalid_identity' as const, error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!isRecord(body) || typeof body.pluginsEnabled !== 'boolean') {
    return json(
      { code: 'invalid_identity' as const, error: 'pluginsEnabled must be a boolean' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const outcome = await setPluginSettings(body.pluginsEnabled);
  if (outcome.kind === 'error') {
    return await pluginInternalError('settings', outcome.error);
  }
  return json(outcome.response, { headers: NO_STORE_HEADERS });
};
