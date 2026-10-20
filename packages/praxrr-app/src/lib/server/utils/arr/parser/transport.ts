/**
 * Parser service HTTP transport.
 *
 * Every non-health request runs under one module-level FIFO limiter capped at
 * `PARSER_MAX_CONCURRENT_REQUESTS`, below the parser's admission limit. Regex
 * requests (`/match`, `/match/batch`) additionally take a slot from a matcher
 * limiter sized for the parser's own matcher admission
 * (`min(GOMAXPROCS, 8)`, i.e. 1 on a single-CPU host). Busy `503` retries
 * honor `Retry-After`.
 */

import { config } from '$config';
import { BaseHttpClient } from '../../http/client.ts';
import type { HttpError } from '../../http/types.ts';
import { PARSER_MAX_CONCURRENT_MATCH_REQUESTS, PARSER_MAX_CONCURRENT_REQUESTS, parserRetryDelayMs } from './limits.ts';
import { RequestLimiter } from './requestLimiter.ts';
import type { MediaType } from './types.ts';

interface EpisodeResponse {
  seriesTitle: string | null;
  seasonNumber: number;
  episodeNumbers: number[];
  absoluteEpisodeNumbers: number[];
  airDate: string | null;
  fullSeason: boolean;
  isPartialSeason: boolean;
  isMultiSeason: boolean;
  isMiniSeries: boolean;
  special: boolean;
  releaseType: string;
}

export interface ParseResponse {
  title: string;
  type: MediaType;
  source: string;
  resolution: number;
  modifier: string;
  revision: {
    version: number;
    real: number;
    isRepack: boolean;
  };
  languages: string[];
  releaseGroup: string | null;
  movieTitles: string[];
  year: number;
  edition: string | null;
  imdbId: string | null;
  tmdbId: number;
  hardcodedSubs: string | null;
  releaseHash: string | null;
  episode: EpisodeResponse | null;
}

interface HealthResponse {
  status: string;
  version: string;
}

interface MatchResponse {
  results: Record<string, boolean>;
}

interface BatchMatchResponse {
  results: Record<string, Record<string, boolean>>;
}

/** Shared by every ParserClient non-health request so callers cannot overrun parser admission. */
const parserRequestLimiter = new RequestLimiter(PARSER_MAX_CONCURRENT_REQUESTS);
/** Shared by every regex request so callers cannot overrun the parser's matcher admission. */
const parserMatchLimiter = new RequestLimiter(PARSER_MAX_CONCURRENT_MATCH_REQUESTS);

/**
 * Run a regex request under both limiters. Lock order is always matcher slot
 * first, then global slot (parse requests only take the global slot), so no
 * cycle exists and queued match requests never hold global slots that parse
 * requests could use. Slots are held across the request's retries on purpose:
 * releasing between attempts would let queued work take the slot and turn
 * every retry into another over-admission.
 */
function runMatchRequest<T>(request: () => Promise<T>): Promise<T> {
  return parserMatchLimiter.run(() => parserRequestLimiter.run(request));
}

/**
 * Parser service HTTP client
 * Extends BaseHttpClient with parser-specific methods
 */
class ParserClient extends BaseHttpClient {
  constructor(baseUrl: string) {
    super(baseUrl, {
      timeout: 30000,
      retries: 2,
      retryDelay: 500,
    });
  }

  protected override getRetryDelayMs(attempt: number, error: HttpError): number {
    return parserRetryDelayMs(super.getRetryDelayMs(attempt, error), error.retryAfterMs);
  }

  /**
   * Parse a release title
   */
  async parse(title: string, type: MediaType): Promise<ParseResponse> {
    // The slot is held across retries on purpose (see runMatchRequest).
    return parserRequestLimiter.run(() => this.post<ParseResponse>('/parse', { title, type }));
  }

  /**
   * Check health and get version
   */
  async health(timeoutMs?: number): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health', timeoutMs === undefined ? undefined : { timeout: timeoutMs });
  }

  /**
   * Match patterns against text
   */
  async match(text: string, patterns: string[]): Promise<MatchResponse> {
    return runMatchRequest(() => this.post<MatchResponse>('/match', { text, patterns }));
  }

  /**
   * Match patterns against multiple texts (batch). Callers must keep the request inside the
   * parser envelope; `matchPatternsBatch` plans envelope-sized requests.
   */
  async matchBatch(texts: string[], patterns: string[]): Promise<BatchMatchResponse> {
    return runMatchRequest(() => this.post<BatchMatchResponse>('/match/batch', { texts, patterns }));
  }
}

// Singleton client instance - lazy initialized
let parserClient: ParserClient | null = null;

export function getClient(): ParserClient {
  if (!parserClient) {
    parserClient = new ParserClient(config.parserUrl);
  }
  return parserClient;
}
