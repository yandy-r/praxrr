// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

Deno.env.set('PARSER_HOST', '127.0.0.1');
const PARSER_PORT = 57130;
Deno.env.set('PARSER_PORT', PARSER_PORT.toString());

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

const { deleteCache, setCache } = await import('$pcd/database/registry.ts');
const { parsedReleaseCacheQueries } = await import('$db/queries/parsedReleaseCache.ts');
const { patternMatchCacheQueries } = await import('$db/queries/patternMatchCache.ts');
const evaluateRouteModule = await import('../../routes/api/v1/entity-testing/evaluate/+server.ts');
const parserClientModule = await import('$lib/server/utils/arr/parser/client.ts');

interface InMemoryResponseCacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface RestoreFunction {
  restore: () => void;
  reset: () => void;
  patternNamespaces: () => string[];
}

interface ParseStubResponse {
  title: string;
  type: 'movie' | 'series';
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
  episode: null;
}

async function createParserStub(port: number): Promise<{
  setHealthAvailable: (available: boolean) => void;
  setVersion: (version: string) => void;
  setParseResponse: (title: string, payload: ParseStubResponse) => void;
  setMatchResponse: (text: string, matches: Record<string, boolean>) => void;
  clearResponses: () => void;
  setForwardBaseUrl: (baseUrl: string | null) => void;
  close: () => Promise<void>;
}> {
  const parseResponses = new Map<string, ParseStubResponse>();
  const matchResponses = new Map<string, Record<string, boolean>>();
  let healthAvailable = true;
  let version = 'local-parser-v1';
  let forwardBaseUrl: string | null = null;

  const response = (data: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(data), {
      status: init?.status ?? 200,
      headers: {
        'content-type': 'application/json',
      },
    });

  const server = Deno.serve({
    port,
    onListen() {},
    handler: async (request) => {
      if (!healthAvailable) {
        return new Response('unavailable', { status: 500 });
      }

      const url = new URL(request.url);
      const payloadText = await request.text();

      if (forwardBaseUrl) {
        try {
          return await fetch(`${forwardBaseUrl}${url.pathname}`, {
            method: request.method,
            headers: request.headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : payloadText,
          });
        } catch {
          return new Response('upstream unavailable', { status: 503 });
        }
      }

      const payload = payloadText.length > 0 ? JSON.parse(payloadText) : {};

      if (url.pathname === '/health') {
        return response({
          status: 'ok',
          version,
        });
      }

      if (url.pathname === '/parse') {
        const title = payload.title as string;
        const parsed = parseResponses.get(title);
        if (!parsed) {
          return response(
            { error: `No parse response for ${title}` },
            {
              status: 404,
            }
          );
        }
        return response(parsed);
      }

      if (url.pathname === '/match/batch') {
        const texts = payload.texts as string[];
        const patterns = payload.patterns as string[];
        const results: Record<string, Record<string, boolean>> = {};
        for (const text of texts) {
          const byText = matchResponses.get(text) ?? {};
          const mapped: Record<string, boolean> = {};
          for (const pattern of patterns) {
            mapped[pattern] = byText[pattern] ?? false;
          }
          results[text] = mapped;
        }
        return response({ results });
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    setHealthAvailable: (available) => {
      healthAvailable = available;
    },
    setVersion: (nextVersion) => {
      version = nextVersion;
    },
    setParseResponse: (title, payload) => {
      parseResponses.set(title, payload);
    },
    setMatchResponse: (text, matches) => {
      matchResponses.set(text, matches);
    },
    clearResponses: () => {
      parseResponses.clear();
      matchResponses.clear();
    },
    setForwardBaseUrl: (baseUrl) => {
      forwardBaseUrl = baseUrl;
    },
    close: async () => {
      await server.shutdown();
    },
  };
}

function createPcdCacheFixture(seedSql: string): InMemoryResponseCacheFixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: sqlite,
    }),
  });

  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(seedSql);

  return {
    cache: { kb } as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    },
  };
}

function installParserCacheStubs(): RestoreFunction {
  const parsedCache = new Map<string, string>();
  const patternCache = new Map<string, string>();
  const patternNamespaces = new Set<string>();

  const originalParsedGet = parsedReleaseCacheQueries.get;
  const originalParsedSet = parsedReleaseCacheQueries.set;
  const originalParsedDelete = parsedReleaseCacheQueries.delete;

  const originalPatternGetBatch = patternMatchCacheQueries.getBatch;
  const originalPatternSet = patternMatchCacheQueries.set;
  const originalPatternSetBatch = patternMatchCacheQueries.setBatch;

  parsedReleaseCacheQueries.get = (cacheKey, parserVersion) => {
    const key = `${parserVersion}:${cacheKey}`;
    const result = parsedCache.get(key);
    if (typeof result !== 'string') {
      return undefined;
    }

    return {
      cache_key: cacheKey,
      parser_version: parserVersion,
      parsed_result: result,
      created_at: new Date().toISOString(),
    };
  };

  parsedReleaseCacheQueries.set = (cacheKey, parserVersion, parsedResult) => {
    parsedCache.set(`${parserVersion}:${cacheKey}`, parsedResult);
  };

  parsedReleaseCacheQueries.delete = () => true;

  patternMatchCacheQueries.getBatch = (titles, patternsHash) => {
    patternNamespaces.add(patternsHash);
    const results = new Map<string, string>();
    for (const title of titles) {
      const value = patternCache.get(`${patternsHash}:${title}`);
      if (typeof value === 'string') {
        results.set(title, value);
      }
    }
    return results;
  };

  patternMatchCacheQueries.set = (title, patternsHash, matchResults) => {
    patternNamespaces.add(patternsHash);
    patternCache.set(`${patternsHash}:${title}`, matchResults);
  };

  patternMatchCacheQueries.setBatch = (entries, patternsHash) => {
    patternNamespaces.add(patternsHash);
    for (const entry of entries) {
      patternCache.set(`${patternsHash}:${entry.title}`, entry.matchResults);
    }
  };

  return {
    restore: () => {
      parsedReleaseCacheQueries.get = originalParsedGet;
      parsedReleaseCacheQueries.set = originalParsedSet;
      parsedReleaseCacheQueries.delete = originalParsedDelete;
      patternMatchCacheQueries.getBatch = originalPatternGetBatch;
      patternMatchCacheQueries.set = originalPatternSet;
      patternMatchCacheQueries.setBatch = originalPatternSetBatch;
    },
    reset: () => {
      parsedCache.clear();
      patternCache.clear();
      patternNamespaces.clear();
    },
    patternNamespaces: () => [...patternNamespaces].sort(),
  };
}

interface BuiltGoParser {
  binaryPath: string;
  cleanup: () => Promise<void>;
}

async function buildGoParser(version: string): Promise<BuiltGoParser> {
  const directory = await Deno.makeTempDir({ prefix: 'praxrr-parser-route-' });
  const binaryPath = `${directory}/praxrr-parser`;
  const command = new Deno.Command('go', {
    cwd: new URL('../../../../praxrr-parser/', import.meta.url),
    args: ['build', '-ldflags', `-X main.version=${version}`, '-o', binaryPath, './cmd/praxrr-parser'],
    stdout: 'piped',
    stderr: 'piped',
  });
  const output = await command.output();
  if (!output.success) {
    await Deno.remove(directory, { recursive: true });
    throw new Error(`Go parser build failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  return {
    binaryPath,
    cleanup: () => Deno.remove(directory, { recursive: true }),
  };
}

async function startGoParser(
  binaryPath: string,
  port: number
): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const process = new Deno.Command(binaryPath, {
    env: { PARSER_ADDR: `127.0.0.1:${port}` },
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const healthy = response.ok;
      await response.body?.cancel();
      if (healthy) {
        return {
          baseUrl,
          stop: async () => {
            try {
              process.kill('SIGTERM');
            } catch (error: unknown) {
              if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
            await process.status;
          },
        };
      }
    } catch {
      // Listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  process.kill('SIGKILL');
  await process.status;
  throw new Error(`Go parser did not become healthy at ${baseUrl}`);
}

const parserState = await createParserStub(PARSER_PORT);

Deno.test('entity-testing evaluate: parser-missing titles still match pattern-based conditions', async () => {
  const databaseId = 7001;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserState.setHealthAvailable(true);
  parserState.setVersion('local-parser-v5');

  const fixture = createPcdCacheFixture(`
    INSERT INTO custom_formats (name) VALUES ('CF-TitleFallback');
    INSERT INTO custom_formats (name) VALUES ('CF-GroupFallback');
    INSERT INTO custom_formats (name) VALUES ('CF-ParseDependentYear');

    INSERT INTO regular_expressions (name, pattern)
    VALUES ('title-fallback-regex', 'PROPER');
    INSERT INTO regular_expressions (name, pattern)
    VALUES ('group-fallback-regex', 'Scene');

    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-TitleFallback', 'title-pattern', 'release_title', 'all', 0, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-GroupFallback', 'group-pattern', 'release_group', 'all', 0, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-ParseDependentYear', 'year-range', 'year', 'all', 0, 1);

    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-TitleFallback', 'title-pattern', 'title-fallback-regex');
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-GroupFallback', 'group-pattern', 'group-fallback-regex');

    INSERT INTO condition_years (custom_format_name, condition_name, min_year, max_year)
    VALUES ('CF-ParseDependentYear', 'year-range', 2023, 2026);
  `);
  setCache(databaseId, fixture.cache);

  const title = '[Scene] Frieren - Beyond Journeys End - 01 PROPER REPACK REAL PROPER 1080p x264.mkv';
  parserState.setMatchResponse(title, {
    PROPER: true,
    Scene: true,
  });

  try {
    const response = await evaluateRouteModule.POST({
      request: new Request('http://localhost/api/v1/entity-testing/evaluate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          databaseId,
          releases: [{ id: 'anime-release', title, type: 'series' }],
        }),
      }),
    } as Parameters<typeof evaluateRouteModule.POST>[0]);

    const body = (await response.json()) as {
      parserAvailable: boolean;
      evaluations: Array<{
        releaseId: string;
        title: string;
        parsed?: unknown;
        cfMatches: Record<string, boolean>;
      }>;
    };

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.evaluations.length, 1);

    const [evaluation] = body.evaluations;
    assertEquals(evaluation.releaseId, 'anime-release');
    assertEquals(evaluation.parsed, undefined);
    assertEquals(evaluation.cfMatches['CF-TitleFallback'], true);
    assertEquals(evaluation.cfMatches['CF-GroupFallback'], true);
    assertEquals(evaluation.cfMatches['CF-ParseDependentYear'], false);
  } finally {
    deleteCache(databaseId);
    await fixture.destroy();
    parserState.clearResponses();
    parserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('entity-testing evaluate: real Go lifecycle preserves releases and isolates match failures', async () => {
  const databaseId = 7002;
  const proxyUpstreamPort = 58130;
  const restore = installParserCacheStubs();
  const parserV1 = await buildGoParser('route-entity-v1');
  const parserV2 = await buildGoParser('route-entity-v2');
  let running = await startGoParser(parserV1.binaryPath, proxyUpstreamPort);
  parserState.setForwardBaseUrl(running.baseUrl);
  parserClientModule.clearParserVersionCache();

  const fixture = createPcdCacheFixture(`
    INSERT INTO custom_formats (name) VALUES ('CF-Valid');
    INSERT INTO custom_formats (name) VALUES ('CF-Invalid');
    INSERT INTO custom_formats (name) VALUES ('CF-Timeout');
    INSERT INTO regular_expressions (name, pattern) VALUES ('valid-regex', 'BONUS');
    INSERT INTO regular_expressions (name, pattern) VALUES ('invalid-regex', '(?<unterminated');
    INSERT INTO regular_expressions (name, pattern) VALUES ('timeout-regex', '^(a+)+$');
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-Valid', 'valid-title', 'release_title', 'all', 0, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-Invalid', 'invalid-title', 'release_title', 'all', 0, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('CF-Timeout', 'timeout-title', 'release_title', 'all', 0, 1);
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Valid', 'valid-title', 'valid-regex');
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Invalid', 'invalid-title', 'invalid-regex');
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Timeout', 'timeout-title', 'timeout-regex');
  `);
  setCache(databaseId, fixture.cache);

  const releases = [
    {
      id: 'known',
      title: 'Movie.2024.1080p.WEB-DL.BONUS-GROUP',
      type: 'movie' as const,
    },
    { id: 'domain-miss', title: 'Meaningless.BONUS', type: 'movie' as const },
    { id: 'timeout', title: `${'a'.repeat(999)}!`, type: 'movie' as const },
  ];
  const evaluate = async () => {
    const response = await evaluateRouteModule.POST({
      request: new Request('http://localhost/api/v1/entity-testing/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ databaseId, releases }),
      }),
    } as Parameters<typeof evaluateRouteModule.POST>[0]);
    return (await response.json()) as {
      parserAvailable: boolean;
      evaluations: Array<{
        releaseId: string;
        title: string;
        parsed?: { source: string; year: number };
        cfMatches: Record<string, boolean>;
      }>;
    };
  };

  try {
    const healthy = await evaluate();
    assertEquals(healthy.parserAvailable, true);
    assertEquals(
      healthy.evaluations.map(({ releaseId, title }) => ({ releaseId, title })),
      releases.map(({ id, title }) => ({ releaseId: id, title }))
    );
    assertEquals(healthy.evaluations[0].cfMatches, {
      'CF-Valid': true,
      'CF-Invalid': false,
      'CF-Timeout': false,
    });
    assertEquals(healthy.evaluations[1].parsed?.source, 'unknown');
    assertEquals(healthy.evaluations[1].cfMatches['CF-Valid'], true);
    assertEquals(healthy.evaluations[2].cfMatches['CF-Timeout'], false);
    assertEquals(
      restore.patternNamespaces().some((value) => value.startsWith('v1:route-entity-v1:')),
      true
    );

    await running.stop();
    parserClientModule.clearParserVersionCache();
    const unavailable = await evaluate();
    assertEquals(unavailable.parserAvailable, false);
    assertEquals(
      unavailable.evaluations,
      releases.map(({ id, title }) => ({
        releaseId: id,
        title,
        cfMatches: {},
      }))
    );

    running = await startGoParser(parserV2.binaryPath, proxyUpstreamPort);
    parserClientModule.clearParserVersionCache();
    const recovered = await evaluate();
    assertEquals(recovered.parserAvailable, true);
    assertEquals(recovered.evaluations[0].cfMatches['CF-Valid'], true);
    assertEquals(
      restore.patternNamespaces().some((value) => value.startsWith('v1:route-entity-v2:')),
      true
    );
  } finally {
    await running.stop();
    parserState.setForwardBaseUrl(null);
    parserClientModule.clearParserVersionCache();
    deleteCache(databaseId);
    await fixture.destroy();
    restore.restore();
    await parserV1.cleanup();
    await parserV2.cleanup();
  }
});

Deno.test.afterAll(async () => {
  await parserState.close();
});
