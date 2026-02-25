/**
 * TRaSH Guide domain types
 */

import type { ArrAppType } from '$shared/pcd/types.ts';

/** TRaSH entity variants stored and synced by the TRaSH pipeline. */
export const TRASHGUIDE_ENTITY_TYPES = [
	'custom_format',
	'quality_profile',
	'quality_size',
	'naming',
] as const;

export type TrashGuideEntityType = (typeof TRASHGUIDE_ENTITY_TYPES)[number];

/** Arr type values supported for TRaSH entities. */
export type TrashGuideArrType = ArrAppType;

/** TRaSH stable identity key. */
export type TrashGuideId = string;

/** Identity shape shared by all TRaSH entities persisted in cache/mappings. */
export interface TrashGuideEntityIdentity {
	readonly trash_id: TrashGuideId;
	readonly arr_type: TrashGuideArrType;
	readonly entity_type: TrashGuideEntityType;
}
