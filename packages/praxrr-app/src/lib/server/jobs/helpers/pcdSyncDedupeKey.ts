const PCD_SYNC_DEDUPE_KEY_PREFIX = 'pcd.sync:';

/** Job-queue dedupe key shared by every `pcd.sync` enqueue and the incoming-preview guard. */
export function getPcdSyncDedupeKey(databaseId: number): string {
  return `${PCD_SYNC_DEDUPE_KEY_PREFIX}${databaseId}`;
}
