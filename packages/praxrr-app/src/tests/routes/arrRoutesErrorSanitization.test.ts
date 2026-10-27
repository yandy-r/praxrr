// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { GET as getLibrary } from '../../routes/api/v1/arr/library/+server.ts';
import { GET as getEpisodes } from '../../routes/api/v1/arr/library/episodes/+server.ts';
import { GET as getReleases } from '../../routes/api/v1/arr/releases/+server.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { pcdManager } from '$pcd/index.ts';
import { RadarrClient } from '$utils/arr/clients/radarr.ts';
import { SonarrClient } from '$utils/arr/clients/sonarr.ts';
import type { SonarrSeries } from '$utils/arr/types.ts';
import { HttpError } from '$http/types.ts';
import { logger } from '$logger/logger.ts';
import type { LogOptions } from '$logger/types.ts';

type GetEvent = Parameters<typeof getLibrary>[0];

const SECRET = 'apikey=sk_live_SECRET123';
const UPSTREAM_BODY = JSON.stringify({ message: SECRET });

function buildGetEvent(path: string, query: Record<string, string>): GetEvent {
  const url = new URL(`http://localhost${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return { url } as GetEvent;
}

function upstreamError(): HttpError {
  return new HttpError(`HTTP 500: Internal Server Error | ${UPSTREAM_BODY}`, 500, JSON.parse(UPSTREAM_BODY));
}

function instanceOfType(id: number, type: string): ArrInstance {
  return {
    id,
    name: `Test ${type}`,
    type,
    url: 'http://127.0.0.1:9',
    api_key: 'test-key',
  } as unknown as ArrInstance;
}

/** Stub instance lookup, credential lookup, PCD listing and logger; returns captured error logs. */
function stubDependencies(instance: ArrInstance): {
  logged: { message: string; options?: LogOptions }[];
  restore: () => void;
} {
  const originalGetById = arrInstancesQueries.getById;
  const originalCredentials = arrInstanceCredentialsQueries.getByInstanceId;
  const originalGetAll = pcdManager.getAll;
  const originalError = logger.error;
  const originalInfo = logger.info;
  const logged: { message: string; options?: LogOptions }[] = [];
  arrInstancesQueries.getById = () => instance;
  arrInstanceCredentialsQueries.getByInstanceId = () => undefined;
  pcdManager.getAll = () => [];
  logger.error = async (message: string, options?: LogOptions) => {
    logged.push({ message, options });
  };
  logger.info = async () => {};
  return {
    logged,
    restore: () => {
      arrInstancesQueries.getById = originalGetById;
      arrInstanceCredentialsQueries.getByInstanceId = originalCredentials;
      pcdManager.getAll = originalGetAll;
      logger.error = originalError;
      logger.info = originalInfo;
    },
  };
}

function loggedRaw(logged: { options?: LogOptions }[]): boolean {
  return JSON.stringify(
    logged.map((entry) => entry.options?.meta),
    (_key, value) => (value instanceof Error ? { message: value.message } : value)
  ).includes('SECRET123');
}

Deno.test('GET /api/v1/arr/library: upstream failure returns a fixed message and logs the raw error', async () => {
  const { logged, restore } = stubDependencies(instanceOfType(9101, 'radarr'));
  const originalGetLibrary = RadarrClient.prototype.getLibrary;
  RadarrClient.prototype.getLibrary = async () => {
    throw upstreamError();
  };
  try {
    const response = await getLibrary(buildGetEvent('/api/v1/arr/library', { instanceId: '9101' }));
    assertEquals(response.status, 500);
    const text = await response.text();
    assertEquals(JSON.parse(text), {
      error: 'Failed to fetch library. Check the server logs for details.',
      code: 'library_fetch_failed',
    });
    assert(!text.includes('SECRET123'));
    assert(loggedRaw(logged), 'raw error must be logged server-side');
  } finally {
    RadarrClient.prototype.getLibrary = originalGetLibrary;
    restore();
  }
});

Deno.test('GET /api/v1/arr/library: invalid sortKey keeps its specific 400 message', async () => {
  const { restore } = stubDependencies(instanceOfType(9102, 'radarr'));
  try {
    const response = await getLibrary(buildGetEvent('/api/v1/arr/library', { instanceId: '9102', sortKey: 'bogus' }));
    assertEquals(response.status, 400);
    const body = (await response.json()) as { error: string; code?: string };
    assert(body.error.length > 0);
    assert(!body.error.includes('Check the server logs'));
    assertEquals(body.code, undefined);
  } finally {
    restore();
  }
});

Deno.test(
  'GET /api/v1/arr/library/episodes: upstream failure returns a fixed message and logs the raw error',
  async () => {
    const { logged, restore } = stubDependencies(instanceOfType(9201, 'sonarr'));
    const originalGetQualityProfiles = SonarrClient.prototype.getQualityProfiles;
    SonarrClient.prototype.getQualityProfiles = async () => {
      throw upstreamError();
    };
    try {
      const response = await getEpisodes(
        buildGetEvent('/api/v1/arr/library/episodes', { instanceId: '9201', seriesId: '7' })
      );
      assertEquals(response.status, 500);
      const text = await response.text();
      assertEquals(JSON.parse(text), {
        error: 'Failed to fetch episode details. Check the server logs for details.',
        code: 'episodes_fetch_failed',
      });
      assert(!text.includes('SECRET123'));
      assert(loggedRaw(logged), 'raw error must be logged server-side');
    } finally {
      SonarrClient.prototype.getQualityProfiles = originalGetQualityProfiles;
      restore();
    }
  }
);

Deno.test('GET /api/v1/arr/library/episodes: missing profile returns a fixed message and logs seriesId', async () => {
  const { logged, restore } = stubDependencies(instanceOfType(9203, 'sonarr'));
  const originalGetQualityProfiles = SonarrClient.prototype.getQualityProfiles;
  const originalGetSeries = SonarrClient.prototype.getSeries;
  SonarrClient.prototype.getQualityProfiles = async () => [];
  SonarrClient.prototype.getSeries = async () => ({
    id: 7,
    title: 'Test series',
    qualityProfileId: 99,
    monitored: true,
    seasons: [],
  });
  try {
    const response = await getEpisodes(
      buildGetEvent('/api/v1/arr/library/episodes', { instanceId: '9203', seriesId: '7' })
    );
    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      error: 'Failed to fetch episode details. Check the server logs for details.',
      code: 'episodes_fetch_failed',
    });
    assertEquals(logged.length, 1);
    assertEquals(logged[0].options?.meta, { instanceId: 9203, seriesId: 7 });
  } finally {
    SonarrClient.prototype.getQualityProfiles = originalGetQualityProfiles;
    SonarrClient.prototype.getSeries = originalGetSeries;
    restore();
  }
});

Deno.test('GET /api/v1/arr/library/episodes: non-Sonarr instance keeps its specific 400 message', async () => {
  const { restore } = stubDependencies(instanceOfType(9202, 'radarr'));
  try {
    const response = await getEpisodes(
      buildGetEvent('/api/v1/arr/library/episodes', { instanceId: '9202', seriesId: '7' })
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: 'Episode details are only available for Sonarr instances' });
  } finally {
    restore();
  }
});

Deno.test('GET /api/v1/arr/releases: upstream failure returns a fixed message and logs the raw error', async () => {
  const { logged, restore } = stubDependencies(instanceOfType(9301, 'radarr'));
  const originalGetReleases = RadarrClient.prototype.getReleases;
  RadarrClient.prototype.getReleases = async () => {
    throw upstreamError();
  };
  try {
    const response = await getReleases(buildGetEvent('/api/v1/arr/releases', { instanceId: '9301', itemId: '5' }));
    assertEquals(response.status, 500);
    const text = await response.text();
    assertEquals(JSON.parse(text), {
      error: 'Failed to fetch releases. Check the server logs for details.',
      code: 'releases_fetch_failed',
    });
    assert(!text.includes('SECRET123'));
    assert(loggedRaw(logged), 'raw error must be logged server-side');
  } finally {
    RadarrClient.prototype.getReleases = originalGetReleases;
    restore();
  }
});

Deno.test('GET /api/v1/arr/releases: validation errors keep their specific 400 messages', async () => {
  const { restore } = stubDependencies(instanceOfType(9302, 'radarr'));
  try {
    const missing = await getReleases(buildGetEvent('/api/v1/arr/releases', {}));
    assertEquals(missing.status, 400);
    assertEquals(await missing.json(), { error: 'instanceId is required' });

    const unsupported = await getReleases(buildGetEvent('/api/v1/arr/releases', { instanceId: '9302', itemId: 'abc' }));
    assertEquals(unsupported.status, 400);
    assertEquals(await unsupported.json(), { error: 'Invalid itemId' });
  } finally {
    restore();
  }
});
