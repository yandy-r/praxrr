/**
 * Pure prune planner for ledger-owned Arr entities (YAN-516).
 *
 * A ledger row becomes a prune candidate only when a live entity with the same
 * remote id carries the exact recorded name, the name is neither desired nor
 * kept, and (for CFs) no surviving live or desired quality profile still scores it.
 * Rows with no live id+name match are ignored: the entity was deleted by hand
 * or recreated under a different name, so Praxrr must not touch it.
 *
 * The caller merges the expected names from `resolveExpectedArrConfig` into the
 * desired-name sets, so "expected" and "desired" collapse into one check here.
 */

import type { ArrManagedEntity, ManagedEntityType, ManagedSourceKind } from '$db/queries/arrManagedEntities.ts';
import type { BlockedPrune } from '../preview/types.ts';

/** One ledger-owned entity scheduled for deletion on reviewed apply. */
export interface PrunePlanItem {
  readonly entityType: ManagedEntityType;
  readonly remoteId: number;
  readonly arrName: string;
  readonly pcdName: string;
  readonly sourceKind: ManagedSourceKind;
  readonly databaseId: number;
}

/** Live Arr entity shape the planner needs; `id` is absent on degenerate payloads. */
export interface PruneLiveEntity {
  readonly id?: number;
  readonly name: string;
  /** Quality profiles only: live format items referencing CFs by id and/or name. */
  readonly formatItems?: readonly { name?: string; format?: number; score?: number }[];
}

export interface PlanPrunesInput {
  readonly ledger: readonly ArrManagedEntity[];
  /** Fail-closed keep rule from `resolveExpectedArrConfig`. */
  readonly isKept: (name: string) => boolean;
  /** Desired plus expected CF names (expected merged by the caller). */
  readonly desiredCustomFormatNames: ReadonlySet<string>;
  /** Desired plus expected QP names (expected merged by the caller). */
  readonly desiredQualityProfileNames: ReadonlySet<string>;
  /** CF names still scored by any desired quality profile. */
  readonly referencedCustomFormatNames: ReadonlySet<string>;
  readonly liveCustomFormats: readonly PruneLiveEntity[];
  readonly liveQualityProfiles: readonly PruneLiveEntity[];
  /** Profile ids assigned to media, or null when that could not be verified. */
  readonly inUseQualityProfileIds: ReadonlySet<number> | null;
}

export interface PrunePlan {
  /** QP prunes first, then CF prunes; ledger order preserved within each group. */
  readonly prunes: PrunePlanItem[];
  readonly blocked: BlockedPrune[];
}

/** Blocked-prune reason when the in-use check could not run (fail closed). */
export const IN_USE_UNVERIFIED_REASON = 'Could not verify that the quality profile is unused';
/** Blocked-prune reason when a quality profile is still assigned to media. */
export const QP_IN_USE_REASON = 'Quality profile is still assigned to media';

export function planPrunes(input: PlanPrunesInput): PrunePlan {
  const liveCFById = indexById(input.liveCustomFormats);
  const liveQPById = indexById(input.liveQualityProfiles);

  const prunes: PrunePlanItem[] = [];
  const blocked: BlockedPrune[] = [];
  const survivingQPFormatIds = new Set<number>();
  const survivingQPFormatNames = new Set<string>();

  for (const row of input.ledger) {
    if (row.entityType !== 'qualityProfile') continue;
    const live = liveQPById.get(row.remoteId);
    if (!live || live.name !== row.arrName) continue;
    if (input.desiredQualityProfileNames.has(row.arrName)) continue;
    if (input.isKept(row.arrName)) continue;

    if (input.inUseQualityProfileIds === null) {
      blocked.push({
        entityType: 'qualityProfile',
        remoteId: row.remoteId,
        name: row.arrName,
        reason: IN_USE_UNVERIFIED_REASON,
      });
      continue;
    }
    if (input.inUseQualityProfileIds.has(row.remoteId)) {
      blocked.push({
        entityType: 'qualityProfile',
        remoteId: row.remoteId,
        name: row.arrName,
        reason: QP_IN_USE_REASON,
      });
      continue;
    }
    prunes.push(toPlanItem(row));
  }
  const prunedProfileIds = new Set(prunes.map((item) => item.remoteId));
  for (const profile of input.liveQualityProfiles) {
    if (profile.id !== undefined && prunedProfileIds.has(profile.id)) continue;
    collectScoredFormatRefs(profile, survivingQPFormatIds, survivingQPFormatNames);
  }

  for (const row of input.ledger) {
    if (row.entityType !== 'customFormat') continue;
    const live = liveCFById.get(row.remoteId);
    if (!live || live.name !== row.arrName) continue;
    if (input.desiredCustomFormatNames.has(row.arrName)) continue;
    if (input.isKept(row.arrName)) continue;
    if (input.referencedCustomFormatNames.has(row.arrName)) continue;
    if (survivingQPFormatIds.has(row.remoteId) || survivingQPFormatNames.has(row.arrName)) continue;

    prunes.push(toPlanItem(row));
  }

  return { prunes, blocked };
}

function indexById(entities: readonly PruneLiveEntity[]): Map<number, PruneLiveEntity> {
  const byId = new Map<number, PruneLiveEntity>();
  for (const entity of entities) {
    if (typeof entity.id === 'number') byId.set(entity.id, entity);
  }
  return byId;
}

/** Collect id and name references of every nonzero-score format item on a surviving QP. */
function collectScoredFormatRefs(live: PruneLiveEntity, ids: Set<number>, names: Set<string>): void {
  for (const item of live.formatItems ?? []) {
    if ((item.score ?? 0) === 0) continue;
    if (typeof item.format === 'number') ids.add(item.format);
    if (typeof item.name === 'string') names.add(item.name);
  }
}

function toPlanItem(row: ArrManagedEntity): PrunePlanItem {
  return {
    entityType: row.entityType,
    remoteId: row.remoteId,
    arrName: row.arrName,
    pcdName: row.pcdName,
    sourceKind: row.sourceKind,
    databaseId: row.databaseId,
  };
}
