import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';
import type { TrashGuideSourceResponse } from '$lib/server/trashguide/manager.ts';
import type { TrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';

export type DatabaseWithCache = DatabaseInstance & { cacheAvailable: boolean };

export type UnifiedDatabaseItem =
  | {
      type: 'pcd';
      id: number;
      name: string;
      repositoryUrl: string;
      syncStrategy: number;
      lastSyncedAt: string | null;
      enabled: boolean;
      isPrivate?: boolean;
      hasPersonalAccessToken?: boolean;
      cacheAvailable?: boolean;
    }
  | {
      type: 'trash';
      id: number;
      name: string;
      repositoryUrl: string;
      syncStrategy: number;
      lastSyncedAt: string | null;
      enabled: boolean;
      arrType: TrashGuideSupportedArrType;
      scoreProfile?: string;
      entityCounts?: {
        customFormats: number;
        qualityProfiles: number;
        qualitySizes: number;
        naming: number;
      };
    };

export function pcdToUnifiedItem(db: DatabaseWithCache): UnifiedDatabaseItem {
  return {
    type: 'pcd',
    id: db.id,
    name: db.name,
    repositoryUrl: db.repository_url,
    syncStrategy: db.sync_strategy,
    lastSyncedAt: db.last_synced_at,
    enabled: db.enabled === 1,
    isPrivate: db.is_private === 1,
    hasPersonalAccessToken: !!db.has_personal_access_token || !!db.personal_access_token,
    cacheAvailable: db.cacheAvailable,
  };
}

export function trashToUnifiedItem(source: TrashGuideSourceResponse): UnifiedDatabaseItem {
  return {
    type: 'trash',
    id: source.id,
    name: source.name,
    repositoryUrl: source.repositoryUrl,
    syncStrategy: source.syncStrategy,
    lastSyncedAt: source.lastSyncedAt,
    enabled: source.enabled,
    arrType: source.arrType,
    scoreProfile: source.scoreProfile,
    entityCounts: source.entityCounts,
  };
}
