import { BaseArrClient } from '../base.ts';
import type {
  LidarrAlbum,
  LidarrArtist,
  LidarrLibraryItem,
  LidarrProfileJoinResult,
  LidarrProfileLookup,
  LidarrProfileLookupItem,
  LidarrRelease,
  LidarrMetadataProfileGetResponse,
  LidarrMetadataProfileCreatePayload,
  LidarrMetadataProfileListResponse,
  LidarrMetadataProfileSchema,
  LidarrMetadataProfileUpdatePayload,
} from '../types.ts';

/**
 * Lidarr API client
 * Extends BaseArrClient with Lidarr-specific API methods
 * Note: Lidarr uses API v1, not v3 like other *arr apps
 */
export class LidarrClient extends BaseArrClient {
  protected override apiVersion: string = 'v1'; // Lidarr uses v1 API

  // =========================================================================
  // Artist Methods
  // =========================================================================

  /**
   * Get all artists
   */
  getArtists(): Promise<LidarrArtist[]> {
    return this.get<LidarrArtist[]>(`/api/${this.apiVersion}/artist`);
  }

  // =========================================================================
  // Album Methods
  // =========================================================================

  /**
   * Get albums, optionally filtered by artist IDs
   */
  async getAlbums(artistIds?: number[]): Promise<LidarrAlbum[]> {
    if (!artistIds) {
      return this.get<LidarrAlbum[]>(`/api/${this.apiVersion}/album`);
    }

    const uniqueArtistIds = [...new Set(artistIds)];
    if (uniqueArtistIds.length === 0) {
      return [];
    }

    if (uniqueArtistIds.length === 1) {
      return this.get<LidarrAlbum[]>(`/api/${this.apiVersion}/album?artistId=${uniqueArtistIds[0]}`);
    }

    const albums = await this.get<LidarrAlbum[]>(`/api/${this.apiVersion}/album`);
    const artistIdSet = new Set(uniqueArtistIds);
    return albums.filter((album) => artistIdSet.has(album.artistId));
  }

  // =========================================================================
  // Library Methods
  // =========================================================================

  /**
   * Fetch and compute Lidarr library data (album-level)
   * Joins albums with artists and quality profiles to provide a normalized route contract.
   * Makes 3 API calls: artists, quality profiles, and albums
   * @param praxrrProfileNames - Set of profile names from Praxrr databases
   */
  async getLibrary(praxrrProfileNames?: Set<string>): Promise<LidarrLibraryItem[]> {
    const [artists, profiles] = await Promise.all([this.getArtists(), this.getQualityProfiles()]);

    const profileLookupEntries: Array<[number, LidarrProfileLookupItem]> = profiles.map((profile) => [
      profile.id,
      {
        id: profile.id,
        name: profile.name,
      },
    ]);
    const profileLookup: LidarrProfileLookup = new Map(profileLookupEntries);
    const artistLookup = new Map(artists.map((artist) => [artist.id, artist]));

    const albums = await this.getAlbums(artists.map((artist) => artist.id));

    return albums.map((album) => {
      const artist = artistLookup.get(album.artistId);
      const qualityProfileId = this.resolveQualityProfileId(album, artist);
      const profileJoin = this.resolveProfileJoin(qualityProfileId, profileLookup, praxrrProfileNames);
      const releaseDate = album.releaseDate ?? undefined;
      const year = this.getReleaseYear(releaseDate);
      const stats = album.statistics;
      const foreignArtistId = artist?.foreignArtistId ?? album.artist?.foreignArtistId ?? undefined;

      return {
        id: album.id,
        artistId: album.artistId,
        foreignArtistId,
        artistName: artist?.artistName ?? album.artist?.artistName ?? 'Unknown Artist',
        title: album.title ?? 'Unknown Album',
        year,
        albumType: album.albumType ?? undefined,
        releaseDate,
        status: artist?.status,
        monitored: album.monitored,
        trackFileCount: stats?.trackFileCount ?? 0,
        trackCount: stats?.trackCount ?? 0,
        totalTrackCount: stats?.totalTrackCount ?? 0,
        sizeOnDisk: stats?.sizeOnDisk ?? 0,
        percentOfTracks: stats?.percentOfTracks ?? 0,
        dateAdded: artist?.added,
        ...profileJoin,
      };
    });
  }

  // =========================================================================
  // Search Methods
  // =========================================================================

  /**
   * Get releases for an album (interactive search)
   * Queries all configured indexers and returns available releases
   * Note: This can take several seconds as it searches indexers in real-time
   */
  getReleases(albumId: number): Promise<LidarrRelease[]> {
    return this.get<LidarrRelease[]>(`/api/${this.apiVersion}/release?albumId=${albumId}`);
  }

  // =========================================================================
  // Metadata Profile Methods
  // =========================================================================

  /**
   * Get all metadata profiles
   */
  getMetadataProfiles(): Promise<LidarrMetadataProfileListResponse> {
    return this.get<LidarrMetadataProfileListResponse>(`/api/${this.apiVersion}/metadataprofile`);
  }

  /**
   * Get a metadata profile by ID
   */
  getMetadataProfile(id: number): Promise<LidarrMetadataProfileGetResponse> {
    return this.get<LidarrMetadataProfileGetResponse>(`/api/${this.apiVersion}/metadataprofile/${id}`);
  }

  /**
   * Get metadata profile schema defaults
   */
  getMetadataProfileSchema(): Promise<LidarrMetadataProfileSchema> {
    return this.get<LidarrMetadataProfileSchema>(`/api/${this.apiVersion}/metadataprofile/schema`);
  }

  /**
   * Create a metadata profile
   */
  createMetadataProfile(profile: LidarrMetadataProfileCreatePayload): Promise<LidarrMetadataProfileGetResponse> {
    return this.post<LidarrMetadataProfileGetResponse>(`/api/${this.apiVersion}/metadataprofile`, profile);
  }

  /**
   * Update a metadata profile
   */
  updateMetadataProfile(id: number, profile: LidarrMetadataProfileUpdatePayload): Promise<LidarrMetadataProfileGetResponse> {
    return this.put<LidarrMetadataProfileGetResponse>(`/api/${this.apiVersion}/metadataprofile/${id}`, {
      ...profile,
      id,
    });
  }

  /**
   * Delete a metadata profile
   */
  deleteMetadataProfile(id: number): Promise<void> {
    return this.delete(`/api/${this.apiVersion}/metadataprofile/${id}`);
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Resolve the quality profile ID for an album.
   * Lidarr stores profile assignment at the artist level (qualityProfileId),
   * but albums may carry a profileId override.
   */
  private resolveQualityProfileId(album: LidarrAlbum, artist?: LidarrArtist): number {
    if (album.profileId > 0) {
      return album.profileId;
    }

    if (artist?.qualityProfileId && artist.qualityProfileId > 0) {
      return artist.qualityProfileId;
    }

    if (album.artist?.qualityProfileId && album.artist.qualityProfileId > 0) {
      return album.artist.qualityProfileId;
    }

    return 0;
  }

  /**
   * Join a resolved profile ID against the profile lookup and Praxrr names
   */
  private resolveProfileJoin(
    qualityProfileId: number,
    profileLookup: LidarrProfileLookup,
    praxrrProfileNames?: Set<string>
  ): LidarrProfileJoinResult {
    const qualityProfileName = profileLookup.get(qualityProfileId)?.name ?? 'Unknown';
    return {
      qualityProfileId,
      qualityProfileName,
      isPraxrrProfile: praxrrProfileNames?.has(qualityProfileName) ?? false,
    };
  }

  /**
   * Extract the release year from an ISO date string
   */
  private getReleaseYear(releaseDate?: string): number | undefined {
    if (!releaseDate) {
      return undefined;
    }

    const timestamp = Date.parse(releaseDate);
    if (Number.isNaN(timestamp)) {
      return undefined;
    }

    return new Date(timestamp).getUTCFullYear();
  }
}
