import { json } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { toPluginErrorResponse } from '$server/plugins/index.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/** Log internal diagnostics server-side while returning only the portable redacted error. */
export async function pluginInternalError(operation: string, error: unknown): Promise<Response> {
  await logger.error('Plugin management request failed', {
    source: 'Plugins',
    meta: {
      operation,
      error: error instanceof Error ? error.message : String(error),
    },
  });

  return json(toPluginErrorResponse('internal_error'), {
    status: 500,
    headers: NO_STORE_HEADERS,
  });
}
