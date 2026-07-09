/**
 * Rollback entity-family enumeration + PCD-to-PCD diff (issue #16).
 *
 * Enumerates the FULL resolved-config surface — arr-agnostic families plus every supported
 * per-arr (entityType, arrType) pair — so a rollback preview never silently omits a config
 * family. Each family is diffed between the CURRENT resolved cache and the SNAPSHOT-state
 * cache using the shared portable-payload differ (the same primitive sync preview and
 * cross-instance compare use), producing the standard `EntityChange`/`FieldChange` DTOs.
 *
 * Direction: `diffToFieldChanges(current, snapshot)` — `FieldChange.current` is the current
 * PCD desired-state, `FieldChange.desired` is the snapshot restore-target. Action semantics
 * describe how CURRENT moves back to SNAPSHOT: snapshot-only ⇒ create (re-add), current-only
 * ⇒ delete, both-but-changed ⇒ update, else unchanged.
 */

import type { ArrAppType } from '$shared/pcd/types.ts';
import { diffToFieldChanges } from '$sync/preview/diff.ts';
import type { EntityChange, SyncPreviewAction } from '$sync/preview/types.ts';
import type { PCDCache } from '../../database/cache.ts';
import { PORTABLE_ARRAY_KEY_STRATEGIES } from '../../resolved/layerDiff.ts';
import {
  isResolvedEntityNotFoundError,
  listResolvedEntityNames,
  PER_ARR_READERS,
  readResolvedEntity,
} from '../../resolved/readers.ts';
import type { PerArrEntityType, ResolvedEntityPayload, ResolvedEntityType } from '../../resolved/types.ts';
import type { RollbackSection, RollbackSummary } from './types.ts';

export interface RollbackEntityTarget {
  entityType: ResolvedEntityType;
  arrType: ArrAppType | undefined;
}

const ARR_AGNOSTIC_ENTITY_TYPES: readonly ResolvedEntityType[] = [
  'customFormat',
  'qualityProfile',
  'delayProfile',
  'regularExpression',
];

const PER_ARR_ENTITY_TYPES: readonly PerArrEntityType[] = [
  'naming',
  'mediaSettings',
  'qualityDefinitions',
  'lidarrMetadataProfile',
];

const ARR_TYPES: readonly ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

const ENTITY_TITLES: Record<ResolvedEntityType, string> = {
  customFormat: 'Custom Formats',
  qualityProfile: 'Quality Profiles',
  delayProfile: 'Delay Profiles',
  regularExpression: 'Regular Expressions',
  naming: 'Naming',
  mediaSettings: 'Media Settings',
  qualityDefinitions: 'Quality Definitions',
  lidarrMetadataProfile: 'Metadata Profiles',
};

let cachedTargets: readonly RollbackEntityTarget[] | null = null;

/**
 * The full set of entity families a rollback preview/restore diff enumerates. Per-arr pairs
 * are gated by reader-table support (no sibling-app fallback), so e.g. lidarrMetadataProfile
 * is emitted only for lidarr.
 *
 * Computed lazily (not at module load) to avoid a circular-import temporal-dead-zone: this
 * module is reachable from `$pcd/index.ts` → `snapshots/service.ts`, and touching
 * `PER_ARR_READERS` during module init can race `resolved/readers.ts`'s own initialization.
 */
export function rollbackEntityTargets(): readonly RollbackEntityTarget[] {
  if (cachedTargets) {
    return cachedTargets;
  }
  cachedTargets = [
    ...ARR_AGNOSTIC_ENTITY_TYPES.map((entityType) => ({ entityType, arrType: undefined })),
    ...PER_ARR_ENTITY_TYPES.flatMap((entityType) =>
      ARR_TYPES.filter((arrType) => Boolean(PER_ARR_READERS[entityType][arrType])).map((arrType) => ({
        entityType,
        arrType,
      }))
    ),
  ];
  return cachedTargets;
}

function sectionTitle(target: RollbackEntityTarget): string {
  const base = ENTITY_TITLES[target.entityType];
  return target.arrType ? `${base} (${target.arrType})` : base;
}

/** Namespace per-arr entity names so identical names across arrs never collide in the diff. */
function entityNamespace(target: RollbackEntityTarget): string {
  return target.arrType ? `${target.entityType}:${target.arrType}` : target.entityType;
}

async function readEntityOrNull(
  cache: PCDCache,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  name: string
): Promise<ResolvedEntityPayload | null> {
  try {
    return await readResolvedEntity(cache, entityType, arrType, name);
  } catch (error) {
    if (isResolvedEntityNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Diff one entity family between the current and snapshot caches, returning a section of
 * `EntityChange` records (create/update/delete/unchanged).
 */
export async function diffEntityFamily(
  currentCache: PCDCache,
  snapshotCache: PCDCache,
  target: RollbackEntityTarget
): Promise<RollbackSection> {
  const { entityType, arrType } = target;

  const currentNames = new Set(await listResolvedEntityNames(currentCache, entityType, arrType));
  const snapshotNames = new Set(await listResolvedEntityNames(snapshotCache, entityType, arrType));

  const allNames = [...new Set([...currentNames, ...snapshotNames])].sort();
  const namespace = entityNamespace(target);
  const changes: EntityChange[] = [];

  for (const name of allNames) {
    const current = currentNames.has(name) ? await readEntityOrNull(currentCache, entityType, arrType, name) : null;
    const snapshot = snapshotNames.has(name) ? await readEntityOrNull(snapshotCache, entityType, arrType, name) : null;

    // Both missing (a listed name that failed to read on both sides) — nothing to restore.
    if (current === null && snapshot === null) {
      continue;
    }

    const fields = diffToFieldChanges(current ?? {}, snapshot ?? {}, {
      arrayKeyStrategies: PORTABLE_ARRAY_KEY_STRATEGIES,
    });

    let action: SyncPreviewAction;
    if (current === null) {
      action = 'create';
    } else if (snapshot === null) {
      action = 'delete';
    } else {
      action = fields.length > 0 ? 'update' : 'unchanged';
    }

    changes.push({ entityType: namespace, name, action, remoteId: null, fields });
  }

  return { title: sectionTitle(target), entityType: namespace, arrType: arrType ?? null, changes };
}

/** Fold section changes into the create/update/delete/unchanged rollup. */
export function summarizeSections(sections: readonly RollbackSection[]): RollbackSummary {
  const summary: RollbackSummary = { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 };

  for (const section of sections) {
    for (const change of section.changes) {
      switch (change.action) {
        case 'create':
          summary.totalCreates += 1;
          break;
        case 'update':
          summary.totalUpdates += 1;
          break;
        case 'delete':
          summary.totalDeletes += 1;
          break;
        case 'unchanged':
          summary.totalUnchanged += 1;
          break;
      }
    }
  }

  return summary;
}
