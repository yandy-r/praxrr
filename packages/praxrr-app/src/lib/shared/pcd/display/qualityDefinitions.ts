import type { ArrAppType } from '../../arr/capabilities.ts';
import type { SourcedDisplayRow } from '../../sources/types.ts';

export type { RadarrQualityDefinitionsRow, SonarrQualityDefinitionsRow } from '../types.ts';

export interface QualityDefinitionListItem {
  name: string;
  arr_type: ArrAppType;
  quality_count: number;
  updated_at: string;
}

export type SourcedQualityDefinitionListItem = QualityDefinitionListItem & SourcedDisplayRow;

/** Single quality entry (Row without the config name) */
export interface QualityDefinitionEntry {
  quality_name: string;
  min_size: number;
  max_size: number;
  preferred_size: number;
}

/** Aggregate config with all its entries */
export interface QualityDefinitionsConfig {
  name: string;
  entries: QualityDefinitionEntry[];
}
