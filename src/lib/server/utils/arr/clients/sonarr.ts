import { BaseArrClient } from '../base.ts';
import type {
  SonarrSeries,
  SonarrRelease,
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrEpisodeItem,
  SonarrLibraryItem,
  RadarrQualityProfile,
  ArrCommand,
  RenamePreviewItem,
} from '../types.ts';

/**
 * Sonarr API client
 * Extends BaseArrClient with Sonarr-specific API methods
 */
export class SonarrClient extends BaseArrClient {
  // =========================================================================
  // Series Methods
  // =========================================================================

  /**
   * Get all series
   */
  getAllSeries(): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>(`/api/${this.apiVersion}/series`);
  }

  /**
   * Get a specific series by ID
   * Includes season information with statistics
   */
  getSeries(seriesId: number): Promise<SonarrSeries> {
    return this.get<SonarrSeries>(`/api/${this.apiVersion}/series/${seriesId}`);
  }

  // =========================================================================
  // Episode Methods
  // =========================================================================

  /**
   * Get all episodes for a series
   */
  getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
    return this.get<SonarrEpisode[]>(`/api/${this.apiVersion}/episode?seriesId=${seriesId}`);
  }

  /**
   * Get all episode files for a series
   */
  getEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    return this.get<SonarrEpisodeFile[]>(`/api/${this.apiVersion}/episodefile?seriesId=${seriesId}`);
  }

  // =========================================================================
  // Library Methods
  // =========================================================================

  /**
   * Get quality profiles (override for proper typing)
   */
  override getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    return this.get<RadarrQualityProfile[]>(`/api/${this.apiVersion}/qualityprofile`);
  }

  /**
   * Fetch and compute library data (series-level, no episode details)
   * Makes 2 API calls: series and quality profiles
   * @param praxrrProfileNames - Set of profile names from Praxrr databases
   */
  async getLibrary(praxrrProfileNames?: Set<string>): Promise<SonarrLibraryItem[]> {
    const [allSeries, profiles] = await Promise.all([this.getAllSeries(), this.getQualityProfiles()]);

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    return allSeries.map((series) => {
      const profile = profileMap.get(series.qualityProfileId);
      const profileName = profile?.name ?? 'Unknown';

      return {
        id: series.id,
        tvdbId: series.tvdbId,
        title: series.title,
        year: series.year,
        qualityProfileId: series.qualityProfileId,
        qualityProfileName: profileName,
        status: series.status,
        monitored: series.monitored,
        seasonCount: series.statistics?.seasonCount ?? series.seasons.length,
        episodeCount: series.statistics?.episodeCount ?? 0,
        episodeFileCount: series.statistics?.episodeFileCount ?? 0,
        totalEpisodeCount: series.statistics?.totalEpisodeCount ?? 0,
        sizeOnDisk: series.statistics?.sizeOnDisk ?? 0,
        percentOfEpisodes: series.statistics?.percentOfEpisodes ?? 0,
        dateAdded: series.added,
        seasons: series.seasons.map((s) => ({
          seasonNumber: s.seasonNumber,
          monitored: s.monitored,
          episodeCount: s.statistics.episodeCount,
          episodeFileCount: s.statistics.episodeFileCount,
          totalEpisodeCount: s.statistics.totalEpisodeCount,
          sizeOnDisk: s.statistics.sizeOnDisk,
          percentOfEpisodes: s.statistics.percentOfEpisodes,
        })),
        isPraxrrProfile: praxrrProfileNames?.has(profileName) ?? false,
      };
    });
  }

  /**
   * Fetch episode details for a series (lazy-loaded on expand)
   * Fetches episodes + episode files, joins them, computes scores
   * @param seriesId - The series to fetch episode details for
   * @param profile - The quality profile for score computation
   */
  async getSeriesEpisodeDetails(seriesId: number, profile: RadarrQualityProfile): Promise<SonarrEpisodeItem[]> {
    const [episodes, episodeFiles] = await Promise.all([this.getEpisodes(seriesId), this.getEpisodeFiles(seriesId)]);

    // Create episode file lookup by ID
    const fileMap = new Map(episodeFiles.map((f) => [f.id, f]));

    const cutoffScore = profile.cutoffFormatScore ?? 0;

    return episodes.map((ep) => {
      const file = ep.episodeFileId ? fileMap.get(ep.episodeFileId) : undefined;

      const customFormats = file?.customFormats ?? [];
      const customFormatScore = file?.customFormatScore ?? 0;
      const scoreBreakdown = file ? this.computeScoreBreakdown(customFormats, profile.formatItems) : [];
      const progress = cutoffScore > 0 ? customFormatScore / cutoffScore : 0;

      return {
        id: ep.id,
        episodeNumber: ep.episodeNumber,
        seasonNumber: ep.seasonNumber,
        title: ep.title,
        hasFile: ep.hasFile,
        monitored: ep.monitored,
        qualityName: file?.quality?.quality?.name,
        fileName: file?.relativePath?.split('/').pop(),
        size: file?.size,
        customFormats,
        customFormatScore,
        scoreBreakdown,
        cutoffScore,
        progress,
        cutoffMet: file ? !file.qualityCutoffNotMet : false,
      };
    });
  }

  // =========================================================================
  // Search Methods
  // =========================================================================

  /**
   * Get releases for a series/season (interactive search)
   * Queries all configured indexers and returns available releases
   * Note: This can take several seconds as it searches indexers in real-time
   *
   * @param seriesId - The series ID
   * @param seasonNumber - The season number to search
   * @returns Array of releases from indexers
   */
  getReleases(seriesId: number, seasonNumber: number): Promise<SonarrRelease[]> {
    return this.get<SonarrRelease[]>(
      `/api/${this.apiVersion}/release?seriesId=${seriesId}&seasonNumber=${seasonNumber}`
    );
  }

  /**
   * Get only season pack releases (fullSeason: true)
   * Filters out individual episode releases
   */
  async getSeasonPackReleases(seriesId: number, seasonNumber: number): Promise<SonarrRelease[]> {
    const releases = await this.getReleases(seriesId, seasonNumber);
    return releases.filter((r) => r.fullSeason);
  }

  // =========================================================================
  // Rename Methods
  // =========================================================================

  /**
   * Get rename preview for a series
   * Shows what files would be renamed without making changes
   */
  getRenamePreview(seriesId: number): Promise<RenamePreviewItem[]> {
    return this.get<RenamePreviewItem[]>(`/api/${this.apiVersion}/rename?seriesId=${seriesId}`);
  }

  /**
   * Trigger rename for series
   * Renames all files that need renaming for the given series IDs
   */
  renameSeries(seriesIds: number[]): Promise<ArrCommand> {
    return this.post<ArrCommand>(`/api/${this.apiVersion}/command`, {
      name: 'RenameSeries',
      seriesIds,
    });
  }

  /**
   * Refresh series (update metadata from sources)
   * Required after folder rename to update paths
   */
  refreshSeries(seriesIds: number[]): Promise<ArrCommand> {
    return this.post<ArrCommand>(`/api/${this.apiVersion}/command`, {
      name: 'RefreshSeries',
      seriesIds,
    });
  }

  /**
   * Rename series folders using the series editor endpoint
   * Bulk updates series root folder paths
   */
  renameSeriesFolders(seriesIds: number[], rootFolderPath: string): Promise<void> {
    return this.put<void>(`/api/${this.apiVersion}/series/editor`, {
      seriesIds,
      rootFolderPath,
      moveFiles: true,
    });
  }
}
