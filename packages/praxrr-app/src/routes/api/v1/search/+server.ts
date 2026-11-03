import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { parseSearchParams, SearchHttpError } from '$lib/server/search/params.ts';
import { search } from '$lib/server/search/service.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type SearchResponse = components['schemas']['SearchResponse'];

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/v1/search
 *
 * Cross-entity quick search for the command palette: PCD entities across every linked database,
 * cached TRaSH custom formats and quality profiles, Arr instances (id/name/type only) and linked
 * databases. Ranked exact > prefix > word-prefix > substring, then name; capped at `limit`.
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const params = parseSearchParams(url);
    const response = (await search(params)) satisfies SearchResponse;
    return json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof SearchHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, {
        status: error.status,
        headers: NO_STORE_HEADERS,
      });
    }
    await logger.error('Failed to search', {
      source: 'SearchRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to search' } satisfies ErrorResponse, { status: 500, headers: NO_STORE_HEADERS });
  }
};
