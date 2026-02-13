import { assertArrayIncludes, assertEquals } from '@std/assert';
import { BaseTest, type TestContext } from './BaseTest.ts';
import { GET as libraryGet } from '../../routes/api/v1/arr/library/+server.ts';
import { GET as releasesGet } from '../../routes/api/v1/arr/releases/+server.ts';
import { type ArrInstance, arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { pcdManager } from '../../lib/server/pcd/index.ts';
import { cache } from '../../lib/server/utils/cache/cache.ts';
import { LidarrClient } from '../../lib/server/utils/arr/clients/lidarr.ts';
import { RadarrClient } from '../../lib/server/utils/arr/clients/radarr.ts';
import { SonarrClient } from '../../lib/server/utils/arr/clients/sonarr.ts';
import type {
  LidarrLibraryItem,
  LidarrRelease,
  RadarrLibraryItem,
  RadarrRelease,
  SonarrLibraryItem,
  SonarrRelease,
} from '../../lib/server/utils/arr/types.ts';

type Restore = () => void;

interface ErrorEnvelope {
  error: string;
}

interface LibraryEnvelope {
  type: string;
  items: unknown[];
  profilesByDatabase: Array<{
    databaseId: number;
    databaseName: string;
    profiles: string[];
  }>;
}

interface ReleasesEnvelope {
  type: string;
  rawCount: number;
  releases: Array<{
    title: string;
    occurrences: number;
    indexers: string[];
    flags: string[];
    languages: string[];
  }>;
}

const RADARR_LIBRARY_ITEM: RadarrLibraryItem = {
  id: 1,
  tmdbId: 101,
  title: 'Radarr Fixture',
  year: 2025,
  qualityProfileId: 11,
  qualityProfileName: 'Radarr Profile',
  hasFile: true,
  dateAdded: '2025-01-01T00:00:00.000Z',
  popularity: 10,
  customFormats: [],
  customFormatScore: 0,
  qualityName: 'WEBDL-1080p',
  fileName: 'Radarr.Fixture.mkv',
  scoreBreakdown: [],
  cutoffScore: 100,
  minScore: 0,
  progress: 0,
  cutoffMet: false,
  isProfilarrProfile: false,
};

const SONARR_LIBRARY_ITEM: SonarrLibraryItem = {
  id: 2,
  tvdbId: 202,
  title: 'Sonarr Fixture',
  year: 2025,
  qualityProfileId: 22,
  qualityProfileName: 'Sonarr Profile',
  status: 'continuing',
  monitored: true,
  seasonCount: 1,
  episodeCount: 8,
  episodeFileCount: 8,
  totalEpisodeCount: 8,
  sizeOnDisk: 1024,
  percentOfEpisodes: 100,
  dateAdded: '2025-01-01T00:00:00.000Z',
  seasons: [
    {
      seasonNumber: 1,
      monitored: true,
      episodeCount: 8,
      episodeFileCount: 8,
      totalEpisodeCount: 8,
      sizeOnDisk: 1024,
      percentOfEpisodes: 100,
    },
  ],
  isProfilarrProfile: false,
};

const LIDARR_LIBRARY_ITEM: LidarrLibraryItem = {
  id: 3,
  artistId: 303,
  artistName: 'Lidarr Artist',
  title: 'Lidarr Album',
  year: 2025,
  albumType: 'album',
  releaseDate: '2025-01-01',
  status: 'continuing',
  monitored: true,
  trackFileCount: 10,
  trackCount: 10,
  totalTrackCount: 10,
  sizeOnDisk: 4096,
  percentOfTracks: 100,
  dateAdded: '2025-01-01T00:00:00.000Z',
  qualityProfileId: 33,
  qualityProfileName: 'Lidarr Profile',
  isProfilarrProfile: false,
};

function buildInstance(id: number, type: string): ArrInstance {
  return {
    id,
    name: `${type}-${id}`,
    type,
    url: `http://${type}.local`,
    api_key: `${type}-api-key`,
    tags: null,
    enabled: 1,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };
}

function buildRadarrRelease(overrides: Partial<RadarrRelease> = {}): RadarrRelease {
  return {
    guid: 'radarr-guid',
    title: 'Movie.Release.2025.1080p',
    size: 1024,
    indexer: 'Indexer One (Prowlarr)',
    indexerId: 1,
    languages: [{ id: 1, name: 'English' }],
    indexerFlags: ['G_Freeleech'],
    quality: {
      quality: {
        id: 1,
        name: 'WEBDL-1080p',
        source: 'web',
        resolution: 1080,
        modifier: 'none',
      },
    },
    customFormats: [],
    customFormatScore: 0,
    releaseGroup: null,
    seeders: null,
    leechers: null,
    protocol: 'torrent',
    age: 1,
    ageHours: 1,
    ageMinutes: 1,
    approved: true,
    temporarilyRejected: false,
    rejected: false,
    rejections: [],
    publishDate: '2025-01-01T00:00:00.000Z',
    downloadUrl: null,
    infoUrl: null,
    magnetUrl: null,
    infoHash: null,
    ...overrides,
  };
}

function buildSonarrRelease(overrides: Partial<SonarrRelease> = {}): SonarrRelease {
  return {
    guid: 'sonarr-guid',
    title: 'Series.S01.1080p',
    size: 2048,
    indexer: 'Indexer One (Prowlarr)',
    indexerId: 1,
    languages: [{ id: 1, name: 'English' }],
    indexerFlags: 1,
    fullSeason: true,
    seasonNumber: 1,
    seriesTitle: 'Series',
    episodeNumbers: [1, 2],
    absoluteEpisodeNumbers: [1, 2],
    mappedSeasonNumber: null,
    mappedEpisodeNumbers: null,
    mappedSeriesId: null,
    quality: {
      quality: {
        id: 1,
        name: 'WEBDL-1080p',
        source: 'web',
        resolution: 1080,
      },
    },
    customFormats: [],
    customFormatScore: 0,
    releaseGroup: null,
    seeders: null,
    leechers: null,
    protocol: 'torrent',
    age: 1,
    ageHours: 1,
    ageMinutes: 1,
    approved: true,
    temporarilyRejected: false,
    rejected: false,
    rejections: [],
    publishDate: '2025-01-01T00:00:00.000Z',
    downloadUrl: null,
    infoUrl: null,
    magnetUrl: null,
    infoHash: null,
    ...overrides,
  };
}

class LidarrApiParityTest extends BaseTest {
  private restores: Restore[] = [];

  protected override beforeEach(_context: TestContext): void {
    this.restores = [];
    cache.clear();
  }

  protected override afterEach(_context: TestContext): void {
    for (const restore of this.restores.reverse()) {
      restore();
    }

    cache.clear();
  }

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;

    this.restores.push(() => {
      target[key] = original;
    });
  }

  private createUrl(pathWithQuery: string): URL {
    return new URL(`http://localhost${pathWithQuery}`);
  }

  runTests(): void {
    this.test('library returns standard validation and not-found error envelopes', async () => {
      const missingInstanceId = await libraryGet({
        url: this.createUrl('/api/v1/arr/library'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(missingInstanceId.status, 400);
      assertEquals((await missingInstanceId.json()) as ErrorEnvelope, {
        error: 'instanceId is required',
      });

      const invalidInstanceId = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=bad'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(invalidInstanceId.status, 400);
      assertEquals((await invalidInstanceId.json()) as ErrorEnvelope, {
        error: 'Invalid instanceId',
      });

      const getByIdNotFound: typeof arrInstancesQueries.getById = () => undefined;
      this.patch(arrInstancesQueries, 'getById', getByIdNotFound);

      const notFound = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=999'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(notFound.status, 404);
      assertEquals((await notFound.json()) as ErrorEnvelope, {
        error: 'Instance not found',
      });
    });

    this.test('library keeps lidarr and existing arr type parity', async () => {
      let lidarrProfileNamesArg: Set<string> | undefined;

      const getAllDatabasesMock: typeof pcdManager.getAll = () => [];
      this.patch(pcdManager, 'getAll', getAllDatabasesMock);

      const instances = new Map<number, ArrInstance>([
        [11, buildInstance(11, 'lidarr')],
        [12, buildInstance(12, 'radarr')],
        [13, buildInstance(13, 'sonarr')],
      ]);
      const getByIdMock: typeof arrInstancesQueries.getById = (id) => instances.get(id);
      this.patch(arrInstancesQueries, 'getById', getByIdMock);

      const lidarrLibraryMock: typeof LidarrClient.prototype.getLibrary = async (profilarrProfileNames) => {
        lidarrProfileNamesArg = profilarrProfileNames;
        return [LIDARR_LIBRARY_ITEM];
      };
      const radarrLibraryMock: typeof RadarrClient.prototype.getLibrary = async () => {
        return [RADARR_LIBRARY_ITEM];
      };
      const sonarrLibraryMock: typeof SonarrClient.prototype.getLibrary = async () => {
        return [SONARR_LIBRARY_ITEM];
      };

      this.patch(LidarrClient.prototype, 'getLibrary', lidarrLibraryMock);
      this.patch(RadarrClient.prototype, 'getLibrary', radarrLibraryMock);
      this.patch(SonarrClient.prototype, 'getLibrary', sonarrLibraryMock);

      const lidarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11'),
      } as Parameters<typeof libraryGet>[0]);
      const radarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=12'),
      } as Parameters<typeof libraryGet>[0]);
      const sonarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=13'),
      } as Parameters<typeof libraryGet>[0]);

      const lidarrPayload = (await lidarrResponse.json()) as LibraryEnvelope;
      const radarrPayload = (await radarrResponse.json()) as LibraryEnvelope;
      const sonarrPayload = (await sonarrResponse.json()) as LibraryEnvelope;

      assertEquals(lidarrResponse.status, 200);
      assertEquals(radarrResponse.status, 200);
      assertEquals(sonarrResponse.status, 200);

      assertEquals(lidarrPayload.type, 'lidarr');
      assertEquals(radarrPayload.type, 'radarr');
      assertEquals(sonarrPayload.type, 'sonarr');

      assertEquals(lidarrPayload.items.length, 1);
      assertEquals(radarrPayload.items.length, 1);
      assertEquals(sonarrPayload.items.length, 1);

      assertEquals(lidarrPayload.profilesByDatabase, []);
      assertEquals(radarrPayload.profilesByDatabase, []);
      assertEquals(sonarrPayload.profilesByDatabase, []);

      assertEquals(lidarrProfileNamesArg instanceof Set, true);
      assertEquals(lidarrProfileNamesArg?.size, 0);
    });

    this.test('library keeps lidarr 500 envelope on client failures', async () => {
      const getAllDatabasesMock: typeof pcdManager.getAll = () => [];
      const getByIdMock: typeof arrInstancesQueries.getById = () => buildInstance(21, 'lidarr');
      const lidarrLibraryErrorMock: typeof LidarrClient.prototype.getLibrary = async () => {
        throw new Error('lidarr library failed');
      };

      this.patch(pcdManager, 'getAll', getAllDatabasesMock);
      this.patch(arrInstancesQueries, 'getById', getByIdMock);
      this.patch(LidarrClient.prototype, 'getLibrary', lidarrLibraryErrorMock);

      const response = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=21'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(response.status, 500);
      assertEquals((await response.json()) as ErrorEnvelope, {
        error: 'lidarr library failed',
      });
    });

    this.test('releases returns standard validation and not-found error envelopes', async () => {
      const missingInstanceId = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?itemId=1'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(missingInstanceId.status, 400);
      assertEquals((await missingInstanceId.json()) as ErrorEnvelope, {
        error: 'instanceId is required',
      });

      const missingItemId = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=1'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(missingItemId.status, 400);
      assertEquals((await missingItemId.json()) as ErrorEnvelope, {
        error: 'itemId is required',
      });

      const invalidInstanceId = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=bad&itemId=1'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(invalidInstanceId.status, 400);
      assertEquals((await invalidInstanceId.json()) as ErrorEnvelope, {
        error: 'Invalid instanceId',
      });

      const invalidItemId = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=1&itemId=bad'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(invalidItemId.status, 400);
      assertEquals((await invalidItemId.json()) as ErrorEnvelope, {
        error: 'Invalid itemId',
      });

      const getByIdNotFound: typeof arrInstancesQueries.getById = () => undefined;
      this.patch(arrInstancesQueries, 'getById', getByIdNotFound);

      const notFound = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=999&itemId=1'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(notFound.status, 404);
      assertEquals((await notFound.json()) as ErrorEnvelope, {
        error: 'Instance not found',
      });
    });

    this.test('releases keeps lidarr and existing arr type grouping parity', async () => {
      let sonarrSeasonArg: number | undefined;

      const instances = new Map<number, ArrInstance>([
        [31, buildInstance(31, 'lidarr')],
        [32, buildInstance(32, 'radarr')],
        [33, buildInstance(33, 'sonarr')],
      ]);
      const getByIdMock: typeof arrInstancesQueries.getById = (id) => instances.get(id);
      this.patch(arrInstancesQueries, 'getById', getByIdMock);

      const lidarrReleasesMock: typeof LidarrClient.prototype.getReleases = async () => {
        const releases: LidarrRelease[] = [
          {
            guid: 'lidarr-1',
            title: 'Artist.Album.2025.FLAC',
            size: 3000,
            indexer: 'Indexer One (Prowlarr)',
            indexerFlags: 1,
          },
          {
            guid: 'lidarr-2',
            title: 'Artist.Album.2025.FLAC',
            size: 3000,
            indexer: 'Indexer Two',
            indexerFlags: 1,
          },
        ];
        return releases;
      };

      const radarrReleasesMock: typeof RadarrClient.prototype.getReleases = async () => {
        return [
          buildRadarrRelease({
            guid: 'radarr-1',
            indexer: 'Indexer One (Prowlarr)',
          }),
          buildRadarrRelease({
            guid: 'radarr-2',
            indexer: 'Indexer Two',
          }),
        ];
      };

      const sonarrReleasesMock: typeof SonarrClient.prototype.getSeasonPackReleases = async (
        _seriesId,
        seasonNumber
      ) => {
        sonarrSeasonArg = seasonNumber;
        return [
          buildSonarrRelease({
            guid: 'sonarr-1',
            indexer: 'Indexer One (Prowlarr)',
          }),
          buildSonarrRelease({
            guid: 'sonarr-2',
            indexer: 'Indexer Two',
          }),
        ];
      };

      this.patch(LidarrClient.prototype, 'getReleases', lidarrReleasesMock);
      this.patch(RadarrClient.prototype, 'getReleases', radarrReleasesMock);
      this.patch(SonarrClient.prototype, 'getSeasonPackReleases', sonarrReleasesMock);

      const lidarrResponse = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=31&itemId=301'),
      } as Parameters<typeof releasesGet>[0]);
      const radarrResponse = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=32&itemId=302'),
      } as Parameters<typeof releasesGet>[0]);
      const sonarrResponse = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=33&itemId=303&season=5'),
      } as Parameters<typeof releasesGet>[0]);

      const lidarrPayload = (await lidarrResponse.json()) as ReleasesEnvelope;
      const radarrPayload = (await radarrResponse.json()) as ReleasesEnvelope;
      const sonarrPayload = (await sonarrResponse.json()) as ReleasesEnvelope;

      assertEquals(lidarrResponse.status, 200);
      assertEquals(radarrResponse.status, 200);
      assertEquals(sonarrResponse.status, 200);

      assertEquals(lidarrPayload.type, 'lidarr');
      assertEquals(radarrPayload.type, 'radarr');
      assertEquals(sonarrPayload.type, 'sonarr');

      assertEquals(lidarrPayload.rawCount, 2);
      assertEquals(radarrPayload.rawCount, 2);
      assertEquals(sonarrPayload.rawCount, 2);

      assertEquals(lidarrPayload.releases.length, 1);
      assertEquals(radarrPayload.releases.length, 1);
      assertEquals(sonarrPayload.releases.length, 1);

      assertEquals(lidarrPayload.releases[0].occurrences, 2);
      assertEquals(radarrPayload.releases[0].occurrences, 2);
      assertEquals(sonarrPayload.releases[0].occurrences, 2);
      assertArrayIncludes(lidarrPayload.releases[0].indexers, ['Indexer One']);
      assertEquals(sonarrSeasonArg, 5);
    });

    this.test('releases keeps lidarr 500 envelope on client failures', async () => {
      const getByIdMock: typeof arrInstancesQueries.getById = () => buildInstance(41, 'lidarr');
      const lidarrReleaseErrorMock: typeof LidarrClient.prototype.getReleases = async () => {
        throw new Error('lidarr releases failed');
      };

      this.patch(arrInstancesQueries, 'getById', getByIdMock);
      this.patch(LidarrClient.prototype, 'getReleases', lidarrReleaseErrorMock);

      const response = await releasesGet({
        url: this.createUrl('/api/v1/arr/releases?instanceId=41&itemId=401'),
      } as Parameters<typeof releasesGet>[0]);

      assertEquals(response.status, 500);
      assertEquals((await response.json()) as ErrorEnvelope, {
        error: 'lidarr releases failed',
      });
    });
  }
}

const test = new LidarrApiParityTest();
await test.runTests();
