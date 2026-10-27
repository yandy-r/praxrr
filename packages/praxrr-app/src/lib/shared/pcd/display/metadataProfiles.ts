import type {
  LidarrMetadataProfilePrimaryTypesRow,
  LidarrMetadataProfileReleaseStatusesRow,
  LidarrMetadataProfileSecondaryTypesRow,
  LidarrMetadataProfilesRow,
} from '../types.ts';
import type { LocallyModifiable } from './common.ts';

export interface MetadataProfileTypeToggle {
  id: number;
  name: string;
  allowed: boolean;
}

export interface LidarrMetadataProfileListItem
  extends Pick<LidarrMetadataProfilesRow, 'id' | 'name' | 'description' | 'updated_at'>, LocallyModifiable {
  primaryTypeCount: number;
  secondaryTypeCount: number;
  releaseStatusCount: number;
  primaryAllowedCount: number;
  secondaryAllowedCount: number;
  releaseStatusAllowedCount: number;
}

export interface LidarrMetadataProfileDetail extends Pick<
  LidarrMetadataProfilesRow,
  'id' | 'name' | 'description' | 'updated_at'
> {
  primaryTypes: Array<Pick<LidarrMetadataProfilePrimaryTypesRow, 'type_id' | 'name' | 'allowed'>>;
  secondaryTypes: Array<Pick<LidarrMetadataProfileSecondaryTypesRow, 'type_id' | 'name' | 'allowed'>>;
  releaseStatuses: Array<Pick<LidarrMetadataProfileReleaseStatusesRow, 'status_id' | 'name' | 'allowed'>>;
}
