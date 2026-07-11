// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for server tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertFalse } from '@std/assert';

const PARSER_PORT = 57241;
const GO_VERSION = '2.0.0-go.1';
const CSHARP_ROLLBACK_VERSION = '1.0.0-csharp.legacy';
const SECRET_TITLE = 'release-title-secret-7f6c9b';
const SECRET_PATTERN = '(?<password>regex-secret-3d2a1e)';

Deno.env.set('PARSER_HOST', '127.0.0.1');
Deno.env.set('PARSER_PORT', String(PARSER_PORT));

const { logger } = await import('$logger/logger.ts');
const { parsedReleaseCacheQueries } = await import('$db/queries/parsedReleaseCache.ts');
const { getPatternMatchCacheNamespace, patternMatchCacheQueries } = await import('$db/queries/patternMatchCache.ts');
const parserClient = await import('$lib/server/utils/arr/parser/client.ts');

interface ParserStubState {
  version: string;
  available: boolean;
  generation: number;
  matchRequests: number;
  parseRequests: number;
  matches: Map<string, Record<string, boolean>>;
}

function response(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function installCacheFakes(): {
  patternCache: Map<string, string>;
  namespaces: string[];
  restore: () => void;
} {
  const patternCache = new Map<string, string>();
  const parsedCache = new Map<string, string>();
  const namespaces: string[] = [];

  const originalPatternGetBatch = patternMatchCacheQueries.getBatch;
  const originalPatternSetBatch = patternMatchCacheQueries.setBatch;
  const originalParsedGet = parsedReleaseCacheQueries.get;
  const originalParsedSet = parsedReleaseCacheQueries.set;

  patternMatchCacheQueries.getBatch = (titles, namespace) => {
    namespaces.push(namespace);
    const results = new Map<string, string>();
    for (const title of titles) {
      const cached = patternCache.get(`${namespace}\0${title}`);
      if (cached !== undefined) {
        results.set(title, cached);
      }
    }
    return results;
  };
  patternMatchCacheQueries.setBatch = (entries, namespace) => {
    namespaces.push(namespace);
    for (const entry of entries) {
      patternCache.set(`${namespace}\0${entry.title}`, entry.matchResults);
    }
  };
  parsedReleaseCacheQueries.get = (cacheKey, version) => {
    const parsedResult = parsedCache.get(`${version}\0${cacheKey}`);
    return parsedResult === undefined
      ? undefined
      : {
          cache_key: cacheKey,
          parser_version: version,
          parsed_result: parsedResult,
          created_at: new Date(0).toISOString(),
        };
  };
  parsedReleaseCacheQueries.set = (cacheKey, version, parsedResult) => {
    parsedCache.set(`${version}\0${cacheKey}`, parsedResult);
  };

  return {
    patternCache,
    namespaces,
    restore: () => {
      patternMatchCacheQueries.getBatch = originalPatternGetBatch;
      patternMatchCacheQueries.setBatch = originalPatternSetBatch;
      parsedReleaseCacheQueries.get = originalParsedGet;
      parsedReleaseCacheQueries.set = originalParsedSet;
    },
  };
}

function matchValue(
  result: Map<string, Map<string, boolean>> | null,
  title: string,
  pattern: string
): boolean | undefined {
  return result?.get(title)?.get(pattern);
}

Deno.test('parser cache cutover namespaces behavior versions and redacts request data', async (test) => {
  const state: ParserStubState = {
    version: GO_VERSION,
    available: true,
    generation: 1,
    matchRequests: 0,
    parseRequests: 0,
    matches: new Map(),
  };
  const logs: unknown[] = [];
  const originalWarn = logger.warn;
  const originalDebug = logger.debug;
  const cache = installCacheFakes();

  logger.warn = ((message, options) => {
    logs.push({ message, options });
    return Promise.resolve();
  }) as typeof logger.warn;
  logger.debug = ((message, options) => {
    logs.push({ message, options });
    return Promise.resolve();
  }) as typeof logger.debug;

  const server = Deno.serve({
    hostname: '127.0.0.1',
    port: PARSER_PORT,
    onListen() {},
    handler: async (request) => {
      const url = new URL(request.url);
      if (!state.available) {
        return response({ error: `${SECRET_TITLE}:${SECRET_PATTERN}` }, 422);
      }
      if (url.pathname === '/health') {
        return response({ status: 'ok', version: state.version });
      }

      const payload = (await request.json()) as Record<string, unknown>;
      if (url.pathname === '/match/batch') {
        state.matchRequests += 1;
        const texts = payload.texts as string[];
        const patterns = payload.patterns as string[];
        if (texts.includes(SECRET_TITLE) || patterns.includes(SECRET_PATTERN)) {
          return response({ error: `${texts.join(',')}:${patterns.join(',')}` }, 422);
        }
        const results: Record<string, Record<string, boolean>> = {};
        for (const text of texts) {
          results[text] = Object.fromEntries(
            patterns.map((pattern) => [pattern, state.matches.get(text)?.[pattern] ?? false])
          );
        }
        return response({ results });
      }
      if (url.pathname === '/parse') {
        state.parseRequests += 1;
        return response({ error: String(payload.title) }, 422);
      }
      return response({ error: 'not found' }, 404);
    },
  });

  parserClient.clearParserVersionCache();

  try {
    const pattern = 'WEB-DL';
    const firstTitle = 'Example.Release.1080p.WEB-DL';
    state.matches.set(firstTitle, { [pattern]: true });

    await test.step('same behavior version hits its namespace across a restart', async () => {
      const first = await parserClient.matchPatternsBatch([firstTitle], [pattern]);
      assertEquals(matchValue(first, firstTitle, pattern), true);
      assertEquals(state.matchRequests, 1);

      state.generation += 1;
      state.matches.set(firstTitle, { [pattern]: false });
      const afterRestart = await parserClient.matchPatternsBatch([firstTitle], [pattern]);
      assertEquals(matchValue(afterRestart, firstTitle, pattern), true);
      assertEquals(state.matchRequests, 1, 'same-version restart should reuse proven cache entry');
    });

    await test.step('new Go version does not hit the previous namespace', async () => {
      state.version = '2.0.0-go.2';
      const result = await parserClient.matchPatternsBatch([firstTitle], [pattern]);
      assertEquals(matchValue(result, firstTitle, pattern), false);
      assertEquals(state.matchRequests, 2);
    });

    const cachedTitle = 'Cached.Release.WEB-DL';
    const missingTitle = 'Missing.Release.WEB-DL';
    state.matches.set(cachedTitle, { [pattern]: true });
    state.matches.set(missingTitle, { [pattern]: false });

    await test.step('unavailable parser returns partial cache and fills misses after recovery', async () => {
      const seeded = await parserClient.matchPatternsBatch([cachedTitle], [pattern]);
      assertEquals(matchValue(seeded, cachedTitle, pattern), true);

      const requestsBeforeOutage = state.matchRequests;
      state.available = false;
      const partial = await parserClient.matchPatternsBatch([cachedTitle, missingTitle], [pattern]);
      assertEquals(matchValue(partial, cachedTitle, pattern), true);
      assertFalse(partial?.has(missingTitle) ?? true);
      assertEquals(
        state.matchRequests,
        requestsBeforeOutage,
        'failed health refresh must not compute misses under the stale namespace'
      );

      state.available = true;
      const recovered = await parserClient.matchPatternsBatch([cachedTitle, missingTitle], [pattern]);
      assertEquals(matchValue(recovered, cachedTitle, pattern), true);
      assertEquals(matchValue(recovered, missingTitle, pattern), false);
      assertEquals(state.matchRequests, requestsBeforeOutage + 1);
    });

    await test.step('C# rollback uses a separate namespace', async () => {
      const requestsBeforeRollback = state.matchRequests;
      state.version = CSHARP_ROLLBACK_VERSION;
      state.matches.set(firstTitle, { [pattern]: true });
      const rolledBack = await parserClient.matchPatternsBatch([firstTitle], [pattern]);
      assertEquals(matchValue(rolledBack, firstTitle, pattern), true);
      assertEquals(state.matchRequests, requestsBeforeRollback + 1);

      const goPrefix = `v1:${encodeURIComponent('2.0.0-go.2')}:`;
      const csharpPrefix = `v1:${encodeURIComponent(CSHARP_ROLLBACK_VERSION)}:`;
      assert(cache.namespaces.some((namespace) => namespace.startsWith(goPrefix)));
      assert(cache.namespaces.some((namespace) => namespace.startsWith(csharpPrefix)));
      assertFalse(
        getPatternMatchCacheNamespace('2.0.0-go.2', 'same-hash') ===
          getPatternMatchCacheNamespace(CSHARP_ROLLBACK_VERSION, 'same-hash')
      );
    });

    await test.step('failure logs never include raw titles, texts, patterns, or echoed bodies', async () => {
      logs.length = 0;
      const failedMatch = await parserClient.matchPatternsBatch([SECRET_TITLE], [SECRET_PATTERN]);
      assertEquals(failedMatch, null);
      const failedParse = await parserClient.parseWithCache(SECRET_TITLE, 'movie');
      assertEquals(failedParse, null);
      assertEquals(state.parseRequests, 1);

      const serializedLogs = JSON.stringify(logs);
      assertFalse(serializedLogs.includes(SECRET_TITLE), 'logs leaked the raw title/text');
      assertFalse(serializedLogs.includes(SECRET_PATTERN), 'logs leaked the raw pattern');
      assert(serializedLogs.includes('ParserRequestFailed'));
    });

    assert(cache.patternCache.size > 0);
  } finally {
    parserClient.clearParserVersionCache();
    cache.restore();
    logger.warn = originalWarn;
    logger.debug = originalDebug;
    await server.shutdown();
  }
});
