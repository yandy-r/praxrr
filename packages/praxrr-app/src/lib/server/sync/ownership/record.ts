/**
 * Ownership ledger writes from confirmed Arr outcomes.
 *
 * Only a confirmed `create` establishes ownership. A confirmed `update` merely refreshes an
 * already-recorded row, so a same-name foreign entity that Praxrr updated is never adopted.
 */

import { logger } from '$logger/logger.ts';
import { arrManagedEntitiesQueries, type ManagedEntityType } from '$db/queries/arrManagedEntities.ts';
import type { SyncEntityOutcome } from '../types.ts';

export interface ManagedWriteProvenance {
  readonly sourceKind: 'pcd' | 'trash';
  /** PCD database id, or the (possibly negative) TRaSH batch id. Stored as its absolute value. */
  readonly databaseId: number;
  /** The suffixed name actually written to the Arr instance. */
  readonly arrName: string;
}

/** Record a confirmed CF/QP write in the ownership ledger. Never throws. */
export function recordConfirmedWrite(
  instanceId: number,
  outcome: SyncEntityOutcome,
  provenance: ManagedWriteProvenance
): void {
  try {
    if (outcome.status !== 'success') return;
    if (outcome.entityType !== 'customFormat' && outcome.entityType !== 'qualityProfile') return;
    if (outcome.action !== 'create' && outcome.action !== 'update') return;

    const remoteId = outcome.remoteId === null ? NaN : Number(outcome.remoteId);
    if (!Number.isInteger(remoteId) || remoteId <= 0) return;

    const databaseId = Math.abs(provenance.databaseId);
    if (!Number.isInteger(databaseId) || databaseId <= 0) return;

    const entityType: ManagedEntityType = outcome.entityType;
    const at = new Date().toISOString();

    if (outcome.action === 'create') {
      arrManagedEntitiesQueries.recordCreated({
        instanceId,
        section: 'qualityProfiles',
        entityType,
        remoteId,
        arrName: provenance.arrName,
        pcdName: outcome.name,
        databaseId,
        sourceKind: provenance.sourceKind,
        at,
      });
    } else {
      arrManagedEntitiesQueries.touchUpdated(instanceId, entityType, remoteId, provenance.arrName, outcome.name, at);
    }
  } catch (error) {
    void logger.error('Failed to record ownership ledger entry', {
      source: 'Sync:Ownership',
      meta: {
        instanceId,
        entityType: outcome.entityType,
        name: outcome.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
