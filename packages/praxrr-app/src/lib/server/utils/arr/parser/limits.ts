/**
 * Parser request envelope.
 *
 * These values mirror the measured supported envelope in
 * `packages/praxrr-parser/internal/parser/limits.go` and the admission limit in
 * `packages/praxrr-parser/internal/httpserver/server.go`. The parser rejects
 * anything outside the envelope with `413` and saturated admission with `503`
 * + `Retry-After`, so the client must shape its requests to stay inside them.
 * `parserRequestLimits.test.ts` fails if these drift from the Go constants.
 */

/** Maximum raw request body size accepted by every parser route, in bytes. */
export const PARSER_MAX_REQUEST_BODY_BYTES = 105999;
/** Maximum characters (Unicode code points) per title/text. */
export const PARSER_MAX_TEXT_CHARACTERS = 1000;
/** Maximum characters (Unicode code points) per regex pattern. */
export const PARSER_MAX_PATTERN_CHARACTERS = 1636;
/** Maximum texts per `/match/batch` request. */
export const PARSER_MAX_TEXT_COUNT = 100;
/** Maximum patterns per `/match` or `/match/batch` request. */
export const PARSER_MAX_PATTERN_COUNT = 910;
/** Maximum unique texts + unique patterns per request. */
export const PARSER_MAX_UNIQUE_KEY_COUNT = 1010;
/** Maximum unique texts * unique patterns per request. */
export const PARSER_MAX_MATCH_WORK_PRODUCT = 45500;
/** Non-health requests the parser admits concurrently before answering `503`. */
export const PARSER_ADMISSION_LIMIT = 8;

/**
 * Concurrent non-health requests this app sends to the parser. Half of the
 * parser's admission slots, leaving headroom for retries and other callers.
 */
export const PARSER_MAX_CONCURRENT_REQUESTS = 4;
/**
 * Concurrent regex (`/match`, `/match/batch`) requests this app sends. The parser's
 * matcher admits only `min(GOMAXPROCS, 8)` regex requests and answers `503` beyond
 * that; the app cannot see the parser host's CPU count, so it assumes the
 * single-CPU worst case.
 */
export const PARSER_MAX_CONCURRENT_MATCH_REQUESTS = 1;
/** Upper bound on an honored `Retry-After` delay so a hostile/buggy value cannot stall callers. */
export const PARSER_MAX_RETRY_AFTER_MS = 5000;

/** Character count as the parser measures it (`utf8.RuneCountInString`). */
export function runeLength(value: string): number {
  return [...value].length;
}

/**
 * Parser retry delay: the larger of the base exponential backoff and the
 * server-requested `Retry-After`, the latter capped at `PARSER_MAX_RETRY_AFTER_MS`.
 */
export function parserRetryDelayMs(baseDelayMs: number, retryAfterMs: number | undefined): number {
  return Math.max(baseDelayMs, Math.min(retryAfterMs ?? 0, PARSER_MAX_RETRY_AFTER_MS));
}
