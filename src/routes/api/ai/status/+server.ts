import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { isAIEnabled } from '$utils/ai/client.ts';

export const GET: RequestHandler = async () => {
  return json({ enabled: isAIEnabled() });
};
