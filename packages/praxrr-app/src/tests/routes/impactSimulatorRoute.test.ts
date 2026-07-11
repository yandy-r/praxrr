// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

/**
 * Route tests for POST /api/v1/simulate/impact.
 *
 * Harness mirrors simulateScoreRoute.test.ts (live Deno.serve parser stub + parser
 * cache stubs) and resolvedConfigApi.test.ts (real ephemeral PCDCache via a
 * `PCDCache.prototype.buildReadOnly` patch). The registered "current" cache and the
 * sandbox are seeded from the SAME SQL so a proposed edit is the only difference.
 *
 * PARSER_PORT is 57130 (the score route test squats 57129 at module top-level; both
 * stubs are alive simultaneously in a full-suite run, so distinct ports avoid EADDRINUSE).
 * Because `deno test` gives each test file its own module graph, this file's `config`
 * singleton reads 57130 independently.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';

import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { components } from '$api/v1.d.ts';

Deno.env.set('PARSER_HOST', '127.0.0.1');
const PARSER_PORT = 57130;
Deno.env.set('PARSER_PORT', PARSER_PORT.toString());

type SimulateImpactResponse = components['schemas']['SimulateImpactResponse'];
type ProposedChange = components['schemas']['ProposedChange'];

const PCD_SCHEMA_SQL_PATH = new URL('../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

// --- dynamic imports (after env is set, so this file's config sees PARSER_PORT=57130) ---
const impactRouteModule = await import('../../routes/api/v1/simulate/impact/+server.ts');
const parserClientModule = await import('$lib/server/utils/arr/parser/client.ts');
const { setCache, deleteCache } = await import('$pcd/database/registry.ts');
const { databaseInstancesQueries } = await import('$db/queries/databaseInstances.ts');
const { parsedReleaseCacheQueries } = await import('$db/queries/parsedReleaseCache.ts');
const { patternMatchCacheQueries } = await import('$db/queries/patternMatchCache.ts');
// Value import needed to patch the prototype (mirrors resolvedConfigApi.test.ts).
const { PCDCache: PCDCacheClass } = await import('$pcd/index.ts');

// ============================================================================
// PARSER STUB (copied from simulateScoreRoute.test.ts)
// ============================================================================

interface ParseStubResponse {
  title: string;
  type: 'movie' | 'series';
  source: string;
  resolution: number;
  modifier: string;
  revision: { version: number; real: number; isRepack: boolean };
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

interface RestoreFunction {
  restore: () => void;
  reset: () => void;
}

const BASE_PARSE_RESPONSE: Omit<ParseStubResponse, 'title' | 'type'> = {
  source: 'Unknown',
  resolution: 1080,
  modifier: 'None',
  revision: { version: 1, real: 1, isRepack: false },
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
        return response({ status: 'ok', version });
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

interface BuiltGoParser {
  binaryPath: string;
  cleanup: () => Promise<void>;
}

async function buildGoParser(version: string): Promise<BuiltGoParser> {
  const directory = await Deno.makeTempDir({ prefix: 'praxrr-parser-impact-' });
  const binaryPath = `${directory}/praxrr-parser`;
  const output = await new Deno.Command('go', {
    cwd: new URL('../../../../praxrr-parser/', import.meta.url),
    args: ['build', '-ldflags', `-X main.version=${version}`, '-o', binaryPath, './cmd/praxrr-parser'],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
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
    if (typeof result !== 'string') return undefined;
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
      if (typeof value === 'string') results.set(title, value);
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

const parserState = await createParserStub(PARSER_PORT);

// ============================================================================
// FIXTURE (registered current cache + sandbox via prototype patch)
// ============================================================================

const DATABASE_ID = 731001;

// Primary/Boost has an explicit radarr score of 0 (the Q2 matched-but-zero case);
// Shared is referenced by Primary (radarr) AND Secondary (all) for cascade counts.
const SEED_SQL = `
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (1, 'Primary', 0, 100, 1);
  INSERT INTO quality_profiles (id, name, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
  VALUES (2, 'Secondary', 0, 100, 1);

  INSERT INTO custom_formats (name) VALUES ('Boost');
  INSERT INTO custom_formats (name) VALUES ('Shared');

  INSERT INTO regular_expressions (name, pattern) VALUES ('boost-re', 'BOOST');
  INSERT INTO regular_expressions (name, pattern) VALUES ('shared-re', 'SHARED');

  INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
  VALUES ('Boost', 'boost-title', 'release_title', 'all');
  INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type)
  VALUES ('Shared', 'shared-title', 'release_title', 'all');

  INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
  VALUES ('Boost', 'boost-title', 'boost-re');
  INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
  VALUES ('Shared', 'shared-title', 'shared-re');

  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'Boost', 'radarr', 0);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Primary', 'Shared', 'radarr', 5);
  INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
  VALUES ('Secondary', 'Shared', 'all', 5);
`;

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function buildInstance(): DatabaseInstance {
  return {
    id: DATABASE_ID,
    uuid: 'impact-route-test-uuid',
    name: 'Impact Route Test DB',
    repository_url: 'https://example.invalid/repo.git',
    local_path: '/tmp/impact-route-does-not-exist',
    sync_strategy: 0,
    auto_pull: 0,
    enabled: 1,
    personal_access_token: null,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };
}

interface CurrentFixture {
  cache: PCDCache;
  destroy: () => Promise<void>;
}

function createCurrentCache(): CurrentFixture {
  const sqlite = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({ database: sqlite }),
  });
  sqlite.exec(PCD_SCHEMA_SQL);
  sqlite.exec(SEED_SQL);
  return {
    cache: { kb, isBuilt: () => true } as unknown as PCDCache,
    destroy: async () => {
      await kb.destroy();
      sqlite.close();
    },
  };
}

interface ImpactRequestBody {
  databaseId: number;
  arrType: string;
  releases: Array<{ id: string; title: string; type: string }>;
  profileNames: string[];
  proposedChanges: unknown[];
}

function buildEvent(payload: ImpactRequestBody): Parameters<typeof impactRouteModule.POST>[0] {
  return {
    request: new Request('http://localhost/api/v1/simulate/impact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  } as Parameters<typeof impactRouteModule.POST>[0];
}

function buildRawEvent(rawBody: string): Parameters<typeof impactRouteModule.POST>[0] {
  return {
    request: new Request('http://localhost/api/v1/simulate/impact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    }),
  } as Parameters<typeof impactRouteModule.POST>[0];
}

function getErrorStatus(error: unknown): number {
  const typedError = error as { status?: number };
  if (typeof typedError?.status !== 'number') {
    throw new Error('Expected error object with status number');
  }
  return typedError.status;
}

/** Registers the current cache + patches instance lookup and buildReadOnly for the sandbox. */
async function withImpactFixture(fn: (databaseId: number) => Promise<void>): Promise<void> {
  const current = createCurrentCache();
  setCache(DATABASE_ID, current.cache);

  const restores: Restore[] = [];
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) => (id === DATABASE_ID ? buildInstance() : undefined)) as typeof databaseInstancesQueries.getById,
    restores
  );
  patchTarget(
    PCDCacheClass.prototype,
    'buildReadOnly',
    async function (this: PCDCache) {
      const self = this as unknown as {
        bootstrap(): void;
        db: Database | null;
        built: boolean;
      };
      self.bootstrap();
      self.db!.exec(PCD_SCHEMA_SQL);
      self.db!.exec(SEED_SQL);
      self.built = true;
    } as typeof PCDCacheClass.prototype.buildReadOnly,
    restores
  );

  const parserRestore = installParserCacheStubs();
  parserRestore.reset();
  parserClientModule.clearParserVersionCache();
  parserState.setHealthAvailable(true);
  parserState.setVersion('local-parser-v1');
  parserState.clearResponses();

  try {
    await fn(DATABASE_ID);
  } finally {
    parserState.clearResponses();
    parserState.setHealthAvailable(true);
    parserRestore.restore();
    parserClientModule.clearParserVersionCache();
    restores.reverse().forEach((restore) => restore());
    deleteCache(DATABASE_ID);
    await current.destroy();
  }
}

function seedMovie(title: string, matches: Record<string, boolean>): void {
  parserState.setParseResponse(title, {
    ...BASE_PARSE_RESPONSE,
    title,
    type: 'movie',
  });
  parserState.setMatchResponse(title, matches);
}

// ============================================================================
// HAPPY PATH + Q2 (matched-but-zero CF getting a score)
// ============================================================================

Deno.test('impact: happy 0->50 moves the proposed total and reports the changed CF', async () => {
  await withImpactFixture(async (databaseId) => {
    seedMovie('Movie.BOOST', { BOOST: true, SHARED: false });

    const change: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Primary',
      customFormatName: 'Boost',
      score: 50,
    };
    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [{ id: 'r1', title: 'Movie.BOOST', type: 'movie' }],
        proposedChanges: [change],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    assertEquals(body.parserAvailable, true);
    assertEquals(body.cascadeBasis, 'current');
    assertEquals(body.appliedChanges, [change]);
    assertEquals(body.skippedChanges, []);
    assertEquals(body.releaseImpacts.length, 1);

    const profile = body.releaseImpacts[0].profiles.find((p) => p.profileName === 'Primary');
    assert(profile);
    assertEquals(profile.currentTotal, 0);
    assertEquals(profile.proposedTotal, 50);
    assertEquals(profile.delta, 50);
    assertEquals(profile.editable, true);
    assertEquals(profile.currentState, 'accepted');
    assertEquals(profile.proposedState, 'accepted');

    // Q2: Boost matched at score 0, now 50 -> shows in changedCfs.
    assertEquals(profile.changedCfs.length, 1);
    const boost = profile.changedCfs[0];
    assertEquals(boost.cfName, 'Boost');
    assertEquals(boost.currentScore, 0);
    assertEquals(boost.proposedScore, 50);
    assertEquals(boost.delta, 50);

    // configDiff carries the one edited profile; cascade covers Boost (referenced by Primary only).
    assertEquals(body.configDiff.length, 1);
    assertEquals(body.configDiff[0].name, 'Primary');
    assertEquals(body.cascade.length, 1);
    assertEquals(body.cascade[0].name, 'Boost');
    assertEquals(body.cascade[0].counts.total, 1);
  });
});

// ============================================================================
// STATE TRANSITION (raise minimum above the release total -> 'below')
// ============================================================================

Deno.test('impact: raising minimum_custom_format_score above the total flips proposedState to below', async () => {
  await withImpactFixture(async (databaseId) => {
    seedMovie('Movie.BOOST', { BOOST: true, SHARED: false });

    const change: ProposedChange = {
      kind: 'set_profile_setting',
      profileName: 'Primary',
      field: 'minimum_custom_format_score',
      value: 500,
    };
    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [{ id: 'r1', title: 'Movie.BOOST', type: 'movie' }],
        proposedChanges: [change],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    const profile = body.releaseImpacts[0].profiles.find((p) => p.profileName === 'Primary');
    assert(profile);
    // Total is 0 (Boost scored 0); no CF score changed, so the delta is 0.
    assertEquals(profile.delta, 0);
    assertEquals(profile.changedCfs, []);
    assertEquals(profile.currentState, 'accepted');
    assertEquals(profile.proposedState, 'below');
    assertEquals(body.appliedChanges, [change]);
  });
});

// ============================================================================
// CONFIG DIFF (exactly the edited score; no false array-reorder) + CASCADE
// ============================================================================

Deno.test('impact: configDiff reports only the edited score and cascade counts every referencing profile', async () => {
  await withImpactFixture(async (databaseId) => {
    seedMovie('Movie.SHARED', { BOOST: false, SHARED: true });

    const change: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Primary',
      customFormatName: 'Shared',
      score: 30,
    };
    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [{ id: 'r1', title: 'Movie.SHARED', type: 'movie' }],
        proposedChanges: [change],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    // configDiff: exactly the Shared score changed 5 -> 30; no spurious added/removed entries.
    assertEquals(body.configDiff.length, 1);
    const diff = body.configDiff[0];
    assertEquals(diff.entityType, 'quality_profile');
    assertEquals(diff.name, 'Primary');
    assertEquals(diff.arrType, 'radarr');
    assertEquals(diff.changes.length, 1);
    for (const fieldChange of diff.changes) {
      assertEquals(fieldChange.type, 'changed');
    }
    const serialized = JSON.stringify(diff.changes);
    assert(serialized.includes('Shared'), 'change references the edited CF');
    assert(serialized.includes('30'), 'change carries the new score');

    // cascade: Shared referenced by Primary (radarr) and Secondary (all) -> 2 profiles.
    assertEquals(body.cascade.length, 1);
    const cascade = body.cascade[0];
    assertEquals(cascade.nodeKind, 'custom_format');
    assertEquals(cascade.name, 'Shared');
    assertEquals(cascade.counts.total, 2);
    assertEquals(cascade.counts.quality_profile, 2);
    assertEquals(cascade.byArrType.radarr, 1);
    assertEquals(cascade.byArrType.all, 1);
    assertEquals(cascade.truncated, false);
  });
});

// ============================================================================
// PARSER DOWN (release impacts empty, but configDiff + cascade still populated)
// ============================================================================

Deno.test('impact: parser down yields empty releaseImpacts but still computes configDiff and cascade', async () => {
  await withImpactFixture(async (databaseId) => {
    parserState.setHealthAvailable(false);
    parserClientModule.clearParserVersionCache();

    const change: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Primary',
      customFormatName: 'Boost',
      score: 50,
    };
    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [{ id: 'r1', title: 'Movie.BOOST', type: 'movie' }],
        proposedChanges: [change],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    assertEquals(body.parserAvailable, false);
    assertEquals(body.releaseImpacts, []);
    // Sandbox still runs, so the config A/B diff and cascade are unaffected by parser health.
    assertEquals(body.appliedChanges, [change]);
    assertEquals(body.configDiff.length, 1);
    assertEquals(body.cascade.length, 1);
    assertEquals(body.cascade[0].name, 'Boost');
  });
});

// ============================================================================
// FAIL-SOFT PARTITIONING (trash target + unknown profile -> skippedChanges)
// ============================================================================

Deno.test('impact: trash-target and unknown-profile changes are skipped, not fatal', async () => {
  await withImpactFixture(async (databaseId) => {
    seedMovie('Movie.BOOST', { BOOST: true, SHARED: false });

    const trashChange: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'TrashProf',
      customFormatName: 'Boost',
      score: 9,
    };
    const unknownChange: ProposedChange = {
      kind: 'set_cf_score',
      profileName: 'Nonexistent',
      customFormatName: 'Boost',
      score: 9,
    };

    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary', 'trash:9001:TrashProf'],
        releases: [{ id: 'r1', title: 'Movie.BOOST', type: 'movie' }],
        proposedChanges: [trashChange, unknownChange],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    assertEquals(body.appliedChanges, []);
    const reasons = new Map(body.skippedChanges.map((s) => [s.change, s.reason] as const));
    const trashReason = body.skippedChanges.find((s) => (s.change as ProposedChange).profileName === 'TrashProf');
    const unknownReason = body.skippedChanges.find((s) => (s.change as ProposedChange).profileName === 'Nonexistent');
    assertEquals(trashReason?.reason, 'trash-profile-not-editable');
    assertEquals(unknownReason?.reason, 'unknown-profile');
    assertEquals(reasons.size, 2);
  });
});

// ============================================================================
// EMPTY proposedChanges -> all deltas 0
// ============================================================================

Deno.test('impact: empty proposedChanges yields zero deltas and empty config/cascade', async () => {
  await withImpactFixture(async (databaseId) => {
    seedMovie('Movie.BOOST', { BOOST: true, SHARED: false });

    const response = await impactRouteModule.POST(
      buildEvent({
        databaseId,
        arrType: 'radarr',
        profileNames: ['pcd:Primary'],
        releases: [{ id: 'r1', title: 'Movie.BOOST', type: 'movie' }],
        proposedChanges: [],
      })
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as SimulateImpactResponse;

    assertEquals(body.appliedChanges, []);
    assertEquals(body.skippedChanges, []);
    assertEquals(body.configDiff, []);
    assertEquals(body.cascade, []);
    const profile = body.releaseImpacts[0].profiles.find((p) => p.profileName === 'Primary');
    assert(profile);
    assertEquals(profile.delta, 0);
    assertEquals(profile.currentTotal, profile.proposedTotal);
    assertEquals(profile.changedCfs, []);
  });
});

// ============================================================================
// VALIDATION + NOT-FOUND (all throw; assert on the thrown status)
// ============================================================================

Deno.test('impact: request validation and missing-cache errors', async (t) => {
  const validRelease = { id: 'r1', title: 'Movie.BOOST', type: 'movie' };
  const validChange = {
    kind: 'set_cf_score',
    profileName: 'Primary',
    customFormatName: 'Boost',
    score: 1,
  };

  await t.step('malformed JSON body -> 400', async () => {
    const error = await assertRejects(async () => impactRouteModule.POST(buildRawEvent('{not json')));
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('literal null body -> 400 (not 500)', async () => {
    const error = await assertRejects(async () => impactRouteModule.POST(buildRawEvent('null')));
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('invalid arrType -> 400', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: DATABASE_ID,
          arrType: 'plexarr',
          profileNames: ['pcd:Primary'],
          releases: [validRelease],
          proposedChanges: [validChange],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('unknown proposed-change kind -> 400', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: DATABASE_ID,
          arrType: 'radarr',
          profileNames: ['pcd:Primary'],
          releases: [validRelease],
          proposedChanges: [{ kind: 'bogus', profileName: 'Primary' }],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('releases over cap -> 400', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: DATABASE_ID,
          arrType: 'radarr',
          profileNames: ['pcd:Primary'],
          releases: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, title: `Movie ${i}`, type: 'movie' })),
          proposedChanges: [validChange],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('profiles over cap -> 400', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: DATABASE_ID,
          arrType: 'radarr',
          profileNames: Array.from({ length: 11 }, (_, i) => `pcd:Profile-${i}`),
          releases: [validRelease],
          proposedChanges: [validChange],
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('changes over cap -> 400', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: DATABASE_ID,
          arrType: 'radarr',
          profileNames: ['pcd:Primary'],
          releases: [validRelease],
          proposedChanges: Array.from({ length: 101 }, () => validChange),
        })
      )
    );
    assertEquals(getErrorStatus(error), 400);
  });

  await t.step('unregistered databaseId -> 404', async () => {
    const error = await assertRejects(async () =>
      impactRouteModule.POST(
        buildEvent({
          databaseId: 999999,
          arrType: 'radarr',
          profileNames: ['pcd:Primary'],
          releases: [validRelease],
          proposedChanges: [validChange],
        })
      )
    );
    assertEquals(getErrorStatus(error), 404);
  });
});

Deno.test('impact: real Go outage and recovery preserve configuration analysis', async () => {
  const built = await buildGoParser('route-impact-v1');
  let running = await startGoParser(built.binaryPath, 58131);
  parserState.setForwardBaseUrl(running.baseUrl);

  try {
    await withImpactFixture(async (databaseId) => {
      const change: ProposedChange = {
        kind: 'set_cf_score',
        profileName: 'Primary',
        customFormatName: 'Boost',
        score: 50,
      };
      const releases = [
        {
          id: 'real-go-impact',
          title: 'Movie.2024.1080p.WEB-DL.BOOST-GROUP',
          type: 'movie',
        },
      ];
      const invoke = async (): Promise<SimulateImpactResponse> => {
        const response = await impactRouteModule.POST(
          buildEvent({
            databaseId,
            arrType: 'radarr',
            profileNames: ['pcd:Primary'],
            releases,
            proposedChanges: [change],
          })
        );
        assertEquals(response.status, 200);
        return (await response.json()) as SimulateImpactResponse;
      };

      parserClientModule.clearParserVersionCache();
      const healthy = await invoke();
      assertEquals(healthy.parserAvailable, true);
      assertEquals(healthy.releaseImpacts.length, 1);
      assertEquals(healthy.releaseImpacts[0].id, 'real-go-impact');
      assertEquals(healthy.releaseImpacts[0].title, releases[0].title);
      assertEquals(healthy.configDiff.length, 1);
      assertEquals(healthy.cascade[0].name, 'Boost');

      await running.stop();
      parserClientModule.clearParserVersionCache();
      const unavailable = await invoke();
      assertEquals(unavailable.parserAvailable, false);
      assertEquals(unavailable.releaseImpacts, []);
      assertEquals(unavailable.appliedChanges, [change]);
      assertEquals(unavailable.configDiff.length, 1);
      assertEquals(unavailable.cascade[0].name, 'Boost');

      running = await startGoParser(built.binaryPath, 58131);
      parserClientModule.clearParserVersionCache();
      const recovered = await invoke();
      assertEquals(recovered.parserAvailable, true);
      assertEquals(recovered.releaseImpacts.length, 1);
      assertEquals(recovered.releaseImpacts[0].id, 'real-go-impact');
      assertEquals(recovered.configDiff.length, 1);
      assertEquals(recovered.cascade[0].name, 'Boost');
    });
  } finally {
    await running.stop();
    parserState.setForwardBaseUrl(null);
    parserClientModule.clearParserVersionCache();
    await built.cleanup();
  }
});

Deno.test.afterAll(async () => {
  await parserState.close();
});
