import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { isParserHealthy } from '$lib/server/utils/arr/parser/index.ts';

export const GET: RequestHandler = async () => {
  const parserAvailable = await isParserHealthy();
  return json({ parserAvailable });
};
