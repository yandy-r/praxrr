/**
 * Quality profiles section handler
 */

import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { trashGuideSyncQueries } from '$db/queries/trashGuideSync.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { QualityProfileSyncer } from './syncer.ts';
import type { SyncArrType } from '../mappings.ts';
import { registerSection, type SectionHandler, type ScheduledConfig } from '../registry.ts';

export const qualityProfilesHandler: SectionHandler = {
  type: 'qualityProfiles',

  setShouldSync(instanceId: number, value: boolean): void {
    arrSyncQueries.setQualityProfilesShouldSync(instanceId, value);
  },

  setNextRunAt(instanceId: number, nextRunAt: string | null): void {
    arrSyncQueries.setQualityProfilesNextRunAt(instanceId, nextRunAt);
  },

  claimSync(instanceId: number): boolean {
    return arrSyncQueries.claimQualityProfilesSync(instanceId);
  },

  completeSync(instanceId: number): void {
    arrSyncQueries.completeQualityProfilesSync(instanceId);
  },

  failSync(instanceId: number, error: string): void {
    arrSyncQueries.failQualityProfilesSync(instanceId, error);
  },

  setStatusPending(instanceId: number): void {
    arrSyncQueries.setQualityProfilesStatusPending(instanceId);
  },

  getPendingInstanceIds(): number[] {
    return arrSyncQueries.getPendingSyncs().qualityProfiles;
  },

  getScheduledConfigs(): ScheduledConfig[] {
    return arrSyncQueries.getScheduledConfigs().qualityProfiles;
  },

  createSyncer(client: BaseArrClient, instance: ArrInstance) {
    return new QualityProfileSyncer(client, instance.id, instance.name, instance.type as SyncArrType);
  },

  hasConfig(instanceId: number): boolean {
    const config = arrSyncQueries.getQualityProfilesSync(instanceId);
    if (config.selections.length > 0) {
      return true;
    }

    // Also check TRaSH Guide quality profile selections
    const trashHydrations = trashGuideSyncQueries.getQualityProfileSourceHydrationByInstance(instanceId);
    return trashHydrations.some((h) => h.selectedQualityProfiles.length > 0);
  },
};

// Register on import
registerSection(qualityProfilesHandler);
