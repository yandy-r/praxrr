import type { ArrAppType } from '../../arr/capabilities.ts';

export type { LidarrMediaSettingsRow, RadarrMediaSettingsRow, SonarrMediaSettingsRow } from '../types.ts';

export interface MediaSettingsListItem {
  name: string;
  arr_type: ArrAppType;
  propers_repacks: string;
  enable_media_info: boolean;
  updated_at: string;
}
