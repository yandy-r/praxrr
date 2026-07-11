/**
 * Release Title Parser
 * Client for the C# parser microservice with caching support
 */

export * from './types.ts';
export {
  parse,
  parseQuality,
  isParserHealthy,
  getParserVersion,
  refreshParserVersion,
  clearParserVersionCache,
  parseWithCache,
  parseWithCacheBatch,
  cleanupOldCacheEntries,
  matchPatterns,
  matchPatternsBatch,
} from './client.ts';
