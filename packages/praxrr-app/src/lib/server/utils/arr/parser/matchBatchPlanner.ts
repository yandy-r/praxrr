/**
 * Splits a texts x patterns matching job into `/match/batch` requests that each
 * stay inside the parser's supported envelope (see `limits.ts`).
 */

import {
  PARSER_MAX_MATCH_WORK_PRODUCT,
  PARSER_MAX_PATTERN_CHARACTERS,
  PARSER_MAX_PATTERN_COUNT,
  PARSER_MAX_REQUEST_BODY_BYTES,
  PARSER_MAX_TEXT_CHARACTERS,
  PARSER_MAX_TEXT_COUNT,
  PARSER_MAX_UNIQUE_KEY_COUNT,
  runeLength,
} from './limits.ts';

export interface MatchBatchRequest {
  texts: string[];
  patterns: string[];
}

export interface MatchBatchPlan {
  /** Every accepted (text, pattern) pair appears in exactly one request. */
  requests: MatchBatchRequest[];
  /** Unique texts the parser would reject as oversized; they are never sent. */
  skippedTexts: string[];
  /** Unique patterns the parser would reject as oversized; they are never sent. */
  skippedPatterns: string[];
}

/** Bytes of `{"texts":[],"patterns":[]}` — the body without any elements. */
const EMPTY_BODY_BYTES = 26;

/**
 * Pattern chunks may use at most half of the element budget so the remaining
 * half always fits at least one maximum-size text (worst case ~6 KB once JSON
 * escapes are applied), whichever pattern chunk it is paired with.
 */
const PATTERN_CHUNK_BYTE_BUDGET = Math.floor((PARSER_MAX_REQUEST_BODY_BYTES - EMPTY_BODY_BYTES) / 2);

const encoder = new TextEncoder();

/** Serialized size of one JSON array element, exactly as `JSON.stringify` emits it. */
function jsonElementBytes(value: string): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Bytes an element adds to an array that already holds `count` elements (comma separator included). */
function appendedBytes(elementBytes: number, count: number): number {
  return count === 0 ? elementBytes : elementBytes + 1;
}

function partitionBySize(values: string[], maxCharacters: number): { accepted: string[]; skipped: string[] } {
  const accepted: string[] = [];
  const skipped: string[] = [];
  for (const value of new Set(values)) {
    (runeLength(value) > maxCharacters ? skipped : accepted).push(value);
  }
  return { accepted, skipped };
}

interface PatternChunk {
  patterns: string[];
  bytes: number;
}

function chunkPatterns(patterns: string[]): PatternChunk[] {
  const chunks: PatternChunk[] = [];
  let current: PatternChunk = { patterns: [], bytes: 0 };
  for (const pattern of patterns) {
    const elementBytes = jsonElementBytes(pattern);
    // PARSER_MAX_PATTERN_COUNT < PARSER_MAX_UNIQUE_KEY_COUNT, so a full chunk still leaves room for texts.
    const full =
      current.patterns.length >= PARSER_MAX_PATTERN_COUNT ||
      current.bytes + appendedBytes(elementBytes, current.patterns.length) > PATTERN_CHUNK_BYTE_BUDGET;
    if (full && current.patterns.length > 0) {
      chunks.push(current);
      current = { patterns: [], bytes: 0 };
    }
    current.bytes += appendedBytes(elementBytes, current.patterns.length);
    current.patterns.push(pattern);
  }
  if (current.patterns.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/** Maximum texts that may accompany `patternCount` unique patterns in one request. */
function maxTextsFor(patternCount: number): number {
  return Math.min(
    PARSER_MAX_TEXT_COUNT,
    PARSER_MAX_UNIQUE_KEY_COUNT - patternCount,
    Math.floor(PARSER_MAX_MATCH_WORK_PRODUCT / patternCount)
  );
}

/**
 * Plan `/match/batch` requests for `texts` x `patterns`.
 *
 * Inputs are de-duplicated. Texts and patterns over the parser's per-item
 * character limits are returned as skipped rather than sent (the parser would
 * reject the whole request with `413`). Accepted patterns are cut into chunks
 * bounded by count and half the body budget; for each chunk, texts are packed
 * greedily until the next one would break the text-count, unique-key,
 * work-product, or body-byte limit.
 */
export function planMatchBatches(texts: string[], patterns: string[]): MatchBatchPlan {
  const { accepted: acceptedTexts, skipped: skippedTexts } = partitionBySize(texts, PARSER_MAX_TEXT_CHARACTERS);
  const { accepted: acceptedPatterns, skipped: skippedPatterns } = partitionBySize(
    patterns,
    PARSER_MAX_PATTERN_CHARACTERS
  );
  const requests: MatchBatchRequest[] = [];
  if (acceptedTexts.length === 0 || acceptedPatterns.length === 0) {
    return { requests, skippedTexts, skippedPatterns };
  }

  const textBytes = acceptedTexts.map(jsonElementBytes);
  for (const chunk of chunkPatterns(acceptedPatterns)) {
    const textLimit = maxTextsFor(chunk.patterns.length);
    const textByteBudget = PARSER_MAX_REQUEST_BODY_BYTES - EMPTY_BODY_BYTES - chunk.bytes;
    let batch: string[] = [];
    let batchBytes = 0;
    acceptedTexts.forEach((text, index) => {
      const added = appendedBytes(textBytes[index], batch.length);
      if (batch.length > 0 && (batch.length >= textLimit || batchBytes + added > textByteBudget)) {
        requests.push({ texts: batch, patterns: chunk.patterns });
        batch = [];
        batchBytes = 0;
      }
      batchBytes += appendedBytes(textBytes[index], batch.length);
      batch.push(text);
    });
    requests.push({ texts: batch, patterns: chunk.patterns });
  }
  return { requests, skippedTexts, skippedPatterns };
}
