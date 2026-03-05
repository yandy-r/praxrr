/// <reference path="../../app.d.ts" />

import { assertEquals, assertRejects } from "@std/assert";
import { Database } from "@jsr/db__sqlite";
import { Kysely } from "kysely";
import { DenoSqlite3Dialect } from "@soapbox/kysely-deno-sqlite";

import type { PCDCache } from "$pcd/index.ts";
import type { PCDDatabase } from "$shared/pcd/types.ts";

Deno.env.set("PARSER_HOST", "127.0.0.1");

const PCD_SCHEMA_SQL_PATH = new URL(
  "../../../../praxrr-schema/ops/0.schema.sql",
  import.meta.url,
);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);
const PARSER_PORT = 57129;
Deno.env.set("PARSER_PORT", PARSER_PORT.toString());
const { deleteCache, setCache } = await import("$pcd/database/registry.ts");
const { parsedReleaseCacheQueries } = await import(
  "$db/queries/parsedReleaseCache.ts"
);
const { patternMatchCacheQueries } = await import(
  "$db/queries/patternMatchCache.ts"
);
const { trashGuideManager } = await import("$lib/server/trashguide/manager.ts");

const scoreRouteModule = await import(
  "../../routes/api/v1/simulate/score/+server.ts"
);
const parserClientModule = await import(
  "$lib/server/utils/arr/parser/client.ts"
);
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
  type: "movie" | "series";
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
  type: "movie" | "series";
}

interface ScoreRequest {
  databaseId: number;
  releases: ParsedResultRequest[];
  profileNames: string[];
  arrType: "radarr" | "sonarr";
}

type ScoreRequestInput = Omit<ScoreRequest, "arrType"> & { arrType: string };

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

const BASE_PARSE_RESPONSE: Omit<ParseStubResponse, "title" | "type"> = {
  source: "Unknown",
  resolution: 1080,
  modifier: "None",
  revision: {
    version: 1,
    real: 1,
    isRepack: false,
  },
  languages: ["Unknown"],
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
  if (typeof typedError?.status !== "number") {
    throw new Error("Expected error object with status number");
  }

  return typedError.status;
}

function buildEvent(
  payload: ScoreRequest | ScoreRequestInput,
): Parameters<typeof scoreRouteModule.POST>[0] {
  return {
    request: new Request("http://localhost/api/v1/simulate/score", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  } as Parameters<typeof scoreRouteModule.POST>[0];
}

function buildRawEvent(
  rawBody: string,
): Parameters<typeof scoreRouteModule.POST>[0] {
  return {
    request: new Request("http://localhost/api/v1/simulate/score", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: rawBody,
    }),
  } as Parameters<typeof scoreRouteModule.POST>[0];
}

function createPcdCacheFixture(seedSql: string): InMemoryResponseCacheFixture {
  const sqlite = new Database(":memory:", { int64: true });
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
    if (typeof result !== "string") {
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
      if (typeof value === "string") {
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
  let version = "local-parser-v1";

  const response = (data: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(data), {
      status: init?.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(init?.headers as Record<string, string>),
      },
    });

  const server = Deno.serve({
    port,
    onListen() {},
    handler: async (request) => {
      if (!healthAvailable) {
        return new Response("unavailable", { status: 500 });
      }

      const url = new URL(request.url);
      const payloadText = await request.text();
      const payload = payloadText.length > 0 ? JSON.parse(payloadText) : {};

      if (url.pathname === "/health") {
        return response({
          status: "ok",
          version,
        });
      }

      if (url.pathname === "/parse") {
        const title = payload.title as string;
        const responsePayload = parseResponses.get(title);
        if (!responsePayload) {
          return response(
            { error: `No parse response for ${title}` },
            {
              status: 404,
            },
          );
        }
        return response(responsePayload);
      }

      if (url.pathname === "/match/batch") {
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

      return new Response("not found", { status: 404 });
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

Deno.test("simulate score: returns unavailable when parser is down", async () => {
  const restore = installParserCacheStubs();
  parserParserState.setHealthAvailable(false);
  parserClientModule.clearParserVersionCache();
  restore.reset();

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId: 6001,
        arrType: "radarr",
        profileNames: ["pcd:Primary"],
        releases: [
          {
            id: "release-unavailable",
            title: "Unavailable Parser Title",
            type: "movie",
          },
        ],
      }),
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

Deno.test("simulate score: validates request limits", async (t) => {
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();

  const basePayload: ScoreRequest = {
    databaseId: 6002,
    arrType: "radarr",
    profileNames: ["pcd:Primary"],
    releases: [
      {
        id: "release-base",
        title: "Some Title",
        type: "movie",
      },
    ],
  };

  await t.step("rejects invalid arrType", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          arrType: "wrong",
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects empty profileNames", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: [],
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects profileNames over max", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: Array.from(
            { length: 11 },
            (_, i) => `pcd:Profile-${i}`,
          ),
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects empty releases array", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          releases: [],
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects releases over max", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          releases: Array.from({ length: 51 }, (_, i) => ({
            id: `too-many-${i}`,
            title: `Movie ${i}`,
            type: "movie" as const,
          })),
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects malformed JSON body", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(buildRawEvent("{not valid json"))
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects non-number databaseId", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          databaseId: "abc" as unknown as number,
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step("rejects malformed trash selector", async () => {
    const error = await assertRejects(async () =>
      scoreRouteModule.POST(
        buildEvent({
          ...basePayload,
          profileNames: ["trash:abc:invalid"],
        }),
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  restore.restore();
});

Deno.test("simulate score: returns missing profiles as 404", async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources =
    (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6003;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion("local-parser-v1");

  const fixture = createPcdCacheFixture(`
    INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score)
    VALUES (1, 'Existing Profile', 5, 10);
  `);

  setCache(databaseId, fixture.cache);

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: "radarr",
        profileNames: ["pcd:Missing Profile"],
        releases: [
          {
            id: "release-missing",
            title: "Some Missing Match",
            type: "movie",
          },
        ],
      }),
    );
    const body = (await response.json()) as MissingProfileResponse;

    assertEquals(response.status, 404);
    assertEquals(body.error, "Quality profiles not found");
    assertEquals(body.missing, ["pcd:Missing Profile"]);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    restore.restore();
  }
});

Deno.test("simulate score: calculates correct scores with positive and negative CF rows", async () => {
  const originalListSources = trashGuideManager.listSources;
  trashGuideManager.listSources =
    (() => []) as typeof trashGuideManager.listSources;
  const databaseId = 6004;
  const restore = installParserCacheStubs();
  restore.reset();
  parserClientModule.clearParserVersionCache();
  parserParserState.setHealthAvailable(true);
  parserParserState.setVersion("local-parser-v2");

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
      id: "release-one",
      title: "Movie.HDR.BONUS",
      type: "movie" as const,
    },
    {
      id: "release-two",
      title: "Movie.CAM",
      type: "movie" as const,
    },
  ];

  const commonParse = {
    ...BASE_PARSE_RESPONSE,
    type: "movie" as const,
  };
  parserParserState.setParseResponse("Movie.HDR.BONUS", {
    ...commonParse,
    title: "Movie.HDR.BONUS",
  });
  parserParserState.setParseResponse("Movie.CAM", {
    ...commonParse,
    title: "Movie.CAM",
  });

  parserParserState.setMatchResponse("Movie.HDR.BONUS", {
    HDR: true,
    BONUS: true,
    CAM: false,
  });
  parserParserState.setMatchResponse("Movie.CAM", {
    HDR: false,
    BONUS: false,
    CAM: true,
  });

  try {
    const response = await scoreRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: "radarr",
        profileNames: ["pcd:Primary Profile"],
        releases,
      }),
    );
    const body = (await response.json()) as SimulatedScoreResponse;

    assertEquals(response.status, 200);
    assertEquals(body.parserAvailable, true);
    assertEquals(body.results.length, 2);

    const [first, second] = body.results;
    assertEquals(first.title, "Movie.HDR.BONUS");
    assertEquals(first.profileScores[0].minimumScore, 11);
    assertEquals(first.profileScores[0].upgradeUntilScore, 22);
    assertEquals(first.profileScores[0].totalScore, 23);
    assertEquals(first.profileScores[0].contributions, [
      { cfName: "CF-Bonus", score: 9 },
      { cfName: "CF-Primary", score: 14 },
    ]);

    assertEquals(second.title, "Movie.CAM");
    assertEquals(second.profileScores[0].totalScore, -2);
    assertEquals(second.profileScores[0].contributions, [
      {
        cfName: "CF-Negative",
        score: -2,
      },
    ]);
  } finally {
    trashGuideManager.listSources = originalListSources;
    deleteCache(databaseId);
    await fixture.destroy();
    parserParserState.clearResponses();
    parserParserState.setVersion("local-parser-v1");
    restore.restore();
  }
});
