import { assertEquals, assertThrows } from '@std/assert';
import type { BaseArrClient } from '$arr/base.ts';
import { HttpError } from '../../lib/server/utils/http/types.ts';
import {
  collectRemoteSectionSnapshots as collectRadarrRemote,
  type RadarrStartupCandidates,
  type RadarrStartupRemoteSnapshot,
  matchRadarrStartupResources,
} from '../../lib/server/pull/startup/handlers/radarr.ts';
import {
  collectRemoteSectionSnapshots as collectSonarrRemote,
  type SonarrStartupCandidates,
  type SonarrStartupRemoteSnapshot,
  matchSonarrStartupResources,
} from '../../lib/server/pull/startup/handlers/sonarr.ts';
import {
  collectRemoteSectionSnapshots as collectLidarrRemote,
  type LidarrStartupCandidates,
  type LidarrStartupRemoteSnapshot,
  matchLidarrStartupResources,
} from '../../lib/server/pull/startup/handlers/lidarr.ts';
import type { StartupPullInstanceInput } from '../../lib/server/pull/startup/types.ts';

function createThrowingClient(error: unknown): BaseArrClient {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    getQualityProfiles: async () => {
      throw error;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getDelayProfiles: async () => {
      throw error;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getNamingConfig: async () => {
      throw error;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getMediaManagementConfig: async () => {
      throw error;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getQualityDefinitions: async () => {
      throw error;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getMetadataProfiles: async () => {
      throw error;
    },
  } as unknown as BaseArrClient;
}

Deno.test('Radarr fetch failure classifies HTTP 401 as auth', async () => {
  const result = await collectRadarrRemote(createThrowingClient(new HttpError('unauthorized', 401)));
  assertEquals(result.success, false);
  if (result.success) {
    throw new Error('Expected failure result for unauthorized response');
  }
  assertEquals(result.kind, 'auth');
  assertEquals(result.statusCode, 401);
});

Deno.test('Radarr fetch failure classifies HTTP 503 as unreachable', async () => {
  const result = await collectRadarrRemote(createThrowingClient(new HttpError('gateway timeout', 503)));
  assertEquals(result.success, false);
  if (result.success) {
    throw new Error('Expected failure result for timeout response');
  }
  assertEquals(result.kind, 'unreachable');
  assertEquals(result.statusCode, 503);
});

Deno.test('Sonarr fetch failure classifies HTTP 403 as auth', async () => {
  const result = await collectSonarrRemote(createThrowingClient(new HttpError('forbidden', 403)));
  assertEquals(result.success, false);
  if (result.success) {
    throw new Error('Expected failure result for forbidden response');
  }
  assertEquals(result.kind, 'auth');
  assertEquals(result.statusCode, 403);
});

Deno.test('Sonarr fetch failure classifies HTTP 422 as unknown', async () => {
  const result = await collectSonarrRemote(createThrowingClient(new HttpError('unprocessable', 422)));
  assertEquals(result.success, false);
  if (result.success) {
    throw new Error('Expected failure result for unknown response');
  }
  assertEquals(result.kind, 'unknown');
  assertEquals(result.statusCode, 422);
});

Deno.test('Lidarr fetch failure classifies HTTP 504 as unreachable', async () => {
  const result = await collectLidarrRemote(createThrowingClient(new HttpError('gateway timeout', 504)));
  assertEquals(result.success, false);
  if (result.success) {
    throw new Error('Expected failure result for gateway timeout response');
  }
  assertEquals(result.kind, 'unreachable');
  assertEquals(result.statusCode, 504);
});

Deno.test('matchRadarrStartupResources increments counters as expected', () => {
  const input: StartupPullInstanceInput = {
    instanceId: 10,
    instanceName: 'radarr-main',
    arrType: 'radarr',
    url: 'http://radarr.local',
    databaseIds: [1],
  };

  const snapshot: RadarrStartupRemoteSnapshot = {
    supportedSections: ['qualityProfiles', 'mediaSettings'],
    unsupportedSections: [{ section: 'metadataProfiles', reason: 'unsupported by build' }],
    resources: {
      qualityProfiles: [
        {
          id: 1,
          name: 'High Quality\u200b',
          section: 'qualityProfiles',
          arrType: 'radarr',
        },
      ],
      delayProfiles: [],
      naming: [{ id: 3, name: 'Naming', section: 'naming', arrType: 'radarr' }],
      mediaSettings: [{ id: 2, name: 'Default Settings', section: 'mediaSettings', arrType: 'radarr' }],
      qualityDefinitions: [],
      metadataProfiles: [],
    },
  };

  const candidates: RadarrStartupCandidates = {
    qualityProfiles: [{ id: 1, name: 'High Quality', section: 'qualityProfiles', arrType: 'radarr', databaseId: 1 }],
    delayProfiles: [],
    naming: [],
    mediaSettings: [{ id: 4, name: 'Other Settings', section: 'mediaSettings', arrType: 'radarr', databaseId: 1 }],
    qualityDefinitions: [],
    metadataProfiles: [],
  };

  const result = matchRadarrStartupResources(input, snapshot, candidates);
  assertEquals(result.status, 'success');
  assertEquals(result.envelope.counters.imported, 1);
  assertEquals(result.envelope.counters.skippedNoMatch, 2);
  assertEquals(result.matches.length, 3);
});

Deno.test('matchSonarrStartupResources increments counters as expected', () => {
  const input: StartupPullInstanceInput = {
    instanceId: 11,
    instanceName: 'sonarr-main',
    arrType: 'sonarr',
    url: 'http://sonarr.local',
    databaseIds: [1],
  };

  const snapshot: SonarrStartupRemoteSnapshot = {
    supportedSections: ['naming', 'mediaSettings'],
    unsupportedSections: [],
    resources: {
      qualityProfiles: [],
      delayProfiles: [],
      naming: [{ id: 4, name: 'Movie Naming', section: 'naming', arrType: 'sonarr' }],
      mediaSettings: [
        {
          id: 5,
          name: 'Primary Media',
          section: 'mediaSettings',
          arrType: 'sonarr',
          fingerprint: 'fp',
        },
      ],
      qualityDefinitions: [],
      metadataProfiles: [],
    },
  };

  const candidates: SonarrStartupCandidates = {
    qualityProfiles: [],
    delayProfiles: [],
    naming: [{ id: 6, name: 'Movie Naming', section: 'naming', arrType: 'sonarr', databaseId: 1 }],
    mediaSettings: [
      {
        id: 7,
        name: 'Other Media',
        section: 'mediaSettings',
        arrType: 'sonarr',
        databaseId: 1,
        fingerprint: 'fp-2',
      },
    ],
    qualityDefinitions: [],
    metadataProfiles: [],
  };

  const result = matchSonarrStartupResources(input, snapshot, candidates);
  assertEquals(result.status, 'success');
  assertEquals(result.envelope.counters.imported, 1);
  assertEquals(result.envelope.counters.skippedNoMatch, 1);
  assertEquals(result.matches.length, 2);
});

Deno.test('matchLidarrStartupResources handles metadata profiles', () => {
  const input: StartupPullInstanceInput = {
    instanceId: 12,
    instanceName: 'lidarr-main',
    arrType: 'lidarr',
    url: 'http://lidarr.local',
    databaseIds: [1],
  };

  const snapshot: LidarrStartupRemoteSnapshot = {
    supportedSections: ['metadataProfiles'],
    unsupportedSections: [],
    resources: {
      qualityProfiles: [],
      delayProfiles: [],
      naming: [],
      mediaSettings: [],
      qualityDefinitions: [],
      metadataProfiles: [{ id: 9, name: 'Standard\u200b', section: 'metadataProfiles', arrType: 'lidarr' }],
    },
  };

  const candidates: LidarrStartupCandidates = {
    qualityProfiles: [],
    delayProfiles: [],
    naming: [],
    mediaSettings: [],
    qualityDefinitions: [],
    metadataProfiles: [{ id: 9, name: 'Standard', section: 'metadataProfiles', arrType: 'lidarr', databaseId: 1 }],
  };

  const result = matchLidarrStartupResources(input, snapshot, candidates);
  assertEquals(result.status, 'success');
  assertEquals(result.envelope.counters.imported, 1);
  assertEquals(result.matches[0]?.section, 'metadataProfiles');
});

Deno.test('matchRadarrStartupResources rejects non-radarr arr_type', () => {
  assertThrows(() => {
    matchRadarrStartupResources(
      {
        instanceId: 11,
        instanceName: 'wrong',
        arrType: 'sonarr',
        url: 'http://bad.local',
        databaseIds: [1],
      },
      {
        supportedSections: [],
        unsupportedSections: [],
        resources: {
          qualityProfiles: [],
          delayProfiles: [],
          naming: [],
          mediaSettings: [],
          qualityDefinitions: [],
          metadataProfiles: [],
        },
      },
      {
        qualityProfiles: [],
        delayProfiles: [],
        naming: [],
        mediaSettings: [],
        qualityDefinitions: [],
        metadataProfiles: [],
      }
    );
  }, Error);
});

Deno.test('matchSonarrStartupResources rejects non-sonarr arr_type', () => {
  assertThrows(() => {
    matchSonarrStartupResources(
      {
        instanceId: 11,
        instanceName: 'wrong',
        arrType: 'lidarr',
        url: 'http://bad.local',
        databaseIds: [1],
      },
      {
        supportedSections: [],
        unsupportedSections: [],
        resources: {
          qualityProfiles: [],
          delayProfiles: [],
          naming: [],
          mediaSettings: [],
          qualityDefinitions: [],
          metadataProfiles: [],
        },
      },
      {
        qualityProfiles: [],
        delayProfiles: [],
        naming: [],
        mediaSettings: [],
        qualityDefinitions: [],
        metadataProfiles: [],
      }
    );
  }, Error);
});

Deno.test('matchLidarrStartupResources rejects non-lidarr arr_type', () => {
  assertThrows(() => {
    matchLidarrStartupResources(
      {
        instanceId: 12,
        instanceName: 'wrong',
        arrType: 'radarr',
        url: 'http://bad.local',
        databaseIds: [1],
      },
      {
        supportedSections: [],
        unsupportedSections: [],
        resources: {
          qualityProfiles: [],
          delayProfiles: [],
          naming: [],
          mediaSettings: [],
          qualityDefinitions: [],
          metadataProfiles: [],
        },
      },
      {
        qualityProfiles: [],
        delayProfiles: [],
        naming: [],
        mediaSettings: [],
        qualityDefinitions: [],
        metadataProfiles: [],
      }
    );
  }, Error);
});
