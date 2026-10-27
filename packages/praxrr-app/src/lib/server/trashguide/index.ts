/**
 * TRaSH Guide module public API
 */

export { TRASHGUIDE_ENTITY_TYPES } from './types.ts';
export { trashGuideManager } from './manager.ts';

export type { TrashGuideArrType, TrashGuideEntityIdentity, TrashGuideEntityType, TrashGuideId } from './types.ts';

export type {
  TrashGuideLinkOptions,
  TrashGuideSyncFailure,
  TrashGuideSyncResult,
  TrashGuideSyncSuccess,
} from './manager.ts';
