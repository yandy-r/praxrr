/**
 * Preview deletes that reviewed apply will actually remove.
 *
 * A delete counts only when `managed === true`. Blocked quality profiles stay in
 * `blockedPrunes` and are matched by remote id plus entity type.
 */

import type { EntityChange, SyncPreviewResult } from '$sync/preview/types.ts';

type ManagedDeleteSnapshot = Pick<
  SyncPreviewResult,
  'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles'
>;

export function isManagedDelete(entity: Pick<EntityChange, 'action' | 'managed'> | null | undefined): boolean {
  return !!entity && entity.action === 'delete' && entity.managed === true;
}

/** Ledger-owned deletes in a preview snapshot. Absence of `managed` is not a delete. */
export function countManagedDeletes(snapshot: ManagedDeleteSnapshot): number {
  let count = 0;
  const profiles = snapshot.qualityProfiles;
  if (profiles) {
    for (const entity of profiles.customFormats) if (isManagedDelete(entity)) count += 1;
    for (const entity of profiles.qualityProfiles) if (isManagedDelete(entity)) count += 1;
  }
  if (isManagedDelete(snapshot.delayProfiles?.profile)) count += 1;
  const media = snapshot.mediaManagement;
  if (media) {
    if (isManagedDelete(media.naming)) count += 1;
    if (isManagedDelete(media.mediaSettings)) count += 1;
    for (const entity of media.qualityDefinitions) if (isManagedDelete(entity)) count += 1;
  }
  if (isManagedDelete(snapshot.metadataProfiles?.profile)) count += 1;
  return count;
}

/**
 * True when one of the sections about to be applied contains a managed delete.
 * Other sections in the same preview do not force the check.
 */
export function sectionsIncludeManagedDelete(snapshot: ManagedDeleteSnapshot, sections: readonly string[]): boolean {
  const selected = new Set(sections);
  if (selected.has('qualityProfiles')) {
    const profiles = snapshot.qualityProfiles;
    if (profiles?.customFormats.some(isManagedDelete) || profiles?.qualityProfiles.some(isManagedDelete)) {
      return true;
    }
  }
  if (selected.has('delayProfiles') && isManagedDelete(snapshot.delayProfiles?.profile)) return true;
  if (selected.has('mediaManagement')) {
    const media = snapshot.mediaManagement;
    if (
      isManagedDelete(media?.naming) ||
      isManagedDelete(media?.mediaSettings) ||
      (media?.qualityDefinitions.some(isManagedDelete) ?? false)
    ) {
      return true;
    }
  }
  if (selected.has('metadataProfiles') && isManagedDelete(snapshot.metadataProfiles?.profile)) {
    return true;
  }
  return false;
}

/** Ledger-owned quality-profile rows that preview blocked instead of planning a delete. */
export function isBlockedPruneRow(
  entity: Pick<EntityChange, 'action' | 'remoteId' | 'entityType'>,
  blocked: readonly { readonly remoteId: number; readonly entityType: string }[] | undefined
): boolean {
  if (entity.action !== 'delete' || entity.remoteId == null || !blocked || blocked.length === 0) {
    return false;
  }
  return blocked.some((row) => row.remoteId === entity.remoteId && row.entityType === entity.entityType);
}
