import type { ArrConditionTargetType } from '../../arr/capabilities.ts';
import type { CustomFormatsRow, CustomFormatTestsRow } from '../types.ts';
import type { SourcedDisplayRow } from '../../sources/types.ts';
import type { Tag } from './common.ts';
import type { ConditionRef } from './conditions.ts';

/** Custom format basic info */
export type CustomFormatBasic = Omit<CustomFormatsRow, 'created_at' | 'updated_at'>;

/** Custom format test case */
export type CustomFormatTest = Omit<CustomFormatTestsRow, 'id' | 'created_at'>;

/** Custom format data for table/card views (with JOINed data) */
export type CustomFormatTableRow = Omit<CustomFormatsRow, 'include_in_rename' | 'created_at' | 'updated_at'> & {
  tags: Tag[];
  conditions: ConditionRef[];
  arrTargets: ArrConditionTargetType[];
  testCount: number;
} & SourcedDisplayRow;

/** Custom format general information (for general tab) */
export type CustomFormatGeneral = Omit<CustomFormatsRow, 'description' | 'created_at' | 'updated_at'> & {
  description: string; // non-nullable for form
  tags: Tag[];
};
