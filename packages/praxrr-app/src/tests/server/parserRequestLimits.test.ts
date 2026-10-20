// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for server tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertFalse } from '@std/assert';
import * as limits from '$lib/server/utils/arr/parser/limits.ts';
import { planMatchBatches } from '$lib/server/utils/arr/parser/matchBatchPlanner.ts';

const PARSER_PORT = 57263;
const PARSER_VERSION = '2.0.0-go.limits';
const STUB_ADMISSION_LIMIT = 8;
/** Default matcher admission on a host with >= 8 CPUs; single-CPU steps lower it to 1. */
const STUB_MATCHER_LIMIT = 8;
const FAILING_MARKER = 'chunk-failure-marker';

Deno.env.set('PARSER_HOST', '127.0.0.1');
Deno.env.set('PARSER_PORT', String(PARSER_PORT));

// Dynamic imports: config resolves PARSER_HOST/PARSER_PORT at module load, so these
// must load after the env above is set (static imports would be hoisted before it).
const { logger } = await import('$logger/logger.ts');
const { parsedReleaseCacheQueries } = await import('$db/queries/parsedReleaseCache.ts');
const { patternMatchCacheQueries } = await import('$db/queries/patternMatchCache.ts');
const parserClient = await import('$lib/server/utils/arr/parser/client.ts');

const repoRoot = new URL('../../../../../', import.meta.url);

interface StubState {
  inFlight: number;
  maxInFlight: number;
  rejected503: number;
  rejected413: number;
  parseRequests: number;
  matchRequests: number;
  failFirstParseWithBusy: boolean;
  /** Matcher admission (`activeRegexRequestLimit()` = min(GOMAXPROCS, 8) in the Go parser). */
  matcherCap: number;
  matchInFlight: number;
  maxMatchInFlight: number;
}

/** Mirrors `validateRegexWork` + `validateRequestBodySize` in limits.go; returns the violated class or null. */
function envelopeViolation(bodyBytes: number, texts: string[], patterns: string[]): string | null {
  if (bodyBytes > limits.PARSER_MAX_REQUEST_BODY_BYTES) return 'request_body_bytes';
  if (texts.length > limits.PARSER_MAX_TEXT_COUNT) return 'text_count';
  if (patterns.length > limits.PARSER_MAX_PATTERN_COUNT) return 'pattern_count';
  if (texts.some((text) => [...text].length > limits.PARSER_MAX_TEXT_CHARACTERS)) return 'text_characters';
  if (patterns.some((pattern) => [...pattern].length > limits.PARSER_MAX_PATTERN_CHARACTERS)) {
    return 'pattern_characters';
  }
  const uniqueTexts = new Set(texts).size;
  const uniquePatterns = new Set(patterns).size;
  if (uniqueTexts + uniquePatterns > limits.PARSER_MAX_UNIQUE_KEY_COUNT) return 'unique_key_count';
  if (uniqueTexts * uniquePatterns > limits.PARSER_MAX_MATCH_WORK_PRODUCT) return 'text_pattern_work_product';
  return null;
}

/** Deterministic stand-in for regex matching: a pattern matches when it is a substring of the text. */
function expectedMatch(text: string, pattern: string): boolean {
  return text.includes(pattern);
}

function parseResponse(title: string) {
  return {
    title,
    type: 'movie',
    source: 'WEBDL',
    resolution: 1080,
    modifier: 'None',
    revision: { version: 1, real: 0, isRepack: false },
    languages: ['English'],
    releaseGroup: null,
    movieTitles: [],
    year: 0,
    edition: null,
    imdbId: null,
    tmdbId: 0,
    hardcodedSubs: null,
    releaseHash: null,
    episode: null,
  };
}

function startStub(state: StubState): Deno.HttpServer {
  const encoder = new TextEncoder();
  return Deno.serve({
    hostname: '127.0.0.1',
    port: PARSER_PORT,
    onListen() {},
    handler: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', version: PARSER_VERSION });
      }

      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        const raw = await request.text();
        if (state.inFlight > STUB_ADMISSION_LIMIT) {
          state.rejected503 += 1;
          return new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
        }

        if (url.pathname === '/parse') {
          state.parseRequests += 1;
          if (state.failFirstParseWithBusy) {
            state.failFirstParseWithBusy = false;
            state.rejected503 += 1;
            return new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
          }
          // Real hold time: the stub must observe genuinely overlapping requests to measure concurrency.
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 30);
          await promise;
          const { title } = JSON.parse(raw);
          return Response.json(parseResponse(String(title)));
        }

        if (url.pathname === '/match/batch') {
          state.matchRequests += 1;
          const payload: { texts: string[]; patterns: string[] } = JSON.parse(raw);
          const { texts, patterns } = payload;
          // Like the Go matcher, envelope validation precedes matcher admission.
          if (envelopeViolation(encoder.encode(raw).length, texts, patterns) !== null) {
            state.rejected413 += 1;
            return new Response(null, { status: 413 });
          }
          if (state.matchInFlight >= state.matcherCap) {
            state.rejected503 += 1;
            return new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
          }
          state.matchInFlight += 1;
          state.maxMatchInFlight = Math.max(state.maxMatchInFlight, state.matchInFlight);
          try {
            if (texts.includes(FAILING_MARKER)) {
              return new Response(null, { status: 500 });
            }
            // Real hold time so overlapping batch requests are observable by the in-flight counters.
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, 5);
            await promise;
            const results: Record<string, Record<string, boolean>> = {};
            for (const text of texts) {
              results[text] = Object.fromEntries(patterns.map((pattern) => [pattern, expectedMatch(text, pattern)]));
            }
            return Response.json({ results });
          } finally {
            state.matchInFlight -= 1;
          }
        }

        return Response.json({ error: 'not found' }, { status: 404 });
      } finally {
        state.inFlight -= 1;
      }
    },
  });
}

function installCacheFakes(): { patternCache: Map<string, string>; restore: () => void } {
  const patternCache = new Map<string, string>();
  const parsedCache = new Map<string, string>();
  const originals = {
    getBatch: patternMatchCacheQueries.getBatch,
    setBatch: patternMatchCacheQueries.setBatch,
    get: parsedReleaseCacheQueries.get,
    set: parsedReleaseCacheQueries.set,
  };

  patternMatchCacheQueries.getBatch = (titles, namespace) => {
    const results = new Map<string, string>();
    for (const title of titles) {
      const cached = patternCache.get(`${namespace}\0${title}`);
      if (cached !== undefined) results.set(title, cached);
    }
    return results;
  };
  patternMatchCacheQueries.setBatch = (entries, namespace) => {
    for (const entry of entries) patternCache.set(`${namespace}\0${entry.title}`, entry.matchResults);
  };
  parsedReleaseCacheQueries.get = (cacheKey, version) => {
    const parsedResult = parsedCache.get(`${version}\0${cacheKey}`);
    return parsedResult === undefined
      ? undefined
      : { cache_key: cacheKey, parser_version: version, parsed_result: parsedResult, created_at: '' };
  };
  parsedReleaseCacheQueries.set = (cacheKey, version, parsedResult) => {
    parsedCache.set(`${version}\0${cacheKey}`, parsedResult);
  };

  return {
    patternCache,
    restore: () => {
      patternMatchCacheQueries.getBatch = originals.getBatch;
      patternMatchCacheQueries.setBatch = originals.setBatch;
      parsedReleaseCacheQueries.get = originals.get;
      parsedReleaseCacheQueries.set = originals.set;
    },
  };
}

function cachedTitles(patternCache: Map<string, string>): Set<string> {
  return new Set([...patternCache.keys()].map((key) => key.slice(key.indexOf('\0') + 1)));
}

function makeTitles(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}.Release.${index}.tok${index % 37}.1080p.WEB-DL`);
}

function makePatterns(prefix: string, count: number): string[] {
  // Some patterns are substrings of the titles (tokN, 1080p) so both true and false results occur.
  return Array.from({ length: count }, (_, index) => (index < 37 ? `tok${index}.` : `${prefix}-pattern-${index}`));
}

function assertCompleteAndCorrect(
  result: Map<string, Map<string, boolean>> | null,
  texts: string[],
  patterns: string[]
): void {
  assert(result !== null, 'expected match results');
  for (const text of texts) {
    const matches = result.get(text);
    assert(matches, 'every text should have results');
    assertEquals(matches.size, patterns.length, 'every text should have a result for every pattern');
    for (const pattern of patterns) {
      assertEquals(matches.get(pattern), expectedMatch(text, pattern));
    }
  }
}

Deno.test('parser TS limits mirror the Go parser envelope and admission limit', async () => {
  const limitsGo = await Deno.readTextFile(new URL('packages/praxrr-parser/internal/parser/limits.go', repoRoot));
  const serverGo = await Deno.readTextFile(new URL('packages/praxrr-parser/internal/httpserver/server.go', repoRoot));
  const goConst = (source: string, name: string): number => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\b`).exec(source);
    assert(match, `Go constant ${name} not found`);
    return Number(match[1]);
  };

  assertEquals(limits.PARSER_MAX_REQUEST_BODY_BYTES, goConst(limitsGo, 'maxRequestBodyBytes'));
  assertEquals(limits.PARSER_MAX_TEXT_CHARACTERS, goConst(limitsGo, 'maxTextCharacters'));
  assertEquals(limits.PARSER_MAX_PATTERN_CHARACTERS, goConst(limitsGo, 'maxPatternCharacters'));
  assertEquals(limits.PARSER_MAX_TEXT_COUNT, goConst(limitsGo, 'maxTextCount'));
  assertEquals(limits.PARSER_MAX_PATTERN_COUNT, goConst(limitsGo, 'maxPatternCount'));
  assertEquals(limits.PARSER_MAX_UNIQUE_KEY_COUNT, goConst(limitsGo, 'maxUniqueKeyCount'));
  assertEquals(limits.PARSER_MAX_MATCH_WORK_PRODUCT, goConst(limitsGo, 'maxMatchWorkProduct'));
  const admission = goConst(serverGo, 'DefaultMaxActiveRequests');
  assertEquals(limits.PARSER_ADMISSION_LIMIT, admission);
  assertEquals(STUB_ADMISSION_LIMIT, admission);
  assert(limits.PARSER_MAX_CONCURRENT_REQUESTS < admission);
  // The Go matcher admits min(GOMAXPROCS, maxActiveRegexRequests); 1 slot is safe on any host.
  assertEquals(limits.PARSER_MAX_CONCURRENT_MATCH_REQUESTS, 1);
  assert(goConst(limitsGo, 'maxActiveRegexRequests') >= limits.PARSER_MAX_CONCURRENT_MATCH_REQUESTS);
});

Deno.test('planMatchBatches covers every accepted pair exactly once inside the envelope', () => {
  const encoder = new TextEncoder();
  const longText = `${'é'.repeat(990)}"\\`;
  const longPattern = `(?<n>${'\\d'.repeat(800)})"`;
  const texts = [...makeTitles('Plan', 260), longText, 'x'.repeat(1001), 'Plan.Release.0.tok0.1080p.WEB-DL'];
  const patterns = [
    ...makePatterns('plan', 1200),
    ...Array.from({ length: 120 }, (_, index) => `${longPattern}${index}`),
    'p'.repeat(1637),
  ];

  const plan = planMatchBatches(texts, patterns);
  assertEquals(plan.skippedTexts, ['x'.repeat(1001)]);
  assertEquals(plan.skippedPatterns, ['p'.repeat(1637)]);

  const seen = new Map<string, number>();
  for (const request of plan.requests) {
    const body = JSON.stringify({ texts: request.texts, patterns: request.patterns });
    assertEquals(envelopeViolation(encoder.encode(body).length, request.texts, request.patterns), null);
    for (const text of request.texts) {
      for (const pattern of request.patterns) {
        const key = `${text}\0${pattern}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }

  const acceptedTexts = new Set(texts.filter((text) => !plan.skippedTexts.includes(text)));
  const acceptedPatterns = new Set(patterns.filter((pattern) => !plan.skippedPatterns.includes(pattern)));
  assertEquals(seen.size, acceptedTexts.size * acceptedPatterns.size);
  assert(
    [...seen.values()].every((count) => count === 1),
    'pairs must not be sent twice'
  );
});

Deno.test('parser client stays inside parser admission and envelope limits', async (test) => {
  const state: StubState = {
    inFlight: 0,
    maxInFlight: 0,
    rejected503: 0,
    rejected413: 0,
    parseRequests: 0,
    matchRequests: 0,
    failFirstParseWithBusy: false,
    matcherCap: STUB_MATCHER_LIMIT,
    matchInFlight: 0,
    maxMatchInFlight: 0,
  };
  const logs: unknown[] = [];
  const originalWarn = logger.warn;
  const originalDebug = logger.debug;
  logger.warn = ((message, options) => {
    logs.push({ message, options });
    return Promise.resolve();
  }) as typeof logger.warn;
  logger.debug = (() => Promise.resolve()) as typeof logger.debug;
  const cache = installCacheFakes();
  const server = startStub(state);
  parserClient.clearParserVersionCache();

  const resetCounters = () => {
    state.maxInFlight = 0;
    state.maxMatchInFlight = 0;
    state.matcherCap = STUB_MATCHER_LIMIT;
    state.rejected503 = 0;
    state.rejected413 = 0;
    state.matchRequests = 0;
    state.parseRequests = 0;
    cache.patternCache.clear();
    logs.length = 0;
  };

  try {
    await test.step('150 uncached titles parse without exceeding the concurrency cap', async () => {
      resetCounters();
      const titles = makeTitles('Parse', 150);
      const results = await parserClient.parseWithCacheBatch(titles.map((title) => ({ title, type: 'movie' })));
      assertEquals(results.size, 150);
      for (const [key, value] of results) {
        assert(value !== null, `parse result missing for ${key}`);
      }
      assertEquals(state.rejected503, 0);
      assert(
        state.maxInFlight <= limits.PARSER_MAX_CONCURRENT_REQUESTS,
        `observed ${state.maxInFlight} concurrent requests`
      );
    });

    await test.step('150 titles x 486 patterns are fully matched without 413s', async () => {
      resetCounters();
      const titles = makeTitles('Match', 150);
      const patterns = makePatterns('match', 486);
      const result = await parserClient.matchPatternsBatch(titles, patterns);
      assertCompleteAndCorrect(result, titles, patterns);
      assertEquals(state.rejected413, 0);
      assertEquals(state.rejected503, 0);
      assert(state.maxInFlight <= limits.PARSER_MAX_CONCURRENT_REQUESTS);
      assertEquals(cachedTitles(cache.patternCache), new Set(titles));
    });

    await test.step('single-CPU matcher cap: chunked match and concurrent parse see zero 503s', async () => {
      resetCounters();
      state.matcherCap = 1;
      const titles = makeTitles('OneCpu', 150);
      const patterns = makePatterns('onecpu', 486);
      assert(planMatchBatches(titles, patterns).requests.length > 1, 'step needs multiple chunks');
      const [result, parsed] = await Promise.all([
        parserClient.matchPatternsBatch(titles, patterns),
        parserClient.parseWithCacheBatch(makeTitles('OneCpuParse', 20).map((title) => ({ title, type: 'movie' }))),
      ]);
      assertCompleteAndCorrect(result, titles, patterns);
      assert([...parsed.values()].every((value) => value !== null));
      assertEquals(state.rejected503, 0);
      assertEquals(state.maxMatchInFlight, 1);
      assert(state.maxInFlight <= limits.PARSER_MAX_CONCURRENT_REQUESTS);
    });

    await test.step('oversized text and pattern are skipped without failing the batch', async () => {
      resetCounters();
      const titles = makeTitles('Oversize', 40);
      const patterns = makePatterns('oversize', 60);
      const oversizedText = `Oversize.${'t'.repeat(1001)}`;
      const oversizedPattern = `(${'p'.repeat(1637)})`;
      const result = await parserClient.matchPatternsBatch([...titles, oversizedText], [...patterns, oversizedPattern]);
      assertEquals(state.rejected413, 0);
      assertCompleteAndCorrect(result, titles, patterns);
      assertFalse(result?.has(oversizedText) ?? true);
      assertFalse(cachedTitles(cache.patternCache).has(oversizedText));
      const serializedLogs = JSON.stringify(logs);
      assert(serializedLogs.includes('ParserLimitExceeded'));
      assertFalse(serializedLogs.includes(oversizedText));
      assertFalse(serializedLogs.includes(oversizedPattern));
    });

    await test.step('a failed chunk drops and skips caching only its texts', async () => {
      resetCounters();
      const titles = [...makeTitles('Chunk', 149), FAILING_MARKER];
      const patterns = makePatterns('chunk', 486);
      const failedTexts = new Set(
        planMatchBatches(titles, patterns)
          .requests.filter((request) => request.texts.includes(FAILING_MARKER))
          .flatMap((request) => request.texts)
      );
      const okTexts = titles.filter((title) => !failedTexts.has(title));
      assert(okTexts.length > 0, 'test needs texts outside the failing chunk');

      const result = await parserClient.matchPatternsBatch(titles, patterns);
      assertCompleteAndCorrect(result, okTexts, patterns);
      for (const text of failedTexts) {
        assertFalse(result?.has(text) ?? true, 'texts from a failed chunk must not be returned');
      }
      assertEquals(cachedTitles(cache.patternCache), new Set(okTexts));
      assertFalse(JSON.stringify(logs).includes(FAILING_MARKER));
    });

    await test.step('Retry-After from a busy parser is honored', async () => {
      resetCounters();
      state.failFirstParseWithBusy = true;
      const startedAt = performance.now();
      const results = await parserClient.parseWithCacheBatch([{ title: 'Retry.After.Release', type: 'movie' }]);
      const elapsed = performance.now() - startedAt;
      assert([...results.values()][0] !== null);
      assertEquals(state.parseRequests, 2);
      // Real wait (lower bound only, so not flaky): base backoff for the first retry is 500ms and
      // `Retry-After: 1` must stretch it to 1000ms end to end.
      assert(elapsed >= 990, `retry waited only ${Math.round(elapsed)}ms`);
    });

    await test.step('retry delay honors Retry-After, keeps base backoff, and caps hostile values', () => {
      assertEquals(limits.parserRetryDelayMs(500, 1000), 1000);
      assertEquals(limits.parserRetryDelayMs(2000, 1000), 2000);
      assertEquals(limits.parserRetryDelayMs(500, undefined), 500);
      assertEquals(limits.parserRetryDelayMs(500, 3_600_000), limits.PARSER_MAX_RETRY_AFTER_MS);
    });
  } finally {
    parserClient.clearParserVersionCache();
    cache.restore();
    logger.warn = originalWarn;
    logger.debug = originalDebug;
    await server.shutdown();
  }
});
