/// <reference path="../../app.d.ts" />

import { assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

Deno.env.set('PARSER_HOST', '127.0.0.1');

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);
const PARSER_PORT = 57129;
Deno.env.set('PARSER_PORT', PARSER_PORT.toString());
const { deleteCache, setCache } = await import('$pcd/database/registry.ts');
const { parsedReleaseCacheQueries } = await import('$db/queries/parsedReleaseCache.ts');
const { patternMatchCacheQueries } = await import('$db/queries/patternMatchCache.ts');
const { trashGuideManager } = await import('$lib/server/trashguide/manager.ts');
const { trashGuideEntityCacheQueries } = await import('$db/queries/trashGuideEntityCache.ts');
const { trashGuideSourcesQueries } = await import('$db/queries/trashGuideSources.ts');
const { trashIdMappingsQueries } = await import('$db/queries/trashIdMappings.ts');

const scoreRouteModule = await import('../../routes/api/v1/simulate/score/+server.ts');
const parserClientModule = await import('$lib/server/utils/arr/parser/client.ts');
const parserParserState = await createParserStub(PARSER_PORT);

interface InMemoryResponseCacheFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

interface RestoreFunction {
  restore: () => void;
  reset: () => void;
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

interface ParsedResultRequest {
  id: string;
  title: string;
  type: 'movie' | 'series';
}

interface ScoreRequest {
  databaseId: number;
  releases: ParsedResultRequest[];
  profileNames: string[];
  arrType: 'radarr' | 'sonarr';
}

type ScoreRequestInput = Omit<ScoreRequest, 'arrType'> & { arrType: string };

interface SimulatedScoreResponse {
  parserAvailable: boolean;
  results: Array<{
    id: string;
    title: string;
    parsed: {
      source: string;
      resolution: string;
      modifier: string;
      languages: string[];
      releaseGroup: string | null;
      year: number;
      edition: string | null;
      releaseType: string | null;
    };
    cfMatches: Array<{ name: string; matches: boolean; conditions: unknown[] }>;
    profileScores: Array<{
      profileName: string;
      totalScore: number;
      minimumScore: number;
      upgradeUntilScore: number;
      contributions: Array<{ cfName: string; score: number }>;
    }>;
  }>;
}

interface MissingProfileResponse {
  error: string;
  missing: string[];
}

interface ErrorResponseLike {
  status: number;
}

const BASE_PARSE_RESPONSE: Omit<ParseStubResponse, 'title' | 'type'> = {
  source: 'Unknown',
  resolution: 1080,
  modifier: 'None',
  revision: {
    version: 1,
    real: 1,
    isRepack: false,
  },
  languages: ['Unknown'],
  releaseGroup: null,
  movieTitles: [],
  year: 2020,
  edition: null,
  imdbId: null,
  tmdbId: 0,
  hardcodedSubs: null,
  releaseHash: null,
  episode: null,
};

function getErrorStatus(error: unknown): number {
  const typedError = error as ErrorResponseLike;
  if (typeof typedError?.status !== 'number') {
    throw new Error('Expected error object with status number');
  }

  return typedError.status;
}

function buildEvent(payload: ScoreRequest | ScoreRequestInput): Parameters<typeof scoreRouteModule.POST>[0] {
  return {
    request: new Request('http://localhost/api/v1/simulate/score', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  } as Parameters<typeof scoreRouteModule.POST>[0];
}

function buildRawEvent(rawBody: string): Parameters<typeof scoreRouteModule.POST>[0] {
  return {
    request: new Request('http://localhost/api/v1/simulate/score', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: rawBody,
    }),
  } as Parameters<typeof scoreRouteModule.POST>[0];
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
    patternCache.set(`${patternsHash}:${title}`, matchResults);
  };

  patternMatchCacheQueries.setBatch = (entries, patternsHash) => {
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
    },
  };
}

async function createParserStub(port: number): Promise<{
  baseUrl: string;
  setHealthAvailable: (available: boolean) => void;
  setVersion: (version: string) => void;
  setParseResponse: (title: string, payload: ParseStubResponse) => void;
  setMatchResponse: (text: string, matches: Record<string, boolean>) => void;
  clearResponses: () => void;
  close: () => Promise<void>;
}> {
  const parseResponses = new Map<string, ParseStubResponse>();
  const matchResponses = new Map<string, Record<string, boolean>>();

  let healthAvailable = true;
  let version = 'local-parser-v1';

  const response = (data: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(data), {
      status: init?.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers as Record<string, string>),
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
      const payload = payloadText.length > 0 ? JSON.parse(payloadText) : {};

      if (url.pathname === '/health') {
        return response({
          status: 'ok',
          version,
        });
      }

      if (url.pathname === '/parse') {
        const title = payload.title as string;
        const responsePayload = parseResponses.get(title);
        if (!responsePayload) {
          return response(
            { error: `No parse response for ${title}` },
            {
              status: 404,
            }
          );
        }
        return response(responsePayload);
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
    baseUrl: `http://127.0.0.1:${server.addr.port}`,
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
    close: async () => {
      await server.shutdown();
    },
  };
}

Deno.test('simulate score: returns unavailable when parser is down', async () => {
  const restore = installParserCacheStubs();
  parserParserState.setHealthAvailable(false);
  parserClientModule.clearParserVersionCache();
  restore.reset();

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId: 6001,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [
          {
            id: 'release-unavailable',
            title: 'Unavailable Parser Title',
            type: 'movie',
          },
        ],
      })
    );
    const body = (await response.json()) as SimulatedScoreResponse;

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, false);
    assertEquals(body.results.length, 0);
  } finally {
    parserParserState.setHealthAvailable(true);
    parserClientModule.clearParserVersionCache();
    restore.restore();
  }
});

Deno.test('simulate score: validates request limits', async (t) => {
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();

  const basePayload: ScoreRequest = {
    databaseId: 6002,
    arrType: 'radarr',
    profileNames: ['pcd:Primary'],
    releases: [
      {
        id: 'release-base',
        title: 'Some Title',
        type: 'movie',
      },
    ],
  };

  await t.step('rejects invalid arrType', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          arrType: 'wrong',
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects empty profileNames', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: [],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects profileNames over max', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: Array.from({ length: 11 }, (_, i) => `pcd:Profile-${i}`),
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects empty releases array', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          releases: [],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects releases over max', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          releases: Array.from({ length: 51 }, (_, i) => ({
            id: `too-many-${i}`,
            title: `Movie ${i}`,
            type: 'movie' as const,
          })),
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects malformed JSON body', async () => {
    const error = await assertRejects(async () => scoreRouteModule.POST(buildRawEvent('{not valid json')));
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects non-number databaseId', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          databaseId: 'abc' as unknown as number,
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('rejects malformed trash selector', async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: ['trash:abc:invalid'],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  restore.restore();
});

Deno.test('simulate score: returns missing profiles as 404', async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources = (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6003;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v1');

  const fixture = createPcdCacheFixture(`
    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score)
    VALUES (1, 'Existing Profile', 5, 10);
  `);

  setCache(databaseId, fixture.cache);

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Missing Profile'],
        releases: [
          {
            id: 'release-missing',
            title: 'Some Missing Match',
            type: 'movie',
          },
        ],
      })
    );
    const body = (await response.json()) as MissingProfileResponse;

    assertEquals(response.status, 404);
    assertEquals(body.error, 'Quality profiles not found');
    assertEquals(body.missing, ['pcd:Missing Profile']);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    restore.restore();
  }
});

Deno.test('simulate score: calculates correct scores with positive and negative CF rows', async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources = (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6004;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v2');

  const fixture = createPcdCacheFixture(`
    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
    VALUES (1, 'Primary Profile', 11, 22, 1);

    INSERT INTO custom_formats (name)
    VALUES ('CF-Bonus');
    INSERT INTO custom_formats (name)
    VALUES ('CF-Negative');
    INSERT INTO custom_formats (name)
    VALUES ('CF-Primary');

    INSERT INTO regular_expressions (name, pattern)
    VALUES ('bonus-regex', 'BONUS');
    INSERT INTO regular_expressions (name, pattern)
    VALUES ('negative-regex', 'CAM');
    INSERT INTO regular_expressions (name, pattern)
    VALUES ('primary-regex', 'HDR');

    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
    VALUES ('CF-Bonus', 'bonus-title', 'release_title', 'all');
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
    VALUES ('CF-Negative', 'negative-title', 'release_title', 'all');
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
    VALUES ('CF-Primary', 'primary-title', 'release_title', 'all');

    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Bonus', 'bonus-title', 'bonus-regex');
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Negative', 'negative-title', 'negative-regex');
    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Primary', 'primary-title', 'primary-regex');

    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Primary Profile', 'CF-Bonus', 'radarr', 9);
    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Primary Profile', 'CF-Negative', 'radarr', -2);
    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Primary Profile', 'CF-Primary', 'radarr', 14);
  `);

  setCache(databaseId, fixture.cache);

  const releases = [
    {
      id: 'release-one',
      title: 'Movie.HDR.BONUS',
      type: 'movie' as const,
    },
    {
      id: 'release-two',
      title: 'Movie.CAM',
      type: 'movie' as const,
    },
  ];

  const commonParse = {
    ...BASE_PARSE_RESPONSE,
    type: 'movie' as const,
  };
  parserParserState.setParseResponse('Movie.HDR.BONUS', {
    ...commonParse,
    title: 'Movie.HDR.BONUS',
  });
  parserParserState.setParseResponse('Movie.CAM', {
    ...commonParse,
    title: 'Movie.CAM',
  });

  parserParserState.setMatchResponse('Movie.HDR.BONUS', {
    HDR: true,
    BONUS: true,
    CAM: false,
  });
  parserParserState.setMatchResponse('Movie.CAM', {
    HDR: false,
    BONUS: false,
    CAM: true,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary Profile'],
        releases,
      })
    );
    const body = (await response.json()) as SimulatedScoreResponse;

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 2);

    const [first, second] = body.results;
    assertEquals(first.title, 'Movie.HDR.BONUS');
    assertEquals(first.profileScores[0].minimumScore, 11);
    assertEquals(first.profileScores[0].upgradeUntilScore, 22);
    assertEquals(first.profileScores[0].totalScore, 23);
    assertEquals(first.profileScores[0].contributions, [
      { cfName: 'CF-Bonus', score: 9 },
      { cfName: 'CF-Primary', score: 14 },
    ]);

    assertEquals(second.title, 'Movie.CAM');
    assertEquals(second.profileScores[0].totalScore, -2);
    assertEquals(second.profileScores[0].contributions, [
      {
        cfName: 'CF-Negative',
        score: -2,
      },
    ]);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('simulate score: Not Original or English does not penalize unknown language', async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources = (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6005;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v3');

  const fixture = createPcdCacheFixture(`
    INSERT OR IGNORE INTO languages (name)
    VALUES ('Unknown'), ('English'), ('Original');

    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score)
    VALUES (1, 'Language Profile', 0, 0);

    INSERT INTO custom_formats (name)
    VALUES ('Not Original or English');

    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('Not Original or English', 'English', 'language', 'all', 1, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('Not Original or English', 'Unknown', 'language', 'all', 1, 1);
    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
    VALUES ('Not Original or English', 'Original', 'language', 'all', 1, 1);

    INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language)
    VALUES ('Not Original or English', 'English', 'English', 0);
    INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language)
    VALUES ('Not Original or English', 'Unknown', 'Unknown', 0);
    INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language)
    VALUES ('Not Original or English', 'Original', 'Original', 0);

    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Language Profile', 'Not Original or English', 'radarr', -999999);
  `);

  setCache(databaseId, fixture.cache);

  const releases = [
    {
      id: 'unknown-language-release',
      title: 'Movie.2024.2160p.WEB-DL',
      type: 'movie' as const,
    },
    {
      id: 'foreign-language-release',
      title: 'Movie.2024.FRENCH.2160p.WEB-DL',
      type: 'movie' as const,
    },
  ];

  const commonParse = {
    ...BASE_PARSE_RESPONSE,
    type: 'movie' as const,
  };
  parserParserState.setParseResponse('Movie.2024.2160p.WEB-DL', {
    ...commonParse,
    title: 'Movie.2024.2160p.WEB-DL',
    languages: ['Unknown'],
  });
  parserParserState.setParseResponse('Movie.2024.FRENCH.2160p.WEB-DL', {
    ...commonParse,
    title: 'Movie.2024.FRENCH.2160p.WEB-DL',
    languages: ['French'],
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Language Profile'],
        releases,
      })
    );
    const body = (await response.json()) as SimulatedScoreResponse;

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 2);

    const unknown = body.results.find((result) => result.id === 'unknown-language-release');
    const foreign = body.results.find((result) => result.id === 'foreign-language-release');

    assertEquals(unknown?.profileScores[0].totalScore, 0);
    assertEquals(unknown?.profileScores[0].contributions, []);
    assertEquals(unknown?.cfMatches.find((cf) => cf.name === 'Not Original or English')?.matches, false);

    assertEquals(foreign?.profileScores[0].totalScore, -999999);
    assertEquals(foreign?.profileScores[0].contributions, [{ cfName: 'Not Original or English', score: -999999 }]);
    assertEquals(foreign?.cfMatches.find((cf) => cf.name === 'Not Original or English')?.matches, true);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('simulate score: parser-missing releases still evaluate pattern-based conditions', async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources = (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6006;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v4');

  const fixture = createPcdCacheFixture(`
    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score)
    VALUES (1, 'Anime Profile', 0, 0);

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

    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Anime Profile', 'CF-TitleFallback', 'sonarr', 5);
    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Anime Profile', 'CF-GroupFallback', 'sonarr', 9);
    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('Anime Profile', 'CF-ParseDependentYear', 'sonarr', 50);
  `);

  setCache(databaseId, fixture.cache);

  const title = '[Scene] Frieren - Beyond Journeys End - 01 PROPER REPACK REAL PROPER 1080p x264.mkv';
  parserParserState.setMatchResponse(title, {
    PROPER: true,
    Scene: true,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'sonarr',
        profileNames: ['pcd:Anime Profile'],
        releases: [
          {
            id: 'anime-release',
            title,
            type: 'series' as const,
          },
        ],
      })
    );
    const body = (await response.json()) as SimulatedScoreResponse;

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 1);

    const [release] = body.results;
    assertEquals(release.parsed, null);

    const score = release.profileScores[0];
    assertEquals(score.profileName, 'pcd:Anime Profile');
    assertEquals(score.totalScore, 14);
    assertEquals(score.contributions.some((row) => row.cfName === 'CF-TitleFallback' && row.score === 5), true);
    assertEquals(score.contributions.some((row) => row.cfName === 'CF-GroupFallback' && row.score === 9), true);
    assertEquals(score.contributions.some((row) => row.cfName === 'CF-ParseDependentYear'), false);

    assertEquals(release.cfMatches.find((row) => row.name === 'CF-TitleFallback')?.matches, true);
    assertEquals(release.cfMatches.find((row) => row.name === 'CF-GroupFallback')?.matches, true);
    assertEquals(release.cfMatches.find((row) => row.name === 'CF-ParseDependentYear')?.matches, false);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('simulate score: mixed pcd and TRaSH profiles produce non-zero TRaSH totals', async () => {
  const sourceId = 9101;
  const customFormatTrashId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const qualityProfileTrashId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const nowIso = new Date().toISOString();

  const originalListSources = trashGuideManager.listSources;
  const originalGetBySourceAndType = trashGuideEntityCacheQueries.getBySourceAndType;
  const originalGetMappingsBySource = trashIdMappingsQueries.getBySource;

  const customFormatEntity = {
    trash_id: customFormatTrashId,
    arr_type: 'radarr',
    entity_type: 'custom_format',
    file_path: '/trash/custom-format-bonus.json',
    name: 'TRaSH Bonus',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 25,
    },
    specifications: [
      {
        name: 'trash-bonus-title',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: 'BONUS',
        },
      },
    ],
  };

  const qualityProfileEntity = {
    trash_id: qualityProfileTrashId,
    arr_type: 'radarr',
    entity_type: 'quality_profile',
    file_path: '/trash/quality-profile.json',
    name: 'TRaSH Profile',
    description: null,
    source_url: null,
    score_set: null,
    group: null,
    upgrade_allowed: true,
    cutoff: 'WEBDL-1080p',
    min_format_score: 0,
    cutoff_format_score: 0,
    min_upgrade_format_score: 0,
    language: null,
    items: [],
    format_items: [
      {
        name: 'TRaSH Bonus',
        score: null,
        custom_format_trash_id: customFormatTrashId,
      },
    ],
  };

  const customFormatCacheRow = {
    id: 1,
    sourceId,
    trashId: customFormatTrashId,
    entityType: 'custom_format',
    name: customFormatEntity.name,
    jsonData: JSON.stringify(customFormatEntity),
    filePath: customFormatEntity.file_path,
    contentHash: 'hash-cf',
    fetchedAt: nowIso,
  };

  const qualityProfileCacheRow = {
    id: 2,
    sourceId,
    trashId: qualityProfileTrashId,
    entityType: 'quality_profile',
    name: qualityProfileEntity.name,
    jsonData: JSON.stringify(qualityProfileEntity),
    filePath: qualityProfileEntity.file_path,
    contentHash: 'hash-qp',
    fetchedAt: nowIso,
  };

  trashGuideManager.listSources = (() => [
    {
      id: sourceId,
      name: 'TRaSH Test',
      arrType: 'radarr',
    },
  ]) as typeof trashGuideManager.listSources;

  trashGuideEntityCacheQueries.getBySourceAndType = ((requestedSourceId, entityType) => {
    if (requestedSourceId !== sourceId) {
      return [];
    }

    if (entityType === 'custom_format') {
      return [customFormatCacheRow];
    }

    if (entityType === 'quality_profile') {
      return [qualityProfileCacheRow];
    }

    return [];
  }) as typeof trashGuideEntityCacheQueries.getBySourceAndType;

  trashIdMappingsQueries.getBySource = ((requestedSourceId, arrType) => {
    if (requestedSourceId !== sourceId) {
      return [];
    }
    if (arrType && arrType !== 'radarr') {
      return [];
    }

    return [
      {
        sourceId,
        trashId: customFormatTrashId,
        arrType: 'radarr',
        entityType: 'custom_format',
        entityName: 'CF-Bonus',
      },
    ];
  }) as typeof trashIdMappingsQueries.getBySource;

  const databaseId = 6006;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v4');

  const fixture = createPcdCacheFixture(`
    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
    VALUES (1, 'PCD Profile', 0, 0, 1);

    INSERT INTO custom_formats (name)
    VALUES ('CF-Bonus');

    INSERT INTO regular_expressions (name, pattern)
    VALUES ('pcd-bonus-regex', 'BONUS');

    INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
    VALUES ('CF-Bonus', 'pcd-bonus-title', 'release_title', 'all');

    INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
    VALUES ('CF-Bonus', 'pcd-bonus-title', 'pcd-bonus-regex');

    INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
    VALUES ('PCD Profile', 'CF-Bonus', 'radarr', 10);
  `);

  setCache(databaseId, fixture.cache);

  parserParserState.setParseResponse('Movie.BONUS', {
    ...BASE_PARSE_RESPONSE,
    title: 'Movie.BONUS',
    type: 'movie',
  });
  parserParserState.setMatchResponse('Movie.BONUS', {
    BONUS: true,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:PCD Profile', `trash:${sourceId}:TRaSH Profile`],
        releases: [
          {
            id: 'release-mixed',
            title: 'Movie.BONUS',
            type: 'movie',
          },
        ],
      })
    );

    const body = (await response.json()) as SimulatedScoreResponse;
    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 1);

    const release = body.results[0];
    const pcdScore = release.profileScores.find((score) => score.profileName === 'pcd:PCD Profile');
    const trashScore = release.profileScores.find((score) => score.profileName === `trash:${sourceId}:TRaSH Profile`);

    assertEquals(pcdScore?.totalScore, 10);
    assertEquals(trashScore?.totalScore, 25);
    assertEquals(pcdScore?.contributions, [{ cfName: 'CF-Bonus', score: 10 }]);
    assertEquals(trashScore?.contributions, [{ cfName: 'CF-Bonus', score: 25 }]);
    assertEquals(release.cfMatches.find((row) => row.name === 'CF-Bonus')?.matches, true);
  } finally {
    trashGuideManager.listSources = originalListSources;
    trashGuideEntityCacheQueries.getBySourceAndType = originalGetBySourceAndType;
    trashIdMappingsQueries.getBySource = originalGetMappingsBySource;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('simulate score: TRaSH CF-group fallback restores TRaSH matches without changing PCD totals', async () => {
  const sourceId = 9103;
  const qualityProfileTrashId = '11111111111111111111111111111111';
  const webCfTrashId = '22222222222222222222222222222222';
  const hdrCfTrashId = '33333333333333333333333333333333';
  const nowIso = new Date().toISOString();

  const originalListSources = trashGuideManager.listSources;
  const originalGetBySourceAndType = trashGuideEntityCacheQueries.getBySourceAndType;
  const originalGetMappingsBySource = trashIdMappingsQueries.getBySource;
  const originalGetSourceById = trashGuideSourcesQueries.getById;

  const tempTrashClone = await Deno.makeTempDir({ prefix: 'simulate-score-trash-fallback-' });
  const metadataPath = `${tempTrashClone}/metadata.json`;
  const customFormatGroupPath = `${tempTrashClone}/cf-groups/hdr-formats.json`;

  try {
    await Deno.mkdir(`${tempTrashClone}/cf`, { recursive: true });
    await Deno.mkdir(`${tempTrashClone}/quality-profiles`, { recursive: true });
    await Deno.mkdir(`${tempTrashClone}/qualities`, { recursive: true });
    await Deno.mkdir(`${tempTrashClone}/naming`, { recursive: true });
    await Deno.mkdir(`${tempTrashClone}/cf-groups`, { recursive: true });

    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify(
        {
          json_paths: {
            radarr: {
              custom_formats: ['cf'],
              quality_profiles: ['quality-profiles'],
              qualities: ['qualities'],
              naming: ['naming'],
              custom_format_groups: ['cf-groups'],
            },
          },
        },
        null,
        2
      )
    );

    await Deno.writeTextFile(
      customFormatGroupPath,
      JSON.stringify(
        {
          name: '[HDR Formats] HDR',
          trash_id: '44444444444444444444444444444444',
          default: true,
          custom_formats: [
            {
              name: 'HDR',
              trash_id: hdrCfTrashId,
              required: true,
            },
          ],
          quality_profiles: {
            include: {
              'Remux + WEB 2160p': qualityProfileTrashId,
            },
          },
        },
        null,
        2
      )
    );

    const webCustomFormatEntity = {
      trash_id: webCfTrashId,
      arr_type: 'radarr',
      entity_type: 'custom_format',
      file_path: '/trash/custom-format-web-tier-01.json',
      name: 'Web Tier 01',
      description: null,
      regex_url: null,
      include_in_rename: false,
      scores: {
        default: 10,
      },
      specifications: [
        {
          name: 'web-tier-title',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: true,
          fields: {
            value: 'WEB',
          },
        },
      ],
    };

    const hdrCustomFormatEntity = {
      trash_id: hdrCfTrashId,
      arr_type: 'radarr',
      entity_type: 'custom_format',
      file_path: '/trash/custom-format-hdr.json',
      name: 'HDR',
      description: null,
      regex_url: null,
      include_in_rename: false,
      scores: {
        default: 100,
      },
      specifications: [
        {
          name: 'hdr-title',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: false,
          fields: {
            value: '\\b(HDR)\\b',
          },
        },
      ],
    };

    const qualityProfileEntity = {
      trash_id: qualityProfileTrashId,
      arr_type: 'radarr',
      entity_type: 'quality_profile',
      file_path: '/trash/quality-profile-remux-web-2160p.json',
      name: 'Remux + WEB 2160p',
      description: null,
      source_url: null,
      score_set: null,
      group: null,
      upgrade_allowed: true,
      cutoff: 'Remux-2160p',
      min_format_score: 0,
      cutoff_format_score: 10000,
      min_upgrade_format_score: 1,
      language: null,
      items: [],
      format_items: [
        {
          name: 'Web Tier 01',
          score: null,
          custom_format_trash_id: webCfTrashId,
        },
      ],
    };

    const unrelatedGroupEntity = {
      entity_type: 'custom_format_group',
      arr_type: 'radarr',
      trash_id: '55555555555555555555555555555555',
      file_path: '/trash/cf-groups/unrelated.json',
      name: '[HDR Formats] Unrelated',
      description: null,
      default: false,
      custom_formats: [
        {
          name: 'HDR',
          trash_id: hdrCfTrashId,
          required: true,
        },
      ],
      quality_profiles: {
        include: {
          'Some Other Profile': '99999999999999999999999999999999',
        },
      },
    };

    const webCustomFormatCacheRow = {
      id: 21,
      sourceId,
      trashId: webCfTrashId,
      entityType: 'custom_format',
      name: webCustomFormatEntity.name,
      jsonData: JSON.stringify(webCustomFormatEntity),
      filePath: webCustomFormatEntity.file_path,
      contentHash: 'hash-cf-web',
      fetchedAt: nowIso,
    };

    const hdrCustomFormatCacheRow = {
      id: 22,
      sourceId,
      trashId: hdrCfTrashId,
      entityType: 'custom_format',
      name: hdrCustomFormatEntity.name,
      jsonData: JSON.stringify(hdrCustomFormatEntity),
      filePath: hdrCustomFormatEntity.file_path,
      contentHash: 'hash-cf-hdr',
      fetchedAt: nowIso,
    };

    const qualityProfileCacheRow = {
      id: 23,
      sourceId,
      trashId: qualityProfileTrashId,
      entityType: 'quality_profile',
      name: qualityProfileEntity.name,
      jsonData: JSON.stringify(qualityProfileEntity),
      filePath: qualityProfileEntity.file_path,
      contentHash: 'hash-qp-remux-web-2160p',
      fetchedAt: nowIso,
    };

    const unrelatedGroupCacheRow = {
      id: 24,
      sourceId,
      trashId: unrelatedGroupEntity.trash_id,
      entityType: 'custom_format_group',
      name: unrelatedGroupEntity.name,
      jsonData: JSON.stringify(unrelatedGroupEntity),
      filePath: unrelatedGroupEntity.file_path,
      contentHash: 'hash-cf-group-unrelated',
      fetchedAt: nowIso,
    };

    trashGuideManager.listSources = (() => [
      {
        id: sourceId,
        name: 'TRaSH Fallback Test',
        arrType: 'radarr',
      },
    ]) as typeof trashGuideManager.listSources;

    trashGuideSourcesQueries.getById = ((requestedSourceId) => {
      if (requestedSourceId !== sourceId) {
        return undefined;
      }

      return {
        id: sourceId,
        name: 'TRaSH Fallback Test',
        repository_url: 'https://example.com/trash-guides.git',
        branch: 'master',
        local_path: tempTrashClone,
        arr_type: 'radarr',
        score_profile: 'default',
        sync_strategy: 0,
        auto_pull: 0,
        enabled: 1,
        last_synced_at: nowIso,
        last_commit_hash: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
    }) as typeof trashGuideSourcesQueries.getById;

    trashGuideEntityCacheQueries.getBySourceAndType = ((requestedSourceId, entityType) => {
      if (requestedSourceId !== sourceId) {
        return [];
      }

      if (entityType === 'custom_format') {
        return [hdrCustomFormatCacheRow, webCustomFormatCacheRow];
      }

      if (entityType === 'quality_profile') {
        return [qualityProfileCacheRow];
      }

      if (entityType === 'custom_format_group') {
        // Keep cached groups non-empty, but exclude the target profile from include coverage.
        return [unrelatedGroupCacheRow];
      }

      return [];
    }) as typeof trashGuideEntityCacheQueries.getBySourceAndType;

    trashIdMappingsQueries.getBySource = (() => []) as typeof trashIdMappingsQueries.getBySource;

    const databaseId = 6008;
    const restore = installParserCacheStubs();
    restore.reset();
    parserClientModule.clearParserVersionCache();
    parserParserState.setHealthAvailable(true);
    parserParserState.setVersion('local-parser-v6');

    const fixture = createPcdCacheFixture(`
      INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
      VALUES (1, 'PCD Profile', 0, 0, 1);

      INSERT INTO custom_formats (name)
      VALUES ('PCD Bonus');

      INSERT INTO regular_expressions (name, pattern)
      VALUES ('pcd-bonus-regex', 'BONUS');

      INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
      VALUES ('PCD Bonus', 'pcd-bonus-title', 'release_title', 'all');

      INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
      VALUES ('PCD Bonus', 'pcd-bonus-title', 'pcd-bonus-regex');

      INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
      VALUES ('PCD Profile', 'PCD Bonus', 'radarr', 7);
    `);

    setCache(databaseId, fixture.cache);

    const title = 'Movie.BONUS.WEB.HDR';
    parserParserState.setParseResponse(title, {
      ...BASE_PARSE_RESPONSE,
      title,
      type: 'movie',
    });
    parserParserState.setMatchResponse(title, {
      BONUS: true,
      WEB: true,
      '\\b(HDR)\\b': true,
    });

    try {
      const response = await scoreRouteModule.POST(
        buildEvent({
          databaseId,
          arrType: 'radarr',
          profileNames: ['pcd:PCD Profile', `trash:${sourceId}:Remux%20%2B%20WEB%202160p`],
          releases: [
            {
              id: 'release-fallback',
              title,
              type: 'movie',
            },
          ],
        })
      );

      const body = (await response.json()) as SimulatedScoreResponse;
      assertEquals(response.status, 200);
      assertEquals(body.parserAvailable, true);
      assertEquals(body.results.length, 1);

      const release = body.results[0];
      const pcdScore = release.profileScores.find((score) => score.profileName === 'pcd:PCD Profile');
      const trashScore = release.profileScores.find(
        (score) => score.profileName === `trash:${sourceId}:Remux%20%2B%20WEB%202160p`
      );

      assertEquals(pcdScore?.totalScore, 7);
      assertEquals(pcdScore?.contributions, [{ cfName: 'PCD Bonus', score: 7 }]);

      assertEquals(trashScore?.totalScore, 110);
      assertEquals(trashScore?.contributions, [
        { cfName: 'HDR', score: 100 },
        { cfName: 'Web Tier 01', score: 10 },
      ]);
      // Legacy top-level cfMatches remain scoped to the first selected profile (PCD here).
      assertEquals(release.cfMatches.find((row) => row.name === 'PCD Bonus')?.matches, true);
      assertEquals(release.cfMatches.some((row) => row.name === 'HDR'), false);
      assertEquals(release.cfMatches.some((row) => row.name === 'Web Tier 01'), false);
    } finally {
      trashGuideManager.listSources = originalListSources;
      trashGuideEntityCacheQueries.getBySourceAndType = originalGetBySourceAndType;
      trashGuideSourcesQueries.getById = originalGetSourceById;
      trashIdMappingsQueries.getBySource = originalGetMappingsBySource;
      deleteCache(databaseId);
      await fixture.destroy();
      parserParserState.clearResponses();
      parserParserState.setVersion('local-parser-v1');
      restore.restore();
    }
  } finally {
    await Deno.remove(tempTrashClone, { recursive: true });
  }
});

Deno.test('simulate score: TRaSH label-based numeric specs evaluate language and negated source correctly', async () => {
  const sourceId = 9102;
  const languageCfTrashId = 'cccccccccccccccccccccccccccccccc';
  const negatedSourceCfTrashId = 'dddddddddddddddddddddddddddddddd';
  const qualityProfileTrashId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const nowIso = new Date().toISOString();

  const originalListSources = trashGuideManager.listSources;
  const originalGetBySourceAndType = trashGuideEntityCacheQueries.getBySourceAndType;
  const originalGetMappingsBySource = trashIdMappingsQueries.getBySource;

  const languageCustomFormatEntity = {
    trash_id: languageCfTrashId,
    arr_type: 'radarr',
    entity_type: 'custom_format',
    file_path: '/trash/custom-format-language-original.json',
    name: 'TRaSH Language Original',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 20,
    },
    specifications: [
      {
        name: 'language-original-title',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: 'BONUS',
        },
      },
      {
        name: 'Original Language',
        implementation: 'LanguageSpecification',
        negate: false,
        required: true,
        fields: {
          value: -2,
        },
      },
    ],
  };

  const negatedSourceCustomFormatEntity = {
    trash_id: negatedSourceCfTrashId,
    arr_type: 'radarr',
    entity_type: 'custom_format',
    file_path: '/trash/custom-format-not-webdl.json',
    name: 'TRaSH Not WEBDL',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 15,
    },
    specifications: [
      {
        name: 'source-not-webdl-title',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: 'BONUS',
        },
      },
      {
        name: 'Not WEBDL',
        implementation: 'SourceSpecification',
        negate: true,
        required: true,
        fields: {
          value: 7,
        },
      },
    ],
  };

  const qualityProfileEntity = {
    trash_id: qualityProfileTrashId,
    arr_type: 'radarr',
    entity_type: 'quality_profile',
    file_path: '/trash/quality-profile-language-source.json',
    name: 'TRaSH Label Profile',
    description: null,
    source_url: null,
    score_set: null,
    group: null,
    upgrade_allowed: true,
    cutoff: 'WEBDL-1080p',
    min_format_score: 0,
    cutoff_format_score: 0,
    min_upgrade_format_score: 0,
    language: null,
    items: [],
    format_items: [
      {
        name: 'TRaSH Language Original',
        score: null,
        custom_format_trash_id: languageCfTrashId,
      },
      {
        name: 'TRaSH Not WEBDL',
        score: null,
        custom_format_trash_id: negatedSourceCfTrashId,
      },
    ],
  };

  const languageCustomFormatCacheRow = {
    id: 11,
    sourceId,
    trashId: languageCfTrashId,
    entityType: 'custom_format',
    name: languageCustomFormatEntity.name,
    jsonData: JSON.stringify(languageCustomFormatEntity),
    filePath: languageCustomFormatEntity.file_path,
    contentHash: 'hash-cf-language',
    fetchedAt: nowIso,
  };

  const negatedSourceCustomFormatCacheRow = {
    id: 12,
    sourceId,
    trashId: negatedSourceCfTrashId,
    entityType: 'custom_format',
    name: negatedSourceCustomFormatEntity.name,
    jsonData: JSON.stringify(negatedSourceCustomFormatEntity),
    filePath: negatedSourceCustomFormatEntity.file_path,
    contentHash: 'hash-cf-source',
    fetchedAt: nowIso,
  };

  const qualityProfileCacheRow = {
    id: 13,
    sourceId,
    trashId: qualityProfileTrashId,
    entityType: 'quality_profile',
    name: qualityProfileEntity.name,
    jsonData: JSON.stringify(qualityProfileEntity),
    filePath: qualityProfileEntity.file_path,
    contentHash: 'hash-qp-labels',
    fetchedAt: nowIso,
  };

  trashGuideManager.listSources = (() => [
    {
      id: sourceId,
      name: 'TRaSH Label Test',
      arrType: 'radarr',
    },
  ]) as typeof trashGuideManager.listSources;

  trashGuideEntityCacheQueries.getBySourceAndType = ((requestedSourceId, entityType) => {
    if (requestedSourceId !== sourceId) {
      return [];
    }

    if (entityType === 'custom_format') {
      return [languageCustomFormatCacheRow, negatedSourceCustomFormatCacheRow];
    }

    if (entityType === 'quality_profile') {
      return [qualityProfileCacheRow];
    }

    return [];
  }) as typeof trashGuideEntityCacheQueries.getBySourceAndType;

  trashIdMappingsQueries.getBySource = (() => []) as typeof trashIdMappingsQueries.getBySource;

  const databaseId = 6007;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v5');

  const fixture = createPcdCacheFixture('');

  setCache(databaseId, fixture.cache);

  parserParserState.setParseResponse('Movie.BONUS', {
    ...BASE_PARSE_RESPONSE,
    title: 'Movie.BONUS',
    type: 'movie',
    source: 'WebDL',
    languages: ['Original'],
  });
  parserParserState.setMatchResponse('Movie.BONUS', {
    BONUS: true,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: [`trash:${sourceId}:TRaSH%20Label%20Profile`],
        releases: [
          {
            id: 'release-labels',
            title: 'Movie.BONUS',
            type: 'movie',
          },
        ],
      })
    );

    const body = (await response.json()) as SimulatedScoreResponse;
    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 1);

    const release = body.results[0];
    const trashScore = release.profileScores.find(
      (score) => score.profileName === `trash:${sourceId}:TRaSH%20Label%20Profile`
    );

    assertEquals(trashScore?.totalScore, 20);
    assertEquals(trashScore?.contributions, [{ cfName: 'TRaSH Language Original', score: 20 }]);
    assertEquals(release.cfMatches.find((row) => row.name === 'TRaSH Language Original')?.matches, true);
    assertEquals(release.cfMatches.find((row) => row.name === 'TRaSH Not WEBDL')?.matches, false);
  } finally {
    trashGuideManager.listSources = originalListSources;
    trashGuideEntityCacheQueries.getBySourceAndType = originalGetBySourceAndType;
    trashIdMappingsQueries.getBySource = originalGetMappingsBySource;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});

Deno.test('simulate score: sonarr anime TRaSH profiles require both source and group-style title matches', async () => {
  const sourceId = 9104;
  const animeWebTier05TrashId = 'f1111111111111111111111111111111';
  const animeWebTier01TrashId = 'f2222222222222222222222222222222';
  const animeV2TrashId = 'f3333333333333333333333333333333';
  const repackBonusTrashId = 'f4444444444444444444444444444444';
  const animeProfileTrashId = 'f5555555555555555555555555555555';
  const webProfileTrashId = 'f6666666666666666666666666666666';
  const nowIso = new Date().toISOString();

  const originalListSources = trashGuideManager.listSources;
  const originalGetBySourceAndType = trashGuideEntityCacheQueries.getBySourceAndType;
  const originalGetMappingsBySource = trashIdMappingsQueries.getBySource;

  const animeWebTier05Entity = {
    trash_id: animeWebTier05TrashId,
    arr_type: 'sonarr',
    entity_type: 'custom_format',
    file_path: '/trash/sonarr/custom-format-anime-web-tier-05.json',
    name: 'Anime Web Tier 05',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 200,
      'anime-sonarr': 200,
    },
    specifications: [
      {
        name: 'WEBDL',
        implementation: 'SourceSpecification',
        negate: false,
        required: false,
        fields: {
          value: 3,
        },
      },
      {
        name: 'WEBRIP',
        implementation: 'SourceSpecification',
        negate: false,
        required: false,
        fields: {
          value: 4,
        },
      },
      {
        name: 'WEB',
        implementation: 'SourceSpecification',
        negate: false,
        required: false,
        fields: {
          value: 1,
        },
      },
      {
        name: 'SubsPlease',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: false,
        fields: {
          value: '\\b(SubsPlease)\\b',
        },
      },
    ],
  };

  const animeWebTier01Entity = {
    trash_id: animeWebTier01TrashId,
    arr_type: 'sonarr',
    entity_type: 'custom_format',
    file_path: '/trash/sonarr/custom-format-anime-web-tier-01.json',
    name: 'Anime Web Tier 01',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 600,
      'anime-sonarr': 600,
    },
    specifications: [
      {
        name: 'WEBDL',
        implementation: 'SourceSpecification',
        negate: false,
        required: false,
        fields: {
          value: 3,
        },
      },
      {
        name: 'WEBRIP',
        implementation: 'SourceSpecification',
        negate: false,
        required: false,
        fields: {
          value: 4,
        },
      },
      {
        name: 'Arg0',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: false,
        fields: {
          value: '\\b(Arg0)\\b',
        },
      },
    ],
  };

  const animeV2Entity = {
    trash_id: animeV2TrashId,
    arr_type: 'sonarr',
    entity_type: 'custom_format',
    file_path: '/trash/sonarr/custom-format-anime-v2.json',
    name: 'v2',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 1,
    },
    specifications: [
      {
        name: 'v2',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: '(\\b|\\d)(v2)\\b',
        },
      },
    ],
  };

  const repackBonusEntity = {
    trash_id: repackBonusTrashId,
    arr_type: 'sonarr',
    entity_type: 'custom_format',
    file_path: '/trash/sonarr/custom-format-repack-bonus.json',
    name: 'Repack Proper',
    description: null,
    regex_url: null,
    include_in_rename: false,
    scores: {
      default: 5,
    },
    specifications: [
      {
        name: 'repack-proper',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: false,
        fields: {
          value: '\\b(PROPER|REPACK)\\b',
        },
      },
    ],
  };

  const animeProfileEntity = {
    trash_id: animeProfileTrashId,
    arr_type: 'sonarr',
    entity_type: 'quality_profile',
    file_path: '/trash/sonarr/quality-profile-anime-remux-1080p.json',
    name: '[Anime] Remux-1080p',
    description: null,
    source_url: null,
    score_set: 'anime-sonarr',
    group: null,
    upgrade_allowed: true,
    cutoff: 'Bluray-1080p',
    min_format_score: 0,
    cutoff_format_score: 0,
    min_upgrade_format_score: 0,
    language: null,
    items: [],
    format_items: [
      {
        name: 'Anime Web Tier 01',
        score: null,
        custom_format_trash_id: animeWebTier01TrashId,
      },
      {
        name: 'Anime Web Tier 05',
        score: null,
        custom_format_trash_id: animeWebTier05TrashId,
      },
      {
        name: 'v2',
        score: null,
        custom_format_trash_id: animeV2TrashId,
      },
    ],
  };

  const webAlternativeProfileEntity = {
    trash_id: webProfileTrashId,
    arr_type: 'sonarr',
    entity_type: 'quality_profile',
    file_path: '/trash/sonarr/quality-profile-web-1080p-alt.json',
    name: 'WEB-1080p (Alternative)',
    description: null,
    source_url: null,
    score_set: null,
    group: null,
    upgrade_allowed: true,
    cutoff: 'WEBDL-1080p',
    min_format_score: 0,
    cutoff_format_score: 0,
    min_upgrade_format_score: 0,
    language: null,
    items: [],
    format_items: [
      {
        name: 'Repack Proper',
        score: null,
        custom_format_trash_id: repackBonusTrashId,
      },
    ],
  };

  const animeWebTier05CacheRow = {
    id: 31,
    sourceId,
    trashId: animeWebTier05TrashId,
    entityType: 'custom_format',
    name: animeWebTier05Entity.name,
    jsonData: JSON.stringify(animeWebTier05Entity),
    filePath: animeWebTier05Entity.file_path,
    contentHash: 'hash-cf-anime-web-tier-05',
    fetchedAt: nowIso,
  };

  const animeWebTier01CacheRow = {
    id: 32,
    sourceId,
    trashId: animeWebTier01TrashId,
    entityType: 'custom_format',
    name: animeWebTier01Entity.name,
    jsonData: JSON.stringify(animeWebTier01Entity),
    filePath: animeWebTier01Entity.file_path,
    contentHash: 'hash-cf-anime-web-tier-01',
    fetchedAt: nowIso,
  };

  const animeV2CacheRow = {
    id: 33,
    sourceId,
    trashId: animeV2TrashId,
    entityType: 'custom_format',
    name: animeV2Entity.name,
    jsonData: JSON.stringify(animeV2Entity),
    filePath: animeV2Entity.file_path,
    contentHash: 'hash-cf-anime-v2',
    fetchedAt: nowIso,
  };

  const repackBonusCacheRow = {
    id: 34,
    sourceId,
    trashId: repackBonusTrashId,
    entityType: 'custom_format',
    name: repackBonusEntity.name,
    jsonData: JSON.stringify(repackBonusEntity),
    filePath: repackBonusEntity.file_path,
    contentHash: 'hash-cf-repack-bonus',
    fetchedAt: nowIso,
  };

  const animeProfileCacheRow = {
    id: 35,
    sourceId,
    trashId: animeProfileTrashId,
    entityType: 'quality_profile',
    name: animeProfileEntity.name,
    jsonData: JSON.stringify(animeProfileEntity),
    filePath: animeProfileEntity.file_path,
    contentHash: 'hash-qp-anime-remux-1080p',
    fetchedAt: nowIso,
  };

  const webAlternativeProfileCacheRow = {
    id: 36,
    sourceId,
    trashId: webProfileTrashId,
    entityType: 'quality_profile',
    name: webAlternativeProfileEntity.name,
    jsonData: JSON.stringify(webAlternativeProfileEntity),
    filePath: webAlternativeProfileEntity.file_path,
    contentHash: 'hash-qp-web-1080p-alt',
    fetchedAt: nowIso,
  };

  trashGuideManager.listSources = (() => [
    {
      id: sourceId,
      name: 'TRaSH Anime Test',
      arrType: 'sonarr',
    },
  ]) as typeof trashGuideManager.listSources;

  trashGuideEntityCacheQueries.getBySourceAndType = ((requestedSourceId, entityType) => {
    if (requestedSourceId !== sourceId) {
      return [];
    }

    if (entityType === 'custom_format') {
      return [animeWebTier05CacheRow, animeWebTier01CacheRow, animeV2CacheRow, repackBonusCacheRow];
    }

    if (entityType === 'quality_profile') {
      return [animeProfileCacheRow, webAlternativeProfileCacheRow];
    }

    return [];
  }) as typeof trashGuideEntityCacheQueries.getBySourceAndType;

  trashIdMappingsQueries.getBySource = (() => []) as typeof trashIdMappingsQueries.getBySource;

  const databaseId = 6009;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion('local-parser-v7');

  const fixture = createPcdCacheFixture('');
  setCache(databaseId, fixture.cache);

  const sceneTitle = '[Scene] Frieren - Beyond Journeys End - 01 PROPER REPACK REAL PROPER 1080p x264.mkv';
  const subsPleaseTitle = '[SubsPlease] Frieren - Beyond Journeys End - 01 (1080p) [A1B2C3D4].mkv';
  const anonTitle = '[Anon] Frieren - Beyond Journeys End - 01 WEB-DL HDTVRip BluRay AAC.mkv';
  const driveTitle = 'Drive.to.Survive.S06E01.1080p.NF.WEB-DL.DDP5.1.H.264-FLUX';
  const subsPleaseWebTitle = '[SubsPlease] Frieren - Beyond Journeys End - 01 [WEB] (1080p) [A1B2C3D4].mkv';

  parserParserState.setParseResponse(sceneTitle, {
    ...BASE_PARSE_RESPONSE,
    title: sceneTitle,
    type: 'series',
    releaseGroup: 'Scene',
    resolution: 1080,
    source: 'Unknown',
    revision: {
      version: 2,
      real: 1,
      isRepack: true,
    },
  });

  parserParserState.setParseResponse(subsPleaseTitle, {
    ...BASE_PARSE_RESPONSE,
    title: subsPleaseTitle,
    type: 'series',
    releaseGroup: 'SubsPlease',
    resolution: 1080,
    source: 'Unknown',
  });

  parserParserState.setParseResponse(anonTitle, {
    ...BASE_PARSE_RESPONSE,
    title: anonTitle,
    type: 'series',
    releaseGroup: 'Anon',
    resolution: 480,
    source: 'WebDL',
  });

  parserParserState.setParseResponse(driveTitle, {
    ...BASE_PARSE_RESPONSE,
    title: driveTitle,
    type: 'series',
    releaseGroup: 'FLUX',
    resolution: 1080,
    source: 'WebDL',
  });

  parserParserState.setParseResponse(subsPleaseWebTitle, {
    ...BASE_PARSE_RESPONSE,
    title: subsPleaseWebTitle,
    type: 'series',
    releaseGroup: 'SubsPlease',
    resolution: 1080,
    source: 'WebDL',
  });

  parserParserState.setMatchResponse(sceneTitle, {
    '\\b(PROPER|REPACK)\\b': true,
    '\\b(SubsPlease)\\b': false,
    '\\b(Arg0)\\b': false,
    '(\\b|\\d)(v2)\\b': false,
  });
  parserParserState.setMatchResponse(subsPleaseTitle, {
    '\\b(PROPER|REPACK)\\b': false,
    '\\b(SubsPlease)\\b': true,
    '\\b(Arg0)\\b': false,
    '(\\b|\\d)(v2)\\b': false,
  });
  parserParserState.setMatchResponse(anonTitle, {
    '\\b(PROPER|REPACK)\\b': false,
    '\\b(SubsPlease)\\b': false,
    '\\b(Arg0)\\b': false,
    '(\\b|\\d)(v2)\\b': false,
  });
  parserParserState.setMatchResponse(driveTitle, {
    '\\b(PROPER|REPACK)\\b': false,
    '\\b(SubsPlease)\\b': false,
    '\\b(Arg0)\\b': false,
    '(\\b|\\d)(v2)\\b': false,
  });
  parserParserState.setMatchResponse(subsPleaseWebTitle, {
    '\\b(PROPER|REPACK)\\b': false,
    '\\b(SubsPlease)\\b': true,
    '\\b(Arg0)\\b': false,
    '(\\b|\\d)(v2)\\b': false,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'sonarr',
        profileNames: [
          `trash:${sourceId}:%5BAnime%5D%20Remux-1080p`,
          `trash:${sourceId}:WEB-1080p%20(Alternative)`,
        ],
        releases: [
          { id: 'release-scene', title: sceneTitle, type: 'series' },
          { id: 'release-subsplease', title: subsPleaseTitle, type: 'series' },
          { id: 'release-anon', title: anonTitle, type: 'series' },
          { id: 'release-drive', title: driveTitle, type: 'series' },
          { id: 'release-subsplease-web', title: subsPleaseWebTitle, type: 'series' },
        ],
      })
    );

    const body = (await response.json()) as SimulatedScoreResponse;
    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 5);

    const animeProfileKey = `trash:${sourceId}:%5BAnime%5D%20Remux-1080p`;
    const webProfileKey = `trash:${sourceId}:WEB-1080p%20(Alternative)`;

    const sceneRelease = body.results.find((result) => result.id === 'release-scene');
    assertEquals(sceneRelease?.parsed.source, 'unknown');
    assertEquals(
      sceneRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.totalScore,
      0
    );
    assertEquals(
      sceneRelease?.profileScores.find((score) => score.profileName === webProfileKey)?.totalScore,
      5
    );
    assertEquals(
      sceneRelease?.profileScores.find((score) => score.profileName === webProfileKey)?.contributions,
      [{ cfName: 'Repack Proper', score: 5 }]
    );

    const subsPleaseRelease = body.results.find((result) => result.id === 'release-subsplease');
    assertEquals(subsPleaseRelease?.parsed.source, 'unknown');
    assertEquals(
      subsPleaseRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.totalScore,
      0
    );

    const anonRelease = body.results.find((result) => result.id === 'release-anon');
    assertEquals(anonRelease?.parsed.source, 'webdl');
    assertEquals(
      anonRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.totalScore,
      0
    );

    const driveRelease = body.results.find((result) => result.id === 'release-drive');
    assertEquals(driveRelease?.parsed.source, 'webdl');
    assertEquals(
      driveRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.totalScore,
      0
    );

    const subsPleaseWebRelease = body.results.find((result) => result.id === 'release-subsplease-web');
    assertEquals(subsPleaseWebRelease?.parsed.source, 'webdl');
    assertEquals(
      subsPleaseWebRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.totalScore,
      200
    );
    assertEquals(
      subsPleaseWebRelease?.profileScores.find((score) => score.profileName === animeProfileKey)?.contributions,
      [{ cfName: 'Anime Web Tier 05', score: 200 }]
    );
  } finally {
    trashGuideManager.listSources = originalListSources;
    trashGuideEntityCacheQueries.getBySourceAndType = originalGetBySourceAndType;
    trashIdMappingsQueries.getBySource = originalGetMappingsBySource;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion('local-parser-v1');
    restore.restore();
  }
});
