import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { isAIEnabled } from '$utils/ai/client.ts';

/**
 * GET /api/ai/status
 *
 * Return whether AI integrations are enabled in this deployment.
 */
export const GET: RequestHandler = async () => {
  return json({ enabled: isAIEnabled() });
};
