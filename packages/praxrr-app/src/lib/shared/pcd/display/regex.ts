import type { RegularExpressionsRow } from '../types.ts';
import type { LocallyModifiable, Tag } from './common.ts';

/** Regular expression with tags (from JOIN) */
export type RegularExpressionWithTags = RegularExpressionsRow & {
  tags: Tag[];
} & LocallyModifiable;
