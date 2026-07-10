/**
 * Custom format syncer
 * Syncs custom formats from PCD to arr instances
 *
 * This is a helper syncer used by quality profiles - custom formats must be
 * synced before quality profiles since profiles reference format IDs.
 *
 * Each database's CFs are suffixed with an invisible namespace character
 * so multiple databases can coexist in the same arr instance.
 */

import type { BaseArrClient } from '$arr/base.ts';
import { logger } from '$logger/logger.ts';
import type { SyncArrType } from '../mappings.ts';
import type { SyncEntityOutcome } from '../types.ts';
import { sanitizeArrWriteError } from '../sanitizeArrWriteError.ts';
import { type ArrCustomFormat, transformCustomFormatWithDiagnostics, type PcdCustomFormat } from './transformer.ts';

/** A Lidarr custom format dropped before write because no conditions are supported (issue #232). */
const LIDARR_NO_SUPPORTED_CONDITIONS_REASON = 'No custom format conditions are supported on Lidarr.';

interface PreparedCustomFormat {
  readonly pcdName: string;
  readonly arrFormat: ArrCustomFormat;
}

/** A CF intentionally not written (e.g. Lidarr with no supported conditions), surfaced so
 * `syncCustomFormats` can emit exactly one `skipped` outcome for it (issue #232, D5). */
interface DroppedCustomFormat {
  readonly pcdName: string;
  readonly reason: string;
}

interface PreparedCustomFormatResult {
  readonly preparedFormats: readonly PreparedCustomFormat[];
  readonly pcdFormatIdMap: Map<string, number>;
  readonly droppedFormats: readonly DroppedCustomFormat[];
}

/** Confirmed custom-format sync outcomes plus the resolved PCD-name → arr-id map. */
export interface SyncCustomFormatsResult {
  readonly pcdFormatIdMap: Map<string, number>;
  readonly outcomes: SyncEntityOutcome[];
}

interface CompileCustomFormatsOptions {
  readonly includeSyntheticIds?: boolean;
}

async function buildCustomFormatPayloads(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string,
  options: CompileCustomFormatsOptions = {}
): Promise<PreparedCustomFormatResult> {
  const existingFormats = await client.getCustomFormats();
  const existingMap = new Map(existingFormats.map((format) => [format.name, format.id!]));

  const preparedFormats: PreparedCustomFormat[] = [];
  const pcdFormatIdMap = new Map<string, number>();
  const droppedFormats: DroppedCustomFormat[] = [];
  let syntheticId = -1;

  for (const [pcdName, pcdFormat] of pcdFormats) {
    const transformed = transformCustomFormatWithDiagnostics(pcdFormat, instanceType);
    const arrFormat = transformed.format;
    const suffixedName = pcdName + suffix;
    arrFormat.name = suffixedName;

    if (instanceType === 'lidarr' && transformed.skippedConditions.length > 0) {
      await logger.warn('Skipping unsupported Lidarr custom format conditions', {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName,
          skippedConditions: transformed.skippedConditions,
        },
      });
    }

    if (instanceType === 'lidarr' && pcdFormat.conditions.length > 0 && arrFormat.specifications.length === 0) {
      await logger.warn('Skipping Lidarr custom format with no supported conditions', {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName,
          conditionCount: pcdFormat.conditions.length,
        },
      });
      droppedFormats.push({ pcdName, reason: LIDARR_NO_SUPPORTED_CONDITIONS_REASON });
      continue;
    }

    const existingId = existingMap.get(suffixedName);
    if (existingId !== undefined) {
      arrFormat.id = existingId;
      pcdFormatIdMap.set(pcdName, existingId);
    } else if (options.includeSyntheticIds) {
      arrFormat.id = syntheticId;
      pcdFormatIdMap.set(pcdName, syntheticId);
      syntheticId -= 1;
    }

    preparedFormats.push({
      pcdName,
      arrFormat,
    });
  }

  return { preparedFormats, pcdFormatIdMap, droppedFormats };
}

/**
 * Prepare custom format payloads and synthetic IDs for preview generation only.
 */
export async function previewCustomFormats(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string
): Promise<PreparedCustomFormatResult> {
  return buildCustomFormatPayloads(client, instanceId, instanceType, pcdFormats, suffix, {
    includeSyntheticIds: true,
  });
}

/**
 * Sync custom formats for a single database to an arr instance.
 *
 * @param suffix - Zero-width namespace suffix for this database
 * @returns The PCD-name → arr-id map (used to resolve CF scores in quality
 *          profiles) plus one confirmed {@link SyncEntityOutcome} per attempted
 *          CF: `success` on a resolved create/update, `failed` on a thrown write
 *          (previously swallowed), and `skipped` for a Lidarr CF dropped because
 *          no conditions are supported.
 */
export async function syncCustomFormats(
  client: BaseArrClient,
  instanceId: number,
  instanceType: SyncArrType,
  pcdFormats: Map<string, PcdCustomFormat>,
  suffix: string
): Promise<SyncCustomFormatsResult> {
  const { preparedFormats, pcdFormatIdMap, droppedFormats } = await buildCustomFormatPayloads(
    client,
    instanceId,
    instanceType,
    pcdFormats,
    suffix
  );

  const outcomes: SyncEntityOutcome[] = [];

  // CFs dropped before any write (Lidarr, no supported conditions) → one skipped outcome each.
  for (const { pcdName, reason } of droppedFormats) {
    outcomes.push({
      section: 'qualityProfiles',
      arrType: instanceType,
      entityType: 'customFormat',
      name: pcdName,
      action: 'create',
      status: 'skipped',
      remoteId: null,
      reason,
    });
  }

  for (const { pcdName, arrFormat } of preparedFormats) {
    await logger.debug(`Compiled custom format "${pcdName}" (suffixed)`, {
      source: 'Compile:CustomFormat',
      meta: {
        instanceId,
        pcdName,
        format: arrFormat,
      },
    });

    const isUpdate = arrFormat.id !== undefined;
    try {
      let remoteId: number;
      if (arrFormat.id !== undefined) {
        // Update existing
        await client.updateCustomFormat(arrFormat.id, arrFormat);
        remoteId = arrFormat.id;
        pcdFormatIdMap.set(pcdName, arrFormat.id);
        await logger.debug(`Updated custom format "${pcdName}"`, {
          source: 'Sync:CustomFormats',
          meta: { instanceId, formatId: arrFormat.id, pcdName, suffixedName: arrFormat.name },
        });
      } else {
        // Create new
        const response = await client.createCustomFormat(arrFormat);
        remoteId = response.id!;
        pcdFormatIdMap.set(pcdName, response.id!);
        await logger.debug(`Created custom format "${pcdName}"`, {
          source: 'Sync:CustomFormats',
          meta: { instanceId, formatId: response.id, pcdName, suffixedName: arrFormat.name },
        });
      }
      outcomes.push({
        section: 'qualityProfiles',
        arrType: instanceType,
        entityType: 'customFormat',
        name: pcdName,
        action: isUpdate ? 'update' : 'create',
        status: 'success',
        remoteId: String(remoteId),
        reason: null,
      });
    } catch (error) {
      const { reason, protectedDetails } = sanitizeArrWriteError(error);
      await logger.error(`Failed to sync custom format "${pcdName}"`, {
        source: 'Sync:CustomFormats',
        meta: {
          instanceId,
          pcdName,
          suffixedName: arrFormat.name,
          request: arrFormat,
          ...protectedDetails,
        },
      });
      outcomes.push({
        section: 'qualityProfiles',
        arrType: instanceType,
        entityType: 'customFormat',
        name: pcdName,
        action: isUpdate ? 'update' : 'create',
        status: 'failed',
        remoteId: isUpdate ? String(arrFormat.id) : null,
        reason,
      });
    }
  }

  return { pcdFormatIdMap, outcomes };
}
