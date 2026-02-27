import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { TMDBClient } from '$lib/server/utils/tmdb/client.ts';

/**
 * POST /api/tmdb/test
 *
 * Validate a TMDB API key by calling the provider test endpoint.
 *
 * Body:
 * - apiKey: TMDB API key to validate
 */
export const POST: RequestHandler = async ({ request }) => {
  const { apiKey } = await request.json();

  if (!apiKey) {
    return json({ success: false, error: 'API key is required' }, { status: 400 });
  }

  try {
    const client = new TMDBClient(apiKey);
    const result = await client.validateKey();

    if (result.success) {
      return json({ success: true });
    } else {
      return json({ success: false, error: result.status_message }, { status: 400 });
    }
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      },
      { status: 400 }
    );
  }
};
