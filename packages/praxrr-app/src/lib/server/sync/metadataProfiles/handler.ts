/**
 * Metadata profiles section handler
 */

import { arrSyncQueries } from '$db/queries/arrSync.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { MetadataProfileSyncer } from './syncer.ts';
import { registerSection, type SectionHandler, type ScheduledConfig } from '../registry.ts';

export const metadataProfilesHandler: SectionHandler = {
  type: 'metadataProfiles',

  setShouldSync(instanceId: number, value: boolean): void {
    arrSyncQueries.setMetadataProfilesShouldSync(instanceId, value);
  },

  setNextRunAt(instanceId: number, nextRunAt: string | null): void {
    arrSyncQueries.setMetadataProfilesNextRunAt(instanceId, nextRunAt);
  },

  claimSync(instanceId: number): boolean {
    return arrSyncQueries.claimMetadataProfilesSync(instanceId);
  },

  completeSync(instanceId: number): void {
    arrSyncQueries.completeMetadataProfilesSync(instanceId);
  },

  failSync(instanceId: number, error: string): void {
    arrSyncQueries.failMetadataProfilesSync(instanceId, error);
  },

  setStatusPending(instanceId: number): void {
    arrSyncQueries.setMetadataProfilesStatusPending(instanceId);
  },

  getPendingInstanceIds(): number[] {
    return arrSyncQueries.getPendingSyncs().metadataProfiles;
  },

  getScheduledConfigs(): ScheduledConfig[] {
    return arrSyncQueries.getScheduledConfigs().metadataProfiles;
  },

  createSyncer(client: BaseArrClient, instance: ArrInstance) {
    return new MetadataProfileSyncer(client, instance.id, instance.name);
  },

  hasConfig(instanceId: number): boolean {
    const config = arrSyncQueries.getMetadataProfilesSync(instanceId);
    return config.databaseId !== null && config.profileName !== null;
  },
};

// Register on import
registerSection(metadataProfilesHandler);
