import type { DelayProfilesRow } from '../types.ts';
import type { LocallyModifiable } from './common.ts';

// No JOINs needed - the generated Row type is already semantic (booleans, unions).
// Re-exported here for consistent import pattern across all entities.
export type { DelayProfilesRow } from '../types.ts';

/** Preferred protocol options - extracted for use in mutations */
export type PreferredProtocol = DelayProfilesRow['preferred_protocol'];

/** Delay profile row for list views, optionally flagged as locally modified */
export type DelayProfileListItem = DelayProfilesRow & LocallyModifiable;
