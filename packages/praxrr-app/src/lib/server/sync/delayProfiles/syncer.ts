/**
 * Delay profile syncer
 *
 * Syncs a single delay profile from PCD to the arr instance's default profile.
 * For Sonarr/Radarr this is id=1. For Lidarr we resolve the active default at runtime
 * (untagged, lowest order).
 */

import { BaseSyncer, type SyncResult } from '../base.ts';
import type { SyncEntityOutcome } from '../types.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { getCache } from '$pcd/index.ts';
import { getByName as getDelayProfileByName } from '$pcd/entities/delayProfiles/index.ts';
import type { DelayProfilesRow } from '$shared/pcd/display.ts';
import type { ArrDelayProfile } from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { RadarrClient } from '$arr/clients/radarr.ts';
import { SonarrClient } from '$arr/clients/sonarr.ts';
import type { DelayProfilesPreview, SyncPreviewPreparedExecutionContext } from '../preview/types.ts';
import { logger } from '$logger/logger.ts';
import { diffSingletonEntity } from '../preview/sectionDiffs.ts';
import { getUnsupportedSyncSectionReason, isSyncSectionSupported, type SyncArrType } from '../mappings.ts';

interface DelayProfilesPreviewConfig {
  databaseId: number | null;
  profileName: string | null;
}

type DelayProfileTargetResolution =
  | {
      arrType: 'radarr' | 'sonarr';
      strategy: 'fixed-default-id';
      requestedId: 1;
      selectedId: number;
    }
  | {
      arrType: 'lidarr';
      strategy: 'untagged-lowest-order';
      selectedId: number;
      candidates: Array<{
        id: number;
        order: number;
        tags: number[];
      }>;
    }
  | {
      arrType: 'lidarr';
      strategy: 'fixed-default-id-fallback';
      requestedId: 1;
      selectedId: number;
      candidates: [];
    };

interface ResolvedDelayProfileTarget {
  profile: ArrDelayProfile;
  resolution: DelayProfileTargetResolution;
}

interface DelayProfilePreparedExecutionContext extends SyncPreviewPreparedExecutionContext {
  readonly section: 'delayProfiles';
  readonly config: {
    readonly databaseId: number;
    readonly profileName: string;
  };
  readonly desired: ArrDelayProfile;
  readonly materialPlan: {
    readonly arrType: SyncArrType;
    readonly profileName: string;
    readonly targetProfileId: number;
    readonly targetResolution: DelayProfileTargetResolution;
  };
  readonly currentGuards: {
    readonly targetProfile: ArrDelayProfile;
    readonly targetResolution: DelayProfileTargetResolution;
  };
}

function parseDelayProfilesPreviewConfig(rawConfig: unknown): DelayProfilesPreviewConfig | null {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return null;
  }

  const value = rawConfig as Record<string, unknown>;
  if (!('databaseId' in value) || !('profileName' in value)) {
    return null;
  }

  const rawDatabaseId = value.databaseId;
  const rawProfileName = value.profileName;
  const databaseId = rawDatabaseId === null || rawDatabaseId === undefined ? null : parsePositiveInt(rawDatabaseId);
  const profileName = typeof rawProfileName === 'string' && rawProfileName.length > 0 ? rawProfileName : null;

  if (databaseId === null && profileName === null) {
    return {
      databaseId: null,
      profileName: null,
    };
  }

  if (databaseId === null || profileName === null) {
    return null;
  }

  return {
    databaseId,
    profileName,
  };
}

function parsePositiveInt(rawValue: unknown): number | null {
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue <= 0) {
    return null;
  }

  return rawValue;
}

export class DelayProfileSyncer extends BaseSyncer {
  protected get syncType(): string {
    return 'delay profile';
  }

  override async generatePreview(): Promise<Readonly<DelayProfilesPreview>> {
    try {
      await logger.info(`Generating delay profile preview for "${this.instanceName}"`, {
        source: 'Preview:DelayProfile',
        meta: { instanceId: this.instanceId },
      });

      const instanceType = this.getSyncArrType();
      if (!instanceType) {
        await logger.warn('Delay profile preview unsupported for this arr type', {
          source: 'Preview:DelayProfile',
          meta: { instanceId: this.instanceId },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            subsection: 'delayProfile',
            code: 'unsupported_arr_type',
            reason: 'Delay profile preview is not supported for this arr instance type',
          })
        );
      }

      if (!isSyncSectionSupported(instanceType, 'delayProfiles')) {
        await logger.error(`Delay profile preview unsupported for ${instanceType}`, {
          source: 'Preview:DelayProfile',
          meta: { instanceId: this.instanceId, instanceType },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            code: 'unsupported_arr_type',
            reason:
              getUnsupportedSyncSectionReason(instanceType, 'delayProfiles') ??
              `Delay profile preview is not supported for ${instanceType}`,
          })
        );
      }

      this.recordPreviewEvidence('delayProfiles', 'arr', 'materialCapabilities', {
        arrType: instanceType,
        delayProfilesSupported: true,
        targetResolution: instanceType === 'lidarr' ? 'untagged-lowest-order' : 'fixed-default-id',
      });

      const syncConfig = this.getDelayProfilesSyncConfig();
      if (!syncConfig.databaseId || !syncConfig.profileName) {
        await logger.warn('Missing delay profile configuration for preview', {
          source: 'Preview:DelayProfile',
          meta: {
            instanceId: this.instanceId,
            section: 'delayProfiles',
            code: 'missing_required_config',
          },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            code: 'missing_required_config',
            reason: 'Delay profile preview requires both databaseId and profileName',
          })
        );
      }

      const effectiveConfig = {
        databaseId: syncConfig.databaseId,
        profileName: syncConfig.profileName,
      };
      this.recordPreviewEvidence('delayProfiles', 'pcd', 'selectedConfig', effectiveConfig);

      const cache = getCache(syncConfig.databaseId);
      if (!cache) {
        await logger.warn(`PCD cache not found for database ${syncConfig.databaseId}`, {
          source: 'Preview:DelayProfile',
          meta: { instanceId: this.instanceId },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            code: 'pcd_cache_not_found',
            reason: `PCD cache not found for databaseId ${syncConfig.databaseId}`,
            databaseId: syncConfig.databaseId,
          })
        );
      }

      const profile = await getDelayProfileByName(cache, syncConfig.profileName);
      if (!profile) {
        await logger.warn(`Profile "${syncConfig.profileName}" not found`, {
          source: 'Preview:DelayProfile',
          meta: { instanceId: this.instanceId, profileName: syncConfig.profileName },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            code: 'pcd_profile_not_found',
            reason: `Delay profile "${syncConfig.profileName}" not found in PCD`,
            profileName: syncConfig.profileName,
          })
        );
      }

      this.recordPreviewEvidence('delayProfiles', 'pcd', 'selectedProfile', profile);

      const target = await this.resolveTargetDelayProfileForPreview(instanceType);
      if (!target) {
        await logger.error('Failed to locate delay profile target for preview', {
          source: 'Preview:DelayProfile',
          meta: { instanceId: this.instanceId },
        });
        throw new Error(
          JSON.stringify({
            section: 'delayProfiles',
            code: 'remote_profile_not_found',
            reason: 'No delay profile target could be read from arr for preview',
          })
        );
      }

      const transformed = this.transform(profile);
      this.recordPreviewEvidence('delayProfiles', 'pcd', 'transformedDesiredProfile', transformed);

      const payload = {
        ...target.profile,
        ...transformed,
        id: target.profile.id,
        order: target.profile.order,
        tags: Array.isArray(target.profile.tags) ? target.profile.tags : [],
      };

      this.recordPreviewEvidence('delayProfiles', 'arr', 'targetResolution', target.resolution);
      this.recordPreviewEvidence('delayProfiles', 'arr', 'liveTargetProfile', target.profile);
      this.recordPreviewEvidence('delayProfiles', 'arr', 'remoteIdentity', {
        id: target.profile.id,
        order: target.profile.order,
        tags: Array.isArray(target.profile.tags) ? target.profile.tags : [],
      });

      this.preparePreviewExecution({
        section: 'delayProfiles',
        config: effectiveConfig,
        desired: payload,
        materialPlan: {
          arrType: instanceType,
          profileName: profile.name,
          targetProfileId: target.profile.id,
          targetResolution: target.resolution,
        },
        currentGuards: {
          targetProfile: target.profile,
          targetResolution: target.resolution,
        },
      } satisfies DelayProfilePreparedExecutionContext);

      const profileChange = diffSingletonEntity({
        entityType: 'delayProfile',
        name: profile.name,
        desiredEntity: payload as ArrDelayProfile & Record<string, unknown>,
        currentEntity: target.profile as ArrDelayProfile & Record<string, unknown>,
      });

      await logger.info(`Generated delay profile preview for "${this.instanceName}"`, {
        source: 'Preview:DelayProfile',
        meta: {
          instanceId: this.instanceId,
          profileName: profile.name,
          action: profileChange.action,
          fieldCount: profileChange.fields.length,
        },
      });

      return {
        section: 'delayProfiles',
        profile: profileChange,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed to generate delay profile preview for "${this.instanceName}"`, {
        source: 'Preview:DelayProfile',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      throw error instanceof Error ? error : new Error(errorMsg);
    }
  }

  private async resolveTargetDelayProfileForPreview(arrType: SyncArrType): Promise<ResolvedDelayProfileTarget | null> {
    if (arrType === 'lidarr') {
      if (!(this.client instanceof LidarrClient)) {
        return null;
      }

      const profiles = await this.client.getDelayProfiles();
      const candidates = this.toDeterministicLidarrCandidates(profiles);
      const profile = this.selectLidarrTargetProfile(profiles);
      if (profile) {
        return {
          profile,
          resolution: {
            arrType: 'lidarr',
            strategy: 'untagged-lowest-order',
            selectedId: profile.id,
            candidates,
          },
        };
      }

      const fallback = await this.client.getDelayProfile(1);
      return {
        profile: fallback,
        resolution: {
          arrType: 'lidarr',
          strategy: 'fixed-default-id-fallback',
          requestedId: 1,
          selectedId: fallback.id,
          candidates: [],
        },
      };
    }

    const expectedClient = arrType === 'sonarr' ? SonarrClient : RadarrClient;
    if (!(this.client instanceof expectedClient)) {
      return null;
    }

    const profile = await this.client.getDelayProfile(1);
    return {
      profile,
      resolution: {
        arrType,
        strategy: 'fixed-default-id',
        requestedId: 1,
        selectedId: profile.id,
      },
    };
  }

  private getDelayProfilesSyncConfig(): { databaseId: number | null; profileName: string | null } {
    const previewConfig = parseDelayProfilesPreviewConfig(this.getPreviewConfig());
    if (previewConfig) {
      return previewConfig;
    }

    return arrSyncQueries.getDelayProfilesSync(this.instanceId);
  }

  private getSyncArrType(): SyncArrType | null {
    if (this.client instanceof LidarrClient) return 'lidarr';
    if (this.client instanceof SonarrClient) return 'sonarr';
    if (this.client instanceof RadarrClient) return 'radarr';

    return null;
  }

  /**
   * Override sync to handle single profile update to id=1
   */
  override async sync(): Promise<SyncResult> {
    try {
      return await this.syncOnce();
    } finally {
      this.clearPreparedExecutionContext();
      this.clearPreviewConfig();
    }
  }

  private async syncOnce(): Promise<SyncResult> {
    const prepared = this.getPreparedDelayProfileExecution();
    const syncConfig = prepared?.config ?? this.getDelayProfilesSyncConfig();
    const arrType = this.getSyncArrType();

    if (!syncConfig.databaseId || !syncConfig.profileName) {
      await logger.debug('No delay profile configured for sync', {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId },
      });
      return { success: true, itemsSynced: 0, outcomes: [] };
    }

    if (!arrType) {
      // Unsupported instance type for delay profiles — no entity was attempted.
      return {
        success: false,
        itemsSynced: 0,
        error: 'Delay profiles are not supported for this arr instance type',
        outcomes: [],
      };
    }

    const profileName = syncConfig.profileName;
    const outcome = (
      status: SyncEntityOutcome['status'],
      remoteId: string | null,
      reason: string | null
    ): SyncEntityOutcome => ({
      section: 'delayProfiles',
      arrType,
      entityType: 'delayProfile',
      name: profileName,
      action: 'update',
      status,
      remoteId,
      reason,
    });

    if (prepared) {
      if (prepared.materialPlan.arrType !== arrType) {
        return {
          success: false,
          itemsSynced: 0,
          error: 'Reviewed delay profile target type does not match the active arr client',
          outcomes: [],
        };
      }

      const targetProfileId = prepared.currentGuards.targetProfile.id;
      const payload = structuredClone(prepared.desired);
      return await this.writeDelayProfile(prepared.materialPlan.profileName, targetProfileId, payload, outcome);
    }

    const cache = getCache(syncConfig.databaseId);
    if (!cache) {
      // Source data unavailable (no Arr write attempted) → skipped, not a write failure. Matches
      // the qualityProfiles cache-not-found classification so the same condition never yields a
      // different run status across sections (issue #232 review).
      await logger.warn(`PCD cache not found for database ${syncConfig.databaseId}`, {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId },
      });
      return {
        success: true,
        itemsSynced: 0,
        outcomes: [outcome('skipped', null, `PCD cache not available for database ${syncConfig.databaseId}.`)],
      };
    }

    const profile = await getDelayProfileByName(cache, profileName);
    if (!profile) {
      await logger.warn(`Profile "${profileName}" not found`, {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId, profileName },
      });
      return {
        success: true,
        itemsSynced: 0,
        outcomes: [outcome('skipped', null, `Delay profile "${profileName}" not found in its source database.`)],
      };
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

    return await this.writeDelayProfile(profile.name, profileId, payload, outcome);
  }

  private async writeDelayProfile(
    profileName: string,
    profileId: number,
    payload: ArrDelayProfile,
    outcome: (status: SyncEntityOutcome['status'], remoteId: string | null, reason: string | null) => SyncEntityOutcome
  ): Promise<SyncResult> {
    try {
      await this.client.updateDelayProfile(profileId, payload);
    } catch (error) {
      const { reason, protectedDetails } = sanitizeArrWriteError(error);
      await logger.error(`Failed to sync delay profile "${profileName}" to "${this.instanceName}"`, {
        source: 'Sync:DelayProfile',
        meta: { instanceId: this.instanceId, targetProfileId: profileId, ...protectedDetails },
      });
      return {
        success: false,
        itemsSynced: 0,
        error: reason,
        outcomes: [outcome('failed', String(profileId), reason)],
      };
    }

    await logger.info(`Synced delay profile "${profileName}" to "${this.instanceName}"`, {
      source: 'Sync:DelayProfile',
      meta: { instanceId: this.instanceId, remoteId: profileId },
    });

    return { success: true, itemsSynced: 1, outcomes: [outcome('success', String(profileId), null)] };
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

    return this.selectLidarrTargetProfile(await this.client.getDelayProfiles());
  }

  private selectLidarrTargetProfile(profiles: ArrDelayProfile[]): ArrDelayProfile | null {
    if (profiles.length === 0) {
      return null;
    }

    const untaggedProfiles = profiles.filter((profile) => !Array.isArray(profile.tags) || profile.tags.length === 0);
    const candidates = untaggedProfiles.length > 0 ? untaggedProfiles : profiles;

    return candidates.reduce((winner, current) => (current.order < winner.order ? current : winner));
  }

  private toDeterministicLidarrCandidates(
    profiles: ArrDelayProfile[]
  ): Array<{ id: number; order: number; tags: number[] }> {
    return profiles
      .map((profile) => ({
        id: profile.id,
        order: profile.order,
        tags: Array.isArray(profile.tags) ? [...profile.tags].sort((left, right) => left - right) : [],
      }))
      .sort((left, right) => left.id - right.id);
  }

  private getPreparedDelayProfileExecution(): Readonly<DelayProfilePreparedExecutionContext> | null {
    const context = this.getPreparedExecutionContext<DelayProfilePreparedExecutionContext>();
    if (!context) {
      return null;
    }

    if (
      context.section !== 'delayProfiles' ||
      context.config.databaseId <= 0 ||
      context.config.profileName.length === 0 ||
      context.desired.id !== context.currentGuards.targetProfile.id ||
      context.materialPlan.targetProfileId !== context.currentGuards.targetProfile.id
    ) {
      throw new TypeError('Invalid reviewed delay profile execution context');
    }

    return context;
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
