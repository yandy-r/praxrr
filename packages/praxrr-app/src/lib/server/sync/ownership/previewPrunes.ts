/**
 * Preview-time prune planning glue for the quality profile syncer (YAN-516).
 *
 * Read-only: resolves the expected config, runs the in-use check only when a quality
 * profile could actually be pruned, plans prunes, and marks the matching preview delete
 * rows as `managed`. Nothing here writes the ledger or touches Arr state.
 */

import type { BaseArrClient } from '$arr/base.ts';
import type { ArrManagedEntity, ManagedEntityType } from '$db/queries/arrManagedEntities.ts';
import type { SyncArrType } from '../mappings.ts';
import type { BlockedPrune, EntityChange } from '../preview/types.ts';
import { resolveExpectedArrConfig } from './expectedConfig.ts';
import { planPrunes, type PruneLiveEntity, type PrunePlan, type PrunePlanItem } from './planPrunes.ts';
import { loadInUseQualityProfileIds } from './qualityProfileInUse.ts';

export interface PreviewPrunePlanInput {
  readonly client: BaseArrClient;
  readonly instanceId: number;
  readonly instanceType: SyncArrType;
  readonly reviewed: boolean;
  readonly ledger: readonly ArrManagedEntity[];
  /** Desired CF payloads (real or plan-synthetic ids, suffixed names). */
  readonly desiredCustomFormats: readonly { readonly id?: number; readonly name: string }[];
  /** Desired QP payloads (suffixed names). */
  readonly desiredProfiles: readonly {
    readonly name: string;
    readonly formatItems?: readonly { readonly format: number; readonly score: number }[];
  }[];
  readonly liveCustomFormats: readonly PruneLiveEntity[];
  readonly liveQualityProfiles: readonly PruneLiveEntity[];
}

/** Only reviewed previews verify candidate QPs against the media library; others fail closed. */
export async function planPreviewPrunes(input: PreviewPrunePlanInput): Promise<PrunePlan> {
  const expected = await resolveExpectedArrConfig(input.instanceId, input.instanceType);

  const desiredCustomFormatNames = new Set<string>(expected.expectedCFNames);
  for (const format of input.desiredCustomFormats) desiredCustomFormatNames.add(format.name);
  const desiredQualityProfileNames = new Set<string>(expected.expectedQPNames);
  for (const profile of input.desiredProfiles) desiredQualityProfileNames.add(profile.name);

  // Conservative: a CF still scored (nonzero) by any desired profile is never pruned.
  const idToName = new Map<number, string>();
  for (const format of input.liveCustomFormats) {
    if (typeof format.id === 'number') idToName.set(format.id, format.name);
  }
  for (const format of input.desiredCustomFormats) {
    if (typeof format.id === 'number') idToName.set(format.id, format.name);
  }
  const referencedCustomFormatNames = new Set<string>();
  for (const profile of input.desiredProfiles) {
    for (const item of profile.formatItems ?? []) {
      if (item.score === 0) continue;
      const name = idToName.get(item.format);
      if (name !== undefined) referencedCustomFormatNames.add(name);
    }
  }

  const liveQualityProfileNameById = new Map<number, string>();
  for (const profile of input.liveQualityProfiles) {
    if (typeof profile.id === 'number') liveQualityProfileNameById.set(profile.id, profile.name);
  }
  const hasQualityProfileCandidate = input.ledger.some(
    (row) =>
      row.entityType === 'qualityProfile' &&
      liveQualityProfileNameById.get(row.remoteId) === row.arrName &&
      !desiredQualityProfileNames.has(row.arrName) &&
      !expected.isKept(row.arrName)
  );
  const inUseQualityProfileIds = hasQualityProfileCandidate
    ? input.reviewed
      ? await loadInUseQualityProfileIds(input.client, input.instanceType)
      : null
    : new Set<number>();

  return planPrunes({
    ledger: input.ledger,
    isKept: expected.isKept,
    desiredCustomFormatNames,
    desiredQualityProfileNames,
    referencedCustomFormatNames,
    liveCustomFormats: input.liveCustomFormats,
    liveQualityProfiles: input.liveQualityProfiles,
    inUseQualityProfileIds,
  });
}

/**
 * Mark delete rows whose `(entityType, remoteId)` is a planned prune as `managed`.
 * A planned prune with no delete row is impossible in theory and throws (fail closed).
 */
export function markManagedDeletes(
  changes: readonly EntityChange[],
  entityType: ManagedEntityType,
  prunes: readonly PrunePlanItem[]
): EntityChange[] {
  const planned = new Set(prunes.filter((item) => item.entityType === entityType).map((item) => item.remoteId));
  const marked = new Set<number>();
  const result: EntityChange[] = [];

  for (const change of changes) {
    const isPlanned = change.action === 'delete' && change.remoteId !== null && planned.has(change.remoteId);
    if (isPlanned) {
      marked.add(change.remoteId!);
      result.push({ ...change, managed: true });
    } else {
      result.push(change);
    }
  }

  for (const remoteId of planned) {
    if (!marked.has(remoteId)) {
      throw new Error(`Planned prune of ${entityType} ${remoteId} has no matching delete in the preview`);
    }
  }
  return result;
}

/** Blocked prunes belong in the result only when there are some. */
export function blockedPrunesField(blocked: readonly BlockedPrune[]): { blockedPrunes?: readonly BlockedPrune[] } {
  return blocked.length > 0 ? { blockedPrunes: blocked } : {};
}
