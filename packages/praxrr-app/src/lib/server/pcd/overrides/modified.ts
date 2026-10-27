/**
 * Local overrides: cheap "is this entity locally modified?" lookup for list-page badges.
 *
 * One indexed read of published user ops plus a TypeScript metadata parse. No cache is built
 * and no delta is computed: a published user op counts regardless of its net effect.
 */

import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { entityKeyOf, resolveUserOpEntities } from './identity.ts';
import type { EntityRef, LocallyModifiedLookup } from './types.ts';

function listUserOverrideEntities(databaseId: number): EntityRef[] {
  const ops = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] });
  const { entities } = resolveUserOpEntities(ops);
  return [...entities.values()].map((group) => group.ref);
}

/**
 * Reads published user ops ONCE and returns a closure answering whether
 * `(entityType, arrType, name)` carries at least one local override. `arrType` is `undefined`
 * for arr-agnostic entity types; per-Arr types never match a sibling Arr's overrides.
 */
export function buildLocallyModifiedLookup(databaseId: number): LocallyModifiedLookup {
  const keys = new Set(
    listUserOverrideEntities(databaseId).map((ref) => entityKeyOf(ref.entityType, ref.arrType, ref.name))
  );
  return (entityType, arrType, name) => keys.has(entityKeyOf(entityType, arrType, name));
}

/** Entity refs that carry at least one published user op. */
export function listLocallyModifiedEntities(databaseId: number): EntityRef[] {
  return listUserOverrideEntities(databaseId);
}
