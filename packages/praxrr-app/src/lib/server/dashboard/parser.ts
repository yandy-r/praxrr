import { isParserHealthy } from '$lib/server/utils/arr/parser/index.ts';
import { createTtlCache } from './cache.ts';

/** Short cap so an unreachable parser never delays `/`. */
export const PARSER_PROBE_TIMEOUT_MS = 750;
export const PARSER_CACHE_TTL_MS = 15_000;

const parserCache = createTtlCache(PARSER_CACHE_TTL_MS, () => isParserHealthy(PARSER_PROBE_TIMEOUT_MS));

/** Parser availability, probed at most once per 15s (concurrent callers share one probe). */
export function getParserAvailable(): Promise<boolean> {
  return parserCache.get();
}

/** Test seam: drop the cached parser probe. */
export function resetParserCacheForTest(): void {
  parserCache.invalidate();
}
