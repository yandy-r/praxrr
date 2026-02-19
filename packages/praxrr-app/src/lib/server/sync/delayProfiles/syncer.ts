/**
 * Delay profile syncer
 *
 * Syncs a single delay profile from PCD to the arr instance's default profile.
 * For Sonarr/Radarr this is id=1. For Lidarr we resolve the active default at runtime
 * (untagged, lowest order).
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getCache } from '$pcd/index.ts';
import { getByName as getDelayProfileByName } from '$pcd/entities/delayProfiles/index.ts';
import type { DelayProfilesRow } from '$shared/pcd/display.ts';
import type { ArrDelayProfile } from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { logger } from '$logger/logger.ts';

export class DelayProfileSyncer extends BaseSyncer {
  protected get syncType(): string {
    return 'delay profile';
  }

  /**
   * Override sync to handle single profile update to id=1
   */
  override async sync(): Promise<SyncResult> {
    const syncConfig = arrSyncQueries.getDelayProfilesSync(this.instanceId);

    if (!syncConfig.databaseId || !syncConfig.profileName) {
      await logger.debug('No delay profile configured for sync', {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId },
      });
      return { success: true, itemsSynced: 0 };
    }

    const cache = getCache(syncConfig.databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${syncConfig.databaseId}`, {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId },
      });
      return { success: false, itemsSynced: 0, error: 'PCD cache not found' };
    }

    const profile = await getDelayProfileByName(cache, syncConfig.profileName);
    if (!profile) {
      await logger.warn(`Profile "${syncConfig.profileName}" not found`, {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId, profileName: syncConfig.profileName },
      });
      return { success: false, itemsSynced: 0, error: 'Profile not found in PCD' };
    }

    const targetProfile = await this.resolveTargetDelayProfile();
    const profileId = targetProfile?.id ?? 1;
    const transformed = this.transform(profile);
    await logger.debug(`Syncing "${profile.name}" delay profile`, {
      source: 'Sync:DelayProfile',
      meta: { instanceId: this.instanceId, profileName: profile.name, targetProfileId: profileId },
    });

    const existingProfile = this.client instanceof LidarrClient ? targetProfile : null;

    const payload = existingProfile
      ? {
          ...existingProfile,
          ...transformed,
          id: existingProfile.id,
          order: existingProfile.order,
          tags: Array.isArray(existingProfile.tags) ? existingProfile.tags : [],
        }
      : transformed;

    await this.client.updateDelayProfile(profileId, payload);

    await logger.info(`Synced delay profile "${profile.name}" to "${this.instanceName}"`, {
      source: 'Sync:DelayProfile',
      meta: { instanceId: this.instanceId, remoteId: profileId },
    });

    return { success: true, itemsSynced: 1 };
  }

  /**
   * Lidarr can expose delay profiles with different default IDs over time.
   * Use the default (untagged, lowest order) profile when syncing, falling
   * back to id 1 when we cannot resolve it.
   */
  private async resolveTargetDelayProfile(): Promise<ArrDelayProfile | null> {
    if (!(this.client instanceof LidarrClient)) {
      return null;
    }

    const profiles = await this.client.getDelayProfiles();
    if (profiles.length === 0) {
      return null;
    }

    const untaggedProfiles = profiles.filter(
      (profile) => !Array.isArray(profile.tags) || profile.tags.length === 0
    );
    const candidates = untaggedProfiles.length > 0 ? untaggedProfiles : profiles;

    const defaultProfile = candidates.reduce((winner, current) =>
      current.order < winner.order ? current : winner
    );

    return defaultProfile;
  }

  private transform(profile: DelayProfilesRow): ArrDelayProfile {
    let enableUsenet = true;
    let enableTorrent = true;
    let preferredProtocol = 'usenet';

    switch (profile.preferred_protocol) {
      case 'prefer_usenet':
        enableUsenet = true;
        enableTorrent = true;
        preferredProtocol = 'usenet';
        break;
      case 'prefer_torrent':
        enableUsenet = true;
        enableTorrent = true;
        preferredProtocol = 'torrent';
        break;
      case 'only_usenet':
        enableUsenet = true;
        enableTorrent = false;
        preferredProtocol = 'usenet';
        break;
      case 'only_torrent':
        enableUsenet = false;
        enableTorrent = true;
        preferredProtocol = 'torrent';
        break;
    }

    return {
      id: 1,
      enableUsenet,
      enableTorrent,
      preferredProtocol,
      usenetDelay: profile.usenet_delay ?? 0,
      torrentDelay: profile.torrent_delay ?? 0,
      bypassIfHighestQuality: profile.bypass_if_highest_quality,
      bypassIfAboveCustomFormatScore: profile.bypass_if_above_custom_format_score,
      minimumCustomFormatScore: profile.minimum_custom_format_score ?? 0,
      order: 2147483647, // Default profile order
      tags: [], // Default profile must have empty tags
    };
  }

  // Base class abstract methods - not used since we override sync()
  protected async fetchFromPcd(): Promise<unknown[]> {
    return [];
  }

  protected transformToArr(_pcdData: unknown[]): unknown[] {
    return [];
  }

  protected async pushToArr(_arrData: unknown[]): Promise<void> {}
}
