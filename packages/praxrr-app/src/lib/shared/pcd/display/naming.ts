import type { ArrAppType } from '../../arr/capabilities.ts';
import type { SourcedDisplayRow } from '../../sources/types.ts';
import type { LocallyModifiable } from './common.ts';

export type { LidarrNamingRow, RadarrNamingRow, SonarrNamingRow } from '../types.ts';

export interface NamingListItem extends LocallyModifiable {
  name: string;
  arr_type: ArrAppType;
  rename: boolean;
  updated_at: string;
}

export type SourcedNamingListItem = NamingListItem & SourcedDisplayRow;
