import { assertArrayIncludes, assertEquals, assertExists } from '@std/assert';
import { BaseTest, type TestContext } from './BaseTest.ts';
import { GET as libraryGet } from '../../routes/api/v1/arr/library/+server.ts';
import { GET as releasesGet } from '../../routes/api/v1/arr/releases/+server.ts';
import { GET as exportGet } from '../../routes/api/v1/pcd/export/+server.ts';
import { POST as importPost } from '../../routes/api/v1/pcd/import/+server.ts';
import { type ArrInstance, arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import { pcdManager, type PCDCache as PCDCacheType } from '../../lib/server/pcd/index.ts';
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
import { LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES, ENTITY_TYPES } from '../../lib/shared/pcd/portable.ts';

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
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
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
  isPraxrrProfile: false,
};

const PAGINATED_RADARR_LIBRARY_ITEMS: RadarrLibraryItem[] = [
  RADARR_LIBRARY_ITEM,
  {
    ...RADARR_LIBRARY_ITEM,
    id: 6,
    tmdbId: 202,
    title: 'Radarr Fixture Two',
    year: 2024,
  },
];

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
  isPraxrrProfile: false,
};

const PAGINATED_SONARR_LIBRARY_ITEMS: SonarrLibraryItem[] = [
  SONARR_LIBRARY_ITEM,
  {
    ...SONARR_LIBRARY_ITEM,
    id: 7,
    tvdbId: 303,
    title: 'Sonarr Fixture Two',
    year: 2024,
  },
];

const LIDARR_LIBRARY_ITEM: LidarrLibraryItem = {
  id: 3,
  artistId: 303,
  foreignArtistId: 'f59c5520-5f46-4d2c-b2c4-822eabf53419',
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
  isPraxrrProfile: false,
};

const PAGINATED_LIDARR_LIBRARY_ITEMS: LidarrLibraryItem[] = [
  LIDARR_LIBRARY_ITEM,
  {
    ...LIDARR_LIBRARY_ITEM,
    id: 8,
    artistId: 404,
    artistName: 'Lidarr Artist Two',
    title: 'Lidarr Album Two',
    year: 2024,
  },
];

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

    this.test('library validates pagination params and defaults', async () => {
      const getAllDatabasesMock: typeof pcdManager.getAll = () => [];
      const getByIdMock: typeof arrInstancesQueries.getById = () => buildInstance(11, 'lidarr');
      const getLibraryMock: typeof LidarrClient.prototype.getLibrary = () =>
        Promise.resolve(PAGINATED_LIDARR_LIBRARY_ITEMS);

      this.patch(pcdManager, 'getAll', getAllDatabasesMock);
      this.patch(arrInstancesQueries, 'getById', getByIdMock);
      this.patch(LidarrClient.prototype, 'getLibrary', getLibraryMock);

      const defaultPagination = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11'),
      } as Parameters<typeof libraryGet>[0]);
      const defaultPayload = (await defaultPagination.json()) as LibraryEnvelope;

      assertEquals(defaultPagination.status, 200);
      assertEquals(defaultPayload.page, 1);
      assertEquals(defaultPayload.pageSize, 100);
      assertEquals(defaultPayload.totalRecords, PAGINATED_LIDARR_LIBRARY_ITEMS.length);
      assertEquals(defaultPayload.totalPages, 1);
      assertEquals(defaultPayload.hasNext, false);
      assertEquals(defaultPayload.items.length, 2);

      const invalidPage = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11&page=bad'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(invalidPage.status, 400);
      assertEquals((await invalidPage.json()) as ErrorEnvelope, {
        error: 'Invalid page',
      });

      const invalidPageSize = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11&pageSize=0'),
      } as Parameters<typeof libraryGet>[0]);

      assertEquals(invalidPageSize.status, 400);
      assertEquals((await invalidPageSize.json()) as ErrorEnvelope, {
        error: 'Invalid pageSize',
      });

      const boundedPageSize = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11&page=1&pageSize=500'),
      } as Parameters<typeof libraryGet>[0]);
      const boundedPayload = (await boundedPageSize.json()) as LibraryEnvelope;

      assertEquals(boundedPageSize.status, 200);
      assertEquals(boundedPayload.page, 1);
      assertEquals(boundedPayload.pageSize, 250);
      assertEquals(boundedPayload.totalPages, 1);
      assertEquals(boundedPayload.items.length, 2);

      const outOfRangePage = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11&page=99&pageSize=1'),
      } as Parameters<typeof libraryGet>[0]);
      const outOfRangePayload = (await outOfRangePage.json()) as LibraryEnvelope;

      assertEquals(outOfRangePage.status, 200);
      assertEquals(outOfRangePayload.page, 99);
      assertEquals(outOfRangePayload.pageSize, 1);
      assertEquals(outOfRangePayload.totalRecords, PAGINATED_LIDARR_LIBRARY_ITEMS.length);
      assertEquals(outOfRangePayload.totalPages, 2);
      assertEquals(outOfRangePayload.hasNext, false);
      assertEquals(outOfRangePayload.items.length, 0);
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

      const lidarrLibraryMock: typeof LidarrClient.prototype.getLibrary = async (praxrrProfileNames) => {
        lidarrProfileNamesArg = praxrrProfileNames;
        return PAGINATED_LIDARR_LIBRARY_ITEMS;
      };
      const radarrLibraryMock: typeof RadarrClient.prototype.getLibrary = async () => {
        return PAGINATED_RADARR_LIBRARY_ITEMS;
      };
      const sonarrLibraryMock: typeof SonarrClient.prototype.getLibrary = async () => {
        return PAGINATED_SONARR_LIBRARY_ITEMS;
      };

      this.patch(LidarrClient.prototype, 'getLibrary', lidarrLibraryMock);
      this.patch(RadarrClient.prototype, 'getLibrary', radarrLibraryMock);
      this.patch(SonarrClient.prototype, 'getLibrary', sonarrLibraryMock);

      const lidarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=11&page=1&pageSize=1'),
      } as Parameters<typeof libraryGet>[0]);
      const radarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=12&page=1&pageSize=1'),
      } as Parameters<typeof libraryGet>[0]);
      const sonarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=13&page=1&pageSize=1'),
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

      assertEquals(lidarrPayload.page, 1);
      assertEquals(radarrPayload.page, 1);
      assertEquals(sonarrPayload.page, 1);
      assertEquals(lidarrPayload.pageSize, 1);
      assertEquals(radarrPayload.pageSize, 1);
      assertEquals(sonarrPayload.pageSize, 1);
      assertEquals(lidarrPayload.totalRecords, 2);
      assertEquals(radarrPayload.totalRecords, 2);
      assertEquals(sonarrPayload.totalRecords, 2);
      assertEquals(lidarrPayload.totalPages, 2);
      assertEquals(radarrPayload.totalPages, 2);
      assertEquals(sonarrPayload.totalPages, 2);
      assertEquals(lidarrPayload.hasNext, true);
      assertEquals(radarrPayload.hasNext, true);
      assertEquals(sonarrPayload.hasNext, true);

      const lidarrItem = lidarrPayload.items[0] as LidarrLibraryItem;
      const radarrItem = radarrPayload.items[0] as RadarrLibraryItem;
      const sonarrItem = sonarrPayload.items[0] as SonarrLibraryItem;

      assertEquals(lidarrItem.artistId, 303);
      assertEquals(radarrItem.tmdbId, 101);
      assertEquals(sonarrItem.tvdbId, 202);
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

    this.test('export uses first-class Lidarr portable entity types in ENTITY_TYPES', async () => {
      // Verify all Lidarr media management portable entity types are registered
      const entityTypeSet = new Set(ENTITY_TYPES);
      for (const lidarrEntityType of LIDARR_MEDIA_MANAGEMENT_PORTABLE_ENTITIES) {
        assertEquals(entityTypeSet.has(lidarrEntityType), true);
      }

      // Verify export endpoint rejects unknown entity types
      const response = await exportGet({
        url: this.createUrl('/api/v1/pcd/export?databaseId=1&entityType=not_a_real_type&name=test'),
      } as Parameters<typeof exportGet>[0]);

      assertEquals(response.status, 400);
      const body = (await response.json()) as ErrorEnvelope;
      assertEquals(body.error, 'Invalid entityType: not_a_real_type');
    });

    this.test('export accepts lidarr_naming as a valid entity type', async () => {
      // Patch pcdManager.getCache to return null so we get a controlled 500
      const getCacheMock: typeof pcdManager.getCache = () => undefined;
      this.patch(pcdManager, 'getCache', getCacheMock);

      const response = await exportGet({
        url: this.createUrl('/api/v1/pcd/export?databaseId=999&entityType=lidarr_naming&name=TestNaming'),
      } as Parameters<typeof exportGet>[0]);

      // We expect 500 (cache not available) rather than 400 (invalid entity type)
      // This proves the entity type was accepted as valid
      assertEquals(response.status, 500);
      const body = (await response.json()) as ErrorEnvelope;
      assertEquals(body.error, 'Database cache not available');
    });

    this.test('import rejects mixed Lidarr payload with Radarr fields', async () => {
      const getCacheMock: typeof pcdManager.getCache = () => ({ kb: {} }) as unknown as PCDCacheType;
      this.patch(pcdManager, 'getCache', getCacheMock);

      const response = await importPost({
        request: new Request('http://localhost/api/v1/pcd/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            databaseId: 1,
            layer: 'user',
            entityType: 'lidarr_naming',
            data: {
              name: 'Mixed Payload',
              rename: true,
              standardEpisodeFormat: '{Artist Name}',
              dailyEpisodeFormat: '{Artist Name}',
              animeEpisodeFormat: '{Artist Name}',
              seriesFolderFormat: '{Artist Name}',
              seasonFolderFormat: '{Release Year}',
              replaceIllegalCharacters: true,
              colonReplacementFormat: 'dash',
              customColonReplacementFormat: null,
              multiEpisodeStyle: 'extend',
              movieFormat: '{Movie Title}',
              movieFolderFormat: '{Movie Title}',
            },
          }),
        }),
      } as Parameters<typeof importPost>[0]);

      assertEquals(response.status, 400);
      const body = (await response.json()) as ErrorEnvelope;
      assertEquals(body.error.includes('Mixed payload for lidarr_naming'), true);
    });

    this.test('import accepts first-class lidarr_media_settings entity type', async () => {
      const getCacheMock: typeof pcdManager.getCache = () => ({ kb: {} }) as unknown as PCDCacheType;
      this.patch(pcdManager, 'getCache', getCacheMock);

      // Submit a valid lidarr_media_settings payload
      // It will fail at the actual deserialization step (no real DB),
      // but the entity type and validation should pass
      const response = await importPost({
        request: new Request('http://localhost/api/v1/pcd/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            databaseId: 1,
            layer: 'user',
            entityType: 'lidarr_media_settings',
            data: {
              name: 'Lidarr Media Import',
              propersRepacks: 'preferAndUpgrade',
              enableMediaInfo: true,
            },
          }),
        }),
      } as Parameters<typeof importPost>[0]);

      // The entity type is accepted (not rejected as invalid).
      // The response may be 400 from deserialization or 200 on success.
      // The key assertion: it must NOT be a 400 with "Invalid entityType".
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 400) {
        assertEquals((body.error as string).includes('Invalid entityType'), false);
      }
    });

    this.test('no cross-Arr entity leakage: library responses contain only matching arr_type', async () => {
      const getAllDatabasesMock: typeof pcdManager.getAll = () => [];
      this.patch(pcdManager, 'getAll', getAllDatabasesMock);

      const instances = new Map<number, ArrInstance>([
        [51, buildInstance(51, 'lidarr')],
        [52, buildInstance(52, 'radarr')],
      ]);
      const getByIdMock: typeof arrInstancesQueries.getById = (id) => instances.get(id);
      this.patch(arrInstancesQueries, 'getById', getByIdMock);

      const lidarrLibraryMock: typeof LidarrClient.prototype.getLibrary = async () => {
        return [LIDARR_LIBRARY_ITEM];
      };
      const radarrLibraryMock: typeof RadarrClient.prototype.getLibrary = async () => {
        return [RADARR_LIBRARY_ITEM];
      };

      this.patch(LidarrClient.prototype, 'getLibrary', lidarrLibraryMock);
      this.patch(RadarrClient.prototype, 'getLibrary', radarrLibraryMock);

      const lidarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=51'),
      } as Parameters<typeof libraryGet>[0]);
      const radarrResponse = await libraryGet({
        url: this.createUrl('/api/v1/arr/library?instanceId=52'),
      } as Parameters<typeof libraryGet>[0]);

      const lidarrPayload = (await lidarrResponse.json()) as LibraryEnvelope;
      const radarrPayload = (await radarrResponse.json()) as LibraryEnvelope;

      // Lidarr response must be type lidarr, not radarr or sonarr
      assertEquals(lidarrPayload.type, 'lidarr');
      assertEquals(radarrPayload.type, 'radarr');

      // Lidarr items must contain Lidarr-specific fields, not Radarr fields
      const lidarrItem = lidarrPayload.items[0] as LidarrLibraryItem;
      assertExists(lidarrItem.artistName);
      assertEquals(lidarrItem.albumType, 'album');

      // Radarr items must contain Radarr-specific fields, not Lidarr fields
      const radarrItem = radarrPayload.items[0] as RadarrLibraryItem;
      assertExists(radarrItem.tmdbId);
      assertEquals((radarrItem as unknown as Record<string, unknown>).artistName, undefined);
    });
  }
}

const test = new LidarrApiParityTest();
await test.runTests();
