/**
 * Executes a texts x patterns match job as envelope-sized `/match/batch`
 * requests (see `matchBatchPlanner.ts`) and merges the results per text.
 */

import { logger } from '$logger/logger.ts';
import { HttpError } from '../../http/types.ts';
import { planMatchBatches } from './matchBatchPlanner.ts';

export type MatchBatchRequester = (
  texts: string[],
  patterns: string[]
) => Promise<{ results: Record<string, Record<string, boolean>> }>;

/**
 * Fetch pattern matches without caching and return only complete texts, each
 * mapped to pattern -> matched for every accepted pattern. Oversized texts and
 * patterns are never sent: such texts are absent from the result, such patterns
 * absent from every text's map. A text is complete only when all requests
 * carrying it succeeded, so partial per-text results are never returned or
 * cached. Logs carry only counts and error classes, never titles or patterns.
 */
export async function fetchPatternMatchesChunked(
  texts: string[],
  patterns: string[],
  matchBatch: MatchBatchRequester
): Promise<Map<string, Map<string, boolean>>> {
  const plan = planMatchBatches(texts, patterns);
  if (plan.skippedTexts.length > 0 || plan.skippedPatterns.length > 0) {
    await logger.warn('Skipped texts or patterns exceeding parser size limits', {
      source: 'ParserClient',
      meta: {
        errorClass: 'ParserLimitExceeded',
        skippedTexts: plan.skippedTexts.length,
        skippedPatterns: plan.skippedPatterns.length,
      },
    });
  }

  const merged = new Map<string, Map<string, boolean>>();
  const failedTexts = new Set<string>();
  const failureCounts = { ParserLimitExceeded: 0, ParserRequestFailed: 0 };

  // Requests start together; the parser client's shared limiter gates how many are in flight.
  const settled = await Promise.allSettled(plan.requests.map((request) => matchBatch(request.texts, request.patterns)));
  settled.forEach((outcome, index) => {
    const request = plan.requests[index];
    if (outcome.status === 'rejected') {
      const limitExceeded = outcome.reason instanceof HttpError && outcome.reason.status === 413;
      failureCounts[limitExceeded ? 'ParserLimitExceeded' : 'ParserRequestFailed'] += 1;
      for (const text of request.texts) failedTexts.add(text);
      return;
    }
    for (const text of request.texts) {
      const patternResults = outcome.value.results[text];
      if (!patternResults) {
        failedTexts.add(text);
        continue;
      }
      const textMatches = merged.get(text) ?? new Map<string, boolean>();
      for (const pattern of request.patterns) {
        const matched = patternResults[pattern];
        if (typeof matched === 'boolean') textMatches.set(pattern, matched);
        else failedTexts.add(text);
      }
      merged.set(text, textMatches);
    }
  });

  for (const [errorClass, failed] of Object.entries(failureCounts)) {
    if (failed === 0) continue;
    await logger.warn('Failed parser batch pattern matching requests', {
      source: 'ParserClient',
      meta: { errorClass, failedRequests: failed, requests: plan.requests.length },
    });
  }

  for (const text of failedTexts) merged.delete(text);
  return merged;
}
